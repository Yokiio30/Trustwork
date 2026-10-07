// Polls the chain for contract logs and applies them to SQLite.
// Each block range is applied in one DB transaction together with the sync cursor, so a crash
// can never leave the cursor ahead of the data.
const { ethers } = require("ethers");
const { transaction, resetChainData, getState, setState } = require("./db");

const JOB_STATUS = ["Open", "Funded", "InProgress", "Disputed", "Completed", "Cancelled", "Terminated"];
const MILESTONE_STATUS = ["Pending", "Submitted", "Approved", "Disputed", "Refunded"];

const ROLE_HASH = {
  ADMIN: ethers.ZeroHash,
  AUDITOR: ethers.id("AUDITOR_ROLE"),
  ARBITER: ethers.id("ARBITER_ROLE"),
  ESCROW: ethers.id("ESCROW_ROLE"),
};

const MIN_CHUNK = 10;
const lc = (a) => (a ? String(a).toLowerCase() : a);

function jsonSafe(args, fragment) {
  const out = {};
  fragment.inputs.forEach((input, i) => {
    const v = args[i];
    out[input.name] = typeof v === "bigint" ? v.toString() : v;
  });
  return out;
}

class Indexer {
  constructor({ db, provider, deployment, chunkBlocks, confirmations, pollMs, logger = console }) {
    this.db = db;
    this.provider = provider;
    this.deployment = deployment;
    this.chunkBlocks = chunkBlocks;
    this.confirmations = confirmations;
    this.pollMs = pollMs;
    this.log = logger;
    this.timer = null;
    this.running = false;
    this.lastError = null;
    this.headBlock = null;

    this.contracts = {};
    this.byAddress = {};
    for (const [name, c] of Object.entries(deployment.contracts)) {
      const iface = new ethers.Interface(c.abi);
      const address = lc(c.address);
      this.contracts[name] = { name, address, iface, startBlock: c.startBlock };
      this.byAddress[address] = this.contracts[name];
    }
    this.escrowContract = new ethers.Contract(deployment.contracts.JobEscrow.address, deployment.contracts.JobEscrow.abi, provider);
    this.startBlock = Math.min(...Object.values(this.contracts).map((c) => c.startBlock));
    this.tsCache = new Map();
  }

  get lastBlock() {
    const v = getState(this.db, "last_block");
    return v === null ? null : Number(v);
  }

  status() {
    return { lastBlock: this.lastBlock, headBlock: this.headBlock, lastError: this.lastError };
  }

  async init() {
    const network = await this.provider.getNetwork();
    const fingerprint = (this.fingerprint = `${network.chainId}:${this.contracts.JobEscrow.address}`);
    const stored = getState(this.db, "fingerprint");
    if (stored !== fingerprint) {
      if (stored) this.log.warn?.("[indexer] deployment changed, rebuilding chain data");
      resetChainData(this.db);
      setState(this.db, "fingerprint", fingerprint);
    }
  }

  start() {
    const tick = async () => {
      try {
        await this.syncOnce();
        this.lastError = null;
      } catch (e) {
        this.lastError = e.message;
        this.log.error?.("[indexer] sync failed:", e.message);
      }
      if (this.running) this.timer = setTimeout(tick, this.pollMs);
    };
    this.running = true;
    tick();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
  }

  async syncOnce() {
    const head = await this.provider.getBlockNumber();
    this.headBlock = head;

    let last = this.lastBlock;
    if (last !== null && head < last) {
      this.log.warn?.("[indexer] chain head is behind the cursor (chain reset?), rebuilding");
      resetChainData(this.db);
      setState(this.db, "fingerprint", this.fingerprint);
      last = null;
    }

    const target = head - this.confirmations;
    let from = last === null ? this.startBlock : last + 1;
    let processed = 0;
    while (from <= target) {
      const to = Math.min(from + this.chunkBlocks - 1, target);
      try {
        await this.processRange(from, to);
      } catch (e) {
        // Providers cap the block range of eth_getLogs (some as low as 10). Back off and retry smaller.
        if (e.fromGetLogs && this.chunkBlocks > MIN_CHUNK) {
          this.chunkBlocks = Math.max(MIN_CHUNK, Math.floor(this.chunkBlocks / 2));
          this.log.warn?.(`[indexer] getLogs rejected the range, retrying with ${this.chunkBlocks} blocks per request`);
          continue;
        }
        throw e;
      }
      processed += to - from + 1;
      from = to + 1;
    }
    return processed;
  }

  async blockTimestamp(n) {
    if (this.tsCache.has(n)) return this.tsCache.get(n);
    const block = await this.provider.getBlock(n);
    this.tsCache.set(n, block.timestamp);
    if (this.tsCache.size > 500) this.tsCache.delete(this.tsCache.keys().next().value);
    return block.timestamp;
  }

  async processRange(fromBlock, toBlock) {
    let logs;
    try {
      logs = await this.provider.getLogs({
        address: Object.values(this.contracts).map((c) => c.address),
        fromBlock,
        toBlock,
      });
    } catch (e) {
      e.fromGetLogs = true;
      throw e;
    }
    logs.sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);

    // Fetch everything async first, then apply synchronously inside one DB transaction.
    const events = [];
    const txHashes = new Set();
    for (const log of logs) {
      const c = this.byAddress[lc(log.address)];
      if (!c) continue;
      const parsed = c.iface.parseLog({ topics: [...log.topics], data: log.data });
      if (!parsed) continue;
      events.push({
        id: `${log.transactionHash}:${log.index}`,
        block: log.blockNumber,
        logIndex: log.index,
        txHash: log.transactionHash,
        contract: c.name,
        name: parsed.name,
        args: jsonSafe(parsed.args, parsed.fragment),
      });
      txHashes.add(log.transactionHash);
    }

    const blockTs = new Map();
    for (const e of events) {
      if (!blockTs.has(e.block)) blockTs.set(e.block, await this.blockTimestamp(e.block));
      e.ts = blockTs.get(e.block);
    }

    const txs = new Map();
    for (const hash of txHashes) {
      const [tx, receipt] = await Promise.all([this.provider.getTransaction(hash), this.provider.getTransactionReceipt(hash)]);
      let method = tx.to ? "unknown" : "deploy"; // no `to` means a contract creation
      const c = tx.to ? this.byAddress[lc(tx.to)] : null;
      if (c) {
        const p = c.iface.parseTransaction({ data: tx.data, value: tx.value });
        if (p) method = p.name;
      }
      txs.set(hash, {
        hash,
        block: receipt.blockNumber,
        ts: blockTs.get(receipt.blockNumber) ?? (await this.blockTimestamp(receipt.blockNumber)),
        from: lc(tx.from),
        to: lc(tx.to),
        method,
        value: tx.value.toString(),
        gasUsed: Number(receipt.gasUsed),
        gasPrice: (receipt.gasPrice ?? tx.gasPrice ?? 0n).toString(),
        success: receipt.status === 1 ? 1 : 0,
      });
    }

    // JobCreated needs per-milestone amounts and the fee snapshot, which the event does not carry.
    const created = new Map();
    for (const e of events) {
      if (e.name === "JobCreated") {
        const id = BigInt(e.args.jobId);
        const [milestones, job] = await Promise.all([this.escrowContract.getMilestones(id), this.escrowContract.getJob(id)]);
        created.set(e.args.jobId, { amounts: milestones.map((m) => m.amount.toString()), feeBps: Number(job.feeBps) });
      }
    }

    transaction(this.db, () => {
      for (const t of txs.values()) this.insertTx(t);
      for (const e of events) {
        this.insertEvent(e, txs.get(e.txHash));
        this.apply(e, created);
      }
      setState(this.db, "last_block", toBlock);
    });

    if (events.length) this.log.info?.(`[indexer] blocks ${fromBlock}-${toBlock}: ${events.length} events`);
  }

  insertTx(t) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO txs(hash, block, ts, from_addr, to_addr, method, value, gas_used, gas_price, success)
         VALUES(?,?,?,?,?,?,?,?,?,?)`
      )
      .run(t.hash, t.block, t.ts, t.from, t.to, t.method, t.value, t.gasUsed, t.gasPrice, t.success);
  }

  insertEvent(e, tx) {
    const jobId = e.args.jobId !== undefined ? Number(e.args.jobId) : null;
    const disputeId = e.args.disputeId !== undefined ? Number(e.args.disputeId) : null;
    this.db
      .prepare(
        `INSERT OR REPLACE INTO events(id, block, log_index, ts, contract, name, job_id, dispute_id, actor, tx_hash, args)
         VALUES(?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(e.id, e.block, e.logIndex, e.ts, e.contract, e.name, jobId, disputeId, tx ? tx.from : null, e.txHash, JSON.stringify(e.args));
  }

  // ---- reducer -------------------------------------------------------------

  apply(e, created) {
    const a = e.args;
    const db = this.db;
    const jobId = a.jobId !== undefined ? Number(a.jobId) : null;
    const touch = (sql, ...params) => db.prepare(sql).run(...params);

    switch (e.name) {
      case "JobCreated": {
        const info = created.get(a.jobId);
        touch(
          `INSERT OR REPLACE INTO jobs(id, client, status, total_amount, fee_bps, milestone_count, description_hash, created_at, updated_at)
           VALUES(?,?,?,?,?,?,?,?,?)`,
          jobId, lc(a.client), 0, a.totalAmount, info.feeBps, Number(a.milestoneCount), a.descriptionHash, e.ts, e.ts
        );
        info.amounts.forEach((amount, idx) => touch("INSERT OR REPLACE INTO milestones(job_id, idx, amount, status) VALUES(?,?,?,0)", jobId, idx, amount));
        break;
      }
      case "JobFunded":
        touch("UPDATE jobs SET status = 1, funded_at = ?, updated_at = ? WHERE id = ?", e.ts, e.ts, jobId);
        break;
      case "JobAccepted":
        touch("UPDATE jobs SET status = 2, freelancer = ?, accepted_at = ?, updated_at = ? WHERE id = ?", lc(a.freelancer), e.ts, e.ts, jobId);
        break;
      case "JobCancelled":
        touch("UPDATE jobs SET status = 5, updated_at = ? WHERE id = ?", e.ts, jobId);
        break;
      case "MilestoneSubmitted":
        touch(
          "UPDATE milestones SET status = 1, submitted_at = ?, deliverable_hash = ? WHERE job_id = ? AND idx = ?",
          e.ts, a.deliverableHash, jobId, Number(a.milestoneIdx)
        );
        touch("UPDATE jobs SET updated_at = ? WHERE id = ?", e.ts, jobId);
        break;
      case "MilestoneApproved":
        touch(
          "UPDATE milestones SET status = 2, payout = ?, fee = ?, via_timeout = ? WHERE job_id = ? AND idx = ?",
          a.payout, a.fee, a.viaTimeout ? 1 : 0, jobId, Number(a.milestoneIdx)
        );
        touch("UPDATE jobs SET updated_at = ? WHERE id = ?", e.ts, jobId);
        break;
      case "JobCompleted":
        touch("UPDATE jobs SET status = 4, completed_at = ?, updated_at = ? WHERE id = ?", e.ts, e.ts, jobId);
        break;
      case "JobDisputed":
        touch("UPDATE milestones SET status = 3 WHERE job_id = ? AND idx = ?", jobId, Number(a.milestoneIdx));
        touch("UPDATE jobs SET status = 3, updated_at = ? WHERE id = ?", e.ts, jobId);
        break;
      case "DisputeApplied":
        if (a.favorFreelancer) touch("UPDATE jobs SET status = 2, updated_at = ? WHERE id = ?", e.ts, jobId);
        else touch("UPDATE milestones SET status = 4 WHERE job_id = ? AND idx = ?", jobId, Number(a.milestoneIdx));
        break;
      case "JobTerminated":
        touch("UPDATE jobs SET status = 6, completed_at = ?, updated_at = ? WHERE id = ?", e.ts, e.ts, jobId);
        break;
      case "JobRated":
        touch("INSERT OR REPLACE INTO ratings(job_id, rater, ratee, score, ts) VALUES(?,?,?,?,?)", jobId, lc(a.rater), lc(a.ratee), Number(a.score), e.ts);
        break;
      case "JobFlagged":
        touch("UPDATE jobs SET flagged = 1, updated_at = ? WHERE id = ?", e.ts, jobId);
        break;

      case "DisputeRaised":
        touch(
          `INSERT OR REPLACE INTO disputes(id, job_id, milestone_idx, raised_by, reason_hash, created_at, voting_deadline)
           VALUES(?,?,?,?,?,?,?)`,
          Number(a.disputeId), jobId, Number(a.milestoneIdx), lc(a.raisedBy), a.reasonHash, e.ts, Number(a.votingDeadline)
        );
        break;
      case "VoteCast": {
        const col = a.favorFreelancer ? "votes_freelancer" : "votes_client";
        touch("INSERT OR REPLACE INTO votes(dispute_id, arbiter, favor_freelancer, ts) VALUES(?,?,?,?)", Number(a.disputeId), lc(a.arbiter), a.favorFreelancer ? 1 : 0, e.ts);
        touch(`UPDATE disputes SET ${col} = ${col} + 1 WHERE id = ?`, Number(a.disputeId));
        break;
      }
      case "DisputeResolved":
        touch("UPDATE disputes SET status = 1, freelancer_won = ?, resolved_at = ? WHERE id = ?", a.freelancerWon ? 1 : 0, e.ts, Number(a.disputeId));
        break;

      case "RoleGranted":
        touch("INSERT OR IGNORE INTO roles(contract, role, account) VALUES(?,?,?)", e.contract, a.role, lc(a.account));
        break;
      case "RoleRevoked":
        touch("DELETE FROM roles WHERE contract = ? AND role = ? AND account = ?", e.contract, a.role, lc(a.account));
        break;
      default:
        break; // logged in events table only
    }
  }
}

module.exports = { Indexer, JOB_STATUS, MILESTONE_STATUS, ROLE_HASH };
