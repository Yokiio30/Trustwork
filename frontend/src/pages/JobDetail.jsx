import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Address, DocView, ErrorBox, Spinner, StatusBadge } from "../components/ui";
import { useWeb3 } from "../context/Web3";
import { useTx } from "../context/Tx";
import { useToast } from "../context/Toast";
import { api } from "../lib/api";
import { describeEvent } from "../lib/events";
import { friendlyError } from "../lib/errors";
import { formatDate, formatDuration, formatEth, sameAddr, shortHash, timeAgo } from "../lib/format";
import { useApi, useDocumentTitle, useNow } from "../lib/hooks";
import { id as keccak } from "ethers";

export default function JobDetail() {
  const { id } = useParams();
  const { data: job, error, loading, reload } = useApi(`/jobs/${id}`, { refreshMs: 6000 });
  useDocumentTitle(job?.metadata?.title || `Job #${id}`);

  if (loading && !job) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return <Detail job={job} reload={reload} />;
}

function Detail({ job, reload }) {
  const { account, config, authed, hasRole, wrongNetwork } = useWeb3();
  const now = useNow();
  const reviewPeriod = config?.params?.reviewPeriod ?? 259200;

  const isClient = sameAddr(account, job.client);
  const isFreelancer = sameAddr(account, job.freelancer);
  const active = job.milestones.find((m) => ![2, 4].includes(m.statusCode)); // first unfinished milestone
  const finished = job.status === "Completed" || job.status === "Terminated";
  const openDispute = job.disputes.find((d) => d.status === "Open");
  const canAct = !!account && authed && !wrongNetwork;

  const released = job.milestones.filter((m) => m.statusCode === 2).reduce((s, m) => s + BigInt(m.amount), 0n);
  const progress = job.milestones.length ? Math.round((job.milestones.filter((m) => m.statusCode === 2).length / job.milestones.length) * 100) : 0;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <section className="card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs text-slate-500">
                <Link to="/" className="hover:underline">Marketplace</Link> / Job #{job.id}
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{job.metadata?.title || `Job #${job.id}`}</h1>
              {job.metadata?.category && <p className="mt-1 text-sm text-slate-500">{job.metadata.category}</p>}
            </div>
            <div className="flex items-center gap-2">
              {job.flagged && <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">⚑ Flagged</span>}
              <StatusBadge status={job.status} />
            </div>
          </div>
          <p className="mt-4 whitespace-pre-wrap text-sm text-slate-700">{job.metadata?.description || "The description for this job is not available on this server."}</p>

          <dl className="mt-5 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <Info label="Total" value={`${formatEth(job.totalAmount)} ETH`} />
            <Info label="Paid out" value={`${formatEth(released)} ETH`} />
            <Info label="Client" value={<Address value={job.client} />} />
            <Info label="Freelancer" value={job.freelancer ? <Address value={job.freelancer} /> : "Not yet accepted"} />
          </dl>
          <div className="mt-4" aria-label={`${progress}% of milestones paid`}>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        </section>

        <section className="card p-5">
          <h2 className="font-semibold text-slate-900">Milestones</h2>
          <ol className="mt-4 space-y-3">
            {job.milestones.map((m) => (
              <MilestoneRow key={m.index} m={m} now={now} reviewPeriod={reviewPeriod} isActive={active?.index === m.index} />
            ))}
          </ol>
        </section>

        {job.disputes.length > 0 && (
          <section className="card p-5">
            <h2 className="font-semibold text-slate-900">Disputes</h2>
            <ul className="mt-3 space-y-3">
              {job.disputes.map((d) => (
                <li key={d.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link to={`/disputes/${d.id}`} className="font-medium text-brand-700 hover:underline">
                      Dispute #{d.id} on milestone {d.milestoneIndex + 1}
                    </Link>
                    <StatusBadge status={d.status} dispute />
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    Votes: {d.votesFreelancer} for freelancer · {d.votesClient} for client
                    {d.freelancerWon !== null && ` · decided for the ${d.freelancerWon ? "freelancer" : "client"}`}
                  </p>
                  <div className="mt-2">
                    <DocView hash={d.reasonHash} />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="card p-5">
          <h2 className="font-semibold text-slate-900">Activity</h2>
          <ol className="mt-4 space-y-4 border-l border-slate-200 pl-5">
            {job.events.map((e) => (
              <li key={e.id} className="relative">
                <span className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand-500 ring-4 ring-white" />
                <p className="text-sm text-slate-800">{describeEvent(e)}</p>
                <p className="text-xs text-slate-500">
                  {formatDate(e.timestamp)} · tx <span className="font-mono">{shortHash(e.txHash)}</span>
                </p>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <aside className="space-y-4">
        <div className="card p-5">
          <h2 className="font-semibold text-slate-900">Actions</h2>
          {!account && <p className="mt-2 text-sm text-slate-500">Connect your wallet to take part in this job.</p>}
          {account && !authed && <p className="mt-2 text-sm text-slate-500">Sign in with your wallet to continue.</p>}
          {account && authed && !isClient && !isFreelancer && job.status !== "Funded" && !hasRole("auditor") && !hasRole("arbiter") && (
            <p className="mt-2 text-sm text-slate-500">You are not a party to this job.</p>
          )}
          {canAct && (
            <Actions job={job} active={active} isClient={isClient} isFreelancer={isFreelancer} finished={finished} openDispute={openDispute} now={now} reviewPeriod={reviewPeriod} reload={reload} />
          )}
        </div>
        <div className="card p-5 text-sm text-slate-600">
          <h2 className="font-semibold text-slate-900">How it works</h2>
          <ul className="mt-2 list-disc space-y-1.5 pl-5">
            <li>Funds stay in the escrow contract, not with the platform.</li>
            <li>The client reviews each milestone for {formatDuration(reviewPeriod)}. If they stay silent, the freelancer can claim payment.</li>
            <li>If they disagree, either side can open a dispute. Arbiters vote and the contract carries out the result.</li>
            <li>Platform fee: {(job.feeBps / 100).toFixed(2)}% of each payout.</li>
          </ul>
        </div>
      </aside>
    </div>
  );
}

const Info = ({ label, value }) => (
  <div>
    <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
    <dd className="mt-0.5 font-medium text-slate-900">{value}</dd>
  </div>
);

function MilestoneRow({ m, now, reviewPeriod, isActive }) {
  const deadline = m.submittedAt ? m.submittedAt + reviewPeriod : null;
  const left = deadline ? deadline - now : null;
  return (
    <li className={`rounded-lg border p-3 ${isActive ? "border-brand-500 bg-brand-50/40" : "border-slate-200"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-900">
          Milestone {m.index + 1} · {formatEth(m.amount)} ETH
        </p>
        <StatusBadge status={m.status} />
      </div>
      {m.status === "Submitted" && deadline && (
        <p className={`mt-1 text-xs ${left > 0 ? "text-slate-500" : "font-medium text-amber-700"}`}>
          {left > 0 ? `Client has ${formatDuration(left)} left to review` : "Review period is over. The freelancer can claim payment."}
        </p>
      )}
      {m.status === "Approved" && (
        <p className="mt-1 text-xs text-slate-500">
          Paid {formatEth(m.payout)} ETH (fee {formatEth(m.fee)} ETH){m.viaTimeout ? " · released after review period" : ""}
        </p>
      )}
      {m.deliverableHash && (
        <div className="mt-2 rounded bg-slate-50 p-2">
          <p className="mb-1 text-xs font-medium text-slate-500">Deliverable · submitted {timeAgo(m.submittedAt)}</p>
          <DocView hash={m.deliverableHash} />
        </div>
      )}
    </li>
  );
}

// -------------------------------------------------------------------------------------------------

function Actions({ job, active, isClient, isFreelancer, finished, openDispute, now, reviewPeriod, reload }) {
  const { sendTx } = useTx();
  const toast = useToast();
  const { hasRole, account } = useWeb3();
  const [form, setForm] = useState(null); // "submit" | "dispute"
  const [text, setText] = useState("");
  const [link, setLink] = useState("");
  const [score, setScore] = useState(5);
  const [busy, setBusy] = useState(false);

  const run = async (opts) => {
    setBusy(true);
    try {
      const r = await sendTx({ contract: "JobEscrow", ...opts });
      if (r) {
        setForm(null);
        setText("");
        setLink("");
        reload();
      }
      return r;
    } finally {
      setBusy(false);
    }
  };

  const publish = async (kind) => {
    const body = { kind, content: { text: text.trim(), ...(link.trim() ? { links: [link.trim()] } : {}) } };
    return (await api("/documents", { method: "POST", body })).hash;
  };

  const submitMilestone = async () => {
    if (!text.trim()) return toast.error("Describe what you are delivering.");
    try {
      const hash = await publish("deliverable");
      await run({ title: `Submit milestone ${active.index + 1}`, method: "submitMilestone", args: [job.id, active.index, hash], details: [["Job", `#${job.id}`]] });
    } catch (e) {
      toast.error(friendlyError(e));
    }
  };

  const raiseDispute = async () => {
    if (!text.trim()) return toast.error("Explain why you are disputing this milestone.");
    try {
      const hash = await publish("dispute");
      setBusy(true);
      const r = await sendTx({ title: `Dispute milestone ${active.index + 1}`, contract: "DisputeResolution", method: "raiseDispute", args: [job.id, active.index, hash], details: [["Job", `#${job.id}`], ["Effect", "Freezes the funds until arbiters decide"]] });
      if (r) { setForm(null); setText(""); setLink(""); reload(); }
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const alreadyRated = job.ratings.some((r) => sameAddr(r.rater, account));
  const submitted = active?.status === "Submitted";
  const reviewOpen = submitted && now < active.submittedAt + reviewPeriod;
  const reviewOver = submitted && !reviewOpen;
  const none = [];

  const Btn = ({ children, danger, secondary, ...p }) => (
    <button className={`${danger ? "btn-danger" : secondary ? "btn-secondary" : "btn-primary"} w-full`} disabled={busy} {...p}>
      {children}
    </button>
  );

  // ---- client
  if (isClient) {
    if (job.status === "Open")
      none.push(
        <Btn key="fund" onClick={() => run({ title: "Lock funds in escrow", method: "fundJob", args: [job.id], value: BigInt(job.totalAmount), details: [["Job", `#${job.id}`]] })}>
          Fund job ({formatEth(job.totalAmount)} ETH)
        </Btn>,
        <Btn key="cancel" secondary onClick={() => run({ title: "Cancel job", method: "cancelJob", args: [job.id] })}>Cancel job</Btn>
      );
    if (job.status === "Funded")
      none.push(
        <p key="wait" className="text-sm text-slate-500">Funds are locked. Waiting for a freelancer to accept.</p>,
        <Btn key="cancel" secondary onClick={() => run({ title: "Cancel job and refund", method: "cancelJob", args: [job.id], details: [["Refund", `${formatEth(job.totalAmount)} ETH, withdrawable afterwards`]] })}>
          Cancel and refund
        </Btn>
      );
    if (job.status === "InProgress" && submitted) {
      none.push(
        <Btn key="approve" onClick={() => run({ title: `Approve milestone ${active.index + 1}`, method: "approveMilestone", args: [job.id, active.index], details: [["Pays freelancer", `${formatEth(active.amount)} ETH minus ${(job.feeBps / 100).toFixed(2)}% fee`]] })}>
          Approve and pay {formatEth(active.amount)} ETH
        </Btn>
      );
      if (reviewOpen) none.push(<Btn key="dispute" danger onClick={() => setForm(form === "dispute" ? null : "dispute")}>Reject / open dispute</Btn>);
      else none.push(<p key="late" className="text-xs text-slate-500">The review period has ended; a dispute can no longer be opened.</p>);
    }
    if (job.status === "InProgress" && !submitted) none.push(<p key="w" className="text-sm text-slate-500">Waiting for the freelancer to submit milestone {active ? active.index + 1 : ""}.</p>);
  }

  // ---- freelancer (anyone who is not the client can take a funded job)
  if (!isClient && job.status === "Funded")
    none.push(<Btn key="accept" onClick={() => run({ title: "Accept job", method: "acceptJob", args: [job.id], details: [["Job", `#${job.id}`], ["You will earn", `${formatEth(job.totalAmount)} ETH minus fee`]] })}>Accept this job</Btn>);

  if (isFreelancer) {
    if (job.status === "InProgress" && active?.status === "Pending")
      none.push(<Btn key="submit" onClick={() => setForm(form === "submit" ? null : "submit")}>Submit milestone {active.index + 1}</Btn>);
    if (job.status === "InProgress" && reviewOpen)
      none.push(
        <p key="r" className="text-sm text-slate-500">Submitted. The client has until {formatDate(active.submittedAt + reviewPeriod)} to respond.</p>,
        <Btn key="dispute" secondary onClick={() => setForm(form === "dispute" ? null : "dispute")}>Open dispute</Btn>
      );
    if (job.status === "InProgress" && reviewOver)
      none.push(<Btn key="claim" onClick={() => run({ title: "Claim payment (review period over)", method: "claimTimeout", args: [job.id, active.index] })}>Claim {formatEth(active.amount)} ETH</Btn>);
  }

  if ((isClient || isFreelancer) && job.status === "Disputed" && openDispute)
    none.push(
      <Link key="d" to={`/disputes/${openDispute.id}`} className="btn-secondary w-full">
        Go to dispute #{openDispute.id}
      </Link>
    );

  // ---- rating
  if ((isClient || isFreelancer) && finished && !alreadyRated)
    none.push(
      <div key="rate" className="space-y-2">
        <label className="label" htmlFor="score">Rate the {isClient ? "freelancer" : "client"}</label>
        <select id="score" className="input" value={score} onChange={(e) => setScore(Number(e.target.value))}>
          {[5, 4, 3, 2, 1].map((s) => <option key={s} value={s}>{s} / 5</option>)}
        </select>
        <Btn secondary onClick={() => run({ title: "Submit rating", contract: "JobEscrow", method: "rateCounterparty", args: [job.id, score] })}>Submit rating</Btn>
      </div>
    );
  if ((isClient || isFreelancer) && finished && alreadyRated) none.push(<p key="rated" className="text-sm text-emerald-700">You rated this job. Thank you.</p>);

  // ---- auditor
  if (hasRole("auditor") && !job.flagged)
    none.push(
      <Btn
        key="flag"
        secondary
        onClick={() => {
          const reason = window.prompt("Why is this job suspicious?");
          if (reason) run({ title: "Flag job for review", method: "flagJob", args: [job.id, keccak(reason)], details: [["Reason", reason]] });
        }}
      >
        ⚑ Flag this job
      </Btn>
    );

  return (
    <div className="mt-3 space-y-3">
      {none}
      {form === "submit" && (
        <ProofForm title="What are you delivering?" text={text} setText={setText} link={link} setLink={setLink} busy={busy} cta="Submit for review" onSubmit={submitMilestone} />
      )}
      {form === "dispute" && (
        <ProofForm title="Why are you disputing?" text={text} setText={setText} link={link} setLink={setLink} busy={busy} cta="Open dispute" danger onSubmit={raiseDispute} />
      )}
      {none.length === 0 && !form && <p className="text-sm text-slate-500">No actions are available to you right now.</p>}
    </div>
  );
}

function ProofForm({ title, text, setText, link, setLink, busy, cta, danger, onSubmit }) {
  return (
    <div className="space-y-2 rounded-lg bg-slate-50 p-3">
      <label className="label" htmlFor="proof-text">{title}</label>
      <textarea id="proof-text" className="input min-h-24" value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} />
      <label className="label" htmlFor="proof-link">Link (optional)</label>
      <input id="proof-link" className="input" type="url" placeholder="https://…" value={link} onChange={(e) => setLink(e.target.value)} />
      <button className={`${danger ? "btn-danger" : "btn-primary"} w-full`} disabled={busy} onClick={onSubmit}>
        {cta}
      </button>
      <p className="text-xs text-slate-500">The text is stored by the platform; only its hash goes on-chain, so it cannot be changed afterwards.</p>
    </div>
  );
}
