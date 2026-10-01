import { useState } from "react";
import { useAccount } from "wagmi";
import { PlusIcon } from "@heroicons/react/24/outline";
import { useScaffoldWriteContract } from "~~/hooks/scaffold-eth";

export const AddOracleButton = () => {
  const { address } = useAccount();
  const [isAdding, setIsAdding] = useState(false);
  const { writeContractAsync } = useScaffoldWriteContract({ contractName: "WhitelistOracle" });
  const handleAddOracle = async () => {
    if (!address) return;
    setIsAdding(true);
    try {
      await writeContractAsync({ functionName: "addOracle", args: [address] });
    } catch (error) {
      console.error(error);
    } finally {
      setIsAdding(false);
    }
  };
  return (
    <button
      className="btn btn-primary h-full btn-sm font-normal gap-1"
      onClick={handleAddOracle}
      disabled={!address || isAdding}
    >
      <PlusIcon className="h-4 w-4" />
      <span>{isAdding ? "Adding…" : "Add Oracle Node"}</span>
    </button>
  );
};
