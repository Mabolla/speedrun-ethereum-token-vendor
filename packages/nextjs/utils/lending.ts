import { formatEther, parseEther } from "viem";

export const LENDING_CHAIN_ID = 11155111;
export const MIN_COLLATERAL_RATIO = 120n;
export const WEI_PER_UNIT = 10n ** 18n;

export function parsePositiveAmount(value: string): bigint | undefined {
  if (!/^\d+(?:\.\d{0,18})?$/.test(value.trim())) return undefined;
  try {
    const amount = parseEther(value.trim());
    return amount > 0n ? amount : undefined;
  } catch {
    return undefined;
  }
}

export function formatLendingAmount(value: bigint | undefined): string {
  if (value === undefined) return "Loading…";
  if (value === 0n) return "0";
  const amount = Number(formatEther(value));
  return amount < 0.000001 ? amount.toPrecision(4) : amount.toLocaleString("en-US", { maximumFractionDigits: 6 });
}

export function positionRatio(collateral: bigint, debt: bigint, price: bigint): number | null {
  if (debt === 0n) return null;
  const collateralValue = (collateral * price) / WEI_PER_UNIT;
  return Number((collateralValue * 10000n) / debt) / 100;
}

export function isPositionSafe(collateral: bigint, debt: bigint, price: bigint): boolean {
  if (debt === 0n) return true;
  const collateralValue = (collateral * price) / WEI_PER_UNIT;
  const ratio = (collateralValue * WEI_PER_UNIT) / debt;
  return ratio * 100n >= MIN_COLLATERAL_RATIO * WEI_PER_UNIT;
}

export function swapQuote(input: bigint, inputReserve: bigint, outputReserve: bigint): bigint {
  if (input <= 0n || inputReserve <= 0n || outputReserve <= 0n) return 0n;
  return (input * outputReserve) / (inputReserve + input);
}
