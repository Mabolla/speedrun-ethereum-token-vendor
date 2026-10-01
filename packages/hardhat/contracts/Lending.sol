// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./Corn.sol";
import "./CornDEX.sol";

error Lending__InvalidAmount();
error Lending__TransferFailed();
error Lending__UnsafePositionRatio();
error Lending__BorrowingFailed();
error Lending__RepayingFailed();
error Lending__PositionSafe();
error Lending__NotLiquidatable();
error Lending__InsufficientLiquidatorCorn();

contract Lending is Ownable, ReentrancyGuard {
    uint256 private constant COLLATERAL_RATIO = 120;
    uint256 private constant LIQUIDATOR_REWARD = 10;

    Corn private immutable i_corn;
    CornDEX private immutable i_cornDEX;

    mapping(address => uint256) public s_userCollateral;
    mapping(address => uint256) public s_userBorrowed;

    event CollateralAdded(address indexed user, uint256 indexed amount, uint256 price);
    event CollateralWithdrawn(address indexed user, uint256 indexed amount, uint256 price);
    event AssetBorrowed(address indexed user, uint256 indexed amount, uint256 price);
    event AssetRepaid(address indexed user, uint256 indexed amount, uint256 price);
    event Liquidation(
        address indexed user,
        address indexed liquidator,
        uint256 amountForLiquidator,
        uint256 liquidatedUserDebt,
        uint256 price
    );

    constructor(address _cornDEX, address _corn) Ownable(msg.sender) {
        i_cornDEX = CornDEX(_cornDEX);
        i_corn = Corn(_corn);
        i_corn.approve(address(this), type(uint256).max);
    }

    /** @notice Deposit ETH as collateral for the caller's borrowing position. */
    function addCollateral() public payable nonReentrant {
        if (msg.value == 0) revert Lending__InvalidAmount();
        s_userCollateral[msg.sender] += msg.value;
        emit CollateralAdded(msg.sender, msg.value, i_cornDEX.currentPrice());
    }

    /** @notice Withdraw ETH while keeping any outstanding debt safely collateralized. */
    function withdrawCollateral(uint256 amount) public nonReentrant {
        if (amount == 0 || amount > s_userCollateral[msg.sender]) revert Lending__InvalidAmount();

        s_userCollateral[msg.sender] -= amount;
        if (s_userBorrowed[msg.sender] != 0) _validatePosition(msg.sender);
        uint256 currentPrice = i_cornDEX.currentPrice();

        (bool success, ) = payable(msg.sender).call{ value: amount }("");
        if (!success) revert Lending__TransferFailed();

        emit CollateralWithdrawn(msg.sender, amount, currentPrice);
    }

    /** @notice The user's ETH collateral valued in CORN base units. */
    function calculateCollateralValue(address user) public view returns (uint256) {
        return Math.mulDiv(s_userCollateral[user], i_cornDEX.currentPrice(), 1e18);
    }

    /** @notice Collateral divided by debt, scaled by 1e18; no debt has an unlimited ratio. */
    function _calculatePositionRatio(address user) internal view returns (uint256) {
        uint256 borrowedAmount = s_userBorrowed[user];
        if (borrowedAmount == 0) return type(uint256).max;
        return Math.mulDiv(calculateCollateralValue(user), 1e18, borrowedAmount);
    }

    /** @notice Positions below the 120% collateral requirement can be liquidated. */
    function isLiquidatable(address user) public view returns (bool) {
        // Comparing the scaled threshold avoids overflowing a debt-free max-uint ratio.
        return _calculatePositionRatio(user) < (COLLATERAL_RATIO * 1e18) / 100;
    }

    function _validatePosition(address user) internal view {
        if (isLiquidatable(user)) revert Lending__UnsafePositionRatio();
    }

    /** @notice Borrow CORN from the protocol's prefunded inventory. */
    function borrowCorn(uint256 borrowAmount) public nonReentrant {
        if (borrowAmount == 0) revert Lending__InvalidAmount();

        s_userBorrowed[msg.sender] += borrowAmount;
        _validatePosition(msg.sender);
        uint256 currentPrice = i_cornDEX.currentPrice();

        if (!i_corn.transfer(msg.sender, borrowAmount)) revert Lending__BorrowingFailed();
        emit AssetBorrowed(msg.sender, borrowAmount, currentPrice);
    }

    /** @notice Repay debt using CORN approved by the caller. */
    function repayCorn(uint256 repayAmount) public nonReentrant {
        if (repayAmount == 0 || repayAmount > s_userBorrowed[msg.sender]) revert Lending__InvalidAmount();

        s_userBorrowed[msg.sender] -= repayAmount;
        uint256 currentPrice = i_cornDEX.currentPrice();

        if (!i_corn.transferFrom(msg.sender, address(this), repayAmount)) revert Lending__RepayingFailed();
        emit AssetRepaid(msg.sender, repayAmount, currentPrice);
    }

    /** @notice Repay an unsafe borrower's debt and receive ETH plus a capped 10% reward. */
    function liquidate(address user) public nonReentrant {
        if (!isLiquidatable(user)) revert Lending__NotLiquidatable();

        uint256 userDebt = s_userBorrowed[user];
        if (i_corn.balanceOf(msg.sender) < userDebt) revert Lending__InsufficientLiquidatorCorn();

        uint256 userCollateral = s_userCollateral[user];
        uint256 currentPrice = i_cornDEX.currentPrice();
        uint256 collateralValue = Math.mulDiv(userCollateral, currentPrice, 1e18);
        uint256 amountForLiquidator;

        if (userDebt >= collateralValue) {
            // This also handles a zero-value oracle result without dividing by zero.
            amountForLiquidator = userCollateral;
        } else {
            uint256 collateralPurchased = Math.mulDiv(userDebt, userCollateral, collateralValue);
            uint256 liquidatorReward = Math.mulDiv(collateralPurchased, LIQUIDATOR_REWARD, 100);
            uint256 remainingCollateral = userCollateral - collateralPurchased;
            amountForLiquidator = liquidatorReward >= remainingCollateral
                ? userCollateral
                : collateralPurchased + liquidatorReward;
        }

        // Record the settled position before either external asset transfer.
        s_userBorrowed[user] = 0;
        s_userCollateral[user] = userCollateral - amountForLiquidator;

        if (!i_corn.transferFrom(msg.sender, address(this), userDebt)) revert Lending__RepayingFailed();
        (bool success, ) = payable(msg.sender).call{ value: amountForLiquidator }("");
        if (!success) revert Lending__TransferFailed();

        emit Liquidation(user, msg.sender, amountForLiquidator, userDebt, currentPrice);
    }
}
