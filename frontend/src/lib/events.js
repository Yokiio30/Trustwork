import { formatEth, shortAddr } from "./format";

const eth = (v) => `${formatEth(v)} ETH`;

/** One human sentence per on-chain event, used by timelines and the audit log. */
export function describeEvent(e) {
  const a = e.args;
  switch (e.name) {
    case "JobCreated": return `Job created: ${a.milestoneCount} milestone(s), ${eth(a.totalAmount)} total`;
    case "JobFunded": return `Client locked ${eth(a.amount)} in escrow`;
    case "JobAccepted": return `Freelancer ${shortAddr(a.freelancer)} accepted the job`;
    case "JobCancelled": return `Job cancelled${a.refunded !== "0" ? `, ${eth(a.refunded)} refunded` : ""}`;
    case "MilestoneSubmitted": return `Milestone ${Number(a.milestoneIdx) + 1} submitted for review`;
    case "MilestoneApproved":
      return `Milestone ${Number(a.milestoneIdx) + 1} paid: ${eth(a.payout)} to freelancer, ${eth(a.fee)} platform fee${a.viaTimeout ? " (review period expired)" : ""}`;
    case "JobCompleted": return "Job completed";
    case "JobDisputed": return `Milestone ${Number(a.milestoneIdx) + 1} disputed, funds frozen`;
    case "DisputeRaised": return `Dispute #${a.disputeId} opened by ${shortAddr(a.raisedBy)}`;
    case "EvidenceSubmitted": return `Evidence submitted${a.note ? `: "${a.note}"` : ""}`;
    case "VoteCast": return `Arbiter ${shortAddr(a.arbiter)} voted for the ${a.favorFreelancer ? "freelancer" : "client"}`;
    case "DisputeResolved": return `Dispute resolved in favour of the ${a.freelancerWon ? "freelancer" : "client"}`;
    case "DisputeApplied": return a.favorFreelancer ? "Verdict applied: milestone paid to freelancer" : "Verdict applied: client refunded";
    case "JobTerminated": return `Job terminated, ${eth(a.refunded)} refunded to client`;
    case "JobRated": return `${shortAddr(a.rater)} rated ${shortAddr(a.ratee)} ${a.score}/5`;
    case "JobFlagged": return `Flagged by auditor ${shortAddr(a.auditor)}`;
    case "Withdrawn": return `${shortAddr(a.account)} withdrew ${eth(a.amount)}`;
    case "FeesWithdrawn": return `Platform fees withdrawn: ${eth(a.amount)}`;
    case "PlatformFeeUpdated": return `Platform fee set to ${(Number(a.feeBps) / 100).toFixed(2)}%`;
    case "ReviewPeriodUpdated": return `Review period set to ${a.period}s`;
    case "VotingPeriodUpdated": return `Voting period set to ${a.period}s`;
    case "DisputeResolutionUpdated": return "Dispute contract updated";
    case "RoleGranted": return `Role granted to ${shortAddr(a.account)}`;
    case "RoleRevoked": return `Role revoked from ${shortAddr(a.account)}`;
    case "CompletionRecorded":
    case "RatingRecorded":
    case "DisputeRecorded": return "Reputation updated";
    default: return e.name;
  }
}

export const EVENT_NAMES = [
  "JobCreated", "JobFunded", "JobAccepted", "JobCancelled", "MilestoneSubmitted", "MilestoneApproved", "JobCompleted",
  "JobDisputed", "DisputeRaised", "EvidenceSubmitted", "VoteCast", "DisputeResolved", "DisputeApplied", "JobTerminated",
  "JobRated", "JobFlagged", "Withdrawn", "FeesWithdrawn", "RoleGranted", "RoleRevoked",
];
