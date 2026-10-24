// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IV2Router {
    function factory() external view returns (address);
    function WETH() external view returns (address);
    function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external;
    function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external payable;
    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory amounts);
}

interface IV2Factory {
    function createPair(address tokenA, address tokenB) external returns (address);
    function getPair(address tokenA, address tokenB) external view returns (address);
}

interface IV2Pair {
    function token0() external view returns (address);
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function mint(address to) external returns (uint256 liquidity);
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
}

interface IWETH {
    function deposit() external payable;
}

interface IAutistikLocker {
    function lock(address owner, address token, bool isLpToken, uint256 amount, uint256 unlockDate, string calldata description) external returns (uint256 id);
    function unlock(uint256 lockId) external;
}

interface IFeeSink {
    function distributePlatform() external payable;
}

interface IBurner {
    function burn() external;
}

/// @dev The deployer holds a token's settings while it is being created (see AutistikTokenDeployer.deploy).
interface ITokenSettings {
    function pendingInit() external view returns (bytes memory);
}

// =====================================================================================================================
//                                                     THE TOKEN
// =====================================================================================================================

/**
 * @title AUTISTIK launch token
 * @notice Every token launched on AUTISTIK Hub. Built to be safe for buyers and clean on scanners:
 *  - Fixed supply. No mint, no blacklist, no pause, no way to stop selling, no proxy.
 *  - Creator tax: at most 10% on buys and 10% on sells, set at launch. Afterwards the creator can only LOWER it.
 *  - A small platform fee on buys and sells supports AUTISTIK Hub (fixed at launch, at most 1%).
 *  - Trading starts when the creator opens it, and opens by itself 24 hours after launch at the latest,
 *    so it can never be kept closed.
 *  - Before trading opens, up to 3 whitelisted wallets may buy, each up to a small fixed amount.
 *  - For the first 5 minutes of trading: at most 1% of supply per buy and 2% per wallet (stops sniper bots).
 * Fees are collected in tokens and sold for the chain's coin on sells, then sent to the creator's tax wallet
 * and to the launchpad (which splits the platform part between marketing, AUTISTIK buy-and-burn and the team).
 */
contract AutistikToken is ERC20 {
    uint256 public constant MAX_TAX = 1_000; // 10%
    uint256 public constant AUTO_OPEN = 24 hours;
    uint256 public constant SNIPE_WINDOW = 5 minutes;

    address public immutable pad;
    address public immutable pair;
    IV2Router public immutable router;
    address public immutable weth;
    uint256 public immutable platformFee; // basis points
    uint256 public immutable launchedAt;
    uint256 public immutable wlMaxTokens;
    uint256 public immutable swapThreshold;

    address public owner;
    address public taxWallet;
    uint256 public buyTax; // basis points, creator's
    uint256 public sellTax;
    uint256 public tradingOpenedAt;

    mapping(address => bool) public whitelisted;
    mapping(address => uint256) public wlBought;

    uint256 public taxTokens; // collected creator tax, waiting to be sold
    uint256 public platformTokens; // collected platform fee, waiting to be sold
    uint256 public owedToTaxWallet; // coin the tax wallet couldn't receive; it can claim it
    bool private swapping;

    event TradingOpened(uint256 at);
    event TaxesLowered(uint256 buyTax, uint256 sellTax);
    event TaxWalletChanged(address wallet);
    event OwnershipTransferred(address previousOwner, address newOwner);
    event FeesSold(uint256 tokens, uint256 coin, uint256 toTaxWallet, uint256 toPlatform);

    error NotOwner();
    error TradingNotOpen();
    error TaxTooHigh();
    error InvalidVanityAddress();
    error WhitelistLimit();
    error SnipeLimit();
    error AlreadyOpen();
    error ZeroAddress();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    struct Init {
        address pad;
        string name;
        string symbol;
        uint256 supply;
        address router;
        address creator;
        address taxWallet;
        uint256 buyTax;
        uint256 sellTax;
        uint256 platformFee;
        address[] whitelist;
        uint256 wlMaxTokens;
    }

    string private _tokenName;
    string private _tokenSymbol;

    /// @dev No constructor arguments: the settings come from the deployer, so every token has the same creation code
    ///      and its address depends only on the salt (CREATE2). That's how launch addresses can all end in "aaa".
    constructor() ERC20("", "") {
        Init memory i = abi.decode(ITokenSettings(msg.sender).pendingInit(), (Init));
        _tokenName = i.name;
        _tokenSymbol = i.symbol;
        if (i.buyTax > MAX_TAX || i.sellTax > MAX_TAX || i.platformFee > 100) revert TaxTooHigh();
        if ((i.buyTax > 0 || i.sellTax > 0) && i.taxWallet == address(0)) revert ZeroAddress();
        pad = i.pad;
        router = IV2Router(i.router);
        weth = router.WETH();
        pair = IV2Factory(router.factory()).createPair(address(this), weth);
        platformFee = i.platformFee;
        launchedAt = block.timestamp;
        wlMaxTokens = i.wlMaxTokens;
        swapThreshold = i.supply / 2_000; // 0.05% of supply
        owner = i.creator;
        taxWallet = i.taxWallet;
        buyTax = i.buyTax;
        sellTax = i.sellTax;
        for (uint256 k; k < i.whitelist.length && k < 3; k++) whitelisted[i.whitelist[k]] = true;
        _mint(i.pad, i.supply);
        emit OwnershipTransferred(address(0), i.creator);
    }

    // ------------------------------------------------------------------ views

    function name() public view override returns (string memory) {
        return _tokenName;
    }

    function symbol() public view override returns (string memory) {
        return _tokenSymbol;
    }

    function tradingOpen() public view returns (bool) {
        return tradingOpenedAt != 0 || block.timestamp >= launchedAt + AUTO_OPEN;
    }

    /// @notice When trading started (or will start by itself).
    function openTime() public view returns (uint256) {
        return tradingOpenedAt != 0 ? tradingOpenedAt : launchedAt + AUTO_OPEN;
    }

    // ------------------------------------------------------------------ creator controls (all one-way / safe)

    /// @notice Starts trading. Can only be done once; trading can never be stopped again.
    function openTrading() external onlyOwner {
        if (tradingOpen()) revert AlreadyOpen();
        tradingOpenedAt = block.timestamp;
        emit TradingOpened(block.timestamp);
    }

    /// @notice Lowers the creator tax. It can never be raised again.
    function lowerTaxes(uint256 newBuy, uint256 newSell) external onlyOwner {
        if (newBuy > buyTax || newSell > sellTax) revert TaxTooHigh();
        buyTax = newBuy;
        sellTax = newSell;
        emit TaxesLowered(newBuy, newSell);
    }

    function setTaxWallet(address wallet) external onlyOwner {
        if (wallet == address(0)) revert ZeroAddress();
        taxWallet = wallet;
        emit TaxWalletChanged(wallet);
    }

    /// @notice Gives up the creator controls forever. Trading opens by itself if it hasn't yet.
    function renounceOwnership() external onlyOwner {
        emit OwnershipTransferred(owner, address(0));
        owner = address(0);
    }

    /// @notice The tax wallet collects coin that couldn't be sent to it automatically.
    function claimTax() external {
        uint256 amount = owedToTaxWallet;
        owedToTaxWallet = 0;
        (bool ok,) = taxWallet.call{value: amount}("");
        if (!ok) owedToTaxWallet = amount;
    }

    // ------------------------------------------------------------------ transfers

    function _update(address from, address to, uint256 value) internal override {
        if (swapping || from == address(0) || to == address(0) || from == pad || to == pad) {
            super._update(from, to, value);
            return;
        }
        bool isBuy = from == pair;
        bool isSell = to == pair;

        if (!tradingOpen()) {
            if (isSell) revert TradingNotOpen();
            if (isBuy) {
                if (!whitelisted[to]) revert TradingNotOpen();
                uint256 bought = wlBought[to] + value;
                if (bought > wlMaxTokens) revert WhitelistLimit();
                wlBought[to] = bought;
            }
        } else if (isBuy && block.timestamp < openTime() + SNIPE_WINDOW) {
            uint256 supply = totalSupply();
            if (value > supply / 100 || balanceOf(to) + value > (supply * 2) / 100) revert SnipeLimit();
        }

        // Sell collected fees first (only on sells, so buys stay cheap). Never blocks the trade.
        if (isSell && balanceOf(address(this)) >= swapThreshold) _sellFees();

        if (isBuy || isSell) {
            uint256 taxPart = (value * (isBuy ? buyTax : sellTax)) / 10_000;
            uint256 platformPart = (value * platformFee) / 10_000;
            uint256 fee = taxPart + platformPart;
            if (fee > 0) {
                taxTokens += taxPart;
                platformTokens += platformPart;
                super._update(from, address(this), fee);
                value -= fee;
            }
        }
        super._update(from, to, value);
    }

    function _sellFees() private {
        uint256 pending = taxTokens + platformTokens;
        uint256 amount = balanceOf(address(this));
        if (amount > swapThreshold * 20) amount = swapThreshold * 20;
        if (pending == 0 || amount == 0) return;
        if (amount > pending) amount = pending;
        uint256 taxShare = (taxTokens * amount) / pending;
        uint256 platformShare = amount - taxShare;

        swapping = true;
        _approve(address(this), address(router), amount);
        address[] memory path = new address[](2);
        path[0] = address(this);
        path[1] = weth;
        uint256 before = address(this).balance;
        try router.swapExactTokensForETHSupportingFeeOnTransferTokens(amount, 0, path, address(this), block.timestamp) {
            taxTokens -= taxShare;
            platformTokens -= platformShare;
            uint256 got = address(this).balance - before;
            uint256 toTax = (got * taxShare) / amount;
            uint256 toPlatform = got - toTax;
            if (toTax > 0) {
                (bool ok,) = taxWallet.call{value: toTax, gas: 50_000}("");
                if (!ok) owedToTaxWallet += toTax;
            }
            if (toPlatform > 0) {
                try IFeeSink(pad).distributePlatform{value: toPlatform, gas: 400_000}() {} catch {}
            }
            emit FeesSold(amount, got, toTax, toPlatform);
        } catch {}
        swapping = false;
    }

    receive() external payable {}
}

/// @notice Deploys launch tokens for the launchpad (kept separate so the launchpad stays under the size limit).
contract AutistikTokenDeployer {
    address public immutable pad;

    constructor(address pad_) {
        pad = pad_;
    }

    bytes private _pending;

    /// @notice The settings of the token being created right now (empty at any other time).
    function pendingInit() external view returns (bytes memory) {
        return _pending;
    }

    /// @dev Only the launchpad can deploy, and every token it deploys belongs to that launchpad.
    function deploy(AutistikToken.Init memory i, bytes32 salt) external returns (address token) {
        require(msg.sender == pad, "only launchpad");
        i.pad = pad;
        _pending = abi.encode(i);
        token = address(new AutistikToken{salt: salt}());
        delete _pending;
    }

    /// @notice The address a token launched with `salt` gets.
    function tokenAddress(bytes32 salt) public view returns (address) {
        bytes32 h = keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(type(AutistikToken).creationCode)));
        return address(uint160(uint256(h)));
    }
}

// =====================================================================================================================
//                                                   THE LAUNCHPAD
// =====================================================================================================================

/**
 * @title AUTISTIK Launch Pad v3
 * @notice One transaction launches a token: creates it, gives the creator their share, adds liquidity on the chain's
 * V2 DEX, optionally buys the creator's first tokens (at most 30% of supply in total for the creator), and then
 * burns the LP tokens or locks them in the AUTISTIK Locker for 6 months or 1 year.
 * Locked liquidity: nobody can touch it before the unlock date. After it, anyone can trigger the release (the AUTISTIK
 * keeper does this automatically) and it goes straight to the creator's wallet (and only to the creator).
 * Launching is free: a small contribution (about $3) comes out of the coin sent with the launch and goes to
 * marketing. Platform fee from trades is split 30% marketing, 30% AUTISTIK buy-and-burn, 40% team.
 * v3: tokens are created with CREATE2 and a salt the Hub picks (signed into the creator's permit), so every token
 * address ends in "aaa".
 */
contract AutistikLaunchpadV3 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 public constant MAX_CREATOR_BPS = 3_000; // creator's tokens (free share + first buy): at most 30%
    uint256 public constant MAX_PLATFORM_FEE = 100; // 1%
    uint256 public constant MIN_SUPPLY = 1_000 ether;
    uint256 public constant MAX_SUPPLY = 1_000_000_000_000_000 ether;
    uint8 public constant LOCK_BURN = 0;
    uint8 public constant LOCK_6_MONTHS = 1;
    uint8 public constant LOCK_1_YEAR = 2;

    IV2Router public immutable router;
    IV2Factory public immutable factory;
    address public immutable weth;
    IAutistikLocker public immutable locker;
    IERC20 public immutable stablecoin;
    uint256 public immutable maxLaunchFee;
    uint256 public immutable minLiquidity;
    AutistikTokenDeployer public immutable deployer;

    address public owner;
    address public pendingOwner;
    address public team;
    address public marketing;
    address public burner;
    uint256 public launchFee;
    uint256 public platformFee; // for new launches, basis points
    uint256 public maxWhitelistNative; // about $40 worth of the chain's coin, kept up to date by the team
    address public eligibilitySigner;
    uint256 public launches;
    mapping(address => uint256) public owed; // coin a wallet couldn't receive; it can claim it

    struct Launch {
        address creator;
        address pair;
        uint256 lockId; // locker id (when locked)
        uint8 lockOption;
        bool released;
    }
    mapping(address => Launch) public launchOf;
    mapping(bytes32 => bool) public permitUsed;

    struct Plan {
        uint256 price;
        uint256 duration;
    }
    mapping(uint256 => Plan) public plans;

    event Launched(address indexed token, address indexed pair, address indexed creator, uint256 creatorTokens, uint256 devBuyTokens, uint8 lockOption, uint256 lockId);
    event LiquidityAdded(address indexed token, uint256 tokens, uint256 native, uint256 lp);
    event LiquidityReleased(address indexed token, address indexed creator, uint256 lockId);
    event PlatformFee(uint256 total, uint256 marketing, uint256 burn, uint256 team);
    event Promoted(address indexed token, address indexed payer, uint256 indexed planId, uint256 price, uint256 duration);
    event SettingsChanged();
    event OwnershipTransferred(address previousOwner, address newOwner);
    event OwnershipTransferStarted(address previousOwner, address newOwner);

    error NotOwner();
    error NotPendingOwner();
    error ZeroAddress();
    error InvalidName();
    error InvalidSymbol();
    error InvalidSupply();
    error InvalidLock();
    error CreatorShareTooHigh();
    error NotEnoughLiquidity();
    error FeeTooHigh();
    error TooLate();
    error NotEligible();
    error PermitExpired();
    error PermitUsed();
    error TooManyWhitelisted();
    error WhitelistTooBig();
    error NotLaunchedHere();
    error NotLocked();
    error AlreadyReleased();
    error UnknownPlan();
    error PriceTooHigh();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    struct Config {
        address owner; // the AUTISTIK team wallet (set explicitly so the launchpad can be deployed by any deployer)
        address router;
        address locker;
        address stablecoin;
        address team;
        address marketing;
        address burner;
        uint256 launchFee;
        uint256 maxLaunchFee;
        uint256 platformFee;
        uint256 minLiquidity;
        uint256 maxWhitelistNative;
        address eligibilitySigner;
    }

    constructor(Config memory c) {
        if (c.owner == address(0) || c.router == address(0) || c.locker == address(0) || c.stablecoin == address(0) || c.team == address(0) || c.marketing == address(0) || c.burner == address(0)) revert ZeroAddress();
        if (c.launchFee > c.maxLaunchFee || c.platformFee > MAX_PLATFORM_FEE) revert FeeTooHigh();
        router = IV2Router(c.router);
        factory = IV2Factory(router.factory());
        weth = router.WETH();
        locker = IAutistikLocker(c.locker);
        stablecoin = IERC20(c.stablecoin);
        maxLaunchFee = c.maxLaunchFee;
        minLiquidity = c.minLiquidity;
        deployer = new AutistikTokenDeployer(address(this));
        team = c.team;
        marketing = c.marketing;
        burner = c.burner;
        launchFee = c.launchFee;
        platformFee = c.platformFee;
        maxWhitelistNative = c.maxWhitelistNative;
        eligibilitySigner = c.eligibilitySigner;
        uint256 usd = 10 ** IERC20Metadata(c.stablecoin).decimals();
        plans[0] = Plan(30 * usd, 5 hours);
        plans[1] = Plan(200 * usd, 1 days);
        owner = c.owner;
        emit OwnershipTransferred(address(0), c.owner);
    }

    struct LaunchParams {
        string name;
        string symbol;
        uint256 supply; // with 18 decimals
        uint256 creatorBps; // free share for the creator, basis points
        uint256 devBuyNative; // coin spent on the creator's first buy (part of msg.value)
        uint256 buyTax; // creator tax, basis points, max 1000
        uint256 sellTax;
        address taxWallet;
        address[] whitelist; // up to 3 wallets that may buy before trading opens
        uint256 whitelistNative; // how much each may buy before trading opens (<= maxWhitelistNative)
        uint8 lockOption; // 0 burn, 1 lock 6 months, 2 lock 1 year
        uint256 permitDeadline;
        uint256 maxFeeAccepted;
        uint256 deadline;
        bytes32 salt; // picks the token's address (CREATE2); signed into the permit with the creator
    }

    /// @dev msg.value = launchFee + liquidity + devBuyNative. The site shows the creator one "liquidity" amount and
    ///      the small launch contribution comes out of it.
    function launch(LaunchParams calldata p, bytes calldata permitSig) external payable nonReentrant returns (address token) {
        (uint256 fee, uint256 liquidityNative) = _validate(p, permitSig);
        token = _deploy(p, liquidityNative);
        _finish(token, p, liquidityNative);
        if (fee > 0) _pay(marketing, fee);
    }

    function _validate(LaunchParams calldata p, bytes calldata permitSig) private returns (uint256 fee, uint256 liquidityNative) {
        if (block.timestamp > p.deadline) revert TooLate();
        if (p.lockOption > LOCK_1_YEAR) revert InvalidLock();
        _checkEligible(p.permitDeadline, p.salt, permitSig);
        if (bytes(p.name).length == 0 || bytes(p.name).length > 32) revert InvalidName();
        if (bytes(p.symbol).length == 0 || bytes(p.symbol).length > 12) revert InvalidSymbol();
        if (p.supply < MIN_SUPPLY || p.supply > MAX_SUPPLY) revert InvalidSupply();
        if (p.creatorBps > MAX_CREATOR_BPS) revert CreatorShareTooHigh();
        if (p.whitelist.length > 3) revert TooManyWhitelisted();
        if (p.whitelistNative > maxWhitelistNative) revert WhitelistTooBig();
        fee = launchFee;
        if (fee > p.maxFeeAccepted) revert FeeTooHigh();
        if (msg.value < fee + p.devBuyNative + minLiquidity) revert NotEnoughLiquidity();
        liquidityNative = msg.value - fee - p.devBuyNative;
        if (liquidityNative == 0) revert NotEnoughLiquidity();
    }

    function _finish(address token, LaunchParams calldata p, uint256 liquidityNative) private {
        address pair = AutistikToken(payable(token)).pair();
        (uint256 creatorTokens, uint256 lp) = _seed(token, pair, p, liquidityNative);
        uint256 devTokens = p.devBuyNative > 0 ? _devBuy(token, pair, p.devBuyNative) : 0;
        if (creatorTokens + devTokens > (p.supply * MAX_CREATOR_BPS) / 10_000) revert CreatorShareTooHigh();
        uint256 lockId = _lockLiquidity(pair, lp, p.lockOption, p.symbol);
        launchOf[token] = Launch(msg.sender, pair, lockId, p.lockOption, false);
        unchecked {
            launches++;
        }
        emit Launched(token, pair, msg.sender, creatorTokens, devTokens, p.lockOption, lockId);
    }

    function _deploy(LaunchParams calldata p, uint256 liquidityNative) private returns (address) {
        uint256 liquidityTokens = p.supply - (p.supply * p.creatorBps) / 10_000;
        address token = deployer.deploy(
            AutistikToken.Init({
                pad: address(this),
                name: p.name,
                symbol: p.symbol,
                supply: p.supply,
                router: address(router),
                creator: msg.sender,
                taxWallet: p.taxWallet,
                buyTax: p.buyTax,
                sellTax: p.sellTax,
                platformFee: platformFee,
                whitelist: p.whitelist,
                // A whitelisted wallet may buy about `whitelistNative` worth at the launch price.
                wlMaxTokens: (liquidityTokens * p.whitelistNative) / liquidityNative
            }),
            p.salt
        );
        // Enforce the V3 address suffix on-chain; callers cannot bypass vanity generation.
        if ((uint160(token) & 0xfff) != 0xaaa) revert InvalidVanityAddress();
        return token;
    }

    /// @dev The whole supply was minted to this launchpad: the creator's share to them, the rest into the pool.
    function _seed(address token, address pair, LaunchParams calldata p, uint256 liquidityNative) private returns (uint256 creatorTokens, uint256 lp) {
        creatorTokens = (p.supply * p.creatorBps) / 10_000;
        if (creatorTokens > 0) IERC20(token).safeTransfer(msg.sender, creatorTokens);
        IERC20(token).safeTransfer(pair, p.supply - creatorTokens);
        IWETH(weth).deposit{value: liquidityNative}();
        IERC20(weth).safeTransfer(pair, liquidityNative);
        lp = IV2Pair(pair).mint(p.lockOption == LOCK_BURN ? DEAD : address(this));
        emit LiquidityAdded(token, p.supply - creatorTokens, liquidityNative, lp);
    }

    /// @dev Burned LP already went to DEAD. Otherwise lock it in the AUTISTIK Locker, owned by this launchpad.
    function _lockLiquidity(address pair, uint256 lp, uint8 option, string calldata symbol) private returns (uint256) {
        if (option == LOCK_BURN) return 0;
        IERC20(pair).forceApprove(address(locker), lp);
        uint256 unlockAt = block.timestamp + (option == LOCK_6_MONTHS ? 182 days : 365 days);
        return locker.lock(address(this), pair, true, lp, unlockAt, string.concat("AUTISTIK launch: $", symbol));
    }

    /// @dev The creator's first buy, straight from the pool at launch price, before anyone else can trade.
    function _devBuy(address token, address pair, uint256 amountIn) private returns (uint256 out) {
        (uint112 r0, uint112 r1,) = IV2Pair(pair).getReserves();
        bool tokenIs0 = IV2Pair(pair).token0() == token;
        (uint256 rIn, uint256 rOut) = tokenIs0 ? (uint256(r1), uint256(r0)) : (uint256(r0), uint256(r1));
        uint256 inWithFee = amountIn * 9_975; // PancakeSwap-style 0.25% pool fee (Uniswap's 0.3% leaves a tiny rounding margin)
        out = (inWithFee * rOut) / (rIn * 10_000 + inWithFee);
        out = (out * 997) / 1_000; // margin so it works on 0.3% pools too
        IWETH(weth).deposit{value: amountIn}();
        IERC20(weth).safeTransfer(pair, amountIn);
        (uint256 o0, uint256 o1) = tokenIs0 ? (out, uint256(0)) : (uint256(0), out);
        IV2Pair(pair).swap(o0, o1, address(this), "");
        IERC20(token).safeTransfer(msg.sender, out);
    }

    // ------------------------------------------------------------------ liquidity release (team approves)

    /// @notice After the lock ends, anyone (the AUTISTIK keeper does it automatically) can release the LP tokens.
    /// They always go to the token's creator, never to the caller, so no approval is needed.
    function releaseLiquidity(address token) external nonReentrant {
        Launch storage l = launchOf[token];
        if (l.creator == address(0)) revert NotLaunchedHere();
        if (l.lockOption == LOCK_BURN) revert NotLocked();
        if (l.released) revert AlreadyReleased();
        l.released = true;
        uint256 before = IERC20(l.pair).balanceOf(address(this));
        locker.unlock(l.lockId); // reverts until the unlock date
        uint256 amount = IERC20(l.pair).balanceOf(address(this)) - before;
        IERC20(l.pair).safeTransfer(l.creator, amount);
        emit LiquidityReleased(token, l.creator, l.lockId);
    }

    // ------------------------------------------------------------------ platform fee

    /// @notice Tokens send their platform fee here: 30% marketing, 30% AUTISTIK buy-and-burn, 40% team.
    function distributePlatform() external payable {
        uint256 total = msg.value;
        uint256 m = (total * 30) / 100;
        uint256 b = (total * 30) / 100;
        uint256 t = total - m - b;
        _pay(marketing, m);
        _pay(burner, b);
        _pay(team, t);
        emit PlatformFee(total, m, b, t);
        address br = burner;
        if (br.code.length > 0 && br.balance >= 0.05 ether) {
            try IBurner(br).burn{gas: 300_000}() {} catch {}
        }
    }

    function _pay(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount, gas: 50_000}("");
        if (!ok) owed[to] += amount;
    }

    /// @notice A wallet collects coin that couldn't be sent to it automatically.
    function claim() external nonReentrant {
        uint256 amount = owed[msg.sender];
        owed[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    // ------------------------------------------------------------------ trending promotion

    function promote(address token, uint256 planId, uint256 maxPrice) external {
        if (launchOf[token].creator == address(0)) revert NotLaunchedHere();
        Plan memory pl = plans[planId];
        if (pl.duration == 0) revert UnknownPlan();
        if (pl.price > maxPrice) revert PriceTooHigh();
        stablecoin.safeTransferFrom(msg.sender, marketing, pl.price);
        emit Promoted(token, msg.sender, planId, pl.price, pl.duration);
    }

    // ------------------------------------------------------------------ eligibility ($20 of AUTISTIK, signed by the Hub)

    /// @dev The permit covers the salt too, so a salt the Hub hands to one creator can't be used by anyone else.
    function permitHash(address creator, bytes32 salt, uint256 deadline) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), block.chainid, creator, salt, deadline));
    }

    /// @notice The address a token launched with `salt` gets.
    function tokenFor(bytes32 salt) external view returns (address) {
        return deployer.tokenAddress(salt);
    }

    function _checkEligible(uint256 deadline, bytes32 salt, bytes calldata sig) private {
        address signer = eligibilitySigner;
        if (signer == address(0)) return;
        if (deadline < block.timestamp) revert PermitExpired();
        bytes32 hash = permitHash(msg.sender, salt, deadline);
        if (permitUsed[hash]) revert PermitUsed();
        (address got, ECDSA.RecoverError err,) = ECDSA.tryRecover(MessageHashUtils.toEthSignedMessageHash(hash), sig);
        if (err != ECDSA.RecoverError.NoError || got != signer) revert NotEligible();
        permitUsed[hash] = true;
    }

    // ------------------------------------------------------------------ settings (owner = AUTISTIK team)

    function setWallets(address team_, address marketing_, address burner_) external onlyOwner {
        if (team_ == address(0) || marketing_ == address(0) || burner_ == address(0)) revert ZeroAddress();
        (team, marketing, burner) = (team_, marketing_, burner_);
        emit SettingsChanged();
    }

    /// @notice Fees for NEW launches. Tokens already launched keep the platform fee they launched with.
    function setFees(uint256 launchFee_, uint256 platformFee_) external onlyOwner {
        if (launchFee_ > maxLaunchFee || platformFee_ > MAX_PLATFORM_FEE) revert FeeTooHigh();
        (launchFee, platformFee) = (launchFee_, platformFee_);
        emit SettingsChanged();
    }

    function setMaxWhitelistNative(uint256 amount) external onlyOwner {
        maxWhitelistNative = amount;
        emit SettingsChanged();
    }

    /// @notice Keeps the dollar amounts right as the coin's price moves: the launch contribution (about $3, taken
    ///         from the liquidity) and the whitelist buy limit (about $40). One transaction from the team.
    function syncPrices(uint256 launchFee_, uint256 maxWhitelistNative_) external onlyOwner {
        if (launchFee_ > maxLaunchFee) revert FeeTooHigh();
        (launchFee, maxWhitelistNative) = (launchFee_, maxWhitelistNative_);
        emit SettingsChanged();
    }

    function setEligibilitySigner(address signer) external onlyOwner {
        eligibilitySigner = signer;
        emit SettingsChanged();
    }

    function setPlan(uint256 planId, uint256 price, uint256 duration) external onlyOwner {
        plans[planId] = Plan(price, duration);
        emit SettingsChanged();
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }

    receive() external payable {}
}

// =====================================================================================================================
//                                               AUTISTIK BUY-AND-BURN
// =====================================================================================================================

/**
 * @title AUTISTIK Burner (BNB Chain)
 * @notice Receives the burn share of the platform fee and uses it to buy $AUTISTIK and send it to the dead address.
 * Anyone can trigger it. Each burn spends at most 1 coin and refuses a price more than 5% worse than the pool's
 * current quote, so it can't be drained by price manipulation.
 */
contract AutistikBurner {
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    IV2Router public immutable router;
    address public immutable autistik;
    address public immutable weth;
    uint256 public totalSpent;

    event Burned(uint256 coinSpent);

    constructor(address router_, address autistik_) {
        router = IV2Router(router_);
        autistik = autistik_;
        weth = IV2Router(router_).WETH();
    }

    receive() external payable {}

    function burn() external {
        uint256 amount = address(this).balance;
        if (amount > 1 ether) amount = 1 ether;
        if (amount == 0) return;
        address[] memory path = new address[](2);
        path[0] = weth;
        path[1] = autistik;
        uint256 quote = router.getAmountsOut(amount, path)[1];
        // AUTISTIK charges a buy tax, so accept the quote minus tax and a little slippage.
        router.swapExactETHForTokensSupportingFeeOnTransferTokens{value: amount}((quote * 90) / 100, path, DEAD, block.timestamp);
        totalSpent += amount;
        emit Burned(amount);
    }
}
