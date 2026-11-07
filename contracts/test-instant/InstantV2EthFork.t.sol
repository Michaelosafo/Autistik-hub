// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../src/AutistikInstantLaunchV2.sol";

import {Sink, IV3Factory} from "./InstantV2Fork.t.sol";

/// Instant v2 on a copy of Ethereum: real Uniswap v3, real USDC and USDT. Run with ETH_RPC set.
contract InstantV2EthForkTest is Test {
    address constant NPM = 0xC36442b4a4522E871399CD717aBDD847Ab11FE88;
    address constant ROUTER = 0xE592427A0AEce92De3Edee1F18E0157C05861564;
    address constant FACTORY = 0x1F98431c8aD98523631AE4a59f267346ea31F984;
    address constant WBNB = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address constant USDT = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address constant CAKE = 0xdAC17F958D2ee523a2206206994597C13D831ec7;
    address constant NATIVE = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    AutistikInstantLaunchV2 pad;
    address treasury;
    address creator = makeAddr("creator");
    address b1 = makeAddr("b1");
    address b2 = makeAddr("b2");
    bool on;

    function setUp() public {
        string memory rpc = vm.envOr("ETH_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        on = true;
        treasury = address(new Sink());
        address[] memory rt = new address[](2); rt[0] = USDT; rt[1] = CAKE;
        uint24[] memory rf = new uint24[](2); rf[0] = 500; rf[1] = 500;
        pad = new AutistikInstantLaunchV2(NPM, ROUTER, address(this), treasury, 2 ether, 5000, address(0), rt, rf);
        vm.deal(creator, 10 ether); vm.deal(b1, 10 ether); vm.deal(b2, 10 ether);
    }

    function _buy(address who, address t, uint256 v) internal returns (uint256) {
        vm.prank(who);
        return ISwapRouterV3V2(ROUTER).exactInputSingle{value: v}(ISwapRouterV3V2.ExactInputSingleParams(WBNB, t, 10_000, who, block.timestamp, v, 0, 0));
    }

    function _sell(address who, address t, uint256 a) internal {
        vm.startPrank(who);
        IERC20(t).approve(ROUTER, a);
        ISwapRouterV3V2(ROUTER).exactInputSingle(ISwapRouterV3V2.ExactInputSingleParams(t, WBNB, 10_000, who, block.timestamp, a, 0, 0));
        vm.stopPrank();
    }

    function _trade(address t) internal {
        vm.warp(block.timestamp + 5 minutes);
        _buy(b1, t, 2 ether);
        _buy(b2, t, 1 ether);
        _sell(b1, t, IERC20(t).balanceOf(b1) / 2);
    }

    function _run(address reward) internal {
        if (!on) { vm.skip(true); return; }
        assertTrue(reward == NATIVE || IV3Factory(FACTORY).getPool(WBNB, reward, pad.rewardFee(reward)) != address(0), "reward pool");
        vm.prank(creator);
        address t = pad.launch{value: 0.05 ether}("Fork Dog", "FDOG", keccak256(abi.encode(reward)), 0, "", block.timestamp + 60, reward, 5000);
        AutistikInstantTokenV2 c = AutistikInstantTokenV2(payable(t));
        assertGt(IERC20(t).balanceOf(creator), 0, "creator buy");
        assertEq(c.eligibleSupply(), IERC20(t).balanceOf(creator), "only the creator counts");
        _trade(t);
        assertEq(c.eligibleSupply(), IERC20(t).balanceOf(creator) + IERC20(t).balanceOf(b1) + IERC20(t).balanceOf(b2), "eligible = holders");

        uint256 cr0 = creator.balance;
        uint256 tr0 = treasury.balance;
        pad.collectFees(t);
        uint256 toCreator = creator.balance - cr0;
        uint256 toTeam = treasury.balance - tr0;
        assertGt(toTeam, 0, "team share");
        assertApproxEqAbs(toCreator, toTeam / 2, 2, "creator gets half of their 50% (rest to holders)");
        assertEq(pad.rewardPending(t), 0, "reward bought");
        uint256 paid = reward == NATIVE ? t.balance : IERC20(reward).balanceOf(t);
        assertGt(paid, 0, "rewards in the coin");
        assertEq(c.totalRewardsDistributed(), paid);
        console.log("fees to team (wei)", toTeam);
        console.log("holders' rewards paid in (reward units)", paid);

        uint256 w1 = c.withdrawableRewards(b1);
        uint256 w2 = c.withdrawableRewards(b2);
        uint256 wc = c.withdrawableRewards(creator);
        assertLe(w1 + w2 + wc, paid);
        assertApproxEqAbs(w1 + w2 + wc, paid, 5);
        assertEq(c.withdrawableRewards(c.pool()), 0);
        uint256 before = reward == NATIVE ? b2.balance : IERC20(reward).balanceOf(b2);
        vm.prank(b2);
        c.claim();
        uint256 got = (reward == NATIVE ? b2.balance : IERC20(reward).balanceOf(b2)) - before;
        assertEq(got, w2);
        // more trading, more rewards
        _buy(b2, t, 1 ether);
        pad.collectFees(t);
        assertGt(c.withdrawableRewards(b2), 0);
        assertEq(address(pad).balance, 0, "nothing left behind");
    }

    function test_fork_usdcRewards() public { _run(USDT); }
    function test_fork_usdtRewards() public { _run(CAKE); }
    function test_fork_ethRewards() public { _run(NATIVE); }

    function test_fork_noRewards() public {
        if (!on) { vm.skip(true); return; }
        vm.prank(creator);
        address t = pad.launch{value: 0.05 ether}("Plain", "PLN", bytes32(0), 0, "", block.timestamp + 60, address(0), 0);
        _trade(t);
        uint256 cr0 = creator.balance;
        uint256 tr0 = treasury.balance;
        pad.collectFees(t);
        assertApproxEqAbs(creator.balance - cr0, treasury.balance - tr0, 2);
        assertEq(AutistikInstantTokenV2(payable(t)).totalRewardsDistributed(), 0);
    }
}
