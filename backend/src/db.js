// SQLite via the built-in node:sqlite module (no native build step).
// Chain-derived tables can be rebuilt by re-running the indexer, so the DB is disposable.
const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY,
  client TEXT NOT NULL,
  freelancer TEXT,
  status INTEGER NOT NULL,
  total_amount TEXT NOT NULL,
  fee_bps INTEGER NOT NULL,
  milestone_count INTEGER NOT NULL,
  description_hash TEXT NOT NULL,
  flagged INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  funded_at INTEGER,
  accepted_at INTEGER,
  completed_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_client ON jobs(client);
CREATE INDEX IF NOT EXISTS idx_jobs_freelancer ON jobs(freelancer);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

CREATE TABLE IF NOT EXISTS milestones (
  job_id INTEGER NOT NULL,
  idx INTEGER NOT NULL,
  amount TEXT NOT NULL,
  status INTEGER NOT NULL DEFAULT 0,
  submitted_at INTEGER,
  deliverable_hash TEXT,
  payout TEXT,
  fee TEXT,
  via_timeout INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (job_id, idx)
);

CREATE TABLE IF NOT EXISTS disputes (
  id INTEGER PRIMARY KEY,
  job_id INTEGER NOT NULL,
  milestone_idx INTEGER NOT NULL,
  raised_by TEXT NOT NULL,
  reason_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  voting_deadline INTEGER NOT NULL,
  status INTEGER NOT NULL DEFAULT 0,
  freelancer_won INTEGER,
  votes_freelancer INTEGER NOT NULL DEFAULT 0,
  votes_client INTEGER NOT NULL DEFAULT 0,
  resolved_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_disputes_job ON disputes(job_id);

CREATE TABLE IF NOT EXISTS votes (
  dispute_id INTEGER NOT NULL,
  arbiter TEXT NOT NULL,
  favor_freelancer INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  PRIMARY KEY (dispute_id, arbiter)
);

CREATE TABLE IF NOT EXISTS ratings (
  job_id INTEGER NOT NULL,
  rater TEXT NOT NULL,
  ratee TEXT NOT NULL,
  score INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  PRIMARY KEY (job_id, rater)
);

CREATE TABLE IF NOT EXISTS txs (
  hash TEXT PRIMARY KEY,
  block INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  from_addr TEXT NOT NULL,
  to_addr TEXT,
  method TEXT NOT NULL,
  value TEXT NOT NULL,
  gas_used INTEGER NOT NULL,
  gas_price TEXT NOT NULL,
  success INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_txs_from ON txs(from_addr);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  block INTEGER NOT NULL,
  log_index INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  contract TEXT NOT NULL,
  name TEXT NOT NULL,
  job_id INTEGER,
  dispute_id INTEGER,
  actor TEXT,
  tx_hash TEXT NOT NULL,
  args TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_job ON events(job_id);
CREATE INDEX IF NOT EXISTS idx_events_dispute ON events(dispute_id);
CREATE INDEX IF NOT EXISTS idx_events_actor ON events(actor);
CREATE INDEX IF NOT EXISTS idx_events_block ON events(block DESC, log_index DESC);

CREATE TABLE IF NOT EXISTS roles (
  contract TEXT NOT NULL,
  role TEXT NOT NULL,
  account TEXT NOT NULL,
  PRIMARY KEY (contract, role, account)
);

CREATE TABLE IF NOT EXISTS documents (
  hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  author TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_nonces (
  address TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
`;

// Tables rebuilt from the chain. documents and auth_nonces are off-chain data and are kept.
const CHAIN_TABLES = ["jobs", "milestones", "disputes", "votes", "ratings", "txs", "events", "roles"];

function open(dbPath) {
  if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  return db;
}

function transaction(db, fn) {
  db.exec("BEGIN");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

function resetChainData(db) {
  transaction(db, () => {
    for (const t of CHAIN_TABLES) db.exec(`DELETE FROM ${t}`);
    db.exec("DELETE FROM sync_state");
  });
}

function getState(db, key) {
  const row = db.prepare("SELECT value FROM sync_state WHERE key = ?").get(key);
  return row ? row.value : null;
}

function setState(db, key, value) {
  db.prepare("INSERT INTO sync_state(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, String(value));
}

module.exports = { open, transaction, resetChainData, getState, setState };
