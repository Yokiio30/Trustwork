// Durable storage for off-chain documents (job descriptions, deliverables, disputes, evidence).
//
// The chain only holds their hashes, and the local SQLite file is disposable (hosts such as Render's
// free tier wipe it on every restart). So documents are also written to an external Postgres database
// (DOCS_DATABASE_URL, e.g. a free Neon or Supabase project) and loaded back into SQLite at startup.
// Reads stay on the local SQLite copy; only writes touch Postgres.
//
// Write order is Postgres first, then SQLite: if the durable write fails the request fails, so we
// never tell a user their text is saved when it would vanish on the next restart.
const { Pool } = require("pg");

const CREATE = `
CREATE TABLE IF NOT EXISTS documents (
  hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  author TEXT NOT NULL,
  created_at BIGINT NOT NULL
)`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class DocStore {
  /** @param {{db: import("node:sqlite").DatabaseSync, url?: string, pool?: object, logger?: Console, retryDelayMs?: number}} opts */
  constructor({ db, url, pool, logger = console, retryDelayMs = 1500 }) {
    this.db = db;
    this.retryDelayMs = retryDelayMs;
    this.log = logger;
    this.pool =
      pool ||
      (url
        ? new Pool({
            connectionString: url,
            max: 3,
            idleTimeoutMillis: 30_000,
            connectionTimeoutMillis: 15_000,
            ...(process.env.DOCS_DB_SSL === "false" ? { ssl: false } : {}),
          })
        : null);
    // An idle client dropping must not crash the process.
    this.pool?.on?.("error", (e) => this.log.error?.("[docs] database connection error:", e.message));
    this.ready = false;
    this.retryTimer = null;
  }

  get durable() {
    return !!this.pool;
  }

  /** Create the table and copy every stored document into the local database. Safe to call repeatedly. */
  async prepare() {
    if (!this.pool || this.ready) return;
    await this.pool.query(CREATE);
    const { rows } = await this.pool.query("SELECT hash, kind, content, author, created_at FROM documents");
    const insert = this.db.prepare("INSERT OR IGNORE INTO documents(hash, kind, content, author, created_at) VALUES(?,?,?,?,?)");
    for (const r of rows) insert.run(r.hash, r.kind, r.content, r.author, Number(r.created_at));
    this.ready = true;
    this.log.info?.(`[docs] loaded ${rows.length} document(s) from the durable store`);
  }

  async init() {
    if (!this.pool) {
      this.log.warn?.("[docs] DOCS_DATABASE_URL is not set: documents live only in the local database and are lost if it is wiped");
      return;
    }
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await this.prepare();
        return;
      } catch (e) {
        this.log.error?.(`[docs] could not reach the durable store (attempt ${attempt}/3): ${e.message}`);
        if (attempt < 3) await sleep(this.retryDelayMs * attempt);
      }
    }
    // Start serving anyway (the chain data is fine) and keep trying in the background.
    this.retryTimer = setInterval(() => {
      this.prepare().then(() => this.ready && clearInterval(this.retryTimer)).catch((e) => this.log.error?.("[docs] retry failed:", e.message));
    }, 30_000);
    this.retryTimer.unref?.();
  }

  /** Persist a document. Throws if the durable write fails, in which case nothing is stored locally either. */
  async save({ hash, kind, content, author, createdAt }) {
    if (this.pool) {
      await this.prepare(); // no-op once ready; retries a failed startup load
      await this.pool.query("INSERT INTO documents(hash, kind, content, author, created_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT (hash) DO NOTHING", [
        hash, kind, content, author, createdAt,
      ]);
    }
    this.db
      .prepare("INSERT OR IGNORE INTO documents(hash, kind, content, author, created_at) VALUES(?,?,?,?,?)")
      .run(hash, kind, content, author, createdAt);
  }

  async close() {
    clearInterval(this.retryTimer);
    await this.pool?.end?.().catch(() => {});
  }
}

module.exports = { DocStore };
