import { useMemo } from "react";
import UserPosition from "./UserPosition";
import { type Address, isAddress } from "viem";
import { useDeployedContractInfo, useScaffoldEventHistory } from "~~/hooks/scaffold-eth";
import { STABLECOIN_CHAIN_ID } from "~~/utils/stablecoins";

export default function UserPositionsTable() {
  const { data: engine, isLoading: contractLoading } = useDeployedContractInfo({
    contractName: "MyUSDEngine",
    chainId: STABLECOIN_CHAIN_ID,
  });
  const deploymentBlock =
    engine && "deployedOnBlock" in engine && engine.deployedOnBlock !== undefined
      ? BigInt(engine.deployedOnBlock)
      : undefined;
  const {
    data: events,
    status,
    isLoading,
    isFetchingNewEvent,
    error,
    refetch,
  } = useScaffoldEventHistory({
    contractName: "MyUSDEngine",
    eventName: "CollateralAdded",
    chainId: STABLECOIN_CHAIN_ID,
    fromBlock: deploymentBlock,
    watch: true,
    enabled: Boolean(engine) && deploymentBlock !== undefined,
  });
  const users = useMemo(() => {
    const unique = new Map<string, Address>();
    for (const event of events ?? []) {
      const user = event.args.user;
      if (user && isAddress(user)) unique.set(user.toLowerCase(), user);
    }
    return [...unique.values()];
  }, [events]);

  return (
    <section className="card bg-base-100 shadow-xl min-w-0">
      <div className="card-body">
        <div className="flex items-center justify-between gap-3">
          <h2 className="card-title">Collateral positions</h2>
          <button
            className="btn btn-xs btn-ghost"
            disabled={!engine || deploymentBlock === undefined || isLoading || isFetchingNewEvent}
            onClick={() => refetch()}
          >
            Refresh
          </button>
        </div>
        <p className="text-sm m-0">
          Debt includes accrued interest. Below 150% collateralization, a liquidator can repay the debt and receive ETH
          collateral plus a 10% reward.
        </p>
        <div className="overflow-x-auto">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Account</th>
                <th>ETH</th>
                <th>Debt (MyUSD)</th>
                <th>Debt shares</th>
                <th>Ratio</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {contractLoading ? (
                <tr>
                  <td colSpan={6}>Loading Sepolia engine…</td>
                </tr>
              ) : !engine || deploymentBlock === undefined ? (
                <tr>
                  <td colSpan={6}>Engine or deployment block unavailable. Reload to retry.</td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={6}>Could not load deposit history. Refresh to retry.</td>
                </tr>
              ) : status === "pending" || isLoading || isFetchingNewEvent ? (
                <tr>
                  <td colSpan={6}>Loading deposit history…</td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={6}>No collateral deposits yet.</td>
                </tr>
              ) : (
                users.map(user => <UserPosition key={user.toLowerCase()} user={user} />)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
