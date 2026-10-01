import type { VotingIdentity } from "./types";
import { poseidon2 } from "poseidon-lite";
import { isAddress, toHex } from "viem";

const FIELD_ORDER = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const activeKey = (contract: string) => `sre-zk-voting:v1:11155111:${contract.toLowerCase()}:active`;
const storageKey = (contract: string, registration: string) =>
  `sre-zk-voting:v1:11155111:${contract.toLowerCase()}:${registration.toLowerCase()}`;
const randomField = () => {
  let value = 0n;
  do {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    value = BigInt(toHex(bytes));
  } while (value === 0n || value >= FIELD_ORDER);
  return value;
};

export const createIdentity = (contractAddress: `0x${string}`, registrationAddress: `0x${string}`): VotingIdentity => {
  const nullifier = randomField();
  const secret = randomField();
  return {
    version: 1,
    chainId: 11155111,
    contractAddress,
    registrationAddress,
    commitment: toHex(poseidon2([nullifier, secret]), { size: 32 }),
    nullifier: toHex(nullifier, { size: 32 }),
    secret: toHex(secret, { size: 32 }),
  };
};

export const validateIdentity = (value: unknown, contract: string): VotingIdentity => {
  if (value === null || typeof value !== "object") throw new Error("Invalid registration backup");
  const identity = value as VotingIdentity;
  if (
    identity.version !== 1 ||
    identity.chainId !== 11155111 ||
    typeof identity.contractAddress !== "string" ||
    identity.contractAddress.toLowerCase() !== contract.toLowerCase() ||
    !isAddress(identity.registrationAddress)
  ) {
    throw new Error("This backup belongs to a different contract or network");
  }
  for (const field of [identity.nullifier, identity.secret, identity.commitment]) {
    if (
      typeof field !== "string" ||
      !/^0x[0-9a-fA-F]{64}$/.test(field) ||
      BigInt(field) <= 0n ||
      BigInt(field) >= FIELD_ORDER
    )
      throw new Error("Invalid registration backup");
  }
  if (poseidon2([BigInt(identity.nullifier), BigInt(identity.secret)]) !== BigInt(identity.commitment))
    throw new Error("The registration backup does not match its commitment");
  return identity;
};

export const saveIdentity = (identity: VotingIdentity) => {
  localStorage.setItem(storageKey(identity.contractAddress, identity.registrationAddress), JSON.stringify(identity));
  localStorage.setItem(activeKey(identity.contractAddress), identity.registrationAddress);
};
export const loadIdentityForWallet = (contract: string, registration: string): VotingIdentity | null => {
  const stored = localStorage.getItem(storageKey(contract, registration));
  return stored ? validateIdentity(JSON.parse(stored), contract) : null;
};
export const loadIdentity = (contract: string): VotingIdentity | null => {
  const registration = localStorage.getItem(activeKey(contract));
  return registration ? loadIdentityForWallet(contract, registration) : null;
};
