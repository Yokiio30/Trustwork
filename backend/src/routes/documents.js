// Off-chain text for things the contracts only store as hashes (job description, deliverable,
// dispute reason, evidence). The hash is keccak256 of the stored string, so anyone can check
// that the text matches what was committed on-chain.
const { Router } = require("express");
const { ethers } = require("ethers");
const { z } = require("./util");
const { notFound, forbidden, unauthorized, unavailable } = require("../errors");

const MAX_CONTENT_BYTES = 16 * 1024;

const jobDoc = z.object({
  title: z.string().trim().min(3).max(120),
  description: z.string().trim().min(1).max(4000),
  category: z.string().trim().max(60).optional(),
});
const textDoc = z.object({
  text: z.string().trim().min(1).max(4000),
  links: z.array(z.string().url().max(500)).max(10).optional(),
});

const bodySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("job"), content: jobDoc }),
  z.object({ kind: z.enum(["deliverable", "dispute", "evidence"]), content: textDoc }),
]);

module.exports = (ctx, mw) => {
  const { db } = ctx;
  const r = Router();

  r.post("/documents", mw.required, async (req, res) => {
    const { kind, content } = bodySchema.parse(req.body);
    const text = JSON.stringify(content);
    if (Buffer.byteLength(text) > MAX_CONTENT_BYTES) {
      return res.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Document too large" } });
    }
    const hash = ethers.id(text);
    try {
      // Durable store first: if this fails the user is told, rather than losing the text on the next restart.
      await ctx.docs.save({ hash, kind, content: text, author: req.user.address, createdAt: Math.floor(Date.now() / 1000) });
    } catch (e) {
      console.error("[documents] durable save failed:", e.message);
      throw unavailable("Document storage is temporarily unavailable. Please try again in a moment.");
    }
    res.status(201).json({ hash, kind });
  });

  // job ids that reference a hash on-chain (description, deliverable, dispute reason, evidence)
  const jobsReferencing = (hash) => {
    const ids = new Set();
    for (const x of db.prepare("SELECT id FROM jobs WHERE description_hash = ?").all(hash)) ids.add(x.id);
    for (const x of db.prepare("SELECT job_id AS id FROM milestones WHERE deliverable_hash = ?").all(hash)) ids.add(x.id);
    for (const x of db.prepare("SELECT job_id AS id FROM disputes WHERE reason_hash = ?").all(hash)) ids.add(x.id);
    for (const x of db
      .prepare(
        `SELECT d.job_id AS id FROM events e JOIN disputes d ON d.id = e.dispute_id
         WHERE e.name = 'EvidenceSubmitted' AND json_extract(e.args, '$.evidenceHash') = ?`
      )
      .all(hash)) ids.add(x.id);
    return [...ids];
  };

  function canView(doc, user) {
    if (doc.kind === "job") return true; // job listings are public
    if (!user) return false;
    if (user.address === doc.author) return true;
    if (user.roles.includes("admin") || user.roles.includes("auditor")) return true;

    for (const jobId of jobsReferencing(doc.hash)) {
      const j = db.prepare("SELECT client, freelancer FROM jobs WHERE id = ?").get(jobId);
      if (j && (j.client === user.address || j.freelancer === user.address)) return true;
      if (user.roles.includes("arbiter") && db.prepare("SELECT 1 FROM disputes WHERE job_id = ?").get(jobId)) return true;
    }
    return false;
  }

  r.get("/documents/:hash", mw.optional, (req, res) => {
    const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/).parse(req.params.hash).toLowerCase();
    const doc = db.prepare("SELECT * FROM documents WHERE hash = ?").get(hash);
    if (!doc) throw notFound("Document not found");
    if (!canView(doc, req.user)) {
      throw req.user ? forbidden("Only the parties, arbiters and auditors can view this document") : unauthorized();
    }
    res.json({ hash: doc.hash, kind: doc.kind, author: doc.author, createdAt: doc.created_at, content: JSON.parse(doc.content) });
  });

  return r;
};
