import { formatEther, parseEther, parseGwei } from "viem";
import { artifacts, deployScript } from "../rocketh/deploy.js";

const PROFILE_ADDRESS = "0x94705A9d675daa924F9190Eca4c05ED6B12d5345";

export default deployScript(
  async env => {
    const { deployer } = env.namedAccounts;
    const isLocal = env.network.chain.id === 31337;
    const fees = isLocal ? {} : { maxPriorityFeePerGas: parseGwei("0.001") };

    // Fail before sending any transaction when the fresh deployment cannot be funded.
    if (!isLocal && !env.getOrNull("Lending")) {
      const balance = BigInt(
        (await env.network.provider.request({ method: "eth_getBalance", params: [deployer, "latest"] })) as string,
      );
      if (balance < parseEther("0.005")) {
        throw new Error(
          `Sepolia deployer ${deployer} has ${formatEther(balance)} ETH. Fund it with 0.01 Sepolia ETH before deploying Lending.`,
        );
      }
    }

    const corn = await env.deploy("Corn", { account: deployer, artifact: artifacts.Corn, args: [], ...fees });
    const dex = await env.deploy("CornDEX", {
      account: deployer,
      artifact: artifacts.CornDEX,
      args: [corn.address],
      ...fees,
    });
    const lending = await env.deploy("Lending", {
      account: deployer,
      artifact: artifacts.Lending,
      args: [dex.address, corn.address],
      ...fees,
    });
    const movePrice = await env.deploy("MovePrice", {
      account: deployer,
      artifact: artifacts.MovePrice,
      args: [dex.address, corn.address],
      ...fees,
    });

    for (const [recipient, amount] of [
      [lending.address, parseEther("100000")],
      [PROFILE_ADDRESS, parseEther("1000")],
      [movePrice.address, parseEther("1000")],
    ] as const) {
      const balance = await env.read(corn, { functionName: "balanceOf", args: [recipient] });
      if (balance < amount) {
        await env.execute(corn, {
          functionName: "mintTo",
          args: [recipient, amount - balance],
          account: deployer,
          ...fees,
        });
      }
    }

    if ((await env.read(dex, { functionName: "totalLiquidity" })) === 0n) {
      // currentPrice quotes a full 1 ETH swap, so keep the CORN reserve meaningful even in a small test pool.
      const seedTokens = parseEther(isLocal ? "1000000" : "1000");
      const deployerCorn = await env.read(corn, { functionName: "balanceOf", args: [deployer] });
      if (deployerCorn < seedTokens) {
        await env.execute(corn, {
          functionName: "mintTo",
          args: [deployer, seedTokens - deployerCorn],
          account: deployer,
          ...fees,
        });
      }
      await env.execute(corn, { functionName: "approve", args: [dex.address, seedTokens], account: deployer, ...fees });
      await env.execute(dex, {
        functionName: "init",
        args: [seedTokens],
        value: parseEther(isLocal ? "1000" : "0.0002"),
        account: deployer,
        ...fees,
      });
    }

    const moveBalance = BigInt(
      (await env.network.provider.request({
        method: "eth_getBalance",
        params: [movePrice.address, "latest"],
      })) as string,
    );
    const moveFunding = parseEther(isLocal ? "0.05" : "0.00002");
    if (moveBalance < moveFunding) {
      await env.tx({ account: deployer, to: movePrice.address, value: moveFunding - moveBalance, ...fees });
    }

    if (lending.newlyDeployed) {
      await env.execute(lending, {
        functionName: "addCollateral",
        args: [],
        value: parseEther("0.00002"),
        account: deployer,
        ...fees,
      });
      await env.execute(lending, {
        functionName: "borrowCorn",
        args: [parseEther("0.01")],
        account: deployer,
        ...fees,
      });
    }
  },
  { tags: ["Lending"] },
);
