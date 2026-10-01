// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "./MyUSD.sol";
import "./Oracle.sol";
import "./MyUSDStaking.sol";

error Engine__InvalidAmount();
error Engine__UnsafePositionRatio();
error Engine__NotLiquidatable();
error Engine__InvalidBorrowRate();
error Engine__NotRateController();
error Engine__InsufficientCollateral();
error Engine__TransferFailed();

contract MyUSDEngine is Ownable, ReentrancyGuard {
    uint256 private constant COLLATERAL_RATIO = 150;
    uint256 private constant LIQUIDATOR_REWARD = 10;
    uint256 private constant SECONDS_PER_YEAR = 365 days;
    uint256 private constant PRECISION = 1e18;

    MyUSD private immutable i_myUSD;
    Oracle private immutable i_oracle;
    MyUSDStaking private immutable i_staking;
    address private immutable i_rateController;

    uint256 public borrowRate;
    uint256 public totalDebtShares;
    uint256 public debtExchangeRate;
    uint256 public lastUpdateTime;

    mapping(address => uint256) public s_userCollateral;
    mapping(address => uint256) public s_userDebtShares;

    event CollateralAdded(address indexed user, uint256 indexed amount, uint256 price);
    event CollateralWithdrawn(address indexed withdrawer, uint256 indexed amount, uint256 price);
    event BorrowRateUpdated(uint256 newRate);
    event DebtSharesMinted(address indexed user, uint256 amount, uint256 shares);
    event DebtSharesBurned(address indexed user, uint256 amount, uint256 shares);
    event Liquidation(
        address indexed user,
        address indexed liquidator,
        uint256 amountForLiquidator,
        uint256 liquidatedUserDebt,
        uint256 price
    );

    modifier onlyRateController() {
        if (msg.sender != i_rateController) revert Engine__NotRateController();
        _;
    }

    constructor(
        address _oracle,
        address _myUSDAddress,
        address _stakingAddress,
        address _rateController
    ) Ownable(msg.sender) {
        i_oracle = Oracle(_oracle);
        i_myUSD = MyUSD(_myUSDAddress);
        i_staking = MyUSDStaking(_stakingAddress);
        i_rateController = _rateController;
        lastUpdateTime = block.timestamp;
        debtExchangeRate = PRECISION;
    }

    function addCollateral() public payable nonReentrant {
        if (msg.value == 0) revert Engine__InvalidAmount();
        s_userCollateral[msg.sender] += msg.value;
        emit CollateralAdded(msg.sender, msg.value, i_oracle.getETHMyUSDPrice());
    }

    function calculateCollateralValue(address user) public view returns (uint256) {
        return Math.mulDiv(s_userCollateral[user], i_oracle.getETHMyUSDPrice(), PRECISION);
    }

    function _getCurrentExchangeRate() internal view returns (uint256) {
        if (totalDebtShares == 0 || borrowRate == 0) return debtExchangeRate;
        uint256 timeElapsed = block.timestamp - lastUpdateTime;
        if (timeElapsed == 0) return debtExchangeRate;

        uint256 totalDebtValue = Math.mulDiv(totalDebtShares, debtExchangeRate, PRECISION);
        uint256 interest = Math.mulDiv(totalDebtValue, borrowRate * timeElapsed, SECONDS_PER_YEAR * 10000);
        return debtExchangeRate + Math.mulDiv(interest, PRECISION, totalDebtShares);
    }

    function _accrueInterest() internal {
        debtExchangeRate = _getCurrentExchangeRate();
        lastUpdateTime = block.timestamp;
    }

    function _getMyUSDToShares(uint256 amount) internal view returns (uint256) {
        return Math.mulDiv(amount, PRECISION, _getCurrentExchangeRate());
    }

    function getCurrentDebtValue(address user) public view returns (uint256) {
        return Math.mulDiv(s_userDebtShares[user], _getCurrentExchangeRate(), PRECISION);
    }

    function calculatePositionRatio(address user) public view returns (uint256) {
        uint256 debtValue = getCurrentDebtValue(user);
        if (debtValue == 0) return type(uint256).max;
        return Math.mulDiv(calculateCollateralValue(user), 100, debtValue);
    }

    function _validatePosition(address user) internal view {
        if (calculatePositionRatio(user) < COLLATERAL_RATIO) revert Engine__UnsafePositionRatio();
    }

    function mintMyUSD(uint256 mintAmount) public nonReentrant {
        if (mintAmount == 0) revert Engine__InvalidAmount();
        _accrueInterest();

        // Round new debt up so every minted token is represented by debt shares.
        uint256 shares = Math.mulDiv(mintAmount, PRECISION, debtExchangeRate, Math.Rounding.Ceil);
        s_userDebtShares[msg.sender] += shares;
        totalDebtShares += shares;
        _validatePosition(msg.sender);

        if (!i_myUSD.mintTo(msg.sender, mintAmount)) revert Engine__TransferFailed();
        emit DebtSharesMinted(msg.sender, mintAmount, shares);
    }

    function setBorrowRate(uint256 newRate) external onlyRateController nonReentrant {
        _accrueInterest();
        if (newRate < i_staking.savingsRate()) revert Engine__InvalidBorrowRate();
        borrowRate = newRate;
        emit BorrowRateUpdated(newRate);
    }

    function repayUpTo(uint256 amount) public nonReentrant {
        if (amount == 0) revert Engine__InvalidAmount();
        _accrueInterest();

        uint256 userShares = s_userDebtShares[msg.sender];
        uint256 userDebt = Math.mulDiv(userShares, debtExchangeRate, PRECISION);
        if (userDebt == 0) revert Engine__InvalidAmount();

        uint256 shares;
        if (amount >= userDebt) {
            amount = userDebt;
            shares = userShares;
        } else {
            shares = _getMyUSDToShares(amount);
            if (shares == 0) revert Engine__InvalidAmount();
        }

        if (i_myUSD.balanceOf(msg.sender) < amount) revert MyUSD__InsufficientBalance();
        if (i_myUSD.allowance(msg.sender, address(this)) < amount) revert MyUSD__InsufficientAllowance();

        s_userDebtShares[msg.sender] = userShares - shares;
        totalDebtShares -= shares;
        i_myUSD.burnFrom(msg.sender, amount);

        emit DebtSharesBurned(msg.sender, amount, shares);
    }

    function withdrawCollateral(uint256 amount) external nonReentrant {
        if (amount == 0) revert Engine__InvalidAmount();
        if (amount > s_userCollateral[msg.sender]) revert Engine__InsufficientCollateral();

        s_userCollateral[msg.sender] -= amount;
        if (s_userDebtShares[msg.sender] != 0) _validatePosition(msg.sender);
        uint256 currentPrice = i_oracle.getETHMyUSDPrice();

        (bool success, ) = payable(msg.sender).call{ value: amount }("");
        if (!success) revert Engine__TransferFailed();
        emit CollateralWithdrawn(msg.sender, amount, currentPrice);
    }

    function isLiquidatable(address user) public view returns (bool) {
        return s_userDebtShares[user] != 0 && calculatePositionRatio(user) < COLLATERAL_RATIO;
    }

    function liquidate(address user) external nonReentrant {
        _accrueInterest();
        if (!isLiquidatable(user)) revert Engine__NotLiquidatable();

        uint256 userDebt = getCurrentDebtValue(user);
        if (i_myUSD.balanceOf(msg.sender) < userDebt) revert MyUSD__InsufficientBalance();
        if (i_myUSD.allowance(msg.sender, address(this)) < userDebt) revert MyUSD__InsufficientAllowance();

        uint256 userCollateral = s_userCollateral[user];
        uint256 currentPrice = i_oracle.getETHMyUSDPrice();
        uint256 collateralValue = Math.mulDiv(userCollateral, currentPrice, PRECISION);
        uint256 amountForLiquidator;

        if (userDebt >= collateralValue) {
            amountForLiquidator = userCollateral;
        } else {
            uint256 collateralToCoverDebt = Math.mulDiv(userDebt, userCollateral, collateralValue);
            uint256 reward = Math.mulDiv(collateralToCoverDebt, LIQUIDATOR_REWARD, 100);
            uint256 remainingCollateral = userCollateral - collateralToCoverDebt;
            amountForLiquidator = reward >= remainingCollateral ? userCollateral : collateralToCoverDebt + reward;
        }

        totalDebtShares -= s_userDebtShares[user];
        s_userDebtShares[user] = 0;
        s_userCollateral[user] = userCollateral - amountForLiquidator;
        i_myUSD.burnFrom(msg.sender, userDebt);

        (bool success, ) = payable(msg.sender).call{ value: amountForLiquidator }("");
        if (!success) revert Engine__TransferFailed();

        emit Liquidation(user, msg.sender, amountForLiquidator, userDebt, currentPrice);
    }
}
