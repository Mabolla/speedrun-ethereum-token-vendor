"use client";

import MarketAdministration from "./_components/MarketAdministration";
import MarketOverview from "./_components/MarketOverview";
import OutcomeTrading from "./_components/OutcomeTrading";
import Redeem from "./_components/Redeem";
import { Address } from "@scaffold-ui/components";
import { useAccount } from "wagmi";
import { useDeployedContractInfo, useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { PREDICTION_CHAIN_ID } from "~~/utils/predictionMarkets";

export default function PredictionMarketsPage() {
  const { address, isConnected, chainId } = useAccount();
  const { data: market, isLoading: contractLoading } = useDeployedContractInfo({
    contractName: "PredictionMarket",
    chainId: PREDICTION_CHAIN_ID,
  });
  const {
    data: prediction,
    error,
    isLoading,
    refetch,
  } = useScaffoldReadContract({
    contractName: "PredictionMarket",
    functionName: "getPrediction",
    chainId: PREDICTION_CHAIN_ID,
  });
  const isOwner = address?.toLowerCase() === prediction?.[13].toLowerCase();

  return (
    <main className="w-full max-w-7xl mx-auto px-4 py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Prediction Markets</h1>
        <p className="m-0">
          Trade YES or NO outcome shares on Sepolia. After the oracle reports the result, winning shares can be redeemed
          for their ETH payout.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="badge badge-outline">Educational testnet market</span>
          {market ? (
            <Address address={market.address} />
          ) : (
            <span>{contractLoading ? "Loading market…" : "Market unavailable"}</span>
          )}
        </div>
      </div>
      {!isConnected && <div className="alert mb-6">Connect your wallet to trade, redeem or use your market role.</div>}
      {isConnected && chainId !== PREDICTION_CHAIN_ID && (
        <div className="alert alert-warning mb-6">Switch your wallet to Sepolia to use this market.</div>
      )}
      {error && (
        <div className="alert alert-warning mb-6">
          <span>Could not refresh market data. Actions are paused until it recovers.</span>
          <button className="btn btn-sm" onClick={() => refetch()}>
            Refresh
          </button>
        </div>
      )}
      {prediction ? (
        <>
          <MarketOverview prediction={prediction} />
          {isOwner && (
            <p className="text-sm mt-4">
              The liquidity provider manages the pool and cannot trade or redeem user shares. Use another account for
              trading.
            </p>
          )}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6 items-start">
            <OutcomeTrading outcome={0} prediction={prediction} marketError={Boolean(error)} />
            <OutcomeTrading outcome={1} prediction={prediction} marketError={Boolean(error)} />
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6 items-start">
            <Redeem prediction={prediction} marketError={Boolean(error)} />
            <MarketAdministration />
          </div>
        </>
      ) : (
        <section className="card bg-base-100 shadow-xl">
          <div className="card-body">
            {contractLoading || isLoading
              ? "Loading the onchain market…"
              : "Market data is unavailable. Refresh or reload to retry."}
          </div>
        </section>
      )}
    </main>
  );
}
