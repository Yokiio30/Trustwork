# Deploying to Sepolia + the cloud

Target setup: contracts on **Sepolia**, API and indexer on **Render**, frontend on **Vercel**.
Everything the repo can do for you is already written (`render.yaml`, `frontend/vercel.json`, `.github/workflows/ci.yml`,
`contracts/scripts/{deploy,verify,demo-accounts}.js`). What is left is accounts, keys and clicking through two dashboards.

## 0. What you need

| Item | Notes |
| --- | --- |
| A throwaway **deployer wallet** | Create a fresh MetaMask account used only for this. Never use a wallet that holds real funds. |
| About **0.02 Sepolia ETH** or more | From a Sepolia faucet (search "Sepolia faucet"; availability and limits change, some need a login or mainnet history). Deploying costs a tiny fraction of that (gas on Sepolia is very cheap); the rest funds the demo wallets. About 0.02 ETH is enough. |
| An **RPC URL** for Sepolia | Free tier of Alchemy, Infura or similar. |
| An **Etherscan API key** | Free. Needed only to publish the source ("Verified" badge). |
| A **GitHub repo** with this code | Render and Vercel deploy from it. |
| A free **Neon** (or Supabase) Postgres | Holds document text so it survives restarts on Render's free plan. |
| **Render** and **Vercel** accounts | Both can sign in with GitHub. |

## 1. Deploy the contracts

```bash
cd contracts
cp .env.example .env     # then fill in the values below
```

`contracts/.env`:

```
SEPOLIA_RPC_URL=<your RPC URL>
DEPLOYER_PRIVATE_KEY=<private key of the throwaway deployer, with 0x>
ETHERSCAN_API_KEY=<key>
# Short periods so a live demo does not need days of waiting:
REVIEW_PERIOD_SECONDS=300
VOTING_PERIOD_SECONDS=600
PLATFORM_FEE_BPS=100
```

Use a **Sepolia** RPC URL (the host should contain `eth-sepolia`, not `eth-mainnet`); the config pins the chain id to 11155111 and refuses anything else.
Leave `ADMIN_ADDRESS`, `ARBITERS` and `AUDITORS` empty if you use the demo-account script below (it needs the deployer to be admin).

```bash
# GAS_PRICE_GWEI matters: Hardhat's default 1 gwei tip is about 1000x the real price on Sepolia.
GAS_PRICE_GWEI=0.02 npx hardhat run scripts/deploy.js --network sepolia      # prints 3 addresses, writes ../shared/deployments/sepolia.json
npx hardhat run scripts/verify.js --network sepolia                          # publishes the source on Etherscan
GAS_PRICE_GWEI=0.02 npx hardhat run scripts/demo-accounts.js --network sepolia   # client gets 0.0012 ETH, the others 0.0002 each
```

**Things learned from the real Sepolia deployment (worth a line in the report):**

- Gas *units* are much higher than on a local Hardhat chain for the same code (for example `createJob` about 690 000 to 800 000 vs
  about 181 000 locally, and contract creation roughly 7 times more). The network's current rules charge more for creating new storage and code.
  This makes the storage-packing optimisations in `docs/SECURITY_AND_GAS.md` worth even more on a live network.
- Gas *price* is tiny (base fee near zero, suggested tip 0.001 gwei), so a transaction still costs only about a millionth of an ETH.
  Do not trust a quick estimate in either direction: measure on the target network.
- The deployer address was treated as a "delegated account" by the RPC node, which allows only one in-flight transaction at a time.
  The scripts retry automatically (`scripts/lib/send.js`).
- If a deployment stops half way, resume without paying again:
  `REUSE_REPUTATION=<addr> REUSE_REPUTATION_BLOCK=<n> REUSE_JOBESCROW=<addr> REUSE_JOBESCROW_BLOCK=<n> ... deploy.js`.

- **Commit `shared/deployments/sepolia.json`.** The backend and frontend read addresses and ABIs from it. It contains no secrets.
- `demo-accounts.js` creates 7 throwaway wallets (client, two freelancers, three arbiters, auditor), funds and authorises them, and writes
  their private keys to `contracts/demo-accounts.json`. That file is gitignored; hand it to whoever presents so they can import the accounts into MetaMask.
- Copy the three addresses and the Etherscan links into the report's "Smart contract deployment details" section.

## 2. Push to GitHub

```bash
git init && git add . && git commit -m "TrustWork"
git remote add origin <your repo URL> && git push -u origin main
```

The CI workflow runs contract tests (with a gas report), a Slither scan, backend tests and a frontend build on every push.

## 3. Free database for document text (Neon)

Job descriptions, deliverables and evidence text are stored by the backend (the chain only holds their hashes). On Render's free plan the
local disk is wiped whenever the instance restarts or wakes from sleep, so that text is also written to a small external Postgres and
loaded back on startup. Everything else (jobs, payments, votes, ratings) is rebuilt from the chain automatically.

1. Create a free project at **neon.tech** (Supabase also works). Choose a region near Singapore.
2. Copy the **connection string** (it looks like `postgresql://user:password@host/dbname?sslmode=require`).
3. Keep it for step 4 and treat it like a password. Never commit it.

The backend creates its own `documents` table the first time it connects. If the database is unreachable at startup the API still
starts (chain data is fine), keeps retrying in the background, and returns a clear "storage unavailable" error to anyone trying to save
text, so nobody is told their text is saved when it is not.

## 4. Backend on Render (free plan)

1. Render dashboard: **New > Blueprint**, pick the repo. It reads `render.yaml` (free plan, Singapore).
2. Fill in the values it asks for:
   - `RPC_URL`: `https://ethereum-sepolia-rpc.publicnode.com` (free, no key). Do **not** use the Alchemy free URL here: it only allows
     10 blocks per log query, which makes the backend's resync after every free-plan wake-up very slow. Alchemy is fine for deploying contracts.
   - `DOCS_DATABASE_URL`: the Neon connection string from step 3.
   - `CORS_ORIGIN`: put `https://placeholder.invalid` for now; you set the real value in step 6.
3. Deploy. When it is live, open `https://<service>.onrender.com/api/health`. You want `"ok":true` and an `indexer.lastBlock` that approaches `headBlock`.
   In the logs you should see `[docs] loaded N document(s) from the durable store`.

**What the free plan means in practice**
- The instance sleeps after a period of inactivity (Render's current rule, about 15 minutes) and the next request takes tens of seconds
  while it wakes up and re-syncs. Before a demo or a recorded video, open the site once and wait until it is responsive.
- To avoid sleeping, point a free uptime monitor (for example UptimeRobot) at `https://<service>.onrender.com/api/health` every 5 minutes.
- Because document text is in Neon, restarts and redeploys no longer lose job titles or descriptions.
- If you would rather pay, change `plan: free` to `plan: starter`, add a `disk` mounted at `/var/data` and set `DB_PATH=/var/data/trustwork.db`.
  The Neon variable then becomes optional.

## 5. Frontend on Vercel

1. Vercel: **Add New > Project**, import the repo, set **Root Directory** to `frontend`. The framework is detected as Vite; `vercel.json` handles routing.
2. Environment variable: `VITE_API_URL` = the Render URL from step 4 (no trailing slash).
3. Deploy and note the URL, for example `https://trustwork.vercel.app`.

## 6. Connect them

Back in Render (Environment tab), set `CORS_ORIGIN` to the Vercel URL (comma-separate several if you also use a custom domain) and let it redeploy.

## 7. Smoke test (about 5 minutes)

| Check | Expect |
| --- | --- |
| `https://<render>/api/health` | `ok: true`, indexer caught up |
| Render log | contains `[docs] loaded … from the durable store` |
| `https://<render>/api/config` | the Sepolia chain id `11155111` and your three addresses |
| Open the Vercel URL | Marketplace loads (empty at first); no red banner |
| Import the client demo account in MetaMask on Sepolia, connect | Asked to sign a message, then a green dot in the header |
| Post a job with `0.0002` ETH | Gas confirmation dialog, wallet prompt, then the job page shows "Awaiting freelancer" (allow about 30 s for block time plus indexing) |
| Switch to the freelancer account, accept, submit, switch back and approve | Payout shown net of 1 %; freelancer can withdraw |
| Switch to an admin account (the deployer) and open Admin | Fee, periods and role lists load |

Use tiny job amounts such as **0.0002 ETH**. Faucet ETH is limited and every account pays its own gas.

## 8. Record for the report

| Item | Value |
| --- | --- |
| Frontend URL | |
| API URL | |
| Network / chain id | Sepolia / 11155111 |
| `Reputation` | address, Etherscan link |
| `JobEscrow` | address, Etherscan link |
| `DisputeResolution` | address, Etherscan link |
| Deployment block / date | from `shared/deployments/sepolia.json` |
| Deployer / admin address | |

## Troubleshooting

| Symptom | Likely cause and fix |
| --- | --- |
| Browser console shows a CORS error | `CORS_ORIGIN` on Render does not exactly match the Vercel URL (scheme, no trailing slash). Fix and redeploy. |
| Red banner "Cannot load platform configuration" | `VITE_API_URL` wrong or the API is asleep or down. Open `/api/health`. |
| Wallet banner "wrong network" | Click **Switch network**; MetaMask already knows Sepolia. |
| `indexer.lastError` mentions a block range or `eth_getLogs` | The RPC provider limits log ranges. The indexer already halves its range automatically; if it still fails, switch `RPC_URL` to `https://ethereum-sepolia-rpc.publicnode.com`. |
| Page does not update right after a transaction | The indexer lags by `INDEXER_CONFIRMATIONS` blocks (12 s each). It catches up on its own; the dialog waits up to a minute. |
| Job titles missing after a restart | `DOCS_DATABASE_URL` is not set or wrong. Check the Render log for `[docs]` lines. |
| Posting a job fails with "Document storage is temporarily unavailable" | The Neon database is unreachable or the connection string is wrong. Check it in the Render environment; Neon may need a few seconds to wake. |
| `verify.js` fails with a constructor argument error | The contracts were deployed with a different deployer than recorded. Redeploy, or verify manually with the constructor arguments from `shared/deployments/sepolia.json`. |
| Demo accounts script says the deployer balance is too low | Get more faucet ETH or lower `DEMO_CLIENT_ETH` / `DEMO_FUND_ETH`. |

## Security notes

- Never commit `.env`, `demo-accounts.json` or any private key (both are gitignored).
- The deployer key is only for this deployment. After deploying you can leave it empty on any server; the backend never needs a private key.
- `JWT_SECRET` is generated by Render. If it ever leaks, change it; all sessions then expire.
