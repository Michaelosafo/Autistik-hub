// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IRageRouter {
    function factory() external view returns (address);
    function WETH() external view returns (address);
}

interface IRageFactory {
    function getPair(address, address) external view returns (address);
}

/// @notice Token for the Hub admin Rage flow. Trading stays closed until the owner opens it, so the first buy can
/// land first. Optional buy and sell tax (0–50%, default 0) taken when the V2 pair moves the tokens. The router is
/// chosen at deploy (PancakeSwap on BNB Chain, Uniswap V2 on Ethereum and Robinhood Chain) so liquidity can still be
/// removed while trading is closed.
contract AdminDirectToken {
    string public name;
    string public symbol;
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    address public owner;
    address public taxWallet;
    address public router;
    address public factory;
    address public weth;
    address public pair;
    bool public tradingLive;
    uint256 public buyTaxBps; // basis points, 0–5000 (0–50%)
    uint256 public sellTaxBps; // basis points, 0–5000 (0–50%)
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(
        string memory n,
        string memory s,
        uint256 supply,
        uint256 _buyTaxBps,
        uint256 _sellTaxBps,
        address _taxWallet,
        address _router
    ) {
        require(bytes(n).length > 0 && bytes(n).length <= 32, "name");
        require(bytes(s).length > 0 && bytes(s).length <= 12, "symbol");
        require(supply > 0, "supply");
        require(_buyTaxBps <= 5000, "buy tax too high");
        require(_sellTaxBps <= 5000, "sell tax too high");
        require(_router != address(0), "router");
        address f = IRageRouter(_router).factory();
        address w = IRageRouter(_router).WETH();
        require(f != address(0) && w != address(0), "router");
        name = n;
        symbol = s;
        owner = msg.sender;
        taxWallet = _taxWallet == address(0) ? msg.sender : _taxWallet;
        router = _router;
        factory = f;
        weth = w;
        buyTaxBps = _buyTaxBps;
        sellTaxBps = _sellTaxBps;
        totalSupply = supply;
        balanceOf[msg.sender] = supply;
        emit Transfer(address(0), msg.sender, supply);
    }

    /// Opens trading. Until then only the deployer and the DEX router can send or receive, so the first buy lands
    /// before anyone else, and liquidity can still be removed.
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

    /// The V2 pair, remembered the first time it exists. Buys come from it; sells go to it.
    function _pair() internal returns (address p) {
        p = pair;
        if (p != address(0)) return p;
        try IRageFactory(factory).getPair(address(this), weth) returns (address found) {
            if (found != address(0)) {
                pair = found;
                p = found;
            }
        } catch {}
    }

    function _transfer(address from, address to, uint256 value) internal returns (bool) {
        require(to != address(0), "to");
        if (!tradingLive) {
            // The router has to receive the tokens to give them back. Other buyers stay blocked.
            require(from == owner || to == owner || from == router || to == router, "not live");
        }
        uint256 bal = balanceOf[from];
        require(bal >= value, "balance");

        uint256 tax = 0;
        if (tradingLive && from != owner && to != owner && from != taxWallet && to != taxWallet && from != router && to != router) {
            address p = _pair();
            if (p != address(0) && from == p) tax = (value * buyTaxBps) / 10_000;
            else if (p != address(0) && to == p) tax = (value * sellTaxBps) / 10_000;
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
