import { formatEther, parseEther } from "viem";

export const STABLECOIN_CHAIN_ID = 11155111;
export const STABLECOIN_PRECISION = 10n ** 18n;
export const STABLECOIN_COLLATERAL_RATIO = 150n;

export function parsePositiveAmount(value: string): bigint | undefined {
  if (!/^\d+(?:\.\d{0,18})?$/.test(value.trim())) return undefined;
  try {
    const amount = parseEther(value.trim());
    return amount > 0n ? amount : undefined;
  } catch {
    return undefined;
  }
}

export function parseRatePercent(value: string): bigint | undefined {
  if (!/^\d+(?:\.\d{0,2})?$/.test(value.trim())) return undefined;
  const [integer, decimal = ""] = value.trim().split(".");
  const rate = BigInt(integer) * 100n + BigInt(decimal.padEnd(2, "0"));
  return rate <= (1n << 256n) - 1n ? rate : undefined;
}

export function formatStableAmount(value: bigint | undefined): string {
  if (value === undefined) return "Loading…";
  if (value === 0n) return "0";
  const amount = Number(formatEther(value));
  return amount < 0.000001 ? amount.toPrecision(4) : amount.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

export function stablePositionRatio(collateral: bigint, debt: bigint, price: bigint): bigint | null {
  if (debt === 0n) return null;
  const collateralValue = (collateral * price) / STABLECOIN_PRECISION;
  return (collateralValue * 100n) / debt;
}

export function isStablePositionSafe(collateral: bigint, debt: bigint, price: bigint): boolean {
  const ratio = stablePositionRatio(collateral, debt, price);
  return ratio === null || ratio >= STABLECOIN_COLLATERAL_RATIO;
}

export function stableSwapQuote(input: bigint, inputReserve: bigint, outputReserve: bigint): bigint {
  if (input <= 0n || inputReserve <= 0n || outputReserve <= 0n) return 0n;
  return (input * outputReserve) / (inputReserve + input);
}
