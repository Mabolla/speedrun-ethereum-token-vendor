"use client";

import { useState } from "react";
import { AssertionWithIdAndState } from "../types";
import { Address } from "@scaffold-ui/components";
import { formatEther } from "viem";
import { useAccount } from "wagmi";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useChallengeState } from "~~/services/store/oracleStore";
import { ZERO_ADDRESS } from "~~/utils/scaffold-eth/common";

const stateNames = ["Invalid", "Asserted", "Proposed", "Disputed", "Settled", "Expired"];
const formatTimestamp = (timestamp: bigint) => new Date(Number(timestamp) * 1000).toUTCString();

const Description = ({ assertion }: { assertion: AssertionWithIdAndState }) => (
  <div className="bg-base-200 p-4 space-y-2 mb-4">
    <div>
      <span className="font-bold">Assertion:</span> #{assertion.assertionId}
    </div>
    <div>
      <span className="font-bold">Description:</span> {assertion.description}
    </div>
    <div>
      <span className="font-bold">Bond:</span> {formatEther(assertion.bond)} ETH
    </div>
    <div>
      <span className="font-bold">Reward:</span> {formatEther(assertion.reward)} ETH
    </div>
    <div>
      <span className="font-bold">Start:</span> {formatTimestamp(assertion.startTime)}
    </div>
    <div>
      <span className="font-bold">Deadline:</span> {formatTimestamp(assertion.endTime)}
    </div>
    {assertion.proposer !== ZERO_ADDRESS && (
      <>
        <div>
          <span className="font-bold">Proposed outcome:</span> {assertion.proposedOutcome ? "True" : "False"}
        </div>
        <div>
          <span className="font-bold">Proposer:</span> <Address address={assertion.proposer} format="short" size="sm" />
        </div>
      </>
    )}
    {assertion.disputer !== ZERO_ADDRESS && (
      <div>
        <span className="font-bold">Disputer:</span> <Address address={assertion.disputer} format="short" size="sm" />
      </div>
    )}
  </div>
);

type OracleAction = "propose" | "dispute" | "settle";

export const AssertionModal = () => {
  const [isActionPending, setIsActionPending] = useState(false);
  const { isConnected } = useAccount();
  const { refetchAssertionStates, openAssertion, closeAssertionModal, timestamp } = useChallengeState();
  const assertionId = openAssertion ? BigInt(openAssertion.assertionId) : undefined;
  const { data: assertionData } = useScaffoldReadContract({
    contractName: "OptimisticOracle",
    functionName: "getAssertion",
    args: [assertionId],
    query: { refetchInterval: 12_000 },
  });
  const { data: currentState } = useScaffoldReadContract({
    contractName: "OptimisticOracle",
    functionName: "getState",
    args: [assertionId],
    query: { refetchInterval: 12_000 },
  });
  const { writeContractAsync: writeOracle } = useScaffoldWriteContract({ contractName: "OptimisticOracle" });
  const { writeContractAsync: writeDecider } = useScaffoldWriteContract({ contractName: "Decider" });

  if (!openAssertion || assertionId === undefined) return null;
  const assertion = {
    ...openAssertion,
    ...(assertionData ?? {}),
    state: Number(currentState ?? openAssertion.state),
  };
  const disabled = isActionPending || !isConnected;
  const canPropose = timestamp !== null && timestamp >= assertion.startTime && timestamp <= assertion.endTime;

  const handleAction = async (action: OracleAction, outcome = false) => {
    if (!isConnected || isActionPending) return;
    try {
      setIsActionPending(true);
      let transaction: `0x${string}` | undefined;
      if (action === "settle") {
        transaction = await writeDecider({ functionName: "settleDispute", args: [assertionId, outcome] });
      } else if (action === "propose") {
        transaction = await writeOracle({
          functionName: "proposeOutcome",
          args: [assertionId, outcome],
          value: assertion.bond,
        });
      } else {
        transaction = await writeOracle({ functionName: "disputeOutcome", args: [assertionId], value: assertion.bond });
      }
      if (!transaction) return;
      refetchAssertionStates();
      closeAssertionModal();
    } catch (error) {
      console.error("Assertion transaction failed", error);
    } finally {
      setIsActionPending(false);
    }
  };

  return (
    <div
      className="modal modal-open"
      role="dialog"
      aria-modal="true"
      aria-labelledby="assertion-state-title"
      onClick={() => !isActionPending && closeAssertionModal()}
    >
      <div className="modal-box relative max-w-2xl bg-base-100" onClick={event => event.stopPropagation()}>
        <button
          aria-label="Close assertion"
          onClick={closeAssertionModal}
          disabled={isActionPending}
          className="btn btn-ghost btn-sm btn-square absolute right-3 top-3"
        >
          ✕
        </button>
        <h2 id="assertion-state-title" className="text-xl font-bold mb-6">
          {stateNames[assertion.state] ?? "Invalid"} assertion
        </h2>
        <Description assertion={assertion} />
        {!isConnected && <p className="text-center">Connect your wallet to act on this assertion.</p>}
        {isActionPending && (
          <div className="text-center mb-4">
            <span className="loading loading-spinner" />
          </div>
        )}
        {assertion.state === 1 && (
          <div className="space-y-4">
            <p className="text-center">Propose the outcome by depositing {formatEther(assertion.bond)} ETH.</p>
            {!canPropose && <p className="text-center">Proposals open at the assertion start time.</p>}
            <div className="flex gap-4">
              <button
                className="btn btn-primary flex-1"
                onClick={() => void handleAction("propose", true)}
                disabled={disabled || !canPropose}
              >
                True
              </button>
              <button
                className="btn btn-primary flex-1"
                onClick={() => void handleAction("propose", false)}
                disabled={disabled || !canPropose}
              >
                False
              </button>
            </div>
          </div>
        )}
        {assertion.state === 2 && (
          <div className="space-y-4">
            <p className="text-center">Dispute the proposed outcome by depositing {formatEther(assertion.bond)} ETH.</p>
            <button className="btn btn-primary w-full" onClick={() => void handleAction("dispute")} disabled={disabled}>
              Dispute: {assertion.proposedOutcome ? "False" : "True"}
            </button>
          </div>
        )}
        {assertion.state === 3 && (
          <div className="space-y-4">
            <p className="text-center">Resolve this dispute through the demo Decider.</p>
            <div className="flex gap-4">
              <button
                className="btn btn-primary flex-1"
                onClick={() => void handleAction("settle", true)}
                disabled={disabled}
              >
                Resolve True
              </button>
              <button
                className="btn btn-primary flex-1"
                onClick={() => void handleAction("settle", false)}
                disabled={disabled}
              >
                Resolve False
              </button>
            </div>
          </div>
        )}
        {assertion.state >= 4 && (
          <p className="text-center">Use the corresponding table to claim the payout or refund.</p>
        )}
      </div>
    </div>
  );
};
