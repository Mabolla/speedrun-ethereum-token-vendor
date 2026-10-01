import { parseEther } from "viem";
import { artifacts, deployScript } from "../rocketh/deploy.js";

const PROFILE_ADDRESS = "0x94705A9d675daa924F9190Eca4c05ED6B12d5345";

// Run with --tags DEX to deploy only this challenge.
export default deployScript(
  async ({ deploy, execute, read, namedAccounts, network }) => {
    const { deployer } = namedAccounts;
    const balloons = await deploy("Balloons", { account: deployer, artifact: artifacts.Balloons, args: [] });
    const dex = await deploy("DEX", {
      account: deployer,
      artifact: artifacts.contracts_DEX_sol_DEX,
      args: [balloons.address],
    });

    if ((await read(dex, { functionName: "totalLiquidity" })) === 0n) {
      const isLocal = network.chain.id === 31337;
      const seedEth = parseEther(isLocal ? "5" : "0.001");
      const seedTokens = parseEther("5");
      await execute(balloons, { functionName: "approve", args: [dex.address, seedTokens], account: deployer });
      await execute(dex, { functionName: "init", args: [seedTokens], value: seedEth, account: deployer });
      await execute(balloons, {
        functionName: "transfer",
        args: [PROFILE_ADDRESS, parseEther("10")],
        account: deployer,
      });
    }
  },
  { tags: ["DEX"] },
);
