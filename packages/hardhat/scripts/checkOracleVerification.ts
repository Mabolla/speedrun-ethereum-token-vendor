import "dotenv/config";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { etherscanApiKey } from "../hardhat.config.js";

const DEPLOYMENT_NAMES = ["WhitelistOracle", "ORA", "StakingOracle", "OptimisticOracle", "Decider"];
const REQUEST_INTERVAL_MS = 1500;
const MAX_ATTEMPTS = 5;

type Deployment = { address: string; contractName: string };
type SourceRecord = { SourceCode: string; ContractName: string; ABI: string };
type EtherscanResponse = { status: string; result: SourceRecord[] | string };

let lastRequestAt = 0;

async function getVerifiedSource(name: string, deployment: Deployment): Promise<SourceRecord> {
  const url = new URL("https://api.etherscan.io/v2/api");
  url.search = new URLSearchParams({
    chainid: "11155111",
    module: "contract",
    action: "getsourcecode",
    address: deployment.address,
    apikey: etherscanApiKey,
  }).toString();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await delay(Math.max(0, REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt)));
    lastRequestAt = Date.now();

    let result: EtherscanResponse;
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (response.status === 429 || response.status >= 500) {
        throw new Error("temporary API error");
      }
      if (!response.ok) throw new Error("API request rejected");
      result = (await response.json()) as EtherscanResponse;
    } catch {
      if (attempt === MAX_ATTEMPTS) throw new Error(`${name}: Etherscan request failed after ${MAX_ATTEMPTS} attempts`);
      console.log(`${name}: retrying Etherscan request (${attempt}/${MAX_ATTEMPTS})`);
      continue;
    }

    if (
      result.status === "0" &&
      typeof result.result === "string" &&
      /rate limit|too many requests/i.test(result.result)
    ) {
      if (attempt === MAX_ATTEMPTS)
        throw new Error(`${name}: Etherscan rate limit persisted after ${MAX_ATTEMPTS} attempts`);
      console.log(`${name}: waiting for Etherscan rate limit (${attempt}/${MAX_ATTEMPTS})`);
      continue;
    }

    const source = Array.isArray(result.result) ? result.result[0] : undefined;
    if (result.status !== "1" || !source || typeof source.SourceCode !== "string" || !source.SourceCode.trim()) {
      throw new Error(`${name} (${deployment.address}): Etherscan has no verified source`);
    }
    if (source.ContractName !== deployment.contractName) {
      throw new Error(`${name} (${deployment.address}): verified contract name does not match deployment`);
    }
    try {
      if (!Array.isArray(JSON.parse(source.ABI))) throw new Error("ABI must be an array");
    } catch {
      throw new Error(`${name} (${deployment.address}): Etherscan ABI is invalid`);
    }
    return source;
  }

  throw new Error(`${name}: Etherscan verification check exhausted its retries`);
}

async function main() {
  for (const name of DEPLOYMENT_NAMES) {
    const path = new URL(`../deployments/sepolia/${name}.json`, import.meta.url);
    const deployment = JSON.parse(await readFile(path, "utf8")) as Deployment;
    if (!/^0x[0-9a-fA-F]{40}$/.test(deployment.address) || !deployment.contractName) {
      throw new Error(`${name}: deployment address or contract name is missing`);
    }
    await getVerifiedSource(name, deployment);
    console.log(`Confirmed verified source and ABI: ${name} (${deployment.address})`);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Oracle verification check failed");
  process.exitCode = 1;
});
