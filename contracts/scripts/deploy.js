// Deploys Reputation, JobEscrow and DisputeResolution, wires them together, and
// writes addresses + ABIs to ../shared/deployments/<network>.json for backend/frontend.
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { retry, send } = require("./lib/send");

const FEE_BPS = Number(process.env.PLATFORM_FEE_BPS || 100);
const REVIEW_PERIOD = Number(process.env.REVIEW_PERIOD_SECONDS || 3 * 24 * 3600);
const VOTING_PERIOD = Number(process.env.VOTING_PERIOD_SECONDS || 7 * 24 * 3600);

// Comma-separated address lists to grant roles on deployment (optional).
const list = (v) => (v || "").split(",").map((s) => s.trim()).filter(Boolean);

async function main() {
  const { ethers, network, artifacts } = hre;
  const [deployer] = await ethers.getSigners();
  const admin = process.env.ADMIN_ADDRESS || deployer.address;
  console.log(`Network ${network.name} | deployer ${deployer.address} | admin ${admin}`);

  // Resume a partly finished deployment: REUSE_<NAME>=<address> and REUSE_<NAME>_BLOCK=<deploy block>
  // attach to a contract that is already on-chain instead of paying to deploy it again.
  const reused = (name) => {
    const key = `REUSE_${name.toUpperCase()}`;
    return process.env[key] ? { address: process.env[key], block: Number(process.env[`${key}_BLOCK`]) } : null;
  };

  const deploy = async (name, args) => {
    const existing = reused(name);
    if (existing) {
      if (!existing.block) throw new Error(`Set REUSE_${name.toUpperCase()}_BLOCK as well`);
      console.log(`${name.padEnd(18)} ${existing.address} (reused, block ${existing.block})`);
      return { contract: await ethers.getContractAt(name, existing.address), block: existing.block };
    }
    const factory = await ethers.getContractFactory(name);
    const c = await retry(() => factory.deploy(...args));
    const receipt = await c.deploymentTransaction().wait();
    console.log(`${name.padEnd(18)} ${await c.getAddress()} (block ${receipt.blockNumber})`);
    return { contract: c, block: receipt.blockNumber };
  };

  const rep = await deploy("Reputation", [deployer.address]);
  const esc = await deploy("JobEscrow", [deployer.address, await rep.contract.getAddress(), FEE_BPS, REVIEW_PERIOD]);
  const dis = await deploy("DisputeResolution", [deployer.address, await esc.contract.getAddress(), VOTING_PERIOD]);

  await send(async () => esc.contract.setDisputeResolution(await dis.contract.getAddress()));
  await send(async () => rep.contract.grantRole(await rep.contract.ESCROW_ROLE(), await esc.contract.getAddress()));

  for (const a of list(process.env.ARBITERS)) {
    await send(async () => dis.contract.grantRole(await dis.contract.ARBITER_ROLE(), a));
    console.log("arbiter", a);
  }
  for (const a of list(process.env.AUDITORS)) {
    await send(async () => esc.contract.grantRole(await esc.contract.AUDITOR_ROLE(), a));
    console.log("auditor", a);
  }

  // Hand admin rights to ADMIN_ADDRESS if it differs from the deployer.
  if (admin.toLowerCase() !== deployer.address.toLowerCase()) {
    for (const c of [rep.contract, esc.contract, dis.contract]) {
      await send(async () => c.grantRole(await c.DEFAULT_ADMIN_ROLE(), admin));
      await send(async () => c.renounceRole(await c.DEFAULT_ADMIN_ROLE(), deployer.address));
    }
    console.log("admin role transferred to", admin);
  }

  const abi = async (n) => (await artifacts.readArtifact(n)).abi;
  const out = {
    network: network.name,
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address, // constructor admin argument, needed to verify on Etherscan
    admin,
    config: { feeBps: FEE_BPS, reviewPeriod: REVIEW_PERIOD, votingPeriod: VOTING_PERIOD },
    contracts: {
      Reputation: { address: await rep.contract.getAddress(), startBlock: rep.block, abi: await abi("Reputation") },
      JobEscrow: { address: await esc.contract.getAddress(), startBlock: esc.block, abi: await abi("JobEscrow") },
      DisputeResolution: { address: await dis.contract.getAddress(), startBlock: dis.block, abi: await abi("DisputeResolution") },
    },
  };

  const dir = path.join(__dirname, "..", "..", "shared", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${network.name}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log("Wrote", file);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
