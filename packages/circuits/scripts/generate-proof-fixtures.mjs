import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const circuitsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextjsRequire = createRequire(path.resolve(circuitsDirectory, "../nextjs/package.json"));
const { Noir } = await import(pathToFileURL(nextjsRequire.resolve("@noir-lang/noir_js")));
const { UltraHonkBackend } = await import(pathToFileURL(nextjsRequire.resolve("@aztec/bb.js")));
const { LeanIMT } = await import(pathToFileURL(nextjsRequire.resolve("@zk-kit/lean-imt")));
const { poseidon1, poseidon2 } = nextjsRequire("poseidon-lite");

const circuit = JSON.parse(await fs.readFile(path.resolve(circuitsDirectory, "target/circuits.json"), "utf8"));
const identities = [
  { nullifier: 1n, secret: 2n, vote: true },
  { nullifier: 3n, secret: 4n, vote: false },
];
const commitments = identities.map(({ nullifier, secret }) => poseidon2([nullifier, secret]));
const tree = new LeanIMT((left, right) => poseidon2([left, right]));
tree.insertMany(commitments);

const noir = new Noir(circuit);
const backend = new UltraHonkBackend(circuit.bytecode, { threads: 1 });
const proofs = [];
let singleLeaf;
try {
  for (const [index, identity] of identities.entries()) {
    const membershipProof = tree.generateProof(index);
    const { witness } = await noir.execute({
      nullifier_hash: poseidon1([identity.nullifier]).toString(),
      nullifier: identity.nullifier.toString(),
      secret: identity.secret.toString(),
      root: tree.root.toString(),
      vote: identity.vote,
      depth: tree.depth,
      index: membershipProof.index.toString(),
      siblings: [...membershipProof.siblings, ...Array(16 - membershipProof.siblings.length).fill(0n)].map(String),
    });
    const proof = await backend.generateProof(witness, { keccak: true });
    if (!(await backend.verifyProof(proof, { keccak: true }))) throw new Error("Generated fixture did not verify.");
    proofs.push({ proof: `0x${Buffer.from(proof.proof).toString("hex")}`, publicInputs: proof.publicInputs });
    console.log(`Verified ${identity.vote ? "yes" : "no"} fixture: ${proof.proof.length} proof bytes.`);
  }

  const { witness } = await noir.execute({
    nullifier_hash: poseidon1([identities[0].nullifier]).toString(),
    nullifier: identities[0].nullifier.toString(),
    secret: identities[0].secret.toString(),
    root: commitments[0].toString(),
    vote: true,
    depth: 0,
    index: "0",
    siblings: Array(16).fill("0"),
  });
  const proof = await backend.generateProof(witness, { keccak: true });
  if (!(await backend.verifyProof(proof, { keccak: true }))) throw new Error("Single-leaf fixture did not verify.");
  singleLeaf = {
    commitment: commitments[0].toString(),
    proof: `0x${Buffer.from(proof.proof).toString("hex")}`,
    publicInputs: proof.publicInputs,
  };
  console.log(`Verified single-leaf fixture: ${proof.proof.length} proof bytes.`);
} finally {
  await backend.destroy();
}

const destination = path.resolve(circuitsDirectory, "../hardhat/test/fixtures/voting-proofs.json");
await fs.mkdir(path.dirname(destination), { recursive: true });
await fs.writeFile(destination, `${JSON.stringify({ commitments: commitments.map(String), proofs, singleLeaf }, null, 2)}\n`);
console.log(`Saved real proof fixtures to ${destination}`);
