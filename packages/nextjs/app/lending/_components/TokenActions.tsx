import { useState } from "react";
import { AddressInput } from "@scaffold-ui/components";
import { IntegerInput } from "@scaffold-ui/debug-contracts";
import { isAddress } from "viem";
import { useAccount, useBalance } from "wagmi";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { LENDING_CHAIN_ID, formatLendingAmount, parsePositiveAmount, swapQuote } from "~~/utils/lending";

export default function TokenActions() {
  const [sellToken, setSellToken] = useState<"ETH" | "CORN">("ETH");
  const [swapInput, setSwapInput] = useState("");
  const [transferInput, setTransferInput] = useState("");
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);
  const { address, chainId, isConnected } = useAccount();
  const { data: dex } = useDeployedContractInfo({ contractName: "CornDEX", chainId: LENDING_CHAIN_ID });
  const { data: cornBalance, error: cornBalanceError } = useScaffoldReadContract({
    contractName: "Corn",
    functionName: "balanceOf",
    args: [address],
    chainId: LENDING_CHAIN_ID,
  });
  const { data: cornReserve, error: cornReserveError } = useScaffoldReadContract({
    contractName: "Corn",
    functionName: "balanceOf",
    args: [dex?.address],
    chainId: LENDING_CHAIN_ID,
  });
  const { data: allowance, error: allowanceError } = useScaffoldReadContract({
    contractName: "Corn",
    functionName: "allowance",
    args: [address, dex?.address],
    chainId: LENDING_CHAIN_ID,
  });
  const { data: ethReserve, error: ethReserveError } = useBalance({
    address: dex?.address,
    chainId: LENDING_CHAIN_ID,
    query: { refetchInterval: 3000 },
  });
  const { data: walletEth, error: walletEthError } = useBalance({
    address,
    chainId: LENDING_CHAIN_ID,
    query: { refetchInterval: 3000 },
  });
  const { writeContractAsync: writeCorn } = useScaffoldWriteContract({
    contractName: "Corn",
    chainId: LENDING_CHAIN_ID,
  });
  const { writeContractAsync: writeDex } = useScaffoldWriteContract({
    contractName: "CornDEX",
    chainId: LENDING_CHAIN_ID,
  });
  const swapAmount = parsePositiveAmount(swapInput);
  const transferAmount = parsePositiveAmount(transferInput);
  const canTransact = isConnected && chainId === LENDING_CHAIN_ID && !busy;
  const poolError = Boolean(cornReserveError || ethReserveError);
  const swapError =
    poolError || (sellToken === "ETH" ? Boolean(walletEthError) : Boolean(cornBalanceError || allowanceError));
  const inputReserve = sellToken === "ETH" ? ethReserve?.value : cornReserve;
  const outputReserve = sellToken === "ETH" ? cornReserve : ethReserve?.value;
  const quote =
    !poolError && swapAmount !== undefined && inputReserve !== undefined && outputReserve !== undefined
      ? swapQuote(swapAmount, inputReserve, outputReserve)
      : undefined;
  const sellBalance = sellToken === "ETH" ? walletEth?.value : cornBalance;
  const canSwap =
    !swapError &&
    swapAmount !== undefined &&
    sellBalance !== undefined &&
    swapAmount <= sellBalance &&
    quote !== undefined &&
    quote > 0n &&
    (sellToken === "ETH" || allowance !== undefined);
  const canTransfer =
    !cornBalanceError &&
    transferAmount !== undefined &&
    cornBalance !== undefined &&
    transferAmount <= cornBalance &&
    isAddress(recipient);

  async function swap() {
    if (!canTransact || !canSwap || !dex || swapAmount === undefined) return;
    setBusy(true);
    try {
      if (sellToken === "CORN" && (allowance ?? 0n) < swapAmount) {
        const approval = await writeCorn({ functionName: "approve", args: [dex.address, swapAmount] });
        if (!approval) return;
      }
      const hash = await writeDex({
        functionName: "swap",
        args: [swapAmount],
        value: sellToken === "ETH" ? swapAmount : 0n,
      });
      if (hash) setSwapInput("");
    } catch (error) {
      console.error("Could not swap tokens", error);
    } finally {
      setBusy(false);
    }
  }

  async function transfer() {
    if (!canTransact || !canTransfer || transferAmount === undefined || !isAddress(recipient)) return;
    setBusy(true);
    try {
      const hash = await writeCorn({ functionName: "transfer", args: [recipient, transferAmount] });
      if (hash) {
        setTransferInput("");
        setRecipient("");
      }
    } catch (error) {
      console.error("Could not transfer CORN", error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card bg-base-100 shadow-xl">
      <div className="card-body gap-4">
        <h2 className="card-title">CORN wallet and swaps</h2>
        {(swapError || cornBalanceError) && (
          <p className="text-sm text-warning m-0" role="alert">
            Could not refresh Sepolia balances or reserves. Affected actions are paused until the data recovers.
          </p>
        )}
        <p className="m-0">
          Your balance: {address ? formatLendingAmount(cornBalance) : "Connect wallet"} {address && "CORN"}
        </p>
        <div className="flex gap-3 items-center">
          <label htmlFor="lending-sell-token">Sell</label>
          <select
            id="lending-sell-token"
            className="select select-bordered flex-1"
            value={sellToken}
            onChange={event => {
              setSellToken(event.target.value as "ETH" | "CORN");
              setSwapInput("");
            }}
          >
            <option value="ETH">ETH → CORN</option>
            <option value="CORN">CORN → ETH</option>
          </select>
        </div>
        <IntegerInput
          value={swapInput}
          onChange={setSwapInput}
          placeholder={`Amount of ${sellToken}`}
          disableMultiplyBy1e18
        />
        <p className="text-sm m-0">
          Pool quote:{" "}
          {quote === undefined
            ? poolError
              ? "Unavailable"
              : swapAmount === undefined
                ? "Enter an amount"
                : "Loading reserves…"
            : `${formatLendingAmount(quote)} ${sellToken === "ETH" ? "CORN" : "ETH"}`}
        </p>
        <button className="btn btn-primary" disabled={!canTransact || !canSwap} onClick={swap}>
          {busy
            ? "Confirming…"
            : sellToken === "CORN" && swapAmount !== undefined && allowance !== undefined && allowance < swapAmount
              ? "Approve CORN and swap"
              : "Swap"}
        </button>
        <p className="text-sm opacity-70 m-0">
          The demo pool has limited ETH liquidity. Quotes use its current reserves; swaps also change the lending
          oracle.
        </p>
        <div className="divider my-0">Transfer CORN</div>
        <AddressInput value={recipient} onChange={setRecipient} placeholder="Recipient address" />
        <IntegerInput
          value={transferInput}
          onChange={setTransferInput}
          placeholder="CORN amount"
          disableMultiplyBy1e18
        />
        <button className="btn btn-outline" disabled={!canTransact || !canTransfer} onClick={transfer}>
          Send CORN
        </button>
      </div>
    </section>
  );
}
