"use client";

import BorrowOperations from "./_components/BorrowOperations";
import CollateralOperations from "./_components/CollateralOperations";
import PriceActions from "./_components/PriceActions";
import TokenActions from "./_components/TokenActions";
import UserPositionsTable from "./_components/UserPositionsTable";
import { Address } from "@scaffold-ui/components";
import { useAccount } from "wagmi";
import { useDeployedContractInfo } from "~~/hooks/scaffold-eth";
import { LENDING_CHAIN_ID } from "~~/utils/lending";

export default function LendingDashboard() {
  const { isConnected, chainId } = useAccount();
  const { data: lending, isLoading } = useDeployedContractInfo({
    contractName: "Lending",
    chainId: LENDING_CHAIN_ID,
  });

  return (
    <main className="w-full max-w-7xl mx-auto px-4 py-10">
      <div className="mb-6">
        <h1 className="text-3xl font-bold mb-2">Over-Collateralized Lending</h1>
        <p className="m-0">
          Deposit Sepolia ETH and borrow CORN. Positions must stay at or above 120% collateralization.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="badge badge-outline">Sepolia demo</span>
          {lending ? (
            <Address address={lending.address} />
          ) : (
            <span>{isLoading ? "Loading contract…" : "Contract unavailable"}</span>
          )}
        </div>
      </div>
      {!isConnected && (
        <div className="alert mb-6">Connect your wallet to deposit, borrow, repay, swap or liquidate.</div>
      )}
      {isConnected && chainId !== LENDING_CHAIN_ID && (
        <div className="alert alert-warning mb-6">Switch your wallet to Sepolia to use the lending dashboard.</div>
      )}
      <PriceActions />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6 items-start">
        <div className="grid gap-6">
          <CollateralOperations />
          <BorrowOperations />
          <TokenActions />
        </div>
        <UserPositionsTable />
      </div>
      <p className="text-sm opacity-70 mt-6">
        This educational pool uses a DEX quote as its oracle. Trades and the demo price controls change collateral
        values and can make positions liquidatable.
      </p>
    </main>
  );
}
