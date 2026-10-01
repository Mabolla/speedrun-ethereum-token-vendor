import { useState } from "react";
import { AddressInput } from "@scaffold-ui/components";
import { IntegerInput } from "@scaffold-ui/debug-contracts";
import { isAddress } from "viem";
import { useAccount, useBalance } from "wagmi";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";
import { STABLECOIN_CHAIN_ID, formatStableAmount, parsePositiveAmount, stableSwapQuote } from "~~/utils/stablecoins";

export default function TokenActions() {
  const [sellToken, setSellToken] = useState<"ETH" | "MyUSD">("ETH");
  const [swapInput, setSwapInput] = useState("");
  const [transferInput, setTransferInput] = useState("");
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);
  const { address, chainId, isConnected } = useAccount();
  const { data: dex } = useDeployedContractInfo({ contractName: "StableDEX", chainId: STABLECOIN_CHAIN_ID });
  const { data: liquidity, error: liquidityError } = useScaffoldReadContract({
    contractName: "StableDEX",
    functionName: "totalLiquidity",
    chainId: STABLECOIN_CHAIN_ID,
  });
  const { data: myUsdBalance, error: myUsdBalanceError } = useScaffoldReadContract({
    contractName: "MyUSD",
    functionName: "balanceOf",
    args: [address],
    chainId: STABLECOIN_CHAIN_ID,
  });
  const { data: myUsdReserve, error: myUsdReserveError } = useScaffoldReadContract({
    contractName: "MyUSD",
    functionName: "balanceOf",
    args: [dex?.address],
    chainId: STABLECOIN_CHAIN_ID,
  });
  const { data: allowance, error: allowanceError } = useScaffoldReadContract({
    contractName: "MyUSD",
    functionName: "allowance",
    args: [address, dex?.address],
    chainId: STABLECOIN_CHAIN_ID,
  });
  const { data: ethReserve, error: ethReserveError } = useBalance({
    address: dex?.address,
    chainId: STABLECOIN_CHAIN_ID,
    query: { refetchInterval: 3000 },
  });
  const { data: walletEth, error: walletEthError } = useBalance({
    address,
    chainId: STABLECOIN_CHAIN_ID,
    query: { refetchInterval: 3000 },
  });
  const { writeContractAsync: writeToken } = useScaffoldWriteContract({
    contractName: "MyUSD",
    chainId: STABLECOIN_CHAIN_ID,
  });
  const { writeContractAsync: writeDex } = useScaffoldWriteContract({
    contractName: "StableDEX",
    chainId: STABLECOIN_CHAIN_ID,
  });
  const swapAmount = parsePositiveAmount(swapInput);
  const transferAmount = parsePositiveAmount(transferInput);
  const canTransact = isConnected && chainId === STABLECOIN_CHAIN_ID && !busy;
  const poolError = Boolean(myUsdReserveError || ethReserveError || liquidityError);
  const poolActive =
    liquidity !== undefined &&
    liquidity > 0n &&
    myUsdReserve !== undefined &&
    myUsdReserve > 0n &&
    ethReserve !== undefined &&
    ethReserve.value > 0n;
  const swapError =
    poolError || (sellToken === "ETH" ? Boolean(walletEthError) : Boolean(myUsdBalanceError || allowanceError));
  const inputReserve = sellToken === "ETH" ? ethReserve?.value : myUsdReserve;
  const outputReserve = sellToken === "ETH" ? myUsdReserve : ethReserve?.value;
  const quote =
    !poolError && swapAmount !== undefined && inputReserve !== undefined && outputReserve !== undefined
      ? stableSwapQuote(swapAmount, inputReserve, outputReserve)
      : undefined;
  const sellBalance = sellToken === "ETH" ? walletEth?.value : myUsdBalance;
  const canSwap =
    !swapError &&
    poolActive &&
    swapAmount !== undefined &&
    sellBalance !== undefined &&
    swapAmount <= sellBalance &&
    quote !== undefined &&
    quote > 0n &&
    (sellToken === "ETH" || allowance !== undefined);
  const canTransfer =
    !myUsdBalanceError &&
    transferAmount !== undefined &&
    myUsdBalance !== undefined &&
    transferAmount <= myUsdBalance &&
    isAddress(recipient);

  async function swap() {
    if (!canTransact || !canSwap || !dex || swapAmount === undefined) return;
    setBusy(true);
    try {
      if (sellToken === "MyUSD" && (allowance ?? 0n) < swapAmount) {
        const approval = await writeToken({ functionName: "approve", args: [dex.address, swapAmount] });
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
      const hash = await writeToken({ functionName: "transfer", args: [recipient, transferAmount] });
      if (hash) {
        setTransferInput("");
        setRecipient("");
      }
    } catch (error) {
      console.error("Could not transfer MyUSD", error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card bg-base-100 shadow-xl">
      <div className="card-body gap-4">
        <h2 className="card-title">MyUSD wallet and swaps</h2>
        {(swapError || myUsdBalanceError) && (
          <p className="text-sm text-warning m-0" role="alert">
            Could not refresh Sepolia balances or reserves. Affected actions are paused until the data recovers.
          </p>
        )}
        <p className="m-0">
          Your balance: {address ? formatStableAmount(myUsdBalance) : "Connect wallet"} {address && "MyUSD"}
        </p>
        {liquidity === 0n && (
          <p className="text-sm m-0">
            Pool liquidity is not initialized. Swaps are unavailable; positions use the fixed reference price.
          </p>
        )}
        <div className="flex gap-3 items-center">
          <label htmlFor="stablecoin-sell-token">Sell</label>
          <select
            id="stablecoin-sell-token"
            className="select select-bordered flex-1"
            value={sellToken}
            onChange={event => {
              setSellToken(event.target.value as "ETH" | "MyUSD");
              setSwapInput("");
            }}
          >
            <option value="ETH">ETH → MyUSD</option>
            <option value="MyUSD">MyUSD → ETH</option>
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
            : `${formatStableAmount(quote)} ${sellToken === "ETH" ? "MyUSD" : "ETH"}`}
        </p>
        <button className="btn btn-primary" disabled={!canTransact || !canSwap} onClick={swap}>
          {busy
            ? "Confirming…"
            : sellToken === "MyUSD" && swapAmount !== undefined && allowance !== undefined && allowance < swapAmount
              ? "Approve MyUSD and swap"
              : "Swap"}
        </button>
        <p className="text-sm opacity-70 m-0">
          Swap quotes use the current pool reserves with no fee. Trades change the stablecoin collateral oracle.
        </p>
        <div className="divider my-0">Transfer MyUSD</div>
        <AddressInput value={recipient} onChange={setRecipient} placeholder="Recipient address" />
        <IntegerInput
          value={transferInput}
          onChange={setTransferInput}
          placeholder="MyUSD amount"
          disableMultiplyBy1e18
        />
        <button className="btn btn-outline" disabled={!canTransact || !canTransfer} onClick={transfer}>
          Send MyUSD
        </button>
      </div>
    </section>
  );
}
