"use client";

import { useEffect, useRef, useState } from "react";
import { createIdentity, loadIdentity, loadIdentityForWallet, saveIdentity, validateIdentity } from "./_proof/identity";
import type { ProofRequest, ProofResponse, VotingIdentity, ZkProof } from "./_proof/types";
import { Address, AddressInput } from "@scaffold-ui/components";
import { isAddress, parseAbiItem } from "viem";
import { useAccount, usePublicClient, useSwitchChain } from "wagmi";
import { useDeployedContractInfo, useScaffoldReadContract, useScaffoldWriteContract } from "~~/hooks/scaffold-eth";

const SEPOLIA = 11155111;
const newLeafEvent = parseAbiItem("event NewLeaf(uint256 index, uint256 value)");
const voteCastEvent = parseAbiItem(
  "event VoteCast(bytes32 indexed nullifierHash, address indexed voter, bool vote, uint256 timestamp, uint256 totalYes, uint256 totalNo)",
);

const readableError = (error: unknown) => {
  const message = error instanceof Error ? error.message : "The transaction could not be completed";
  if (/rejected|denied/i.test(message)) return "The wallet request was rejected.";
  if (/Voting__NotAllowedToVote/.test(message)) return "This wallet is not eligible or has already registered.";
  if (/Voting__NullifierHashAlreadyUsed/.test(message)) return "This registration has already voted.";
  if (/Voting__InvalidRoot/.test(message)) return "The voter tree changed. Generate a new proof and retry.";
  if (/insufficient funds/i.test(message)) return "The voting wallet needs enough Sepolia ETH to pay gas.";
  return "The request failed. Check the network and wallet, then retry.";
};

const ZkVoting = () => {
  const { address, chainId, isConnected } = useAccount();
  const publicClient = usePublicClient({ chainId: SEPOLIA });
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const { data: deployment } = useDeployedContractInfo({ contractName: "Voting", chainId: SEPOLIA });
  const {
    data: votingData,
    refetch: refetchVotingData,
    isError: isReadError,
  } = useScaffoldReadContract({
    contractName: "Voting",
    functionName: "getVotingData",
    chainId: SEPOLIA,
    query: { refetchInterval: 12_000 },
  });
  const { data: connectedVoterData, refetch: refetchConnectedVoter } = useScaffoldReadContract({
    contractName: "Voting",
    functionName: "getVoterData",
    args: [address],
    chainId: SEPOLIA,
  });
  const { writeContractAsync } = useScaffoldWriteContract({ contractName: "Voting", chainId: SEPOLIA });

  const [identity, setIdentity] = useState<VotingIdentity | null>(null);
  const [proof, setProof] = useState<ZkProof | null>(null);
  const [choice, setChoice] = useState<boolean | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"register" | "proof" | "vote" | "voter" | null>(null);
  const [voteHash, setVoteHash] = useState<`0x${string}` | null>(null);
  const [backupInput, setBackupInput] = useState("");
  const [voterAddress, setVoterAddress] = useState("");
  const [allowVoter, setAllowVoter] = useState(true);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const generationSequence = useRef(0);

  const { data: identityVoterData } = useScaffoldReadContract({
    contractName: "Voting",
    functionName: "getVoterData",
    args: [identity?.registrationAddress],
    chainId: SEPOLIA,
  });
  const owner = votingData?.[1];
  const yesVotes = votingData?.[2];
  const noVotes = votingData?.[3];
  const treeSize = votingData?.[4];
  const root = votingData?.[6];
  const totalVotes = (yesVotes ?? 0n) + (noVotes ?? 0n);
  const isOwner = !!address && !!owner && address.toLowerCase() === owner.toLowerCase();
  const wrongNetwork = isConnected && chainId !== SEPOLIA;
  const sameVotingWallet =
    !!address && !!identity && address.toLowerCase() === identity.registrationAddress.toLowerCase();
  const proofStale = !!proof && root !== undefined && BigInt(proof.publicInputs[1]) !== root;
  const walletReady = isConnected && !wrongNetwork && !!deployment && !!publicClient;

  useEffect(() => {
    generationSequence.current += 1;
    workerRef.current?.terminate();
    workerRef.current = null;
    setProof(null);
    setChoice(null);
    setVoteHash(null);
    setPrivacyAccepted(false);
    setStatus("");
    setBusy(null);
    if (!deployment?.address) {
      setIdentity(null);
      return;
    }
    try {
      setIdentity(loadIdentity(deployment.address));
    } catch {
      setIdentity(null);
      setError("Saved registration data could not be read. Restore your registration backup before voting.");
    }
    return () => {
      generationSequence.current += 1;
      workerRef.current?.terminate();
    };
  }, [deployment?.address]);

  useEffect(() => {
    setPrivacyAccepted(false);
  }, [address]);

  const guardWallet = () => {
    if (!isConnected) {
      setError("Connect a wallet first.");
      return false;
    }
    if (chainId !== SEPOLIA) {
      setError("Switch the connected wallet to Ethereum Sepolia.");
      return false;
    }
    if (!deployment || !publicClient || !votingData || isReadError) {
      setError("The Sepolia contract could not be read. Wait for the connection or retry.");
      return false;
    }
    return true;
  };

  const register = async () => {
    if (busy || !guardWallet() || !address || !deployment) return;
    if (connectedVoterData?.[0] !== true || connectedVoterData?.[1] === true) {
      setError("Only an eligible wallet that has not registered can register.");
      return;
    }
    setError("");
    setBusy("register");
    try {
      const registration =
        identity?.registrationAddress.toLowerCase() === address.toLowerCase()
          ? identity
          : createIdentity(deployment.address as `0x${string}`, address as `0x${string}`);
      // Save before requesting the transaction, so a page close never loses the registered secret.
      saveIdentity(registration);
      setIdentity(registration);
      setProof(null);
      setVoteHash(null);
      const hash = await writeContractAsync({ functionName: "register", args: [BigInt(registration.commitment)] });
      if (!hash) return;
      await Promise.all([refetchVotingData(), refetchConnectedVoter()]);
      setStatus("Registration confirmed. Your secret and nullifier stayed in this browser.");
    } catch (problem) {
      setError(readableError(problem));
    } finally {
      setBusy(null);
    }
  };

  const generateProof = async () => {
    if (busy || !identity || !deployment || !publicClient || choice === null) return;
    setError("");
    setProof(null);
    setBusy("proof");
    setStatus("Reading the latest registered voter tree…");
    const generation = ++generationSequence.current;
    try {
      const snapshotBlock = await publicClient.getBlockNumber();
      const snapshot = await publicClient.readContract({
        address: deployment.address,
        abi: deployment.abi,
        functionName: "getVotingData",
        blockNumber: snapshotBlock,
      });
      if (snapshot[4] === 0n) throw new Error("No voters have registered yet.");
      const logs = await publicClient.getLogs({
        address: deployment.address,
        event: newLeafEvent,
        fromBlock: BigInt(deployment.deployedOnBlock ?? 0),
        toBlock: snapshotBlock,
      });
      const orderedLeaves = [...logs].sort((left, right) => Number((left.args.index ?? 0n) - (right.args.index ?? 0n)));
      if (
        BigInt(orderedLeaves.length) !== snapshot[4] ||
        orderedLeaves.some((leaf, index) => leaf.args.index !== BigInt(index) || leaf.args.value === undefined)
      ) {
        throw new Error("The RPC did not return the complete voter tree. Retry after the connection recovers.");
      }
      if (generation !== generationSequence.current) return;
      const worker = new Worker(new URL("./_proof/worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.onmessage = ({ data }: MessageEvent<ProofResponse>) => {
        if (workerRef.current !== worker) return;
        if (data.type === "status") {
          setStatus(data.message);
        } else {
          if (data.type === "result") {
            setProof(data.result);
            setStatus("Proof generated and verified locally. Ready for on-chain verification.");
          } else {
            setError(data.message);
            setStatus("");
          }
          setBusy(null);
          worker.terminate();
          workerRef.current = null;
        }
      };
      worker.onerror = () => {
        if (workerRef.current !== worker) return;
        setError("The proof worker could not run. Retry in a browser with WebAssembly support.");
        setStatus("");
        setBusy(null);
        worker.terminate();
        workerRef.current = null;
      };
      const request: ProofRequest = {
        identity,
        leaves: orderedLeaves.map(leaf => leaf.args.value!.toString()),
        root: snapshot[6].toString(),
        treeDepth: Number(snapshot[5]),
        vote: choice,
        circuitUrl: `${window.location.origin}/circuits.json`,
      };
      worker.postMessage(request);
    } catch (problem) {
      if (generation !== generationSequence.current) return;
      setError(
        problem instanceof Error && /complete voter tree|No voters/.test(problem.message)
          ? problem.message
          : "Could not load the voter tree from Sepolia. Retry after the connection recovers.",
      );
      setStatus("");
      setBusy(null);
    }
  };

  const cancelProof = () => {
    generationSequence.current += 1;
    workerRef.current?.terminate();
    workerRef.current = null;
    setBusy(null);
    setStatus("Proof generation canceled. Your registration is saved.");
  };

  const castVote = async () => {
    if (busy || !guardWallet() || !publicClient || !deployment || !proof || !identity || !privacyAccepted) return;
    setError("");
    setBusy("vote");
    try {
      const snapshot = await publicClient.readContract({
        address: deployment.address,
        abi: deployment.abi,
        functionName: "getVotingData",
      });
      if (snapshot[6] !== BigInt(proof.publicInputs[1])) {
        setError("Another voter registered after this proof was generated. Generate a new proof before voting.");
        return;
      }
      const priorVotes = await publicClient.getLogs({
        address: deployment.address,
        event: voteCastEvent,
        args: { nullifierHash: proof.publicInputs[0] },
        fromBlock: BigInt(deployment.deployedOnBlock ?? 0),
        toBlock: "latest",
      });
      if (priorVotes.length) {
        setVoteHash(priorVotes[0].transactionHash);
        setError("This registration has already voted.");
        return;
      }
      const hash = await writeContractAsync({ functionName: "vote", args: [proof.proof, ...proof.publicInputs] });
      if (!hash) return;
      setVoteHash(hash);
      setStatus("Vote confirmed and verified by the on-chain Honk verifier.");
      await refetchVotingData();
    } catch (problem) {
      setError(readableError(problem));
    } finally {
      setBusy(null);
    }
  };

  const updateVoter = async () => {
    if (busy || !guardWallet() || !isOwner || !isAddress(voterAddress)) return;
    setBusy("voter");
    setError("");
    try {
      const hash = await writeContractAsync({ functionName: "addVoters", args: [[voterAddress], [allowVoter]] });
      if (!hash) return;
      setVoterAddress("");
      setStatus("Voter eligibility updated.");
      await refetchConnectedVoter();
    } catch (problem) {
      setError(readableError(problem));
    } finally {
      setBusy(null);
    }
  };

  const useConnectedRegistration = () => {
    if (!deployment || !address || busy) return;
    try {
      const stored = loadIdentityForWallet(deployment.address, address);
      if (!stored) {
        setError("No registration backup for this wallet is saved here. Restore its private backup.");
        return;
      }
      saveIdentity(stored);
      setIdentity(stored);
      setProof(null);
      setVoteHash(null);
      setPrivacyAccepted(false);
      setError("");
    } catch {
      setError("The saved registration could not be loaded. Restore the private backup.");
    }
  };

  const downloadBackup = () => {
    if (!identity) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(identity, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "zk-voting-private-registration.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  const restoreBackup = () => {
    if (!deployment || busy) return;
    try {
      const restored = validateIdentity(JSON.parse(backupInput), deployment.address);
      saveIdentity(restored);
      setIdentity(restored);
      setProof(null);
      setVoteHash(null);
      setPrivacyAccepted(false);
      setBackupInput("");
      setStatus("Registration backup restored locally.");
      setError("");
    } catch {
      setError("This registration backup is invalid or belongs to a different voting contract.");
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">ZK Voting</h1>
        <span className="badge badge-outline">Ethereum Sepolia</span>
      </div>
      <p className="mt-0">
        Register an eligibility commitment, generate a real zero-knowledge proof in your browser, then submit your vote
        from your chosen wallet.
      </p>
      {wrongNetwork && (
        <div className="alert alert-warning">
          <span>Connect your wallet to Ethereum Sepolia for transactions.</span>
          <button className="btn btn-sm" disabled={isSwitching} onClick={() => switchChain({ chainId: SEPOLIA })}>
            Switch to Sepolia
          </button>
        </div>
      )}
      {isReadError && (
        <div className="alert alert-error">
          Sepolia contract data is unavailable. Check the RPC connection before continuing.
        </div>
      )}
      {error && (
        <div className="alert alert-error" role="alert">
          {error}
        </div>
      )}
      {status && (
        <div className="alert alert-info" role="status">
          {busy && <span className="loading loading-spinner loading-sm" />}
          {status}
        </div>
      )}

      <div className="card bg-base-100 border border-base-300 shadow-sm">
        <div className="card-body text-center">
          <h2 className="card-title justify-center">{votingData?.[0] ?? "Loading voting question…"}</h2>
          <div className="flex justify-center flex-wrap items-center gap-3 text-sm">
            Voting contract: {deployment && <Address address={deployment.address} size="sm" />}
          </div>
          <div className="grid grid-cols-2 gap-4 mt-3">
            <div className="rounded-lg bg-success/10 p-4">
              <div className="text-sm">Yes</div>
              <div className="text-3xl font-bold">{yesVotes?.toString() ?? "—"}</div>
            </div>
            <div className="rounded-lg bg-error/10 p-4">
              <div className="text-sm">No</div>
              <div className="text-3xl font-bold">{noVotes?.toString() ?? "—"}</div>
            </div>
          </div>
          <div className="text-sm opacity-70">
            {treeSize?.toString() ?? "—"} registered commitments · {totalVotes.toString()} votes
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <section className="card bg-base-100 border border-base-300 shadow-sm">
          <div className="card-body gap-4">
            <h2 className="card-title">1. Register eligibility</h2>
            <p className="text-sm m-0">
              Only the commitment is published. Keep the registration backup private: it holds the secret needed to
              generate your proof.
            </p>
            <div className="text-sm">
              Connected wallet: {address ? <Address address={address} size="sm" /> : "Not connected"}
            </div>
            <div className="text-sm">
              Eligibility:{" "}
              {connectedVoterData?.[0] === undefined
                ? "Connect an eligible wallet"
                : connectedVoterData[0]
                  ? "Allowed"
                  : "The owner must add this wallet"}
            </div>
            <button
              className="btn btn-primary"
              disabled={!!busy || !walletReady || connectedVoterData?.[0] !== true || connectedVoterData?.[1] === true}
              onClick={() => void register()}
            >
              {busy === "register"
                ? "Registering…"
                : connectedVoterData?.[1]
                  ? "Wallet already registered"
                  : "Register commitment"}
            </button>
            {identity && (
              <>
                <div className="text-xs opacity-70">Saved registration wallet:</div>
                <Address address={identity.registrationAddress} size="sm" />
                <button className="btn btn-outline btn-sm" onClick={downloadBackup}>
                  Download private registration backup
                </button>
              </>
            )}
            {connectedVoterData?.[1] && !sameVotingWallet && (
              <button className="btn btn-ghost btn-sm" disabled={!!busy} onClick={useConnectedRegistration}>
                Load this wallet&apos;s saved registration
              </button>
            )}
            {connectedVoterData?.[1] && !identity && (
              <p className="text-sm text-warning m-0">
                This wallet is registered. Restore its saved backup to generate a proof.
              </p>
            )}
            <details className="text-sm">
              <summary className="cursor-pointer">Restore registration backup</summary>
              <p>Paste your private backup here. It stays in this browser.</p>
              <textarea
                className="textarea textarea-bordered w-full"
                rows={4}
                aria-label="Private registration backup"
                value={backupInput}
                onChange={event => setBackupInput(event.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                className="btn btn-secondary btn-sm mt-2"
                disabled={!!busy || !backupInput.trim()}
                onClick={restoreBackup}
              >
                Restore locally
              </button>
            </details>
          </div>
        </section>

        <section className="card bg-base-100 border border-base-300 shadow-sm">
          <div className="card-body gap-4">
            <h2 className="card-title">2. Generate your proof</h2>
            <p className="text-sm m-0">
              The Noir circuit proves you know a registered secret without revealing the commitment or registration
              address. Proof generation may take a minute.
            </p>
            <div className="flex gap-3">
              <button
                className={`btn flex-1 ${choice === true ? "btn-success" : "btn-outline"}`}
                disabled={!!busy}
                onClick={() => {
                  setChoice(true);
                  setProof(null);
                  setVoteHash(null);
                }}
              >
                Yes
              </button>
              <button
                className={`btn flex-1 ${choice === false ? "btn-error" : "btn-outline"}`}
                disabled={!!busy}
                onClick={() => {
                  setChoice(false);
                  setProof(null);
                  setVoteHash(null);
                }}
              >
                No
              </button>
            </div>
            <button
              className="btn btn-primary"
              disabled={
                !!busy ||
                !identity ||
                identityVoterData?.[1] !== true ||
                choice === null ||
                !deployment ||
                !publicClient ||
                isReadError
              }
              onClick={() => void generateProof()}
            >
              {busy === "proof" ? "Generating proof…" : proof ? "Generate new proof" : "Generate ZK proof"}
            </button>
            {busy === "proof" && (
              <button className="btn btn-ghost btn-sm" onClick={cancelProof}>
                Cancel generation
              </button>
            )}
            {proof && (
              <div className={`badge ${proofStale ? "badge-warning" : "badge-success"}`}>
                {proofStale ? "Voter tree changed — regenerate proof" : "Real proof verified locally"}
              </div>
            )}
            {!identity && <p className="text-sm opacity-70 m-0">Register or restore your registration backup first.</p>}
          </div>
        </section>
      </div>

      <section className="card bg-base-100 border border-base-300 shadow-sm">
        <div className="card-body gap-4">
          <h2 className="card-title">3. Cast your vote</h2>
          <p className="text-sm m-0">
            The vote choice, nullifier hash, and sending address are public. To avoid directly linking the vote to your
            registration wallet, switch to a separate Sepolia wallet funded independently. The saved registration and
            proof stay here when you switch accounts.
          </p>
          {sameVotingWallet && (
            <div className="alert alert-warning text-sm">
              This is your registration wallet. Sending from it links your public vote to your registration.
            </div>
          )}
          {treeSize !== undefined && treeSize < 2n && (
            <p className="text-sm text-warning m-0">
              There is fewer than two registered voters. The participant set does not provide practical voter anonymity
              yet.
            </p>
          )}
          <label className="flex items-start gap-3 text-sm cursor-pointer">
            <input
              type="checkbox"
              className="checkbox checkbox-sm mt-0.5"
              checked={privacyAccepted}
              onChange={event => setPrivacyAccepted(event.target.checked)}
              disabled={!!busy}
            />
            <span>
              I understand that my sending wallet and vote are public, and that funding links can identify a separate
              wallet.
            </span>
          </label>
          <div className="flex flex-wrap gap-4 items-center">
            <button
              className="btn btn-primary"
              disabled={!!busy || !walletReady || !proof || proofStale || !privacyAccepted || !!voteHash}
              onClick={() => void castVote()}
            >
              {busy === "vote" ? "Submitting vote…" : voteHash ? "Vote submitted" : "Submit verified vote"}
            </button>
            {address && <Address address={address} size="sm" />}
          </div>
          {voteHash && (
            <a
              className="link link-primary break-all text-sm"
              href={`https://sepolia.etherscan.io/tx/${voteHash}`}
              target="_blank"
              rel="noreferrer"
            >
              View confirmed vote transaction
            </a>
          )}
        </div>
      </section>

      {isOwner && (
        <section className="card bg-base-100 border border-base-300 shadow-sm">
          <div className="card-body gap-4">
            <h2 className="card-title">Voter eligibility</h2>
            <p className="text-sm m-0">
              As the contract owner, add a voter or revoke eligibility before they register.
            </p>
            <AddressInput value={voterAddress} onChange={setVoterAddress} placeholder="Voter address" />
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="checkbox checkbox-sm"
                checked={allowVoter}
                onChange={event => setAllowVoter(event.target.checked)}
              />
              Allow this voter
            </label>
            <button
              className="btn btn-secondary"
              disabled={!!busy || !walletReady || !isAddress(voterAddress)}
              onClick={() => void updateVoter()}
            >
              {busy === "voter" ? "Updating…" : allowVoter ? "Add voter" : "Revoke voter"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
};

export default ZkVoting;
