// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../src/AutistikInstantLaunchV2.sol";

contract Sink { receive() external payable {} }

interface IV3Factory { function getPool(address, address, uint24) external view returns (address); }

/// Instant v2 on a copy of BNB Chain: real PancakeSwap v3, real USDT and CAKE. Run with BSC_RPC set.
contract InstantV2ForkTest is Test {
    address constant NPM = 0x46A15B0b27311cedF172AB29E4f4766fbE7F4364;
    address constant ROUTER = 0x1b81D678ffb9C0263b24A97847620C99d213eB14;
    address constant FACTORY = 0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865;
    address constant WBNB = 0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c;
    address constant USDT = 0x55d398326f99059fF775485246999027B3197955;
    address constant CAKE = 0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82;
    address constant NATIVE = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

    AutistikInstantLaunchV2 pad;
    address treasury;
    address creator = makeAddr("creator");
    address b1 = makeAddr("b1");
    address b2 = makeAddr("b2");
    bool on;

    function setUp() public {
        string memory rpc = vm.envOr("BSC_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        on = true;
        treasury = address(new Sink());
        address[] memory rt = new address[](2); rt[0] = USDT; rt[1] = CAKE;
        uint24[] memory rf = new uint24[](2); rf[0] = 100; rf[1] = 2500;
        pad = new AutistikInstantLaunchV2(NPM, ROUTER, address(this), treasury, 6 ether, 5000, address(0), rt, rf);
        vm.deal(address(pad), 0); // some addresses already hold dust on mainnet
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
        address t = pad.launch{value: 0.2 ether}("Fork Dog", "FDOG", keccak256(abi.encode(reward)), 0, "", block.timestamp + 60, reward, 5000);
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

    function test_fork_usdtRewards() public { _run(USDT); }
    function test_fork_cakeRewards() public { _run(CAKE); }
    function test_fork_bnbRewards() public { _run(NATIVE); }

    function test_fork_noRewards() public {
        if (!on) { vm.skip(true); return; }
        vm.prank(creator);
        address t = pad.launch{value: 0.2 ether}("Plain", "PLN", bytes32(0), 0, "", block.timestamp + 60, address(0), 0);
        _trade(t);
        uint256 cr0 = creator.balance;
        uint256 tr0 = treasury.balance;
        pad.collectFees(t);
        assertApproxEqAbs(creator.balance - cr0, treasury.balance - tr0, 2);
        assertEq(AutistikInstantTokenV2(payable(t)).totalRewardsDistributed(), 0);
    }
}
