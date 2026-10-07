// Turns contract reverts, wallet rejections and API errors into messages a user can act on.
const CUSTOM = {
  NotClient: "Only the client of this job can do that.",
  NotFreelancer: "Only the freelancer on this job can do that.",
  NotParty: "Only the client or freelancer of this job can do that.",
  SelfDealing: "You cannot accept your own job.",
  InvalidStatus: "This action is not available in the job's current state.",
  InvalidAmount: "The amount is not valid. Fund the exact total of the job.",
  InvalidMilestone: "That milestone is not valid or not next in order.",
  ReviewPeriodNotElapsed: "The client's review period has not ended yet.",
  ReviewPeriodElapsed: "The review period has ended, so a dispute can no longer be raised.",
  NothingToWithdraw: "There is nothing to withdraw.",
  TransferFailed: "The transfer failed.",
  FeeTooHigh: "That fee is above the 5% maximum.",
  ReviewPeriodTooShort: "The period is below the 1 minute minimum.",
  VotingPeriodTooShort: "The period is below the 1 minute minimum.",
  NotDisputeResolution: "Only the dispute contract can do that.",
  AlreadyRated: "You have already rated this job.",
  InvalidScore: "Ratings must be between 1 and 5.",
  UnknownJob: "That job does not exist.",
  UnknownDispute: "That dispute does not exist.",
  AlreadyVoted: "You have already voted on this dispute.",
  VotingClosed: "Voting on this dispute has closed.",
  VotingStillOpen: "Voting is still open and no side has enough votes yet.",
  ConflictOfInterest: "You are a party to this job and cannot judge it.",
  AccessControlUnauthorizedAccount: "Your account does not have the required role for this action.",
  ZeroAddress: "An address is missing.",
};

export class UserCancelled extends Error {
  constructor() {
    super("Cancelled");
    this.name = "UserCancelled";
  }
}

export function friendlyError(e) {
  if (!e) return "Something went wrong.";
  if (e instanceof UserCancelled) return "Cancelled.";
  if (e.code === "ACTION_REJECTED" || e.info?.error?.code === 4001) return "You rejected the request in your wallet.";
  const name = e.revert?.name || e.errorName;
  if (name && CUSTOM[name]) return CUSTOM[name];
  if (e.code === "INSUFFICIENT_FUNDS") return "Not enough ETH in this account to pay for the transaction.";
  if (e.code === "NETWORK_ERROR") return "Wallet network error. Check that you are on the right network.";
  const msg = e.shortMessage || e.reason || e.message || "Something went wrong.";
  return msg.length > 220 ? `${msg.slice(0, 220)}…` : msg;
}
