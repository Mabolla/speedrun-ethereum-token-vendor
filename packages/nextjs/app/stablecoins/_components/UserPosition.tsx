import { useState } from "react";
import { Address as AddressBlock } from "@scaffold-ui/components";
import type { Address } from "viem";
import { useAccount } from "wagmi";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { STABLECOIN_CHAIN_ID, formatStableAmount } from "~~/utils/stablecoins";

export default function UserPosition({ user }: { user: Address }) {
  const [busy, setBusy] = useState(false);
  const { address, isConnected, chainId } = useAccount();
  const { data: engine } = useDeployedContractInfo({ contractName: "MyUSDEngine", chainId: STABLECOIN_CHAIN_ID });
  const { data: collateral, error: collateralError } = useScaffoldReadContract({
    contractName: "MyUSDEngine",
    functionName: "s_userCollateral",
    args: [user],
    chainId: STABLECOIN_CHAIN_ID,
  });
  const { data: debt, error: debtError } = useScaffoldReadContract({
    contractName: "MyUSDEngine",
    functionName: "getCurrentDebtValue",
    args: [user],
    chainId: STABLECOIN_CHAIN_ID,
  });
  const { data: shares, error: sharesError } = useScaffoldReadContract({
    contractName: "MyUSDEngine",
    functionName: "s_userDebtShares",
    args: [user],
    chainId: STABLECOIN_CHAIN_ID,
  });
  const { data: ratio, error: ratioError } = useScaffoldReadContract({
    contractName: "MyUSDEngine",
    functionName: "calculatePositionRatio",
    args: [user],
    chainId: STABLECOIN_CHAIN_ID,
  });
  const { data: liquidatable, error: liquidatableError } = useScaffoldReadContract({
    contractName: "MyUSDEngine",
    functionName: "isLiquidatable",
    args: [user],
    chainId: STABLECOIN_CHAIN_ID,
  });
  const { data: allowance, error: allowanceError } = useScaffoldReadContract({
    contractName: "MyUSD",
    functionName: "allowance",
    args: [address, engine?.address],
    chainId: STABLECOIN_CHAIN_ID,
  });
  const { data: balance, error: balanceError } = useScaffoldReadContract({
    contractName: "MyUSD",
    functionName: "balanceOf",
    args: [address],
    chainId: STABLECOIN_CHAIN_ID,
  });
  const { writeContractAsync: writeToken } = useScaffoldWriteContract({
    contractName: "MyUSD",
    chainId: STABLECOIN_CHAIN_ID,
  });
  const { writeContractAsync: writeEngine } = useScaffoldWriteContract({
    contractName: "MyUSDEngine",
    chainId: STABLECOIN_CHAIN_ID,
  });
  const readError = Boolean(
    collateralError || debtError || sharesError || ratioError || liquidatableError || allowanceError || balanceError,
  );
  // Debt can accrue while the approval transaction is being confirmed.
  const approvalCap = debt !== undefined ? debt + debt / 1000n + 1n : undefined;
  const canLiquidate =
    isConnected &&
    chainId === STABLECOIN_CHAIN_ID &&
    Boolean(engine) &&
    !busy &&
    !readError &&
    liquidatable === true &&
    debt !== undefined &&
    debt > 0n &&
    balance !== undefined &&
    balance >= debt &&
    allowance !== undefined;

  async function liquidate() {
    if (!canLiquidate || !engine || debt === undefined || allowance === undefined || approvalCap === undefined) return;
    setBusy(true);
    try {
      if (allowance < approvalCap) {
        const approval = await writeToken({ functionName: "approve", args: [engine.address, approvalCap] });
        if (!approval) return;
      }
      await writeEngine({ functionName: "liquidate", args: [user] });
    } catch (error) {
      console.error("Could not liquidate MyUSD position", error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr className={address?.toLowerCase() === user.toLowerCase() ? "bg-base-200" : ""}>
      <td>
        <AddressBlock address={user} format="short" size="sm" />
      </td>
      <td>{collateralError ? "Unavailable" : formatStableAmount(collateral)}</td>
      <td>{debtError ? "Unavailable" : formatStableAmount(debt)}</td>
      <td>{sharesError ? "Unavailable" : formatStableAmount(shares)}</td>
      <td className={liquidatable ? "text-error" : "text-success"}>
        {ratioError || debtError
          ? "Unavailable"
          : debt === 0n
            ? "No debt"
            : ratio === undefined
              ? "Loading…"
              : `${ratio}%`}
      </td>
      <td>
        <button className="btn btn-xs btn-outline" disabled={!canLiquidate} onClick={liquidate}>
          {busy
            ? "Confirming…"
            : approvalCap !== undefined && allowance !== undefined && allowance < approvalCap
              ? "Approve and liquidate"
              : "Liquidate"}
        </button>
        {liquidatable && isConnected && approvalCap !== undefined && (
          <p className="text-xs m-0 mt-1">
            Approval cap: {formatStableAmount(approvalCap)} MyUSD (0.1% plus 1 wei buffer).
          </p>
        )}
        {readError && <p className="text-xs text-warning m-0">Data unavailable</p>}
        {liquidatable && isConnected && balance !== undefined && debt !== undefined && balance < debt && (
          <p className="text-xs m-0">Need {formatStableAmount(debt)} MyUSD</p>
        )}
      </td>
    </tr>
  );
}
