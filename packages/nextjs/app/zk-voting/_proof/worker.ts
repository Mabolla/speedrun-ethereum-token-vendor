import type { ProofRequest, ProofResponse, PublicInputs } from "./types";
import { UltraHonkBackend } from "@aztec/bb.js";
import { Noir } from "@noir-lang/noir_js";
import { LeanIMT } from "@zk-kit/lean-imt";
import { poseidon1, poseidon2 } from "poseidon-lite";
import { toHex } from "viem";

type WorkerScope = {
  onmessage: ((event: MessageEvent<ProofRequest>) => void) | null;
  postMessage: (message: ProofResponse) => void;
};
const scope = globalThis as unknown as WorkerScope;
const status = (message: string) => scope.postMessage({ type: "status", message });

scope.onmessage = async ({ data }) => {
  let backend: UltraHonkBackend | undefined;
  let phase = "Loading proof tools";
  try {
    status(phase);
    if (data.treeDepth > 16 || data.treeDepth < 0) throw new Error("The circuit supports tree depths up to 16.");
    const tree = new LeanIMT<bigint>((left, right) => poseidon2([left, right]));
    tree.insertMany(data.leaves.map(leaf => BigInt(leaf)));
    if (tree.root !== BigInt(data.root) || tree.depth !== data.treeDepth) {
      throw new Error("The registered voter tree changed. Refresh the voter data and generate again.");
    }
    const commitment = poseidon2([BigInt(data.identity.nullifier), BigInt(data.identity.secret)]);
    if (commitment !== BigInt(data.identity.commitment)) throw new Error("The saved registration backup is invalid.");
    const leafIndex = tree.indexOf(commitment);
    if (leafIndex < 0) throw new Error("This registration commitment is not in the on-chain voter tree.");
    const merkleProof = tree.generateProof(leafIndex);
    if (merkleProof.siblings.length > 16) throw new Error("The voter tree is too deep for this circuit.");
    const siblings = [...merkleProof.siblings];
    while (siblings.length < 16) siblings.push(0n);
    const nullifierHash = poseidon1([BigInt(data.identity.nullifier)]);
    const expectedInputs: PublicInputs = [
      toHex(nullifierHash, { size: 32 }),
      toHex(tree.root, { size: 32 }),
      toHex(data.vote ? 1n : 0n, { size: 32 }),
      toHex(BigInt(data.treeDepth), { size: 32 }),
    ];

    const response = await fetch(data.circuitUrl);
    if (!response.ok) throw new Error("The compiled voting circuit could not be downloaded.");
    const circuit = await response.json();
    phase = "Computing the private witness";
    status(phase);
    const noir = new Noir(circuit);
    const { witness } = await noir.execute({
      nullifier_hash: expectedInputs[0],
      root: expectedInputs[1],
      vote: data.vote,
      depth: data.treeDepth,
      nullifier: data.identity.nullifier,
      secret: data.identity.secret,
      index: merkleProof.index.toString(),
      siblings: siblings.map(value => toHex(value, { size: 32 })),
    });

    phase = "Generating the zero-knowledge proof";
    status(phase);
    backend = new UltraHonkBackend(circuit.bytecode, { threads: 1, logger: () => {} });
    const generated = await backend.generateProof(witness, { keccak: true });
    if (
      generated.publicInputs.length !== 4 ||
      generated.publicInputs.some((input, index) => BigInt(input) !== BigInt(expectedInputs[index]))
    ) {
      throw new Error("The generated proof has unexpected public inputs.");
    }
    phase = "Verifying the generated proof locally";
    status(phase);
    if (!(await backend.verifyProof(generated, { keccak: true }))) throw new Error("Local proof verification failed.");
    scope.postMessage({
      type: "result",
      result: {
        proof: toHex(generated.proof),
        publicInputs: expectedInputs,
        vote: data.vote,
        commitment: data.identity.commitment,
      },
    });
  } catch (error) {
    // Never forward witness values or private inputs from a proving-library error.
    const publicErrors = [
      "The circuit supports tree depths up to 16.",
      "The registered voter tree changed. Refresh the voter data and generate again.",
      "The saved registration backup is invalid.",
      "This registration commitment is not in the on-chain voter tree.",
      "The voter tree is too deep for this circuit.",
      "The compiled voting circuit could not be downloaded.",
      "The generated proof has unexpected public inputs.",
      "Local proof verification failed.",
    ];
    const message =
      error instanceof Error && publicErrors.includes(error.message)
        ? error.message
        : `${phase} failed. Check the connection, then retry. Your private inputs stayed in this browser.`;
    scope.postMessage({ type: "error", message });
  } finally {
    await backend?.destroy();
  }
};
