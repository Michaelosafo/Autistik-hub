// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

interface IUniswapV2Router02 {
    function factory() external view returns (address);
    function WETH() external view returns (address);
}

interface IUniswapV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address);
    function createPair(address tokenA, address tokenB) external returns (address);
}

interface IUniswapV2Pair {
    function token0() external view returns (address);
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function mint(address to) external returns (uint256 liquidity);
}

interface IWETH {
    function deposit() external payable;
}

/// @notice The token every launch creates: fixed supply, 18 decimals, no owner, no mint, no tax, no blacklist.
contract AutistikLaunchToken is ERC20 {
    constructor(string memory name_, string memory symbol_, uint256 supply, address to) ERC20(name_, symbol_) {
        _mint(to, supply);
    }
}

/// @title AUTISTIK Launch Pad
/// @notice One transaction: create a token, give the creator their share, add the rest as liquidity on a
///         Uniswap V2 style DEX (PancakeSwap on BNB Chain, Uniswap on Ethereum, ...) and then either burn the
///         LP tokens (sent to the dead address, liquidity stays forever) or lock them in this contract for
///         6 months or 1 year. Only the creator can take locked LP back, and only after the lock ends.
///         The launchpad owner can never touch anyone's liquidity.
///         Launches can require proof that the creator holds at least $20 of AUTISTIK: the Hub's server checks
///         the creator's AUTISTIK balance on BNB Chain and signs a short-lived permit that this contract verifies.
///         Tokens launched here can also pay in a stablecoin (e.g. USDT) to be promoted as trending on the Hub.
///         Launch fees and promotion payments go straight to the treasury wallet.
///         Liquidity is added straight to the pair (not through the router), so nobody can block a launch by
///         creating the pair early or sending coins to it: anything sent there first only adds to the pool.
///         The creator sets the highest fee they accept and a deadline, so a fee change can't surprise them.
/// @dev Deploy one per chain with that chain's V2 router and stablecoin.
contract AutistikLaunchpad {
    using SafeERC20 for IERC20;

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 public constant MAX_CREATOR_BPS = 2000; // creator can keep at most 20% of supply
    uint256 public constant MIN_SUPPLY = 1_000 ether; // 1,000 tokens (18 decimals)
    uint256 public constant MAX_SUPPLY = 1_000_000_000_000_000 ether; // 1 quadrillion tokens
    uint8 public constant LOCK_BURN = 0; // LP tokens to the dead address, forever
    uint8 public constant LOCK_6_MONTHS = 1;
    uint8 public constant LOCK_1_YEAR = 2;
    uint256 public constant SIX_MONTHS = 182 days;
    uint256 public constant ONE_YEAR = 365 days;

    IUniswapV2Router02 public immutable router;
    IUniswapV2Factory public immutable factory;
    address public immutable weth;
    IERC20 public immutable stablecoin; // what promotions are paid in, e.g. USDT
    uint256 public immutable maxFee; // the owner can never set a launch fee above this
    uint256 public immutable minLiquidity; // smallest native-coin amount accepted for liquidity

    address public owner;
    address public pendingOwner; // must accept, so ownership can't be sent to a wrong address by mistake
    address payable public treasury;
    /// @notice Launch fees the treasury couldn't receive straight away; anyone can send them on with withdrawFees.
    uint256 public unsentFees;
    uint256 public launchFee;
    uint256 public launches;
    /// @notice Signs eligibility permits ($20+ of AUTISTIK held). Zero address = no holding check.
    address public eligibilitySigner;

    struct Lock {
        address pair;
        address creator;
        uint256 amount;
        uint256 unlockAt;
    }
    /// @notice Locked LP per launched token. amount is 0 once the creator has taken it back.
    mapping(address => Lock) public locks;

    struct Plan {
        uint256 price; // in stablecoin units
        uint256 duration; // seconds; 0 = plan switched off
    }
    mapping(uint256 => Plan) public plans;
    mapping(address => bool) public launchedHere;
    /// @notice Each eligibility permit works for one launch only.
    mapping(bytes32 => bool) public permitUsed;

    event Launched(
        address indexed token,
        address indexed pair,
        address indexed creator,
        uint256 supply,
        uint256 creatorTokens,
        uint256 liquidityTokens,
        uint256 liquidityNative,
        uint256 lp
    );
    event LiquidityLocked(address indexed token, address indexed pair, address indexed creator, uint256 amount, uint256 unlockAt);
    event LiquidityUnlocked(address indexed token, address indexed creator, uint256 amount);
    event EligibilitySignerChanged(address signer);
    event Promoted(address indexed token, address indexed payer, uint256 indexed planId, uint256 price, uint256 duration);
    event PlanChanged(uint256 indexed planId, uint256 price, uint256 duration);
    event FeeChanged(uint256 fee);
    event TreasuryChanged(address treasury);
    event OwnershipTransferred(address previousOwner, address newOwner);
    event OwnershipTransferStarted(address previousOwner, address newOwner);
    event FeePaid(address indexed creator, uint256 fee, bool sent);

    error InvalidName();
    error InvalidSymbol();
    error InvalidSupply();
    error CreatorShareTooHigh();
    error NotEnoughLiquidity();
    error NotOwner();
    error FeeTooHigh();
    error ZeroAddress();
    error FeeTransferFailed();
    error NotLaunchedHere();
    error UnknownPlan();
    error InvalidLock();
    error NotEligible();
    error PermitExpired();
    error NotCreator();
    error StillLocked();
    error NothingLocked();
    error PriceTooHigh();
    error TooLate();
    error PairNotEmpty();
    error PermitUsed();
    error NotPendingOwner();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @param stablecoin_ token promotions are paid in. Starts with $30 for 5 hours and $200 for 24 hours.
    constructor(
        address router_,
        address payable treasury_,
        uint256 launchFee_,
        uint256 maxFee_,
        uint256 minLiquidity_,
        address stablecoin_,
        address eligibilitySigner_
    ) {
        if (router_ == address(0) || treasury_ == address(0) || stablecoin_ == address(0)) revert ZeroAddress();
        if (launchFee_ > maxFee_) revert FeeTooHigh();
        router = IUniswapV2Router02(router_);
        factory = IUniswapV2Factory(IUniswapV2Router02(router_).factory());
        weth = IUniswapV2Router02(router_).WETH();
        if (address(factory) == address(0) || weth == address(0)) revert ZeroAddress();
        stablecoin = IERC20(stablecoin_);
        uint256 usd = 10 ** IERC20Metadata(stablecoin_).decimals();
        _setPlan(0, 30 * usd, 5 hours);
        _setPlan(1, 200 * usd, 1 days);
        treasury = treasury_;
        launchFee = launchFee_;
        maxFee = maxFee_;
        minLiquidity = minLiquidity_;
        eligibilitySigner = eligibilitySigner_;
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    struct LaunchParams {
        string name;
        string symbol;
        uint256 supply; // total supply in whole-token units times 1e18
        uint256 creatorBps; // share of supply sent to the creator, in basis points (100 = 1%)
        uint8 lockOption; // 0 = burn LP forever, 1 = lock 6 months, 2 = lock 1 year
        uint256 permitDeadline; // eligibility permit from the Hub (ignored when no signer is set)
        uint256 maxFeeAccepted; // the highest launch fee the creator agreed to; the launch fails if the fee is higher
        uint256 deadline; // the launch fails if it is mined after this time
    }

    /// @param permitSig the Hub's signature on the eligibility permit ("0x" when no signer is set)
    /// @dev msg.value = launchFee + native coin to pair with the tokens as liquidity.
    function launch(LaunchParams calldata p, bytes calldata permitSig)
        external
        payable
        returns (address token, address pair)
    {
        if (block.timestamp > p.deadline) revert TooLate();
        if (p.lockOption > LOCK_1_YEAR) revert InvalidLock();
        _checkEligible(p.permitDeadline, permitSig);
        uint256 nameLen = bytes(p.name).length;
        uint256 symbolLen = bytes(p.symbol).length;
        if (nameLen == 0 || nameLen > 32) revert InvalidName();
        if (symbolLen == 0 || symbolLen > 12) revert InvalidSymbol();
        if (p.supply < MIN_SUPPLY || p.supply > MAX_SUPPLY) revert InvalidSupply();
        if (p.creatorBps > MAX_CREATOR_BPS) revert CreatorShareTooHigh();
        uint256 fee = launchFee;
        if (fee > p.maxFeeAccepted) revert FeeTooHigh();
        if (msg.value < fee + minLiquidity || msg.value == fee) revert NotEnoughLiquidity();

        token = address(new AutistikLaunchToken(p.name, p.symbol, p.supply, address(this)));
        pair = _addLiquidity(token, p.supply, p.creatorBps, msg.value - fee, p.lockOption);

        if (fee > 0) {
            // A treasury that can't receive (e.g. a misconfigured wallet) must never block launches: keep the fee here.
            (bool ok,) = treasury.call{value: fee, gas: 50_000}("");
            if (!ok) unsentFees += fee;
            emit FeePaid(msg.sender, fee, ok);
        }
    }

    /// @notice Sends launch fees the treasury couldn't receive earlier. Only ever pays the treasury.
    function withdrawFees() external {
        uint256 amount = unsentFees;
        unsentFees = 0;
        (bool ok,) = treasury.call{value: amount}("");
        if (!ok) revert FeeTransferFailed();
    }

    /// @notice The message the Hub signs: this launchpad, this chain, the creator and the permit deadline.
    function permitHash(address creator, uint256 deadline) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), block.chainid, creator, deadline));
    }

    function _checkEligible(uint256 deadline, bytes calldata sig) private {
        address signer = eligibilitySigner;
        if (signer == address(0)) return;
        if (deadline < block.timestamp) revert PermitExpired();
        bytes32 hash = permitHash(msg.sender, deadline);
        if (permitUsed[hash]) revert PermitUsed();
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(hash);
        (address got, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, sig);
        if (err != ECDSA.RecoverError.NoError || got != signer) revert NotEligible();
        permitUsed[hash] = true;
    }

    function _addLiquidity(address token, uint256 supply, uint256 creatorBps, uint256 liquidityNative, uint8 lockOption)
        private
        returns (address pair)
    {
        uint256 creatorTokens = (supply * creatorBps) / 10_000;
        uint256 liquidityTokens = supply - creatorTokens;
        if (creatorTokens > 0) IERC20(token).safeTransfer(msg.sender, creatorTokens);

        // The pair may already exist: anyone can create it for a predictable address. That's harmless here because
        // the token didn't exist until now, so the pool can't hold any of it yet; coins someone sent to the pair only
        // add to the pool. The exact amounts go straight in and the pair mints the LP tokens.
        pair = factory.getPair(token, weth);
        if (pair == address(0)) pair = factory.createPair(token, weth);
        (uint112 r0, uint112 r1,) = IUniswapV2Pair(pair).getReserves();
        if ((IUniswapV2Pair(pair).token0() == token ? r0 : r1) != 0) revert PairNotEmpty();
        IERC20(token).safeTransfer(pair, liquidityTokens);
        IWETH(weth).deposit{value: liquidityNative}();
        IERC20(weth).safeTransfer(pair, liquidityNative);
        // Burn: LP tokens go straight to DEAD. Lock: LP tokens stay in this contract until the lock ends.
        address lpTo = lockOption == LOCK_BURN ? DEAD : address(this);
        uint256 lp = IUniswapV2Pair(pair).mint(lpTo);
        if (lockOption != LOCK_BURN) {
            uint256 unlockAt = block.timestamp + (lockOption == LOCK_6_MONTHS ? SIX_MONTHS : ONE_YEAR);
            locks[token] = Lock(pair, msg.sender, lp, unlockAt);
            emit LiquidityLocked(token, pair, msg.sender, lp, unlockAt);
        }
        launchedHere[token] = true;
        unchecked {
            launches++;
        }
        emit Launched(token, pair, msg.sender, supply, creatorTokens, liquidityTokens, liquidityNative, lp);
    }

    /// @notice After the lock ends, the creator takes their LP tokens back. Nobody else can, ever.
    function unlockLiquidity(address token) external {
        Lock memory l = locks[token];
        if (l.amount == 0) revert NothingLocked();
        if (msg.sender != l.creator) revert NotCreator();
        if (block.timestamp < l.unlockAt) revert StillLocked();
        locks[token].amount = 0;
        IERC20(l.pair).safeTransfer(l.creator, l.amount);
        emit LiquidityUnlocked(token, l.creator, l.amount);
    }

    /// @notice Pay to show a token from this launchpad as trending. Approve the stablecoin for the plan's price first.
    ///         Buying again while a promotion is running adds the time on top.
    /// @param maxPrice the most the payer agreed to pay; fails if the plan's price was raised in the meantime
    function promote(address token, uint256 planId, uint256 maxPrice) external {
        if (!launchedHere[token]) revert NotLaunchedHere();
        Plan memory p = plans[planId];
        if (p.duration == 0) revert UnknownPlan();
        if (p.price > maxPrice) revert PriceTooHigh();
        stablecoin.safeTransferFrom(msg.sender, treasury, p.price);
        emit Promoted(token, msg.sender, planId, p.price, p.duration);
    }

    /// @notice Add, change or (with duration 0) switch off a trending plan.
    function setPlan(uint256 planId, uint256 price, uint256 duration) external onlyOwner {
        _setPlan(planId, price, duration);
    }

    function _setPlan(uint256 planId, uint256 price, uint256 duration) private {
        plans[planId] = Plan(price, duration);
        emit PlanChanged(planId, price, duration);
    }

    function setLaunchFee(uint256 fee) external onlyOwner {
        if (fee > maxFee) revert FeeTooHigh();
        launchFee = fee;
        emit FeeChanged(fee);
    }

    /// @notice Set the Hub's eligibility signer, or the zero address to turn the AUTISTIK holding check off.
    function setEligibilitySigner(address signer) external onlyOwner {
        eligibilitySigner = signer;
        emit EligibilitySignerChanged(signer);
    }

    function setTreasury(address payable treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasuryChanged(treasury_);
    }

    /// @notice Step 1 of 2: propose a new owner (ideally a multisig). Nothing changes until they accept.
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    /// @notice Step 2 of 2: the proposed owner accepts.
    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        emit OwnershipTransferred(owner, msg.sender);
        owner = msg.sender;
        pendingOwner = address(0);
    }
}
