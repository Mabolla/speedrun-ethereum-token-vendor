import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TooltipInfo from "../TooltipInfo";
import { NodeRow } from "./NodeRow";
import { SelfNodeRow } from "./SelfNodeRow";
import { erc20Abi, formatEther, parseEther } from "viem";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import {
  useDeployedContractInfo,
  useScaffoldEventHistory,
  useScaffoldReadContract,
  useScaffoldWriteContract,
  useSelectedNetwork,
} from "~~/hooks/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth";

const LoadingRow = ({ colCount = 5 }: { colCount?: number }) => (
  <tr>
    <td colSpan={colCount} className="animate-pulse">
      <div className="h-8 bg-secondary w-full" />
    </td>
  </tr>
);
const NoNodesRow = ({ colSpan = 5 }: { colSpan?: number }) => (
  <tr>
    <td colSpan={colSpan} className="text-center">
      No nodes found
    </td>
  </tr>
);

const SlashAllButton = ({ selectedBucket }: { selectedBucket: bigint }) => {
  const { address: connectedAddress } = useAccount();
  const network = useSelectedNetwork();
  const publicClient = usePublicClient({ chainId: network.id });
  const { data: stakingDeployment } = useDeployedContractInfo({ contractName: "StakingOracle" });
  const { writeContractAsync: writeStakingOracle } = useScaffoldWriteContract({ contractName: "StakingOracle" });
  const { data: outliers } = useScaffoldReadContract({
    contractName: "StakingOracle",
    functionName: "getOutlierNodes",
    args: [selectedBucket] as any,
    watch: true,
  }) as { data: string[] | undefined };
  const { data: nodeAddresses } = useScaffoldReadContract({
    contractName: "StakingOracle",
    functionName: "getNodeAddresses",
    watch: true,
  }) as { data: string[] | undefined };

  const [unslashed, setUnslashed] = React.useState<string[]>([]);

  const { data: priceEvents } = useScaffoldEventHistory({
    contractName: "StakingOracle",
    eventName: "PriceReported",
    watch: true,
  });

  const bucketReports = React.useMemo(() => {
    if (!priceEvents) return [];
    const filtered = priceEvents.filter(ev => {
      const bucket = ev?.args?.bucketNumber as bigint | undefined;
      return bucket !== undefined && bucket === selectedBucket;
    });
    // IMPORTANT: `slashNode` expects `reportIndex` to match the on-chain `timeBuckets[bucket].reporters[]` index,
    // which follows the order reports were submitted (tx order). Event history may be returned newest-first,
    // so we sort by (blockNumber, logIndex) ascending to match insertion order.
    return [...filtered].sort((a: any, b: any) => {
      const aBlock = BigInt(a?.blockNumber ?? 0);
      const bBlock = BigInt(b?.blockNumber ?? 0);
      if (aBlock !== bBlock) return aBlock < bBlock ? -1 : 1;
      const aLog = Number(a?.logIndex ?? 0);
      const bLog = Number(b?.logIndex ?? 0);
      return aLog - bLog;
    });
  }, [priceEvents, selectedBucket]);

  React.useEffect(() => {
    const check = async () => {
      if (!outliers || !publicClient || !stakingDeployment) {
        setUnslashed([]);
        return;
      }
      const list: string[] = [];
      for (const addr of outliers) {
        try {
          const [, isSlashed] = (await publicClient.readContract({
            address: stakingDeployment.address as `0x${string}`,
            abi: stakingDeployment.abi as any,
            functionName: "getSlashedStatus",
            args: [addr, selectedBucket],
          })) as [bigint, boolean];
          if (!isSlashed) list.push(addr);
        } catch {
          // assume not slashed on read error
          list.push(addr);
        }
      }
      setUnslashed(list);
    };
    check();
    const id = setInterval(check, 2000);
    return () => clearInterval(id);
  }, [outliers, selectedBucket, publicClient, stakingDeployment]);

  const handleSlashAll = async () => {
    if (!unslashed.length || !nodeAddresses) return;
    try {
      for (const addr of unslashed) {
        // Removing a fully slashed node uses swap-and-pop; fetch the current index before each transaction.
        if (!publicClient || !stakingDeployment) return;
        const currentAddresses = await publicClient.readContract({
          address: stakingDeployment.address,
          abi: stakingDeployment.abi,
          functionName: "getNodeAddresses",
        });
        const idx = currentAddresses.findIndex(a => a.toLowerCase() === addr.toLowerCase());
        if (idx === -1) continue;
        const reportIndex = bucketReports.findIndex(ev => {
          const reporter = (ev?.args?.node as string | undefined) || "";
          return reporter.toLowerCase() === addr.toLowerCase();
        });
        if (reportIndex === -1) {
          console.warn(`Report index not found for node ${addr}, skipping slashing.`);
          continue;
        }
        try {
          await writeStakingOracle({
            functionName: "slashNode",
            args: [addr as `0x${string}`, selectedBucket, BigInt(reportIndex), BigInt(idx)],
          });
        } catch {
          // continue slashing the rest
        }
      }
    } catch (e: any) {
      console.error(e);
    }
  };

  return (
    <button
      className="btn btn-error btn-sm mr-2"
      onClick={handleSlashAll}
      disabled={!connectedAddress || unslashed.length === 0}
      title={unslashed.length ? `Slash ${unslashed.length} outlier node(s)` : "No slashable nodes"}
    >
      Slash{unslashed.length ? ` (${unslashed.length})` : ""}
    </button>
  );
};

export const NodesTable = ({
  selectedBucket: externalSelectedBucket,
  onBucketChange,
}: {
  selectedBucket?: bigint | "current";
  onBucketChange?: (bucket: bigint | "current") => void;
} = {}) => {
  const { address: connectedAddress } = useAccount();
  const network = useSelectedNetwork();
  const publicClient = usePublicClient({ chainId: network.id });
  const { data: currentBucketData } = useScaffoldReadContract({
    contractName: "StakingOracle",
    functionName: "getCurrentBucketNumber",
  }) as { data: bigint | undefined };
  const currentBucket = currentBucketData ?? undefined;
  const [isRecordingMedian, setIsRecordingMedian] = useState(false);
  const [isMedianRecorded, setIsMedianRecorded] = useState<boolean | null>(null);
  const [internalSelectedBucket, setInternalSelectedBucket] = useState<bigint | "current">("current");
  const selectedBucket = externalSelectedBucket ?? internalSelectedBucket;
  const isViewingCurrentBucket = selectedBucket === "current";
  const targetBucket = useMemo<bigint | null>(() => {
    // When viewing "current", we actually want to record the *last completed* bucket (current - 1),
    // since the current bucket is still in progress and cannot be finalized.
    if (selectedBucket === "current") {
      if (currentBucket === undefined) return null;
      if (currentBucket <= 1n) return null;
      return currentBucket - 1n;
    }
    return selectedBucket ?? null;
  }, [selectedBucket, currentBucket]);
  const setSelectedBucket = (bucket: bigint | "current") => {
    setInternalSelectedBucket(bucket);
    onBucketChange?.(bucket);
  };
  const [animateDir, setAnimateDir] = useState<"left" | "right" | null>(null);
  const [animateKey, setAnimateKey] = useState(0);
  const [entering, setEntering] = useState(true);
  const lastCurrentBucketRef = useRef<bigint | null>(null);
  const { data: registeredEvents, isLoading: isLoadingRegistered } = useScaffoldEventHistory({
    contractName: "StakingOracle",
    eventName: "NodeRegistered",
    watch: true,
  });
  const { data: exitedEvents, isLoading: isLoadingExited } = useScaffoldEventHistory({
    contractName: "StakingOracle",
    eventName: "NodeExited",
    watch: true,
  });
  const eventDerivedNodeAddresses: string[] = (() => {
    const set = new Set<string>();
    (registeredEvents || []).forEach(ev => {
      const addr = (ev?.args?.node as string | undefined)?.toLowerCase();
      if (addr) set.add(addr);
    });
    (exitedEvents || []).forEach(ev => {
      const addr = (ev?.args?.node as string | undefined)?.toLowerCase();
      if (addr) set.delete(addr);
    });
    return Array.from(set.values());
  })();
  const hasEverRegisteredSelf = useMemo(() => {
    if (!connectedAddress) return false;
    const lower = connectedAddress.toLowerCase();
    return (registeredEvents || []).some(ev => {
      const addr = (ev?.args?.node as string | undefined)?.toLowerCase();
      return addr === lower;
    });
  }, [registeredEvents, connectedAddress]);
  useEffect(() => {
    if (currentBucket === undefined) return;
    const last = lastCurrentBucketRef.current;
    if (last !== null && currentBucket > last) {
      if (selectedBucket === "current") {
        setAnimateDir("left");
        setAnimateKey(k => k + 1);
        setEntering(false);
        setTimeout(() => setEntering(true), 20);
      }
    }
    lastCurrentBucketRef.current = currentBucket;
  }, [currentBucket, selectedBucket]);
  const changeBucketWithAnimation = (newBucket: bigint | "current", dir: "left" | "right") => {
    setAnimateDir(dir);
    setAnimateKey(k => k + 1);
    setEntering(false);
    setSelectedBucket(newBucket);
    setTimeout(() => setEntering(true), 20);
  };
  const { writeContractAsync: writeStakingOracle } = useScaffoldWriteContract({ contractName: "StakingOracle" });
  const { data: nodeAddresses } = useScaffoldReadContract({
    contractName: "StakingOracle",
    functionName: "getNodeAddresses",
    watch: true,
  });
  const { data: stakingDeployment } = useDeployedContractInfo({ contractName: "StakingOracle" });
  const { writeContractAsync: writeErc20 } = useWriteContract();
  const { data: oracleTokenAddress } = useScaffoldReadContract({
    contractName: "StakingOracle",
    functionName: "oracleToken",
  });
  const { data: oraBalance } = useReadContract({
    chainId: network.id,
    address: oracleTokenAddress as `0x${string}` | undefined,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: connectedAddress ? [connectedAddress] : undefined,
    query: { enabled: !!oracleTokenAddress && !!connectedAddress, refetchInterval: 5000 },
  });
  const { data: minimumStake } = useScaffoldReadContract({
    contractName: "StakingOracle",
    functionName: "MINIMUM_STAKE",
  }) as { data: bigint | undefined };

  const minimumStakeFormatted = minimumStake !== undefined ? Number(formatEther(minimumStake)).toLocaleString() : "...";
  const tooltipText = `This table displays registered oracle nodes that provide price data to the system. Rows are dimmed when the node's effective ORA stake falls below the minimum (${minimumStakeFormatted} ORA). Reports are submitted manually by connected node operators. Record completed bucket medians to allow the next report, then slash outliers if necessary.`;
  const registerButtonLabel = "Register Node";
  const readMedianValue = useCallback(async (): Promise<boolean | null> => {
    if (!targetBucket) {
      return null;
    }
    if (targetBucket <= 0n) {
      return false;
    }
    if (!publicClient || !stakingDeployment?.address) {
      return null;
    }
    try {
      const median = await publicClient.readContract({
        address: stakingDeployment.address as `0x${string}`,
        abi: stakingDeployment.abi as any,
        functionName: "getPastPrice",
        args: [targetBucket],
      });
      return BigInt(String(median)) > 0n;
    } catch {
      return false;
    }
  }, [publicClient, stakingDeployment, targetBucket]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const result = await readMedianValue();
      if (!cancelled) {
        setIsMedianRecorded(result);
      }
    };
    void run();
    const interval = setInterval(() => {
      void run();
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [readMedianValue]);

  const canRecordMedian = Boolean(
    targetBucket && targetBucket > 0n && isMedianRecorded === false && !isRecordingMedian,
  );
  const recordMedianButtonLabel = isRecordingMedian
    ? "Recording..."
    : isViewingCurrentBucket
      ? "Record last Bucket Median"
      : "Record Median";

  const handleRecordMedian = async () => {
    if (!stakingDeployment?.address || !targetBucket || targetBucket <= 0n) {
      return;
    }
    setIsRecordingMedian(true);
    try {
      await writeStakingOracle({ functionName: "recordBucketMedian", args: [targetBucket] });
      const refreshed = await readMedianValue();
      setIsMedianRecorded(refreshed);
    } catch (e: any) {
      console.error(e);
    } finally {
      setIsRecordingMedian(false);
    }
  };
  const isSelfRegistered = Boolean(
    (nodeAddresses as string[] | undefined)?.some(
      addr => addr?.toLowerCase() === (connectedAddress || "").toLowerCase(),
    ),
  );
  const handleRegisterSelf = async () => {
    if (!connectedAddress) return;
    if (!stakingDeployment?.address || !oracleTokenAddress) return;
    if (!publicClient) return;
    const stakeAmount = minimumStake ?? parseEther("100");
    try {
      const currentBalance = (oraBalance as bigint | undefined) ?? 0n;
      if (currentBalance < stakeAmount) {
        notification.error(
          `Insufficient ORA to register. Need ${formatEther(stakeAmount)} ORA to stake (you have ${formatEther(
            currentBalance,
          )}). Use “Buy ORA” first.`,
        );
        return;
      }

      // Wait for approval to be mined before registering.
      // (writeContractAsync returns the tx hash)
      const approveHash = await writeErc20({
        chainId: network.id,
        address: oracleTokenAddress as `0x${string}`,
        abi: erc20Abi,
        functionName: "approve",
        args: [stakingDeployment.address as `0x${string}`, stakeAmount],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveHash });

      const registerHash = await writeStakingOracle({ functionName: "registerNode", args: [stakeAmount] });
      if (registerHash) {
        await publicClient.waitForTransactionReceipt({ hash: registerHash as `0x${string}` });
      }
    } catch (e: any) {
      console.error(e);
    }
  };
  const handleClaimRewards = async () => {
    if (!connectedAddress) return;
    try {
      await writeStakingOracle({ functionName: "claimReward" });
    } catch (e: any) {
      console.error(e);
    }
  };
  const handleExitNode = async () => {
    if (!connectedAddress) return;
    if (!isSelfRegistered) return;
    if (!nodeAddresses) return;
    const list = nodeAddresses as string[];
    const idx = list.findIndex(addr => addr?.toLowerCase() === connectedAddress.toLowerCase());
    if (idx === -1) return;
    try {
      await writeStakingOracle({ functionName: "exitNode", args: [BigInt(idx)] });
    } catch (e: any) {
      console.error(e);
    }
  };
  const filteredNodeAddresses = (
    selectedBucket === "current" ? ((nodeAddresses as string[] | undefined) ?? []) : eventDerivedNodeAddresses
  ).filter((addr: string) => addr?.toLowerCase() !== (connectedAddress || "").toLowerCase());
  return (
    <>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold">Oracle Nodes</h2>
            <span>
              <TooltipInfo infoText={tooltipText} />
            </span>
            <span className="text-xs bg-base-100 px-2 py-1 opacity-70">Min Stake: {minimumStakeFormatted} ORA</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1">
              <button
                className="btn btn-secondary btn-sm"
                onClick={handleRecordMedian}
                disabled={!connectedAddress || !canRecordMedian}
                title={
                  targetBucket && targetBucket > 0n
                    ? isMedianRecorded === true
                      ? isViewingCurrentBucket
                        ? "Last bucket median already recorded"
                        : "Median already recorded for this bucket"
                      : isViewingCurrentBucket
                        ? "Record the median for the last completed bucket"
                        : "Record the median for the selected bucket"
                    : isViewingCurrentBucket
                      ? "No completed bucket available yet"
                      : "Median can only be recorded for completed buckets"
                }
              >
                {recordMedianButtonLabel}
              </button>
              {/* Slash button near navigation (left of left arrow) */}
              {selectedBucket !== "current" && <SlashAllButton selectedBucket={selectedBucket as bigint} />}
              {/* Previous (<) */}
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  if (selectedBucket === "current" && currentBucket && currentBucket > 1n) {
                    changeBucketWithAnimation(currentBucket - 1n, "right");
                  } else if (typeof selectedBucket === "bigint" && selectedBucket > 1n) {
                    changeBucketWithAnimation(selectedBucket - 1n, "right");
                  }
                }}
                disabled={selectedBucket === "current" ? !currentBucket || currentBucket <= 1n : selectedBucket <= 1n}
                title="Previous bucket"
              >
                ←
              </button>

              {/* Current selected bucket label (non-clickable) */}
              <span className="px-2 text-sm tabular-nums select-none">
                {selectedBucket === "current"
                  ? currentBucket !== undefined
                    ? currentBucket.toString()
                    : "..."
                  : (selectedBucket as bigint).toString()}
              </span>

              {/* Next (>) */}
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  if (selectedBucket === "current") return;
                  if (typeof selectedBucket === "bigint" && currentBucket && selectedBucket < currentBucket - 1n) {
                    changeBucketWithAnimation(selectedBucket + 1n, "left");
                  } else if (
                    typeof selectedBucket === "bigint" &&
                    currentBucket &&
                    selectedBucket === currentBucket - 1n
                  ) {
                    changeBucketWithAnimation("current", "left");
                  }
                }}
                disabled={
                  selectedBucket === "current" ||
                  currentBucket === undefined ||
                  (typeof selectedBucket === "bigint" && selectedBucket >= currentBucket)
                }
                title="Next bucket"
              >
                →
              </button>

              {/* Go to Current button */}
              <button
                className="btn btn-ghost btn-sm ml-2"
                onClick={() => {
                  changeBucketWithAnimation("current", "left");
                }}
                disabled={selectedBucket === "current"}
                title="Go to current bucket"
              >
                Go to Current
              </button>
            </div>
            {connectedAddress && !isSelfRegistered ? (
              <button
                className="btn btn-primary btn-sm font-normal"
                onClick={handleRegisterSelf}
                disabled={!oracleTokenAddress || !stakingDeployment?.address}
              >
                {registerButtonLabel}
              </button>
            ) : (
              <>
                <button
                  className="btn btn-primary btn-sm font-normal"
                  onClick={handleClaimRewards}
                  disabled={!isSelfRegistered}
                >
                  Claim Rewards
                </button>
                <button
                  className="btn btn-error btn-sm font-normal"
                  onClick={handleExitNode}
                  disabled={!isSelfRegistered}
                >
                  Exit Node
                </button>
              </>
            )}
          </div>
        </div>
        <div className="bg-base-100 p-4 relative">
          <div className="overflow-x-auto">
            <div
              key={animateKey}
              className={`transform transition-transform duration-300 ${
                entering ? "translate-x-0" : animateDir === "left" ? "translate-x-full" : "-translate-x-full"
              }`}
            >
              <table className="table w-full">
                <thead>
                  <tr>
                    {selectedBucket === "current" ? (
                      <>
                        <th>Node Address</th>
                        <th>Stake</th>
                        <th>Claimed Rewards</th>
                        <th>Reported Price</th>
                        <th>
                          <div className="flex items-center gap-1">
                            Deviation
                            <TooltipInfo
                              className="tooltip-left"
                              infoText="Percentage difference versus the previous bucket median"
                            />
                          </div>
                        </th>
                      </>
                    ) : (
                      <>
                        <th>Node Address</th>
                        <th>Reported Price</th>
                        <th>
                          <div className="flex items-center gap-1">
                            Deviation
                            <TooltipInfo
                              className="tooltip-left"
                              infoText="Percentage difference from the recorded bucket median"
                            />
                          </div>
                        </th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {
                    <>
                      {selectedBucket === "current" ? (
                        isSelfRegistered || hasEverRegisteredSelf ? (
                          <SelfNodeRow isStale={false} bucketNumber={null} />
                        ) : null
                      ) : isSelfRegistered || hasEverRegisteredSelf ? (
                        <SelfNodeRow isStale={false} bucketNumber={selectedBucket as bigint} />
                      ) : null}
                      {isSelfRegistered && (
                        <tr>
                          <td colSpan={9} className="py-2">
                            <div className="text-center text-xs uppercase tracking-wider">Other Oracle Nodes</div>
                          </td>
                        </tr>
                      )}
                    </>
                  }
                  {isLoadingRegistered || isLoadingExited ? (
                    <LoadingRow colCount={selectedBucket === "current" ? 5 : 3} />
                  ) : filteredNodeAddresses.length === 0 ? (
                    <NoNodesRow colSpan={selectedBucket === "current" ? 5 : 3} />
                  ) : (
                    filteredNodeAddresses.map((address: string, index: number) => (
                      <NodeRow
                        key={index}
                        index={index}
                        address={address}
                        bucketNumber={selectedBucket === "current" ? null : (selectedBucket as bigint)}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};
