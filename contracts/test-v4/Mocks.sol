// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockWETH is ERC20 {
    constructor() ERC20("Wrapped", "WETH") {}
    function deposit() external payable { _mint(msg.sender, msg.value); }
    function withdraw(uint256 a) external { _burn(msg.sender, a); payable(msg.sender).transfer(a); }
    receive() external payable { _mint(msg.sender, msg.value); }
}

contract MockToken is ERC20 {
    uint8 private d;
    constructor(string memory n, uint8 d_) ERC20(n, n) { d = d_; }
    function decimals() public view override returns (uint8) { return d; }
    function mint(address to, uint256 a) external { _mint(to, a); }
}

contract MockPair is ERC20 {
    address public token0;
    address public token1;
    uint112 private r0;
    uint112 private r1;
    constructor(address a, address b) ERC20("LP", "LP") { (token0, token1) = a < b ? (a, b) : (b, a); }
    function getReserves() external view returns (uint112, uint112, uint32) { return (r0, r1, 0); }
    function _sync() private { r0 = uint112(IERC20(token0).balanceOf(address(this))); r1 = uint112(IERC20(token1).balanceOf(address(this))); }
    function mint(address to) external returns (uint256 lp) {
        uint256 a = IERC20(token0).balanceOf(address(this)) - r0;
        uint256 b = IERC20(token1).balanceOf(address(this)) - r1;
        lp = totalSupply() == 0 ? _sqrt(a * b) - 1000 : _min(a * totalSupply() / r0, b * totalSupply() / r1);
        if (totalSupply() == 0) _mint(address(0xdead), 1000);
        _mint(to, lp);
        _sync();
    }
    function swap(uint256 o0, uint256 o1, address to, bytes calldata) external {
        if (o0 > 0) IERC20(token0).transfer(to, o0);
        if (o1 > 0) IERC20(token1).transfer(to, o1);
        uint256 b0 = IERC20(token0).balanceOf(address(this));
        uint256 b1 = IERC20(token1).balanceOf(address(this));
        uint256 i0 = b0 > r0 - o0 ? b0 - (r0 - o0) : 0;
        uint256 i1 = b1 > r1 - o1 ? b1 - (r1 - o1) : 0;
        require(i0 > 0 || i1 > 0, "no input");
        uint256 a0 = b0 * 10000 - i0 * 25;
        uint256 a1 = b1 * 10000 - i1 * 25;
        require(a0 * a1 >= uint256(r0) * r1 * 1e8, "K");
        _sync();
    }
    function _sqrt(uint256 y) private pure returns (uint256 z) { if (y > 3) { z = y; uint256 x = y / 2 + 1; while (x < z) { z = x; x = (y / x + x) / 2; } } else if (y != 0) z = 1; }
    function _min(uint256 a, uint256 b) private pure returns (uint256) { return a < b ? a : b; }
}

contract MockFactory {
    mapping(address => mapping(address => address)) public getPair;
    function createPair(address a, address b) external returns (address p) {
        p = address(new MockPair(a, b));
        getPair[a][b] = p; getPair[b][a] = p;
    }
}

contract MockRouter {
    address public immutable factory;
    address public immutable WETH;
    constructor(address f, address w) { factory = f; WETH = w; }
    receive() external payable {}

    function _out(address pair, address tIn, uint256 amtIn) internal view returns (uint256) {
        (uint112 r0, uint112 r1,) = MockPair(pair).getReserves();
        (uint256 rIn, uint256 rOut) = MockPair(pair).token0() == tIn ? (uint256(r0), uint256(r1)) : (uint256(r1), uint256(r0));
        uint256 inFee = amtIn * 9975;
        return inFee * rOut / (rIn * 10000 + inFee);
    }
    function _swap(address tIn, address tOut, address to) internal {
        address pair = MockFactory(factory).getPair(tIn, tOut);
        (uint112 r0, uint112 r1,) = MockPair(pair).getReserves();
        uint256 rIn = MockPair(pair).token0() == tIn ? r0 : r1;
        uint256 amtIn = IERC20(tIn).balanceOf(pair) - rIn;
        uint256 out = _out(pair, tIn, amtIn);
        (uint256 o0, uint256 o1) = MockPair(pair).token0() == tIn ? (uint256(0), out) : (out, uint256(0));
        MockPair(pair).swap(o0, o1, to, "");
    }
    function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amtIn, uint256, address[] calldata path, address to, uint256) external {
        address pair = MockFactory(factory).getPair(path[0], path[1]);
        IERC20(path[0]).transferFrom(msg.sender, pair, amtIn);
        uint256 before = IERC20(WETH).balanceOf(address(this));
        _swap(path[0], path[1], address(this));
        uint256 got = IERC20(WETH).balanceOf(address(this)) - before;
        MockWETH(payable(WETH)).withdraw(got);
        payable(to).transfer(got);
    }
    function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256, address[] calldata path, address to, uint256) external payable {
        address pair = MockFactory(factory).getPair(path[0], path[1]);
        require(pair != address(0), "no pair");
        MockWETH(payable(WETH)).deposit{value: msg.value}();
        IERC20(WETH).transfer(pair, msg.value);
        _swap(path[0], path[1], to);
    }
    function addLiquidity(address a, address b, uint256 x, uint256 y) external {
        address pair = MockFactory(factory).getPair(a, b);
        if (pair == address(0)) pair = MockFactory(factory).createPair(a, b);
        IERC20(a).transferFrom(msg.sender, pair, x);
        IERC20(b).transferFrom(msg.sender, pair, y);
        MockPair(pair).mint(msg.sender);
    }
    function getAmountsOut(uint256, address[] calldata) external pure returns (uint256[] memory a) { a = new uint256[](2); }
}

contract MockLocker {
    function lock(address, address token, bool, uint256 amount, uint256, string calldata) external returns (uint256) {
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        return 1;
    }
    function unlock(uint256) external {}
}

contract NoReceive {}
