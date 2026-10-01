//SPDX-License-Identifier: MIT
pragma solidity >=0.8.0 <0.9.0;

import { PredictionMarketToken } from "./PredictionMarketToken.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

contract PredictionMarket is Ownable, ReentrancyGuard {
    /////////////////
    /// Errors //////
    /////////////////

    error PredictionMarket__MustProvideETHForInitialLiquidity();
    error PredictionMarket__InvalidProbability();
    error PredictionMarket__PredictionAlreadyReported();
    error PredictionMarket__OnlyOracleCanReport();
    error PredictionMarket__OwnerCannotCall();
    error PredictionMarket__PredictionNotReported();
    error PredictionMarket__InsufficientWinningTokens();
    error PredictionMarket__AmountMustBeGreaterThanZero();
    error PredictionMarket__MustSendExactETHAmount();
    error PredictionMarket__InsufficientTokenReserve(Outcome _outcome, uint256 _amountToken);
    error PredictionMarket__TokenTransferFailed();
    error PredictionMarket__ETHTransferFailed();
    error PredictionMarket__InsufficientBalance(uint256 _tradingAmount, uint256 _userBalance);
    error PredictionMarket__InsufficientAllowance(uint256 _tradingAmount, uint256 _allowance);
    error PredictionMarket__InsufficientLiquidity();
    error PredictionMarket__InvalidPercentageToLock();

    //////////////////////////
    /// State Variables //////
    //////////////////////////

    enum Outcome {
        YES,
        NO
    }

    uint256 private constant PRECISION = 1e18;

    address public immutable i_oracle;
    uint256 public immutable i_initialTokenValue;
    uint256 public immutable i_percentageLocked;
    uint256 public immutable i_initialYesProbability;
    string public s_question;
    uint256 public s_ethCollateral;
    uint256 public s_lpTradingRevenue;

    PredictionMarketToken public immutable i_yesToken;
    PredictionMarketToken public immutable i_noToken;

    PredictionMarketToken public s_winningToken;
    bool public s_isReported;

    /////////////////////////
    /// Events //////
    /////////////////////////

    event TokensPurchased(address indexed buyer, Outcome outcome, uint256 amount, uint256 ethAmount);
    event TokensSold(address indexed seller, Outcome outcome, uint256 amount, uint256 ethAmount);
    event WinningTokensRedeemed(address indexed redeemer, uint256 amount, uint256 ethAmount);
    event MarketReported(address indexed oracle, Outcome winningOutcome, address winningToken);
    event MarketResolved(address indexed resolver, uint256 totalEthToSend);
    event LiquidityAdded(address indexed provider, uint256 ethAmount, uint256 tokensAmount);
    event LiquidityRemoved(address indexed provider, uint256 ethAmount, uint256 tokensAmount);

    /////////////////
    /// Modifiers ///
    /////////////////

    modifier predictionNotReported() {
        if (s_isReported) revert PredictionMarket__PredictionAlreadyReported();
        _;
    }

    modifier predictionReported() {
        if (!s_isReported) revert PredictionMarket__PredictionNotReported();
        _;
    }

    modifier notOwner() {
        if (msg.sender == owner()) revert PredictionMarket__OwnerCannotCall();
        _;
    }

    modifier amountGreaterThanZero(uint256 amount) {
        if (amount == 0) revert PredictionMarket__AmountMustBeGreaterThanZero();
        _;
    }

    //////////////////
    ////Constructor///
    //////////////////

    constructor(
        address _liquidityProvider,
        address _oracle,
        string memory _question,
        uint256 _initialTokenValue,
        uint8 _initialYesProbability,
        uint8 _percentageToLock
    ) payable Ownable(_liquidityProvider) {
        if (msg.value == 0) revert PredictionMarket__MustProvideETHForInitialLiquidity();
        if (_initialYesProbability == 0 || _initialYesProbability >= 100) revert PredictionMarket__InvalidProbability();
        if (_percentageToLock == 0 || _percentageToLock >= 100) revert PredictionMarket__InvalidPercentageToLock();
        if (_initialTokenValue == 0) revert PredictionMarket__AmountMustBeGreaterThanZero();

        i_oracle = _oracle;
        s_question = _question;
        i_initialTokenValue = _initialTokenValue;
        i_initialYesProbability = _initialYesProbability;
        i_percentageLocked = _percentageToLock;
        s_ethCollateral = msg.value;

        uint256 initialTokenAmount = Math.mulDiv(msg.value, PRECISION, _initialTokenValue);
        i_yesToken = new PredictionMarketToken("Yes", "Y", _liquidityProvider, initialTokenAmount);
        i_noToken = new PredictionMarketToken("No", "N", _liquidityProvider, initialTokenAmount);
        uint256 yesLocked = Math.mulDiv(
            initialTokenAmount,
            uint256(_initialYesProbability) * _percentageToLock * 2,
            10000
        );
        uint256 noLocked = Math.mulDiv(
            initialTokenAmount,
            uint256(100 - _initialYesProbability) * _percentageToLock * 2,
            10000
        );
        if (yesLocked > initialTokenAmount || noLocked > initialTokenAmount)
            revert PredictionMarket__InvalidPercentageToLock();
        if (!i_yesToken.transfer(_liquidityProvider, yesLocked) || !i_noToken.transfer(_liquidityProvider, noLocked)) {
            revert PredictionMarket__TokenTransferFailed();
        }
    }

    /////////////////
    /// Functions ///
    /////////////////

    /**
     * @notice Add liquidity to the prediction market and mint tokens
     * @dev Only the owner can add liquidity and only if the prediction is not reported
     */
    function addLiquidity()
        external
        payable
        onlyOwner
        predictionNotReported
        amountGreaterThanZero(msg.value)
        nonReentrant
    {
        uint256 tokensAmount = Math.mulDiv(msg.value, PRECISION, i_initialTokenValue);
        s_ethCollateral += msg.value;
        i_yesToken.mint(address(this), tokensAmount);
        i_noToken.mint(address(this), tokensAmount);
        emit LiquidityAdded(msg.sender, msg.value, tokensAmount);
    }

    /**
     * @notice Remove liquidity from the prediction market and burn respective tokens, if you remove liquidity before prediction ends you got no share of lpReserve
     * @dev Only the owner can remove liquidity and only if the prediction is not reported
     * @param _ethToWithdraw Amount of ETH to withdraw from liquidity pool
     */
    function removeLiquidity(
        uint256 _ethToWithdraw
    ) external onlyOwner predictionNotReported amountGreaterThanZero(_ethToWithdraw) nonReentrant {
        // Burn enough of both outcomes even for a fractional-token withdrawal.
        uint256 amountTokenToBurn = Math.mulDiv(_ethToWithdraw, PRECISION, i_initialTokenValue, Math.Rounding.Ceil);
        if (amountTokenToBurn > i_yesToken.balanceOf(address(this))) {
            revert PredictionMarket__InsufficientTokenReserve(Outcome.YES, amountTokenToBurn);
        }
        if (amountTokenToBurn > i_noToken.balanceOf(address(this))) {
            revert PredictionMarket__InsufficientTokenReserve(Outcome.NO, amountTokenToBurn);
        }
        if (_ethToWithdraw > s_ethCollateral) revert PredictionMarket__InsufficientLiquidity();
        s_ethCollateral -= _ethToWithdraw;
        i_yesToken.burn(address(this), amountTokenToBurn);
        i_noToken.burn(address(this), amountTokenToBurn);
        (bool success, ) = payable(msg.sender).call{ value: _ethToWithdraw }("");
        if (!success) revert PredictionMarket__ETHTransferFailed();
        emit LiquidityRemoved(msg.sender, _ethToWithdraw, amountTokenToBurn);
    }

    /**
     * @notice Report the winning outcome for the prediction
     * @dev Only the oracle can report the winning outcome and only if the prediction is not reported
     * @param _winningOutcome The winning outcome (YES or NO)
     */
    function report(Outcome _winningOutcome) external predictionNotReported nonReentrant {
        if (msg.sender != i_oracle) revert PredictionMarket__OnlyOracleCanReport();
        s_winningToken = _winningOutcome == Outcome.YES ? i_yesToken : i_noToken;
        s_isReported = true;
        emit MarketReported(msg.sender, _winningOutcome, address(s_winningToken));
    }

    /**
     * @notice Owner of contract can redeem winning tokens held by the contract after prediction is resolved and get ETH from the contract including LP revenue and collateral back
     * @dev Only callable by the owner and only if the prediction is resolved
     * @return ethRedeemed The amount of ETH redeemed
     */
    function resolveMarketAndWithdraw()
        external
        onlyOwner
        predictionReported
        nonReentrant
        returns (uint256 ethRedeemed)
    {
        uint256 contractWinningTokens = s_winningToken.balanceOf(address(this));
        ethRedeemed = Math.mulDiv(contractWinningTokens, i_initialTokenValue, PRECISION);
        if (ethRedeemed > s_ethCollateral) ethRedeemed = s_ethCollateral;
        uint256 totalEthToSend = ethRedeemed + s_lpTradingRevenue;
        s_ethCollateral -= ethRedeemed;
        s_lpTradingRevenue = 0;
        s_winningToken.burn(address(this), contractWinningTokens);
        (bool success, ) = payable(msg.sender).call{ value: totalEthToSend }("");
        if (!success) revert PredictionMarket__ETHTransferFailed();
        emit MarketResolved(msg.sender, totalEthToSend);
    }

    /**
     * @notice Buy prediction outcome tokens with ETH, need to call priceInETH function first to get right amount of tokens to buy
     * @param _outcome The possible outcome (YES or NO) to buy tokens for
     * @param _amountTokenToBuy Amount of tokens to purchase
     */
    function buyTokensWithETH(
        Outcome _outcome,
        uint256 _amountTokenToBuy
    ) external payable amountGreaterThanZero(_amountTokenToBuy) predictionNotReported notOwner nonReentrant {
        uint256 ethNeeded = getBuyPriceInEth(_outcome, _amountTokenToBuy);
        if (msg.value != ethNeeded) revert PredictionMarket__MustSendExactETHAmount();
        PredictionMarketToken optionToken = _outcome == Outcome.YES ? i_yesToken : i_noToken;
        if (_amountTokenToBuy > optionToken.balanceOf(address(this))) {
            revert PredictionMarket__InsufficientTokenReserve(_outcome, _amountTokenToBuy);
        }
        s_lpTradingRevenue += msg.value;
        if (!optionToken.transfer(msg.sender, _amountTokenToBuy)) revert PredictionMarket__TokenTransferFailed();
        emit TokensPurchased(msg.sender, _outcome, _amountTokenToBuy, msg.value);
    }

    /**
     * @notice Sell prediction outcome tokens for ETH, need to call priceInETH function first to get right amount of tokens to buy
     * @param _outcome The possible outcome (YES or NO) to sell tokens for
     * @param _tradingAmount The amount of tokens to sell
     */
    function sellTokensForEth(
        Outcome _outcome,
        uint256 _tradingAmount
    ) external amountGreaterThanZero(_tradingAmount) predictionNotReported notOwner nonReentrant {
        PredictionMarketToken optionToken = _outcome == Outcome.YES ? i_yesToken : i_noToken;
        uint256 userBalance = optionToken.balanceOf(msg.sender);
        if (userBalance < _tradingAmount) revert PredictionMarket__InsufficientBalance(_tradingAmount, userBalance);
        uint256 allowance = optionToken.allowance(msg.sender, address(this));
        if (allowance < _tradingAmount) revert PredictionMarket__InsufficientAllowance(_tradingAmount, allowance);
        uint256 ethToReceive = getSellPriceInEth(_outcome, _tradingAmount);
        if (ethToReceive > s_lpTradingRevenue) revert PredictionMarket__InsufficientLiquidity();
        s_lpTradingRevenue -= ethToReceive;
        if (!optionToken.transferFrom(msg.sender, address(this), _tradingAmount)) {
            revert PredictionMarket__TokenTransferFailed();
        }
        (bool success, ) = payable(msg.sender).call{ value: ethToReceive }("");
        if (!success) revert PredictionMarket__ETHTransferFailed();
        emit TokensSold(msg.sender, _outcome, _tradingAmount, ethToReceive);
    }

    /**
     * @notice Redeem winning tokens for ETH after prediction is resolved, winning tokens are burned and user receives ETH
     * @dev Only if the prediction is resolved
     * @param _amount The amount of winning tokens to redeem
     */
    function redeemWinningTokens(
        uint256 _amount
    ) external amountGreaterThanZero(_amount) predictionReported notOwner nonReentrant {
        if (s_winningToken.balanceOf(msg.sender) < _amount) revert PredictionMarket__InsufficientWinningTokens();
        uint256 ethToReceive = Math.mulDiv(_amount, i_initialTokenValue, PRECISION);
        if (ethToReceive > s_ethCollateral) revert PredictionMarket__InsufficientLiquidity();
        s_ethCollateral -= ethToReceive;
        s_winningToken.burn(msg.sender, _amount);
        (bool success, ) = payable(msg.sender).call{ value: ethToReceive }("");
        if (!success) revert PredictionMarket__ETHTransferFailed();
        emit WinningTokensRedeemed(msg.sender, _amount, ethToReceive);
    }

    /**
     * @notice Calculate the total ETH price for buying tokens
     * @param _outcome The possible outcome (YES or NO) to buy tokens for
     * @param _tradingAmount The amount of tokens to buy
     * @return The total ETH price
     */
    function getBuyPriceInEth(Outcome _outcome, uint256 _tradingAmount) public view returns (uint256) {
        return _calculatePriceInEth(_outcome, _tradingAmount, false);
    }

    /**
     * @notice Calculate the total ETH price for selling tokens
     * @param _outcome The possible outcome (YES or NO) to sell tokens for
     * @param _tradingAmount The amount of tokens to sell
     * @return The total ETH price
     */
    function getSellPriceInEth(Outcome _outcome, uint256 _tradingAmount) public view returns (uint256) {
        return _calculatePriceInEth(_outcome, _tradingAmount, true);
    }

    /////////////////////////
    /// Helper Functions ///
    ////////////////////////

    /**
     * @dev Internal helper to calculate ETH price for both buying and selling
     * @param _outcome The possible outcome (YES or NO)
     * @param _tradingAmount The amount of tokens
     * @param _isSelling Whether this is a sell calculation
     */
    function _calculatePriceInEth(
        Outcome _outcome,
        uint256 _tradingAmount,
        bool _isSelling
    ) private view returns (uint256) {
        (uint256 currentTokenReserve, uint256 currentOtherTokenReserve) = _getCurrentReserves(_outcome);
        if (!_isSelling && _tradingAmount > currentTokenReserve) revert PredictionMarket__InsufficientLiquidity();
        uint256 totalTokenSupply = i_yesToken.totalSupply();
        uint256 currentTokenSoldBefore = totalTokenSupply - currentTokenReserve;
        uint256 currentOtherTokenSold = totalTokenSupply - currentOtherTokenReserve;
        if (_isSelling && _tradingAmount > currentTokenSoldBefore) revert PredictionMarket__InsufficientLiquidity();
        uint256 totalTokensSoldBefore = currentTokenSoldBefore + currentOtherTokenSold;
        uint256 probabilityBefore = _calculateProbability(currentTokenSoldBefore, totalTokensSoldBefore);
        uint256 currentTokenSoldAfter = _isSelling
            ? currentTokenSoldBefore - _tradingAmount
            : currentTokenSoldBefore + _tradingAmount;
        uint256 totalTokensSoldAfter = _isSelling
            ? totalTokensSoldBefore - _tradingAmount
            : totalTokensSoldBefore + _tradingAmount;
        uint256 probabilityAfter = _calculateProbability(currentTokenSoldAfter, totalTokensSoldAfter);
        uint256 probabilityAvg = (probabilityBefore + probabilityAfter) / 2;
        return Math.mulDiv(i_initialTokenValue * probabilityAvg, _tradingAmount, PRECISION * PRECISION);
    }

    /**
     * @dev Internal helper to get the current reserves of the tokens
     * @param _outcome The possible outcome (YES or NO)
     * @return The current reserves of the tokens
     */
    function _getCurrentReserves(Outcome _outcome) private view returns (uint256, uint256) {
        if (_outcome == Outcome.YES) return (i_yesToken.balanceOf(address(this)), i_noToken.balanceOf(address(this)));
        return (i_noToken.balanceOf(address(this)), i_yesToken.balanceOf(address(this)));
    }

    /**
     * @dev Internal helper to calculate the probability of the tokens
     * @param tokensSold The number of tokens sold
     * @param totalSold The total number of tokens sold
     * @return The probability of the tokens
     */
    function _calculateProbability(uint256 tokensSold, uint256 totalSold) private pure returns (uint256) {
        if (totalSold == 0) return PRECISION / 2;
        return Math.mulDiv(tokensSold, PRECISION, totalSold);
    }

    /////////////////////////
    /// Getter Functions ///
    ////////////////////////

    /**
     * @notice Get the prediction details
     */
    function getPrediction()
        external
        view
        returns (
            string memory question,
            string memory outcome1,
            string memory outcome2,
            address oracle,
            uint256 initialTokenValue,
            uint256 yesTokenReserve,
            uint256 noTokenReserve,
            bool isReported,
            address yesToken,
            address noToken,
            address winningToken,
            uint256 ethCollateral,
            uint256 lpTradingRevenue,
            address predictionMarketOwner,
            uint256 initialProbability,
            uint256 percentageLocked
        )
    {
        oracle = i_oracle;
        initialTokenValue = i_initialTokenValue;
        percentageLocked = i_percentageLocked;
        initialProbability = i_initialYesProbability;
        question = s_question;
        ethCollateral = s_ethCollateral;
        lpTradingRevenue = s_lpTradingRevenue;
        predictionMarketOwner = owner();
        yesToken = address(i_yesToken);
        noToken = address(i_noToken);
        outcome1 = i_yesToken.name();
        outcome2 = i_noToken.name();
        yesTokenReserve = i_yesToken.balanceOf(address(this));
        noTokenReserve = i_noToken.balanceOf(address(this));
        isReported = s_isReported;
        winningToken = address(s_winningToken);
    }
}
