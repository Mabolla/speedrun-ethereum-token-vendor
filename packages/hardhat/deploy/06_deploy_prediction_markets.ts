import { encodeAbiParameters, parseEther, parseGwei } from "viem";
import { artifacts, deployScript } from "../rocketh/deploy.js";

const PROFILE_ADDRESS = "0x94705A9d675daa924F9190Eca4c05ED6B12d5345";

export default deployScript(
  async env => {
    const { deployer } = env.namedAccounts;
    const isLocal = env.network.chain.id === 31337;
    const fees = isLocal ? {} : { maxPriorityFeePerGas: parseGwei("0.001") };
    const initialLiquidity = parseEther(isLocal ? "1" : "0.01");
    const initialTokenValue = parseEther(isLocal ? "0.01" : "0.0001");
    const oracle = isLocal ? deployer : PROFILE_ADDRESS;

    if (!isLocal && !env.getOrNull("PredictionMarket")) {
      const balance = BigInt(
        (await env.network.provider.request({ method: "eth_getBalance", params: [deployer, "latest"] })) as string,
      );
      if (balance < initialLiquidity + parseEther("0.005")) {
        throw new Error("Prediction market deployment needs at least 0.015 Sepolia ETH for liquidity and gas.");
      }
    }

    const market = await env.deploy("PredictionMarket", {
      account: deployer,
      artifact: artifacts.PredictionMarket,
      args: [deployer, oracle, "Will the green car win the race?", initialTokenValue, 50, 10],
      value: initialLiquidity,
      ...fees,
    });

    // Both outcome tokens are created inside the market constructor. Save their
    // real addresses and full artifacts without submitting additional transactions.
    const supply = (initialLiquidity * 10n ** 18n) / initialTokenValue;
    for (const [recordName, getter, tokenName, symbol] of [
      ["PredictionMarketTokenYes", "i_yesToken", "Yes", "Y"],
      ["PredictionMarketTokenNo", "i_noToken", "No", "N"],
    ] as const) {
      const address = await env.read(market, { functionName: getter });
      const previous = env.getOrNull(recordName);
      if (
        previous?.address.toLowerCase() === address.toLowerCase() &&
        previous.bytecode === artifacts.PredictionMarketToken.bytecode &&
        previous.metadata === artifacts.PredictionMarketToken.metadata
      )
        continue;
      await env.save(recordName, {
        ...artifacts.PredictionMarketToken,
        address,
        argsData: encodeAbiParameters(
          [{ type: "string" }, { type: "string" }, { type: "address" }, { type: "uint256" }],
          [tokenName, symbol, deployer, supply],
        ),
      });
    }
  },
  { tags: ["PredictionMarkets"] },
);
