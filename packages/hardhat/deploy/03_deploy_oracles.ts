import { parseEther } from "viem";
import { artifacts, deployScript } from "../rocketh/deploy.js";

const PROFILE_ADDRESS = "0x94705A9d675daa924F9190Eca4c05ED6B12d5345";

// Keep this challenge isolated from the previously submitted deployments.
export default deployScript(
  async ({ deploy, execute, read, namedAccounts, network }) => {
    const { deployer } = namedAccounts;
    const whitelist = await deploy("WhitelistOracle", {
      account: deployer,
      artifact: artifacts.WhitelistOracle,
      args: [],
    });

    for (let i = 0; i < 3; i++) {
      let simpleAddress: `0x${string}`;
      try {
        simpleAddress = await read(whitelist, { functionName: "oracles", args: [BigInt(i)] });
      } catch {
        await execute(whitelist, { functionName: "addOracle", args: [PROFILE_ADDRESS], account: deployer });
        simpleAddress = await read(whitelist, { functionName: "oracles", args: [BigInt(i)] });
        // Example values, not a live ETH price feed. Reports become stale after 24 seconds.
        await execute(
          { address: simpleAddress, abi: artifacts.SimpleOracle.abi },
          { functionName: "setPrice", args: [BigInt(3000 + i)], account: deployer },
        );
      }
    }

    const ora = await deploy("ORA", { account: deployer, artifact: artifacts.ORA, args: [] });
    const staking = await deploy("StakingOracle", {
      account: deployer,
      artifact: artifacts.StakingOracle,
      args: [ora.address],
    });
    const tokenOwner = await read(ora, { functionName: "owner" });
    if (tokenOwner.toLowerCase() !== staking.address.toLowerCase()) {
      const profileBalance = await read(ora, { functionName: "balanceOf", args: [PROFILE_ADDRESS] });
      if (profileBalance < parseEther("500")) {
        await execute(ora, {
          functionName: "transfer",
          args: [PROFILE_ADDRESS, parseEther("500") - profileBalance],
          account: deployer,
        });
      }
      await execute(ora, { functionName: "transferOwnership", args: [staking.address], account: deployer });
    }

    // Explicit wiring is also safe when a deployment is resumed after an interrupted transaction.
    const optimistic = await deploy("OptimisticOracle", {
      account: deployer,
      artifact: artifacts.OptimisticOracle,
      args: [deployer],
    });
    const decider = await deploy("Decider", {
      account: deployer,
      artifact: artifacts.Decider,
      args: [optimistic.address],
    });
    const currentDecider = await read(optimistic, { functionName: "decider" });
    if (currentDecider.toLowerCase() !== decider.address.toLowerCase()) {
      await execute(optimistic, { functionName: "setDecider", args: [decider.address], account: deployer });
    }

    if ((await read(optimistic, { functionName: "nextAssertionId" })) === 1n) {
      const latestBlock = (await network.provider.request({
        method: "eth_getBlockByNumber",
        params: ["latest", false],
      })) as { timestamp: `0x${string}` };
      await execute(optimistic, {
        functionName: "assertEvent",
        args: [
          "Did this Sepolia demo deploy an OptimisticOracle contract? Check the verified contract source.",
          0n,
          BigInt(latestBlock.timestamp) + 86400n,
        ],
        value: parseEther("0.00001"),
        account: deployer,
      });
    }
  },
  { tags: ["Oracles"] },
);
