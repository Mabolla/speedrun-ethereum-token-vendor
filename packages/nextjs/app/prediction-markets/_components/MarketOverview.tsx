import { Address } from "@scaffold-ui/components";
import { erc20Abi } from "viem";
import { useReadContract } from "wagmi";
import {
  PREDICTION_CHAIN_ID,
  PREDICTION_PRECISION,
  type PredictionDetails,
  formatPredictionAmount,
} from "~~/utils/predictionMarkets";

export default function MarketOverview({ prediction }: { prediction: PredictionDetails }) {
  const { data: yesSupply, error: supplyError } = useReadContract({
    address: prediction[8],
    abi: erc20Abi,
    functionName: "totalSupply",
    chainId: PREDICTION_CHAIN_ID,
    query: { refetchInterval: 3000 },
  });
  const yesSold = yesSupply !== undefined && yesSupply >= prediction[5] ? yesSupply - prediction[5] : undefined;
  const noSold = yesSupply !== undefined && yesSupply >= prediction[6] ? yesSupply - prediction[6] : undefined;
  const totalSold = yesSold !== undefined && noSold !== undefined ? yesSold + noSold : undefined;
  const yesProbability =
    !supplyError && yesSold !== undefined && totalSold !== undefined
      ? totalSold > 0n
        ? (yesSold * PREDICTION_PRECISION) / totalSold
        : (prediction[14] * PREDICTION_PRECISION) / 100n
      : undefined;
  const yesPercent =
    yesProbability !== undefined ? Number((yesProbability * 10000n) / PREDICTION_PRECISION) / 100 : undefined;
  const winningName = prediction[10].toLowerCase() === prediction[8].toLowerCase() ? prediction[1] : prediction[2];

  return (
    <section className="card bg-base-100 shadow-xl">
      <div className="card-body">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 className="card-title text-xl">{prediction[0]}</h2>
          <span className={`badge ${prediction[7] ? "badge-success" : "badge-outline"}`}>
            {prediction[7] ? `Reported: ${winningName}` : "Open for trading"}
          </span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div>
            <span className="text-sm opacity-70">ETH collateral</span>
            <div className="text-xl font-semibold">{formatPredictionAmount(prediction[11])} ETH</div>
          </div>
          <div>
            <span className="text-sm opacity-70">Trading revenue</span>
            <div className="text-xl font-semibold">{formatPredictionAmount(prediction[12])} ETH</div>
          </div>
          <div>
            <span className="text-sm opacity-70">Payout per winning share</span>
            <div className="text-xl font-semibold">{formatPredictionAmount(prediction[4])} ETH</div>
          </div>
        </div>
        {!prediction[7] && (
          <div className="mt-3">
            <p className="text-sm m-0">
              Implied probability:{" "}
              {yesPercent === undefined
                ? supplyError
                  ? "Unavailable"
                  : "Loading…"
                : `${prediction[1]} ${yesPercent.toFixed(2)}% / ${prediction[2]} ${(100 - yesPercent).toFixed(2)}%`}
            </p>
            {yesPercent !== undefined && (
              <svg
                viewBox="0 0 400 20"
                className="w-full mt-2"
                role="img"
                aria-label={`YES probability ${yesPercent.toFixed(2)} percent`}
              >
                <rect width="400" height="20" rx="3" fill="#ef4444" />
                <rect width={4 * yesPercent} height="20" rx="3" fill="#10b981" />
              </svg>
            )}
          </div>
        )}
        <p className="text-sm m-0 mt-2">
          Available shares: {formatPredictionAmount(prediction[5])} {prediction[1]} /{" "}
          {formatPredictionAmount(prediction[6])} {prediction[2]}.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
          <div>
            <span className="text-sm opacity-70">Liquidity provider</span>
            <Address address={prediction[13]} />
          </div>
          <div>
            <span className="text-sm opacity-70">Result oracle</span>
            <Address address={prediction[3]} />
          </div>
        </div>
      </div>
    </section>
  );
}
