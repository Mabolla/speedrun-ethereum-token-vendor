import fs from "node:fs";
import { expect } from "chai";
import { network } from "hardhat";

const fixtures = JSON.parse(fs.readFileSync(new URL("./fixtures/voting-proofs.json", import.meta.url), "utf8")) as {
  commitments: string[];
  proofs: { proof: string; publicInputs: string[] }[];
  singleLeaf: { commitment: string; proof: string; publicInputs: string[] };
};

describe("Voting with real Noir/UltraHonk proofs", function () {
  let ethers: Awaited<ReturnType<typeof network.create>>["ethers"];
  before(async function () {
    ({ ethers } = await network.create());
    await ethers.provider.send("evm_setAutomine", [true]);
    await ethers.provider.send("evm_setIntervalMining", [0]);
  });

  async function deployVoting(singleLeaf = false) {
    const [owner, alice, bob, relayer] = await ethers.getSigners();
    const poseidon = await (await ethers.getContractFactory("PoseidonT3")).deploy();
    const leanIMT = await (
      await ethers.getContractFactory("LeanIMT", { libraries: { PoseidonT3: await poseidon.getAddress() } })
    ).deploy();
    const verifier = await (await ethers.getContractFactory("HonkVerifier")).deploy();
    const voting = await (
      await ethers.getContractFactory("contracts/Voting.sol:Voting", {
        libraries: { LeanIMT: await leanIMT.getAddress() },
      })
    ).deploy(owner.address, await verifier.getAddress(), "Proof integration test");
    await voting.addVoters([alice.address, bob.address], [true, true]);
    await voting.connect(alice).register(BigInt(fixtures.commitments[0]));
    if (!singleLeaf) await voting.connect(bob).register(BigInt(fixtures.commitments[1]));
    return { owner, alice, bob, relayer, verifier, voting };
  }

  it("lets the first registered voter generate and cast a real depth-zero proof", async function () {
    const { verifier, voting, relayer } = await deployVoting(true);
    const fixture = fixtures.singleLeaf;
    expect(await verifier.verify(fixture.proof, fixture.publicInputs)).to.equal(true);
    const [nullifier, root, vote, depth] = fixture.publicInputs;
    await voting.connect(relayer).vote(fixture.proof, nullifier, root, vote, depth);
    const data = await voting.getVotingData();
    expect(data.depth).to.equal(0n);
    expect(data.yesVotes).to.equal(1n);
  });

  it("verifies actual yes/no proofs and counts anonymous submissions once", async function () {
    const { verifier, voting, relayer } = await deployVoting();
    for (const fixture of fixtures.proofs) {
      expect(await verifier.verify(fixture.proof, fixture.publicInputs)).to.equal(true);
      const [nullifier, root, vote, depth] = fixture.publicInputs;
      await expect(voting.connect(relayer).vote(fixture.proof, nullifier, root, vote, depth)).to.emit(
        voting,
        "VoteCast",
      );
    }
    const data = await voting.getVotingData();
    expect(data.yesVotes).to.equal(1n);
    expect(data.noVotes).to.equal(1n);
    const fixture = fixtures.proofs[0];
    const [nullifier, root, vote, depth] = fixture.publicInputs;
    await expect(voting.connect(relayer).vote(fixture.proof, nullifier, root, vote, depth))
      .to.be.revertedWithCustomError(voting, "Voting__NullifierHashAlreadyUsed")
      .withArgs(nullifier);
  });

  it("rejects a changed vote or malformed proof without counting a vote", async function () {
    const { voting, relayer } = await deployVoting();
    const fixture = fixtures.proofs[0];
    const [nullifier, root, , depth] = fixture.publicInputs;
    await expect(
      voting.connect(relayer).vote(fixture.proof, nullifier, root, ethers.ZeroHash, depth),
    ).to.be.revertedWithCustomError(voting, "Voting__InvalidProof");
    await expect(
      voting.connect(relayer).vote("0x1234", nullifier, root, ethers.toBeHex(1, 32), depth),
    ).to.be.revertedWithCustomError(voting, "Voting__InvalidProof");
    const data = await voting.getVotingData();
    expect(data.yesVotes).to.equal(0n);
    expect(data.noVotes).to.equal(0n);
  });

  it("requires a fresh proof after another voter changes the current tree root", async function () {
    const { voting, owner, relayer } = await deployVoting();
    await voting.addVoters([owner.address], [true]);
    await voting.register(999n);
    const fixture = fixtures.proofs[0];
    const [nullifier, root, vote, depth] = fixture.publicInputs;
    await expect(
      voting.connect(relayer).vote(fixture.proof, nullifier, root, vote, depth),
    ).to.be.revertedWithCustomError(voting, "Voting__InvalidRoot");
  });
});
