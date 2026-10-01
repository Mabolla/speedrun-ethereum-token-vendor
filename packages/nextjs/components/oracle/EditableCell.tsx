import { useEffect, useRef, useState } from "react";
import { HighlightedCell } from "./HighlightedCell";
import { parseEther } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { ArrowPathIcon, PencilIcon } from "@heroicons/react/24/outline";
import { useSelectedNetwork } from "~~/hooks/scaffold-eth";
import { SIMPLE_ORACLE_ABI } from "~~/utils/oracles/constants";
import { notification } from "~~/utils/scaffold-eth";

type EditableCellProps = {
  value: string | number;
  address: string;
  highlightColor?: string;
};

export const EditableCell = ({ value, address, highlightColor = "" }: EditableCellProps) => {
  const { address: connectedAddress, chainId } = useAccount();
  const network = useSelectedNetwork();
  const publicClient = usePublicClient({ chainId: network.id });
  const { writeContractAsync } = useWriteContract();
  const [isEditing, setIsEditing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editValue, setEditValue] = useState(String(Number(value) || ""));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isEditing) setEditValue(String(Number(value) || ""));
  }, [value, isEditing]);
  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing]);

  const submitPrice = async (priceText: string) => {
    if (!connectedAddress || !publicClient) return;
    if (chainId !== network.id) {
      notification.error(`Switch your wallet to ${network.name}`);
      return;
    }
    if (!Number.isFinite(Number(priceText)) || Number(priceText) <= 0) {
      notification.error("Enter a positive price");
      return;
    }
    setIsSubmitting(true);
    try {
      const hash = await writeContractAsync({
        chainId: network.id,
        abi: SIMPLE_ORACLE_ABI,
        address: address as `0x${string}`,
        functionName: "setPrice",
        args: [parseEther(priceText)],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      setIsEditing(false);
      notification.success("Price report confirmed");
    } catch (error) {
      console.error(error);
      notification.error("Price report failed or was rejected");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <HighlightedCell value={value} highlightColor={highlightColor} className="min-w-56">
      <div className="flex items-center gap-2">
        {isEditing ? (
          <>
            <input
              ref={inputRef}
              aria-label="USD price"
              value={editValue}
              onChange={event => setEditValue(event.target.value)}
              type="number"
              min="0"
              step="0.01"
              className="input input-bordered input-sm w-28"
            />
            <button
              className="btn btn-primary btn-xs"
              onClick={() => void submitPrice(editValue)}
              disabled={isSubmitting}
            >
              Save
            </button>
            <button className="btn btn-ghost btn-xs" onClick={() => setIsEditing(false)} disabled={isSubmitting}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <span>{value}</span>
            <button
              className="btn btn-primary btn-xs"
              onClick={() => setIsEditing(true)}
              disabled={!connectedAddress || isSubmitting}
              title="Edit price"
            >
              <PencilIcon className="w-3 h-3" />
            </button>
            <button
              className="btn btn-secondary btn-xs"
              onClick={() => void submitPrice(String(value))}
              disabled={!connectedAddress || isSubmitting || !Number(value)}
              title="Resubmit price"
            >
              <ArrowPathIcon className={`w-3 h-3 ${isSubmitting ? "animate-spin" : ""}`} />
            </button>
          </>
        )}
      </div>
    </HighlightedCell>
  );
};
