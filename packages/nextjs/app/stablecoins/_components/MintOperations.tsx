import { useState } from "react";
import { IntegerInput } from "@scaffold-ui/debug-contracts";
import { useAccount } from "wagmi";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import {
  STABLECOIN_CHAIN_ID,
  STABLECOIN_COLLATERAL_RATIO,
  formatStableAmount,
  isStablePositionSafe,
  parsePositiveAmount,
  stablePositionRatio,
} from "~~/utils/stablecoins";

export default function MintOperations() {
  const [mintInput, setMintInput] = useState("");
  const [repayInput, setRepayInput] = useState("");
  const [busy, setBusy] = useState(false);
  const { address, chainId, isConnected } = useAccount();
  const { data: engine } = useDeployedContractInfo({ contractName: "MyUSDEngine", chainId: STABLECOIN_CHAIN_ID });
  const { data: collateral, error: collateralError } = useScaffoldReadContract({
    contractName: "MyUSDEngine",
    functionName: "s_userCollateral",
    args: [address],
    chainId: STABLECOIN_CHAIN_ID,
  });
  const { data: collateralValue, error: collateralValueError } = useScaffoldReadContract({
    contractName: "MyUSDEngine",
    functionName: "calculateCollateralValue",
    args: [address],
    chainId: STABLECOIN_CHAIN_ID,
  });
  const { data: debt, error: debtError } = useScaffoldReadContract({
    contractName: "MyUSDEngine",
    functionName: "getCurrentDebtValue",
    args: [address],
    chainId: STABLECOIN_CHAIN_ID,
  });
  const { data: shares, error: sharesError } = useScaffoldReadContract({
    contractName: "MyUSDEngine",
    functionName: "s_userDebtShares",
    args: [address],
    chainId: STABLECOIN_CHAIN_ID,
  });
  const { data: price, error: priceError } = useScaffoldReadContract({
    contractName: "Oracle",
    functionName: "getETHMyUSDPrice",
    chainId: STABLECOIN_CHAIN_ID,
  });
  const { data: balance, error: balanceError } = useScaffoldReadContract({
    contractName: "MyUSD",
    functionName: "balanceOf",
    args: [address],
    chainId: STABLECOIN_CHAIN_ID,
  });
  const { data: allowance, error: allowanceError } = useScaffoldReadContract({
    contractName: "MyUSD",
    functionName: "allowance",
    args: [address, engine?.address],
    chainId: STABLECOIN_CHAIN_ID,
  });
  const { writeContractAsync: writeEngine } = useScaffoldWriteContract({
    contractName: "MyUSDEngine",
    chainId: STABLECOIN_CHAIN_ID,
  });
  const { writeContractAsync: writeToken } = useScaffoldWriteContract({
    contractName: "MyUSD",
    chainId: STABLECOIN_CHAIN_ID,
  });
  const mint = parsePositiveAmount(mintInput);
  const repay = parsePositiveAmount(repayInput);
  const mintError = Boolean(collateralError || collateralValueError || debtError || sharesError || priceError);
  const repayError = Boolean(debtError || balanceError || allowanceError);
  const canTransact = isConnected && chainId === STABLECOIN_CHAIN_ID && !busy && Boolean(engine);
  const maxDebt = collateralValue !== undefined ? (collateralValue * 100n) / STABLECOIN_COLLATERAL_RATIO : undefined;
  const available = maxDebt !== undefined && debt !== undefined ? (maxDebt > debt ? maxDebt - debt : 0n) : undefined;
  const canMint =
    !mintError &&
    mint !== undefined &&
    available !== undefined &&
    mint <= available &&
    collateral !== undefined &&
    debt !== undefined &&
    price !== undefined &&
    isStablePositionSafe(collateral, debt + mint, price);
  const canRepay =
    !repayError &&
    repay !== undefined &&
    debt !== undefined &&
    debt > 0n &&
    balance !== undefined &&
    repay <= balance &&
    allowance !== undefined;
  const preview =
    !mintError && mint !== undefined && collateral !== undefined && debt !== undefined && price !== undefined
      ? stablePositionRatio(collateral, debt + mint, price)
      : undefined;

  async function mintTokens() {
    if (!canTransact || !canMint || mint === undefined) return;
    setBusy(true);
    try {
      const hash = await writeEngine({ functionName: "mintMyUSD", args: [mint] });
      if (hash) setMintInput("");
    } catch (error) {
      console.error("Could not mint MyUSD", error);
    } finally {
      setBusy(false);
    }
  }

  async function repayDebt() {
    if (!canTransact || !canRepay || !engine || repay === undefined || allowance === undefined) return;
    setBusy(true);
    try {
      if (allowance < repay) {
        const approval = await writeToken({ functionName: "approve", args: [engine.address, repay] });
        if (!approval) return;
      }
      const hash = await writeEngine({ functionName: "repayUpTo", args: [repay] });
      if (hash) setRepayInput("");
    } catch (error) {
      console.error("Could not repay MyUSD", error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card bg-base-100 shadow-xl">
      <div className="card-body gap-4">
        <h2 className="card-title">Mint and repay MyUSD</h2>
        {(mintError || repayError) && (
          <p className="text-sm text-warning m-0" role="alert">
            Could not refresh Sepolia debt data. Affected actions are paused until it recovers.
          </p>
        )}
        <p className="m-0">
          Current debt including interest: {address ? formatStableAmount(debt) : "Connect wallet"} {address && "MyUSD"}
        </p>
        <p className="text-sm m-0">
          Debt shares: {address ? formatStableAmount(shares) : "Connect wallet"}; available to mint:{" "}
          {address ? formatStableAmount(available) : "Connect wallet"}.
        </p>
        <label className="flex flex-col gap-2">
          <span>Mint amount (MyUSD)</span>
          <IntegerInput value={mintInput} onChange={setMintInput} placeholder="Amount" disableMultiplyBy1e18 />
        </label>
        {preview !== undefined && (
          <p
            className={`text-sm m-0 ${preview !== null && preview < STABLECOIN_COLLATERAL_RATIO ? "text-error" : "text-success"}`}
          >
            Estimated ratio after minting: {preview === null ? "No debt" : `${preview}%`}
          </p>
        )}
        <button className="btn btn-primary" disabled={!canTransact || !canMint} onClick={mintTokens}>
          {busy ? "Confirming…" : "Mint MyUSD"}
        </button>
        <label className="flex flex-col gap-2">
          <span>Repay up to (MyUSD)</span>
          <IntegerInput value={repayInput} onChange={setRepayInput} placeholder="Amount" disableMultiplyBy1e18 />
        </label>
        <button className="btn btn-outline" disabled={!canTransact || !canRepay} onClick={repayDebt}>
          {repay !== undefined && allowance !== undefined && allowance < repay
            ? "Approve MyUSD and repay"
            : "Repay debt"}
        </button>
        <p className="text-xs opacity-70 m-0">
          Repayment burns only the debt owed, up to your entered cap. To close a position, enter slightly more than its
          displayed debt with enough wallet balance to cover accrued interest.
        </p>
      </div>
    </section>
  );
}
