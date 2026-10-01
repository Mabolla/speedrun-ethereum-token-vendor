import { useState } from "react";
import { Address } from "@scaffold-ui/components";
import { IntegerInput } from "@scaffold-ui/debug-contracts";
import { erc20Abi } from "viem";
import { useAccount, useBalance, useConfig, useReadContract, useWriteContract } from "wagmi";
import { getAccount } from "wagmi/actions";
import {
  useDeployedContractInfo,
  useScaffoldReadContract,
  useScaffoldWriteContract,
  useTransactor,
} from "~~/hooks/scaffold-eth";
import {
  PREDICTION_CHAIN_ID,
  PREDICTION_PRECISION,
  type PredictionDetails,
  formatPredictionAmount,
  parsePredictionAmount,
} from "~~/utils/predictionMarkets";

type Props = { outcome: 0 | 1; prediction: PredictionDetails; marketError: boolean };

export default function OutcomeTrading({ outcome, prediction, marketError }: Props) {
  const [buyInput, setBuyInput] = useState("");
  const [sellInput, setSellInput] = useState("");
  const [operation, setOperation] = useState<"buy" | "approve" | "sell" | undefined>();
  const [notice, setNotice] = useState<string>();
  const { address, isConnected, chainId } = useAccount();
  const walletConfig = useConfig();
  const { data: market } = useDeployedContractInfo({ contractName: "PredictionMarket", chainId: PREDICTION_CHAIN_ID });
  const token = outcome === 0 ? prediction[8] : prediction[9];
  const name = outcome === 0 ? prediction[1] : prediction[2];
  const reserve = outcome === 0 ? prediction[5] : prediction[6];
  const buyAmount = parsePredictionAmount(buyInput);
  const sellAmount = parsePredictionAmount(sellInput);
  const {
    data: balance,
    error: balanceError,
    refetch: refetchBalance,
  } = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: PREDICTION_CHAIN_ID,
    query: { enabled: Boolean(address), refetchInterval: 3000 },
  });
  const {
    data: allowance,
    error: allowanceError,
    refetch: refetchAllowance,
  } = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "allowance",
    args: address && market ? [address, market.address] : undefined,
    chainId: PREDICTION_CHAIN_ID,
    query: { enabled: Boolean(address && market), refetchInterval: 3000 },
  });
  const { data: walletEth, error: ethError } = useBalance({
    address,
    chainId: PREDICTION_CHAIN_ID,
    query: { refetchInterval: 3000 },
  });
  const {
    data: buyPrice,
    error: buyError,
    refetch: refetchBuyPrice,
  } = useScaffoldReadContract({
    contractName: "PredictionMarket",
    functionName: "getBuyPriceInEth",
    args: [outcome, buyAmount],
    chainId: PREDICTION_CHAIN_ID,
    query: { enabled: buyAmount !== undefined && buyAmount <= reserve && !prediction[7] },
  });
  const {
    data: sellPrice,
    error: sellError,
    refetch: refetchSellPrice,
  } = useScaffoldReadContract({
    contractName: "PredictionMarket",
    functionName: "getSellPriceInEth",
    args: [outcome, sellAmount],
    chainId: PREDICTION_CHAIN_ID,
    query: { enabled: sellAmount !== undefined && balance !== undefined && sellAmount <= balance && !prediction[7] },
  });
  const { writeContractAsync: writeMarket } = useScaffoldWriteContract({
    contractName: "PredictionMarket",
    chainId: PREDICTION_CHAIN_ID,
  });
  const { writeContractAsync: writeToken } = useWriteContract();
  const transact = useTransactor();
  const isOwner = address?.toLowerCase() === prediction[13].toLowerCase();
  const canTransact =
    isConnected &&
    chainId === PREDICTION_CHAIN_ID &&
    Boolean(market) &&
    !prediction[7] &&
    !isOwner &&
    operation === undefined &&
    !marketError;
  const canBuy =
    !buyError &&
    !ethError &&
    buyAmount !== undefined &&
    buyAmount <= reserve &&
    buyPrice !== undefined &&
    buyPrice > 0n &&
    walletEth !== undefined &&
    buyPrice < walletEth.value;
  const canSell =
    !sellError &&
    !balanceError &&
    !allowanceError &&
    sellAmount !== undefined &&
    balance !== undefined &&
    sellAmount <= balance &&
    allowance !== undefined &&
    sellPrice !== undefined &&
    sellPrice > 0n &&
    sellPrice <= prediction[12];

  function walletMatches() {
    const current = getAccount(walletConfig);
    return (
      current.isConnected &&
      current.chainId === PREDICTION_CHAIN_ID &&
      current.address?.toLowerCase() === address?.toLowerCase()
    );
  }

  async function buy() {
    if (!canTransact || !canBuy || buyAmount === undefined || buyPrice === undefined) return;
    setNotice(undefined);
    setOperation("buy");
    try {
      const latest = await refetchBuyPrice();
      if (latest.error || latest.data === undefined) {
        setNotice("Could not refresh the buy quote. Retry after the data recovers.");
        return;
      }
      if (latest.data !== buyPrice) {
        setNotice("The buy quote changed. Review the updated price and click Buy again.");
        return;
      }
      if (!walletMatches()) {
        setNotice("Your wallet changed. Reconnect the original account on Sepolia.");
        return;
      }
      const hash = await writeMarket({
        functionName: "buyTokensWithETH",
        args: [outcome, buyAmount],
        value: latest.data,
      });
      if (hash) {
        setBuyInput("");
        await refetchBalance();
      }
    } catch (error) {
      console.error("Could not buy outcome shares", error);
      setNotice("Purchase was not completed. Refresh the quote and check your wallet before retrying.");
    } finally {
      setOperation(undefined);
    }
  }

  async function sell() {
    if (
      !canTransact ||
      !canSell ||
      !market ||
      sellAmount === undefined ||
      sellPrice === undefined ||
      allowance === undefined
    )
      return;
    setNotice(undefined);
    setOperation("sell");
    try {
      if (allowance < sellAmount) {
        setOperation("approve");
        const approval = await transact(() =>
          writeToken({
            address: token,
            abi: erc20Abi,
            functionName: "approve",
            args: [market.address, sellAmount],
            chainId: PREDICTION_CHAIN_ID,
          }),
        );
        if (!approval) {
          setNotice("Approval was not completed.");
          return;
        }
        await refetchAllowance();
        setOperation("sell");
      }
      if (!walletMatches()) {
        setNotice("Your wallet changed after approval. Reconnect the approving account on Sepolia.");
        return;
      }
      const latest = await refetchSellPrice();
      if (latest.error || latest.data === undefined) {
        setNotice("Could not refresh the sell quote. Retry after the data recovers.");
        return;
      }
      if (latest.data !== sellPrice) {
        setNotice("The sell quote changed. Review the updated payout and click Sell again.");
        return;
      }
      const hash = await writeMarket({ functionName: "sellTokensForEth", args: [outcome, sellAmount] });
      if (hash) {
        setSellInput("");
        await Promise.allSettled([refetchBalance(), refetchAllowance()]);
      }
    } catch (error) {
      console.error("Could not sell outcome shares", error);
      setNotice("Sale was not completed. Refresh the quote and check your wallet before retrying.");
    } finally {
      setOperation(undefined);
    }
  }

  return (
    <section className="card bg-base-100 shadow-xl">
      <div className="card-body gap-4">
        <h2 className="card-title">{name} shares</h2>
        <Address address={token} format="short" />
        <p className="m-0">
          Your balance: {address ? (balanceError ? "Unavailable" : formatPredictionAmount(balance)) : "Connect wallet"}
        </p>
        <p className="text-sm m-0">Market reserve: {formatPredictionAmount(reserve)} shares.</p>
        {(buyError || sellError || balanceError || allowanceError || ethError) && (
          <p className="text-sm text-warning m-0" role="alert">
            Could not refresh quotes or balances. Affected trading actions are paused.
          </p>
        )}
        <label className="flex flex-col gap-2">
          <span>Shares to buy</span>
          <IntegerInput value={buyInput} onChange={setBuyInput} placeholder="1" disableMultiplyBy1e18 />
        </label>
        <p className="text-sm m-0">
          Buy cost:{" "}
          {buyAmount === undefined
            ? "Enter an amount"
            : buyAmount > reserve
              ? "Amount exceeds market reserve"
              : buyError
                ? "Unavailable"
                : `${formatPredictionAmount(buyPrice)} ETH`}
        </p>
        {buyAmount !== undefined && (
          <p className="text-xs opacity-70 m-0">
            Winning payout for this amount: {formatPredictionAmount((buyAmount * prediction[4]) / PREDICTION_PRECISION)}{" "}
            ETH.
          </p>
        )}
        <button className="btn btn-primary" disabled={!canTransact || !canBuy} onClick={buy}>
          {operation === "buy" ? "Confirming…" : `Buy ${name}`}
        </button>
        <label className="flex flex-col gap-2">
          <span>Shares to sell</span>
          <IntegerInput value={sellInput} onChange={setSellInput} placeholder="Amount" disableMultiplyBy1e18 />
        </label>
        <p className="text-sm m-0">
          Sell payout quote:{" "}
          {sellAmount === undefined
            ? "Enter an amount"
            : balance !== undefined && sellAmount > balance
              ? "Amount exceeds your share balance"
              : sellError
                ? "Unavailable"
                : `${formatPredictionAmount(sellPrice)} ETH`}
        </p>
        <button className="btn btn-outline" disabled={!canTransact || !canSell} onClick={sell}>
          {operation === "approve"
            ? "Approving…"
            : operation === "sell"
              ? "Confirming…"
              : sellAmount !== undefined && allowance !== undefined && allowance < sellAmount
                ? `Approve and sell ${name}`
                : `Sell ${name}`}
        </button>
        <p className="text-xs opacity-70 m-0">
          Quotes are refreshed before submission. Buys require the exact quoted ETH and revert if it changes. Sells have
          no onchain minimum payout parameter, so their final payout can change before mining.
        </p>
        {sellPrice !== undefined && sellPrice > prediction[12] && (
          <p className="text-xs text-warning m-0">Trading revenue is currently too low to cover this sale.</p>
        )}
        {prediction[7] && <p className="text-sm m-0">Trading is closed because the oracle reported the outcome.</p>}
        {notice && (
          <p className="text-sm text-warning m-0" role="alert">
            {notice}
          </p>
        )}
      </div>
    </section>
  );
}
