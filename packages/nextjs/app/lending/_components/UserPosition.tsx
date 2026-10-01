import { useState } from "react";
import { Address as AddressBlock } from "@scaffold-ui/components";
import type { Address } from "viem";
import { useAccount } from "wagmi";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { LENDING_CHAIN_ID, formatLendingAmount, positionRatio } from "~~/utils/lending";

type Props = { user: Address; price: bigint | undefined };

export default function UserPosition({ user, price }: Props) {
  const [busy, setBusy] = useState(false);
  const { address, chainId, isConnected } = useAccount();
  const { data: lending } = useDeployedContractInfo({ contractName: "Lending", chainId: LENDING_CHAIN_ID });
  const { data: collateral, error: collateralError } = useScaffoldReadContract({
    contractName: "Lending",
    functionName: "s_userCollateral",
    args: [user],
    chainId: LENDING_CHAIN_ID,
  });
  const { data: debt, error: debtError } = useScaffoldReadContract({
    contractName: "Lending",
    functionName: "s_userBorrowed",
    args: [user],
    chainId: LENDING_CHAIN_ID,
  });
  const { data: liquidatable, error: liquidatableError } = useScaffoldReadContract({
    contractName: "Lending",
    functionName: "isLiquidatable",
    args: [user],
    chainId: LENDING_CHAIN_ID,
  });
  const { data: allowance, error: allowanceError } = useScaffoldReadContract({
    contractName: "Corn",
    functionName: "allowance",
    args: [address, lending?.address],
    chainId: LENDING_CHAIN_ID,
  });
  const { data: balance, error: balanceError } = useScaffoldReadContract({
    contractName: "Corn",
    functionName: "balanceOf",
    args: [address],
    chainId: LENDING_CHAIN_ID,
  });
  const { writeContractAsync: writeCorn } = useScaffoldWriteContract({
    contractName: "Corn",
    chainId: LENDING_CHAIN_ID,
  });
  const { writeContractAsync: writeLending } = useScaffoldWriteContract({
    contractName: "Lending",
    chainId: LENDING_CHAIN_ID,
  });
  const positionError = Boolean(collateralError || debtError || liquidatableError);
  const actionError = positionError || Boolean(allowanceError || balanceError);
  const ratio =
    !positionError && collateral !== undefined && debt !== undefined && price !== undefined
      ? positionRatio(collateral, debt, price)
      : undefined;
  const canLiquidate =
    isConnected &&
    chainId === LENDING_CHAIN_ID &&
    !busy &&
    !actionError &&
    liquidatable === true &&
    debt !== undefined &&
    debt > 0n &&
    balance !== undefined &&
    balance >= debt &&
    allowance !== undefined;

  async function liquidate() {
    if (!canLiquidate || !lending || debt === undefined || allowance === undefined) return;
    setBusy(true);
    try {
      if (allowance < debt) {
        const approval = await writeCorn({ functionName: "approve", args: [lending.address, debt] });
        if (!approval) return;
      }
      await writeLending({ functionName: "liquidate", args: [user] });
    } catch (error) {
      console.error("Could not liquidate position", error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className={address?.toLowerCase() === user.toLowerCase() ? "bg-base-200" : ""}>
      <td>
        <AddressBlock address={user} format="short" size="sm" />
      </td>
      <td>{collateralError ? "Unavailable" : formatLendingAmount(collateral)}</td>
      <td>{debtError ? "Unavailable" : formatLendingAmount(debt)}</td>
      <td className={liquidatable ? "text-error" : "text-success"}>
        {positionError
          ? "Unavailable"
          : ratio === undefined
            ? "Loading…"
            : ratio === null
              ? "No debt"
              : `${ratio.toFixed(2)}%`}
      </td>
      <td>
        <button className="btn btn-xs btn-outline" disabled={!canLiquidate} onClick={liquidate}>
          {busy ? "Confirming…" : "Liquidate"}
        </button>
        {actionError && <p className="text-xs text-warning m-0 mt-1">Data unavailable</p>}
        {liquidatable && isConnected && balance !== undefined && debt !== undefined && balance < debt && (
          <p className="text-xs m-0 mt-1">Need {formatLendingAmount(debt)} CORN</p>
        )}
      </td>
    </tr>
  );
}
