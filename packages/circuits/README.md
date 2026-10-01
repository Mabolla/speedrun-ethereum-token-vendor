# Voting circuit

This Noir circuit proves knowledge of a registered commitment without exposing the commitment's index, nullifier, or secret. Its public inputs are `[nullifier_hash, root, vote, depth]`. The membership path uses the compressed index and siblings returned by `LeanIMT.generateProof`; pad the sibling array to 16 fields with zeroes.

The checked-in `../nextjs/public/circuits.json` and `../hardhat/contracts/Verifier.sol` were generated together with Noir **1.0.0-beta.3** and Barretenberg **0.82.2**. The verifier uses Keccak UltraHonk and has four public inputs. Browser proof generation uses the official challenge's compatible `@noir-lang/noir_js` **1.0.0-beta.3** and `@aztec/bb.js` **0.82.0**.

From this directory, regenerate both artifacts after changing the circuit:

```sh
nargo compile
bb write_vk --oracle_hash keccak -b ./target/circuits.json -o ./target/
bb write_solidity_verifier -k ./target/vk -o ./target/Verifier.sol
cp ./target/Verifier.sol ../hardhat/contracts/Verifier.sol
cp ./target/circuits.json ../nextjs/public/circuits.json
node scripts/generate-proof-fixtures.mjs
```

The fixture script executes Noir and generates and verifies genuine yes/no proofs against a two-leaf tree and a proof for the first voter in a single-leaf tree. The Solidity integration suite then verifies the same proofs using `HonkVerifier` and tests vote binding, nullifier reuse, malformed proofs, and stale roots. Its fixtures use fixed demonstration identities, never a user's credentials.

Onchain voting accepts the current tree root. A registration changes that root, so regenerate a proof if someone registers after proof generation. The circuit supports a maximum tree depth of 16.
