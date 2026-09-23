import { artifacts, deployScript } from "../rocketh/deploy.js";

export default deployScript(
  async env => {
    const diceGame = env.get("DiceGame");
    const diceGameAddress = diceGame.address;

    const riggedRoll = await env.deploy("RiggedRoll", {
      account: env.namedAccounts.deployer,
      artifact: artifacts.RiggedRoll,
      args: [diceGameAddress],
    });

    await env.execute(riggedRoll, {
      functionName: "transferOwnership",
      args: ["0x94705A9d675daa924F9190Eca4c05ED6B12d5345"],
      account: env.namedAccounts.deployer,
    });
  },
  { tags: ["RiggedRoll"] },
);
