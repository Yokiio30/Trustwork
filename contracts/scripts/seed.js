// Populates a local chain with a realistic demo marketplace.
//   npx hardhat node                                   (terminal 1)
//   npx hardhat run scripts/deploy.js --network localhost
//   API_URL=http://localhost:4000 npx hardhat run scripts/seed.js --network localhost
//
// Account map (Hardhat default accounts):
//   0 admin/deployer   1 client Alice   2 freelancer Bob   3 freelancer Carol
//   4,5,6 arbiters     7 auditor        8 client Dave
// If API_URL is set, job descriptions are also stored in the backend via wallet login.
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const { ethers, network } = hre;
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const eth = (v) => ethers.parseEther(v);
const API_URL = process.env.API_URL;

async function api(method, route, body, token) {
  const res = await fetch(`${API_URL}/api${route}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${route}: ${JSON.stringify(json)}`);
  return json;
}

async function login(signer) {
  const domain = "localhost:3000";
  const { message } = await api("GET", `/auth/nonce?address=${signer.address}&domain=${domain}`);
  const signature = await signer.signMessage(message);
  return (await api("POST", "/auth/login", { address: signer.address, signature, domain })).token;
}

async function main() {
  const file = path.join(__dirname, "..", "..", "shared", "deployments", `${network.name}.json`);
  const dep = JSON.parse(fs.readFileSync(file, "utf8"));
  const [admin, alice, bob, carol, arb1, arb2, arb3, auditor, dave] = await ethers.getSigners();

  const escrow = new ethers.Contract(dep.contracts.JobEscrow.address, dep.contracts.JobEscrow.abi, admin);
  const disputes = new ethers.Contract(dep.contracts.DisputeResolution.address, dep.contracts.DisputeResolution.abi, admin);
  const as = (c, s) => c.connect(s);
  const h = (s) => ethers.id(s);

  // documents to publish through the API at the end
  const docs = [];
  const doc = (signer, kind, content) => {
    docs.push({ signer, kind, content });
    return ethers.id(JSON.stringify(content));
  };

  const REVIEW = dep.config.reviewPeriod;
  const VOTING = dep.config.votingPeriod;

  for (const a of [arb1, arb2, arb3]) await (await disputes.grantRole(await disputes.ARBITER_ROLE(), a.address)).wait();
  await (await escrow.grantRole(await escrow.AUDITOR_ROLE(), auditor.address)).wait();

  const newJob = async (client, title, description, category, amounts, { fund = true } = {}) => {
    const hash = doc(client, "job", { title, description, category });
    const tx = await as(escrow, client).createJob(hash, amounts.map(eth));
    await tx.wait();
    const id = await escrow.jobCount();
    if (fund) await (await as(escrow, client).fundJob(id, { value: eth(amounts.reduce((s, a) => s + Number(a), 0).toString()) })).wait();
    return id;
  };

  // 1. Happy path with ratings
  const j1 = await newJob(alice, "Landing page redesign", "Redesign the marketing landing page in Figma and deliver responsive HTML.", "Design", ["0.4", "0.6"]);
  await (await as(escrow, bob).acceptJob(j1)).wait();
  await (await as(escrow, bob).submitMilestone(j1, 0, doc(bob, "deliverable", { text: "Figma mockups attached", links: ["https://example.com/figma/1"] }))).wait();
  await (await as(escrow, alice).approveMilestone(j1, 0)).wait();
  await (await as(escrow, bob).submitMilestone(j1, 1, doc(bob, "deliverable", { text: "Responsive HTML delivered", links: ["https://example.com/repo/1"] }))).wait();
  await (await as(escrow, alice).approveMilestone(j1, 1)).wait();
  await (await as(escrow, alice).rateCounterparty(j1, 5)).wait();
  await (await as(escrow, bob).rateCounterparty(j1, 4)).wait();
  await (await as(escrow, bob).withdraw()).wait();

  // 2. Dispute, freelancer wins
  const j2 = await newJob(dave, "Translate product docs to Chinese", "Translate 20 pages of API documentation from English to Simplified Chinese.", "Translation", ["0.3"]);
  await (await as(escrow, carol).acceptJob(j2)).wait();
  await (await as(escrow, carol).submitMilestone(j2, 0, doc(carol, "deliverable", { text: "All 20 pages translated, glossary included." }))).wait();
  await (await as(disputes, dave).raiseDispute(j2, 0, doc(dave, "dispute", { text: "Several technical terms are inconsistent." }))).wait();
  const d1 = await disputes.disputeCount();
  await (await as(disputes, carol).submitEvidence(d1, doc(carol, "evidence", { text: "Glossary was agreed in chat before the work started." }), "glossary agreement")).wait();
  await (await as(disputes, arb1).castVote(d1, true)).wait();
  await (await as(disputes, arb2).castVote(d1, true)).wait();
  await (await disputes.executeResolution(d1)).wait();
  await (await as(escrow, dave).rateCounterparty(j2, 3)).wait();
  await (await as(escrow, carol).rateCounterparty(j2, 5)).wait();

  // 3. Dispute, client wins (full refund)
  const j3 = await newJob(alice, "Smart contract audit report", "Write a security audit report for a 300-line Solidity contract.", "Security", ["0.5", "0.5"]);
  await (await as(escrow, carol).acceptJob(j3)).wait();
  await (await as(escrow, carol).submitMilestone(j3, 0, doc(carol, "deliverable", { text: "Draft report" }))).wait();
  await (await as(disputes, alice).raiseDispute(j3, 0, doc(alice, "dispute", { text: "Report is a copy of a public template." }))).wait();
  const d2 = await disputes.disputeCount();
  await (await as(disputes, arb1).castVote(d2, false)).wait();
  await (await as(disputes, arb3).castVote(d2, false)).wait();
  await (await disputes.executeResolution(d2)).wait();
  await (await as(escrow, alice).withdraw()).wait();

  // 4. Timeout claim: client never reviewed
  const j4 = await newJob(dave, "Logo animation", "Animate our logo, 5 seconds, delivered as Lottie JSON.", "Design", ["0.2"]);
  await (await as(escrow, bob).acceptJob(j4)).wait();
  await (await as(escrow, bob).submitMilestone(j4, 0, doc(bob, "deliverable", { text: "Lottie file delivered" }))).wait();
  await time.increase(REVIEW + 1);
  await (await as(escrow, bob).claimTimeout(j4, 0)).wait();

  // 5. In progress, one milestone waiting for review (live review window)
  const j5 = await newJob(alice, "Mobile app onboarding flow", "Implement a 4-screen onboarding flow in React Native.", "Development", ["0.25", "0.25", "0.5"]);
  await (await as(escrow, bob).acceptJob(j5)).wait();
  await (await as(escrow, bob).submitMilestone(j5, 0, doc(bob, "deliverable", { text: "Screens 1-2 done" }))).wait();

  // 6. Funded, waiting for a freelancer
  await newJob(dave, "Data cleaning for survey results", "Clean and normalise a 5k-row survey CSV and deliver a summary notebook.", "Data", ["0.15"]);

  // 7. Created but not funded yet
  await newJob(alice, "Podcast editing", "Edit 3 podcast episodes, remove filler words, add intro music.", "Audio", ["0.1"], { fund: false });

  // 8. Cancelled by client
  const j8 = await newJob(dave, "Write blog posts", "Three 800-word blog posts about DeFi basics.", "Writing", ["0.12"]);
  await (await as(escrow, dave).cancelJob(j8)).wait();

  // 9. Open dispute waiting for arbiters
  const j9 = await newJob(alice, "E-commerce checkout bug fixes", "Fix three reported checkout bugs in a Next.js store.", "Development", ["0.35"]);
  await (await as(escrow, carol).acceptJob(j9)).wait();
  await (await as(escrow, carol).submitMilestone(j9, 0, doc(carol, "deliverable", { text: "Patched all three bugs, PR #42" }))).wait();
  await (await as(disputes, alice).raiseDispute(j9, 0, doc(alice, "dispute", { text: "Bug 3 still reproduces on Safari." }))).wait();
  await (await as(disputes, arb2).castVote(await disputes.disputeCount(), true)).wait();

  // 10. Flagged by auditor
  await (await as(escrow, auditor).flagJob(j4, h("unusual: client never reviewed, auto-released"))).wait();

  // Admin collects fees
  await (await escrow.withdrawFees(admin.address)).wait();

  // jump past the review window that is still open on job 5 is intentionally NOT done,
  // so the demo can show a live approve/dispute decision.
  void VOTING;

  console.log(`Seeded ${await escrow.jobCount()} jobs and ${await disputes.disputeCount()} disputes on ${network.name}`);

  if (API_URL) {
    const tokens = new Map();
    for (const d of docs) {
      if (!tokens.has(d.signer.address)) tokens.set(d.signer.address, await login(d.signer));
      await api("POST", "/documents", { kind: d.kind, content: d.content }, tokens.get(d.signer.address));
    }
    console.log(`Stored ${docs.length} documents via ${API_URL}`);
  } else {
    console.log("API_URL not set: job titles/descriptions were not stored (jobs will show as untitled).");
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
