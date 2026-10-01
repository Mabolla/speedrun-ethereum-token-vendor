import TooltipInfo from "../TooltipInfo";
import { useBlockNumber } from "wagmi";
import { useScaffoldReadContract, useSelectedNetwork } from "~~/hooks/scaffold-eth";

export const BucketCountdown = () => {
  const network = useSelectedNetwork();
  const { data: blockNumber } = useBlockNumber({ chainId: network.id, watch: true });
  const { data: bucketWindow } = useScaffoldReadContract({
    contractName: "StakingOracle",
    functionName: "BUCKET_WINDOW",
  });
  const currentBucket = blockNumber !== undefined && bucketWindow ? blockNumber / bucketWindow + 1n : undefined;
  const blocksRemaining =
    blockNumber !== undefined && bucketWindow ? bucketWindow - (blockNumber % bucketWindow) : undefined;
  return (
    <div className="flex flex-col gap-2 h-full">
      <h2 className="text-xl font-bold">Bucket Progress</h2>
      <div className="bg-base-100 p-4 w-full flex justify-center items-center relative h-full min-h-[140px]">
        <TooltipInfo
          top={0}
          right={0}
          className="tooltip-left"
          infoText="Each reporting bucket lasts 24 blocks. The remaining block count comes directly from the selected chain; block intervals may vary."
        />
        <div className="flex flex-col items-center gap-2">
          <div className="text-sm opacity-70">Bucket #{currentBucket?.toString() ?? "…"}</div>
          <div className="font-bold text-3xl">{blocksRemaining?.toString() ?? "…"} blocks</div>
          <div className="text-xs opacity-70">until next bucket</div>
        </div>
      </div>
    </div>
  );
};
