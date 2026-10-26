// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title AUTISTIK Susu: save a little every day, get it all back at the end.
 * @notice A member opens a plan: a stablecoin (USDT or BUSD on BNB Chain), an amount per day and a number of days
 * (7 to 365). Each day they put in that day's amount (missed days can be caught up, but never paid ahead). When the
 * plan ends, the owner takes everything they saved, in one go.
 * - Nobody can take the savings before the end, including the saver, the AUTISTIK team or anyone else.
 * - There is no owner, admin, fee, pause or upgrade. The stablecoins it accepts are fixed when it's deployed.
 * - When a plan ends, the savings can only ever go to the plan's owner. The owner can withdraw, and so can anyone
 *   else on their behalf (the AUTISTIK bot does it automatically), but the money always lands in the owner's wallet.
 */
contract AutistikSusu is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant DAY = 1 days;
    uint256 public constant MIN_DAYS = 7;
    uint256 public constant MAX_DAYS = 365;

    address public immutable tokenA; // USDT on BNB Chain
    address public immutable tokenB; // BUSD on BNB Chain
    uint256 public immutable minDaily; // e.g. 1 dollar
    uint256 public immutable maxDaily; // e.g. 10,000 dollars

    struct Plan {
        address owner;
        address token;
        uint128 daily;
        uint64 start;
        uint16 totalDays;
        uint16 paidDays;
        bool withdrawn;
    }

    Plan[] private _plans;
    mapping(address => uint256[]) private _plansOf;

    event PlanOpened(uint256 indexed id, address indexed owner, address token, uint256 daily, uint256 totalDays, uint256 start);
    event Saved(uint256 indexed id, address indexed from, uint256 daysPaid, uint256 amount, uint256 paidDays);
    event Withdrawn(uint256 indexed id, address indexed owner, uint256 amount);

    error TokenNotAccepted();
    error BadAmount();
    error BadDays();
    error NotOwner();
    error TooEarly();
    error AlreadyWithdrawn();
    error NothingDue();
    error PlanEnded();
    error UnknownPlan();

    constructor(address tokenA_, address tokenB_, uint256 minDaily_, uint256 maxDaily_) {
        tokenA = tokenA_;
        tokenB = tokenB_;
        minDaily = minDaily_;
        maxDaily = maxDaily_;
    }

    // ------------------------------------------------------------------ saving

    /// @notice Opens a plan and pays day 1 (approve `daily` of `token` first).
    function open(address token, uint256 daily, uint256 totalDays) external nonReentrant returns (uint256 id) {
        if (token != tokenA && token != tokenB) revert TokenNotAccepted();
        if (daily < minDaily || daily > maxDaily) revert BadAmount();
        if (totalDays < MIN_DAYS || totalDays > MAX_DAYS) revert BadDays();
        id = _plans.length;
        _plans.push(Plan(msg.sender, token, uint128(daily), uint64(block.timestamp), uint16(totalDays), 0, false));
        _plansOf[msg.sender].push(id);
        emit PlanOpened(id, msg.sender, token, daily, totalDays, block.timestamp);
        _save(id, 1);
    }

    /// @notice Pays `numDays` days into a plan: today's, plus any missed days. Anyone may pay into a plan (family can
    /// help); only the owner can ever take it out.
    function save(uint256 id, uint256 numDays) external nonReentrant {
        if (id >= _plans.length) revert UnknownPlan();
        _save(id, numDays);
    }

    function _save(uint256 id, uint256 numDays) private {
        Plan storage p = _plans[id];
        if (block.timestamp >= p.start + uint256(p.totalDays) * DAY) revert PlanEnded();
        if (numDays == 0 || numDays > due(id)) revert NothingDue();
        uint256 amount = uint256(p.daily) * numDays;
        IERC20 t = IERC20(p.token);
        uint256 before = t.balanceOf(address(this));
        t.safeTransferFrom(msg.sender, address(this), amount);
        if (t.balanceOf(address(this)) - before != amount) revert BadAmount();
        p.paidDays += uint16(numDays);
        emit Saved(id, msg.sender, numDays, amount, p.paidDays);
    }

    /// @notice At the end of the plan, everything saved goes to the plan's owner. Anyone can trigger it (the owner,
    /// or the AUTISTIK bot on their behalf); the money only ever goes to the owner.
    function withdraw(uint256 id) external nonReentrant {
        if (id >= _plans.length) revert UnknownPlan();
        if (block.timestamp < unlockAt(id)) revert TooEarly();
        if (_plans[id].withdrawn) revert AlreadyWithdrawn();
        _release(id);
    }

    /// @notice Pays out every plan in `ids` that has ended and isn't paid yet (skips the rest). Used by the bot.
    function release(uint256[] calldata ids) external nonReentrant returns (uint256 count) {
        for (uint256 k; k < ids.length; k++) {
            uint256 id = ids[k];
            if (id >= _plans.length || _plans[id].withdrawn || block.timestamp < unlockAt(id)) continue;
            _release(id);
            count++;
        }
    }

    function _release(uint256 id) private {
        Plan storage p = _plans[id];
        p.withdrawn = true;
        uint256 amount = uint256(p.daily) * p.paidDays;
        if (amount > 0) IERC20(p.token).safeTransfer(p.owner, amount);
        emit Withdrawn(id, p.owner, amount);
    }

    // ------------------------------------------------------------------ views

    /// @notice Which day of the plan it is (1 on the first day).
    function dayOf(uint256 id) public view returns (uint256) {
        Plan storage p = _plans[id];
        uint256 d = (block.timestamp - p.start) / DAY + 1;
        return d > p.totalDays ? p.totalDays : d;
    }

    /// @notice Days that can be paid right now: today's and any missed (0 once the plan ended or is up to date).
    function due(uint256 id) public view returns (uint256) {
        Plan storage p = _plans[id];
        if (block.timestamp >= p.start + uint256(p.totalDays) * DAY) return 0;
        uint256 d = dayOf(id);
        return d > p.paidDays ? d - p.paidDays : 0;
    }

    function unlockAt(uint256 id) public view returns (uint256) {
        Plan storage p = _plans[id];
        return uint256(p.start) + uint256(p.totalDays) * DAY;
    }

    function plan(uint256 id) external view returns (Plan memory p, uint256 day, uint256 dueDays, uint256 saved, uint256 unlocksAt) {
        if (id >= _plans.length) revert UnknownPlan();
        p = _plans[id];
        return (p, dayOf(id), due(id), uint256(p.daily) * p.paidDays, unlockAt(id));
    }

    function plansOf(address owner) external view returns (uint256[] memory) {
        return _plansOf[owner];
    }

    function planCount() external view returns (uint256) {
        return _plans.length;
    }
}
