import { useState } from "react";
import { IntegerInput } from "@scaffold-ui/debug-contracts";
import { useAccount } from "wagmi";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import {
  LENDING_CHAIN_ID,
  MIN_COLLATERAL_RATIO,
  WEI_PER_UNIT,
  formatLendingAmount,
  isPositionSafe,
  parsePositiveAmount,
  positionRatio,
} from "~~/utils/lending";

export default function BorrowOperations() {
  const [borrowInput, setBorrowInput] = useState("");
  const [repayInput, setRepayInput] = useState("");
  const [busy, setBusy] = useState(false);
  const { address, chainId, isConnected } = useAccount();
  const { data: lending } = useDeployedContractInfo({ contractName: "Lending", chainId: LENDING_CHAIN_ID });
  const { data: collateral, error: collateralError } = useScaffoldReadContract({
    contractName: "Lending",
    functionName: "s_userCollateral",
    args: [address],
    chainId: LENDING_CHAIN_ID,
  });
  const { data: debt, error: debtError } = useScaffoldReadContract({
    contractName: "Lending",
    functionName: "s_userBorrowed",
    args: [address],
    chainId: LENDING_CHAIN_ID,
  });
  const { data: price, error: priceError } = useScaffoldReadContract({
    contractName: "CornDEX",
    functionName: "currentPrice",
    chainId: LENDING_CHAIN_ID,
  });
  const { data: balance, error: balanceError } = useScaffoldReadContract({
    contractName: "Corn",
    functionName: "balanceOf",
    args: [address],
    chainId: LENDING_CHAIN_ID,
  });
  const { data: inventory, error: inventoryError } = useScaffoldReadContract({
    contractName: "Corn",
    functionName: "balanceOf",
    args: [lending?.address],
    chainId: LENDING_CHAIN_ID,
  });
  const { data: allowance, error: allowanceError } = useScaffoldReadContract({
    contractName: "Corn",
    functionName: "allowance",
    args: [address, lending?.address],
    chainId: LENDING_CHAIN_ID,
  });
  const { writeContractAsync: writeLending } = useScaffoldWriteContract({
    contractName: "Lending",
    chainId: LENDING_CHAIN_ID,
  });
  const { writeContractAsync: writeCorn } = useScaffoldWriteContract({
    contractName: "Corn",
    chainId: LENDING_CHAIN_ID,
  });
  const borrow = parsePositiveAmount(borrowInput);
  const repay = parsePositiveAmount(repayInput);
  const borrowError = Boolean(collateralError || debtError || priceError || inventoryError);
  const repayError = Boolean(debtError || balanceError || allowanceError);
  const canTransact = isConnected && chainId === LENDING_CHAIN_ID && !busy && Boolean(lending);
  const ready = !borrowError && collateral !== undefined && debt !== undefined && price !== undefined;
  const debtLimit = ready ? (((collateral * price) / WEI_PER_UNIT) * 100n) / MIN_COLLATERAL_RATIO : undefined;
  const available =
    debtLimit !== undefined && debt !== undefined ? (debtLimit > debt ? debtLimit - debt : 0n) : undefined;
  const maxBorrow =
    available !== undefined && inventory !== undefined ? (available < inventory ? available : inventory) : undefined;
  const canBorrow =
    ready &&
    borrow !== undefined &&
    maxBorrow !== undefined &&
    borrow <= maxBorrow &&
    isPositionSafe(collateral, debt + borrow, price);
  const canRepay =
    !repayError &&
    repay !== undefined &&
    debt !== undefined &&
    balance !== undefined &&
    repay <= debt &&
    repay <= balance;
  const previewRatio = ready && borrow !== undefined ? positionRatio(collateral, debt + borrow, price) : undefined;

  async function borrowCorn() {
    if (!canTransact || !canBorrow || borrow === undefined) return;
    setBusy(true);
    try {
      const hash = await writeLending({ functionName: "borrowCorn", args: [borrow] });
      if (hash) setBorrowInput("");
    } catch (error) {
      console.error("Could not borrow CORN", error);
    } finally {
      setBusy(false);
    }
  }

  async function repayCorn() {
    if (!canTransact || !canRepay || !lending || repay === undefined || allowance === undefined) return;
    setBusy(true);
    try {
      if (allowance < repay) {
        const approval = await writeCorn({ functionName: "approve", args: [lending.address, repay] });
        if (!approval) return;
      }
      const hash = await writeLending({ functionName: "repayCorn", args: [repay] });
      if (hash) setRepayInput("");
    } catch (error) {
      console.error("Could not repay CORN", error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card bg-base-100 shadow-xl">
      <div className="card-body gap-4">
        <h2 className="card-title">Borrow and repay CORN</h2>
        {(borrowError || repayError) && (
          <p className="text-sm text-warning m-0" role="alert">
            Could not refresh Sepolia lending data. Affected actions are paused until the data recovers.
          </p>
        )}
        <p className="m-0">
          Your debt: {address ? formatLendingAmount(debt) : "Connect wallet"} {address && "CORN"}
        </p>
        <p className="text-sm m-0">
          Available to borrow: {address ? formatLendingAmount(maxBorrow) : "Connect wallet"} {address && "CORN"}
        </p>
        <label className="flex flex-col gap-2">
          <span>Borrow CORN</span>
          <IntegerInput value={borrowInput} onChange={setBorrowInput} placeholder="Amount" disableMultiplyBy1e18 />
        </label>
        {previewRatio !== undefined && (
          <p className={`m-0 text-sm ${previewRatio !== null && previewRatio < 120 ? "text-error" : "text-success"}`}>
            Ratio after borrowing: {previewRatio === null ? "No debt" : `${previewRatio.toFixed(2)}%`}
          </p>
        )}
        <button className="btn btn-primary" disabled={!canTransact || !canBorrow} onClick={borrowCorn}>
          {busy ? "Confirming…" : "Borrow CORN"}
        </button>
        <label className="flex flex-col gap-2">
          <span>Repay CORN</span>
          <IntegerInput value={repayInput} onChange={setRepayInput} placeholder="Amount" disableMultiplyBy1e18 />
        </label>
        <button
          className="btn btn-outline"
          disabled={!canTransact || !canRepay || allowance === undefined}
          onClick={repayCorn}
        >
          {repay !== undefined && allowance !== undefined && allowance < repay
            ? "Approve CORN and repay"
            : "Repay CORN"}
        </button>
        {repay && !canRepay && debt !== undefined && (
          <p className="text-sm text-warning m-0">
            Repayment must fit both your outstanding debt and your CORN balance.
          </p>
        )}
      </div>
    </section>
  );
}
