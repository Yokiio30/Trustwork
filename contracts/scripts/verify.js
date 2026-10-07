// Verifies the three deployed contracts on Etherscan so the source is public and readable.
//   npx hardhat run scripts/verify.js --network sepolia
// Needs ETHERSCAN_API_KEY in .env and the deployment file written by deploy.js.
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const file = path.join(__dirname, "..", "..", "shared", "deployments", `${hre.network.name}.json`);
  if (!fs.existsSync(file)) throw new Error(`No deployment file for ${hre.network.name}: ${file}`);
  const dep = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!dep.deployer) throw new Error("Deployment file has no `deployer`; redeploy with the current deploy.js");

  const c = dep.contracts;
  const jobs = [
    ["Reputation", c.Reputation.address, [dep.deployer]],
    ["JobEscrow", c.JobEscrow.address, [dep.deployer, c.Reputation.address, dep.config.feeBps, dep.config.reviewPeriod]],
    ["DisputeResolution", c.DisputeResolution.address, [dep.deployer, c.JobEscrow.address, dep.config.votingPeriod]],
  ];

  for (const [name, address, constructorArguments] of jobs) {
    try {
      await hre.run("verify:verify", { address, constructorArguments });
      console.log(`verified ${name} ${address}`);
    } catch (e) {
      if (/already verified/i.test(e.message)) console.log(`already verified ${name} ${address}`);
      else {
        console.error(`FAILED ${name}: ${e.message}`);
        process.exitCode = 1;
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
