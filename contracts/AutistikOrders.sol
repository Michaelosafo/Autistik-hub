// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IV2Router {
    function swapExactTokensForTokensSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external;
    function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external;
}

/**
 * AUTISTIK Orders: limit and stop-loss orders for self-custody wallets.
 *
 * A member signs an order (free, no transaction) and approves this contract for exactly the order's amount. Their
 * tokens stay in their own wallet until the order fills. When the price condition is met, an AUTISTIK keeper fills
 * the order in one transaction: the tokens are swapped on an approved DEX router and the result goes straight back
 * to the member. The contract checks every fill pays at least the member's own minimum (`minOut`), after the fee.
 *
 * - Nobody can move a member's tokens except to fill their own signed order, at or above their own minimum.
 * - Only keepers can fill (so a stop-loss can't be filled early by anyone else).
 * - Members can cancel any time, and orders expire.
 * - The owner can only add or remove keepers and routers. The owner can't touch funds, change the fee or fill orders.
 * - The contract holds nothing between transactions.
 */
contract AutistikOrders is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev How orders write "the chain's own coin" (BNB, ETH) as the token received.
    address public constant NATIVE = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    bytes32 public constant ORDER_TYPEHASH =
        keccak256("Order(address maker,address tokenIn,address tokenOut,uint256 amountIn,uint256 minOut,uint256 expiry,uint256 nonce)");

    struct Order {
        address maker;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minOut;
        uint256 expiry;
        uint256 nonce;
    }

    address public owner;
    address public immutable treasury;
    /// @notice Fee on what the member receives, in basis points (max 1%). Fixed at deployment.
    uint256 public immutable feeBps;
    /// @notice The chain's wrapped coin (WBNB, WETH), for direct DEX swaps that pay out the coin.
    address public immutable wrapped;

    mapping(address => bool) public keepers;
    mapping(address => bool) public routers;
    /// @notice Filled or cancelled orders.
    mapping(bytes32 => bool) public done;

    event Filled(bytes32 indexed hash, address indexed maker, uint256 amountIn, uint256 amountOut, uint256 fee);
    event Cancelled(bytes32 indexed hash, address indexed maker);
    event KeeperSet(address indexed keeper, bool allowed);
    event RouterSet(address indexed router, bool allowed);
    event OwnerChanged(address indexed owner);

    error NotOwner();
    error NotKeeper();
    error NotMaker();
    error OrderDone();
    error Expired();
    error BadSignature();
    error BadRouter();
    error BadPath();
    error SwapFailed();
    error TooLittle(uint256 got, uint256 minOut);
    error BadConfig();
    error PayFailed();

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }

    constructor(address owner_, address treasury_, uint256 feeBps_, address wrapped_, address[] memory keepers_, address[] memory routers_)
        EIP712("AUTISTIK Orders", "1")
    {
        if (owner_ == address(0) || treasury_ == address(0) || feeBps_ > 100) revert BadConfig();
        owner = owner_;
        treasury = treasury_;
        feeBps = feeBps_;
        wrapped = wrapped_;
        for (uint256 i; i < keepers_.length; i++) { keepers[keepers_[i]] = true; emit KeeperSet(keepers_[i], true); }
        for (uint256 i; i < routers_.length; i++) { routers[routers_[i]] = true; emit RouterSet(routers_[i], true); }
    }

    receive() external payable {}

    // ------------------------------------------------------------------ admin (keepers and routers only)

    function setKeeper(address k, bool allowed) external onlyOwner { keepers[k] = allowed; emit KeeperSet(k, allowed); }
    function setRouter(address r, bool allowed) external onlyOwner { routers[r] = allowed; emit RouterSet(r, allowed); }
    function setOwner(address o) external onlyOwner { if (o == address(0)) revert BadConfig(); owner = o; emit OwnerChanged(o); }

    // ------------------------------------------------------------------ members

    function hashOrder(Order calldata o) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(ORDER_TYPEHASH, o.maker, o.tokenIn, o.tokenOut, o.amountIn, o.minOut, o.expiry, o.nonce)));
    }

    /// @notice Cancel your order on-chain. (Cancelling in the app also stops the keeper.)
    function cancel(Order calldata o) external {
        if (msg.sender != o.maker) revert NotMaker();
        bytes32 h = hashOrder(o);
        done[h] = true;
        emit Cancelled(h, o.maker);
    }

    // ------------------------------------------------------------------ keepers

    /**
     * Fills a signed order. Either `data` is a call to an approved aggregator router (which must pay the result to
     * this contract), or `data` is empty and `path` is a direct V2 swap (for tokens with a transfer tax).
     */
    function fill(Order calldata o, bytes calldata signature, address router, bytes calldata data, address[] calldata path)
        external nonReentrant returns (uint256 toMaker)
    {
        if (!keepers[msg.sender]) revert NotKeeper();
        if (!routers[router]) revert BadRouter();
        if (block.timestamp > o.expiry) revert Expired();
        bytes32 h = hashOrder(o);
        if (done[h]) revert OrderDone();
        if (!SignatureChecker.isValidSignatureNow(o.maker, h, signature)) revert BadSignature();
        done[h] = true;

        uint256 outBefore = _balance(o.tokenOut);
        uint256 got = _swap(o, router, data, path);
        toMaker = _settle(o, h, outBefore, got);
    }

    /// Checks the member gets at least their minimum, then pays the fee and the member.
    function _settle(Order calldata o, bytes32 h, uint256 outBefore, uint256 got) private returns (uint256 toMaker) {
        uint256 out = _balance(o.tokenOut) - outBefore;
        uint256 fee = (out * feeBps) / 10_000;
        toMaker = out - fee;
        if (toMaker < o.minOut) revert TooLittle(toMaker, o.minOut);
        _pay(o.tokenOut, treasury, fee);
        _pay(o.tokenOut, o.maker, toMaker);
        emit Filled(h, o.maker, got, toMaker, fee);
    }

    /// Pulls the member's tokens, swaps them, and returns anything unused. Returns how much was swapped.
    function _swap(Order calldata o, address router, bytes calldata data, address[] calldata path) private returns (uint256 got) {
        IERC20 tin = IERC20(o.tokenIn);
        uint256 inBefore = tin.balanceOf(address(this));
        tin.safeTransferFrom(o.maker, address(this), o.amountIn);
        got = tin.balanceOf(address(this)) - inBefore; // less than amountIn for tokens with a transfer tax

        tin.forceApprove(router, got);
        if (data.length > 0) {
            (bool ok,) = router.call(data);
            if (!ok) revert SwapFailed();
        } else {
            bool native = o.tokenOut == NATIVE;
            if (path.length < 2 || path[0] != o.tokenIn || path[path.length - 1] != (native ? wrapped : o.tokenOut)) revert BadPath();
            if (native) IV2Router(router).swapExactTokensForETHSupportingFeeOnTransferTokens(got, 0, path, address(this), block.timestamp);
            else IV2Router(router).swapExactTokensForTokensSupportingFeeOnTransferTokens(got, 0, path, address(this), block.timestamp);
        }
        tin.forceApprove(router, 0);

        // Anything the router didn't use goes back to the member.
        uint256 left = tin.balanceOf(address(this)) - inBefore;
        if (left > 0) tin.safeTransfer(o.maker, left);
    }

    function _balance(address token) private view returns (uint256) {
        return token == NATIVE ? address(this).balance : IERC20(token).balanceOf(address(this));
    }

    function _pay(address token, address to, uint256 amount) private {
        if (amount == 0) return;
        if (token == NATIVE) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert PayFailed();
        } else IERC20(token).safeTransfer(to, amount);
    }
}
