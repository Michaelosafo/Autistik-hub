// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @notice Token for the Hub owner admin session. Trading stays closed until the owner opens it, so the first buy can land first. No tax.
contract AdminDirectToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    address public owner;
    bool public tradingLive;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory n, string memory s, uint256 supply) {
        require(bytes(n).length > 0 && bytes(n).length <= 32, "name");
        require(bytes(s).length > 0 && bytes(s).length <= 12, "symbol");
        require(supply > 0, "supply");
        name = n;
        symbol = s;
        owner = msg.sender;
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
        unchecked {
            balanceOf[from] = bal - value;
            balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
        return true;
    }
}
