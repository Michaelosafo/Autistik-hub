// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {MockWETH} from "./Mocks.sol";
import "../src/AutistikInstantLaunch.sol";

contract MockV3Pool {
    uint160 public sp; int24 public tk;
    constructor(uint160 s, int24 t) { sp = s; tk = t; }
    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint32, bool) { return (sp, tk, 0, 0, 0, 0, true); }
    function pay(address token, address to, uint256 a) external { IERC20(token).transfer(to, a); }
}

contract MockNPM {
    address public WETH9;
    int24 public nextTick;
    mapping(bytes32 => address) public poolOf;
    struct P { address t0; address t1; int24 lo; int24 hi; uint256 a0; uint256 a1; address pool; }
    mapping(uint256 => P) public pos;
    mapping(uint256 => uint256[2]) public fees;
    uint256 public ids;
    constructor(address w) { WETH9 = w; }
    function setTick(int24 t) external { nextTick = t; }
    function setFees(uint256 id, uint256 f0, uint256 f1) external { fees[id] = [f0, f1]; }
    function key(address a, address b) public pure returns (bytes32) { return keccak256(abi.encode(a, b)); }
    function createAndInitializePoolIfNecessary(address t0, address t1, uint24, uint160 s) external payable returns (address p) {
        require(t0 < t1, "order");
        p = poolOf[key(t0, t1)];
        if (p == address(0)) { p = address(new MockV3Pool(s, nextTick)); poolOf[key(t0, t1)] = p; }
    }
    function mint(INonfungiblePositionManager.MintParams calldata m) external payable returns (uint256 id, uint128, uint256, uint256) {
        address pool = poolOf[key(m.token0, m.token1)];
        if (m.amount0Desired > 0) IERC20(m.token0).transferFrom(msg.sender, pool, m.amount0Desired);
        if (m.amount1Desired > 0) IERC20(m.token1).transferFrom(msg.sender, pool, m.amount1Desired);
        id = ++ids;
        pos[id] = P(m.token0, m.token1, m.tickLower, m.tickUpper, m.amount0Desired, m.amount1Desired, pool);
        require(AutistikInstantLaunch(payable(m.recipient)).onERC721Received(address(this), address(this), id, "") == 0x150b7a02, "721");
        return (id, 1, m.amount0Desired, m.amount1Desired);
    }
    function collect(INonfungiblePositionManager.CollectParams calldata c) external payable returns (uint256 a0, uint256 a1) {
        P memory p = pos[c.tokenId];
        (a0, a1) = (fees[c.tokenId][0], fees[c.tokenId][1]);
        delete fees[c.tokenId];
        if (a0 > 0) MockV3Pool(p.pool).pay(p.t0, c.recipient, a0);
        if (a1 > 0) MockV3Pool(p.pool).pay(p.t1, c.recipient, a1);
    }
}

/// 1 BNB buys 10,000,000 coins (1% of supply).
contract MockRouter {
    MockNPM npm; MockWETH weth;
    constructor(MockNPM n, MockWETH w) { npm = n; weth = w; }
    function exactInputSingle(ISwapRouterV3.ExactInputSingleParams calldata p) external payable returns (uint256 out) {
        (address a, address b) = p.tokenIn < p.tokenOut ? (p.tokenIn, p.tokenOut) : (p.tokenOut, p.tokenIn);
        address pool = npm.poolOf(npm.key(a, b));
        weth.deposit{value: msg.value}();
        weth.transfer(pool, msg.value);
        out = msg.value * 10_000_000;
        MockV3Pool(pool).pay(p.tokenOut, p.recipient, out);
    }
}

contract Payer { receive() external payable { revert(); } }

contract InstantTest is Test {
    MockWETH weth; MockNPM npm; MockRouter router; AutistikInstantLaunch pad;
    address treasury = address(0x7EA);
    address creator = address(0xC0FFEE);
    address buyer = address(0xB0B);
    uint256 signerKey = 0xA11CE;

    function setUpWith(address wethAt) internal {
        MockWETH w = new MockWETH();
        vm.etch(wethAt, address(w).code);
        weth = MockWETH(payable(wethAt));
        npm = new MockNPM(wethAt);
        router = new MockRouter(npm, weth);
        pad = new AutistikInstantLaunch(address(npm), address(router), address(this), treasury, 6 ether, 5000, address(0));
        vm.deal(creator, 100 ether);
        vm.deal(buyer, 100 ether);
        vm.deal(wethAt, 1000 ether);
    }

    function setUp() public { setUpWith(address(0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF)); }

    function _launch(uint256 value, bytes32 salt) internal returns (address t) {
        vm.prank(creator);
        t = pad.launch{value: value}("Instant Dog", "IDOG", salt, 0, "", block.timestamp + 60);
    }

    function test_launch_tokenIsToken0_singleSidedAbovePrice() public {
        npm.setTick(-160_123);
        address t = _launch(0, bytes32(uint256(1)));
        assertLt(uint160(t), uint160(address(weth)));
        (address creatorOf, address pool, uint256 id,,) = pad.coinOf(t);
        assertEq(creatorOf, creator);
        (,, int24 lo, int24 hi, uint256 a0, uint256 a1,) = npm.pos(id);
        assertEq(lo, -160_200 + 200); // floor(-160123) = -160200, then one step up
        assertEq(hi, 887_200);
        assertEq(a0, 1_000_000_000 ether);
        assertEq(a1, 0);
        assertEq(IERC20(t).balanceOf(pool), 1_000_000_000 ether);
        assertEq(IERC20(t).balanceOf(address(pad)), 0);
        assertEq(IERC20(t).totalSupply(), 1_000_000_000 ether);
        // price check: sqrt(fdv/supply) * 2^96
        (uint160 sp,,,,,,) = MockV3Pool(pool).slot0();
        assertApproxEqRel(uint256(sp), uint256(79228162514264337593543950336) * 77459667 / 1e12, 1e15); // sqrt(6e-9)=7.7459667e-5
    }

    function test_launch_tokenIsToken1_singleSidedBelowPrice() public {
        setUpWith(address(0x0000000000000000000000000000000000000F00));
        npm.setTick(160_123);
        address t = _launch(0, bytes32(uint256(2)));
        assertGt(uint160(t), uint160(address(weth)));
        (,, uint256 id,,) = pad.coinOf(t);
        (,, int24 lo, int24 hi, uint256 a0, uint256 a1,) = npm.pos(id);
        assertEq(lo, -887_200);
        assertEq(hi, 160_000);
        assertEq(a0, 0);
        assertEq(a1, 1_000_000_000 ether);
    }

    function test_negativeTickExactMultiple() public {
        npm.setTick(-160_200);
        address t = _launch(0, bytes32(uint256(3)));
        (,, uint256 id,,) = pad.coinOf(t);
        (,, int24 lo,,,,) = npm.pos(id);
        assertEq(lo, -160_000);
    }

    function test_creatorFirstBuy_andLaunchFee() public {
        pad.setSettings(treasury, 0.01 ether, 6 ether, 5000);
        address t = _launch(1.01 ether, bytes32(uint256(4)));
        assertEq(IERC20(t).balanceOf(creator), 10_000_000 ether);
        assertEq(treasury.balance, 0.01 ether);
        vm.expectRevert(AutistikInstantLaunch.FeeTooLow.selector);
        _launch(0.001 ether, bytes32(uint256(5)));
    }

    function test_creatorBuyCappedAt5Percent() public {
        vm.expectRevert(AutistikInstantLaunch.CreatorBuyTooBig.selector);
        _launch(6 ether, bytes32(uint256(6)));
    }

    function test_antiSnipe_first5Minutes() public {
        address t = _launch(0, bytes32(uint256(7)));
        ISwapRouterV3.ExactInputSingleParams memory p = ISwapRouterV3.ExactInputSingleParams(address(weth), t, 10_000, buyer, block.timestamp, 0, 0, 0);
        vm.prank(buyer);
        router.exactInputSingle{value: 1 ether}(p); // 1% ok
        vm.prank(buyer);
        vm.expectRevert(AutistikInstantToken.SnipeLimit.selector);
        router.exactInputSingle{value: 1.5 ether}(p); // 2.5% held: too much
        vm.warp(block.timestamp + 5 minutes);
        vm.prank(buyer);
        router.exactInputSingle{value: 3 ether}(p);
        assertEq(IERC20(t).balanceOf(buyer), 40_000_000 ether);
        // selling / wallet-to-wallet is never limited
        vm.prank(buyer);
        IERC20(t).transfer(creator, 40_000_000 ether);
    }

    function test_tokenStartOnlyOnceByLauncher() public {
        address t = _launch(0, bytes32(uint256(8)));
        vm.expectRevert(AutistikInstantToken.OnlyLauncher.selector);
        AutistikInstantToken(t).start(address(1));
    }

    function test_collectFees_split() public {
        address t = _launch(1 ether, bytes32(uint256(9)));
        (, address pool, uint256 id,,) = pad.coinOf(t);
        // pool has 1 WBNB (from the buy); pretend 0.4 WBNB and 1000 coins are fees
        (address t0,) = t < address(weth) ? (t, address(weth)) : (address(weth), t);
        if (t0 == t) npm.setFees(id, 1000 ether, 0.4 ether); else npm.setFees(id, 0.4 ether, 1000 ether);
        uint256 c0 = creator.balance;
        vm.prank(buyer);
        pad.collectFees(t);
        assertEq(creator.balance - c0, 0.2 ether);
        assertEq(treasury.balance, 0.2 ether);
        assertEq(IERC20(t).balanceOf(treasury), 500 ether);
        assertEq(IERC20(t).balanceOf(creator), 10_000_000 ether + 500 ether);
        assertEq(address(pad).balance, 0);
        pool;
    }

    function test_collectFees_failedSendIsOwed() public {
        Payer p = new Payer();
        vm.deal(address(p), 1 ether);
        vm.prank(address(p));
        address t = pad.launch("X", "X", bytes32(uint256(10)), 0, "", block.timestamp + 1);
        (,, uint256 id,,) = pad.coinOf(t);
        // put some WBNB into the pool to pay out as fees
        vm.prank(buyer);
        router.exactInputSingle{value: 1 ether}(ISwapRouterV3.ExactInputSingleParams(address(weth), t, 10_000, buyer, block.timestamp, 0, 0, 0));
        bool tIs0 = t < address(weth);
        npm.setFees(id, tIs0 ? 0 : 0.5 ether, tIs0 ? 0.5 ether : 0);
        pad.collectFees(t);
        assertEq(pad.owed(address(p)), 0.25 ether);
        assertEq(treasury.balance, 0.25 ether);
    }

    function test_notLaunchedHere() public {
        vm.expectRevert(AutistikInstantLaunch.NotLaunchedHere.selector);
        pad.collectFees(address(123));
    }

    function test_frontRunPoolAtOtherPrice_reverts() public {
        bytes32 salt = bytes32(uint256(11));
        address t = pad.tokenFor(creator, salt, "Instant Dog", "IDOG");
        (address a, address b) = t < address(weth) ? (t, address(weth)) : (address(weth), t);
        npm.createAndInitializePoolIfNecessary(a, b, 10_000, 1 << 60);
        vm.expectRevert(AutistikInstantLaunch.PoolTaken.selector);
        _launch(0, salt);
    }

    function test_tokenForMatches() public {
        bytes32 salt = bytes32(uint256(12));
        address want = pad.tokenFor(creator, salt, "Instant Dog", "IDOG");
        assertEq(_launch(0, salt), want);
    }

    function test_permitRequired() public {
        address signer = vm.addr(signerKey);
        pad.setEligibilitySigner(signer);
        bytes32 salt = bytes32(uint256(13));
        vm.expectRevert();
        _launch(0, salt);
        uint256 dl = block.timestamp + 600;
        bytes32 h = MessageHashUtils.toEthSignedMessageHash(pad.permitHash(creator, salt, dl));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, h);
        vm.prank(creator);
        pad.launch("Instant Dog", "IDOG", salt, dl, abi.encodePacked(r, s, v), block.timestamp + 60);
        vm.prank(creator);
        vm.expectRevert(AutistikInstantLaunch.PermitUsed.selector);
        pad.launch("Instant Dog2", "IDOG", salt, dl, abi.encodePacked(r, s, v), block.timestamp + 60);
    }

    function test_onlyOwnerSettings() public {
        vm.prank(buyer);
        vm.expectRevert(AutistikInstantLaunch.NotOwner.selector);
        pad.setSettings(treasury, 0, 1 ether, 0);
        vm.expectRevert(AutistikInstantLaunch.BadSettings.selector);
        pad.setSettings(treasury, 2 ether, 1 ether, 0);
    }
}
