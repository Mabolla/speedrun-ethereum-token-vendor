import { parseEther, parseGwei } from "viem";
import { artifacts, deployScript } from "../rocketh/deploy.js";

const PROFILE_ADDRESS = "0x94705A9d675daa924F9190Eca4c05ED6B12d5345";

export default deployScript(
  async env => {
    const { deployer } = env.namedAccounts;
    const isLocal = env.network.chain.id === 31337;
    const fees = isLocal ? {} : { maxPriorityFeePerGas: parseGwei("0.001") };
    const previous = env.getOrNull("WrappedETH");
    const wrappedETH = await env.deploy("WrappedETH", {
      account: deployer,
      artifact: artifacts.WrappedETH,
      args: [],
      ...fees,
    });

    // Give the builder a small, fully ETH-backed balance on the first deployment.
    // Existing deployments keep the balances resulting from subsequent use.
    if (!isLocal && !previous) {
      const amount = parseEther("0.001");
      await env.execute(wrappedETH, { account: deployer, functionName: "deposit", value: amount, ...fees });
      await env.execute(wrappedETH, {
        account: deployer,
        functionName: "transfer",
        args: [PROFILE_ADDRESS, amount],
        ...fees,
      });
    }
  },
  { tags: ["WrappedETH"] },
);
