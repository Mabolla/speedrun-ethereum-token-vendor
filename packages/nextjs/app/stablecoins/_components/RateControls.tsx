import { useState } from "react";
import { IntegerInput } from "@scaffold-ui/debug-contracts";
import { useAccount } from "wagmi";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { STABLECOIN_CHAIN_ID, parseRatePercent } from "~~/utils/stablecoins";

export default function RateControls() {
  const [borrowInput, setBorrowInput] = useState("");
  const [savingsInput, setSavingsInput] = useState("");
  const [busy, setBusy] = useState(false);
  const { isConnected, chainId } = useAccount();
  const { data: controller } = useDeployedContractInfo({
    contractName: "RateController",
    chainId: STABLECOIN_CHAIN_ID,
  });
  const { data: borrowRate, error: borrowError } = useScaffoldReadContract({
    contractName: "MyUSDEngine",
    functionName: "borrowRate",
    chainId: STABLECOIN_CHAIN_ID,
  });
  const { data: savingsRate, error: savingsError } = useScaffoldReadContract({
    contractName: "MyUSDStaking",
    functionName: "savingsRate",
    chainId: STABLECOIN_CHAIN_ID,
  });
  const { writeContractAsync } = useScaffoldWriteContract({
    contractName: "RateController",
    chainId: STABLECOIN_CHAIN_ID,
  });
  const borrow = parseRatePercent(borrowInput);
  const savings = parseRatePercent(savingsInput);
  const readError = Boolean(borrowError || savingsError);
  const canTransact = isConnected && chainId === STABLECOIN_CHAIN_ID && !busy && !readError && Boolean(controller);
  const canBorrow = borrow !== undefined && savingsRate !== undefined && borrow >= savingsRate;
  const canSave = savings !== undefined && borrowRate !== undefined && savings <= borrowRate;

  async function setRate(kind: "borrow" | "savings") {
    const rate = kind === "borrow" ? borrow : savings;
    if (!canTransact || rate === undefined || !(kind === "borrow" ? canBorrow : canSave)) return;
    setBusy(true);
    try {
      const hash = await writeContractAsync({
        functionName: kind === "borrow" ? "setBorrowRate" : "setSavingsRate",
        args: [rate],
      });
      if (hash) {
        if (kind === "borrow") setBorrowInput("");
        else setSavingsInput("");
      }
    } catch (error) {
      console.error("Could not update demo rate", error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card bg-base-100 shadow-xl">
      <div className="card-body gap-4">
        <h2 className="card-title">Manual demo rates</h2>
        {readError && (
          <p className="text-sm text-warning m-0" role="alert">
            Rate data unavailable. Controls are paused until it recovers.
          </p>
        )}
        <p className="text-sm m-0">
          Borrow: {borrowRate === undefined ? "Loading…" : `${(Number(borrowRate) / 100).toFixed(2)}%`}; savings:{" "}
          {savingsRate === undefined ? "Loading…" : `${(Number(savingsRate) / 100).toFixed(2)}%`} per year.
        </p>
        <label className="flex flex-col gap-2">
          <span>Borrow rate (%)</span>
          <IntegerInput value={borrowInput} onChange={setBorrowInput} placeholder="5.00" disableMultiplyBy1e18 />
        </label>
        <button className="btn btn-outline" disabled={!canTransact || !canBorrow} onClick={() => setRate("borrow")}>
          {busy ? "Confirming…" : "Set borrow rate"}
        </button>
        <label className="flex flex-col gap-2">
          <span>Savings rate (%)</span>
          <IntegerInput value={savingsInput} onChange={setSavingsInput} placeholder="3.00" disableMultiplyBy1e18 />
        </label>
        <button className="btn btn-outline" disabled={!canTransact || !canSave} onClick={() => setRate("savings")}>
          Set savings rate
        </button>
        <p className="text-xs opacity-70 m-0">
          These public controls affect every demo position. Savings must not exceed borrowing. Rates use basis points:
          1% = 100.
        </p>
      </div>
    </section>
  );
}
