import { useState } from "react";
import { Address } from "@scaffold-ui/components";
import { formatEther } from "viem";
import { useAccount } from "wagmi";
import { useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { useChallengeState } from "~~/services/store/oracleStore";

export const ExpiredRow = ({ assertionId }: { assertionId: number }) => {
  const [isClaiming, setIsClaiming] = useState(false);
  const { isConnected } = useAccount();
  const refetchAssertionStates = useChallengeState(state => state.refetchAssertionStates);

  const { data: assertionData, refetch } = useScaffoldReadContract({
    contractName: "OptimisticOracle",
    functionName: "getAssertion",
    args: [BigInt(assertionId)],
    query: { refetchInterval: 12_000 },
  });

  const { writeContractAsync } = useScaffoldWriteContract({
    contractName: "OptimisticOracle",
  });

  const handleClaim = async () => {
    if (!isConnected || isClaiming) return;
    setIsClaiming(true);
    try {
      const transaction = await writeContractAsync({
        functionName: "claimRefund",
        args: [BigInt(assertionId)],
      });
      if (!transaction) return;
      await refetch();
      refetchAssertionStates();
    } catch (error) {
      console.error(error);
    } finally {
      setIsClaiming(false);
    }
  };

  if (!assertionData) return null;

  return (
    <tr key={assertionId} className={`border-b border-base-300`}>
      {/* Description Column */}
      <td>{assertionData.description}</td>

      {/* Asserter Column */}
      <td>
        <Address address={assertionData.asserter} format="short" onlyEnsOrAddress disableAddressLink size="sm" />
      </td>

      {/* Reward Column */}
      <td>{formatEther(assertionData.reward)} ETH</td>

      {/* Claimed Column */}
      <td>
        {assertionData?.claimed ? (
          <button className="btn btn-primary btn-xs" disabled>
            Claimed
          </button>
        ) : (
          <button
            className="btn btn-primary btn-xs"
            onClick={handleClaim}
            disabled={isClaiming || !isConnected}
            title="Refund is sent to the original asserter"
          >
            {isClaiming ? "Claiming…" : isConnected ? "Claim refund" : "Connect wallet"}
          </button>
        )}
      </td>
    </tr>
  );
};
