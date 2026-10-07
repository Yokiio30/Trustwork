// Durable document store, tested against pg-mem (an in-memory Postgres) so no database server is needed.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { newDb } = require("pg-mem");
const { ethers } = require("ethers");

process.env.JWT_SECRET = "test-secret";
const dbLib = require("../src/db");
const { DocStore } = require("../src/docstore");
const { createApp } = require("../src/app");

const quiet = { warn() {}, info() {}, error() {} };
// pg-mem cannot re-run `CREATE TABLE IF NOT EXISTS` on an existing table (real Postgres can), so the
// helper skips a repeated CREATE. Everything else goes to the emulator unchanged.
function memPool() {
  const pool = new (newDb().adapters.createPg().Pool)();
  const query = pool.query.bind(pool);
  let created = false;
  pool.query = (sql, ...rest) => {
    if (typeof sql === "string" && /^\s*CREATE TABLE/i.test(sql)) {
      if (created) return Promise.resolve({ rows: [] });
      created = true;
    }
    return query(sql, ...rest);
  };
  return pool;
}
const doc = (n) => ({ hash: ethers.id(`doc${n}`), kind: "job", content: JSON.stringify({ title: `Job ${n}`, description: "x" }), author: "0xabc", createdAt: 1_700_000_000 + n });
const localCount = (db) => db.prepare("SELECT COUNT(*) AS n FROM documents").get().n;

test("without a database URL documents are kept locally and a warning is logged", async () => {
  const db = dbLib.open(":memory:");
  let warned = false;
  const store = new DocStore({ db, logger: { ...quiet, warn: () => (warned = true) } });
  await store.init();
  await store.save(doc(1));
  assert.equal(localCount(db), 1);
  assert.equal(store.durable, false);
  assert.equal(warned, true);
});

test("save writes to Postgres and SQLite; a wiped local database is restored on startup", async () => {
  const pool = memPool();
  const first = dbLib.open(":memory:");
  const store1 = new DocStore({ db: first, pool, logger: quiet });
  await store1.init();
  await store1.save(doc(1));
  await store1.save(doc(2));
  await store1.save(doc(1)); // duplicate hash is ignored
  assert.equal(localCount(first), 2);
  assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM documents")).rows[0].n, 2);

  // Simulate a host restart that wipes the local disk: brand-new SQLite, same Postgres.
  const wiped = dbLib.open(":memory:");
  assert.equal(localCount(wiped), 0);
  const store2 = new DocStore({ db: wiped, pool, logger: quiet });
  await store2.init();
  assert.equal(localCount(wiped), 2);
  const restored = wiped.prepare("SELECT * FROM documents WHERE hash = ?").get(doc(2).hash);
  assert.equal(restored.content, doc(2).content);
  assert.equal(restored.created_at, doc(2).createdAt);
});

test("a failed durable write stores nothing locally", async () => {
  const db = dbLib.open(":memory:");
  const pool = memPool();
  const store = new DocStore({ db, pool, logger: quiet });
  await store.init();
  pool.query = async () => {
    throw new Error("connection refused");
  };
  await assert.rejects(store.save(doc(3)), /connection refused/);
  assert.equal(localCount(db), 0);
});

test("startup survives an unreachable database and recovers on the next save", async () => {
  const db = dbLib.open(":memory:");
  const pool = memPool();
  const realQuery = pool.query.bind(pool);
  pool.query = async () => {
    throw new Error("db down");
  };
  const store = new DocStore({ db, pool, logger: quiet, retryDelayMs: 1 });
  await store.init(); // must not throw
  assert.equal(store.ready, false);
  await assert.rejects(store.save(doc(4)), /db down/);

  pool.query = realQuery; // database comes back
  await store.save(doc(4));
  assert.equal(store.ready, true);
  assert.equal(localCount(db), 1);
  await store.close();
});

async function appWith(store, db) {
  const ctx = {
    db,
    docs: store,
    deployment: { network: "test", config: { feeBps: 100 }, contracts: {} },
    chainId: 31337,
    indexer: { status: () => ({}) },
  };
  const server = createApp(ctx).listen(0);
  await new Promise((r) => server.once("listening", r));
  return { server, base: `http://127.0.0.1:${server.address().port}/api` };
}

async function login(base, wallet) {
  const { message } = await (await fetch(`${base}/auth/nonce?address=${wallet.address}&domain=t`)).json();
  const signature = await wallet.signMessage(message);
  const res = await fetch(`${base}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: wallet.address, signature, domain: "t" }) });
  return (await res.json()).token;
}

test("POST /documents is durable, and answers 503 (not 201) when the durable store fails", async () => {
  const db = dbLib.open(":memory:");
  const pool = memPool();
  const store = new DocStore({ db, pool, logger: quiet });
  await store.init();
  const { server, base } = await appWith(store, db);
  try {
    const wallet = ethers.Wallet.createRandom();
    const token = await login(base, wallet);
    const post = (body) =>
      fetch(`${base}/documents`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
    const body = { kind: "job", content: { title: "Durable job", description: "Stored twice" } };

    const ok = await post(body);
    assert.equal(ok.status, 201);
    const { hash } = await ok.json();
    assert.equal((await pool.query("SELECT COUNT(*)::int AS n FROM documents WHERE hash = $1", [hash])).rows[0].n, 1);

    pool.query = async () => {
      throw new Error("db down");
    };
    const failed = await post({ kind: "job", content: { title: "Lost job", description: "Not saved" } });
    assert.equal(failed.status, 503);
    assert.equal((await failed.json()).error.code, "UNAVAILABLE");
    assert.equal(localCount(db), 1, "the failed document must not exist locally");
  } finally {
    server.close();
  }
});
