const { Router } = require("express");
const { ethers } = require("ethers");
const { JOB_STATUS } = require("../indexer");

const eth = (wei) => Number(ethers.formatEther(wei));
const day = (ts) => new Date(ts * 1000).toISOString().slice(0, 10);

module.exports = (ctx) => {
  const { db } = ctx;
  const r = Router();

  r.get("/stats", (req, res) => {
    const jobs = db.prepare("SELECT * FROM jobs").all();
    const milestones = db.prepare("SELECT * FROM milestones").all();
    const disputes = db.prepare("SELECT * FROM disputes").all();

    // ---- jobs & volume (BigInt: wei values overflow JS numbers and SQLite integers)
    const byStatus = Object.fromEntries(JOB_STATUS.map((s) => [s, 0]));
    jobs.forEach((j) => byStatus[JOB_STATUS[j.status]]++);

    const releasedByJob = new Map();
    let released = 0n;
    let fees = 0n;
    for (const m of milestones) {
      if (m.status === 2) {
        const amt = BigInt(m.amount);
        released += amt;
        fees += BigInt(m.fee ?? 0);
        releasedByJob.set(m.job_id, (releasedByJob.get(m.job_id) ?? 0n) + amt);
      }
    }
    let funded = 0n;
    let locked = 0n;
    for (const j of jobs) {
      if (j.funded_at) funded += BigInt(j.total_amount);
      if (j.status >= 1 && j.status <= 3) locked += BigInt(j.total_amount) - (releasedByJob.get(j.id) ?? 0n);
    }

    // ---- timing
    const done = jobs.filter((j) => j.status === 4 && j.accepted_at && j.completed_at);
    const avgCompletionSeconds = done.length ? Math.round(done.reduce((s, j) => s + (j.completed_at - j.accepted_at), 0) / done.length) : null;

    // ---- disputes
    const resolved = disputes.filter((d) => d.status === 1);
    const fundedJobs = jobs.filter((j) => j.funded_at).length;
    const disputeStats = {
      total: disputes.length,
      open: disputes.length - resolved.length,
      resolved: resolved.length,
      rate: fundedJobs ? disputes.length / fundedJobs : 0,
      freelancerWinRate: resolved.length ? resolved.filter((d) => d.freelancer_won).length / resolved.length : null,
      avgResolutionSeconds: resolved.length ? Math.round(resolved.reduce((s, d) => s + (d.resolved_at - d.created_at), 0) / resolved.length) : null,
    };

    // ---- daily series from events
    const series = new Map();
    const bucket = (d) => {
      if (!series.has(d)) series.set(d, { date: d, funded: 0n, released: 0n, jobsCreated: 0 });
      return series.get(d);
    };
    for (const e of db.prepare("SELECT ts, name, args FROM events WHERE name IN ('JobCreated','JobFunded','MilestoneApproved')").all()) {
      const a = JSON.parse(e.args);
      const b = bucket(day(e.ts));
      if (e.name === "JobCreated") b.jobsCreated++;
      if (e.name === "JobFunded") b.funded += BigInt(a.amount);
      if (e.name === "MilestoneApproved") b.released += BigInt(a.payout) + BigInt(a.fee);
    }
    const daily = [...series.values()]
      .sort((x, y) => x.date.localeCompare(y.date))
      .map((b) => ({ date: b.date, funded: eth(b.funded), released: eth(b.released), jobsCreated: b.jobsCreated }));

    // ---- gas per transaction type
    const gasByMethod = db
      .prepare(
        `SELECT method, COUNT(*) AS count, CAST(AVG(gas_used) AS INTEGER) AS avg_gas, MIN(gas_used) AS min_gas, MAX(gas_used) AS max_gas,
                AVG(gas_used * CAST(gas_price AS REAL)) AS avg_cost_wei
         FROM txs GROUP BY method ORDER BY count DESC`
      )
      .all()
      .map((g) => ({ method: g.method, count: g.count, avgGas: g.avg_gas, minGas: g.min_gas, maxGas: g.max_gas, avgCostEth: (g.avg_cost_wei ?? 0) / 1e18 }));

    const users = {
      clients: db.prepare("SELECT COUNT(DISTINCT client) AS n FROM jobs").get().n,
      freelancers: db.prepare("SELECT COUNT(DISTINCT freelancer) AS n FROM jobs WHERE freelancer IS NOT NULL").get().n,
      arbiters: db.prepare("SELECT COUNT(*) AS n FROM roles WHERE contract = 'DisputeResolution' AND role = ?").get(ethers.id("ARBITER_ROLE")).n,
    };

    res.json({
      jobs: { total: jobs.length, byStatus, flagged: jobs.filter((j) => j.flagged).length },
      volume: { fundedEth: eth(funded), releasedEth: eth(released), feesEth: eth(fees), lockedEth: eth(locked) },
      avgCompletionSeconds,
      platformFeePct: ctx.deployment.config.feeBps / 100,
      disputes: disputeStats,
      users,
      transactions: db.prepare("SELECT COUNT(*) AS n FROM txs").get().n,
      daily,
      gasByMethod,
    });
  });

  return r;
};
