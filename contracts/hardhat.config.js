require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const { SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY, ETHERSCAN_API_KEY, GAS_PRICE_GWEI } = process.env;

// Hardhat adds a 1 gwei tip by default, which on Sepolia (base fee ~0) is the entire price and about a
// thousand times more than needed. GAS_PRICE_GWEI (e.g. 0.02) overrides it with a flat legacy price.
const gasPrice = GAS_PRICE_GWEI ? Math.round(Number(GAS_PRICE_GWEI) * 1e9) : "auto";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {},
    localhost: { url: "http://127.0.0.1:8545" },
    ...(SEPOLIA_RPC_URL && DEPLOYER_PRIVATE_KEY
      ? // chainId makes Hardhat refuse to run if the RPC URL points at a different chain (e.g. mainnet)
        { sepolia: { url: SEPOLIA_RPC_URL, chainId: 11155111, accounts: [DEPLOYER_PRIVATE_KEY], gasPrice } }
      : {}),
  },
  etherscan: { apiKey: ETHERSCAN_API_KEY || "" },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD",
    outputFile: process.env.REPORT_GAS === "true" ? "gas-report.txt" : undefined,
    noColors: true,
  },
};
