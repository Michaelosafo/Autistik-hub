// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

interface ILockerPair {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function factory() external view returns (address);
}

interface ILockerFactory {
    function getPair(address tokenA, address tokenB) external view returns (address);
}

/**
 * @title AUTISTIK Locker
 * @notice Locks liquidity (LP tokens) or any ERC-20 token until a date, or releases it in steps (vesting).
 *
 * Built to be easy for people, sites and scanners to check:
 *  - No owner, no admin, no fees, no upgrades. Nobody (including the AUTISTIK team) can move a locked token early.
 *  - Tokens only ever go to the lock's owner, and only after the unlock date. Anyone can trigger a due release
 *    (so it can happen automatically), but they can't redirect it.
 *  - The lock layout, function names and events follow the widely used PinkLock V2 locker, so tools that already
 *    read lockers can read this one the same way.
 *  - Liquidity locks are checked: a token marked as LP must be a real Uniswap V2 style pair (PancakeSwap, Uniswap…),
 *    and a real pair can't be locked as a plain token, so every LP lock is labelled correctly.
 *
 * Tokens that take a fee on transfer are supported: the lock records what actually arrived. Tokens whose balances
 * shrink by themselves (negative rebasing) are not supported.
 */
contract AutistikLocker is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.UintSet;

    struct Lock {
        uint256 id;
        address token;
        address owner;
        uint256 amount;
        uint256 lockDate;
        /// Unlock date for a normal lock; first release date for a vesting lock.
        uint256 tgeDate;
        /// Vesting only (0 for a normal lock): share released at tgeDate, in basis points (1% = 100).
        uint256 tgeBps;
        /// Vesting only: seconds between releases after tgeDate.
        uint256 cycle;
        /// Vesting only: share released every cycle, in basis points.
        uint256 cycleBps;
        uint256 unlockedAmount;
        bool isLpToken;
        string description;
    }

    uint256 public constant MAX_DESCRIPTION = 200;

    Lock[] private _locks;
    mapping(address => uint256[]) private _tokenLocks;
    mapping(address => EnumerableSet.UintSet) private _userLocks;
    /// Tokens still locked (not yet taken back) for each token.
    mapping(address => uint256) public totalLockedForToken;

    event LockAdded(uint256 indexed id, address token, address owner, uint256 amount, uint256 unlockDate);
    event LockUpdated(uint256 indexed id, address token, address owner, uint256 newAmount, uint256 newUnlockDate);
    event LockRemoved(uint256 indexed id, address token, address owner, uint256 amount, uint256 unlockedAt);
    event LockVested(uint256 indexed id, address token, address owner, uint256 amount, uint256 remaining, uint256 timestamp);
    event LockDescriptionChanged(uint256 lockId);
    event LockOwnerChanged(uint256 lockId, address owner, address newOwner);

    error InvalidOwner();
    error InvalidAmount();
    error InvalidDate();
    error InvalidVesting();
    error NotLpToken();
    error IsLpToken();
    error DescriptionTooLong();
    error NotLockOwner();
    error UnknownLock();
    error StillLocked();
    error NothingToUnlock();
    error IsVestingLock();
    error AlreadyUnlocked();

    // ---------------------------------------------------------------- locking

    /// @notice Locks `amount` of `token` for `owner` until `unlockDate`. Approve this contract first.
    function lock(address owner, address token, bool isLpToken, uint256 amount, uint256 unlockDate, string calldata description)
        external
        nonReentrant
        returns (uint256 id)
    {
        if (unlockDate <= block.timestamp) revert InvalidDate();
        id = _create(owner, token, isLpToken, amount, description);
        _locks[id].tgeDate = unlockDate;
        emit LockAdded(id, token, owner, _locks[id].amount, unlockDate);
    }

    /**
     * @notice Locks tokens that unlock in steps: `tgeBps` at `tgeDate`, then `cycleBps` every `cycle` seconds.
     * Approve this contract first.
     */
    function vestingLock(
        address owner,
        address token,
        bool isLpToken,
        uint256 amount,
        uint256 tgeDate,
        uint256 tgeBps,
        uint256 cycle,
        uint256 cycleBps,
        string calldata description
    ) external nonReentrant returns (uint256 id) {
        if (tgeDate <= block.timestamp) revert InvalidDate();
        if (cycle == 0 || cycleBps == 0 || tgeBps + cycleBps > 10_000) revert InvalidVesting();
        id = _create(owner, token, isLpToken, amount, description);
        Lock storage l = _locks[id];
        (l.tgeDate, l.tgeBps, l.cycle, l.cycleBps) = (tgeDate, tgeBps, cycle, cycleBps);
        emit LockAdded(id, token, owner, _locks[id].amount, tgeDate);
    }

    /// Takes the tokens in and saves the lock. The caller sets the unlock schedule.
    function _create(address owner, address token, bool isLpToken, uint256 amount, string calldata description)
        private
        returns (uint256 id)
    {
        if (owner == address(0)) revert InvalidOwner();
        if (amount == 0) revert InvalidAmount();
        if (bytes(description).length > MAX_DESCRIPTION) revert DescriptionTooLong();
        bool lp = _isLp(token);
        if (isLpToken && !lp) revert NotLpToken();
        if (!isLpToken && lp) revert IsLpToken();

        uint256 received = _pull(token, amount);
        id = _locks.length;
        _locks.push(Lock(id, token, owner, received, block.timestamp, 0, 0, 0, 0, 0, isLpToken, description));
        _tokenLocks[token].push(id);
        _userLocks[owner].add(id);
        totalLockedForToken[token] += received;
    }

    /// @notice Adds more tokens to a normal lock and/or moves its unlock date later. Never earlier.
    function editLock(uint256 lockId, uint256 newAmount, uint256 newUnlockDate) external nonReentrant {
        Lock storage l = _own(lockId);
        if (l.cycle != 0) revert IsVestingLock();
        if (l.unlockedAmount != 0) revert AlreadyUnlocked();
        if (newUnlockDate < l.tgeDate || newUnlockDate <= block.timestamp) revert InvalidDate();
        if (newAmount < l.amount) revert InvalidAmount();
        if (newAmount > l.amount) {
            uint256 received = _pull(l.token, newAmount - l.amount);
            l.amount += received;
            totalLockedForToken[l.token] += received;
        }
        l.tgeDate = newUnlockDate;
        emit LockUpdated(lockId, l.token, l.owner, l.amount, newUnlockDate);
    }

    // ---------------------------------------------------------------- unlocking

    /**
     * @notice Sends the lock owner everything they're allowed to take back now.
     * Once tokens are due, ANYONE may call this (a keeper does it automatically), but the tokens always go to the
     * lock's owner, never to the caller. A lock owned by a contract (such as a launchpad) can only be released by that
     * contract, so it can pass the tokens on. A lock whose ownership was renounced can never be released.
     */
    function unlock(uint256 lockId) external nonReentrant {
        Lock storage l = _get(lockId);
        if (l.owner == address(0) || (msg.sender != l.owner && l.owner.code.length > 0)) revert NotLockOwner();
        uint256 amount = withdrawableTokens(lockId);
        if (amount == 0) {
            if (block.timestamp < l.tgeDate) revert StillLocked();
            revert NothingToUnlock();
        }
        _release(l, amount);
    }

    /// @notice Releases every due lock in the list to its owner. Locks that aren't due (or can't be released by the
    /// caller) are skipped instead of stopping the rest. Returns how many were released.
    function unlockMany(uint256[] calldata lockIds) external nonReentrant returns (uint256 released) {
        for (uint256 i = 0; i < lockIds.length; i++) {
            if (lockIds[i] >= _locks.length) continue;
            Lock storage l = _locks[lockIds[i]];
            if (l.owner == address(0) || (msg.sender != l.owner && l.owner.code.length > 0)) continue;
            uint256 amount = withdrawableTokens(lockIds[i]);
            if (amount == 0) continue;
            _release(l, amount);
            released++;
        }
    }

    function _release(Lock storage l, uint256 amount) private {
        uint256 lockId = l.id;
        l.unlockedAmount += amount;
        totalLockedForToken[l.token] -= amount;
        uint256 remaining = l.amount - l.unlockedAmount;
        if (remaining == 0) _userLocks[l.owner].remove(lockId);
        IERC20(l.token).safeTransfer(l.owner, amount);
        if (l.cycle == 0) emit LockRemoved(lockId, l.token, l.owner, amount, block.timestamp);
        else emit LockVested(lockId, l.token, l.owner, amount, remaining, block.timestamp);
    }

    /// @notice How many tokens the lock's owner can take back right now.
    function withdrawableTokens(uint256 lockId) public view returns (uint256) {
        Lock storage l = _get(lockId);
        if (block.timestamp < l.tgeDate) return 0;
        uint256 released;
        if (l.cycle == 0) {
            released = l.amount;
        } else {
            uint256 cycles = (block.timestamp - l.tgeDate) / l.cycle;
            // 10,000 steps of at least 0.01% always add up to everything, so stop counting there.
            if (cycles >= 10_000) released = l.amount;
            else released = Math.min(l.amount, Math.mulDiv(l.amount, l.tgeBps + cycles * l.cycleBps, 10_000));
        }
        return released - l.unlockedAmount;
    }

    // ---------------------------------------------------------------- owner changes

    /// @notice Gives the lock (and the right to unlock it later) to another wallet.
    function transferLockOwnership(uint256 lockId, address newOwner) external {
        if (newOwner == address(0)) revert InvalidOwner();
        _setOwner(_own(lockId), newOwner);
    }

    /// @notice Gives up the lock forever: nobody can ever unlock these tokens again. Cannot be undone.
    function renounceLockOwnership(uint256 lockId) external {
        _setOwner(_own(lockId), address(0));
    }

    function editLockDescription(uint256 lockId, string calldata description) external {
        if (bytes(description).length > MAX_DESCRIPTION) revert DescriptionTooLong();
        _own(lockId).description = description;
        emit LockDescriptionChanged(lockId);
    }

    function _setOwner(Lock storage l, address newOwner) private {
        _userLocks[l.owner].remove(l.id);
        if (newOwner != address(0) && l.unlockedAmount < l.amount) _userLocks[newOwner].add(l.id);
        emit LockOwnerChanged(l.id, l.owner, newOwner);
        l.owner = newOwner;
    }

    // ---------------------------------------------------------------- reading

    function getTotalLockCount() external view returns (uint256) {
        return _locks.length;
    }

    function getLockById(uint256 lockId) external view returns (Lock memory) {
        return _get(lockId);
    }

    /// @notice Locks with ids from `start` up to (not including) `end`.
    function getLocks(uint256 start, uint256 end) external view returns (Lock[] memory out) {
        end = Math.min(end, _locks.length);
        if (start >= end) return out;
        out = new Lock[](end - start);
        for (uint256 i = start; i < end; i++) out[i - start] = _locks[i];
    }

    /// @notice Every lock ever made for a token (including ones already unlocked).
    function lockIdsForToken(address token) external view returns (uint256[] memory) {
        return _tokenLocks[token];
    }

    /// @notice Locks a wallet owns that still hold tokens.
    function lockIdsForUser(address user) external view returns (uint256[] memory) {
        return _userLocks[user].values();
    }

    /// @notice True if `token` is a Uniswap V2 style pair (an LP token).
    function isPair(address token) external view returns (bool) {
        return _isLp(token);
    }

    // ---------------------------------------------------------------- helpers

    function _get(uint256 lockId) private view returns (Lock storage) {
        if (lockId >= _locks.length) revert UnknownLock();
        return _locks[lockId];
    }

    function _own(uint256 lockId) private view returns (Lock storage l) {
        l = _get(lockId);
        if (msg.sender != l.owner) revert NotLockOwner();
    }

    /// Pulls tokens in and returns how many actually arrived (fee-on-transfer tokens deliver less).
    function _pull(address token, uint256 amount) private returns (uint256 received) {
        uint256 before = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        received = IERC20(token).balanceOf(address(this)) - before;
        if (received == 0) revert InvalidAmount();
    }

    function _isLp(address token) private view returns (bool) {
        (bool ok, address factory) = _readAddress(token, abi.encodeCall(ILockerPair.factory, ()));
        if (!ok || factory.code.length == 0) return false;
        (bool ok0, address t0) = _readAddress(token, abi.encodeCall(ILockerPair.token0, ()));
        (bool ok1, address t1) = _readAddress(token, abi.encodeCall(ILockerPair.token1, ()));
        if (!ok0 || !ok1) return false;
        (bool okPair, address pair) = _readAddress(factory, abi.encodeCall(ILockerFactory.getPair, (t0, t1)));
        return okPair && pair == token;
    }

    /// A read that never reverts, even on contracts that answer with something that isn't an address.
    function _readAddress(address target, bytes memory data) private view returns (bool, address) {
        if (target.code.length == 0) return (false, address(0));
        (bool ok, bytes memory ret) = target.staticcall{gas: 50_000}(data);
        if (!ok || ret.length < 32) return (false, address(0));
        uint256 v = abi.decode(ret, (uint256));
        if (v >> 160 != 0) return (false, address(0));
        return (true, address(uint160(v)));
    }
}
