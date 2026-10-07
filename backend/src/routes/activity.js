const { Router } = require("express");
const { z, address, pagination } = require("./util");
const S = require("../serialize");

module.exports = (ctx) => {
  const { db } = ctx;
  const r = Router();

  r.get("/events", (req, res) => {
    const q = pagination
      .extend({
        jobId: z.coerce.number().int().optional(),
        disputeId: z.coerce.number().int().optional(),
        actor: address.optional(),
        name: z.string().max(60).optional(),
        contract: z.enum(["JobEscrow", "DisputeResolution", "Reputation"]).optional(),
      })
      .parse(req.query);
    const where = [];
    const params = [];
    const add = (cond, v) => { where.push(cond); params.push(v); };
    if (q.jobId !== undefined) add("job_id = ?", q.jobId);
    if (q.disputeId !== undefined) add("dispute_id = ?", q.disputeId);
    if (q.actor) add("actor = ?", q.actor);
    if (q.name) add("name = ?", q.name);
    if (q.contract) add("contract = ?", q.contract);
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = db.prepare(`SELECT COUNT(*) AS n FROM events ${clause}`).get(...params).n;
    const rows = db.prepare(`SELECT * FROM events ${clause} ORDER BY block DESC, log_index DESC LIMIT ? OFFSET ?`).all(...params, q.limit, q.offset);
    res.json({ total, items: rows.map(S.event) });
  });

  r.get("/txs", (req, res) => {
    const q = pagination.extend({ from: address.optional(), method: z.string().max(60).optional() }).parse(req.query);
    const where = [];
    const params = [];
    if (q.from) { where.push("from_addr = ?"); params.push(q.from); }
    if (q.method) { where.push("method = ?"); params.push(q.method); }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = db.prepare(`SELECT COUNT(*) AS n FROM txs ${clause}`).get(...params).n;
    const rows = db.prepare(`SELECT * FROM txs ${clause} ORDER BY block DESC, ts DESC LIMIT ? OFFSET ?`).all(...params, q.limit, q.offset);
    res.json({ total, items: rows.map(S.tx) });
  });

  return r;
};
