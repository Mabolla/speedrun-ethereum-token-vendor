import { useBalance } from "wagmi";
import { useDeployedContractInfo, useScaffoldReadContract } from "~~/hooks/scaffold-eth";
import { STABLECOIN_CHAIN_ID, STABLECOIN_PRECISION, formatStableAmount } from "~~/utils/stablecoins";

export default function Overview() {
  const { data: dex } = useDeployedContractInfo({ contractName: "StableDEX", chainId: STABLECOIN_CHAIN_ID });
  const { data: price, error: priceError } = useScaffoldReadContract({
    contractName: "Oracle",
    functionName: "getETHMyUSDPrice",
    chainId: STABLECOIN_CHAIN_ID,
  });
  const { data: reference, error: referenceError } = useScaffoldReadContract({
    contractName: "Oracle",
    functionName: "getETHUSDPrice",
    chainId: STABLECOIN_CHAIN_ID,
  });
  const { data: liquidity, error: liquidityError } = useScaffoldReadContract({
    contractName: "StableDEX",
    functionName: "totalLiquidity",
    chainId: STABLECOIN_CHAIN_ID,
  });
  const { data: supply, error: supplyError } = useScaffoldReadContract({
    contractName: "MyUSD",
    functionName: "totalSupply",
    chainId: STABLECOIN_CHAIN_ID,
  });
  const { data: totalShares, error: sharesError } = useScaffoldReadContract({
    contractName: "MyUSDStaking",
    functionName: "totalShares",
    chainId: STABLECOIN_CHAIN_ID,
  });
  const { data: staked, error: stakedError } = useScaffoldReadContract({
    contractName: "MyUSDStaking",
    functionName: "getSharesValue",
    args: [totalShares],
    chainId: STABLECOIN_CHAIN_ID,
  });
  const { data: tokenReserve, error: tokenReserveError } = useScaffoldReadContract({
    contractName: "MyUSD",
    functionName: "balanceOf",
    args: [dex?.address],
    chainId: STABLECOIN_CHAIN_ID,
  });
  const { data: ethReserve, error: ethReserveError } = useBalance({
    address: dex?.address,
    chainId: STABLECOIN_CHAIN_ID,
    query: { refetchInterval: 3000 },
  });
  const readError = Boolean(
    priceError ||
    referenceError ||
    liquidityError ||
    supplyError ||
    sharesError ||
    stakedError ||
    tokenReserveError ||
    ethReserveError,
  );
  const poolActive =
    liquidity !== undefined &&
    liquidity > 0n &&
    tokenReserve !== undefined &&
    tokenReserve > 0n &&
    ethReserve !== undefined &&
    ethReserve.value > 0n;
  const impliedPrice =
    poolActive && price && reference !== undefined ? (reference * STABLECOIN_PRECISION) / price : undefined;
  const stakedWidth =
    supply && staked !== undefined ? Number(((staked > supply ? supply : staked) * 360n) / supply) : 0;

  return (
    <section className="card bg-base-100 shadow-xl">
      <div className="card-body">
        {readError && (
          <p className="text-sm text-warning m-0" role="alert">
            Could not refresh Sepolia data. Displayed values may be stale.
          </p>
        )}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div>
            <h2 className="font-semibold">ETH collateral oracle</h2>
            <p className="text-xl my-1">{formatStableAmount(price)} MyUSD / ETH</p>
            <p className="text-xs opacity-70 m-0">
              {poolActive
                ? "DEX output quote for a 1 ETH swap, including price impact."
                : liquidity === undefined
                  ? "Loading oracle source…"
                  : "Fixed reference used while the pool has no liquidity."}
            </p>
          </div>
          <div>
            <h2 className="font-semibold">ETH/USD reference</h2>
            <p className="text-xl my-1">${formatStableAmount(reference)}</p>
            <p className="text-xs opacity-70 m-0">
              Fixed deployment reference.{" "}
              {poolActive && impliedPrice !== undefined
                ? `MyUSD implied quote: $${formatStableAmount(impliedPrice)}.`
                : "No live MyUSD market quote is available."}
            </p>
          </div>
          <div>
            <h2 className="font-semibold">MyUSD supply</h2>
            <p className="my-1">Total: {formatStableAmount(supply)}</p>
            <p className="my-1">Staked value: {formatStableAmount(staked)}</p>
            {supply !== undefined && staked !== undefined && supply > 0n ? (
              <svg
                viewBox="0 0 360 20"
                className="w-full"
                role="img"
                aria-label={`Staked ${formatStableAmount(staked)} of total ${formatStableAmount(supply)} MyUSD`}
              >
                <rect width="360" height="20" rx="3" fill="#3b82f6" />
                <rect width={stakedWidth} height="20" rx="3" fill="#10b981" />
              </svg>
            ) : (
              <p className="text-xs opacity-70 m-0">
                {supply === 0n ? "No MyUSD supply yet." : "Loading supply distribution…"}
              </p>
            )}
            {supply !== undefined && supply > 0n && (
              <p className="text-xs opacity-70 m-0">Green is staked supply, including accrued savings.</p>
            )}
          </div>
        </div>
        {liquidity === 0n && (
          <p className="text-sm m-0 mt-3">
            Pool liquidity is not initialized. Swaps are unavailable; positions use the fixed reference price.
          </p>
        )}
        <p className="text-xs opacity-70 m-0 mt-2">
          Pool reserves: {formatStableAmount(ethReserve?.value)} ETH / {formatStableAmount(tokenReserve)} MyUSD.
        </p>
      </div>
    </section>
  );
}
