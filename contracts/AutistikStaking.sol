// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * AUTISTIK Staking: stake a token, earn rewards. One contract holds every pool.
 *
 * - The AUTISTIK pool: stake $AUTISTIK, earn BNB. The team adds a share of the platform's trading fees as rewards.
 * - Anyone (a token's dev team) can open a pool for their own token: members stake it and earn the rewards the team
 *   adds (their own token, BNB or any other token).
 *
 * Rewards added to a pool are paid out evenly over the pool's reward period (e.g. 7 days), split by how much each
 * member has staked at each moment. Adding more rewards starts a new period with the leftovers rolled in. While
 * nobody is staked the clock pauses, so no rewards are lost.
 *
 * Safety:
 * - Staked tokens can only ever go back to the member who staked them. Nobody else can move them: not the pool's
 *   creator, not the contract owner.
 * - A pool's lock (0 to 365 days) is fixed when the pool is made; each new stake restarts that member's lock.
 * - Withdrawing never depends on rewards: if a reward token breaks, members still get their stake back.
 * - Only the pool's creator, and the funders they pick, can add rewards (so nobody can stretch a pool's reward
 *   period with dust).
 * - The owner can only change the pool-creation fee (max 1 BNB) and where it goes.
 * - Amounts are measured by what actually arrives, so tokens with a transfer tax work.
 */
contract AutistikStaking is ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev How pools write "the chain's own coin" (BNB, ETH) as the reward token.
    address public constant NATIVE = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    uint256 public constant MAX_LOCK = 365 days;
    uint256 public constant MIN_DURATION = 1 days;
    uint256 public constant MAX_DURATION = 365 days;
    uint256 public constant MAX_CREATE_FEE = 1 ether;
    uint256 private constant PRECISION = 1e30;

    struct Pool {
        address stakeToken;
        address rewardToken;
        address creator;
        uint64 lockSecs;
        uint64 duration;
        uint64 periodFinish;
        uint64 lastUpdate;
        uint256 rewardRate; // reward units per second, times PRECISION
        uint256 rewardPerToken; // times PRECISION
        uint256 totalStaked;
    }

    struct Stake {
        uint256 amount;
        uint256 paid; // rewardPerToken already counted for this member
        uint256 earned;
        uint64 unlockAt;
    }

    Pool[] public pools;
    mapping(uint256 => mapping(address => Stake)) public stakes;
    mapping(uint256 => mapping(address => bool)) public funders;

    address public owner;
    address public feeReceiver;
    uint256 public createFee;

    event PoolCreated(uint256 indexed id, address indexed stakeToken, address indexed rewardToken, address creator, uint256 lockSecs, uint256 duration);
    event RewardAdded(uint256 indexed id, address indexed from, uint256 amount, uint256 periodFinish);
    event Staked(uint256 indexed id, address indexed user, uint256 amount, uint256 unlockAt);
    event Withdrawn(uint256 indexed id, address indexed user, uint256 amount);
    event Claimed(uint256 indexed id, address indexed user, uint256 amount);
    event FunderSet(uint256 indexed id, address indexed funder, bool allowed);
    event CreateFeeSet(uint256 fee, address receiver);
    event OwnerChanged(address owner);

    error NotOwner();
    error NotAllowed();
    error BadPool();
    error BadToken();
    error BadSettings();
    error BadFee();
    error ZeroAmount();
    error Locked(uint256 unlockAt);
    error TooMuch();
    error PayFailed();

    constructor(address owner_, address feeReceiver_, uint256 createFee_) {
        if (owner_ == address(0) || feeReceiver_ == address(0) || createFee_ > MAX_CREATE_FEE) revert BadSettings();
        owner = owner_;
        feeReceiver = feeReceiver_;
        createFee = createFee_;
    }

    // ---------------------------------------------------------------- pools

    /// Open a pool. `rewardToken` can be NATIVE (BNB). Costs `createFee` in BNB (0 unless the owner sets one).
    function createPool(address stakeToken, address rewardToken, uint256 lockSecs, uint256 duration) external payable nonReentrant returns (uint256 id) {
        if (stakeToken == NATIVE || stakeToken.code.length == 0) revert BadToken();
        if (rewardToken != NATIVE && rewardToken.code.length == 0) revert BadToken();
        if (lockSecs > MAX_LOCK || duration < MIN_DURATION || duration > MAX_DURATION) revert BadSettings();
        if (msg.value != createFee) revert BadFee();
        id = pools.length;
        pools.push(Pool({
            stakeToken: stakeToken, rewardToken: rewardToken, creator: msg.sender, lockSecs: uint64(lockSecs), duration: uint64(duration),
            periodFinish: 0, lastUpdate: uint64(block.timestamp), rewardRate: 0, rewardPerToken: 0, totalStaked: 0
        }));
        emit PoolCreated(id, stakeToken, rewardToken, msg.sender, lockSecs, duration);
        if (msg.value > 0) _pay(NATIVE, feeReceiver, msg.value);
    }

    /// The pool's creator can let other wallets add rewards (e.g. the wallet that collects trading fees).
    function setFunder(uint256 id, address funder, bool allowed) external {
        if (msg.sender != _pool(id).creator) revert NotAllowed();
        funders[id][funder] = allowed;
        emit FunderSet(id, funder, allowed);
    }

    /// Add rewards: paid out evenly over the pool's reward period, starting now (leftovers roll in).
    function addRewards(uint256 id, uint256 amount) external payable nonReentrant {
        Pool storage p = _pool(id);
        if (msg.sender != p.creator && !funders[id][msg.sender]) revert NotAllowed();
        uint256 got;
        if (p.rewardToken == NATIVE) {
            got = msg.value;
        } else {
            if (msg.value != 0) revert BadToken();
            got = _pull(p.rewardToken, amount);
        }
        if (got == 0) revert ZeroAmount();
        _update(id, address(0));
        uint256 leftover = p.periodFinish > block.timestamp ? (p.periodFinish - block.timestamp) * p.rewardRate : 0;
        p.rewardRate = (got * PRECISION + leftover) / p.duration;
        p.lastUpdate = uint64(block.timestamp);
        p.periodFinish = uint64(block.timestamp + p.duration);
        emit RewardAdded(id, msg.sender, got, p.periodFinish);
    }

    // ---------------------------------------------------------------- members

    function stake(uint256 id, uint256 amount) external nonReentrant {
        Pool storage p = _pool(id);
        _update(id, msg.sender);
        uint256 got = _pull(p.stakeToken, amount);
        if (got == 0) revert ZeroAmount();
        Stake storage s = stakes[id][msg.sender];
        s.amount += got;
        p.totalStaked += got;
        s.unlockAt = uint64(block.timestamp + p.lockSecs);
        emit Staked(id, msg.sender, got, s.unlockAt);
    }

    function withdraw(uint256 id, uint256 amount) public nonReentrant {
        _withdraw(id, amount);
    }

    function claim(uint256 id) public nonReentrant {
        _claim(id);
    }

    /// Withdraw everything and collect rewards in one go.
    function exit(uint256 id) external nonReentrant {
        _withdraw(id, stakes[id][msg.sender].amount);
        _claim(id);
    }

    // ---------------------------------------------------------------- owner

    function setCreateFee(uint256 fee, address receiver) external {
        if (msg.sender != owner) revert NotOwner();
        if (fee > MAX_CREATE_FEE || receiver == address(0)) revert BadSettings();
        createFee = fee;
        feeReceiver = receiver;
        emit CreateFeeSet(fee, receiver);
    }

    function setOwner(address owner_) external {
        if (msg.sender != owner) revert NotOwner();
        if (owner_ == address(0)) revert BadSettings();
        owner = owner_;
        emit OwnerChanged(owner_);
    }

    // ---------------------------------------------------------------- views

    function poolCount() external view returns (uint256) {
        return pools.length;
    }

    /// Rewards `user` can collect from pool `id` right now.
    function earned(uint256 id, address user) public view returns (uint256) {
        Stake storage s = stakes[id][user];
        return s.earned + (s.amount * (_rewardPerToken(_pool(id)) - s.paid)) / PRECISION;
    }

    /// Rewards still to be paid out in the current period (in reward-token units).
    function rewardsLeft(uint256 id) external view returns (uint256) {
        Pool storage p = _pool(id);
        // While nobody is staked the clock is paused at lastUpdate.
        uint256 from = p.totalStaked == 0 ? p.lastUpdate : block.timestamp;
        return p.periodFinish > from ? ((p.periodFinish - from) * p.rewardRate) / PRECISION : 0;
    }

    // ---------------------------------------------------------------- internals

    function _pool(uint256 id) internal view returns (Pool storage) {
        if (id >= pools.length) revert BadPool();
        return pools[id];
    }

    function _rewardPerToken(Pool storage p) internal view returns (uint256) {
        if (p.totalStaked == 0) return p.rewardPerToken;
        uint256 t = block.timestamp < p.periodFinish ? block.timestamp : p.periodFinish;
        if (t <= p.lastUpdate) return p.rewardPerToken;
        return p.rewardPerToken + ((t - p.lastUpdate) * p.rewardRate) / p.totalStaked;
    }

    function _update(uint256 id, address user) internal {
        Pool storage p = pools[id];
        if (p.totalStaked == 0) {
            // Nobody staked: pause the clock so the remaining rewards wait for the next staker.
            if (p.periodFinish > p.lastUpdate) p.periodFinish = uint64(block.timestamp + (p.periodFinish - p.lastUpdate));
        } else {
            p.rewardPerToken = _rewardPerToken(p);
        }
        p.lastUpdate = uint64(block.timestamp);
        if (user != address(0)) {
            Stake storage s = stakes[id][user];
            s.earned += (s.amount * (p.rewardPerToken - s.paid)) / PRECISION;
            s.paid = p.rewardPerToken;
        }
    }

    function _withdraw(uint256 id, uint256 amount) internal {
        Pool storage p = _pool(id);
        Stake storage s = stakes[id][msg.sender];
        if (amount == 0) revert ZeroAmount();
        if (amount > s.amount) revert TooMuch();
        if (block.timestamp < s.unlockAt) revert Locked(s.unlockAt);
        _update(id, msg.sender);
        s.amount -= amount;
        p.totalStaked -= amount;
        emit Withdrawn(id, msg.sender, amount);
        IERC20(p.stakeToken).safeTransfer(msg.sender, amount);
    }

    function _claim(uint256 id) internal {
        Pool storage p = _pool(id);
        _update(id, msg.sender);
        Stake storage s = stakes[id][msg.sender];
        uint256 r = s.earned;
        if (r == 0) return;
        s.earned = 0;
        emit Claimed(id, msg.sender, r);
        _pay(p.rewardToken, msg.sender, r);
    }

    function _pull(address token, uint256 amount) internal returns (uint256) {
        if (amount == 0) return 0;
        uint256 before = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        return IERC20(token).balanceOf(address(this)) - before;
    }

    function _pay(address token, address to, uint256 amount) internal {
        if (token == NATIVE) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert PayFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }
}
