// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice ETH wrapped as an ERC-20 token, redeemable at a one-to-one rate.
contract WrappedETH is ERC20, ReentrancyGuard {
    error WithdrawalTransferFailed();

    event Deposit(address indexed depositor, uint256 amount);
    event Withdrawal(address indexed withdrawer, uint256 amount);

    constructor() ERC20("Wrapped Ether", "WETH") {}

    function deposit() public payable {
        _mint(msg.sender, msg.value);
        emit Deposit(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external nonReentrant {
        _burn(msg.sender, amount);
        (bool success, ) = payable(msg.sender).call{ value: amount }("");
        if (!success) revert WithdrawalTransferFailed();
        emit Withdrawal(msg.sender, amount);
    }

    receive() external payable {
        deposit();
    }

    fallback() external payable {
        deposit();
    }
}
