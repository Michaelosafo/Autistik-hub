// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {MockWETH, MockToken} from "./Mocks.sol";
import "../src/AutistikInstantLaunchV2.sol";

contract V2Pool {
    uint160 public sp; int24 public tk;
    constructor(uint160 s, int24 t) { sp = s; tk = t; }
    function slot0() external view returns (uint160, int24, uint16, uint16, uint16, uint32, bool) { return (sp, tk, 0, 0, 0, 0, true); }
    function pay(address token, address to, uint256 a) external { IERC20(token).transfer(to, a); }
}

contract V2NPM {
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
        if (p == address(0)) { p = address(new V2Pool(s, nextTick)); poolOf[key(t0, t1)] = p; }
    }
    function mint(INonfungiblePositionManagerV2.MintParams calldata m) external payable returns (uint256 id, uint128, uint256, uint256) {
        address pool = poolOf[key(m.token0, m.token1)];
        if (m.amount0Desired > 0) IERC20(m.token0).transferFrom(msg.sender, pool, m.amount0Desired);
        if (m.amount1Desired > 0) IERC20(m.token1).transferFrom(msg.sender, pool, m.amount1Desired);
        id = ++ids;
        pos[id] = P(m.token0, m.token1, m.tickLower, m.tickUpper, m.amount0Desired, m.amount1Desired, pool);
        require(AutistikInstantLaunchV2(payable(m.recipient)).onERC721Received(address(this), address(this), id, "") == 0x150b7a02, "721");
        return (id, 1, m.amount0Desired, m.amount1Desired);
    }
    function collect(INonfungiblePositionManagerV2.CollectParams calldata c) external payable returns (uint256 a0, uint256 a1) {
        P memory p = pos[c.tokenId];
        (a0, a1) = (fees[c.tokenId][0], fees[c.tokenId][1]);
        delete fees[c.tokenId];
        if (a0 > 0) V2Pool(p.pool).pay(p.t0, c.recipient, a0);
        if (a1 > 0) V2Pool(p.pool).pay(p.t1, c.recipient, a1);
    }
}

/// 1 BNB buys 10,000,000 coins (1% of supply) from a coin's pool, or 1,000 of a reward token.
contract V2Router {
    V2NPM npm; MockWETH weth;
    bool public rewardsDown;
    constructor(V2NPM n, MockWETH w) { npm = n; weth = w; }
    function setRewardsDown(bool d) external { rewardsDown = d; }
    function exactInputSingle(ISwapRouterV3V2.ExactInputSingleParams calldata p) external payable returns (uint256 out) {
        (address a, address b) = p.tokenIn < p.tokenOut ? (p.tokenIn, p.tokenOut) : (p.tokenOut, p.tokenIn);
        address pool = npm.poolOf(npm.key(a, b));
        if (pool == address(0)) {
            require(!rewardsDown, "no route");
            out = msg.value * 1000;
            MockToken(p.tokenOut).mint(p.recipient, out);
            return out;
        }
        weth.deposit{value: msg.value}();
        weth.transfer(pool, msg.value);
        out = msg.value * 10_000_000;
        V2Pool(pool).pay(p.tokenOut, p.recipient, out);
    }
}

contract InstantV2Test is Test {
    MockWETH weth; V2NPM npm; V2Router router; AutistikInstantLaunchV2 pad; MockToken usdt;
    address constant NATIVE = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    address treasury = address(0x7EA);
    address creator = address(0xC0FFEE);
    address buyer = address(0xB0B);
    address other = address(0x0DD);
    uint256 signerKey = 0xA11CE;

    function setUpWith(address wethAt) internal {
        MockWETH w = new MockWETH();
        vm.etch(wethAt, address(w).code);
        weth = MockWETH(payable(wethAt));
        npm = new V2NPM(wethAt);
        router = new V2Router(npm, weth);
        usdt = new MockToken("USDT", 18);
        address[] memory rt = new address[](1); rt[0] = address(usdt);
        uint24[] memory rf = new uint24[](1); rf[0] = 500;
        pad = new AutistikInstantLaunchV2(address(npm), address(router), address(this), treasury, 6 ether, 5000, address(0), rt, rf);
        vm.deal(creator, 100 ether);
        vm.deal(buyer, 100 ether);
        vm.deal(wethAt, 1000 ether);
    }

    function setUp() public { setUpWith(address(0xFFfFfFffFFfffFFfFFfFFFFFffFFFffffFfFFFfF)); }

    function _launch(uint256 value, bytes32 salt, address reward, uint256 holderBps) internal returns (address t) {
        vm.prank(creator);
        t = pad.launch{value: value}("Instant Dog", "IDOG", salt, 0, "", block.timestamp + 60, reward, holderBps);
    }

    function _buy(address who, address t, uint256 value) internal {
        vm.prank(who);
        router.exactInputSingle{value: value}(ISwapRouterV3V2.ExactInputSingleParams(address(weth), t, 10_000, who, block.timestamp, 0, 0, 0));
    }

    function _fees(address t, uint256 eth) internal {
        (,, uint256 id,,,) = pad.coinOf(t);
        if (t < address(weth)) npm.setFees(id, 0, eth); else npm.setFees(id, eth, 0);
    }

    // ---------------------------------------------------------------- same as v1 when no rewards

    function test_noRewards_sameSplitAsV1() public {
        address t = _launch(1 ether, bytes32(uint256(1)), address(0), 0);
        assertEq(IERC20(t).balanceOf(creator), 10_000_000 ether);
        _fees(t, 0.4 ether);
        uint256 c0 = creator.balance;
        pad.collectFees(t);
        assertEq(creator.balance - c0, 0.2 ether);
        assertEq(treasury.balance, 0.2 ether);
        assertEq(AutistikInstantTokenV2(payable(t)).totalRewardsDistributed(), 0);
        assertEq(address(pad).balance, 0);
    }

    function test_badRewardChoices_revert() public {
        vm.expectRevert(AutistikInstantLaunchV2.BadSettings.selector);
        _launch(0, bytes32(uint256(2)), address(0), 100);
        vm.expectRevert(AutistikInstantLaunchV2.BadSettings.selector);
        _launch(0, bytes32(uint256(2)), NATIVE, 0);
        vm.expectRevert(AutistikInstantLaunchV2.BadSettings.selector);
        _launch(0, bytes32(uint256(2)), NATIVE, 10_001);
        vm.expectRevert(AutistikInstantLaunchV2.RewardNotAllowed.selector);
        _launch(0, bytes32(uint256(2)), address(0x1234), 5000);
    }

    // ---------------------------------------------------------------- rewards in the chain's coin

    function test_nativeRewards_splitByHoldings() public {
        address t = _launch(1 ether, bytes32(uint256(3)), NATIVE, 5000); // creator holds 10M
        _buy(buyer, t, 1 ether); // buyer holds 10M
        AutistikInstantTokenV2 c = AutistikInstantTokenV2(payable(t));
        assertEq(c.eligibleSupply(), 20_000_000 ether); // the pool doesn't count
        _fees(t, 0.4 ether);
        uint256 c0 = creator.balance;
        pad.collectFees(t);
        // creator part 0.2: half (0.1) to holders, 0.1 to the creator; AUTISTIK 0.2
        assertEq(creator.balance - c0, 0.1 ether);
        assertEq(treasury.balance, 0.2 ether);
        assertEq(t.balance, 0.1 ether);
        assertEq(c.withdrawableRewards(creator), 0.05 ether);
        assertEq(c.withdrawableRewards(buyer), 0.05 ether);
        assertEq(c.withdrawableRewards(c.pool()), 0);
        uint256 b0 = buyer.balance;
        vm.prank(buyer);
        c.claim();
        assertEq(buyer.balance - b0, 0.05 ether);
        assertEq(c.withdrawableRewards(buyer), 0);
        vm.prank(buyer);
        assertEq(c.claim(), 0); // nothing twice
    }

    function test_rewardsFollowHoldings_afterTransfer() public {
        address t = _launch(1 ether, bytes32(uint256(4)), NATIVE, 10_000);
        _buy(buyer, t, 1 ether);
        AutistikInstantTokenV2 c = AutistikInstantTokenV2(payable(t));
        _fees(t, 0.4 ether); // creator part 0.2, all to holders
        pad.collectFees(t);
        // buyer sends everything to `other`: what buyer earned stays buyer's
        vm.prank(buyer);
        IERC20(t).transfer(other, 10_000_000 ether);
        assertEq(c.withdrawableRewards(buyer), 0.1 ether);
        assertEq(c.withdrawableRewards(other), 0);
        _fees(t, 0.4 ether);
        pad.collectFees(t);
        assertEq(c.withdrawableRewards(buyer), 0.1 ether);
        assertEq(c.withdrawableRewards(other), 0.1 ether);
        assertEq(c.withdrawableRewards(creator), 0.2 ether);
        // selling into the pool takes the coins out of the reward count
        address pool = c.pool();
        vm.prank(other);
        IERC20(t).transfer(pool, 10_000_000 ether);
        assertEq(c.eligibleSupply(), 10_000_000 ether);
        _fees(t, 0.4 ether);
        pad.collectFees(t);
        assertEq(c.withdrawableRewards(other), 0.1 ether);
        assertEq(c.withdrawableRewards(creator), 0.4 ether);
        // everything paid in can be paid out
        uint256 owedAll = c.withdrawableRewards(buyer) + c.withdrawableRewards(other) + c.withdrawableRewards(creator);
        assertLe(owedAll, t.balance);
        assertApproxEqAbs(owedAll, t.balance, 10);
    }

    // ---------------------------------------------------------------- rewards in a token

    function test_tokenRewards_bought_andClaimed() public {
        address t = _launch(1 ether, bytes32(uint256(5)), address(usdt), 5000);
        _buy(buyer, t, 3 ether); // 30M, creator 10M
        AutistikInstantTokenV2 c = AutistikInstantTokenV2(payable(t));
        _fees(t, 0.4 ether);
        pad.collectFees(t);
        // holders' 0.1 BNB buys 100 USDT, split 1:3
        assertEq(usdt.balanceOf(t), 100 ether);
        assertEq(c.withdrawableRewards(creator), 25 ether);
        assertEq(c.withdrawableRewards(buyer), 75 ether);
        vm.prank(other);
        c.claimFor(buyer); // anyone can push it; it always goes to the holder
        assertEq(usdt.balanceOf(buyer), 75 ether);
        assertEq(usdt.balanceOf(other), 0);
    }

    function test_tokenRewards_swapDown_keptAndRetried() public {
        address t = _launch(1 ether, bytes32(uint256(6)), address(usdt), 5000);
        AutistikInstantTokenV2 c = AutistikInstantTokenV2(payable(t));
        router.setRewardsDown(true);
        _fees(t, 0.4 ether);
        pad.collectFees(t); // still pays the creator and AUTISTIK
        assertEq(treasury.balance, 0.2 ether);
        assertEq(pad.rewardPending(t), 0.1 ether);
        assertEq(address(pad).balance, 0.1 ether);
        router.setRewardsDown(false);
        _fees(t, 0.4 ether);
        pad.collectFees(t);
        assertEq(pad.rewardPending(t), 0);
        assertEq(usdt.balanceOf(t), 200 ether);
        assertEq(c.withdrawableRewards(creator), 200 ether);
        assertEq(address(pad).balance, 0);
    }

    function test_noHolders_yet_pending() public {
        address t = _launch(0, bytes32(uint256(7)), NATIVE, 5000); // nobody holds yet
        _buy(buyer, t, 1 ether);
        vm.prank(buyer);
        IERC20(t).transfer(address(0xdEaD), 10_000_000 ether); // burned: dead never earns
        _fees(t, 0.4 ether);
        pad.collectFees(t);
        assertEq(pad.rewardPending(t), 0.1 ether);
        _buy(other, t, 1 ether);
        _fees(t, 0.2 ether);
        pad.collectFees(t);
        assertEq(pad.rewardPending(t), 0);
        assertEq(AutistikInstantTokenV2(payable(t)).withdrawableRewards(other), 0.15 ether);
    }

    function test_dustHolder_cantBreakRewards() public {
        address t = _launch(0, bytes32(uint256(17)), NATIVE, 5000);
        _buy(buyer, t, 1 ether);
        address pool = c_pool(t);
        vm.prank(buyer);
        IERC20(t).transfer(pool, 10_000_000 ether - 1); // sells all but 1 wei
        _fees(t, 0.4 ether);
        pad.collectFees(t);
        assertEq(pad.rewardPending(t), 0.1 ether); // waits
        vm.warp(block.timestamp + 5 minutes);
        _buy(other, t, 5 ether); // big buys still work
        _fees(t, 0.2 ether);
        pad.collectFees(t);
        assertEq(pad.rewardPending(t), 0);
        AutistikInstantTokenV2 c = AutistikInstantTokenV2(payable(t));
        assertApproxEqAbs(c.withdrawableRewards(other), 0.15 ether, 1e6);
    }

    function c_pool(address t) internal view returns (address) { return AutistikInstantTokenV2(payable(t)).pool(); }

    // ---------------------------------------------------------------- safety

    function test_onlyLauncherAddsRewards() public {
        address t = _launch(0, bytes32(uint256(8)), NATIVE, 5000);
        AutistikInstantTokenV2 c = AutistikInstantTokenV2(payable(t));
        vm.prank(buyer);
        vm.expectRevert(AutistikInstantTokenV2.OnlyLauncher.selector);
        c.addRewards{value: 1 ether}(1 ether);
        vm.prank(buyer);
        (bool ok,) = t.call{value: 1 ether}("");
        assertFalse(ok);
        vm.expectRevert(AutistikInstantTokenV2.OnlyLauncher.selector);
        c.start();
        vm.expectRevert(AutistikInstantTokenV2.OnlyLauncher.selector);
        c.setPool(address(1));
    }

    function test_antiSnipe_stillOn() public {
        address t = _launch(0, bytes32(uint256(9)), NATIVE, 5000);
        _buy(buyer, t, 1 ether);
        vm.prank(buyer);
        vm.expectRevert();
        router.exactInputSingle{value: 1.5 ether}(ISwapRouterV3V2.ExactInputSingleParams(address(weth), t, 10_000, buyer, block.timestamp, 0, 0, 0));
        vm.warp(block.timestamp + 5 minutes);
        _buy(buyer, t, 3 ether);
        assertEq(IERC20(t).balanceOf(buyer), 40_000_000 ether);
    }

    function test_creatorBuyCapped() public {
        vm.expectRevert(AutistikInstantLaunchV2.CreatorBuyTooBig.selector);
        _launch(6 ether, bytes32(uint256(10)), NATIVE, 5000);
    }

    function test_tokenForMatches_andFrontRunRefused() public {
        bytes32 salt = bytes32(uint256(11));
        address want = pad.tokenFor(creator, salt, "Instant Dog", "IDOG", address(usdt));
        assertEq(_launch(0, salt, address(usdt), 2500), want);
        bytes32 s2 = bytes32(uint256(12));
        address t2 = pad.tokenFor(creator, s2, "Instant Dog", "IDOG", address(0));
        (address a, address b) = t2 < address(weth) ? (t2, address(weth)) : (address(weth), t2);
        npm.createAndInitializePoolIfNecessary(a, b, 10_000, 1 << 60);
        vm.expectRevert(AutistikInstantLaunchV2.PoolTaken.selector);
        _launch(0, s2, address(0), 0);
    }

    function test_tokenIsToken1_side() public {
        setUpWith(address(0x0000000000000000000000000000000000000F00));
        npm.setTick(160_123);
        address t = _launch(1 ether, bytes32(uint256(13)), NATIVE, 5000);
        (,, uint256 id,,,) = pad.coinOf(t);
        (,, int24 lo, int24 hi, uint256 a0, uint256 a1,) = npm.pos(id);
        assertEq(lo, -887_200);
        assertEq(hi, 160_000);
        assertEq(a0, 0);
        assertEq(a1, 1_000_000_000 ether);
        _fees(t, 0.4 ether);
        pad.collectFees(t);
        assertEq(AutistikInstantTokenV2(payable(t)).withdrawableRewards(creator), 0.1 ether);
    }

    function test_noRouterChain_nativeOnly_noFirstBuy() public {
        address[] memory rt = new address[](1); rt[0] = address(usdt);
        uint24[] memory rf = new uint24[](1); rf[0] = 500;
        AutistikInstantLaunchV2 rh = new AutistikInstantLaunchV2(address(npm), address(0), address(this), treasury, 2 ether, 5000, address(0), rt, rf);
        assertEq(rh.rewardFee(address(usdt)), 0);
        vm.prank(creator);
        vm.expectRevert(AutistikInstantLaunchV2.RewardNotAllowed.selector);
        rh.launch("A", "A", bytes32(uint256(1)), 0, "", block.timestamp + 60, address(usdt), 5000);
        vm.prank(creator);
        vm.expectRevert(AutistikInstantLaunchV2.NoFirstBuyHere.selector);
        rh.launch{value: 1 ether}("A", "A", bytes32(uint256(1)), 0, "", block.timestamp + 60, NATIVE, 5000);
        vm.prank(creator);
        rh.launch("A", "A", bytes32(uint256(1)), 0, "", block.timestamp + 60, NATIVE, 5000);
        vm.expectRevert(AutistikInstantLaunchV2.BadSettings.selector);
        rh.setRewardToken(address(usdt), 500);
    }

    function test_permitRequired() public {
        pad.setEligibilitySigner(vm.addr(signerKey));
        bytes32 salt = bytes32(uint256(14));
        vm.expectRevert();
        _launch(0, salt, NATIVE, 5000);
        uint256 dl = block.timestamp + 600;
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, MessageHashUtils.toEthSignedMessageHash(pad.permitHash(creator, salt, dl)));
        vm.prank(creator);
        pad.launch("Instant Dog", "IDOG", salt, dl, abi.encodePacked(r, s, v), block.timestamp + 60, NATIVE, 5000);
    }

    function test_ownerManagesRewardList() public {
        MockToken cake = new MockToken("CAKE", 18);
        vm.prank(buyer);
        vm.expectRevert(AutistikInstantLaunchV2.NotOwner.selector);
        pad.setRewardToken(address(cake), 2500);
        pad.setRewardToken(address(cake), 2500);
        _launch(0, bytes32(uint256(15)), address(cake), 5000);
        pad.setRewardToken(address(cake), 0);
        vm.expectRevert(AutistikInstantLaunchV2.RewardNotAllowed.selector);
        _launch(0, bytes32(uint256(16)), address(cake), 5000);
    }
}
