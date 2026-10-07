const { ethers } = require("ethers");
const config = require("./config");
const db = require("./db");
const { Indexer } = require("./indexer");
const { DocStore } = require("./docstore");
const { createApp } = require("./app");

async function buildContext(overrides = {}) {
  const deployment = overrides.deployment || config.loadDeployment();
  const provider = overrides.provider || new ethers.JsonRpcProvider(config.rpcUrl, undefined, { staticNetwork: true, batchMaxCount: 1 });
  const database = overrides.db || db.open(config.dbPath);
  const { chainId } = await provider.getNetwork();

  const indexer = new Indexer({
    db: database,
    provider,
    deployment,
    chunkBlocks: config.chunkBlocks,
    confirmations: config.confirmations,
    pollMs: config.pollMs,
  });
  await indexer.init();
  const docs = overrides.docs || new DocStore({ db: database, url: config.docsDatabaseUrl });
  await docs.init();

  const c = deployment.contracts;
  return {
    db: database,
    provider,
    deployment,
    chainId: Number(chainId),
    indexer,
    docs,
    escrow: new ethers.Contract(c.JobEscrow.address, c.JobEscrow.abi, provider),
    reputation: new ethers.Contract(c.Reputation.address, c.Reputation.abi, provider),
  };
}

async function main() {
  const ctx = await buildContext();
  const app = createApp(ctx);

  // Catch up before serving so the first page load already has data.
  await ctx.indexer.syncOnce().catch((e) => console.error("[indexer] initial sync failed:", e.message));
  ctx.indexer.start();

  const server = app.listen(config.port, () => {
    console.log(`TrustWork API on :${config.port} | network ${ctx.deployment.network} (chain ${ctx.chainId}) | block ${ctx.indexer.lastBlock}`);
  });

  const shutdown = () => {
    ctx.indexer.stop();
    ctx.docs.close().finally(() => server.close(() => process.exit(0)));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { buildContext };
