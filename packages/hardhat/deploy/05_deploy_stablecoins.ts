import { getContractAddress, parseEther, parseGwei } from "viem";
import { artifacts, deployScript } from "../rocketh/deploy.js";
import { fetchPriceFromUniswap } from "../scripts/fetchPriceFromUniswap.js";

const PROFILE_ADDRESS = "0x94705A9d675daa924F9190Eca4c05ED6B12d5345";
const DEPLOY_ORDER = ["RateController", "MyUSD", "StableDEX", "Oracle", "MyUSDStaking", "MyUSDEngine"];

export default deployScript(
  async env => {
    const { deployer } = env.namedAccounts;
    const isLocal = env.network.chain.id === 31337;
    const fees = isLocal ? {} : { maxPriorityFeePerGas: parseGwei("0.001") };
    const deployed = DEPLOY_ORDER.map(name => env.getOrNull(name));
    const deployedCount = deployed.filter(Boolean).length;
    if (deployed.some((record, index) => Boolean(record) !== index < deployedCount)) {
      throw new Error("Stablecoin deployment records must follow the original constructor order.");
    }

    if (!isLocal && deployedCount === 0) {
      const balance = BigInt(
        (await env.network.provider.request({ method: "eth_getBalance", params: [deployer, "latest"] })) as string,
      );
      if (balance < parseEther("0.03")) throw new Error("Stablecoin deployment needs at least 0.03 Sepolia ETH.");
    }

    const nonce = BigInt(
      (await env.network.provider.request({
        method: "eth_getTransactionCount",
        params: [deployer, "pending"],
      })) as string,
    );
    const futureStakingAddress =
      deployed[4]?.address ?? getContractAddress({ from: deployer, nonce: nonce + BigInt(4 - deployedCount) });
    const futureEngineAddress =
      deployed[5]?.address ?? getContractAddress({ from: deployer, nonce: nonce + BigInt(5 - deployedCount) });
    const ethPrice = deployed[3]
      ? ((await env.read(deployed[3], { functionName: "getETHUSDPrice" })) as bigint)
      : await fetchPriceFromUniswap();

    const rateController = await env.deploy("RateController", {
      account: deployer,
      artifact: artifacts.RateController,
      args: [futureEngineAddress, futureStakingAddress],
      ...fees,
    });
    const stablecoin = await env.deploy("MyUSD", {
      account: deployer,
      artifact: artifacts.MyUSD,
      args: [futureEngineAddress, futureStakingAddress],
      ...fees,
    });
    const dex = await env.deploy("StableDEX", {
      account: deployer,
      artifact: artifacts.contracts_stablecoins_DEX_sol_DEX,
      args: [stablecoin.address],
      ...fees,
    });
    const oracle = await env.deploy("Oracle", {
      account: deployer,
      artifact: artifacts.Oracle,
      args: [dex.address, ethPrice],
      ...fees,
    });
    const staking = await env.deploy("MyUSDStaking", {
      account: deployer,
      artifact: artifacts.MyUSDStaking,
      args: [stablecoin.address, futureEngineAddress, rateController.address],
      ...fees,
    });
    const engine = await env.deploy("MyUSDEngine", {
      account: deployer,
      artifact: artifacts.MyUSDEngine,
      args: [oracle.address, stablecoin.address, staking.address, rateController.address],
      ...fees,
    });
    if (
      engine.address.toLowerCase() !== futureEngineAddress.toLowerCase() ||
      staking.address.toLowerCase() !== futureStakingAddress.toLowerCase()
    ) {
      throw new Error("Stablecoin constructor address predictions did not match actual deployments.");
    }

    const collateralTarget = parseEther(isLocal ? "5000" : "0.01");
    const currentCollateral = await env.read(engine, { functionName: "s_userCollateral", args: [deployer] });
    if (currentCollateral < collateralTarget) {
      await env.execute(engine, {
        functionName: "addCollateral",
        args: [],
        value: collateralTarget - currentCollateral,
        account: deployer,
        ...fees,
      });
    }

    const seedTokens = ethPrice * 1000n;
    if ((await env.read(engine, { functionName: "s_userDebtShares", args: [deployer] })) === 0n) {
      await env.execute(engine, {
        functionName: "mintMyUSD",
        args: [isLocal ? seedTokens + parseEther("4") : parseEther("10")],
        account: deployer,
        ...fees,
      });
    }

    // The official challenge initializes the DEX only on a local network.
    // On Sepolia the oracle uses its fixed reference price until liquidity exists.
    if (isLocal && (await env.read(dex, { functionName: "totalLiquidity" })) === 0n) {
      await env.execute(stablecoin, {
        functionName: "approve",
        args: [dex.address, seedTokens],
        account: deployer,
      });
      await env.execute(dex, {
        functionName: "init",
        args: [seedTokens],
        value: parseEther("1000"),
        account: deployer,
      });
    }

    const profileBalance = await env.read(stablecoin, { functionName: "balanceOf", args: [PROFILE_ADDRESS] });
    if (profileBalance < parseEther("2")) {
      await env.execute(stablecoin, {
        functionName: "transfer",
        args: [PROFILE_ADDRESS, parseEther("2") - profileBalance],
        account: deployer,
        ...fees,
      });
    }
    if ((await env.read(staking, { functionName: "userShares", args: [deployer] })) === 0n) {
      await env.execute(stablecoin, {
        functionName: "approve",
        args: [staking.address, parseEther("2")],
        account: deployer,
        ...fees,
      });
      await env.execute(staking, { functionName: "stake", args: [parseEther("2")], account: deployer, ...fees });
    }
  },
  { tags: ["Stablecoins"] },
);
