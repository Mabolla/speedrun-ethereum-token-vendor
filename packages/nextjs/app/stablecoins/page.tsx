"use client";

import CollateralOperations from "./_components/CollateralOperations";
import MintOperations from "./_components/MintOperations";
import Overview from "./_components/Overview";
import RateControls from "./_components/RateControls";
import StakeOperations from "./_components/StakeOperations";
import StakersTable from "./_components/StakersTable";
import TokenActions from "./_components/TokenActions";
import UserPositionsTable from "./_components/UserPositionsTable";
import { Address } from "@scaffold-ui/components";
import { useAccount } from "wagmi";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";
import { STABLECOIN_CHAIN_ID } from "~~/utils/stablecoins";

export default function StablecoinsDashboard() {
  const { isConnected, chainId } = useAccount();
  const { data: engine, isLoading } = useDeployedContractInfo({
    contractName: "MyUSDEngine",
    chainId: STABLECOIN_CHAIN_ID,
  });
  return (
    <main className="w-full max-w-7xl mx-auto px-4 py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">MyUSD Stablecoin</h1>
        <p className="m-0">
          Deposit Sepolia ETH, mint MyUSD against at least 150% collateral, and stake it to earn the demo savings rate.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="badge badge-outline">Sepolia educational demo</span>
          {engine ? (
            <Address address={engine.address} />
          ) : (
            <span>{isLoading ? "Loading engine…" : "Engine unavailable"}</span>
          )}
        </div>
      </div>
      {!isConnected && (
        <div className="alert mb-6">Connect your wallet to manage collateral, MyUSD debt, savings or swaps.</div>
      )}
      {isConnected && chainId !== STABLECOIN_CHAIN_ID && (
        <div className="alert alert-warning mb-6">Switch your wallet to Sepolia to use this dashboard.</div>
      )}
      <Overview />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6 items-start">
        <div className="grid gap-6">
          <CollateralOperations />
          <MintOperations />
          <StakeOperations />
          <TokenActions />
        </div>
        <div className="grid gap-6">
          <RateControls />
          <UserPositionsTable />
          <StakersTable />
        </div>
      </div>
      <p className="text-sm opacity-70 mt-6">
        Debt and staking values accrue interest through shares. Rates can be changed manually through the public demo
        controller; borrowing rates must stay at or above savings rates.
      </p>
    </main>
  );
}
