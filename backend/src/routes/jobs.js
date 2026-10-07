const { Router } = require("express");
const { z, address, pagination, id } = require("./util");
const { notFound, unauthorized } = require("../errors");
const { JOB_STATUS } = require("../indexer");
const S = require("../serialize");

const listQuery = pagination.extend({
  status: z.enum(JOB_STATUS).optional(),
  client: address.optional(),
  freelancer: address.optional(),
  mine: z.enum(["true", "false"]).optional(),
  flagged: z.enum(["true", "false"]).optional(),
});

module.exports = (ctx, mw) => {
  const { db } = ctx;
  const r = Router();

  const votesOf = (disputeId) =>
    db
      .prepare("SELECT arbiter, favor_freelancer, ts FROM votes WHERE dispute_id = ? ORDER BY ts")
      .all(disputeId)
      .map((v) => ({ arbiter: v.arbiter, favorFreelancer: !!v.favor_freelancer, timestamp: v.ts }));

  r.get("/jobs", mw.optional, (req, res) => {
    const q = listQuery.parse(req.query);
    const where = [];
    const params = [];
    if (q.status) { where.push("status = ?"); params.push(JOB_STATUS.indexOf(q.status)); }
    if (q.client) { where.push("client = ?"); params.push(q.client); }
    if (q.freelancer) { where.push("freelancer = ?"); params.push(q.freelancer); }
    if (q.flagged) { where.push("flagged = ?"); params.push(q.flagged === "true" ? 1 : 0); }
    if (q.mine === "true") {
      if (!req.user) throw unauthorized("Log in to list your jobs");
      where.push("(client = ? OR freelancer = ?)");
      params.push(req.user.address, req.user.address);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = db.prepare(`SELECT COUNT(*) AS n FROM jobs ${clause}`).get(...params).n;
    const rows = db.prepare(`SELECT * FROM jobs ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, q.limit, q.offset);
    res.json({ total, items: rows.map((row) => S.job(db, row)) });
  });

  r.get("/jobs/:id", (req, res) => {
    const jobId = id.parse(req.params.id);
    const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(jobId);
    if (!row) throw notFound(`Job ${jobId} not found`);

    const milestones = db.prepare("SELECT * FROM milestones WHERE job_id = ? ORDER BY idx").all(jobId).map(S.milestone);
    const disputes = db
      .prepare("SELECT * FROM disputes WHERE job_id = ? ORDER BY id")
      .all(jobId)
      .map((d) => ({ ...S.dispute(d), votes: votesOf(d.id) }));
    const ratings = db
      .prepare("SELECT rater, ratee, score, ts FROM ratings WHERE job_id = ?")
      .all(jobId)
      .map((x) => ({ rater: x.rater, ratee: x.ratee, score: x.score, timestamp: x.ts }));
    const events = db
      .prepare("SELECT * FROM events WHERE job_id = ? OR dispute_id IN (SELECT id FROM disputes WHERE job_id = ?) ORDER BY block, log_index")
      .all(jobId, jobId)
      .map(S.event);

    res.json({ ...S.job(db, row), milestones, disputes, ratings, events });
  });

  r.get("/disputes", (req, res) => {
    const q = pagination.extend({ status: z.enum(["Open", "Resolved"]).optional() }).parse(req.query);
    const clause = q.status ? "WHERE status = ?" : "";
    const params = q.status ? [q.status === "Open" ? 0 : 1] : [];
    const total = db.prepare(`SELECT COUNT(*) AS n FROM disputes ${clause}`).get(...params).n;
    const rows = db.prepare(`SELECT * FROM disputes ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, q.limit, q.offset);
    res.json({ total, items: rows.map(S.dispute) });
  });

  r.get("/disputes/:id", (req, res) => {
    const disputeId = id.parse(req.params.id);
    const d = db.prepare("SELECT * FROM disputes WHERE id = ?").get(disputeId);
    if (!d) throw notFound(`Dispute ${disputeId} not found`);
    const events = db.prepare("SELECT * FROM events WHERE dispute_id = ? ORDER BY block, log_index").all(disputeId).map(S.event);
    const jobRow = db.prepare("SELECT * FROM jobs WHERE id = ?").get(d.job_id);
    const milestones = db.prepare("SELECT * FROM milestones WHERE job_id = ? ORDER BY idx").all(d.job_id).map(S.milestone);
    res.json({ ...S.dispute(d), votes: votesOf(disputeId), events, job: jobRow ? { ...S.job(db, jobRow), milestones } : null });
  });

  return r;
};
