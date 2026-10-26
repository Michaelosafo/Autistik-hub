// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import "forge-std/Test.sol";
import "./Mocks.sol";
import {AutistikLaunchpadV4, AutistikToken} from "../src/AutistikLaunchpadV4.sol";

contract V4Test is Test {
    MockWETH weth;
    MockFactory factory;
    MockRouter router;
    MockLocker locker;
    MockToken usd;
    MockToken btc;
    MockToken junk;
    AutistikLaunchpadV4 pad;
    address constant NATIVE = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    address owner = address(0xA11CE);
    address creator = address(0xC0FFEE);
    address taxWallet = address(0x7A7);
    address[] buyers;

    function setUp() public {
        vm.warp(1_700_000_000);
        weth = new MockWETH();
        factory = new MockFactory();
        router = new MockRouter(address(factory), address(weth));
        locker = new MockLocker();
        usd = new MockToken("USD", 6);
        btc = new MockToken("BTC", 18);
        junk = new MockToken("JUNK", 18);
        // BTC/WETH pool: 1 BTC = 20 coin
        btc.mint(address(this), 1_000 ether);
        vm.deal(address(this), 100_000 ether);
        weth.deposit{value: 20_000 ether}();
        btc.approve(address(router), type(uint256).max);
        weth.approve(address(router), type(uint256).max);
        router.addLiquidity(address(btc), address(weth), 1_000 ether, 20_000 ether);

        address[] memory rewards = new address[](1);
        rewards[0] = address(btc);
        pad = new AutistikLaunchpadV4(AutistikLaunchpadV4.Config({
            owner: owner, router: address(router), locker: address(locker), stablecoin: address(usd),
            team: address(0x7EA), marketing: address(0x3A3), burner: address(0xB0B),
            launchFee: 0.01 ether, maxLaunchFee: 1 ether, platformFee: 30, minLiquidity: 0.1 ether,
            maxWhitelistNative: 1 ether, eligibilitySigner: address(0), rewardTokens: rewards
        }));
        for (uint256 i; i < 40; i++) buyers.push(address(uint160(0x10000 + i)));
    }

    function _launch(address reward, uint256 holderBps, uint256 tax) internal returns (AutistikToken t) {
        AutistikLaunchpadV4.LaunchParams memory p;
        p.name = "Test"; p.symbol = "TST"; p.supply = 1_000_000_000 ether; p.creatorBps = 500;
        p.buyTax = tax; p.sellTax = tax; p.taxWallet = taxWallet; p.lockOption = 1;
        p.rewardToken = reward; p.holderBps = holderBps;
        p.maxFeeAccepted = 1 ether; p.deadline = block.timestamp + 1; p.permitDeadline = block.timestamp + 1;
        p.salt = keccak256(abi.encode(reward, holderBps, tax));
        vm.deal(creator, 100 ether);
        vm.prank(creator);
        t = AutistikToken(payable(pad.launch{value: 10 ether}(p, "")));
        vm.prank(creator);
        t.openTrading();
        vm.warp(block.timestamp + 10 minutes); // past the anti-snipe window
    }

    function _buy(AutistikToken t, address who, uint256 coin) internal {
        vm.deal(who, who.balance + coin);
        address[] memory path = new address[](2);
        path[0] = address(weth); path[1] = address(t);
        vm.prank(who);
        router.swapExactETHForTokensSupportingFeeOnTransferTokens{value: coin}(0, path, who, block.timestamp);
    }

    function _sell(AutistikToken t, address who, uint256 amount) internal {
        address[] memory path = new address[](2);
        path[0] = address(t); path[1] = address(weth);
        vm.startPrank(who);
        t.approve(address(router), amount);
        router.swapExactTokensForETHSupportingFeeOnTransferTokens(amount, 0, path, who, block.timestamp);
        vm.stopPrank();
    }

    function _trade(AutistikToken t, uint256 rounds) internal {
        for (uint256 r; r < rounds; r++) {
            for (uint256 i; i < 10; i++) _buy(t, buyers[i], 0.5 ether);
            for (uint256 i; i < 10; i++) _sell(t, buyers[i], t.balanceOf(buyers[i]) / 3);
            vm.warp(block.timestamp + 2 hours);
        }
    }

    // --------------------------------------------------------------------------------------------

    function test_noRewardsWorksLikeBefore() public {
        AutistikToken t = _launch(address(0), 0, 500);
        assertEq(t.rewardToken(), address(0));
        uint256 before = taxWallet.balance;
        _trade(t, 3);
        assertGt(taxWallet.balance, before);
        assertEq(t.totalRewardsDistributed(), 0);
        assertEq(t.withdrawableRewards(buyers[0]), 0);
    }

    function test_nativeRewardsPaidAndClaimable() public {
        AutistikToken t = _launch(NATIVE, 6_000, 500); // 5% tax, 60% of it to holders
        _trade(t, 4);
        uint256 dist = t.totalRewardsDistributed();
        assertGt(dist, 0, "rewards distributed");
        // holders got coin automatically or can claim it
        uint256 total;
        address[] memory everyone = new address[](11);
        for (uint256 i; i < 10; i++) everyone[i] = buyers[i];
        everyone[10] = creator;
        for (uint256 i; i < everyone.length; i++) total += t.totalRewardsEarned(everyone[i]);
        assertApproxEqAbs(total, dist, 1e6, "earned == distributed");
        uint256 c = t.withdrawableRewards(creator);
        uint256 b = creator.balance;
        vm.prank(creator);
        t.claimRewards();
        assertEq(creator.balance - b, c);
        assertEq(t.withdrawableRewards(creator), 0);
        // the token contract holds enough coin for everything still owed
        uint256 owedAll;
        for (uint256 i; i < everyone.length; i++) owedAll += t.withdrawableRewards(everyone[i]);
        assertGe(address(t).balance, owedAll);
        // excluded
        assertEq(t.rewardShares(t.pair()), 0);
        assertEq(t.rewardShares(address(pad)), 0);
        assertEq(t.rewardShares(address(t)), 0);
    }

    function test_autoPayoutHappens() public {
        AutistikToken t = _launch(NATIVE, 10_000, 500);
        _trade(t, 3);
        uint256 auto_;
        for (uint256 i; i < 10; i++) auto_ += t.rewardsWithdrawn(buyers[i]);
        auto_ += t.rewardsWithdrawn(creator);
        assertGt(auto_, 0, "some paid automatically");
    }

    function test_btcRewards() public {
        AutistikToken t = _launch(address(btc), 5_000, 800);
        _trade(t, 3);
        assertGt(t.totalRewardsDistributed(), 0);
        uint256 c = t.withdrawableRewards(creator);
        uint256 got = btc.balanceOf(creator);
        vm.prank(creator);
        t.claimRewards();
        assertEq(btc.balanceOf(creator) - got, c);
        assertGt(btc.balanceOf(creator), 0);
    }

    function test_rewardTokenMustBeAllowed() public {
        AutistikLaunchpadV4.LaunchParams memory p;
        p.name = "Test"; p.symbol = "TST"; p.supply = 1_000_000_000 ether; p.buyTax = 500; p.sellTax = 500;
        p.taxWallet = taxWallet; p.rewardToken = address(junk); p.holderBps = 5_000;
        p.maxFeeAccepted = 1 ether; p.deadline = block.timestamp + 1;
        vm.deal(creator, 10 ether);
        vm.prank(creator);
        vm.expectRevert(AutistikLaunchpadV4.RewardNotAllowed.selector);
        pad.launch{value: 5 ether}(p, "");
        // no tax → no rewards possible
        p.rewardToken = NATIVE; p.buyTax = 0; p.sellTax = 0;
        vm.prank(creator);
        vm.expectRevert(AutistikLaunchpadV4.FeeTooHigh.selector);
        pad.launch{value: 5 ether}(p, "");
        // only the owner allows tokens
        vm.expectRevert(AutistikLaunchpadV4.NotOwner.selector);
        pad.setRewardToken(address(junk), true);
        vm.prank(owner);
        pad.setRewardToken(address(junk), true);
        assertTrue(pad.rewardAllowed(address(junk)));
    }

    function test_missingPoolSendsToTaxWallet() public {
        vm.prank(owner);
        pad.setRewardToken(address(junk), true); // allowed but no pool
        AutistikToken t = _launch(address(junk), 5_000, 500);
        uint256 before = taxWallet.balance;
        _trade(t, 2);
        assertEq(t.totalRewardsDistributed(), 0);
        assertGt(taxWallet.balance, before);
    }

    function test_contractThatRejectsCoinDoesNotBlockTrades() public {
        AutistikToken t = _launch(NATIVE, 10_000, 500);
        NoReceive nr = new NoReceive();
        _buy(t, buyers[20], 2 ether);
        uint256 bal = t.balanceOf(buyers[20]);
        vm.prank(buyers[20]);
        t.transfer(address(nr), bal);
        _trade(t, 3);
        assertGt(t.withdrawableRewards(address(nr)), 0); // stays owed, trades kept working
    }

    function test_transferMovesFutureRewardsOnly() public {
        AutistikToken t = _launch(NATIVE, 10_000, 500);
        _trade(t, 2);
        address a = buyers[30];
        address b = buyers[31];
        _buy(t, a, 3 ether);
        _trade(t, 1);
        uint256 earnedA = t.totalRewardsEarned(a);
        assertGt(earnedA, 0);
        uint256 bal = t.balanceOf(a);
        vm.prank(a);
        t.transfer(b, bal);
        assertEq(t.totalRewardsEarned(a), earnedA, "a keeps what it earned");
        assertEq(t.totalRewardsEarned(b), 0, "b starts at zero");
        assertEq(t.rewardShares(a), 0);
        assertEq(t.rewardShares(b), bal);
        _trade(t, 1);
        assertEq(t.totalRewardsEarned(a), earnedA);
        assertGt(t.totalRewardsEarned(b), 0);
    }

    function test_holderListTracksBalances() public {
        AutistikToken t = _launch(NATIVE, 10_000, 500);
        uint256 n0 = t.rewardHolders();
        _buy(t, buyers[35], 1 ether);
        assertEq(t.rewardHolders(), n0 + 1);
        _sell(t, buyers[35], t.balanceOf(buyers[35]));
        assertEq(t.rewardHolders(), n0);
    }

    function test_gasStaysBoundedWithManyHolders() public {
        AutistikToken t = _launch(address(btc), 10_000, 500);
        for (uint256 i; i < 40; i++) _buy(t, buyers[i], 0.3 ether);
        _trade(t, 2);
        vm.warp(block.timestamp + 2 hours);
        _buy(t, buyers[0], 1 ether);
        uint256 amt = t.balanceOf(buyers[0]) / 2;
        address[] memory path = new address[](2);
        path[0] = address(t); path[1] = address(weth);
        vm.startPrank(buyers[0]);
        t.approve(address(router), amt);
        uint256 g = gasleft();
        router.swapExactTokensForETHSupportingFeeOnTransferTokens(amt, 0, path, buyers[0], block.timestamp);
        uint256 used = g - gasleft();
        vm.stopPrank();
        emit log_named_uint("sell gas with 41 holders, BTC rewards", used);
        assertLt(used, 900_000);
    }

    function test_creatorCannotDivertHolderShare() public {
        AutistikToken t = _launch(NATIVE, 7_000, 500);
        vm.prank(creator);
        t.setTaxWallet(address(0xBEEF));
        assertEq(t.holderBps(), 7_000);
        assertEq(t.rewardToken(), NATIVE);
    }

    receive() external payable {}
}
