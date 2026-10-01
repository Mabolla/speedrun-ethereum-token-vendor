import { useMemo } from "react";
import CollateralGraph from "./CollateralGraph";
import UserPosition from "./UserPosition";
import { isAddress } from "viem";
import { useAccount } from "wagmi";
import { useScaffoldEventHistory, useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { LENDING_CHAIN_ID } from "~~/utils/lending";

export default function UserPositionsTable() {
  const { address } = useAccount();
  const {
    data: events,
    isLoading,
    isFetchingNewEvent,
    error,
    refetch,
  } = useScaffoldEventHistory({
    contractName: "Lending",
    eventName: "CollateralAdded",
    chainId: LENDING_CHAIN_ID,
    watch: true,
  });
  const { data: price } = useScaffoldReadContract({
    contractName: "CornDEX",
    functionName: "currentPrice",
    chainId: LENDING_CHAIN_ID,
  });
  const { data: collateral } = useScaffoldReadContract({
    contractName: "Lending",
    functionName: "s_userCollateral",
    args: [address],
    chainId: LENDING_CHAIN_ID,
  });
  const { data: debt } = useScaffoldReadContract({
    contractName: "Lending",
    functionName: "s_userBorrowed",
    args: [address],
    chainId: LENDING_CHAIN_ID,
  });
  const users = useMemo(
    () => [
      ...new Set((events ?? []).map(event => event.args.user).filter(user => user !== undefined && isAddress(user))),
    ],
    [events],
  );

  return (
    <section className="card bg-base-100 shadow-xl min-w-0">
      <div className="card-body">
        <h2 className="card-title">Your position</h2>
        <CollateralGraph collateral={collateral} debt={debt} price={price} connected={Boolean(address)} />
        <div className="divider" />
        <div className="flex justify-between items-center gap-3">
          <h2 className="card-title">Depositor positions</h2>
          <button className="btn btn-xs btn-ghost" disabled={isLoading || isFetchingNewEvent} onClick={() => refetch()}>
            Refresh
          </button>
        </div>
        <p className="text-sm m-0">
          Liquidation repays the full debt in CORN and receives ETH collateral, including a 10% reward capped by the
          available collateral.
        </p>
        <div className="overflow-x-auto">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Account</th>
                <th>ETH</th>
                <th>Debt (CORN)</th>
                <th>Ratio</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {error ? (
                <tr>
                  <td colSpan={5}>Could not load depositor history. Refresh to retry.</td>
                </tr>
              ) : isLoading ? (
                <tr>
                  <td colSpan={5}>Loading depositor history…</td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    No deposits yet. New positions appear after their collateral transaction confirms.
                  </td>
                </tr>
              ) : (
                users.map(user => <UserPosition key={user} user={user} price={price} />)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
