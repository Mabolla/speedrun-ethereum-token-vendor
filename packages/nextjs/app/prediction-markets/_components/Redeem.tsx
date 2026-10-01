import { useState } from "react";
import { IntegerInput } from "@scaffold-ui/debug-contracts";
import { erc20Abi } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import {
  PREDICTION_CHAIN_ID,
  PREDICTION_PRECISION,
  type PredictionDetails,
  formatPredictionAmount,
  parsePredictionAmount,
} from "~~/utils/predictionMarkets";

export default function Redeem({ prediction, marketError }: { prediction: PredictionDetails; marketError: boolean }) {
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState<string>();
  const { address, isConnected, chainId } = useAccount();
  const token = prediction[10];
  const winner = token.toLowerCase() === prediction[8].toLowerCase() ? prediction[1] : prediction[2];
  const {
    data: balance,
    error,
    refetch,
  } = useReadContract({
    address: token,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: PREDICTION_CHAIN_ID,
    query: { enabled: Boolean(address) && prediction[7], refetchInterval: 3000 },
  });
  const { writeContractAsync, isMining } = useScaffoldWriteContract({
    contractName: "PredictionMarket",
    chainId: PREDICTION_CHAIN_ID,
  });
  const amount = parsePredictionAmount(input);
  const payout = amount !== undefined ? (amount * prediction[4]) / PREDICTION_PRECISION : undefined;
  const isOwner = address?.toLowerCase() === prediction[13].toLowerCase();
  const canRedeem =
    isConnected &&
    chainId === PREDICTION_CHAIN_ID &&
    prediction[7] &&
    !isOwner &&
    !isMining &&
    !marketError &&
    !error &&
    amount !== undefined &&
    balance !== undefined &&
    amount <= balance &&
    payout !== undefined &&
    payout > 0n &&
    payout <= prediction[11];

  async function redeem() {
    if (!canRedeem || amount === undefined) return;
    setNotice(undefined);
    try {
      const hash = await writeContractAsync({ functionName: "redeemWinningTokens", args: [amount] });
      if (hash) {
        setInput("");
        await refetch();
      }
    } catch (error) {
      console.error("Could not redeem winning shares", error);
      setNotice("Redemption was not completed. Check the current balance and your wallet before retrying.");
    }
  }

  return (
    <section className="card bg-base-100 shadow-xl">
      <div className="card-body gap-4">
        <h2 className="card-title">Redeem winning shares</h2>
        {!prediction[7] ? (
          <p className="m-0">Redemption becomes available after the oracle reports the final outcome.</p>
        ) : (
          <>
            <p className="m-0">
              Winning outcome: {winner}. Your winning balance:{" "}
              {address ? (error ? "Unavailable" : formatPredictionAmount(balance)) : "Connect wallet"}.
            </p>
            <label className="flex flex-col gap-2">
              <span>Winning shares to redeem</span>
              <IntegerInput value={input} onChange={setInput} placeholder="Amount" disableMultiplyBy1e18 />
            </label>
            <p className="text-sm m-0">
              ETH payout: {payout === undefined ? "Enter an amount" : formatPredictionAmount(payout)}.
            </p>
            <button className="btn btn-primary" disabled={!canRedeem} onClick={redeem}>
              {isMining ? "Confirming…" : "Redeem for ETH"}
            </button>
            <p className="text-xs opacity-70 m-0">
              Winning shares are burned by the market. No token allowance is needed for redemption.
            </p>
            {error && (
              <p className="text-sm text-warning m-0" role="alert">
                Could not refresh the winning-token balance.
              </p>
            )}
            {payout !== undefined && payout > prediction[11] && (
              <p className="text-sm text-warning m-0">This amount exceeds the remaining ETH collateral.</p>
            )}
          </>
        )}
        {notice && (
          <p className="text-sm text-warning m-0" role="alert">
            {notice}
          </p>
        )}
      </div>
    </section>
  );
}
