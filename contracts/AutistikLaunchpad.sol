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
    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity);
}

interface IUniswapV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address);
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
    IERC20 public immutable stablecoin; // what promotions are paid in, e.g. USDT
    uint256 public immutable maxFee; // the owner can never set a launch fee above this
    uint256 public immutable minLiquidity; // smallest native-coin amount accepted for liquidity

    address public owner;
    address payable public treasury;
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

    /// @param supply total supply in whole-token units times 1e18
    /// @param creatorBps share of supply sent to the creator, in basis points (100 = 1%)
    /// @param lockOption 0 = burn LP forever, 1 = lock 6 months, 2 = lock 1 year
    /// @param permitDeadline / permitSig eligibility permit from the Hub (ignored when no signer is set)
    /// @dev msg.value = launchFee + native coin to pair with the tokens as liquidity.
    function launch(
        string calldata name_,
        string calldata symbol_,
        uint256 supply,
        uint256 creatorBps,
        uint8 lockOption,
        uint256 permitDeadline,
        bytes calldata permitSig
    ) external payable returns (address token, address pair) {
        if (lockOption > LOCK_1_YEAR) revert InvalidLock();
        _checkEligible(permitDeadline, permitSig);
        uint256 nameLen = bytes(name_).length;
        uint256 symbolLen = bytes(symbol_).length;
        if (nameLen == 0 || nameLen > 32) revert InvalidName();
        if (symbolLen == 0 || symbolLen > 12) revert InvalidSymbol();
        if (supply < MIN_SUPPLY || supply > MAX_SUPPLY) revert InvalidSupply();
        if (creatorBps > MAX_CREATOR_BPS) revert CreatorShareTooHigh();
        uint256 fee = launchFee;
        if (msg.value < fee + minLiquidity || msg.value == fee) revert NotEnoughLiquidity();

        token = address(new AutistikLaunchToken(name_, symbol_, supply, address(this)));
        pair = _addLiquidity(token, supply, creatorBps, msg.value - fee, lockOption);

        if (fee > 0) {
            (bool ok,) = treasury.call{value: fee}("");
            if (!ok) revert FeeTransferFailed();
        }
    }

    /// @notice The message the Hub signs: this launchpad, this chain, the creator and the permit deadline.
    function permitHash(address creator, uint256 deadline) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), block.chainid, creator, deadline));
    }

    function _checkEligible(uint256 deadline, bytes calldata sig) private view {
        address signer = eligibilitySigner;
        if (signer == address(0)) return;
        if (deadline < block.timestamp) revert PermitExpired();
        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(permitHash(msg.sender, deadline));
        (address got, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, sig);
        if (err != ECDSA.RecoverError.NoError || got != signer) revert NotEligible();
    }

    function _addLiquidity(address token, uint256 supply, uint256 creatorBps, uint256 liquidityNative, uint8 lockOption)
        private
        returns (address pair)
    {
        uint256 creatorTokens = (supply * creatorBps) / 10_000;
        uint256 liquidityTokens = supply - creatorTokens;
        if (creatorTokens > 0) IERC20(token).transfer(msg.sender, creatorTokens);

        IERC20(token).approve(address(router), liquidityTokens);
        // Fresh token, so the pool is empty and the exact amounts are used.
        // Burn: LP tokens go straight to DEAD. Lock: LP tokens stay in this contract until the lock ends.
        address lpTo = lockOption == LOCK_BURN ? DEAD : address(this);
        (,, uint256 lp) = router.addLiquidityETH{value: liquidityNative}(
            token, liquidityTokens, liquidityTokens, liquidityNative, lpTo, block.timestamp
        );
        pair = IUniswapV2Factory(router.factory()).getPair(token, router.WETH());
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
    function promote(address token, uint256 planId) external {
        if (!launchedHere[token]) revert NotLaunchedHere();
        Plan memory p = plans[planId];
        if (p.duration == 0) revert UnknownPlan();
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

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
