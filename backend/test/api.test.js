// API tests that need no blockchain: an in-memory DB is filled directly and the real Express app is used.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { ethers } = require("ethers");

process.env.JWT_SECRET = "test-secret";
const dbLib = require("../src/db");
const { createApp } = require("../src/app");
const { ROLE_HASH } = require("../src/indexer");
const { DocStore } = require("../src/docstore");

const client = ethers.Wallet.createRandom();
const freelancer = ethers.Wallet.createRandom();
const arbiter = ethers.Wallet.createRandom();
const auditor = ethers.Wallet.createRandom();
const stranger = ethers.Wallet.createRandom();
const lc = (w) => w.address.toLowerCase();

let server;
let base;
let db;

async function http(method, path, { body, token } = {}) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

async function login(wallet) {
  const domain = "test.local";
  const nonce = await http("GET", `/auth/nonce?address=${wallet.address}&domain=${domain}`);
  assert.equal(nonce.status, 200);
  const signature = await wallet.signMessage(nonce.body.message);
  const res = await http("POST", "/auth/login", { body: { address: wallet.address, signature, domain } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body;
}

before(async () => {
  db = dbLib.open(":memory:");
  const deployment = { network: "test", config: { feeBps: 100 }, contracts: {} };
  const ctx = {
    db,
    docs: new DocStore({ db, logger: { warn() {}, info() {}, error() {} } }),
    deployment,
    chainId: 31337,
    indexer: { status: () => ({ lastBlock: 0, headBlock: 0, lastError: null }) },
    escrow: { balances: async () => 0n },
    reputation: { getRecord: async () => ({ jobsCompleted: 0, ratingCount: 0, ratingSum: 0, disputesWon: 0, disputesLost: 0 }) },
  };
  // roles as the indexer would record them
  db.prepare("INSERT INTO roles VALUES('DisputeResolution', ?, ?)").run(ROLE_HASH.ARBITER, lc(arbiter));
  db.prepare("INSERT INTO roles VALUES('JobEscrow', ?, ?)").run(ROLE_HASH.AUDITOR, lc(auditor));

  server = createApp(ctx).listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test("health reports indexer state", async () => {
  const r = await http("GET", "/health");
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
});

test("login: signed challenge returns a token with roles from indexed grants", async () => {
  const a = await login(arbiter);
  assert.deepEqual(a.roles.sort(), ["arbiter", "user"]);
  const me = await http("GET", "/auth/me", { token: a.token });
  assert.equal(me.body.address, lc(arbiter));
  assert.deepEqual((await login(auditor)).roles.sort(), ["auditor", "user"]);
});

test("login: wrong signer, replayed and malformed signatures are rejected", async () => {
  const domain = "test.local";
  const nonce = await http("GET", `/auth/nonce?address=${client.address}&domain=${domain}`);
  const forged = await stranger.signMessage(nonce.body.message);
  let r = await http("POST", "/auth/login", { body: { address: client.address, signature: forged, domain } });
  assert.equal(r.status, 401);

  const good = await client.signMessage(nonce.body.message);
  r = await http("POST", "/auth/login", { body: { address: client.address, signature: good, domain } });
  assert.equal(r.status, 200);
  r = await http("POST", "/auth/login", { body: { address: client.address, signature: good, domain } });
  assert.equal(r.status, 401, "a nonce must be single use");

  r = await http("POST", "/auth/login", { body: { address: client.address, signature: "0xabcdef0123456789", domain } });
  assert.equal(r.status, 401);
});

test("login: a signature for another domain is rejected", async () => {
  const nonce = await http("GET", `/auth/nonce?address=${client.address}&domain=evil.example`);
  const signature = await client.signMessage(nonce.body.message);
  const r = await http("POST", "/auth/login", { body: { address: client.address, signature, domain: "test.local" } });
  assert.equal(r.status, 401);
});

test("protected routes need a valid token", async () => {
  assert.equal((await http("GET", "/auth/me")).status, 401);
  assert.equal((await http("GET", "/auth/me", { token: "garbage" })).status, 401);
  assert.equal((await http("POST", "/documents", { body: { kind: "job", content: {} } })).status, 401);
});

test("validation errors are structured 400s", async () => {
  const { token } = await login(client);
  let r = await http("POST", "/documents", { token, body: { kind: "job", content: { title: "x" } } });
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, "VALIDATION_ERROR");
  r = await http("GET", "/jobs?status=Nope");
  assert.equal(r.status, 400);
  r = await http("GET", "/users/not-an-address");
  assert.equal(r.status, 400);
  r = await http("GET", "/jobs/abc");
  assert.equal(r.status, 400);
  r = await http("GET", "/jobs/12345");
  assert.equal(r.status, 404);
  r = await http("GET", "/nope");
  assert.equal(r.status, 404);
});

test("documents: hash matches keccak256 of stored text; job docs are public", async () => {
  const { token } = await login(client);
  const content = { title: "Build a website", description: "Five pages, responsive.", category: "Development" };
  const r = await http("POST", "/documents", { token, body: { kind: "job", content } });
  assert.equal(r.status, 201);
  assert.equal(r.body.hash, ethers.id(JSON.stringify(content)));
  const pub = await http("GET", `/documents/${r.body.hash}`);
  assert.equal(pub.status, 200);
  assert.equal(pub.body.content.title, "Build a website");
});

test("documents: deliverables are visible to the parties, arbiters on disputed jobs and auditors only", async () => {
  const fl = await login(freelancer);
  const content = { text: "Final files", links: ["https://example.com/x"] };
  const created = await http("POST", "/documents", { token: fl.token, body: { kind: "deliverable", content } });
  const hash = created.body.hash;

  const now = 1_700_000_000;
  db.prepare("INSERT INTO jobs(id, client, freelancer, status, total_amount, fee_bps, milestone_count, description_hash, created_at, updated_at) VALUES(1,?,?,2,'1',100,1,?,?,?)")
    .run(lc(client), lc(freelancer), ethers.id("d"), now, now);
  db.prepare("INSERT INTO milestones(job_id, idx, amount, status, deliverable_hash) VALUES(1,0,'1',1,?)").run(hash);

  assert.equal((await http("GET", `/documents/${hash}`)).status, 401);
  assert.equal((await http("GET", `/documents/${hash}`, { token: (await login(stranger)).token })).status, 403);
  assert.equal((await http("GET", `/documents/${hash}`, { token: (await login(client)).token })).status, 200);
  assert.equal((await http("GET", `/documents/${hash}`, { token: fl.token })).status, 200);
  assert.equal((await http("GET", `/documents/${hash}`, { token: (await login(auditor)).token })).status, 200);

  // arbiters only get access once the job is in dispute
  const arb = (await login(arbiter)).token;
  assert.equal((await http("GET", `/documents/${hash}`, { token: arb })).status, 403);
  db.prepare("INSERT INTO disputes(id, job_id, milestone_idx, raised_by, reason_hash, created_at, voting_deadline) VALUES(1,1,0,?,?,?,?)")
    .run(lc(client), ethers.id("r"), now, now + 100);
  assert.equal((await http("GET", `/documents/${hash}`, { token: arb })).status, 200);
});

test("jobs list filters, paginates and requires auth for mine=true", async () => {
  const now = 1_700_000_100;
  const ins = db.prepare("INSERT INTO jobs(id, client, freelancer, status, total_amount, fee_bps, milestone_count, description_hash, created_at, updated_at) VALUES(?,?,?,?,'5',100,1,?,?,?)");
  ins.run(2, lc(client), null, 0, ethers.id("a"), now, now);
  ins.run(3, lc(stranger), null, 1, ethers.id("b"), now, now);

  const all = await http("GET", "/jobs?limit=2");
  assert.equal(all.body.items.length, 2);
  assert.equal(all.body.total, 3);
  assert.equal(all.body.items[0].id, 3, "newest first");

  const funded = await http("GET", "/jobs?status=Funded");
  assert.deepEqual(funded.body.items.map((j) => j.id), [3]);

  assert.equal((await http("GET", "/jobs?mine=true")).status, 401);
  const mine = await http("GET", "/jobs?mine=true", { token: (await login(client)).token });
  assert.deepEqual(mine.body.items.map((j) => j.id).sort(), [1, 2]);
});

test("stats aggregate without chain access", async () => {
  const r = await http("GET", "/stats");
  assert.equal(r.status, 200);
  assert.equal(r.body.jobs.total, 3);
  assert.equal(r.body.disputes.total, 1);
  assert.equal(r.body.disputes.open, 1);
});
