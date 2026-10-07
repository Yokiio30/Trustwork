// Creates throwaway demo wallets on a public testnet, funds them from the deployer, grants the
// arbiter/auditor roles, and writes their private keys to contracts/demo-accounts.json (gitignored)
// so the presenter can import them into MetaMask.
//   GAS_PRICE_GWEI=0.02 npx hardhat run scripts/demo-accounts.js --network sepolia
//   (optional) DEMO_CLIENT_ETH=0.0012 DEMO_FUND_ETH=0.0002
//
// Testnet ETH is scarce. The client locks the job amounts, so it gets more (use 0.0002 ETH jobs); everyone else
// only needs gas. At the network's real fee level (about 0.001 gwei) a transaction costs around a millionth of an ETH.
// The deployer must still be the admin (do not set ADMIN_ADDRESS when deploying for this flow).
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const { send } = require("./lib/send");

const { ethers, network } = hre;
const FUND = ethers.parseEther(process.env.DEMO_FUND_ETH || "0.0002");
const CLIENT_FUND = ethers.parseEther(process.env.DEMO_CLIENT_ETH || "0.0012");
const amountFor = (key) => (key === "client" ? CLIENT_FUND : FUND);

const ROLES = [
  ["client", "Alice (client)"],
  ["freelancer", "Bob (freelancer)"],
  ["freelancer2", "Carol (freelancer)"],
  ["arbiter1", "Arbiter 1"],
  ["arbiter2", "Arbiter 2"],
  ["arbiter3", "Arbiter 3"],
  ["auditor", "Auditor"],
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const file = path.join(__dirname, "..", "..", "shared", "deployments", `${network.name}.json`);
  const dep = JSON.parse(fs.readFileSync(file, "utf8"));
  const escrow = new ethers.Contract(dep.contracts.JobEscrow.address, dep.contracts.JobEscrow.abi, deployer);
  const disputes = new ethers.Contract(dep.contracts.DisputeResolution.address, dep.contracts.DisputeResolution.abi, deployer);

  const need = ROLES.reduce((sum, [key]) => sum + amountFor(key), 0n);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`deployer ${deployer.address} balance ${ethers.formatEther(balance)} ETH, need about ${ethers.formatEther(need)} ETH`);
  if (balance < need) throw new Error("Deployer balance is too low. Get more testnet ETH from a faucet or lower DEMO_CLIENT_ETH / DEMO_FUND_ETH.");

  const out = {};
  for (const [key, label] of ROLES) {
    const w = ethers.Wallet.createRandom();
    await send(async () => deployer.sendTransaction({ to: w.address, value: amountFor(key) }));
    if (key.startsWith("arbiter")) await send(async () => disputes.grantRole(await disputes.ARBITER_ROLE(), w.address));
    if (key === "auditor") await send(async () => escrow.grantRole(await escrow.AUDITOR_ROLE(), w.address));
    out[key] = { label, address: w.address, privateKey: w.privateKey };
    console.log(`${label.padEnd(20)} ${w.address}`);
  }

  const dest = path.join(__dirname, "..", "demo-accounts.json");
  fs.writeFileSync(dest, JSON.stringify({ network: network.name, accounts: out }, null, 2));
  console.log(`\nWrote ${dest}. Import the private keys into MetaMask (Account details > Show private key > Import).`);
  console.log("These are throwaway testnet keys. Never reuse them anywhere that holds real value.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
