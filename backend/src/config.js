const path = require("path");
const fs = require("fs");
require("dotenv").config({ quiet: true });

const env = process.env;
const production = env.NODE_ENV === "production";

if (production && !env.JWT_SECRET) {
  throw new Error("JWT_SECRET must be set in production");
}

const network = env.NETWORK || "localhost";
const deploymentFile = env.DEPLOYMENT_FILE || path.join(__dirname, "..", "..", "shared", "deployments", `${network}.json`);

function loadDeployment() {
  if (!fs.existsSync(deploymentFile)) {
    throw new Error(`Deployment file not found: ${deploymentFile}. Run the contracts deploy script first.`);
  }
  return JSON.parse(fs.readFileSync(deploymentFile, "utf8"));
}

module.exports = {
  production,
  network,
  port: Number(env.PORT || 4000),
  rpcUrl: env.RPC_URL || "http://127.0.0.1:8545",
  jwtSecret: env.JWT_SECRET || "dev-only-secret-change-me",
  jwtTtl: env.JWT_TTL || "12h",
  corsOrigin: (env.CORS_ORIGIN || "http://localhost:3000").split(",").map((s) => s.trim()),
  docsDatabaseUrl: env.DOCS_DATABASE_URL || null,
  dbPath: env.DB_PATH || path.join(__dirname, "..", "data", "trustwork.db"),
  pollMs: Number(env.INDEXER_POLL_MS || 3000),
  chunkBlocks: Number(env.INDEXER_CHUNK_BLOCKS || 2000),
  confirmations: Number(env.INDEXER_CONFIRMATIONS || 0),
  deploymentFile,
  loadDeployment,
};
