pragma solidity 0.8.20; //Do not change the solidity version as it negatively impacts submission grading
// SPDX-License-Identifier: MIT

import "@openzeppelin/contracts/access/Ownable.sol";
import "./YourToken.sol";

contract Vendor is Ownable {
    /////////////////
    /// Errors //////
    /////////////////
 
    error InvalidEthAmount();
    error InsufficientVendorTokenBalance(uint256 available, uint256 required);
    error InvalidTokenAmount();
    error InsufficientVendorEthBalance(uint256 available, uint256 required);
    error EthTransferFailed(address to, uint256 amount);

    //////////////////////
    /// State Variables //
    //////////////////////

    YourToken public immutable yourToken;
    uint256 public constant tokensPerEth = 100;

    ////////////////
    /// Events /////
    ////////////////

    event BuyTokens(address indexed buyer, uint256 amountOfETH, uint256 amountOfTokens);
    event SellTokens(address indexed seller, uint256 amountOfTokens, uint256 amountOfETH);

    ///////////////////
    /// Constructor ///
    ///////////////////

    constructor(address tokenAddress) Ownable(msg.sender) {
        yourToken = YourToken(tokenAddress);
    }

    ///////////////////
    /// Functions /////
    ///////////////////

    function buyTokens() external payable {
        if (msg.value == 0) revert InvalidEthAmount();

        uint256 amountOfTokens = msg.value * tokensPerEth;
        uint256 availableTokens = yourToken.balanceOf(address(this));
        if (availableTokens < amountOfTokens) {
            revert InsufficientVendorTokenBalance(availableTokens, amountOfTokens);
        }

        yourToken.transfer(msg.sender, amountOfTokens);
        emit BuyTokens(msg.sender, msg.value, amountOfTokens);

    }

    function withdraw() public onlyOwner {
        uint256 amount = address(this).balance;
        address recipient = owner();
        (bool success, ) = payable(recipient).call{value: amount}("");
        if (!success) revert EthTransferFailed(recipient, amount);

    }

    function sellTokens(uint256 amount) public {
        if (amount == 0) revert InvalidTokenAmount();

        uint256 amountOfETH = amount / tokensPerEth;
        uint256 availableETH = address(this).balance;
        if (availableETH < amountOfETH) {
            revert InsufficientVendorEthBalance(availableETH, amountOfETH);
        }

        yourToken.transferFrom(msg.sender, address(this), amount);
        (bool success, ) = payable(msg.sender).call{value: amountOfETH}("");
        if (!success) revert EthTransferFailed(msg.sender, amountOfETH);

        emit SellTokens(msg.sender, amount, amountOfETH);

    }
}
