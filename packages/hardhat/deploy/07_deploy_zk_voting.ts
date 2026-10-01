import { parseEther, parseGwei } from "viem";
import { artifacts, deployScript } from "../rocketh/deploy.js";

const PROFILE_ADDRESS = "0x94705A9d675daa924F9190Eca4c05ED6B12d5345";

export default deployScript(
  async env => {
    const { deployer } = env.namedAccounts;
    const isLocal = env.network.chain.id === 31337;
    const fees = isLocal ? {} : { maxPriorityFeePerGas: parseGwei("0.001") };

    if (!isLocal && !env.getOrNull("Voting")) {
      const balance = BigInt(
        (await env.network.provider.request({ method: "eth_getBalance", params: [deployer, "latest"] })) as string,
      );
      if (balance < parseEther("0.01")) throw new Error("ZK Voting deployment needs at least 0.01 Sepolia ETH.");
    }

    const poseidon = await env.deploy("PoseidonT3", {
      account: deployer,
      artifact: artifacts.PoseidonT3,
      args: [],
      ...fees,
    });
    const leanIMT = await env.deploy(
      "LeanIMT",
      { account: deployer, artifact: artifacts.LeanIMT, args: [], ...fees },
      { libraries: { PoseidonT3: poseidon.address } },
    );
    const verifier = await env.deploy("HonkVerifier", {
      account: deployer,
      artifact: artifacts.HonkVerifier,
      args: [],
      ...fees,
    });
    const voting = await env.deploy(
      "Voting",
      {
        account: deployer,
        artifact: artifacts.Voting,
        args: [deployer, verifier.address, "Should we build more apps that protect voter privacy?"],
        ...fees,
      },
      { libraries: { LeanIMT: leanIMT.address } },
    );

    // Configure the allowlist before handing ownership to the builder's wallet.
    // A repeat deployment preserves the builder's subsequent allowlist decisions.
    const currentOwner = await env.read(voting, { functionName: "owner" });
    if (currentOwner.toLowerCase() === deployer.toLowerCase()) {
      const [allowed] = await env.read(voting, { functionName: "getVoterData", args: [PROFILE_ADDRESS] });
      if (!allowed) {
        await env.execute(voting, {
          account: deployer,
          functionName: "addVoters",
          args: [[PROFILE_ADDRESS], [true]],
          ...fees,
        });
      }
      if (!isLocal) {
        await env.execute(voting, {
          account: deployer,
          functionName: "transferOwnership",
          args: [PROFILE_ADDRESS],
          ...fees,
        });
      }
    }
  },
  { tags: ["ZKVoting"] },
);
