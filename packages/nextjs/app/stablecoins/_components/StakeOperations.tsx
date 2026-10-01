"use client";

import { useState } from "react";
import { IntegerInput } from "@scaffold-ui/debug-contracts";
import { useAccount, useConfig } from "wagmi";
import { getAccount } from "wagmi/actions";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { STABLECOIN_CHAIN_ID, formatStableAmount, parsePositiveAmount } from "~~/utils/stablecoins";

const SHARE_PRECISION = 10n ** 18n;

export default function StakeOperations() {
  const { address, chainId, isConnected } = useAccount();
  const walletConfig = useConfig();
  const [stakeInput, setStakeInput] = useState("");
  const [operation, setOperation] = useState<"approving" | "staking" | "withdrawing" | undefined>();
  const [transactionError, setTransactionError] = useState<string>();
  const { data: myUSD, isLoading: tokenLoading } = useDeployedContractInfo({
    contractName: "MyUSD",
    chainId: STABLECOIN_CHAIN_ID,
  });
  const { data: staking, isLoading: stakingLoading } = useDeployedContractInfo({
    contractName: "MyUSDStaking",
    chainId: STABLECOIN_CHAIN_ID,
  });
  const {
    data: walletBalance,
    error: balanceError,
    refetch: refetchBalance,
  } = useScaffoldReadContract({
    contractName: "MyUSD",
    functionName: "balanceOf",
    args: [address],
    chainId: STABLECOIN_CHAIN_ID,
    query: { enabled: Boolean(myUSD && address) },
  });
  const {
    data: shares,
    error: sharesError,
    refetch: refetchShares,
  } = useScaffoldReadContract({
    contractName: "MyUSDStaking",
    functionName: "userShares",
    args: [address],
    chainId: STABLECOIN_CHAIN_ID,
    query: { enabled: Boolean(staking && address) },
  });
  const {
    data: stakedBalance,
    error: stakedBalanceError,
    refetch: refetchStakedBalance,
  } = useScaffoldReadContract({
    contractName: "MyUSDStaking",
    functionName: "getBalance",
    args: [address],
    chainId: STABLECOIN_CHAIN_ID,
    query: { enabled: Boolean(staking && address) },
  });
  const { data: savingsRate, error: savingsRateError } = useScaffoldReadContract({
    contractName: "MyUSDStaking",
    functionName: "savingsRate",
    chainId: STABLECOIN_CHAIN_ID,
    query: { enabled: Boolean(staking) },
  });
  const { data: currentShareValue, error: shareValueError } = useScaffoldReadContract({
    contractName: "MyUSDStaking",
    functionName: "getSharesValue",
    args: [SHARE_PRECISION],
    chainId: STABLECOIN_CHAIN_ID,
    query: { enabled: Boolean(staking) },
  });
  const {
    writeContractAsync: writeMyUSD,
    isMining: approvalMining,
    isPending: approvalPending,
  } = useScaffoldWriteContract({ contractName: "MyUSD", chainId: STABLECOIN_CHAIN_ID });
  const {
    writeContractAsync: writeStaking,
    isMining: stakingMining,
    isPending: stakingPending,
  } = useScaffoldWriteContract({ contractName: "MyUSDStaking", chainId: STABLECOIN_CHAIN_ID });

  const amount = parsePositiveAmount(stakeInput);
  const contractLoading = tokenLoading || stakingLoading;
  const contractsAvailable = Boolean(myUSD && staking);
  const readError = Boolean(balanceError || sharesError || stakedBalanceError || savingsRateError || shareValueError);
  const dataReady =
    walletBalance !== undefined &&
    shares !== undefined &&
    stakedBalance !== undefined &&
    savingsRate !== undefined &&
    currentShareValue !== undefined;
  const busy = operation !== undefined || approvalMining || approvalPending || stakingMining || stakingPending;
  const canTransact =
    isConnected &&
    Boolean(address) &&
    chainId === STABLECOIN_CHAIN_ID &&
    contractsAvailable &&
    dataReady &&
    !readError &&
    !busy;
  const insufficientBalance = amount !== undefined && walletBalance !== undefined && amount > walletBalance;
  const receivesShares =
    amount !== undefined &&
    currentShareValue !== undefined &&
    currentShareValue > 0n &&
    (amount * SHARE_PRECISION) / currentShareValue > 0n;
  const canStake = canTransact && amount !== undefined && !insufficientBalance && receivesShares;
  const canWithdraw = canTransact && shares !== undefined && shares > 0n;

  async function refreshPosition() {
    await Promise.allSettled([refetchBalance(), refetchShares(), refetchStakedBalance()]);
  }

  async function stake() {
    if (!canStake || !staking || amount === undefined) return;
    setTransactionError(undefined);
    setOperation("approving");
    try {
      const approval = await writeMyUSD({ functionName: "approve", args: [staking.address, amount] });
      if (!approval) {
        setTransactionError("MyUSD approval was not completed. Retry when your wallet is ready.");
        return;
      }
      const currentAccount = getAccount(walletConfig);
      if (
        !currentAccount.isConnected ||
        currentAccount.chainId !== STABLECOIN_CHAIN_ID ||
        currentAccount.address?.toLowerCase() !== address?.toLowerCase()
      ) {
        setTransactionError(
          "Your wallet changed after approval. Reconnect the approving account on Sepolia and retry.",
        );
        return;
      }
      setOperation("staking");
      const hash = await writeStaking({ functionName: "stake", args: [amount] });
      if (!hash) {
        setTransactionError("The stake transaction was not completed. Retry when your wallet is ready.");
        return;
      }
      setStakeInput("");
      await refreshPosition();
    } catch (error) {
      console.error("Could not stake MyUSD", error);
      setTransactionError("Could not complete staking. Check your wallet and retry.");
    } finally {
      setOperation(undefined);
    }
  }

  async function withdraw() {
    if (!canWithdraw) return;
    setTransactionError(undefined);
    setOperation("withdrawing");
    try {
      const hash = await writeStaking({ functionName: "withdraw" });
      if (!hash) {
        setTransactionError("The withdrawal was not completed. Retry when your wallet is ready.");
        return;
      }
      await refreshPosition();
    } catch (error) {
      console.error("Could not withdraw MyUSD", error);
      setTransactionError("Could not complete withdrawal. Check your wallet and retry.");
    } finally {
      setOperation(undefined);
    }
  }

  function positionValue(value: bigint | undefined, error: unknown) {
    if (!isConnected || !address) return "Connect wallet";
    if (contractLoading) return "Loading…";
    if (!contractsAvailable || error) return "Unavailable";
    return formatStableAmount(value);
  }

  return (
    <section className="card bg-base-100 shadow-xl">
      <div className="card-body gap-4">
        <h2 className="card-title">Stake MyUSD</h2>
        <p className="m-0 text-sm">
          Stake MyUSD to earn the onchain savings rate. Withdrawal redeems all your shares and yield.
        </p>
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
          <div>
            <dt className="text-sm opacity-70">Wallet balance (MyUSD)</dt>
            <dd className="font-semibold">{positionValue(walletBalance, balanceError)}</dd>
          </div>
          <div>
            <dt className="text-sm opacity-70">Staked balance with yield (MyUSD)</dt>
            <dd className="font-semibold">{positionValue(stakedBalance, stakedBalanceError)}</dd>
          </div>
          <div>
            <dt className="text-sm opacity-70">Your shares</dt>
            <dd className="font-semibold">{positionValue(shares, sharesError)}</dd>
          </div>
          <div>
            <dt className="text-sm opacity-70">Savings rate (annual)</dt>
            <dd className="font-semibold">
              {contractLoading
                ? "Loading…"
                : !staking || savingsRateError
                  ? "Unavailable"
                  : savingsRate === undefined
                    ? "Loading…"
                    : `${(Number(savingsRate) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}%`}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-sm opacity-70">Current value of one share (MyUSD)</dt>
            <dd className="font-semibold">
              {contractLoading
                ? "Loading…"
                : !staking || shareValueError
                  ? "Unavailable"
                  : formatStableAmount(currentShareValue)}
            </dd>
          </div>
        </dl>
        {!contractsAvailable && !contractLoading ? (
          <p className="text-sm text-warning m-0" role="alert">
            Sepolia MyUSD contracts are unavailable. Reload to retry.
          </p>
        ) : readError ? (
          <p className="text-sm text-warning m-0" role="alert">
            Could not refresh Sepolia staking data. Transactions are paused until the data recovers.
          </p>
        ) : !isConnected ? (
          <p className="text-sm m-0">Connect your wallet to stake or withdraw MyUSD.</p>
        ) : chainId !== STABLECOIN_CHAIN_ID ? (
          <p className="text-sm text-warning m-0">Switch your wallet to Sepolia to stake or withdraw.</p>
        ) : !dataReady ? (
          <p className="text-sm m-0" role="status">
            Loading staking balances and rates…
          </p>
        ) : null}
        <label className="flex flex-col gap-2">
          <span>Stake amount (MyUSD)</span>
          <IntegerInput value={stakeInput} onChange={setStakeInput} placeholder="Amount" disableMultiplyBy1e18 />
        </label>
        {stakeInput.trim() !== "" && amount === undefined && (
          <p className="text-sm text-warning m-0">Enter a positive amount with up to 18 decimal places.</p>
        )}
        {!balanceError && insufficientBalance && (
          <p className="text-sm text-warning m-0">The amount exceeds your wallet MyUSD balance.</p>
        )}
        {amount !== undefined && !shareValueError && currentShareValue !== undefined && !receivesShares && (
          <p className="text-sm text-warning m-0">The amount is too small to receive a staking share.</p>
        )}
        <button className="btn btn-primary" disabled={!canStake} onClick={stake}>
          {operation === "approving" ? "Approving MyUSD…" : operation === "staking" ? "Staking…" : "Approve and stake"}
        </button>
        <p className="text-xs m-0">
          Your wallet confirms two transactions: approval for exactly this amount, then staking.
        </p>
        <div className="divider my-0" />
        <button className="btn btn-outline" disabled={!canWithdraw} onClick={withdraw}>
          {operation === "withdrawing" ? "Withdrawing…" : "Withdraw all MyUSD and yield"}
        </button>
        {isConnected && !sharesError && contractsAvailable && shares === 0n && (
          <p className="text-sm m-0">You have no staking shares to withdraw.</p>
        )}
        {transactionError && (
          <p className="text-sm text-error m-0" role="alert">
            {transactionError}
          </p>
        )}
      </div>
    </section>
  );
}
