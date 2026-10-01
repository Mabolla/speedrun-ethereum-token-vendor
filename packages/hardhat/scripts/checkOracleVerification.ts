import "dotenv/config";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { etherscanApiKey } from "../hardhat.config.js";

const DEPLOYMENT_NAMES =
  process.argv.length > 2
    ? process.argv.slice(2)
    : ["WhitelistOracle", "ORA", "StakingOracle", "OptimisticOracle", "Decider"];
const REQUEST_INTERVAL_MS = 1500;
const MAX_ATTEMPTS = 5;

type Deployment = { address: string; contractName: string };
type SourceRecord = { SourceCode: string; ContractName: string; ABI: string };
type EtherscanResponse = { status: string; result: SourceRecord[] | string };

let lastRequestAt = 0;

function checkEngineAutograderSource(sourceCode: string, deployment: Deployment) {
  const sourceJson = sourceCode.startsWith("{{") && sourceCode.endsWith("}}") ? sourceCode.slice(1, -1) : sourceCode;
  let sources: Record<string, { content?: string }> | undefined;
  try {
    sources = (JSON.parse(sourceJson) as { sources?: Record<string, { content?: string }> }).sources;
  } catch {
    throw new Error(`MyUSDEngine (${deployment.address}): verified source is not standard JSON input`);
  }

  // Speedrun's extractor accepts this exact suffix, including Hardhat 3's project/ prefix.
  // A path such as contracts/stablecoins/MyUSDEngine.sol is verified but cannot be graded.
  const suffix = "contracts/MyUSDEngine.sol";
  const key = sources && Object.keys(sources).find(path => path === suffix || path.endsWith(`/${suffix}`));
  const engineSource = key && sources?.[key]?.content;
  if (!engineSource?.trim()) {
    throw new Error(`MyUSDEngine (${deployment.address}): verified source lacks the autograder path ${suffix}`);
  }

  // The grader downloads only the engine and supplies these dependencies in its contracts/ directory.
  const supportedRelativeImports = new Set(["./MyUSD.sol", "./Oracle.sol", "./MyUSDStaking.sol"]);
  const imports = [...engineSource.matchAll(/\bimport\s+(?:[^;]*?\bfrom\s+)?["']([^"']+)["']\s*;/g)].map(
    match => match[1],
  );
  const relativeImports = imports.filter(path => path.startsWith("."));
  if (
    relativeImports.length !== supportedRelativeImports.size ||
    relativeImports.some(path => !supportedRelativeImports.has(path)) ||
    new Set(relativeImports).size !== supportedRelativeImports.size
  ) {
    throw new Error(`MyUSDEngine (${deployment.address}): source imports do not match the autograder dependencies`);
  }
}

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
    if (name === "MyUSDEngine") checkEngineAutograderSource(source.SourceCode, deployment);
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
