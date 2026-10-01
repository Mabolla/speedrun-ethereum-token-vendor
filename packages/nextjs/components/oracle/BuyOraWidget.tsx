"use client";

import { useState } from "react";
import { erc20Abi, formatEther, parseEther } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { useScaffoldReadContract, useScaffoldWriteContract, useSelectedNetwork } from "~~/hooks/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth";

export const BuyOraWidget = () => {
  const { address: connectedAddress } = useAccount();
  const network = useSelectedNetwork();
  const [ethAmount, setEthAmount] = useState("0.5");
  const [isBuying, setIsBuying] = useState(false);
  const { writeContractAsync: writeOra } = useScaffoldWriteContract({ contractName: "ORA" });
  const { data: oracleTokenAddress } = useScaffoldReadContract({
    contractName: "StakingOracle",
    functionName: "oracleToken",
  });
  const { data: oraBalance, refetch: refetchOraBalance } = useReadContract({
    chainId: network.id,
    address: oracleTokenAddress,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: connectedAddress ? [connectedAddress] : undefined,
    query: { enabled: !!oracleTokenAddress && !!connectedAddress, refetchInterval: 5000 },
  });

  const handleBuy = async () => {
    if (!connectedAddress || !Number.isFinite(Number(ethAmount)) || Number(ethAmount) <= 0) {
      notification.error("Connect a wallet and enter a positive ETH amount");
      return;
    }
    setIsBuying(true);
    try {
      await writeOra({ functionName: "buy", value: parseEther(ethAmount) });
      await refetchOraBalance();
    } catch (error) {
      console.error(error);
    } finally {
      setIsBuying(false);
    }
  };

  return (
    <div className="bg-base-100 p-4 border border-base-300 shadow-sm w-full md:w-auto">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="text-sm font-semibold block mb-2" htmlFor="ora-eth">
            Buy ORA with testnet ETH
          </label>
          <input
            id="ora-eth"
            className="input input-bordered input-sm w-32"
            type="number"
            min="0"
            step="0.001"
            value={ethAmount}
            onChange={event => setEthAmount(event.target.value)}
          />
          <span className="text-xs ml-2">ETH → {Number(ethAmount) > 0 ? Number(ethAmount) * 200 : 0} ORA</span>
          <div className="text-xs mt-2">
            Your balance:{" "}
            {oraBalance === undefined
              ? "—"
              : Number(formatEther(oraBalance)).toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
            ORA · Minimum stake: 100 ORA
          </div>
        </div>
        <button
          className="btn btn-primary btn-sm"
          onClick={handleBuy}
          disabled={!connectedAddress || isBuying || Number(ethAmount) <= 0}
        >
          {isBuying ? "Buying…" : "Buy ORA"}
        </button>
      </div>
    </div>
  );
};
