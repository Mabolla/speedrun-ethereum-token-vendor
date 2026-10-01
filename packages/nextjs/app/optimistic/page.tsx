"use client";

import { useCallback, useEffect } from "react";
import type { NextPage } from "next";
import { useReadContracts } from "wagmi";
import { OracleShell } from "~~/components/oracle/OracleShell";
import { AssertedTable } from "~~/components/oracle/optimistic/AssertedTable";
import { AssertionModal } from "~~/components/oracle/optimistic/AssertionModal";
import { DisputedTable } from "~~/components/oracle/optimistic/DisputedTable";
import { ExpiredTable } from "~~/components/oracle/optimistic/ExpiredTable";
import { ProposedTable } from "~~/components/oracle/optimistic/ProposedTable";
import { SettledTable } from "~~/components/oracle/optimistic/SettledTable";
import { SubmitAssertionButton } from "~~/components/oracle/optimistic/SubmitAssertionButton";
import { useDeployedContractInfo, useScaffoldReadContract, useSelectedNetwork } from "~~/hooks/scaffold-eth";
import { useChallengeState } from "~~/services/store/oracleStore";

// Loading spinner component
const LoadingSpinner = () => (
  <div className="flex justify-center items-center min-h-[400px]">
    <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-blue-500"></div>
  </div>
);

const Home: NextPage = () => {
  const setRefetchAssertionStates = useChallengeState(state => state.setRefetchAssertionStates);
  const selectedNetwork = useSelectedNetwork();

  const {
    data: nextAssertionId,
    isLoading: isLoadingNextAssertionId,
    refetch: refetchNextAssertionId,
    error: nextAssertionError,
  } = useScaffoldReadContract({
    contractName: "OptimisticOracle",
    functionName: "nextAssertionId",
    query: {
      refetchInterval: 12_000,
    },
  });

  // get deployed contract address
  const { data: deployedContractAddress, isLoading: isLoadingDeployedContract } = useDeployedContractInfo({
    contractName: "OptimisticOracle",
  });

  // Create contracts array to get state for all assertions from 1 to nextAssertionId-1
  const assertionContracts =
    nextAssertionId && deployedContractAddress
      ? Array.from({ length: Number(nextAssertionId) - 1 }, (_, i) => ({
          address: deployedContractAddress.address,
          abi: deployedContractAddress.abi,
          chainId: selectedNetwork.id,
          functionName: "getState" as const,
          args: [BigInt(i + 1)],
        }))
      : [];

  const {
    data: assertionStates,
    refetch: refetchAssertionStates,
    isLoading: isLoadingAssertionStates,
    error: assertionStatesError,
  } = useReadContracts({
    contracts: assertionContracts,
    query: {
      enabled: assertionContracts.length > 0,
      refetchInterval: 12_000,
    },
  });

  const refreshAssertions = useCallback(async () => {
    await refetchNextAssertionId();
    await refetchAssertionStates();
  }, [refetchNextAssertionId, refetchAssertionStates]);

  useEffect(() => {
    setRefetchAssertionStates(refreshAssertions);
    return () => setRefetchAssertionStates(() => {});
  }, [refreshAssertions, setRefetchAssertionStates]);

  // Map assertion IDs to their states and filter out expired ones (state 5)
  const assertionStateMap =
    nextAssertionId && assertionStates
      ? Array.from({ length: Number(nextAssertionId) - 1 }, (_, i) => ({
          assertionId: i + 1,
          state: Number(assertionStates[i]?.result ?? 0),
        }))
      : [];

  const isFirstLoading = isLoadingNextAssertionId || isLoadingAssertionStates || isLoadingDeployedContract;
  const hasReadError = nextAssertionError || assertionStatesError;

  return (
    <OracleShell title="Optimistic Oracle">
      <div className="container mx-auto max-w-screen-xl">
        <p className="mb-4">
          Create a binary assertion, propose an outcome with a bond, or dispute a proposal. This testnet demo lets any
          participant use the Decider to resolve a dispute.
        </p>
        {hasReadError && (
          <div className="alert alert-error mb-4">
            Unable to load assertions.{" "}
            <button className="btn btn-sm" onClick={() => void refreshAssertions()}>
              Retry
            </button>
          </div>
        )}
        {/* Show loading spinner only during initial load */}
        {isFirstLoading ? (
          <LoadingSpinner />
        ) : (
          <>
            {/* Submit Assertion Button with Modal */}
            <SubmitAssertionButton />

            {/* Tables */}
            <h2 className="text-2xl font-bold my-4">Asserted</h2>
            <AssertedTable assertions={assertionStateMap.filter(assertion => assertion.state === 1)} />
            <h2 className="text-2xl font-bold mt-12 mb-4">Proposed</h2>
            <ProposedTable assertions={assertionStateMap.filter(assertion => assertion.state === 2)} />
            <h2 className="text-2xl font-bold mt-12 mb-4">Disputed</h2>
            <DisputedTable assertions={assertionStateMap.filter(assertion => assertion.state === 3)} />
            <h2 className="text-2xl font-bold mt-12 mb-4">Settled</h2>
            <SettledTable assertions={assertionStateMap.filter(assertion => assertion.state === 4)} />
            <h2 className="text-2xl font-bold mt-12 mb-4">Expired</h2>
            <ExpiredTable assertions={assertionStateMap.filter(assertion => assertion.state === 5)} />
          </>
        )}

        <AssertionModal />
      </div>
    </OracleShell>
  );
};

export default Home;
