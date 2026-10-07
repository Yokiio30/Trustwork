# Security and gas analysis

Evidence files: [docs/evidence/slither.txt](evidence/slither.txt), [gas-before.txt](evidence/gas-before.txt), [gas-after.txt](evidence/gas-after.txt).
Reproduce: `cd contracts && python -m slither . --filter-paths node_modules` and `REPORT_GAS=true npx hardhat test`.

## 1. Security

### Controls in the contracts

| Risk | Control |
| --- | --- |
| Reentrancy on payout | Pull payments: releases only credit `balances[]`; ETH leaves in `withdraw()` / `withdrawFees()`, which are `nonReentrant` and zero the balance before the call |
| Unauthorised state changes | OpenZeppelin `AccessControl` for admin/auditor/arbiter/escrow roles; dispute hooks on `JobEscrow` accept only the configured `DisputeResolution` address; `Reputation` accepts writes only from `JobEscrow` |
| Funds locked or double spent | One accounting rule, tested as an invariant: contract balance = sum of per-job `remaining` + credited balances + accrued fees |
| Client stalls to avoid paying | Review window; after it expires the freelancer can `claimTimeout`; disputes are only possible inside the window so the two paths cannot race |
| Freelancer or client acts out of order | Milestones must be submitted in order; status checks on every transition; self-dealing blocked (`SelfDealing`) |
| Biased arbiter | Arbiters cannot vote on jobs they are a party to; one vote each; first side to 2 votes wins; tie or no votes favours the client |
| Fee manipulation | Fee capped at 5 %; the rate is snapshotted per job at creation so a later increase cannot affect open jobs |
| Integer problems | Solidity 0.8 checked arithmetic; amounts are `uint96` and the total is range-checked |
| Checks-effects-interactions | After the first Slither run, event emission and state writes were moved ahead of external calls (see 1.3) |

Backend: wallet-signature login with single-use nonces bound to the page's domain; tokens are short-lived JWTs; roles are
read from indexed on-chain grants (never from the token); private documents are restricted to the job's parties, arbiters on
disputed jobs, and auditors; request validation (zod), body size limit, rate limits, helmet, CORS allow-list.

### Slither 0.11.6 (102 detectors, Solidity 0.8.24, OpenZeppelin excluded)

First run: 17 results. Second run, after the changes in 1.3: **12 results, none exploitable**.

| Detector | Where | Verdict |
| --- | --- | --- |
| `arbitrary-send-eth` | `JobEscrow.withdrawFees(to)` | Intended. Admin-only, sends only the accrued fee balance. The destination is a parameter so fees can go to a treasury |
| `low-level-calls` | `withdraw`, `withdrawFees` | Intended. `call{value}` with success check is the recommended way to send ETH; both are `nonReentrant` |
| `timestamp` | review period, voting deadline | Accepted. Windows are minutes to days; validator timestamp drift (seconds) cannot change an outcome materially |
| `uninitialized-local` | `total` in `createJob`, `ratee` in `rateCounterparty` | False positive. `total` is an accumulator that starts at 0; `ratee` is assigned in every non-reverting branch |
| `unused-return` | `getJobParties` tuple | Benign. The status element is deliberately ignored in those functions |
| `reentrancy-benign`, `reentrancy-events` | calls to `Reputation` / `JobEscrow` | **Fixed** (1.3). Remaining external calls go to our own immutable contracts |

### 1.3 Changes made because of the scan

- `DisputeResolution.raiseDispute`: dispute state is written and the event emitted **before** the call to `escrow.markDisputed`, which still reverts the whole transaction if the milestone is not disputable.
- `JobEscrow`: `JobCompleted`, `JobTerminated` and `JobRated` are emitted before the call into `Reputation`.

### 1.4 Known limitations and trust assumptions

State these plainly in the report; they are design trade-offs of a course-scale system, not oversights.

1. **Arbiters are admin-appointed.** There is no staking, slashing or random selection, so arbiter honesty rests on the admin. A production version would stake and sample arbiters from a pool.
2. **Admin can set the dispute contract** (`setDisputeResolution`) and change fee/periods. Fee changes do not affect existing jobs, but a malicious admin could point the hook at a hostile contract. Mitigation: use a multisig or timelock as admin.
3. **Reputation is simple.** Ratings are only possible after a job ends, but nothing stops one person controlling both sides of a job (Sybil). The platform fee makes this costly but not impossible.
4. **ETH only, no upgradeability.** Volatile payment asset; contract bugs cannot be patched in place.
5. **Off-chain text** (descriptions, deliverables, evidence) is held by the backend; only hashes are on-chain. Tampering is detectable, but availability depends on the backend.
6. **Static analysis and unit tests are not an audit.** 39 contract tests cover every transition and revert path, but no formal verification or fuzzing was done.

## 2. Gas

Measured with `hardhat-gas-reporter` over the 39-test suite (optimizer on, 200 runs). Numbers are average gas units.

### 2.1 Optimisations applied

1. **Do not store data that only logs need.** The job description hash, each deliverable hash and the dispute reason hash were written to storage (about 22 100 gas per new slot) but are only ever read from events. They are now emitted only. The backend already reads them from events, so behaviour is unchanged.
2. **Pack structs.** `Job` went from 4 slots to 3 by using `uint96` amounts that share a slot with an address (`uint96` holds about 7.9e28 wei, far above the total ETH supply). `Milestone` is one slot instead of two. `Dispute` went from 5 or more slots to **one** (31 bytes), using `uint64` ids and timestamps and `uint16` vote counters.
3. Smaller things already in place: custom errors instead of revert strings, `immutable` for the reputation/escrow addresses, `calldata` arrays, and unchecked counters in `Reputation` where overflow is impossible in practice.

### 2.2 Results

| Transaction | Before | After | Saved |
| --- | ---: | ---: | ---: |
| `raiseDispute` | 164 646 | 100 578 | **64 068 (38.9 %)** |
| `submitMilestone` | 58 417 | 38 271 | **20 146 (34.5 %)** |
| `acceptJob` | 50 823 | 35 693 | **15 130 (29.8 %)** |
| `executeResolution` | 149 164 | 143 654 | 5 510 (3.7 %) |
| `createJob` | 185 098 | 180 765 | 4 333 (2.3 %) |
| `submitEvidence` | 40 461 | 38 562 | 1 899 (4.7 %) |
| `castVote` | 66 818 | 64 921 | 1 897 (2.8 %) |
| `approveMilestone` | 96 146 | 94 887 | 1 259 (1.3 %) |
| `fundJob` | 34 081 | 36 207 | −2 126 (−6.2 %) |
| `rateCounterparty` | 44 447 | 46 499 | −2 052 (−4.6 %) |
| `withdraw`, `withdrawFees`, `cancelJob`, `claimTimeout`, `flagJob` | | | ≈ 0 |
| Deploy `JobEscrow` | 2 399 876 | 2 352 804 | 47 072 (2.0 %) |
| Deploy `DisputeResolution` | 1 472 333 | 1 440 201 | 32 132 (2.2 %) |

Two functions got slightly more expensive. Packing the client address and the remaining balance into one slot makes `fundJob`
read-modify-write that slot, and the rating flags now share a slot with the job status. Both are small next to what the
packing saved elsewhere, so the trade was kept.

**Whole lifecycle** (create, fund, accept, then 2 × submit and approve): 579 128 → 518 981 gas, **60 147 less (10.4 %)**.
A job that goes to dispute saves a further 64 068 on `raiseDispute`.

To convert to a cost: `cost (ETH) = gas × gas price (gwei) × 1e-9`. For example, 518 981 gas at 20 gwei is about 0.0104 ETH.
Use the live price when you write the report; do not quote a fixed fiat figure.

### 2.3 Not done, and why

- `viaIR` and higher optimizer runs: no meaningful gain at this size and they lengthen compile time.
- Batching approvals or votes: would change the product behaviour.
- Moving ratings fully off-chain: would drop the on-chain reputation requirement.

## 3. Test evidence

| Layer | Result |
| --- | --- |
| Contracts (`npx hardhat test`) | 39 passing: lifecycle, access control, disputes, timeouts, ratings, balance invariant |
| Backend (`npm test`) | 10 passing: login, replay and forgery rejection, wrong-domain signature, document permissions, validation, pagination |
| End to end (`e2e`) | 12 checks passing in Chrome against a live local chain: post, fund, accept, deliver, approve, dispute, vote, verdict, withdraw, role gates, mobile layout |

The end-to-end run uses a stand-in wallet that signs through the Hardhat node. A manual pass with real MetaMask is still to be done.
