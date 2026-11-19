// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Token for the Hub owner admin session. Trading stays closed until the owner opens it, so the first buy can land first. Optional buy and sell tax (0-50%, default 0).
contract AdminDirectToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    address public owner;
    address public taxWallet;
    bool public tradingLive;
    uint256 public buyTaxBps;  // basis points, 0-5000 (0-50%)
    uint256 public sellTaxBps; // basis points, 0-5000 (0-50%)
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory n, string memory s, uint256 supply, uint256 _buyTaxBps, uint256 _sellTaxBps, address _taxWallet) {
        require(bytes(n).length > 0 && bytes(n).length <= 32, "name");
        require(bytes(s).length > 0 && bytes(s).length <= 12, "symbol");
        require(supply > 0, "supply");
        require(_buyTaxBps <= 5000, "buy tax too high");
        require(_sellTaxBps <= 5000, "sell tax too high");
        name = n;
        symbol = s;
        owner = msg.sender;
        taxWallet = _taxWallet == address(0) ? msg.sender : _taxWallet;
        buyTaxBps = _buyTaxBps;
        sellTaxBps = _sellTaxBps;
        totalSupply = supply;
        balanceOf[msg.sender] = supply;
        emit Transfer(address(0), msg.sender, supply);
    }

    /// Opens trading. Until then only the deployer can send or receive, so the first buy lands before anyone else.
    function enableTrading() external {
        require(msg.sender == owner, "owner");
        tradingLive = true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        return _transfer(msg.sender, to, value);
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= value, "allowance");
            allowance[from][msg.sender] = allowed - value;
        }
        return _transfer(from, to, value);
    }

    function _transfer(address from, address to, uint256 value) internal returns (bool) {
        require(to != address(0), "to");
        if (!tradingLive) {
            // The PancakeSwap router has to receive the tokens to give them back. Other buyers stay blocked.
            require(from == owner || to == owner || from == 0x10ED43C718714eb63d5aA57B78B54704E256024E || to == 0x10ED43C718714eb63d5aA57B78B54704E256024E, "not live");
        }
        uint256 bal = balanceOf[from];
        require(bal >= value, "balance");

        uint256 tax = 0;
        if (tradingLive && from != owner && to != owner && from != taxWallet && to != taxWallet) {
            address router = 0x10ED43C718714eb63d5aA57B78B54704E256024E;
            if (from == router) {
                tax = (value * buyTaxBps) / 10000; // buy
            } else if (to == router) {
                tax = (value * sellTaxBps) / 10000; // sell
            }
        }

        unchecked {
            balanceOf[from] = bal - value;
            if (tax > 0) {
                balanceOf[taxWallet] += tax;
                emit Transfer(from, taxWallet, tax);
                value -= tax;
            }
            balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
        return true;
    }
}
