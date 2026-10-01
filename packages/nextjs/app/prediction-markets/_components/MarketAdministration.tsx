"use client";

import { useEffect, useState } from "react";
import { Address as AddressBlock } from "@scaffold-ui/components";
import { IntegerInput } from "@scaffold-ui/debug-contracts";
import { erc20Abi, zeroAddress } from "viem";
import { useAccount, useBalance, useReadContract } from "wagmi";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { PREDICTION_CHAIN_ID, formatPredictionAmount, parsePredictionAmount } from "~~/utils/predictionMarkets";

const TOKEN_PRECISION = 10n ** 18n;
type Operation = "adding" | "removing" | "reporting" | "resolving";

export default function MarketAdministration() {
  const { address, chainId, isConnected } = useAccount();
  const [addInput, setAddInput] = useState("");
  const [removeInput, setRemoveInput] = useState("");
  const [selectedOutcome, setSelectedOutcome] = useState<0 | 1>();
  const [outcomeReviewed, setOutcomeReviewed] = useState(false);
  const [operation, setOperation] = useState<Operation>();
  const [transactionError, setTransactionError] = useState<string>();
  const {
    data: walletEth,
    error: walletEthError,
    refetch: refetchWalletEth,
  } = useBalance({
    address,
    chainId: PREDICTION_CHAIN_ID,
    query: { enabled: Boolean(address), refetchInterval: 15_000 },
  });
  const { data: market, isLoading: contractLoading } = useDeployedContractInfo({
    contractName: "PredictionMarket",
    chainId: PREDICTION_CHAIN_ID,
  });
  const {
    data: prediction,
    error: predictionError,
    refetch: refetchPrediction,
  } = useScaffoldReadContract({
    contractName: "PredictionMarket",
    functionName: "getPrediction",
    chainId: PREDICTION_CHAIN_ID,
    query: { enabled: Boolean(market) },
  });
  const oracle = prediction?.[3];
  const tokenValue = prediction?.[4];
  const yesReserve = prediction?.[5];
  const noReserve = prediction?.[6];
  const isReported = prediction?.[7];
  const yesToken = prediction?.[8];
  const noToken = prediction?.[9];
  const winningToken = prediction?.[10];
  const collateral = prediction?.[11];
  const tradingRevenue = prediction?.[12];
  const owner = prediction?.[13];
  const tokenAddressesReady = Boolean(yesToken && yesToken !== zeroAddress && noToken && noToken !== zeroAddress);
  const ownerReady = Boolean(owner && owner !== zeroAddress);
  const winnerReady = Boolean(isReported && winningToken && winningToken !== zeroAddress && market);
  const {
    data: ownerYesBalance,
    error: ownerYesError,
    refetch: refetchOwnerYes,
  } = useReadContract({
    address: yesToken,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: owner ? [owner] : undefined,
    chainId: PREDICTION_CHAIN_ID,
    query: { enabled: tokenAddressesReady && ownerReady && Boolean(market), refetchInterval: 15_000 },
  });
  const {
    data: ownerNoBalance,
    error: ownerNoError,
    refetch: refetchOwnerNo,
  } = useReadContract({
    address: noToken,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: owner ? [owner] : undefined,
    chainId: PREDICTION_CHAIN_ID,
    query: { enabled: tokenAddressesReady && ownerReady && Boolean(market), refetchInterval: 15_000 },
  });
  const {
    data: marketWinningBalance,
    error: winningBalanceError,
    refetch: refetchWinningBalance,
  } = useReadContract({
    address: winningToken,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: market ? [market.address] : undefined,
    chainId: PREDICTION_CHAIN_ID,
    query: { enabled: winnerReady, refetchInterval: 15_000 },
  });
  const { writeContractAsync, isMining, isPending } = useScaffoldWriteContract({
    contractName: "PredictionMarket",
    chainId: PREDICTION_CHAIN_ID,
  });

  useEffect(() => {
    setSelectedOutcome(undefined);
    setOutcomeReviewed(false);
  }, [address, chainId, isReported]);

  const isOwner = Boolean(isConnected && address && owner && address.toLowerCase() === owner.toLowerCase());
  const isOracle = Boolean(isConnected && address && oracle && address.toLowerCase() === oracle.toLowerCase());
  const busy = operation !== undefined || isMining || isPending;
  const predictionReady =
    Boolean(market && prediction) &&
    !predictionError &&
    tokenAddressesReady &&
    ownerReady &&
    Boolean(oracle && oracle !== zeroAddress) &&
    tokenValue !== undefined &&
    tokenValue > 0n &&
    yesReserve !== undefined &&
    noReserve !== undefined &&
    collateral !== undefined &&
    tradingRevenue !== undefined &&
    isReported !== undefined;
  const canTransact = predictionReady && isConnected && chainId === PREDICTION_CHAIN_ID && !busy;
  const addAmount = parsePredictionAmount(addInput);
  const removeAmount = parsePredictionAmount(removeInput);
  const mintedTokens =
    addAmount !== undefined && tokenValue !== undefined && tokenValue > 0n
      ? (addAmount * TOKEN_PRECISION) / tokenValue
      : undefined;
  const tokensToBurn =
    removeAmount !== undefined && tokenValue !== undefined && tokenValue > 0n
      ? (removeAmount * TOKEN_PRECISION + tokenValue - 1n) / tokenValue
      : undefined;
  const minimumReserve =
    yesReserve !== undefined && noReserve !== undefined ? (yesReserve < noReserve ? yesReserve : noReserve) : undefined;
  const reserveWithdrawalLimit =
    minimumReserve !== undefined && tokenValue !== undefined
      ? (minimumReserve * tokenValue) / TOKEN_PRECISION
      : undefined;
  const maxWithdrawal =
    reserveWithdrawalLimit !== undefined && collateral !== undefined
      ? reserveWithdrawalLimit < collateral
        ? reserveWithdrawalLimit
        : collateral
      : undefined;
  const removalFits =
    removeAmount !== undefined &&
    tokensToBurn !== undefined &&
    tokensToBurn > 0n &&
    collateral !== undefined &&
    removeAmount <= collateral &&
    yesReserve !== undefined &&
    tokensToBurn <= yesReserve &&
    noReserve !== undefined &&
    tokensToBurn <= noReserve;
  const canAdd =
    canTransact &&
    isOwner &&
    isReported === false &&
    addAmount !== undefined &&
    walletEth !== undefined &&
    !walletEthError &&
    addAmount < walletEth.value &&
    mintedTokens !== undefined &&
    mintedTokens > 0n;
  const canRemove = canTransact && isOwner && isReported === false && removalFits;
  const canReport = canTransact && isOracle && isReported === false && selectedOutcome !== undefined && outcomeReviewed;
  const hasOwnerProceeds =
    marketWinningBalance !== undefined &&
    tradingRevenue !== undefined &&
    (marketWinningBalance > 0n || tradingRevenue > 0n);
  const canResolve =
    canTransact && isOwner && isReported === true && winnerReady && !winningBalanceError && hasOwnerProceeds;
  const redemptionValue =
    marketWinningBalance !== undefined && tokenValue !== undefined
      ? (marketWinningBalance * tokenValue) / TOKEN_PRECISION
      : undefined;
  const ownerPayout =
    redemptionValue !== undefined && collateral !== undefined && tradingRevenue !== undefined
      ? (redemptionValue < collateral ? redemptionValue : collateral) + tradingRevenue
      : undefined;
  const finalOutcome =
    isReported && winningToken === yesToken ? "YES" : isReported && winningToken === noToken ? "NO" : undefined;

  async function refreshState() {
    await refetchPrediction();
    await Promise.allSettled([
      refetchOwnerYes(),
      refetchOwnerNo(),
      refetchWalletEth(),
      ...(winnerReady ? [refetchWinningBalance()] : []),
    ]);
  }

  async function addLiquidity() {
    if (!canAdd || addAmount === undefined) return;
    setOperation("adding");
    setTransactionError(undefined);
    try {
      const hash = await writeContractAsync({ functionName: "addLiquidity", value: addAmount });
      if (!hash) {
        setTransactionError("The liquidity deposit was not completed. Check your wallet and retry.");
        return;
      }
      setAddInput("");
      await refreshState();
    } catch (error) {
      console.error("Could not add prediction market liquidity", error);
      setTransactionError("Could not add liquidity. Check your wallet and retry.");
    } finally {
      setOperation(undefined);
    }
  }

  async function removeLiquidity() {
    if (!canRemove || removeAmount === undefined) return;
    setOperation("removing");
    setTransactionError(undefined);
    try {
      const hash = await writeContractAsync({ functionName: "removeLiquidity", args: [removeAmount] });
      if (!hash) {
        setTransactionError("The liquidity withdrawal was not completed. Check your wallet and retry.");
        return;
      }
      setRemoveInput("");
      await refreshState();
    } catch (error) {
      console.error("Could not remove prediction market liquidity", error);
      setTransactionError("Could not remove liquidity. Check your wallet and retry.");
    } finally {
      setOperation(undefined);
    }
  }

  async function report(outcome: 0 | 1) {
    if (!canReport || selectedOutcome !== outcome) return;
    setOperation("reporting");
    setTransactionError(undefined);
    try {
      const hash = await writeContractAsync({ functionName: "report", args: [outcome] });
      if (!hash) {
        setTransactionError("The outcome report was not completed. Check your wallet before retrying.");
        return;
      }
      setOutcomeReviewed(false);
      setSelectedOutcome(undefined);
      await refreshState();
    } catch (error) {
      console.error("Could not report prediction market outcome", error);
      setTransactionError("Could not report the outcome. Check your wallet before retrying.");
    } finally {
      setOperation(undefined);
    }
  }

  async function resolve() {
    if (!canResolve) return;
    setOperation("resolving");
    setTransactionError(undefined);
    try {
      const hash = await writeContractAsync({ functionName: "resolveMarketAndWithdraw" });
      if (!hash) {
        setTransactionError("The owner withdrawal was not completed. Check your wallet and retry.");
        return;
      }
      await refreshState();
    } catch (error) {
      console.error("Could not resolve prediction market and withdraw", error);
      setTransactionError("Could not withdraw owner proceeds. Check your wallet and retry.");
    } finally {
      setOperation(undefined);
    }
  }

  function displayAmount(value: bigint | undefined, error?: unknown) {
    if (contractLoading) return "Loading…";
    if (!market || predictionError || error) return "Unavailable";
    return formatPredictionAmount(value);
  }

  return (
    <section className="card bg-base-100 shadow-xl">
      <div className="card-body gap-4">
        <h2 className="card-title">Market administration</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <dt className="text-sm opacity-70 mb-1">Owner / liquidity provider</dt>
            <dd>
              {contractLoading || (!prediction && market) ? (
                "Loading…"
              ) : predictionError || !market || !ownerReady ? (
                "Unavailable"
              ) : (
                <AddressBlock address={owner} format="short" size="sm" />
              )}
            </dd>
          </div>
          <div>
            <dt className="text-sm opacity-70 mb-1">Outcome oracle</dt>
            <dd>
              {contractLoading || (!prediction && market) ? (
                "Loading…"
              ) : predictionError || !market || !oracle || oracle === zeroAddress ? (
                "Unavailable"
              ) : (
                <AddressBlock address={oracle} format="short" size="sm" />
              )}
            </dd>
          </div>
          <div>
            <dt className="text-sm opacity-70">Market collateral (ETH)</dt>
            <dd className="font-semibold">{displayAmount(collateral)}</dd>
          </div>
          <div>
            <dt className="text-sm opacity-70">Owner trading revenue (ETH)</dt>
            <dd className="font-semibold">{displayAmount(tradingRevenue)}</dd>
          </div>
          <div>
            <dt className="text-sm opacity-70">Owner locked YES tokens</dt>
            <dd>{displayAmount(ownerYesBalance, ownerYesError)}</dd>
          </div>
          <div>
            <dt className="text-sm opacity-70">Owner locked NO tokens</dt>
            <dd>{displayAmount(ownerNoBalance, ownerNoError)}</dd>
          </div>
        </dl>
        {!market && !contractLoading ? (
          <p className="text-sm text-warning m-0" role="alert">
            Sepolia PredictionMarket contract unavailable. Reload to retry.
          </p>
        ) : predictionError ? (
          <p className="text-sm text-warning m-0" role="alert">
            Could not refresh Sepolia market data. Administration is paused until the data recovers.
          </p>
        ) : !predictionReady ? (
          <p className="text-sm m-0" role="status">
            Loading market roles and liquidity data…
          </p>
        ) : !isConnected ? (
          <p className="text-sm m-0">Connect your wallet to see the controls available to your role.</p>
        ) : chainId !== PREDICTION_CHAIN_ID ? (
          <p className="text-sm text-warning m-0">Switch your wallet to Sepolia to use market administration.</p>
        ) : (
          <p className="text-sm m-0">
            Connected role:{" "}
            {isOwner && isOracle ? "owner and oracle" : isOwner ? "owner" : isOracle ? "oracle" : "trader"}.
          </p>
        )}
        {(ownerYesError || ownerNoError) && (
          <p className="text-xs text-warning m-0" role="alert">
            Could not refresh the owner’s locked token balances.
          </p>
        )}
        <div className="divider my-0" />
        <h3 className="font-semibold m-0">Owner liquidity controls</h3>
        <p className="text-sm m-0">
          Only the owner can add or remove ETH before the oracle reports. Removal burns an equal amount of market-held
          YES and NO tokens.
        </p>
        <label className="flex flex-col gap-2">
          <span>Add liquidity (ETH)</span>
          <IntegerInput value={addInput} onChange={setAddInput} placeholder="Amount" disableMultiplyBy1e18 />
        </label>
        <p className="text-xs m-0">
          Your Sepolia wallet ETH:{" "}
          {isConnected ? (walletEthError ? "Unavailable" : formatPredictionAmount(walletEth?.value)) : "Connect wallet"}
          . Leave ETH available for gas.
        </p>
        {isConnected && walletEthError && (
          <p className="text-sm text-warning m-0" role="alert">
            Could not refresh your wallet ETH balance. Liquidity deposits are paused.
          </p>
        )}
        {addAmount !== undefined && !walletEthError && walletEth !== undefined && addAmount >= walletEth.value && (
          <p className="text-sm text-warning m-0">
            The deposit must be less than your wallet ETH balance so ETH remains for gas.
          </p>
        )}
        {addInput.trim() !== "" && addAmount === undefined && (
          <p className="text-sm text-warning m-0">Enter a positive ETH amount with up to 18 decimal places.</p>
        )}
        {addAmount !== undefined && mintedTokens === 0n && (
          <p className="text-sm text-warning m-0">The deposit is too small to mint outcome tokens.</p>
        )}
        <button className="btn btn-primary" disabled={!canAdd} onClick={addLiquidity}>
          {operation === "adding" ? "Adding liquidity…" : "Add ETH liquidity"}
        </button>
        <label className="flex flex-col gap-2">
          <span>Remove liquidity (ETH)</span>
          <IntegerInput value={removeInput} onChange={setRemoveInput} placeholder="Amount" disableMultiplyBy1e18 />
        </label>
        <p className="text-xs m-0">
          Available within collateral and both token reserves: {displayAmount(maxWithdrawal)} ETH.
        </p>
        {removeInput.trim() !== "" && removeAmount === undefined && (
          <p className="text-sm text-warning m-0">Enter a positive ETH amount with up to 18 decimal places.</p>
        )}
        {removeAmount !== undefined && predictionReady && !removalFits && (
          <p className="text-sm text-warning m-0">
            The withdrawal must fit the collateral and both market token reserves.
          </p>
        )}
        {tokensToBurn !== undefined && !predictionError && (
          <p className="text-xs m-0">
            This withdrawal burns {formatPredictionAmount(tokensToBurn)} of each market-held outcome token.
          </p>
        )}
        <button className="btn btn-outline" disabled={!canRemove} onClick={removeLiquidity}>
          {operation === "removing" ? "Removing liquidity…" : "Remove ETH liquidity"}
        </button>
        {isReported === true && !predictionError && (
          <p className="text-sm m-0">The outcome has been reported. Liquidity additions and removals are closed.</p>
        )}
        <div className="divider my-0" />
        <h3 className="font-semibold m-0">Oracle outcome report</h3>
        <p className="text-sm m-0">
          Reporting permanently selects the winning outcome, closes trading, and enables winner redemption.
        </p>
        {isReported === true && !predictionError ? (
          <p className="text-sm m-0">
            Final reported outcome: <span className="font-semibold">{finalOutcome ?? "Unavailable"}</span>.
          </p>
        ) : (
          <>
            <fieldset className="flex flex-wrap gap-4" disabled={!canTransact || !isOracle || isReported !== false}>
              <legend className="text-sm mb-2">Select the final outcome</legend>
              {([0, 1] as const).map(outcome => (
                <label key={outcome} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="market-final-outcome"
                    className="radio radio-sm"
                    checked={selectedOutcome === outcome}
                    onChange={() => {
                      setSelectedOutcome(outcome);
                      setOutcomeReviewed(false);
                    }}
                  />
                  {outcome === 0 ? "YES" : "NO"}
                </label>
              ))}
            </fieldset>
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="checkbox checkbox-sm mt-0.5"
                checked={outcomeReviewed}
                onChange={event => setOutcomeReviewed(event.target.checked)}
                disabled={!canTransact || !isOracle || selectedOutcome === undefined || isReported !== false}
              />
              <span>
                I reviewed the selected outcome and understand that reporting permanently settles this market.
              </span>
            </label>
            <div className="flex flex-wrap gap-3">
              <button
                className="btn btn-success"
                disabled={!canReport || selectedOutcome !== 0}
                onClick={() => report(0)}
              >
                {operation === "reporting" && selectedOutcome === 0 ? "Reporting YES…" : "Report YES"}
              </button>
              <button
                className="btn btn-error"
                disabled={!canReport || selectedOutcome !== 1}
                onClick={() => report(1)}
              >
                {operation === "reporting" && selectedOutcome === 1 ? "Reporting NO…" : "Report NO"}
              </button>
            </div>
          </>
        )}
        <div className="divider my-0" />
        <h3 className="font-semibold m-0">Owner settlement withdrawal</h3>
        <p className="text-sm m-0">
          After reporting, the owner can burn the market’s remaining winning tokens and withdraw their backing plus
          trading revenue. User winnings remain redeemable.
        </p>
        {isReported === true && (
          <p className="text-sm m-0">
            Estimated owner withdrawal: {displayAmount(ownerPayout, winningBalanceError)} ETH.
          </p>
        )}
        {isReported === true && winningBalanceError && (
          <p className="text-sm text-warning m-0" role="alert">
            Could not refresh the market’s winning token balance. Owner withdrawal is paused.
          </p>
        )}
        {isReported === true &&
          !predictionError &&
          !winningBalanceError &&
          marketWinningBalance !== undefined &&
          !hasOwnerProceeds && (
            <p className="text-sm m-0">No market-held winning tokens or trading revenue remain to withdraw.</p>
          )}
        <button className="btn btn-outline" disabled={!canResolve} onClick={resolve}>
          {operation === "resolving" ? "Withdrawing owner proceeds…" : "Resolve and withdraw owner proceeds"}
        </button>
        {transactionError && (
          <p className="text-sm text-error m-0" role="alert">
            {transactionError}
          </p>
        )}
      </div>
    </section>
  );
}
