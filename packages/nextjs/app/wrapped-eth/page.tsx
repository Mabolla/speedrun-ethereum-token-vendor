"use client";

import { useState } from "react";
import { Address, AddressInput } from "@scaffold-ui/components";
import { formatEther, isAddress, parseEther } from "viem";
import { useAccount, useBalance } from "wagmi";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";

const CHAIN_ID = 11155111;

function parseAmount(value: string, allowZero = false) {
  if (!/^\d+(\.\d{0,18})?$/.test(value.trim())) return undefined;
  try {
    const amount = parseEther(value.trim());
    return amount > 0n || (allowZero && amount === 0n) ? amount : undefined;
  } catch {
    return undefined;
  }
}

function displayAmount(value: bigint | undefined, error: boolean) {
  if (error) return "Unavailable";
  return value === undefined ? "Loading…" : formatEther(value);
}

export default function WrappedETHPage() {
  const [depositInput, setDepositInput] = useState("");
  const [withdrawInput, setWithdrawInput] = useState("");
  const [transferInput, setTransferInput] = useState("");
  const [recipient, setRecipient] = useState("");
  const [approvalInput, setApprovalInput] = useState("");
  const [spender, setSpender] = useState("");
  const [busy, setBusy] = useState(false);
  const { address, chainId, isConnected } = useAccount();
  const { data: weth, isLoading } = useDeployedContractInfo({ contractName: "WrappedETH", chainId: CHAIN_ID });
  const {
    data: tokenBalance,
    error: tokenError,
    refetch: refreshTokens,
  } = useScaffoldReadContract({
    contractName: "WrappedETH",
    functionName: "balanceOf",
    args: [address],
    chainId: CHAIN_ID,
  });
  const {
    data: supply,
    error: supplyError,
    refetch: refreshSupply,
  } = useScaffoldReadContract({
    contractName: "WrappedETH",
    functionName: "totalSupply",
    chainId: CHAIN_ID,
  });
  const {
    data: allowance,
    error: allowanceError,
    refetch: refreshAllowance,
  } = useScaffoldReadContract({
    contractName: "WrappedETH",
    functionName: "allowance",
    args: [address, isAddress(spender) ? spender : undefined],
    chainId: CHAIN_ID,
  });
  const {
    data: walletEth,
    error: ethError,
    refetch: refreshEth,
  } = useBalance({
    address,
    chainId: CHAIN_ID,
    query: { refetchInterval: 3000 },
  });
  const {
    data: reserve,
    error: reserveError,
    refetch: refreshReserve,
  } = useBalance({
    address: weth?.address,
    chainId: CHAIN_ID,
    query: { refetchInterval: 3000 },
  });
  const { writeContractAsync } = useScaffoldWriteContract({ contractName: "WrappedETH", chainId: CHAIN_ID });

  const depositAmount = parseAmount(depositInput);
  const withdrawAmount = parseAmount(withdrawInput);
  const transferAmount = parseAmount(transferInput);
  const approvalAmount = parseAmount(approvalInput, true);
  const canTransact = isConnected && chainId === CHAIN_ID && Boolean(weth) && !busy;
  const canDeposit =
    !ethError && depositAmount !== undefined && walletEth !== undefined && depositAmount < walletEth.value;
  const canWithdraw =
    !tokenError && withdrawAmount !== undefined && tokenBalance !== undefined && withdrawAmount <= tokenBalance;
  const canTransfer =
    !tokenError &&
    transferAmount !== undefined &&
    tokenBalance !== undefined &&
    transferAmount <= tokenBalance &&
    isAddress(recipient);

  async function transact(action: "deposit" | "withdraw" | "transfer" | "approve") {
    if (!canTransact) return;
    setBusy(true);
    try {
      let hash;
      if (action === "deposit" && canDeposit && depositAmount !== undefined) {
        hash = await writeContractAsync({ functionName: "deposit", value: depositAmount });
        if (hash) setDepositInput("");
      } else if (action === "withdraw" && canWithdraw && withdrawAmount !== undefined) {
        hash = await writeContractAsync({ functionName: "withdraw", args: [withdrawAmount] });
        if (hash) setWithdrawInput("");
      } else if (action === "transfer" && canTransfer && transferAmount !== undefined && isAddress(recipient)) {
        hash = await writeContractAsync({ functionName: "transfer", args: [recipient, transferAmount] });
        if (hash) {
          setTransferInput("");
          setRecipient("");
        }
      } else if (action === "approve" && approvalAmount !== undefined && isAddress(spender)) {
        hash = await writeContractAsync({ functionName: "approve", args: [spender, approvalAmount] });
        if (hash) setApprovalInput("");
      }
      if (hash) {
        await Promise.all([refreshTokens(), refreshSupply(), refreshEth(), refreshReserve()]);
        if (isAddress(spender)) await refreshAllowance();
      }
    } catch (error) {
      console.error(`Could not ${action} WETH`, error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="w-full max-w-6xl mx-auto px-4 py-10 space-y-6">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-4xl font-bold my-0">Wrapped ETH</h1>
          <span className="badge badge-secondary">ETH Tech Tree · Sepolia</span>
        </div>
        <p>Wrap ETH into WETH, transfer it as an ERC-20 token, and redeem it at a one-to-one rate.</p>
        {weth && <Address address={weth.address} />}
      </div>

      {!isConnected && <div className="alert alert-info">Connect your wallet to wrap, unwrap, or transfer WETH.</div>}
      {isConnected && chainId !== CHAIN_ID && (
        <div className="alert alert-warning">Switch your wallet to Sepolia to use this app.</div>
      )}
      {!weth && !isLoading && <div className="alert alert-warning">The Sepolia deployment is unavailable.</div>}
      {(ethError || tokenError || supplyError || reserveError) && (
        <div className="alert alert-warning">
          Could not refresh balances. Affected actions will resume when the data recovers.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="stat bg-base-100 rounded-2xl shadow">
          <div className="stat-title">Your Sepolia ETH</div>
          <div className="font-semibold break-all">
            {address ? displayAmount(walletEth?.value, Boolean(ethError)) : "Connect wallet"}
          </div>
        </div>
        <div className="stat bg-base-100 rounded-2xl shadow">
          <div className="stat-title">Your WETH</div>
          <div className="font-semibold break-all">
            {address ? displayAmount(tokenBalance, Boolean(tokenError)) : "Connect wallet"}
          </div>
        </div>
        <div className="stat bg-base-100 rounded-2xl shadow">
          <div className="stat-title">Total WETH</div>
          <div className="font-semibold break-all">{displayAmount(supply, Boolean(supplyError))}</div>
        </div>
        <div className="stat bg-base-100 rounded-2xl shadow">
          <div className="stat-title">ETH backing</div>
          <div className="font-semibold break-all">{displayAmount(reserve?.value, Boolean(reserveError))}</div>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <section className="card bg-base-100 shadow-xl">
          <div className="card-body gap-4">
            <h2 className="card-title">Wrap ETH</h2>
            <label className="flex flex-col gap-2">
              <span>ETH amount</span>
              <input
                className="input input-bordered w-full"
                inputMode="decimal"
                value={depositInput}
                onChange={event => setDepositInput(event.target.value)}
                placeholder="0.001"
              />
            </label>
            <p className="text-sm m-0">
              {depositAmount === undefined ? "1 ETH = 1 WETH" : `You receive ${formatEther(depositAmount)} WETH`}
            </p>
            <button
              className="btn btn-primary"
              disabled={!canTransact || !canDeposit}
              onClick={() => transact("deposit")}
            >
              {busy ? "Confirming…" : "Wrap ETH"}
            </button>
            <p className="text-sm opacity-70 m-0">Leave a little ETH in your wallet for transaction fees.</p>
          </div>
        </section>

        <section className="card bg-base-100 shadow-xl">
          <div className="card-body gap-4">
            <h2 className="card-title">Unwrap WETH</h2>
            <label className="flex flex-col gap-2">
              <span>WETH amount</span>
              <input
                className="input input-bordered w-full"
                inputMode="decimal"
                value={withdrawInput}
                onChange={event => setWithdrawInput(event.target.value)}
                placeholder="0.001"
              />
            </label>
            <p className="text-sm m-0">
              {withdrawAmount === undefined ? "1 WETH = 1 ETH" : `You receive ${formatEther(withdrawAmount)} ETH`}
            </p>
            <button
              className="btn btn-primary"
              disabled={!canTransact || !canWithdraw}
              onClick={() => transact("withdraw")}
            >
              {busy ? "Confirming…" : "Unwrap WETH"}
            </button>
          </div>
        </section>

        <section className="card bg-base-100 shadow-xl">
          <div className="card-body gap-4">
            <h2 className="card-title">Transfer WETH</h2>
            <span>Recipient</span>
            <AddressInput value={recipient} onChange={setRecipient} placeholder="Recipient address" />
            <label className="flex flex-col gap-2">
              <span>WETH amount</span>
              <input
                className="input input-bordered w-full"
                inputMode="decimal"
                value={transferInput}
                onChange={event => setTransferInput(event.target.value)}
                placeholder="0.001"
              />
            </label>
            <button
              className="btn btn-outline"
              disabled={!canTransact || !canTransfer}
              onClick={() => transact("transfer")}
            >
              Send WETH
            </button>
          </div>
        </section>

        <section className="card bg-base-100 shadow-xl">
          <div className="card-body gap-4">
            <h2 className="card-title">Spending allowance</h2>
            <p className="text-sm m-0">
              Set how much WETH an address may transfer from your wallet. Enter zero to revoke it.
            </p>
            <span>Spender</span>
            <AddressInput value={spender} onChange={setSpender} placeholder="Spender address" />
            {address && isAddress(spender) && (
              <p className="text-sm m-0">Current allowance: {displayAmount(allowance, Boolean(allowanceError))} WETH</p>
            )}
            <label className="flex flex-col gap-2">
              <span>WETH allowance</span>
              <input
                className="input input-bordered w-full"
                inputMode="decimal"
                value={approvalInput}
                onChange={event => setApprovalInput(event.target.value)}
                placeholder="0"
              />
            </label>
            <button
              className="btn btn-outline"
              disabled={!canTransact || approvalAmount === undefined || !isAddress(spender)}
              onClick={() => transact("approve")}
            >
              Set allowance
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
