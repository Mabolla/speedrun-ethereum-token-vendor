import { network } from "hardhat";
import { expect } from "chai";

describe("DEX boundary cases", function () {
  async function fixture(initialize = true) {
    const { ethers } = await network.create();
    const [owner, user] = await ethers.getSigners();
    const token = await ethers.deployContract("Balloons");
    const dex = await ethers.deployContract("DEX", [await token.getAddress()]);
    const address = await dex.getAddress();
    if (initialize) {
      await token.approve(address, ethers.parseEther("5"));
      await dex.init(ethers.parseEther("5"), { value: ethers.parseEther("5") });
      await token.transfer(user.address, ethers.parseEther("10"));
    }
    return { ethers, owner, user, token, dex, address };
  }

  it("rejects initialization with an empty ETH or token reserve", async function () {
    const { ethers, token, dex, address } = await fixture(false);
    await token.approve(address, ethers.parseEther("5"));
    await expect(dex.init(ethers.parseEther("5"))).to.be.revertedWithCustomError(dex, "InvalidEthAmount");
    await expect(dex.init(0, { value: ethers.parseEther("1") })).to.be.revertedWithCustomError(
      dex,
      "InvalidTokenAmount",
    );
    expect(await dex.totalLiquidity()).to.equal(0n);
  });

  it("rejects swaps and deposits before initialization", async function () {
    const { dex } = await fixture(false);
    await expect(dex.ethToToken({ value: 1n })).to.be.revertedWithCustomError(dex, "PoolNotInitialized");
    await expect(dex.tokenToEth(1n)).to.be.revertedWithCustomError(dex, "PoolNotInitialized");
    await expect(dex.deposit({ value: 1n })).to.be.revertedWithCustomError(dex, "PoolNotInitialized");
  });

  it("reports the exact missing token allowance and leaves reserves unchanged", async function () {
    const { ethers, user, token, dex, address } = await fixture();
    const input = ethers.parseEther("1");
    const before = await token.balanceOf(address);
    await expect(dex.connect(user).tokenToEth(input))
      .to.be.revertedWithCustomError(dex, "InsufficientTokenAllowance")
      .withArgs(0n, input);
    expect(await token.balanceOf(address)).to.equal(before);
    expect(await ethers.provider.getBalance(address)).to.equal(ethers.parseEther("5"));
  });

  it("rounds deposits up by one token wei and returns only the caller's share", async function () {
    const { ethers, owner, user, token, dex, address } = await fixture();
    await token.connect(user).approve(address, ethers.parseEther("2"));
    const before = await token.balanceOf(user.address);
    await dex.connect(user).deposit({ value: ethers.parseEther("1") });
    expect(before - (await token.balanceOf(user.address))).to.equal(ethers.parseEther("1") + 1n);
    await dex.connect(user).withdraw(ethers.parseEther("1"));
    expect(await dex.getLiquidity(user.address)).to.equal(0n);
    expect(await dex.getLiquidity(owner.address)).to.equal(ethers.parseEther("5"));
    expect(await ethers.provider.getBalance(address)).to.equal(ethers.parseEther("5"));
  });

  it("keeps the pool initialized after its entire liquidity is withdrawn", async function () {
    const { ethers, token, dex, address } = await fixture();
    await dex.withdraw(ethers.parseEther("5"));
    expect(await ethers.provider.getBalance(address)).to.equal(0n);
    expect(await token.balanceOf(address)).to.equal(0n);
    await token.approve(address, ethers.parseEther("5"));
    await expect(dex.init(ethers.parseEther("5"), { value: ethers.parseEther("5") })).to.be.revertedWithCustomError(
      dex,
      "DexAlreadyInitialized",
    );
  });

  it("rejects zero liquidity withdrawals", async function () {
    const { dex } = await fixture();
    await expect(dex.withdraw(0n)).to.be.revertedWithCustomError(dex, "InvalidLiquidityAmount");
  });
});
