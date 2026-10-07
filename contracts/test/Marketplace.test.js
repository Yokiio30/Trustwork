const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time, loadFixture } = require("@nomicfoundation/hardhat-network-helpers");

const FEE_BPS = 100n; // 1%
const REVIEW = 3 * 24 * 3600;
const VOTING = 7 * 24 * 3600;
const eth = (v) => ethers.parseEther(v);
const h = (s) => ethers.id(s);

// JobStatus / MilestoneStatus enum values
const JS = { Open: 0, Funded: 1, InProgress: 2, Disputed: 3, Completed: 4, Cancelled: 5, Terminated: 6 };
const MS = { Pending: 0, Submitted: 1, Approved: 2, Disputed: 3, Refunded: 4 };

async function deployFixture() {
  const [admin, client, freelancer, arb1, arb2, arb3, auditor, other] = await ethers.getSigners();

  const reputation = await (await ethers.getContractFactory("Reputation")).deploy(admin.address);
  const escrow = await (await ethers.getContractFactory("JobEscrow")).deploy(admin.address, await reputation.getAddress(), FEE_BPS, REVIEW);
  const disputes = await (await ethers.getContractFactory("DisputeResolution")).deploy(admin.address, await escrow.getAddress(), VOTING);

  await escrow.setDisputeResolution(await disputes.getAddress());
  await reputation.grantRole(await reputation.ESCROW_ROLE(), await escrow.getAddress());
  await escrow.grantRole(await escrow.AUDITOR_ROLE(), auditor.address);
  const ARBITER_ROLE = await disputes.ARBITER_ROLE();
  for (const a of [arb1, arb2, arb3]) await disputes.grantRole(ARBITER_ROLE, a.address);

  return { admin, client, freelancer, arb1, arb2, arb3, auditor, other, reputation, escrow, disputes };
}

// job with two milestones (1 ETH + 2 ETH), funded and accepted
async function inProgressFixture() {
  const ctx = await deployFixture();
  const { escrow, client, freelancer } = ctx;
  await escrow.connect(client).createJob(h("build site"), [eth("1"), eth("2")]);
  await escrow.connect(client).fundJob(1, { value: eth("3") });
  await escrow.connect(freelancer).acceptJob(1);
  return ctx;
}

async function submittedFixture() {
  const ctx = await inProgressFixture();
  await ctx.escrow.connect(ctx.freelancer).submitMilestone(1, 0, h("v1"));
  return ctx;
}

async function disputedFixture() {
  const ctx = await submittedFixture();
  await ctx.disputes.connect(ctx.client).raiseDispute(1, 0, h("not as agreed"));
  return ctx;
}

describe("Deployment & access control", () => {
  it("wires the three contracts together", async () => {
    const { escrow, disputes, reputation, admin } = await loadFixture(deployFixture);
    expect(await escrow.disputeResolution()).to.equal(await disputes.getAddress());
    expect(await escrow.reputation()).to.equal(await reputation.getAddress());
    expect(await disputes.escrow()).to.equal(await escrow.getAddress());
    expect(await escrow.hasRole(await escrow.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(true);
    expect(await disputes.arbiterCount()).to.equal(3n);
  });

  it("rejects bad constructor arguments", async () => {
    const [admin] = await ethers.getSigners();
    const Escrow = await ethers.getContractFactory("JobEscrow");
    await expect(Escrow.deploy(admin.address, admin.address, 501, REVIEW)).to.be.revertedWithCustomError(Escrow, "FeeTooHigh");
    await expect(Escrow.deploy(admin.address, admin.address, 100, 10)).to.be.revertedWithCustomError(Escrow, "ReviewPeriodTooShort");
    await expect(Escrow.deploy(ethers.ZeroAddress, admin.address, 100, REVIEW)).to.be.revertedWithCustomError(Escrow, "ZeroAddress");
  });

  it("only admin can change fee, review period and dispute contract", async () => {
    const { escrow, other, admin } = await loadFixture(deployFixture);
    await expect(escrow.connect(other).setPlatformFee(200)).to.be.revertedWithCustomError(escrow, "AccessControlUnauthorizedAccount");
    await expect(escrow.connect(other).setReviewPeriod(3600)).to.be.revertedWithCustomError(escrow, "AccessControlUnauthorizedAccount");
    await expect(escrow.connect(other).setDisputeResolution(other.address)).to.be.revertedWithCustomError(escrow, "AccessControlUnauthorizedAccount");
    await expect(escrow.connect(admin).setPlatformFee(501)).to.be.revertedWithCustomError(escrow, "FeeTooHigh");
    await expect(escrow.connect(admin).setPlatformFee(200)).to.emit(escrow, "PlatformFeeUpdated").withArgs(200);
    await expect(escrow.connect(admin).setReviewPeriod(3600)).to.emit(escrow, "ReviewPeriodUpdated").withArgs(3600);
  });

  it("only JobEscrow can write reputation", async () => {
    const { reputation, other } = await loadFixture(deployFixture);
    await expect(reputation.connect(other).recordRating(other.address, 5)).to.be.revertedWithCustomError(reputation, "AccessControlUnauthorizedAccount");
  });

  it("dispute hooks on escrow are closed to everyone but DisputeResolution", async () => {
    const { escrow, other } = await loadFixture(submittedFixture);
    await expect(escrow.connect(other).markDisputed(1, 0)).to.be.revertedWithCustomError(escrow, "NotDisputeResolution");
    await expect(escrow.connect(other).applyResolution(1, 0, true)).to.be.revertedWithCustomError(escrow, "NotDisputeResolution");
  });
});

describe("Job lifecycle", () => {
  it("createJob stores milestones and emits JobCreated", async () => {
    const { escrow, client } = await loadFixture(deployFixture);
    await expect(escrow.connect(client).createJob(h("d"), [eth("1"), eth("2")]))
      .to.emit(escrow, "JobCreated")
      .withArgs(1, client.address, eth("3"), 2, h("d"));
    const job = await escrow.getJob(1);
    expect(job.status).to.equal(JS.Open);
    expect(job.totalAmount).to.equal(eth("3"));
    expect(job.feeBps).to.equal(FEE_BPS);
    expect((await escrow.getMilestones(1)).length).to.equal(2);
  });

  it("validates milestone input", async () => {
    const { escrow, client } = await loadFixture(deployFixture);
    await expect(escrow.connect(client).createJob(h("d"), [])).to.be.revertedWithCustomError(escrow, "InvalidMilestone");
    await expect(escrow.connect(client).createJob(h("d"), Array(6).fill(eth("1")))).to.be.revertedWithCustomError(escrow, "InvalidMilestone");
    await expect(escrow.connect(client).createJob(h("d"), [eth("1"), 0])).to.be.revertedWithCustomError(escrow, "InvalidAmount");
  });

  it("fundJob requires the exact amount and the client", async () => {
    const { escrow, client, other } = await loadFixture(deployFixture);
    await escrow.connect(client).createJob(h("d"), [eth("1")]);
    await expect(escrow.connect(other).fundJob(1, { value: eth("1") })).to.be.revertedWithCustomError(escrow, "NotClient");
    await expect(escrow.connect(client).fundJob(1, { value: eth("0.5") })).to.be.revertedWithCustomError(escrow, "InvalidAmount");
    await expect(escrow.connect(client).fundJob(1, { value: eth("1") })).to.emit(escrow, "JobFunded").withArgs(1, client.address, eth("1"));
    await expect(escrow.connect(client).fundJob(1, { value: eth("1") })).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(eth("1"));
  });

  it("unknown jobs revert", async () => {
    const { escrow, client } = await loadFixture(deployFixture);
    await expect(escrow.connect(client).fundJob(99, { value: 1 })).to.be.revertedWithCustomError(escrow, "UnknownJob");
    await expect(escrow.getJob(99)).to.be.revertedWithCustomError(escrow, "UnknownJob");
  });

  it("client can cancel a funded job and withdraw the refund", async () => {
    const { escrow, client } = await loadFixture(deployFixture);
    await escrow.connect(client).createJob(h("d"), [eth("1")]);
    await escrow.connect(client).fundJob(1, { value: eth("1") });
    await expect(escrow.connect(client).cancelJob(1)).to.emit(escrow, "JobCancelled").withArgs(1, eth("1"));
    expect((await escrow.getJob(1)).status).to.equal(JS.Cancelled);
    await expect(escrow.connect(client).withdraw()).to.changeEtherBalances([client, escrow], [eth("1"), -eth("1")]);
  });

  it("cannot cancel after a freelancer accepted", async () => {
    const { escrow, client } = await loadFixture(inProgressFixture);
    await expect(escrow.connect(client).cancelJob(1)).to.be.revertedWithCustomError(escrow, "InvalidStatus");
  });

  it("cannot accept unfunded jobs or your own job", async () => {
    const { escrow, client, freelancer } = await loadFixture(deployFixture);
    await escrow.connect(client).createJob(h("d"), [eth("1")]);
    await expect(escrow.connect(freelancer).acceptJob(1)).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    await escrow.connect(client).fundJob(1, { value: eth("1") });
    await expect(escrow.connect(client).acceptJob(1)).to.be.revertedWithCustomError(escrow, "SelfDealing");
    await escrow.connect(freelancer).acceptJob(1);
    await expect(escrow.connect(freelancer).acceptJob(1)).to.be.revertedWithCustomError(escrow, "InvalidStatus");
  });

  it("milestones must be submitted in order by the freelancer", async () => {
    const { escrow, freelancer, client } = await loadFixture(inProgressFixture);
    await expect(escrow.connect(client).submitMilestone(1, 0, h("x"))).to.be.revertedWithCustomError(escrow, "NotFreelancer");
    await expect(escrow.connect(freelancer).submitMilestone(1, 1, h("x"))).to.be.revertedWithCustomError(escrow, "InvalidMilestone");
    await expect(escrow.connect(freelancer).submitMilestone(1, 0, h("v1")))
      .to.emit(escrow, "MilestoneSubmitted")
      .withArgs(1, 0, h("v1"));
    await expect(escrow.connect(freelancer).submitMilestone(1, 0, h("v1"))).to.be.revertedWithCustomError(escrow, "InvalidStatus");
  });

  it("happy path: approve both milestones, fee accrues, freelancer withdraws", async () => {
    const { escrow, client, freelancer, admin, reputation } = await loadFixture(submittedFixture);

    await expect(escrow.connect(client).approveMilestone(1, 0))
      .to.emit(escrow, "MilestoneApproved")
      .withArgs(1, 0, eth("0.99"), eth("0.01"), false);
    await escrow.connect(freelancer).submitMilestone(1, 1, h("v2"));
    await expect(escrow.connect(client).approveMilestone(1, 1)).to.emit(escrow, "JobCompleted").withArgs(1);

    const job = await escrow.getJob(1);
    expect(job.status).to.equal(JS.Completed);
    expect(job.remaining).to.equal(0n);
    expect(await escrow.balances(freelancer.address)).to.equal(eth("2.97"));
    expect(await escrow.accruedFees()).to.equal(eth("0.03"));

    await expect(escrow.connect(freelancer).withdraw()).to.changeEtherBalances([freelancer, escrow], [eth("2.97"), -eth("2.97")]);
    await expect(escrow.connect(admin).withdrawFees(admin.address)).to.changeEtherBalance(admin, eth("0.03"));
    expect(await ethers.provider.getBalance(await escrow.getAddress())).to.equal(0n);

    expect((await reputation.getRecord(client.address)).jobsCompleted).to.equal(1n);
    expect((await reputation.getRecord(freelancer.address)).jobsCompleted).to.equal(1n);
  });

  it("fee is snapshotted at job creation", async () => {
    const { escrow, client, freelancer, admin } = await loadFixture(inProgressFixture);
    await escrow.connect(admin).setPlatformFee(500);
    await escrow.connect(freelancer).submitMilestone(1, 0, h("v1"));
    await expect(escrow.connect(client).approveMilestone(1, 0)).to.emit(escrow, "MilestoneApproved").withArgs(1, 0, eth("0.99"), eth("0.01"), false);
  });

  it("only the client can approve, and only submitted milestones", async () => {
    const { escrow, client, freelancer } = await loadFixture(inProgressFixture);
    await expect(escrow.connect(client).approveMilestone(1, 0)).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    await escrow.connect(freelancer).submitMilestone(1, 0, h("v1"));
    await expect(escrow.connect(freelancer).approveMilestone(1, 0)).to.be.revertedWithCustomError(escrow, "NotClient");
    await expect(escrow.connect(client).approveMilestone(1, 5)).to.be.revertedWithCustomError(escrow, "InvalidMilestone");
  });

  it("withdraw with nothing credited reverts", async () => {
    const { escrow, other } = await loadFixture(deployFixture);
    await expect(escrow.connect(other).withdraw()).to.be.revertedWithCustomError(escrow, "NothingToWithdraw");
  });

  it("withdrawFees: admin only, non-zero only", async () => {
    const { escrow, other, admin } = await loadFixture(deployFixture);
    await expect(escrow.connect(other).withdrawFees(other.address)).to.be.revertedWithCustomError(escrow, "AccessControlUnauthorizedAccount");
    await expect(escrow.connect(admin).withdrawFees(admin.address)).to.be.revertedWithCustomError(escrow, "NothingToWithdraw");
  });
});

describe("Timeout claim", () => {
  it("freelancer cannot claim before the review period", async () => {
    const { escrow, freelancer } = await loadFixture(submittedFixture);
    await expect(escrow.connect(freelancer).claimTimeout(1, 0)).to.be.revertedWithCustomError(escrow, "ReviewPeriodNotElapsed");
  });

  it("freelancer claims after the review period; client cannot claim", async () => {
    const { escrow, freelancer, client } = await loadFixture(submittedFixture);
    await time.increase(REVIEW);
    await expect(escrow.connect(client).claimTimeout(1, 0)).to.be.revertedWithCustomError(escrow, "NotFreelancer");
    await expect(escrow.connect(freelancer).claimTimeout(1, 0))
      .to.emit(escrow, "MilestoneApproved")
      .withArgs(1, 0, eth("0.99"), eth("0.01"), true);
    expect((await escrow.getJob(1)).nextMilestone).to.equal(1);
  });

  it("dispute cannot be raised after the review period", async () => {
    const { disputes, escrow, client } = await loadFixture(submittedFixture);
    await time.increase(REVIEW);
    await expect(disputes.connect(client).raiseDispute(1, 0, h("late"))).to.be.revertedWithCustomError(escrow, "ReviewPeriodElapsed");
  });
});

describe("Disputes", () => {
  it("only job parties can raise a dispute", async () => {
    const { disputes, other } = await loadFixture(submittedFixture);
    await expect(disputes.connect(other).raiseDispute(1, 0, h("r"))).to.be.revertedWithCustomError(disputes, "NotParty");
  });

  it("raising a dispute freezes the job", async () => {
    const { disputes, escrow, client, freelancer } = await loadFixture(submittedFixture);
    await expect(disputes.connect(client).raiseDispute(1, 0, h("bad")))
      .to.emit(disputes, "DisputeRaised");
    expect((await escrow.getJob(1)).status).to.equal(JS.Disputed);
    expect((await escrow.getMilestones(1))[0].status).to.equal(MS.Disputed);
    await expect(escrow.connect(client).approveMilestone(1, 0)).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    await expect(escrow.connect(freelancer).claimTimeout(1, 0)).to.be.revertedWithCustomError(escrow, "InvalidStatus");
    // a second dispute on the same milestone is impossible
    await expect(disputes.connect(freelancer).raiseDispute(1, 0, h("again"))).to.be.revertedWithCustomError(escrow, "InvalidStatus");
  });

  it("cannot dispute a milestone that was not submitted", async () => {
    const { disputes, escrow, client } = await loadFixture(inProgressFixture);
    await expect(disputes.connect(client).raiseDispute(1, 0, h("r"))).to.be.revertedWithCustomError(escrow, "InvalidStatus");
  });

  it("parties can submit evidence, outsiders cannot", async () => {
    const { disputes, client, freelancer, other } = await loadFixture(disputedFixture);
    await expect(disputes.connect(client).submitEvidence(1, h("e1"), "screenshot")).to.emit(disputes, "EvidenceSubmitted").withArgs(1, client.address, h("e1"), "screenshot");
    await expect(disputes.connect(freelancer).submitEvidence(1, h("e2"), "repo link")).to.emit(disputes, "EvidenceSubmitted");
    await expect(disputes.connect(other).submitEvidence(1, h("e3"), "x")).to.be.revertedWithCustomError(disputes, "NotParty");
  });

  it("only arbiters vote, once, and never on their own job", async () => {
    const { disputes, other, arb1, escrow, client, admin } = await loadFixture(disputedFixture);
    await expect(disputes.connect(other).castVote(1, true)).to.be.revertedWithCustomError(disputes, "AccessControlUnauthorizedAccount");
    await disputes.connect(arb1).castVote(1, true);
    await expect(disputes.connect(arb1).castVote(1, true)).to.be.revertedWithCustomError(disputes, "AlreadyVoted");

    // client turned arbiter still cannot judge their own dispute
    await disputes.connect(admin).grantRole(await disputes.ARBITER_ROLE(), client.address);
    await expect(disputes.connect(client).castVote(1, false)).to.be.revertedWithCustomError(disputes, "ConflictOfInterest");
    void escrow;
  });

  it("cannot execute before quorum or deadline", async () => {
    const { disputes, arb1 } = await loadFixture(disputedFixture);
    await disputes.connect(arb1).castVote(1, true);
    await expect(disputes.executeResolution(1)).to.be.revertedWithCustomError(disputes, "VotingStillOpen");
  });

  it("freelancer wins with 2 votes: milestone paid, job continues, reputation updated", async () => {
    const { disputes, escrow, reputation, client, freelancer, arb1, arb2 } = await loadFixture(disputedFixture);
    await disputes.connect(arb1).castVote(1, true);
    await disputes.connect(arb2).castVote(1, true);
    await expect(disputes.executeResolution(1)).to.emit(disputes, "DisputeResolved").withArgs(1, 1, true);

    const job = await escrow.getJob(1);
    expect(job.status).to.equal(JS.InProgress);
    expect(job.nextMilestone).to.equal(1);
    expect(await escrow.balances(freelancer.address)).to.equal(eth("0.99"));
    expect((await reputation.getRecord(freelancer.address)).disputesWon).to.equal(1n);
    expect((await reputation.getRecord(client.address)).disputesLost).to.equal(1n);
    await expect(disputes.executeResolution(1)).to.be.revertedWithCustomError(disputes, "InvalidStatus");

    // job can still finish normally
    await escrow.connect(freelancer).submitMilestone(1, 1, h("v2"));
    await escrow.connect(client).approveMilestone(1, 1);
    expect((await escrow.getJob(1)).status).to.equal(JS.Completed);
  });

  it("client wins with 2 votes: all remaining funds refunded, job terminated", async () => {
    const { disputes, escrow, client, arb1, arb2, arb3 } = await loadFixture(disputedFixture);
    await disputes.connect(arb1).castVote(1, false);
    await disputes.connect(arb2).castVote(1, true);
    await disputes.connect(arb3).castVote(1, false);
    await expect(disputes.executeResolution(1)).to.emit(escrow, "JobTerminated").withArgs(1, eth("3"));

    const job = await escrow.getJob(1);
    expect(job.status).to.equal(JS.Terminated);
    expect(job.remaining).to.equal(0n);
    await expect(escrow.connect(client).withdraw()).to.changeEtherBalance(client, eth("3"));
  });

  it("after the deadline the plurality decides; a tie favors the client", async () => {
    const { disputes, escrow, arb1 } = await loadFixture(disputedFixture);
    await disputes.connect(arb1).castVote(1, true);
    await time.increase(VOTING + 1);
    await expect(disputes.executeResolution(1)).to.emit(disputes, "DisputeResolved").withArgs(1, 1, true);
    expect((await escrow.getJob(1)).status).to.equal(JS.InProgress);
  });

  it("no votes at all resolves for the client after the deadline", async () => {
    const { disputes, escrow } = await loadFixture(disputedFixture);
    await time.increase(VOTING + 1);
    await expect(disputes.executeResolution(1)).to.emit(disputes, "DisputeResolved").withArgs(1, 1, false);
    expect((await escrow.getJob(1)).status).to.equal(JS.Terminated);
  });

  it("voting closes at the deadline", async () => {
    const { disputes, arb1 } = await loadFixture(disputedFixture);
    await time.increase(VOTING + 1);
    await expect(disputes.connect(arb1).castVote(1, true)).to.be.revertedWithCustomError(disputes, "VotingClosed");
  });

  it("unknown dispute reverts", async () => {
    const { disputes, arb1 } = await loadFixture(deployFixture);
    await expect(disputes.connect(arb1).castVote(9, true)).to.be.revertedWithCustomError(disputes, "UnknownDispute");
  });
});

describe("Ratings & auditing", () => {
  async function completedFixture() {
    const ctx = await submittedFixture();
    await ctx.escrow.connect(ctx.client).approveMilestone(1, 0);
    await ctx.escrow.connect(ctx.freelancer).submitMilestone(1, 1, h("v2"));
    await ctx.escrow.connect(ctx.client).approveMilestone(1, 1);
    return ctx;
  }

  it("both parties rate once; averages are computed", async () => {
    const { escrow, reputation, client, freelancer } = await loadFixture(completedFixture);
    await expect(escrow.connect(client).rateCounterparty(1, 5)).to.emit(escrow, "JobRated").withArgs(1, client.address, freelancer.address, 5);
    await expect(escrow.connect(client).rateCounterparty(1, 4)).to.be.revertedWithCustomError(escrow, "AlreadyRated");
    await escrow.connect(freelancer).rateCounterparty(1, 4);
    expect(await reputation.averageRatingX100(freelancer.address)).to.equal(500n);
    expect(await reputation.averageRatingX100(client.address)).to.equal(400n);
  });

  it("rating validation", async () => {
    const { escrow, client, other } = await loadFixture(completedFixture);
    await expect(escrow.connect(client).rateCounterparty(1, 0)).to.be.revertedWithCustomError(escrow, "InvalidScore");
    await expect(escrow.connect(client).rateCounterparty(1, 6)).to.be.revertedWithCustomError(escrow, "InvalidScore");
    await expect(escrow.connect(other).rateCounterparty(1, 5)).to.be.revertedWithCustomError(escrow, "NotParty");
  });

  it("cannot rate an unfinished job", async () => {
    const { escrow, client } = await loadFixture(inProgressFixture);
    await expect(escrow.connect(client).rateCounterparty(1, 5)).to.be.revertedWithCustomError(escrow, "InvalidStatus");
  });

  it("unrated users have an average of zero", async () => {
    const { reputation, other } = await loadFixture(deployFixture);
    expect(await reputation.averageRatingX100(other.address)).to.equal(0n);
  });

  it("auditor can flag a job; others cannot", async () => {
    const { escrow, auditor, other } = await loadFixture(inProgressFixture);
    await expect(escrow.connect(other).flagJob(1, h("suspicious"))).to.be.revertedWithCustomError(escrow, "AccessControlUnauthorizedAccount");
    await expect(escrow.connect(auditor).flagJob(1, h("suspicious"))).to.emit(escrow, "JobFlagged").withArgs(1, auditor.address, h("suspicious"));
    expect((await escrow.getJob(1)).flagged).to.equal(true);
  });
});

describe("Invariant: escrow balance accounting", () => {
  it("contract balance always equals remaining + credited balances + fees", async () => {
    const { escrow, client, freelancer, arb1, arb2, disputes } = await loadFixture(deployFixture);
    const addr = await escrow.getAddress();
    const check = async () => {
      let owed = await escrow.accruedFees();
      for (let id = 1n; id <= (await escrow.jobCount()); id++) owed += (await escrow.getJob(id)).remaining;
      for (const s of [client, freelancer]) owed += await escrow.balances(s.address);
      expect(await ethers.provider.getBalance(addr)).to.equal(owed);
    };

    await escrow.connect(client).createJob(h("a"), [eth("1"), eth("1")]);
    await escrow.connect(client).fundJob(1, { value: eth("2") });
    await check();
    await escrow.connect(freelancer).acceptJob(1);
    await escrow.connect(freelancer).submitMilestone(1, 0, h("1"));
    await escrow.connect(client).approveMilestone(1, 0);
    await check();
    await escrow.connect(freelancer).submitMilestone(1, 1, h("2"));
    await disputes.connect(client).raiseDispute(1, 1, h("x"));
    await disputes.connect(arb1).castVote(1, false);
    await disputes.connect(arb2).castVote(1, false);
    await disputes.executeResolution(1);
    await check();
    await escrow.connect(client).withdraw();
    await escrow.connect(freelancer).withdraw();
    await check();
  });
});
