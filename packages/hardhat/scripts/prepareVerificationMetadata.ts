import { readFile, writeFile } from "node:fs/promises";
import { keccak256, stringToHex } from "viem";

type Deployment = {
  address: string;
  contractName: string;
  sourceName: string;
  metadata: string;
};
type Artifact = { buildInfoId: string };
type BuildInfo = { input: { sources: Record<string, { content: string }> } };
type MetadataSource = { content?: string; keccak256: string };
type Metadata = { sources: Record<string, MetadataSource> };
type PreparedDeployment = {
  name: string;
  path: URL;
  deployment: Deployment;
  hydrated: number;
  sourceCount: number;
};

async function prepareDeployment(name: string): Promise<PreparedDeployment> {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) throw new Error(`Invalid deployment name: ${name}`);

  const path = new URL(`../deployments/sepolia/${name}.json`, import.meta.url);
  const deployment = JSON.parse(await readFile(path, "utf8")) as Deployment;
  if (!deployment.sourceName || !deployment.contractName || typeof deployment.metadata !== "string") {
    throw new Error(`${name}: deployment source, contract name, or metadata is missing`);
  }

  const artifactPath = new URL(
    `../artifacts/${deployment.sourceName}/${deployment.contractName}.json`,
    import.meta.url,
  );
  const artifact = JSON.parse(await readFile(artifactPath, "utf8")) as Artifact;
  if (!artifact.buildInfoId) throw new Error(`${name}: artifact buildInfoId is missing`);
  const buildPath = new URL(`../artifacts/build-info/${artifact.buildInfoId}.json`, import.meta.url);
  const buildInfo = JSON.parse(await readFile(buildPath, "utf8")) as BuildInfo;
  const metadata = JSON.parse(deployment.metadata) as Metadata;
  if (!metadata.sources || !buildInfo.input?.sources) {
    throw new Error(`${name}: metadata sources or compiler input sources are missing`);
  }

  let hydrated = 0;
  for (const [sourceName, source] of Object.entries(metadata.sources)) {
    const content = source.content ?? buildInfo.input.sources[sourceName]?.content;
    if (typeof content !== "string") throw new Error(`${name}: source content missing for ${sourceName}`);
    if (typeof source.keccak256 !== "string" || keccak256(stringToHex(content)) !== source.keccak256.toLowerCase()) {
      throw new Error(`${name}: source hash mismatch for ${sourceName}`);
    }
    if (source.content === undefined) {
      source.content = content;
      hydrated++;
    }
  }

  if (hydrated > 0) deployment.metadata = JSON.stringify(metadata);
  return { name, path, deployment, hydrated, sourceCount: Object.keys(metadata.sources).length };
}

async function main() {
  const names = [...new Set(process.argv.slice(2))];
  if (names.length === 0) throw new Error("Usage: prepareVerificationMetadata.ts <deploymentName> [...names]");

  // Validate every source before changing any deployment record.
  const prepared = await Promise.all(names.map(prepareDeployment));
  for (const { name, path, deployment, hydrated, sourceCount } of prepared) {
    if (hydrated > 0) await writeFile(path, `${JSON.stringify(deployment, null, 2)}\n`);
    console.log(`${name} (${deployment.address}): validated ${sourceCount} sources, hydrated ${hydrated}`);
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Verification metadata preparation failed");
  process.exitCode = 1;
});
