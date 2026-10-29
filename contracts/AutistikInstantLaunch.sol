// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface INonfungiblePositionManager {
    struct MintParams {
        address token0;
        address token1;
        uint24 fee;
        int24 tickLower;
        int24 tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }
    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }
    function createAndInitializePoolIfNecessary(address token0, address token1, uint24 fee, uint160 sqrtPriceX96) external payable returns (address pool);
    function mint(MintParams calldata params) external payable returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
    function collect(CollectParams calldata params) external payable returns (uint256 amount0, uint256 amount1);
    function WETH9() external view returns (address);
}

/// @dev PancakeSwap v3 pool (its feeProtocol is a uint32, unlike Uniswap's uint8).
interface IV3Pool {
    function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint32, bool);
}

interface ISwapRouterV3 {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

interface IWBNB {
    function withdraw(uint256) external;
}

/**
 * @title AUTISTIK Instant coin
 * @notice A plain coin with a fixed supply: no tax, no owner, no mint, no blacklist, no pause. For the first 5 minutes
 * of trading, a single buy can take at most 1% of the supply and a wallet can hold at most 2% (stops sniper bots).
 */
contract AutistikInstantToken is ERC20 {
    uint256 public constant SNIPE_WINDOW = 5 minutes;
    address public immutable launcher;
    address public pool;
    uint256 public tradingStart;

    error SnipeLimit();
    error OnlyLauncher();

    constructor(string memory name_, string memory symbol_, uint256 supply) ERC20(name_, symbol_) {
        launcher = msg.sender;
        _mint(msg.sender, supply);
    }

    /// @dev Called once by the launcher right after the pool exists and the creator's first buy is done.
    function start(address pool_) external {
        if (msg.sender != launcher || tradingStart != 0) revert OnlyLauncher();
        pool = pool_;
        tradingStart = block.timestamp;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (tradingStart != 0 && from == pool && block.timestamp < tradingStart + SNIPE_WINDOW) {
            uint256 s = totalSupply();
            if (value > s / 100 || balanceOf(to) + value > (s * 2) / 100) revert SnipeLimit();
        }
        super._update(from, to, value);
    }
}

/**
 * @title AUTISTIK Instant Launch (BNB Chain, PancakeSwap v3)
 * @notice Launch a coin with no liquidity of your own and no bonding curve: it trades on PancakeSwap the moment it
 * exists. The whole supply goes into a one-sided PancakeSwap v3 position starting at a small market cap; buyers bring
 * the BNB. The position belongs to this contract forever: nobody can take the liquidity out, including the creator and
 * the AUTISTIK team. The pool's 1% trading fee is collected here and split between the creator and AUTISTIK.
 */
contract AutistikInstantLaunch is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint24 public constant FEE = 10_000; // 1% pool
    int24 public constant SPACING = 200;
    int24 public constant MAX_TICK_ALIGNED = 887_200;
    uint256 public constant SUPPLY = 1_000_000_000 ether;
    uint256 public constant MAX_CREATOR_BUY_BPS = 500; // the creator's first buy: at most 5% of the supply

    INonfungiblePositionManager public immutable positions;
    ISwapRouterV3 public immutable router;
    address public immutable wbnb;

    address public owner;
    address public feeTo; // AUTISTIK's share of pool fees and the launch fee
    uint256 public launchFee; // in BNB, can be 0
    uint256 public startFdv; // starting market cap in BNB (whole supply)
    uint256 public creatorShareBps; // creator's share of pool fees for new launches
    address public eligibilitySigner; // the Hub's $20 AUTISTIK check (zero: off)
    uint256 public launches;

    struct Coin {
        address creator;
        address pool;
        uint256 positionId;
        uint16 creatorShareBps;
        uint64 launchedAt;
    }
    mapping(address => Coin) public coinOf;
    mapping(bytes32 => bool) public permitUsed;
    mapping(address => uint256) public owed; // BNB a wallet couldn't receive

    event Launched(address indexed token, address indexed pool, address indexed creator, uint256 positionId, uint256 creatorTokens, string name, string symbol);
    event FeesCollected(address indexed token, uint256 bnb, uint256 tokens, uint256 toCreatorBnb, uint256 toAutistikBnb);
    event SettingsChanged();

    error NotOwner();
    error BadName();
    error TooLate();
    error NotEligible();
    error PermitUsed();
    error FeeTooLow();
    error BadSettings();
    error NotLaunchedHere();
    error CreatorBuyTooBig();
    error PoolTaken();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address positions_, address router_, address owner_, address feeTo_, uint256 startFdv_, uint256 creatorShareBps_, address signer_) {
        if (owner_ == address(0) || feeTo_ == address(0) || startFdv_ == 0 || creatorShareBps_ > 10_000) revert BadSettings();
        positions = INonfungiblePositionManager(positions_);
        router = ISwapRouterV3(router_);
        wbnb = INonfungiblePositionManager(positions_).WETH9();
        owner = owner_;
        feeTo = feeTo_;
        startFdv = startFdv_;
        creatorShareBps = creatorShareBps_;
        eligibilitySigner = signer_;
    }

    receive() external payable {}

    // ------------------------------------------------------------------ launch

    /// @notice Launches a coin. msg.value = launch fee + (optional) the creator's first buy, made before anyone else.
    function launch(string calldata name, string calldata symbol, bytes32 salt, uint256 permitDeadline, bytes calldata permitSig, uint256 deadline)
        external payable nonReentrant returns (address token)
    {
        if (block.timestamp > deadline) revert TooLate();
        if (bytes(name).length == 0 || bytes(name).length > 32 || bytes(symbol).length == 0 || bytes(symbol).length > 12) revert BadName();
        if (msg.value < launchFee) revert FeeTooLow();
        _checkEligible(permitDeadline, salt, permitSig);

        token = _launch(name, symbol, salt);
    }

    function _launch(string calldata name, string calldata symbol, bytes32 salt) private returns (address token) {
        token = address(new AutistikInstantToken{salt: keccak256(abi.encode(msg.sender, salt))}(name, symbol, SUPPLY));
        (address pool, uint256 positionId) = _seed(token);
        coinOf[token] = Coin(msg.sender, pool, positionId, uint16(creatorShareBps), uint64(block.timestamp));
        unchecked { launches++; }
        uint256 got = _firstBuy(token, msg.value - launchFee);
        AutistikInstantToken(token).start(pool);
        if (launchFee > 0) _pay(feeTo, launchFee);
        emit Launched(token, pool, msg.sender, positionId, got, name, symbol);
    }

    /// @dev The creator's first buy, straight from the pool before trading opens for everyone else (at most 5%).
    function _firstBuy(address token, uint256 buy) private returns (uint256 got) {
        if (buy == 0) return 0;
        got = router.exactInputSingle{value: buy}(ISwapRouterV3.ExactInputSingleParams(wbnb, token, FEE, msg.sender, block.timestamp, buy, 0, 0));
        if (got > (SUPPLY * MAX_CREATOR_BUY_BPS) / 10_000) revert CreatorBuyTooBig();
    }

    /// @dev Creates the pool at the starting price and puts the whole supply in one side of it, above the price.
    function _seed(address token) private returns (address pool, uint256 positionId) {
        bool tokenIs0 = token < wbnb;
        (address t0, address t1) = tokenIs0 ? (token, wbnb) : (wbnb, token);
        // v3 price = token1 per token0. Coin price in BNB = startFdv / SUPPLY.
        uint256 ratioX192 = tokenIs0 ? Math.mulDiv(startFdv, 1 << 192, SUPPLY) : Math.mulDiv(SUPPLY, 1 << 192, startFdv);
        uint160 sqrtPrice = uint160(Math.sqrt(ratioX192));
        pool = positions.createAndInitializePoolIfNecessary(t0, t1, FEE, sqrtPrice);
        (uint160 nowPrice, int24 tick,,,,,) = IV3Pool(pool).slot0();
        // Someone could create this pool early at a silly price to buy the supply cheap: refuse (pick a new salt).
        if (nowPrice != sqrtPrice) revert PoolTaken();
        int24 lower;
        int24 upper;
        if (tokenIs0) {
            // Coin is token0: the position sits above the price, so it holds only the coin.
            lower = _floor(tick) + SPACING;
            upper = MAX_TICK_ALIGNED;
        } else {
            // Coin is token1: the position sits below the price, so it holds only the coin.
            lower = -MAX_TICK_ALIGNED;
            upper = _floor(tick);
        }
        IERC20(token).forceApprove(address(positions), SUPPLY);
        (positionId,,,) = positions.mint(INonfungiblePositionManager.MintParams(
            t0, t1, FEE, lower, upper, tokenIs0 ? SUPPLY : 0, tokenIs0 ? 0 : SUPPLY, 0, 0, address(this), block.timestamp
        ));
        // Any rounding dust goes to the dead address, so the contract never holds coins of its own.
        uint256 left = IERC20(token).balanceOf(address(this));
        if (left > 0) IERC20(token).safeTransfer(0x000000000000000000000000000000000000dEaD, left);
    }

    function _floor(int24 tick) private pure returns (int24) {
        int24 q = tick / SPACING;
        if (tick < 0 && tick % SPACING != 0) q -= 1;
        return q * SPACING;
    }

    // ------------------------------------------------------------------ pool fees

    /// @notice Collects a coin's pool fees and pays them out: the creator's share and AUTISTIK's share. Anyone can call.
    function collectFees(address token) external nonReentrant {
        Coin memory c = coinOf[token];
        if (c.creator == address(0)) revert NotLaunchedHere();
        (uint256 a0, uint256 a1) = positions.collect(INonfungiblePositionManager.CollectParams(c.positionId, address(this), type(uint128).max, type(uint128).max));
        (uint256 bnb, uint256 coins) = token < wbnb ? (a1, a0) : (a0, a1);
        uint256 toCreator;
        if (bnb > 0) {
            IWBNB(wbnb).withdraw(bnb);
            toCreator = (bnb * c.creatorShareBps) / 10_000;
            _pay(c.creator, toCreator);
            _pay(feeTo, bnb - toCreator);
        }
        if (coins > 0) {
            uint256 tc = (coins * c.creatorShareBps) / 10_000;
            if (tc > 0) IERC20(token).safeTransfer(c.creator, tc);
            if (coins - tc > 0) IERC20(token).safeTransfer(feeTo, coins - tc);
        }
        emit FeesCollected(token, bnb, coins, toCreator, bnb - toCreator);
    }

    function _pay(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount, gas: 50_000}("");
        if (!ok) owed[to] += amount;
    }

    function claim() external nonReentrant {
        uint256 a = owed[msg.sender];
        owed[msg.sender] = 0;
        (bool ok,) = msg.sender.call{value: a}("");
        require(ok, "transfer failed");
    }

    /// @dev Required to receive the position NFT from the position manager.
    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    // ------------------------------------------------------------------ eligibility ($20 of AUTISTIK, signed by the Hub)

    function permitHash(address creator, bytes32 salt, uint256 deadline) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), block.chainid, creator, salt, deadline));
    }

    function tokenFor(address creator, bytes32 salt, string calldata name, string calldata symbol) external view returns (address) {
        bytes32 h = keccak256(abi.encodePacked(bytes1(0xff), address(this), keccak256(abi.encode(creator, salt)),
            keccak256(abi.encodePacked(type(AutistikInstantToken).creationCode, abi.encode(name, symbol, SUPPLY)))));
        return address(uint160(uint256(h)));
    }

    function _checkEligible(uint256 deadline, bytes32 salt, bytes calldata sig) private {
        address signer = eligibilitySigner;
        if (signer == address(0)) return;
        if (deadline < block.timestamp) revert TooLate();
        bytes32 hash = permitHash(msg.sender, salt, deadline);
        if (permitUsed[hash]) revert PermitUsed();
        (address got, ECDSA.RecoverError err,) = ECDSA.tryRecover(MessageHashUtils.toEthSignedMessageHash(hash), sig);
        if (err != ECDSA.RecoverError.NoError || got != signer) revert NotEligible();
        permitUsed[hash] = true;
    }

    // ------------------------------------------------------------------ settings (new launches only)

    function setSettings(address feeTo_, uint256 launchFee_, uint256 startFdv_, uint256 creatorShareBps_) external onlyOwner {
        if (feeTo_ == address(0) || startFdv_ == 0 || launchFee_ > 1 ether || creatorShareBps_ > 10_000) revert BadSettings();
        (feeTo, launchFee, startFdv, creatorShareBps) = (feeTo_, launchFee_, startFdv_, creatorShareBps_);
        emit SettingsChanged();
    }

    function setEligibilitySigner(address s) external onlyOwner {
        eligibilitySigner = s;
        emit SettingsChanged();
    }

    function transferOwnership(address o) external onlyOwner {
        if (o == address(0)) revert BadSettings();
        owner = o;
    }
}
