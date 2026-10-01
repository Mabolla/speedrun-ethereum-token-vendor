import { WEI_PER_UNIT, formatLendingAmount, positionRatio } from "~~/utils/lending";

type Props = {
  collateral: bigint | undefined;
  debt: bigint | undefined;
  price: bigint | undefined;
  connected: boolean;
};

export default function CollateralGraph({ collateral, debt, price, connected }: Props) {
  if (!connected) return <p className="text-sm m-0">Connect your wallet to view your collateral coverage.</p>;
  if (collateral === undefined || debt === undefined || price === undefined)
    return <p className="text-sm m-0">Loading your position…</p>;
  const value = (collateral * price) / WEI_PER_UNIT;
  const ratio = positionRatio(collateral, debt, price);
  const required = (debt * 120n) / 100n;
  const ceiling = value > required ? value : required;
  const width = (amount: bigint) => (ceiling > 0n ? Number((amount * 340n) / ceiling) : 0);

  return (
    <div className="space-y-2">
      <p className="m-0 font-semibold">Your collateral ratio: {ratio === null ? "No debt" : `${ratio.toFixed(2)}%`}</p>
      {collateral === 0n && debt === 0n ? (
        <p className="text-sm m-0">No position yet. Deposit ETH to start borrowing.</p>
      ) : (
        <>
          <svg
            viewBox="0 0 400 138"
            className="w-full max-w-lg"
            role="img"
            aria-label={`Collateral value ${formatLendingAmount(value)} CORN, debt ${formatLendingAmount(debt)} CORN. Minimum ratio 120 percent.`}
          >
            <text x="15" y="18" fill="currentColor" fontSize="12">
              Collateral value · {formatLendingAmount(value)} CORN
            </text>
            <rect x="15" y="25" width={width(value)} height="24" rx="3" fill="#10b981" />
            <text x="15" y="70" fill="currentColor" fontSize="12">
              Debt · {formatLendingAmount(debt)} CORN
            </text>
            <rect x="15" y="77" width={width(debt)} height="24" rx="3" fill="#3b82f6" />
            {debt > 0n && (
              <>
                <line
                  x1={15 + width(required)}
                  y1="23"
                  x2={15 + width(required)}
                  y2="105"
                  stroke="#ef4444"
                  strokeWidth="2"
                  strokeDasharray="4 3"
                />
                <text x="15" y="128" fill="currentColor" fontSize="12">
                  Red marker: collateral required at 120%
                </text>
              </>
            )}
          </svg>
          <p className="text-xs opacity-70 m-0">
            Collateral value follows the live lending oracle. Below 120%, the position can be liquidated.
          </p>
        </>
      )}
    </div>
  );
}
