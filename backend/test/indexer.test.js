// The indexer must cope with RPC providers that cap eth_getLogs ranges (e.g. 10 blocks on Alchemy's free tier).
const { test } = require("node:test");
const assert = require("node:assert/strict");
const dbLib = require("../src/db");
const { Indexer } = require("../src/indexer");

const ADDR = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const deployment = {
  network: "test",
  config: {},
  contracts: {
    Reputation: { address: ADDR, startBlock: 1, abi: [] },
    JobEscrow: { address: ADDR, startBlock: 1, abi: [] },
    DisputeResolution: { address: ADDR, startBlock: 1, abi: [] },
  },
};
const quiet = { warn() {}, info() {}, error() {} };

function fakeProvider({ head, maxRange }) {
  const calls = [];
  return {
    calls,
    getBlockNumber: async () => head,
    getNetwork: async () => ({ chainId: 31337n }),
    getLogs: async ({ fromBlock, toBlock }) => {
      calls.push(toBlock - fromBlock + 1);
      if (maxRange && toBlock - fromBlock + 1 > maxRange) throw new Error("400 Bad Request: block range too large");
      return [];
    },
  };
}

test("backs off to a smaller block range when the provider rejects wide queries, then finishes", async () => {
  const db = dbLib.open(":memory:");
  const provider = fakeProvider({ head: 95, maxRange: 10 });
  const ix = new Indexer({ db, provider, deployment, chunkBlocks: 2000, confirmations: 0, pollMs: 1000, logger: quiet });
  await ix.init();
  await ix.syncOnce();
  assert.equal(ix.lastBlock, 95, "synced all the way to head");
  assert.ok(ix.chunkBlocks <= 10, "chunk size adapted down to what the provider accepts");
  assert.ok(provider.calls.some((n) => n > 10), "the wide query was tried first");
});

test("a provider that accepts wide ranges keeps the configured chunk size", async () => {
  const db = dbLib.open(":memory:");
  const provider = fakeProvider({ head: 5000 });
  const ix = new Indexer({ db, provider, deployment, chunkBlocks: 2000, confirmations: 0, pollMs: 1000, logger: quiet });
  await ix.init();
  await ix.syncOnce();
  assert.equal(ix.lastBlock, 5000);
  assert.equal(ix.chunkBlocks, 2000);
  assert.equal(provider.calls.length, 3);
});

test("a persistent failure still surfaces after backing off to the minimum", async () => {
  const db = dbLib.open(":memory:");
  const provider = { ...fakeProvider({ head: 50 }), getLogs: async () => { throw new Error("rpc down"); } };
  const ix = new Indexer({ db, provider, deployment, chunkBlocks: 100, confirmations: 0, pollMs: 1000, logger: quiet });
  await ix.init();
  await assert.rejects(ix.syncOnce(), /rpc down/);
  assert.equal(ix.chunkBlocks, 10);
  assert.equal(ix.lastBlock, null);
});
