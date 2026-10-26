// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;
import "forge-std/Test.sol";
import "./Mocks.sol";
import {AutistikSusu} from "../src/AutistikSusu.sol";

contract SusuTest is Test {
    AutistikSusu s;
    MockToken usdt;
    MockToken busd;
    MockToken other;
    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    function setUp() public {
        vm.warp(1_700_000_000);
        usdt = new MockToken("USDT", 18);
        busd = new MockToken("BUSD", 18);
        other = new MockToken("X", 18);
        s = new AutistikSusu(address(usdt), address(busd), 1 ether, 10_000 ether);
        usdt.mint(alice, 1_000 ether);
        busd.mint(bob, 1_000 ether);
        vm.prank(alice); usdt.approve(address(s), type(uint256).max);
        vm.prank(bob); busd.approve(address(s), type(uint256).max);
    }

    function test_fullCycle() public {
        vm.prank(alice);
        uint256 id = s.open(address(usdt), 5 ether, 30);
        assertEq(usdt.balanceOf(address(s)), 5 ether);
        assertEq(s.due(id), 0); // day 1 paid
        vm.expectRevert(AutistikSusu.NothingDue.selector);
        vm.prank(alice); s.save(id, 1); // can't pay ahead
        for (uint256 d = 2; d <= 30; d++) {
            vm.warp(block.timestamp + 1 days);
            assertEq(s.due(id), 1);
            vm.prank(alice); s.save(id, 1);
        }
        vm.expectRevert(AutistikSusu.TooEarly.selector);
        vm.prank(alice); s.withdraw(id);
        vm.warp(block.timestamp + 1 days);
        vm.expectRevert(AutistikSusu.NotOwner.selector);
        vm.prank(bob); s.withdraw(id);
        uint256 b = usdt.balanceOf(alice);
        vm.prank(alice); s.withdraw(id);
        assertEq(usdt.balanceOf(alice) - b, 150 ether);
        vm.expectRevert(AutistikSusu.AlreadyWithdrawn.selector);
        vm.prank(alice); s.withdraw(id);
    }

    function test_catchUpMissedDays() public {
        vm.prank(alice);
        uint256 id = s.open(address(usdt), 2 ether, 10);
        vm.warp(block.timestamp + 4 days); // day 5, paid 1
        assertEq(s.due(id), 4);
        vm.expectRevert(AutistikSusu.NothingDue.selector);
        vm.prank(alice); s.save(id, 5);
        vm.prank(alice); s.save(id, 4);
        assertEq(s.due(id), 0);
        vm.warp(block.timestamp + 6 days); // ended
        assertEq(s.due(id), 0);
        vm.expectRevert(AutistikSusu.PlanEnded.selector);
        vm.prank(alice); s.save(id, 1);
        vm.prank(alice); s.withdraw(id);
        assertEq(usdt.balanceOf(alice), 1_000 ether);
    }

    function test_someoneElseCanHelp() public {
        vm.prank(alice);
        uint256 id = s.open(address(usdt), 1 ether, 7);
        vm.warp(block.timestamp + 1 days);
        usdt.mint(bob, 1 ether);
        vm.startPrank(bob); usdt.approve(address(s), 1 ether); s.save(id, 1); vm.stopPrank();
        vm.warp(block.timestamp + 7 days);
        vm.expectRevert(AutistikSusu.NotOwner.selector);
        vm.prank(bob); s.withdraw(id);
        vm.prank(alice); s.withdraw(id);
        assertEq(usdt.balanceOf(alice), 1_001 ether);
    }

    function test_limits() public {
        vm.startPrank(alice);
        vm.expectRevert(AutistikSusu.TokenNotAccepted.selector); s.open(address(other), 5 ether, 30);
        vm.expectRevert(AutistikSusu.BadAmount.selector); s.open(address(usdt), 0.5 ether, 30);
        vm.expectRevert(AutistikSusu.BadDays.selector); s.open(address(usdt), 5 ether, 6);
        vm.expectRevert(AutistikSusu.BadDays.selector); s.open(address(usdt), 5 ether, 366);
        vm.stopPrank();
        vm.prank(bob);
        uint256 id = s.open(address(busd), 3 ether, 7);
        (AutistikSusu.Plan memory p,,, uint256 saved,) = s.plan(id);
        assertEq(p.owner, bob); assertEq(saved, 3 ether);
        assertEq(s.plansOf(bob).length, 1);
    }

    function test_plansAreSeparate() public {
        vm.prank(alice); uint256 a = s.open(address(usdt), 10 ether, 7);
        vm.prank(bob); uint256 b = s.open(address(busd), 10 ether, 14);
        vm.warp(block.timestamp + 7 days);
        vm.prank(alice); s.withdraw(a);
        vm.expectRevert(AutistikSusu.TooEarly.selector);
        vm.prank(bob); s.withdraw(b);
        assertEq(busd.balanceOf(address(s)), 10 ether);
    }
}
