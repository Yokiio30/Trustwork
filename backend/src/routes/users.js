const { Router } = require("express");
const { ethers } = require("ethers");
const { address } = require("./util");
const { rolesOf } = require("../auth");

module.exports = (ctx) => {
  const { db } = ctx;
  const r = Router();

  // Profile: indexed activity plus live on-chain reputation and withdrawable balance.
  r.get("/users/:address", async (req, res) => {
    const addr = address.parse(req.params.address);
    const asClient = db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE client = ?").get(addr).n;
    const asFreelancer = db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE freelancer = ?").get(addr).n;
    const ratings = db.prepare("SELECT COUNT(*) AS n, AVG(score) AS avg FROM ratings WHERE ratee = ?").get(addr);

    let reputation = null;
    let withdrawable = null;
    try {
      const [rec, bal] = await Promise.all([ctx.reputation.getRecord(addr), ctx.escrow.balances(addr)]);
      reputation = {
        jobsCompleted: Number(rec.jobsCompleted),
        ratingCount: Number(rec.ratingCount),
        ratingSum: Number(rec.ratingSum),
        disputesWon: Number(rec.disputesWon),
        disputesLost: Number(rec.disputesLost),
      };
      withdrawable = bal.toString();
    } catch (e) {
      console.warn("[users] chain read failed:", e.shortMessage || e.message);
    }

    res.json({
      address: ethers.getAddress(addr),
      roles: rolesOf(ctx, addr),
      jobsAsClient: asClient,
      jobsAsFreelancer: asFreelancer,
      averageRating: ratings.n ? Number(ratings.avg) : null,
      ratingCount: ratings.n,
      reputation,
      withdrawable,
    });
  });

  // Everyone holding a privileged role, as recorded by RoleGranted/RoleRevoked events.
  r.get("/roles", (req, res) => {
    const who = (contract, role) =>
      db.prepare("SELECT account FROM roles WHERE contract = ? AND role = ?").all(contract, role).map((x) => x.account);
    res.json({
      admins: who("JobEscrow", ethers.ZeroHash),
      auditors: who("JobEscrow", ethers.id("AUDITOR_ROLE")),
      arbiters: who("DisputeResolution", ethers.id("ARBITER_ROLE")),
    });
  });

  r.get("/arbiters", (req, res) => {
    const rows = db
      .prepare("SELECT account FROM roles WHERE contract = 'DisputeResolution' AND role = ?")
      .all(ethers.id("ARBITER_ROLE"));
    const items = rows.map((x) => ({
      address: x.account,
      votesCast: db.prepare("SELECT COUNT(*) AS n FROM votes WHERE arbiter = ?").get(x.account).n,
    }));
    res.json({ items });
  });

  return r;
};

