import { type Address, formatEther, parseEther } from "viem";

export const PREDICTION_CHAIN_ID = 11155111;
export const PREDICTION_PRECISION = 10n ** 18n;

export type PredictionDetails = readonly [
  question: string,
  yesName: string,
  noName: string,
  oracle: Address,
  tokenValue: bigint,
  yesReserve: bigint,
  noReserve: bigint,
  isReported: boolean,
  yesToken: Address,
  noToken: Address,
  winningToken: Address,
  collateral: bigint,
  revenue: bigint,
  owner: Address,
  initialProbability: bigint,
  percentageLocked: bigint,
];

export function parsePredictionAmount(value: string): bigint | undefined {
  if (!/^\d+(?:\.\d{0,18})?$/.test(value.trim())) return undefined;
  try {
    const amount = parseEther(value.trim());
    return amount > 0n ? amount : undefined;
  } catch {
    return undefined;
  }
}

export function formatPredictionAmount(value: bigint | undefined): string {
  if (value === undefined) return "Loading…";
  if (value === 0n) return "0";
  const amount = Number(formatEther(value));
  return amount < 0.000001 ? amount.toPrecision(4) : amount.toLocaleString("en-US", { maximumFractionDigits: 6 });
}
