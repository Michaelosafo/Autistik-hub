// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface INonfungiblePositionManagerV2 {
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

/// @dev v3 pool slot0. PancakeSwap's feeProtocol is a uint32 and Uniswap's a uint8; decoding as uint32 reads both.
interface IV3PoolV2 {
    function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16, uint16, uint16, uint32, bool);
}

/// @dev The original v3 SwapRouter (deadline in the params): PancakeSwap v3 and Uniswap v3 on Ethereum.
interface ISwapRouterV3V2 {
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

interface IWETHV2 {
    function withdraw(uint256) external;
}

/**
 * @title AUTISTIK Instant coin (v2): optional holder rewards
 * @notice A plain coin with a fixed supply: no tax, no owner, no mint, no blacklist, no pause. For the first 5 minutes
 * of trading, a single buy can take at most 1% of the supply and a wallet can hold at most 2% (stops sniper bots).
 * When its creator chose holder rewards, part of the creator's pool fees is paid in here as the reward (the chain's
 * coin or a token) and every holder earns it by how much they hold. Holders claim theirs any time. The pool, the dead
 * address and the launcher never earn. Rewards can only come in; nobody can take them out except the holders.
 */
contract AutistikInstantTokenV2 is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant SNIPE_WINDOW = 5 minutes;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    /// @dev Rewards in the chain's own coin.
    address public constant NATIVE = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    uint256 private constant MAGNITUDE = 2 ** 128;
    /// @dev Rewards wait until holders (not the pool) own at least 0.01% of the supply, so one dust holder can't
    /// break the reward maths for everyone.
    uint256 public constant MIN_ELIGIBLE_DIV = 10_000;

    address public immutable launcher;
    address public immutable rewardToken; // address(0): no holder rewards
    address public pool;
    uint256 public tradingStart;

    // Holder rewards (pull): magnified rewards per eligible coin, with a correction per wallet as balances move.
    uint256 public magnifiedPerShare;
    uint256 public eligibleSupply;
    uint256 public totalRewardsDistributed;
    mapping(address => int256) private corrections;
    mapping(address => uint256) public withdrawnRewards;
    mapping(address => bool) public excluded;

    event RewardsAdded(uint256 amount);
    event RewardClaimed(address indexed holder, uint256 amount);

    error SnipeLimit();
    error OnlyLauncher();
    error NoRewards();

    constructor(string memory name_, string memory symbol_, uint256 supply, address rewardToken_) ERC20(name_, symbol_) {
        launcher = msg.sender;
        rewardToken = rewardToken_;
        excluded[msg.sender] = true;
        excluded[DEAD] = true;
        excluded[address(this)] = true;
        _mint(msg.sender, supply);
    }

    /// @dev Called once by the launcher as soon as the pool exists (before anyone, even the creator, can buy).
    function setPool(address pool_) external {
        if (msg.sender != launcher || pool != address(0)) revert OnlyLauncher();
        pool = pool_;
        excluded[pool_] = true;
    }

    /// @dev Called once by the launcher right after the creator's first buy: the 5-minute anti-bot window starts.
    function start() external {
        if (msg.sender != launcher || tradingStart != 0) revert OnlyLauncher();
        tradingStart = block.timestamp;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (tradingStart != 0 && from == pool && block.timestamp < tradingStart + SNIPE_WINDOW) {
            uint256 s = totalSupply();
            if (value > s / 100 || balanceOf(to) + value > (s * 2) / 100) revert SnipeLimit();
        }
        super._update(from, to, value);
        if (rewardToken == address(0) || value == 0) return;
        bool fromIn = from != address(0) && !excluded[from];
        bool toIn = to != address(0) && !excluded[to];
        int256 m = int256(magnifiedPerShare * value);
        if (fromIn) corrections[from] += m;
        if (toIn) corrections[to] -= m;
        if (fromIn && !toIn) eligibleSupply -= value;
        else if (!fromIn && toIn) eligibleSupply += value;
    }

    /// @notice The launcher pays in holder rewards (the coin as msg.value, or a token already sent here).
    function addRewards(uint256 amount) external payable {
        if (msg.sender != launcher) revert OnlyLauncher();
        if (rewardToken == address(0)) revert NoRewards();
        if (rewardToken == NATIVE) amount = msg.value;
        if (amount == 0) return;
        if (!canReward()) revert NoRewards();
        magnifiedPerShare += (amount * MAGNITUDE) / eligibleSupply;
        totalRewardsDistributed += amount;
        emit RewardsAdded(amount);
    }

    function canReward() public view returns (bool) {
        return eligibleSupply >= totalSupply() / MIN_ELIGIBLE_DIV;
    }

    function accumulativeRewards(address a) public view returns (uint256) {
        if (excluded[a]) return 0;
        return uint256(int256(magnifiedPerShare * balanceOf(a)) + corrections[a]) / MAGNITUDE;
    }

    function withdrawableRewards(address a) public view returns (uint256) {
        return accumulativeRewards(a) - withdrawnRewards[a];
    }

    /// @notice A holder takes their rewards. Anyone can also trigger it for a holder (it always pays the holder).
    function claimFor(address holder) public nonReentrant returns (uint256 amount) {
        amount = withdrawableRewards(holder);
        if (amount == 0) return 0;
        withdrawnRewards[holder] += amount;
        if (rewardToken == NATIVE) {
            (bool ok,) = holder.call{value: amount}("");
            if (!ok) { withdrawnRewards[holder] -= amount; return 0; }
        } else {
            IERC20(rewardToken).safeTransfer(holder, amount);
        }
        emit RewardClaimed(holder, amount);
    }

    function claim() external returns (uint256) {
        return claimFor(msg.sender);
    }

    receive() external payable {
        if (msg.sender != launcher) revert OnlyLauncher();
    }
}

/**
 * @title AUTISTIK Instant Launch v2 (v3 pools: PancakeSwap on BNB Chain, Uniswap on Ethereum and Robinhood Chain)
 * @notice Launch a coin with no liquidity of your own and no bonding curve: it trades the moment it exists. The whole
 * supply goes into a one-sided v3 position starting at a small market cap; buyers bring the coin of the chain. The
 * position belongs to this contract forever: nobody can take the liquidity out, including the creator and the AUTISTIK
 * team. The pool's 1% trading fee is collected here and split between the creator and AUTISTIK.
 * New in v2: optional holder rewards. The creator picks a reward (the chain's coin or an approved token) and the share
 * of their part of the fees that goes to holders; both are fixed at launch.
 */
contract AutistikInstantLaunchV2 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint24 public constant FEE = 10_000; // 1% pool
    int24 public constant SPACING = 200;
    int24 public constant MAX_TICK_ALIGNED = 887_200;
    uint256 public constant SUPPLY = 1_000_000_000 ether;
    uint256 public constant MAX_CREATOR_BUY_BPS = 500; // the creator's first buy: at most 5% of the supply
    address public constant NATIVE = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    INonfungiblePositionManagerV2 public immutable positions;
    /// @dev The original v3 SwapRouter, or address(0) where there is none (then: no first buy, rewards only in the coin).
    ISwapRouterV3V2 public immutable router;
    address public immutable weth;

    address public owner;
    address public feeTo; // AUTISTIK's share of pool fees and the launch fee
    uint256 public launchFee; // in the chain's coin, can be 0
    uint256 public startFdv; // starting market cap in the chain's coin (whole supply)
    uint256 public creatorShareBps; // creator's share of pool fees for new launches
    address public eligibilitySigner; // the Hub's $20 AUTISTIK check (zero: off)
    uint256 public launches;

    /// @notice Tokens creators may pick as the holders' reward, with the v3 pool fee tier used to buy them with the coin.
    mapping(address => uint24) public rewardFee;

    struct Coin {
        address creator;
        address pool;
        uint256 positionId;
        uint16 creatorShareBps;
        uint16 holderBps; // share of the creator's part that goes to holders
        uint64 launchedAt;
    }
    mapping(address => Coin) public coinOf;
    mapping(bytes32 => bool) public permitUsed;
    mapping(address => uint256) public owed; // coin a wallet couldn't receive
    /// @notice Holders' part not yet turned into the reward token (a swap failed); retried on the next collection.
    mapping(address => uint256) public rewardPending;

    /// @dev Same as v1, so anything that reads v1 launches reads these too.
    event Launched(address indexed token, address indexed pool, address indexed creator, uint256 positionId, uint256 creatorTokens, string name, string symbol);
    event RewardsChosen(address indexed token, address rewardToken, uint256 holderBps);
    event FeesCollected(address indexed token, uint256 eth, uint256 tokens, uint256 toCreatorEth, uint256 toAutistikEth, uint256 toHoldersEth);
    event RewardsPaid(address indexed token, address rewardToken, uint256 spentEth, uint256 rewardAmount);
    event RewardTokenSet(address indexed token, uint24 fee);
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
    error RewardNotAllowed();
    error NoFirstBuyHere();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(
        address positions_, address router_, address owner_, address feeTo_, uint256 startFdv_, uint256 creatorShareBps_, address signer_,
        address[] memory rewardTokens_, uint24[] memory rewardFees_
    ) {
        if (owner_ == address(0) || feeTo_ == address(0) || startFdv_ == 0 || creatorShareBps_ > 10_000 || rewardTokens_.length != rewardFees_.length) revert BadSettings();
        positions = INonfungiblePositionManagerV2(positions_);
        router = ISwapRouterV3V2(router_);
        weth = INonfungiblePositionManagerV2(positions_).WETH9();
        owner = owner_;
        feeTo = feeTo_;
        startFdv = startFdv_;
        creatorShareBps = creatorShareBps_;
        eligibilitySigner = signer_;
        if (router_ != address(0)) {
            for (uint256 i; i < rewardTokens_.length; i++) {
                if (rewardTokens_[i] == address(0) || rewardTokens_[i] == NATIVE || rewardFees_[i] == 0) revert BadSettings();
                rewardFee[rewardTokens_[i]] = rewardFees_[i];
                emit RewardTokenSet(rewardTokens_[i], rewardFees_[i]);
            }
        }
    }

    receive() external payable {}

    // ------------------------------------------------------------------ launch

    /// @notice Launches a coin. msg.value = launch fee + (optional) the creator's first buy, made before anyone else.
    /// @param rewardToken address(0) for no holder rewards, NATIVE for the chain's coin, or an approved token.
    /// @param holderBps share (in basis points) of the creator's part of the pool fees that goes to holders.
    function launch(
        string calldata name, string calldata symbol, bytes32 salt, uint256 permitDeadline, bytes calldata permitSig, uint256 deadline,
        address rewardToken, uint256 holderBps
    ) external payable nonReentrant returns (address token) {
        if (block.timestamp > deadline) revert TooLate();
        if (bytes(name).length == 0 || bytes(name).length > 32 || bytes(symbol).length == 0 || bytes(symbol).length > 12) revert BadName();
        if (msg.value < launchFee) revert FeeTooLow();
        if (rewardToken == address(0)) {
            if (holderBps != 0) revert BadSettings();
        } else {
            if (holderBps == 0 || holderBps > 10_000) revert BadSettings();
            if (rewardToken != NATIVE && rewardFee[rewardToken] == 0) revert RewardNotAllowed();
        }
        _checkEligible(permitDeadline, salt, permitSig);
        token = _launch(name, symbol, salt, rewardToken, holderBps);
    }

    function _launch(string calldata name, string calldata symbol, bytes32 salt, address rewardToken, uint256 holderBps) private returns (address token) {
        token = address(new AutistikInstantTokenV2{salt: keccak256(abi.encode(msg.sender, salt))}(name, symbol, SUPPLY, rewardToken));
        _setup(token, holderBps);
        uint256 got = _firstBuy(token, msg.value - launchFee);
        AutistikInstantTokenV2(payable(token)).start();
        if (launchFee > 0) _pay(feeTo, launchFee);
        Coin storage c = coinOf[token];
        emit Launched(token, c.pool, msg.sender, c.positionId, got, name, symbol);
        if (rewardToken != address(0)) emit RewardsChosen(token, rewardToken, holderBps);
    }

    /// @dev The pool and the position, then the pool is shut out of holder rewards before anyone can buy.
    function _setup(address token, uint256 holderBps) private {
        (address pool, uint256 positionId) = _seed(token);
        AutistikInstantTokenV2(payable(token)).setPool(pool);
        coinOf[token] = Coin(msg.sender, pool, positionId, uint16(creatorShareBps), uint16(holderBps), uint64(block.timestamp));
        unchecked { launches++; }
    }

    /// @dev The creator's first buy, straight from the pool before trading opens for everyone else (at most 5%).
    function _firstBuy(address token, uint256 buy) private returns (uint256 got) {
        if (buy == 0) return 0;
        if (address(router) == address(0)) revert NoFirstBuyHere();
        got = router.exactInputSingle{value: buy}(ISwapRouterV3V2.ExactInputSingleParams(weth, token, FEE, msg.sender, block.timestamp, buy, 0, 0));
        if (got > (SUPPLY * MAX_CREATOR_BUY_BPS) / 10_000) revert CreatorBuyTooBig();
    }

    /// @dev Creates the pool at the starting price and puts the whole supply in one side of it, past the price.
    function _seed(address token) private returns (address pool, uint256 positionId) {
        bool tokenIs0 = token < weth;
        (address t0, address t1) = tokenIs0 ? (token, weth) : (weth, token);
        // v3 price = token1 per token0. Coin price in the chain's coin = startFdv / SUPPLY.
        uint256 ratioX192 = tokenIs0 ? Math.mulDiv(startFdv, 1 << 192, SUPPLY) : Math.mulDiv(SUPPLY, 1 << 192, startFdv);
        uint160 sqrtPrice = uint160(Math.sqrt(ratioX192));
        pool = positions.createAndInitializePoolIfNecessary(t0, t1, FEE, sqrtPrice);
        (uint160 nowPrice, int24 tick,,,,,) = IV3PoolV2(pool).slot0();
        // Someone could create this pool early at a silly price to buy the supply cheap: refuse (pick a new salt).
        if (nowPrice != sqrtPrice) revert PoolTaken();
        int24 lower;
        int24 upper;
        if (tokenIs0) {
            lower = _floor(tick) + SPACING;
            upper = MAX_TICK_ALIGNED;
        } else {
            lower = -MAX_TICK_ALIGNED;
            upper = _floor(tick);
        }
        IERC20(token).forceApprove(address(positions), SUPPLY);
        (positionId,,,) = positions.mint(INonfungiblePositionManagerV2.MintParams(
            t0, t1, FEE, lower, upper, tokenIs0 ? SUPPLY : 0, tokenIs0 ? 0 : SUPPLY, 0, 0, address(this), block.timestamp
        ));
        uint256 left = IERC20(token).balanceOf(address(this));
        if (left > 0) IERC20(token).safeTransfer(DEAD, left);
    }

    function _floor(int24 tick) private pure returns (int24) {
        int24 q = tick / SPACING;
        if (tick < 0 && tick % SPACING != 0) q -= 1;
        return q * SPACING;
    }

    // ------------------------------------------------------------------ pool fees and holder rewards

    /// @notice Collects a coin's pool fees and pays them out: creator, holders (if chosen) and AUTISTIK. Anyone can call.
    function collectFees(address token) external nonReentrant {
        Coin memory c = coinOf[token];
        if (c.creator == address(0)) revert NotLaunchedHere();
        (uint256 a0, uint256 a1) = positions.collect(INonfungiblePositionManagerV2.CollectParams(c.positionId, address(this), type(uint128).max, type(uint128).max));
        (uint256 eth, uint256 coins) = token < weth ? (a1, a0) : (a0, a1);
        uint256 creatorPart;
        uint256 holdersPart;
        if (eth > 0) {
            IWETHV2(weth).withdraw(eth);
            creatorPart = (eth * c.creatorShareBps) / 10_000;
            holdersPart = (creatorPart * c.holderBps) / 10_000;
            _pay(c.creator, creatorPart - holdersPart);
            _pay(feeTo, eth - creatorPart);
        }
        if (c.holderBps > 0) _payHolders(token, holdersPart);
        if (coins > 0) {
            uint256 tc = (coins * c.creatorShareBps) / 10_000;
            if (tc > 0) IERC20(token).safeTransfer(c.creator, tc);
            if (coins - tc > 0) IERC20(token).safeTransfer(feeTo, coins - tc);
        }
        emit FeesCollected(token, eth, coins, creatorPart - holdersPart, eth - creatorPart, holdersPart);
    }

    /// @dev Turns the holders' part (plus anything pending) into the reward and pays it into the coin for its holders.
    function _payHolders(address token, uint256 amount) private {
        uint256 total = amount + rewardPending[token];
        if (total == 0) return;
        AutistikInstantTokenV2 coin = AutistikInstantTokenV2(payable(token));
        address reward = coin.rewardToken();
        if (!coin.canReward()) { rewardPending[token] = total; return; }
        if (reward == NATIVE) {
            rewardPending[token] = 0;
            coin.addRewards{value: total}(total);
            emit RewardsPaid(token, reward, total, total);
            return;
        }
        uint256 before = IERC20(reward).balanceOf(token);
        try router.exactInputSingle{value: total}(ISwapRouterV3V2.ExactInputSingleParams(weth, reward, rewardFee[reward], token, block.timestamp, total, 0, 0)) {
            uint256 got = IERC20(reward).balanceOf(token) - before;
            rewardPending[token] = 0;
            coin.addRewards(got);
            emit RewardsPaid(token, reward, total, got);
        } catch {
            // No route right now: keep it and try again on the next collection.
            rewardPending[token] = total;
        }
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

    /// @notice The address a launch will get (creator + salt + name + symbol + reward choice).
    function tokenFor(address creator, bytes32 salt, string calldata name, string calldata symbol, address rewardToken) external view returns (address) {
        bytes32 h = keccak256(abi.encodePacked(
            bytes1(0xff), address(this), keccak256(abi.encode(creator, salt)),
            keccak256(abi.encodePacked(type(AutistikInstantTokenV2).creationCode, abi.encode(name, symbol, SUPPLY, rewardToken)))
        ));
        return address(uint160(uint256(h)));
    }

    // ------------------------------------------------------------------ eligibility ($20 of AUTISTIK, signed by the Hub)

    function permitHash(address creator, bytes32 salt, uint256 deadline) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), block.chainid, creator, salt, deadline));
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

    /// @notice Approves (fee > 0) or removes (fee 0) a token as a holders' reward for new launches. Coins already
    /// launched keep the reward they chose.
    function setRewardToken(address token, uint24 fee) external onlyOwner {
        if (token == address(0) || token == NATIVE || address(router) == address(0)) revert BadSettings();
        rewardFee[token] = fee;
        emit RewardTokenSet(token, fee);
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
