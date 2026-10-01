// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Educational constant-product ETH/BAL exchange for Speedrun Ethereum.
contract DEX is ReentrancyGuard {
    error DexAlreadyInitialized();
    error PoolNotInitialized();
    error InvalidEthAmount();
    error InvalidTokenAmount();
    error InvalidTokenAddress();
    error InvalidLiquidityAmount();
    error TokenTransferFailed();
    error InsufficientTokenBalance(uint256 available, uint256 required);
    error InsufficientTokenAllowance(uint256 available, uint256 required);
    error InsufficientLiquidity(uint256 available, uint256 required);
    error EthTransferFailed(address to, uint256 amount);

    IERC20 public immutable token;
    uint256 public totalLiquidity;
    mapping(address => uint256) public liquidity;
    bool private initialized;

    event EthToTokenSwap(address swapper, uint256 tokenOutput, uint256 ethInput);
    event TokenToEthSwap(address swapper, uint256 tokensInput, uint256 ethOutput);
    event LiquidityProvided(address liquidityProvider, uint256 liquidityMinted, uint256 ethInput, uint256 tokensInput);
    event LiquidityRemoved(
        address liquidityRemover,
        uint256 liquidityWithdrawn,
        uint256 tokensOutput,
        uint256 ethOutput
    );

    constructor(address tokenAddr) {
        if (tokenAddr == address(0)) revert InvalidTokenAddress();
        token = IERC20(tokenAddr);
    }

    function init(uint256 tokens) public payable nonReentrant returns (uint256 initialLiquidity) {
        if (initialized) revert DexAlreadyInitialized();
        if (msg.value == 0) revert InvalidEthAmount();
        if (tokens == 0) revert InvalidTokenAmount();
        initialized = true;
        initialLiquidity = address(this).balance;
        totalLiquidity = initialLiquidity;
        liquidity[msg.sender] = initialLiquidity;
        if (!token.transferFrom(msg.sender, address(this), tokens)) revert TokenTransferFailed();
    }

    function price(uint256 xInput, uint256 xReserves, uint256 yReserves) public pure returns (uint256 yOutput) {
        uint256 inputWithFee = xInput * 997;
        return (inputWithFee * yReserves) / (xReserves * 1000 + inputWithFee);
    }

    function getLiquidity(address lp) public view returns (uint256 lpLiquidity) {
        return liquidity[lp];
    }

    function ethToToken() public payable nonReentrant returns (uint256 tokenOutput) {
        if (msg.value == 0) revert InvalidEthAmount();
        _requirePool();
        tokenOutput = price(msg.value, address(this).balance - msg.value, token.balanceOf(address(this)));
        if (!token.transfer(msg.sender, tokenOutput)) revert TokenTransferFailed();
        emit EthToTokenSwap(msg.sender, tokenOutput, msg.value);
    }

    function tokenToEth(uint256 tokenInput) public nonReentrant returns (uint256 ethOutput) {
        if (tokenInput == 0) revert InvalidTokenAmount();
        _requirePool();
        _requireTokens(tokenInput);
        ethOutput = price(tokenInput, token.balanceOf(address(this)), address(this).balance);
        if (!token.transferFrom(msg.sender, address(this), tokenInput)) revert TokenTransferFailed();
        (bool sent, ) = msg.sender.call{ value: ethOutput }("");
        if (!sent) revert EthTransferFailed(msg.sender, ethOutput);
        emit TokenToEthSwap(msg.sender, tokenInput, ethOutput);
    }

    function deposit() public payable nonReentrant returns (uint256 tokensDeposited) {
        if (msg.value == 0) revert InvalidEthAmount();
        _requirePool();
        uint256 ethReserve = address(this).balance - msg.value;
        tokensDeposited = (msg.value * token.balanceOf(address(this))) / ethReserve + 1;
        _requireTokens(tokensDeposited);
        uint256 liquidityMinted = (msg.value * totalLiquidity) / ethReserve;
        if (liquidityMinted == 0) revert InvalidLiquidityAmount();
        liquidity[msg.sender] += liquidityMinted;
        totalLiquidity += liquidityMinted;
        if (!token.transferFrom(msg.sender, address(this), tokensDeposited)) revert TokenTransferFailed();
        emit LiquidityProvided(msg.sender, liquidityMinted, msg.value, tokensDeposited);
    }

    function withdraw(uint256 amount) public nonReentrant returns (uint256 ethAmount, uint256 tokenAmount) {
        if (amount == 0) revert InvalidLiquidityAmount();
        uint256 available = liquidity[msg.sender];
        if (available < amount) revert InsufficientLiquidity(available, amount);
        ethAmount = (amount * address(this).balance) / totalLiquidity;
        tokenAmount = (amount * token.balanceOf(address(this))) / totalLiquidity;
        liquidity[msg.sender] -= amount;
        totalLiquidity -= amount;
        if (!token.transfer(msg.sender, tokenAmount)) revert TokenTransferFailed();
        (bool sent, ) = msg.sender.call{ value: ethAmount }("");
        if (!sent) revert EthTransferFailed(msg.sender, ethAmount);
        emit LiquidityRemoved(msg.sender, amount, tokenAmount, ethAmount);
    }

    function _requirePool() private view {
        if (totalLiquidity == 0) revert PoolNotInitialized();
    }

    function _requireTokens(uint256 amount) private view {
        uint256 available = token.balanceOf(msg.sender);
        if (available < amount) revert InsufficientTokenBalance(available, amount);
        uint256 approved = token.allowance(msg.sender, address(this));
        if (approved < amount) revert InsufficientTokenAllowance(approved, amount);
    }
}
