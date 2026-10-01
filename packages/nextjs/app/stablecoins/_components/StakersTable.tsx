"use client";

import { useMemo } from "react";
import { Address as AddressBlock } from "@scaffold-ui/components";
import { type Address, isAddress } from "viem";
import { useAccount } from "wagmi";
import { useDeployedContractInfo, useScaffoldEventHistory, useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { STABLECOIN_CHAIN_ID, formatStableAmount } from "~~/utils/stablecoins";

function StakerRow({ user, connectedAddress }: { user: Address; connectedAddress?: Address }) {
  const { data: balance, error: balanceError } = useScaffoldReadContract({
    contractName: "MyUSDStaking",
    functionName: "getBalance",
    args: [user],
    chainId: STABLECOIN_CHAIN_ID,
  });
  const { data: shares, error: sharesError } = useScaffoldReadContract({
    contractName: "MyUSDStaking",
    functionName: "userShares",
    args: [user],
    chainId: STABLECOIN_CHAIN_ID,
  });
  const isCurrentUser = connectedAddress?.toLowerCase() === user.toLowerCase();

  return (
    <tr className={isCurrentUser ? "bg-base-200" : ""}>
      <td>
        <div className="flex items-center gap-2">
          <AddressBlock address={user} format="short" size="sm" />
          {isCurrentUser && <span className="badge badge-sm badge-outline">You</span>}
        </div>
      </td>
      <td className={balanceError ? "text-warning" : ""}>
        {balanceError ? "Unavailable" : formatStableAmount(balance)}
      </td>
      <td className={sharesError ? "text-warning" : ""}>{sharesError ? "Unavailable" : formatStableAmount(shares)}</td>
    </tr>
  );
}

export default function StakersTable() {
  const { address } = useAccount();
  const { data: staking, isLoading: contractLoading } = useDeployedContractInfo({
    contractName: "MyUSDStaking",
    chainId: STABLECOIN_CHAIN_ID,
  });
  const deploymentBlock =
    staking && "deployedOnBlock" in staking && staking.deployedOnBlock !== undefined
      ? BigInt(staking.deployedOnBlock)
      : undefined;
  const {
    data: events,
    status,
    isLoading,
    isFetchingNewEvent,
    error,
    refetch,
  } = useScaffoldEventHistory({
    contractName: "MyUSDStaking",
    eventName: "Staked",
    fromBlock: deploymentBlock,
    chainId: STABLECOIN_CHAIN_ID,
    watch: true,
    blockData: false,
    transactionData: false,
    receiptData: false,
    enabled: Boolean(staking) && deploymentBlock !== undefined,
  });
  const users = useMemo(() => {
    const uniqueUsers = new Map<string, Address>();
    for (const event of events ?? []) {
      const user = event?.args?.user;
      if (user && isAddress(user)) uniqueUsers.set(user.toLowerCase(), user);
    }
    return Array.from(uniqueUsers.values());
  }, [events]);

  return (
    <section className="card bg-base-100 shadow-xl min-w-0">
      <div className="card-body">
        <div className="flex items-center justify-between gap-3">
          <h2 className="card-title">MyUSD stakers</h2>
          <button
            className="btn btn-xs btn-ghost"
            disabled={!staking || deploymentBlock === undefined || isLoading || isFetchingNewEvent}
            onClick={() => refetch()}
          >
            Refresh
          </button>
        </div>
        <p className="text-sm m-0">
          Accounts that have staked since deployment. Balances include accrued yield; withdrawn accounts remain listed.
        </p>
        <div className="overflow-x-auto">
          <table className="table table-sm">
            <thead>
              <tr>
                <th>Account</th>
                <th>Balance with yield (MyUSD)</th>
                <th>Shares</th>
              </tr>
            </thead>
            <tbody>
              {contractLoading ? (
                <tr>
                  <td colSpan={3}>Loading Sepolia staking contract…</td>
                </tr>
              ) : !staking ? (
                <tr>
                  <td colSpan={3} className="text-warning">
                    Sepolia MyUSDStaking contract unavailable. Reload to retry.
                  </td>
                </tr>
              ) : deploymentBlock === undefined ? (
                <tr>
                  <td colSpan={3} className="text-warning">
                    Staking deployment block unavailable. Reload to retry.
                  </td>
                </tr>
              ) : error ? (
                <tr>
                  <td colSpan={3} className="text-warning">
                    Could not load staking history. Refresh to retry.
                  </td>
                </tr>
              ) : status === "pending" || isLoading || isFetchingNewEvent ? (
                <tr>
                  <td colSpan={3}>Loading staking history…</td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={3}>No staking transactions yet. Accounts appear after their first stake confirms.</td>
                </tr>
              ) : (
                users.map(user => <StakerRow key={user.toLowerCase()} user={user} connectedAddress={address} />)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
