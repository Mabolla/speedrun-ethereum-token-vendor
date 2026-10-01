import { useState } from "react";
import { useAccount, useBalance } from "wagmi";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { LENDING_CHAIN_ID, formatLendingAmount } from "~~/utils/lending";

export default function PriceActions() {
  const [busy, setBusy] = useState(false);
  const { isConnected, chainId } = useAccount();
  const { data: dex } = useDeployedContractInfo({ contractName: "CornDEX", chainId: LENDING_CHAIN_ID });
  const { data: helper } = useDeployedContractInfo({ contractName: "MovePrice", chainId: LENDING_CHAIN_ID });
  const { data: price } = useScaffoldReadContract({
    contractName: "CornDEX",
    functionName: "currentPrice",
    chainId: LENDING_CHAIN_ID,
  });
  const { data: cornReserve } = useScaffoldReadContract({
    contractName: "Corn",
    functionName: "balanceOf",
    args: [dex?.address],
    chainId: LENDING_CHAIN_ID,
  });
  const { data: helperCorn } = useScaffoldReadContract({
    contractName: "Corn",
    functionName: "balanceOf",
    args: [helper?.address],
    chainId: LENDING_CHAIN_ID,
  });
  const { data: ethReserve } = useBalance({
    address: dex?.address,
    chainId: LENDING_CHAIN_ID,
    query: { refetchInterval: 3000 },
  });
  const { data: helperEth } = useBalance({
    address: helper?.address,
    chainId: LENDING_CHAIN_ID,
    query: { refetchInterval: 3000 },
  });
  const { writeContractAsync } = useScaffoldWriteContract({ contractName: "MovePrice", chainId: LENDING_CHAIN_ID });
  const ethStep = ethReserve ? ethReserve.value / 20n : undefined;
  const cornStep = cornReserve !== undefined ? cornReserve / 20n : undefined;
  const canTransact = isConnected && chainId === LENDING_CHAIN_ID && !busy;
  const canIncrease = cornStep !== undefined && cornStep > 0n && helperCorn !== undefined && helperCorn >= cornStep;
  const canDecrease = ethStep !== undefined && ethStep > 0n && helperEth !== undefined && helperEth.value >= ethStep;

  async function movePrice(increase: boolean) {
    const amount = increase ? cornStep : ethStep;
    if (!canTransact || amount === undefined || !(increase ? canIncrease : canDecrease)) return;
    setBusy(true);
    try {
      await writeContractAsync({ functionName: "movePrice", args: [increase ? -amount : amount] });
    } catch (error) {
      console.error("Could not adjust demo price", error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card bg-base-100 shadow-xl">
      <div className="card-body">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div>
            <h2 className="card-title mb-2">Lending oracle</h2>
            <div className="text-xl font-semibold">{formatLendingAmount(price)} CORN / ETH</div>
            <p className="text-xs opacity-70 mb-0">
              The contract uses the DEX output quote for a 1 ETH swap, including price impact.
            </p>
          </div>
          <div>
            <h2 className="font-semibold mb-2">Demo pool reserves</h2>
            <p className="m-0">{formatLendingAmount(ethReserve?.value)} ETH</p>
            <p className="m-0">{formatLendingAmount(cornReserve)} CORN</p>
          </div>
          <div>
            <h2 className="font-semibold mb-2">Educational price controls</h2>
            <div className="flex flex-wrap gap-2">
              <button
                className="btn btn-sm btn-outline"
                disabled={!canTransact || !canIncrease}
                onClick={() => movePrice(true)}
              >
                Increase ETH quote
              </button>
              <button
                className="btn btn-sm btn-outline"
                disabled={!canTransact || !canDecrease}
                onClick={() => movePrice(false)}
              >
                Decrease ETH quote
              </button>
            </div>
            <p className="text-xs opacity-70 mb-0">
              Each control swaps 5% of a current pool reserve using the funded helper. Disabled when helper funds run
              out.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
