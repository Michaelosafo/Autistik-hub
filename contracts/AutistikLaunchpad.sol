// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IUniswapV2Router02 {
    function factory() external view returns (address);
    function WETH() external view returns (address);
    function addLiquidityETH(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity);
}

interface IUniswapV2Factory {
    function getPair(address tokenA, address tokenB) external view returns (address);
}

/// @notice The token every launch creates: fixed supply, 18 decimals, no owner, no mint, no tax, no blacklist.
contract AutistikLaunchToken is ERC20 {
    constructor(string memory name_, string memory symbol_, uint256 supply, address to) ERC20(name_, symbol_) {
        _mint(to, supply);
    }
}

/// @title AUTISTIK Launch Pad
/// @notice One transaction: create a token, give the creator their share, add the rest as liquidity on a
///         Uniswap V2 style DEX (PancakeSwap on BNB Chain, Uniswap on Ethereum, ...) and send the LP tokens to
///         the dead address so the liquidity can never be removed by anyone, including the launchpad owner.
/// @dev Deploy one per chain with that chain's V2 router.
contract AutistikLaunchpad {
    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 public constant MAX_CREATOR_BPS = 2000; // creator can keep at most 20% of supply
    uint256 public constant MIN_SUPPLY = 1_000 ether; // 1,000 tokens (18 decimals)
    uint256 public constant MAX_SUPPLY = 1_000_000_000_000_000 ether; // 1 quadrillion tokens

    IUniswapV2Router02 public immutable router;
    uint256 public immutable maxFee; // the owner can never set a launch fee above this
    uint256 public immutable minLiquidity; // smallest native-coin amount accepted for liquidity

    address public owner;
    address payable public treasury;
    uint256 public launchFee;
    uint256 public launches;

    event Launched(
        address indexed token,
        address indexed pair,
        address indexed creator,
        uint256 supply,
        uint256 creatorTokens,
        uint256 liquidityTokens,
        uint256 liquidityNative,
        uint256 lpBurned
    );
    event FeeChanged(uint256 fee);
    event TreasuryChanged(address treasury);
    event OwnershipTransferred(address previousOwner, address newOwner);

    error InvalidName();
    error InvalidSymbol();
    error InvalidSupply();
    error CreatorShareTooHigh();
    error NotEnoughLiquidity();
    error NotOwner();
    error FeeTooHigh();
    error ZeroAddress();
    error FeeTransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address router_, address payable treasury_, uint256 launchFee_, uint256 maxFee_, uint256 minLiquidity_) {
        if (router_ == address(0) || treasury_ == address(0)) revert ZeroAddress();
        if (launchFee_ > maxFee_) revert FeeTooHigh();
        router = IUniswapV2Router02(router_);
        treasury = treasury_;
        launchFee = launchFee_;
        maxFee = maxFee_;
        minLiquidity = minLiquidity_;
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    /// @param supply total supply in whole-token units times 1e18
    /// @param creatorBps share of supply sent to the creator, in basis points (100 = 1%)
    /// @dev msg.value = launchFee + native coin to pair with the tokens as liquidity.
    function launch(string calldata name_, string calldata symbol_, uint256 supply, uint256 creatorBps)
        external
        payable
        returns (address token, address pair)
    {
        uint256 nameLen = bytes(name_).length;
        uint256 symbolLen = bytes(symbol_).length;
        if (nameLen == 0 || nameLen > 32) revert InvalidName();
        if (symbolLen == 0 || symbolLen > 12) revert InvalidSymbol();
        if (supply < MIN_SUPPLY || supply > MAX_SUPPLY) revert InvalidSupply();
        if (creatorBps > MAX_CREATOR_BPS) revert CreatorShareTooHigh();
        uint256 fee = launchFee;
        if (msg.value < fee + minLiquidity || msg.value == fee) revert NotEnoughLiquidity();

        token = address(new AutistikLaunchToken(name_, symbol_, supply, address(this)));
        pair = _addLiquidityAndBurn(token, supply, creatorBps, msg.value - fee);

        if (fee > 0) {
            (bool ok,) = treasury.call{value: fee}("");
            if (!ok) revert FeeTransferFailed();
        }
    }

    function _addLiquidityAndBurn(address token, uint256 supply, uint256 creatorBps, uint256 liquidityNative)
        private
        returns (address pair)
    {
        uint256 creatorTokens = (supply * creatorBps) / 10_000;
        uint256 liquidityTokens = supply - creatorTokens;
        if (creatorTokens > 0) IERC20(token).transfer(msg.sender, creatorTokens);

        IERC20(token).approve(address(router), liquidityTokens);
        // Fresh token, so the pool is empty and the exact amounts are used. LP tokens go straight to DEAD.
        (,, uint256 lp) = router.addLiquidityETH{value: liquidityNative}(
            token, liquidityTokens, liquidityTokens, liquidityNative, DEAD, block.timestamp
        );
        pair = IUniswapV2Factory(router.factory()).getPair(token, router.WETH());
        unchecked {
            launches++;
        }
        emit Launched(token, pair, msg.sender, supply, creatorTokens, liquidityTokens, liquidityNative, lp);
    }

    function setLaunchFee(uint256 fee) external onlyOwner {
        if (fee > maxFee) revert FeeTooHigh();
        launchFee = fee;
        emit FeeChanged(fee);
    }

    function setTreasury(address payable treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasuryChanged(treasury_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }
}
