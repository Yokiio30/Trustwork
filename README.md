# TrustWork: on-chain escrow marketplace

SC6113 group project. Clients lock ETH in a smart contract, freelancers deliver milestone by milestone, and
independent arbiters settle disputes. The platform never holds the money; the contracts do.

```
contracts/   Solidity (Hardhat): JobEscrow, DisputeResolution, Reputation + tests + deploy/seed scripts
backend/     Node.js + Express: chain indexer (SQLite), REST API, wallet-signature login
frontend/    React + Vite + Tailwind: marketplace, job/dispute pages, dashboards, MetaMask integration
e2e/         Browser end-to-end test (Playwright + stand-in wallet)
shared/      deployments/<network>.json written by the deploy script (addresses + ABIs)
```

## Roles

| Role | How it is assigned | Can |
| --- | --- | --- |
| Client / Freelancer | Anyone; decided per job | Post, fund, accept, deliver, approve, dispute, rate, withdraw |
| Arbiter | Admin grants `ARBITER_ROLE` | Vote on disputes (not on their own jobs) |
| Auditor | Admin grants `AUDITOR_ROLE` | Read everything, flag jobs, export logs |
| Admin | Deployer / `DEFAULT_ADMIN_ROLE` | Fees, review/voting periods, roles, withdraw fees |

## Run it locally

Requires Node 22.13+ (tested on 24) and, for the browser test, Chrome.

```bash
# 1. Contracts: tests, local chain, deploy
cd contracts && npm install
npx hardhat test                                    # 39 tests
npx hardhat node                                    # keep running (terminal A)
npx hardhat run scripts/deploy.js --network localhost

# 2. Backend (terminal B)
cd backend && npm install
cp .env.example .env
npm test                                            # API tests, no chain needed
npm start                                           # http://localhost:4000

# 3. Demo data (optional): 9 jobs in every state, 3 arbiters, 1 auditor
cd contracts && API_URL=http://localhost:4000 npx hardhat run scripts/seed.js --network localhost

# 4. Frontend (terminal C)
cd frontend && npm install && npm run dev           # http://localhost:3000
```

### MetaMask for the demo

Add a network: RPC `http://127.0.0.1:8545`, chain ID `31337`, symbol ETH. Import Hardhat's well-known test keys
(these are public; never use them on a real network):

| Account | Role in the seeded demo | Private key |
| --- | --- | --- |
| #0 | Admin | `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` |
| #1 | Client (Alice) | `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d` |
| #2 | Freelancer (Bob) | `0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a` |
| #3 | Freelancer (Carol) | `0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6` |
| #4, #5, #6 | Arbiters | `0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a`, `0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba`, `0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e` |
| #7 | Auditor | `0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356` |
| #8 | Client (Dave) | `0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97` |

Connecting an account triggers a free "Sign in" message. Switching accounts in MetaMask switches roles.

For a live demo, deploy with short periods so waiting is not needed:
`REVIEW_PERIOD_SECONDS=120 VOTING_PERIOD_SECONDS=300 npx hardhat run scripts/deploy.js --network localhost`.

## Tests

| Layer | Command | What it covers |
| --- | --- | --- |
| Contracts | `cd contracts && npx hardhat test` | 39 tests: lifecycle, access control, disputes, timeouts, ratings, balance invariant |
| Gas report | `REPORT_GAS=true npx hardhat test` | Writes `contracts/gas-report.txt` |
| Backend | `cd backend && npm test` | Login, replay/forgery rejection, document permissions, validation, pagination |
| End to end | `cd e2e && npm install && npm test` | Real UI flow: post, fund, accept, deliver, approve, dispute, vote, verdict, withdraw, role gates, mobile layout |

The end-to-end test needs the stack above running and seeded (see header of `e2e/run.mjs`).

## Deploy to Sepolia and the cloud

Full step-by-step guide: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) (Sepolia contracts, Render backend via `render.yaml`,
Vercel frontend via `frontend/vercel.json`, smoke test, troubleshooting). Security scan and gas analysis:
[docs/SECURITY_AND_GAS.md](docs/SECURITY_AND_GAS.md). CI (`.github/workflows/ci.yml`) runs all tests, Slither and the frontend build on every push.

The chain-derived part of the backend database can be deleted at any time; it re-syncs on start. Document text (descriptions,
deliverables, evidence) is also written to an external Postgres (`DOCS_DATABASE_URL`, free on Neon) so it survives restarts on hosts
with ephemeral disks such as Render's free plan.

## Design notes

- **Pull payments.** Releases credit an internal balance; recipients call `withdraw()`. No ETH is sent while job state changes.
- **Review window.** After a milestone is submitted the client has `reviewPeriod` to approve or dispute. If they do neither, the freelancer can `claimTimeout`.
- **Disputes.** First side to 2 arbiter votes wins. After the voting deadline the larger side wins; a tie (or no votes) favours the client. A client win refunds all remaining funds and ends the job.
- **Off-chain text.** Job descriptions, deliverables and evidence are stored by the backend; only their keccak256 hash goes on-chain, so edits are detectable.
