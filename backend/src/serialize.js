const { JOB_STATUS, MILESTONE_STATUS } = require("./indexer");

function parseJson(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function metadataFor(db, hash) {
  const doc = db.prepare("SELECT content FROM documents WHERE hash = ? AND kind = 'job'").get(hash);
  return doc ? parseJson(doc.content) : null;
}

function job(db, r) {
  return {
    id: r.id,
    client: r.client,
    freelancer: r.freelancer,
    status: JOB_STATUS[r.status],
    statusCode: r.status,
    totalAmount: r.total_amount,
    feeBps: r.fee_bps,
    milestoneCount: r.milestone_count,
    descriptionHash: r.description_hash,
    metadata: metadataFor(db, r.description_hash),
    flagged: !!r.flagged,
    createdAt: r.created_at,
    fundedAt: r.funded_at,
    acceptedAt: r.accepted_at,
    completedAt: r.completed_at,
    updatedAt: r.updated_at,
  };
}

function milestone(r) {
  return {
    index: r.idx,
    amount: r.amount,
    status: MILESTONE_STATUS[r.status],
    statusCode: r.status,
    submittedAt: r.submitted_at,
    deliverableHash: r.deliverable_hash,
    payout: r.payout,
    fee: r.fee,
    viaTimeout: !!r.via_timeout,
  };
}

function dispute(r) {
  return {
    id: r.id,
    jobId: r.job_id,
    milestoneIndex: r.milestone_idx,
    raisedBy: r.raised_by,
    reasonHash: r.reason_hash,
    createdAt: r.created_at,
    votingDeadline: r.voting_deadline,
    status: r.status === 0 ? "Open" : "Resolved",
    freelancerWon: r.freelancer_won === null ? null : !!r.freelancer_won,
    votesFreelancer: r.votes_freelancer,
    votesClient: r.votes_client,
    resolvedAt: r.resolved_at,
  };
}

function event(r) {
  return {
    id: r.id,
    block: r.block,
    logIndex: r.log_index,
    timestamp: r.ts,
    contract: r.contract,
    name: r.name,
    jobId: r.job_id,
    disputeId: r.dispute_id,
    actor: r.actor,
    txHash: r.tx_hash,
    args: parseJson(r.args, {}),
  };
}

function tx(r) {
  return {
    hash: r.hash,
    block: r.block,
    timestamp: r.ts,
    from: r.from_addr,
    to: r.to_addr,
    method: r.method,
    value: r.value,
    gasUsed: r.gas_used,
    gasPrice: r.gas_price,
    success: !!r.success,
  };
}

module.exports = { job, milestone, dispute, event, tx, parseJson };
