import { useState } from "react";
import { IntegerInput } from "@scaffold-ui/debug-contracts";
import { useAccount } from "wagmi";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import {
  STABLECOIN_CHAIN_ID,
  formatStableAmount,
  isStablePositionSafe,
  parsePositiveAmount,
} from "~~/utils/stablecoins";

export default function CollateralOperations() {
  const [depositInput, setDepositInput] = useState("");
  const [withdrawInput, setWithdrawInput] = useState("");
  const { address, chainId, isConnected } = useAccount();
  const { data: lending } = useDeployedContractInfo({ contractName: "MyUSDEngine", chainId: STABLECOIN_CHAIN_ID });
  const { data: collateral, error: collateralError } = useScaffoldReadContract({
    contractName: "MyUSDEngine",
    functionName: "s_userCollateral",
    args: [address],
    chainId: STABLECOIN_CHAIN_ID,
  });
  const { data: debt, error: debtError } = useScaffoldReadContract({
    contractName: "MyUSDEngine",
    functionName: "getCurrentDebtValue",
    args: [address],
    chainId: STABLECOIN_CHAIN_ID,
  });
  const { data: price, error: priceError } = useScaffoldReadContract({
    contractName: "Oracle",
    functionName: "getETHMyUSDPrice",
    chainId: STABLECOIN_CHAIN_ID,
  });
  const { writeContractAsync, isMining } = useScaffoldWriteContract({
    contractName: "MyUSDEngine",
    chainId: STABLECOIN_CHAIN_ID,
  });
  const deposit = parsePositiveAmount(depositInput);
  const withdraw = parsePositiveAmount(withdrawInput);
  const readError = Boolean(collateralError || debtError || priceError);
  const canTransact = isConnected && chainId === STABLECOIN_CHAIN_ID && !isMining && Boolean(lending);
  const canWithdraw =
    !readError &&
    withdraw !== undefined &&
    collateral !== undefined &&
    debt !== undefined &&
    price !== undefined &&
    withdraw <= collateral &&
    isStablePositionSafe(collateral - withdraw, debt, price);

  async function addCollateral() {
    if (!canTransact || deposit === undefined) return;
    try {
      const hash = await writeContractAsync({ functionName: "addCollateral", value: deposit });
      if (hash) setDepositInput("");
    } catch (error) {
      console.error("Could not add collateral", error);
    }
  }

  async function withdrawCollateral() {
    if (!canTransact || !canWithdraw || withdraw === undefined) return;
    try {
      const hash = await writeContractAsync({ functionName: "withdrawCollateral", args: [withdraw] });
      if (hash) setWithdrawInput("");
    } catch (error) {
      console.error("Could not withdraw collateral", error);
    }
  }

  return (
    <section className="card bg-base-100 shadow-xl">
      <div className="card-body gap-4">
        <h2 className="card-title">ETH collateral</h2>
        {readError && (
          <p className="text-sm text-warning m-0" role="alert">
            Could not refresh Sepolia position data. Withdrawal is paused until the data recovers.
          </p>
        )}
        <p className="m-0">
          Your deposit: {address ? formatStableAmount(collateral) : "Connect wallet"} {address && "ETH"}
        </p>
        <label className="flex flex-col gap-2">
          <span>Add collateral (ETH)</span>
          <IntegerInput value={depositInput} onChange={setDepositInput} placeholder="0.001" disableMultiplyBy1e18 />
        </label>
        <button className="btn btn-primary" disabled={!canTransact || deposit === undefined} onClick={addCollateral}>
          {isMining ? "Confirming…" : "Deposit ETH"}
        </button>
        <label className="flex flex-col gap-2">
          <span>Withdraw collateral (ETH)</span>
          <IntegerInput value={withdrawInput} onChange={setWithdrawInput} placeholder="Amount" disableMultiplyBy1e18 />
        </label>
        <button className="btn btn-outline" disabled={!canTransact || !canWithdraw} onClick={withdrawCollateral}>
          Withdraw ETH
        </button>
        {withdraw && !canWithdraw && collateral !== undefined && (
          <p className="text-sm text-warning m-0">
            Withdrawal must fit your balance and keep the collateral ratio at least 150%.
          </p>
        )}
      </div>
    </section>
  );
}
