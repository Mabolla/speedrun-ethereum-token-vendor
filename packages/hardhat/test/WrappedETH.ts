import { expect } from "chai";
import { network } from "hardhat";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import type { WrappedETH } from "../types/ethers-contracts/index.js";

// The 20 assertions from the official token-wrapper-weth Foundry challenge,
// adapted to this repository's Hardhat 3 test runner and account gas accounting.
describe("ETH Tech Tree: WrappedETH", function () {
  let ethers: Awaited<ReturnType<typeof network.create>>["ethers"];
  let weth: WrappedETH;
  let owner: HardhatEthersSigner;
  let user: HardhatEthersSigner;
  const ONE_ETH = 10n ** 18n;

  beforeEach(async function () {
    ({ ethers } = await network.create());
    [owner, user] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("contracts/WrappedETH.sol:WrappedETH");
    weth = (await factory.deploy()) as unknown as WrappedETH;
    await weth.waitForDeployment();
  });

  it("testDeposit", async function () {
    await weth.deposit({ value: ONE_ETH });
    expect(await weth.balanceOf(owner.address)).to.equal(ONE_ETH);
  });

  it("testFallback", async function () {
    await owner.sendTransaction({ to: await weth.getAddress(), value: ONE_ETH });
    expect(await weth.balanceOf(owner.address)).to.equal(ONE_ETH);
  });

  it("testWithdraw", async function () {
    await weth.deposit({ value: ONE_ETH });
    await expect(weth.withdraw(ONE_ETH)).to.changeEtherBalances(ethers, [owner, weth], [ONE_ETH, -ONE_ETH]);
    expect(await weth.balanceOf(owner.address)).to.equal(0n);
    expect(await ethers.provider.getBalance(await weth.getAddress())).to.equal(0n);
  });

  it("testWithdrawInsufficientBalance", async function () {
    await weth.deposit({ value: ONE_ETH });
    await expect(weth.withdraw(ONE_ETH + 1n)).to.be.revertedWithCustomError(weth, "ERC20InsufficientBalance");
    expect(await weth.balanceOf(owner.address)).to.equal(ONE_ETH);
    expect(await ethers.provider.getBalance(await weth.getAddress())).to.equal(ONE_ETH);
  });

  it("testWithdrawFailedToSendEther", async function () {
    const rejectingRecipient = "0x0000000000000000000000000000000000003003";
    await ethers.provider.send("hardhat_setCode", [rejectingRecipient, "0x60006000fd"]);
    await ethers.provider.send("hardhat_setBalance", [rejectingRecipient, ethers.toBeHex(2n * ONE_ETH)]);
    const contractSender = await ethers.getImpersonatedSigner(rejectingRecipient);
    await weth.connect(contractSender).deposit({ value: ONE_ETH });
    await expect(weth.connect(contractSender).withdraw(ONE_ETH)).to.be.revertedWithCustomError(
      weth,
      "WithdrawalTransferFailed",
    );
    expect(await weth.balanceOf(rejectingRecipient)).to.equal(ONE_ETH);
    expect(await ethers.provider.getBalance(await weth.getAddress())).to.equal(ONE_ETH);
    expect(await weth.totalSupply()).to.equal(ONE_ETH);
  });

  it("testTotalSupply", async function () {
    await weth.deposit({ value: ONE_ETH });
    expect(await weth.totalSupply()).to.equal(ONE_ETH);
  });

  it("testApprove", async function () {
    await weth.approve(user.address, ONE_ETH);
    expect(await weth.allowance(owner.address, user.address)).to.equal(ONE_ETH);
  });

  it("testTransfer", async function () {
    await weth.deposit({ value: ONE_ETH });
    await weth.transfer(user.address, ONE_ETH);
    expect(await weth.balanceOf(owner.address)).to.equal(0n);
    expect(await weth.balanceOf(user.address)).to.equal(ONE_ETH);
  });

  it("testTransferWithInsufficientBalance", async function () {
    await weth.deposit({ value: 999n });
    await expect(weth.transfer(user.address, ONE_ETH)).to.be.revertedWithCustomError(weth, "ERC20InsufficientBalance");
    expect(await weth.balanceOf(owner.address)).to.equal(999n);
    expect(await weth.balanceOf(user.address)).to.equal(0n);
  });

  it("testTransferFrom", async function () {
    await weth.deposit({ value: ONE_ETH });
    await weth.approve(user.address, ONE_ETH);
    await weth.connect(user).transferFrom(owner.address, user.address, ONE_ETH);
    expect(await weth.balanceOf(owner.address)).to.equal(0n);
    expect(await weth.balanceOf(user.address)).to.equal(ONE_ETH);
  });

  it("testTransferFromAllowanceIsAdjusted", async function () {
    await weth.deposit({ value: ONE_ETH });
    await weth.approve(user.address, ONE_ETH);
    await weth.connect(user).transferFrom(owner.address, user.address, ONE_ETH);
    expect(await weth.allowance(owner.address, user.address)).to.equal(0n);
  });

  it("testTransferFromWithoutAllowance", async function () {
    await weth.deposit({ value: ONE_ETH });
    await expect(weth.connect(user).transferFrom(owner.address, user.address, ONE_ETH)).to.be.revertedWithCustomError(
      weth,
      "ERC20InsufficientAllowance",
    );
    expect(await weth.balanceOf(owner.address)).to.equal(ONE_ETH);
    expect(await weth.balanceOf(user.address)).to.equal(0n);
  });

  it("testTransferFromWithInsufficientAllowance", async function () {
    await weth.deposit({ value: ONE_ETH });
    await weth.approve(user.address, 500n);
    await expect(weth.connect(user).transferFrom(owner.address, user.address, ONE_ETH)).to.be.revertedWithCustomError(
      weth,
      "ERC20InsufficientAllowance",
    );
    expect(await weth.balanceOf(owner.address)).to.equal(ONE_ETH);
    expect(await weth.balanceOf(user.address)).to.equal(0n);
  });

  it("testTransferFromWithInsufficientBalance", async function () {
    await weth.deposit({ value: 500n });
    await weth.approve(user.address, ONE_ETH);
    await expect(weth.connect(user).transferFrom(owner.address, user.address, ONE_ETH)).to.be.revertedWithCustomError(
      weth,
      "ERC20InsufficientBalance",
    );
    expect(await weth.balanceOf(owner.address)).to.equal(500n);
    expect(await weth.balanceOf(user.address)).to.equal(0n);
  });

  it("testTransferFromWithMaxAllowance", async function () {
    await weth.deposit({ value: ONE_ETH });
    await weth.approve(user.address, ethers.MaxUint256);
    await weth.connect(user).transferFrom(owner.address, user.address, ONE_ETH);
    expect(await weth.balanceOf(owner.address)).to.equal(0n);
    expect(await weth.balanceOf(user.address)).to.equal(ONE_ETH);
    expect(await weth.allowance(owner.address, user.address)).to.equal(ethers.MaxUint256);
  });

  it("testEmitDepositEvent", async function () {
    await expect(weth.deposit({ value: ONE_ETH }))
      .to.emit(weth, "Deposit")
      .withArgs(owner.address, ONE_ETH);
  });

  it("testEmitWithdrawalEvent", async function () {
    await weth.deposit({ value: ONE_ETH });
    await expect(weth.withdraw(ONE_ETH)).to.emit(weth, "Withdrawal").withArgs(owner.address, ONE_ETH);
  });

  it("testEmitTransferEvent", async function () {
    await weth.deposit({ value: ONE_ETH });
    await expect(weth.transfer(user.address, ONE_ETH))
      .to.emit(weth, "Transfer")
      .withArgs(owner.address, user.address, ONE_ETH);
  });

  it("testEmitApprovalEvent", async function () {
    await expect(weth.approve(user.address, ONE_ETH))
      .to.emit(weth, "Approval")
      .withArgs(owner.address, user.address, ONE_ETH);
  });

  it("testEmitTransferEventOnTransferFrom", async function () {
    await weth.deposit({ value: ONE_ETH });
    await weth.approve(user.address, ONE_ETH);
    await expect(weth.connect(user).transferFrom(owner.address, user.address, ONE_ETH))
      .to.emit(weth, "Transfer")
      .withArgs(owner.address, user.address, ONE_ETH);
  });

  it("Credits direct ETH sent with nonempty calldata", async function () {
    await owner.sendTransaction({ to: await weth.getAddress(), value: ONE_ETH, data: "0x12345678" });
    expect(await weth.balanceOf(owner.address)).to.equal(ONE_ETH);
    expect(await weth.totalSupply()).to.equal(ONE_ETH);
    expect(await ethers.provider.getBalance(await weth.getAddress())).to.equal(ONE_ETH);
  });
});
