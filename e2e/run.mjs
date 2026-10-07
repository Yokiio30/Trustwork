// End-to-end UI test: real frontend + backend + Hardhat chain, with a stand-in wallet that signs
// through the Hardhat node's unlocked accounts. Needs the stack from the README running and seeded.
import { chromium } from "playwright-core";
import fs from "node:fs";

const APP = "http://127.0.0.1:3000";
const OUT = process.env.SHOTS || "./shots";
fs.mkdirSync(OUT, { recursive: true });

const ACC = {
  admin: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  alice: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
  bob: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
  arb1: "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65",
  arb2: "0x9965507d1a55bcc2695c58ba16fb37d819b0a4dc",
  auditor: "0x14dc79964da2c08b23698b3d3cc7ca32193d9955",
};

const walletScript = (initial) => `
(() => {
  let current = sessionStorage.getItem("mockAcct") || ${JSON.stringify(initial)};
  const listeners = {};
  const rpc = async (method, params) => {
    const r = await fetch("http://127.0.0.1:8545", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }) });
    const j = await r.json();
    if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code, data: j.error.data });
    return j.result;
  };
  window.ethereum = {
    isMetaMask: true,
    request: async ({ method, params = [] }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [current];
      if (method === "wallet_switchEthereumChain") return null;
      return rpc(method, params);
    },
    on: (ev, cb) => { (listeners[ev] ||= []).push(cb); },
    removeListener: (ev, cb) => { listeners[ev] = (listeners[ev] || []).filter((x) => x !== cb); },
  };
  window.__switchAccount = (addr) => { current = addr; sessionStorage.setItem("mockAcct", addr); (listeners.accountsChanged || []).forEach((cb) => cb([addr])); };
})();
`;

const results = [];
const check = (name, ok, extra = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addInitScript(walletScript(ACC.alice));
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => m.type() === "error" && errors.push("console: " + m.text()));

async function switchTo(addr) {
  await page.evaluate((a) => window.__switchAccount(a), addr);
  // sign-in popup is automatic on account change; wait for the green dot (authed)
  await page.waitForSelector("header .bg-emerald-500", { timeout: 15000 });
}
async function confirmTx() {
  await page.getByRole("button", { name: "Continue" }).click({ timeout: 15000 });
  // the confirm step is over once the Continue button is gone (the dialog may be reused by a following tx)
  await page.waitForSelector('button:has-text("Continue")', { state: "detached", timeout: 40000 });
  await page.waitForSelector("text=Waiting for the network", { state: "detached", timeout: 40000 }).catch(() => {});
  await page.waitForSelector("text=Updating the dashboard", { state: "detached", timeout: 40000 }).catch(() => {});
}

try {
  // ---- marketplace loads seeded data
  await page.goto(APP);
  await page.waitForSelector("header .bg-emerald-500", { timeout: 15000 });
  await page.locator("a[href^=\"/jobs/\"]").first().waitFor();
  check("marketplace shows seeded jobs", true);
  await page.screenshot({ path: `${OUT}/01-marketplace.png` });

  // ---- Alice posts and funds a job through the UI (2 txs)
  await page.goto(`${APP}/jobs/new`);
  await page.getByLabel("Title").fill("E2E test: write API docs");
  await page.getByLabel("What needs to be done?").fill("Document the REST API with examples for every endpoint.");
  await page.getByLabel("Milestone 1 amount in ETH").fill("0.2");
  await page.getByRole("button", { name: "Add milestone" }).click();
  await page.getByLabel("Milestone 2 amount in ETH").fill("0.3");
  await page.screenshot({ path: `${OUT}/02-create-job.png` });
  await page.getByRole("button", { name: "Create job" }).click();
  await page.waitForSelector("text=Estimated gas");
  await page.screenshot({ path: `${OUT}/03-gas-confirm.png` });
  await confirmTx();
  await confirmTx(); // fundJob
  await page.waitForURL(/\/jobs\/\d+$/, { timeout: 20000 });
  const jobUrl = page.url();
  const jobId = jobUrl.split("/").pop();
  await page.waitForSelector("text=Awaiting freelancer", { timeout: 15000 });
  check(`created and funded job #${jobId} via UI`, true);

  // ---- Bob accepts and submits milestone 1
  await switchTo(ACC.bob);
  await page.getByRole("button", { name: "Accept this job" }).click();
  await confirmTx();
  await page.getByRole("button", { name: /Submit milestone 1/ }).click();
  await page.getByLabel("What are you delivering?").fill("Endpoints 1-10 documented, see attached.");
  await page.getByRole("button", { name: "Submit for review" }).click();
  await confirmTx();
  await page.waitForSelector("text=Client has", { timeout: 15000 });
  check("freelancer accepted and submitted milestone 1", true);

  // ---- Alice approves
  await switchTo(ACC.alice);
  await page.getByRole("button", { name: /Approve and pay/ }).click();
  await confirmTx();
  await page.waitForSelector("text=Paid 0.198 ETH", { timeout: 15000 });
  check("client approved milestone, payout net of 1% fee (0.198 ETH)", true);
  await page.screenshot({ path: `${OUT}/04-job-detail.png`, fullPage: true });

  // ---- Bob submits #2, Alice disputes it
  await switchTo(ACC.bob);
  await page.getByRole("button", { name: /Submit milestone 2/ }).click();
  await page.getByLabel("What are you delivering?").fill("The rest of the endpoints.");
  await page.getByRole("button", { name: "Submit for review" }).click();
  await confirmTx();
  await switchTo(ACC.alice);
  await page.getByRole("button", { name: "Reject / open dispute" }).click();
  await page.getByLabel("Why are you disputing?").fill("Examples are missing for the auth endpoints.");
  await page.getByRole("button", { name: "Open dispute", exact: true }).click();
  await confirmTx();
  await page.waitForSelector("text=Go to dispute", { timeout: 15000 });
  check("client opened a dispute", true);
  await page.getByRole("link", { name: /Go to dispute/ }).click();

  // ---- two arbiters vote for the client, then anyone executes
  await switchTo(ACC.arb1);
  await page.getByRole("button", { name: "Vote: refund the client" }).click();
  await confirmTx();
  await switchTo(ACC.arb2);
  await page.getByRole("button", { name: "Vote: refund the client" }).click();
  await confirmTx();
  await page.getByRole("button", { name: "Execute the verdict" }).click();
  await confirmTx();
  await page.waitForSelector("text=resolved for the client", { timeout: 15000 });
  await page.screenshot({ path: `${OUT}/05-dispute.png`, fullPage: true });
  check("arbiters voted and verdict executed (client refunded)", true);

  // ---- Alice sees refund and withdraws
  await switchTo(ACC.alice);
  await page.goto(`${APP}/my-work`);
  await page.waitForSelector("text=Ready to withdraw");
  await page.getByRole("button", { name: "Withdraw", exact: true }).click();
  await confirmTx();
  check("client withdrew refund from My work", true);
  await page.screenshot({ path: `${OUT}/06-my-work.png`, fullPage: true });

  // ---- role-gated pages
  await switchTo(ACC.alice);
  await page.goto(`${APP}/admin`);
  check("non-admin is blocked from /admin", await page.getByText("Access restricted").isVisible());
  await switchTo(ACC.admin);
  await page.goto(`${APP}/admin`);
  await page.waitForSelector("text=Platform fee");
  check("admin can open /admin", await page.getByText("Fees collected").isVisible());
  await page.screenshot({ path: `${OUT}/07-admin.png`, fullPage: true });
  await switchTo(ACC.auditor);
  await page.goto(`${APP}/audit`);
  await page.getByRole("tab", { name: "Transactions & gas" }).click();
  await page.waitForSelector("text=Gas used");
  check("auditor can open /audit", true);
  await page.screenshot({ path: `${OUT}/08-audit.png`, fullPage: true });

  // ---- dashboard + mobile layout
  await page.goto(`${APP}/dashboard`);
  await page.waitForSelector("text=Gas per transaction type");
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/09-dashboard.png`, fullPage: true });
  check("dashboard renders charts", (await page.locator(".recharts-wrapper").count()) >= 3);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(APP);
  await page.locator("a[href^=\"/jobs/\"]").first().waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check("no horizontal scroll at phone width", !overflow);
  await page.screenshot({ path: `${OUT}/10-mobile.png` });
} catch (e) {
  check("scenario completed", false, e.message.split("\n")[0]);
  await page.screenshot({ path: `${OUT}/failure.png`, fullPage: true }).catch(() => {});
}

console.log("\nbrowser errors:", errors.length ? "\n" + [...new Set(errors)].join("\n") : "none");
await browser.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
