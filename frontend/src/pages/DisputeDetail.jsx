import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Address, DocView, ErrorBox, Spinner, StatusBadge } from "../components/ui";
import { useWeb3 } from "../context/Web3";
import { useTx } from "../context/Tx";
import { useToast } from "../context/Toast";
import { api } from "../lib/api";
import { friendlyError } from "../lib/errors";
import { describeEvent } from "../lib/events";
import { formatDate, formatDuration, formatEth, sameAddr } from "../lib/format";
import { useApi, useDocumentTitle, useNow } from "../lib/hooks";

const VOTES_REQUIRED = 2; // matches DisputeResolution.VOTES_REQUIRED

export default function DisputeDetail() {
  const { id } = useParams();
  useDocumentTitle(`Dispute #${id}`);
  const { data: d, error, loading, reload } = useApi(`/disputes/${id}`, { refreshMs: 5000 });
  if (loading && !d) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return <Detail d={d} reload={reload} />;
}

function Detail({ d, reload }) {
  const { account, authed, hasRole, wrongNetwork } = useWeb3();
  const { sendTx } = useTx();
  const toast = useToast();
  const now = useNow();
  const [evidence, setEvidence] = useState({ text: "", link: "" });
  const [busy, setBusy] = useState(false);

  const job = d.job;
  const open = d.status === "Open";
  const isParty = job && (sameAddr(account, job.client) || sameAddr(account, job.freelancer));
  const hasVoted = d.votes.some((v) => sameAddr(v.arbiter, account));
  const votingOpen = open && now <= d.votingDeadline;
  const canVote = authed && !wrongNetwork && hasRole("arbiter") && !isParty && !hasVoted && votingOpen;
  const decided = d.votesFreelancer >= VOTES_REQUIRED || d.votesClient >= VOTES_REQUIRED || now > d.votingDeadline;
  const total = Math.max(d.votesFreelancer + d.votesClient, 1);
  const evidenceEvents = d.events.filter((e) => e.name === "EvidenceSubmitted");

  const act = async (opts) => {
    setBusy(true);
    try {
      if (await sendTx(opts)) reload();
    } finally {
      setBusy(false);
    }
  };

  const vote = (favorFreelancer) =>
    act({
      title: `Vote for the ${favorFreelancer ? "freelancer" : "client"}`,
      contract: "DisputeResolution",
      method: "castVote",
      args: [d.id, favorFreelancer],
      details: [["Dispute", `#${d.id}`], ["Your vote", favorFreelancer ? "Pay the freelancer" : "Refund the client"], ["Note", "Votes are public and cannot be changed"]],
    });

  const submitEvidence = async () => {
    if (!evidence.text.trim()) return toast.error("Describe your evidence.");
    try {
      const { hash } = await api("/documents", {
        method: "POST",
        body: { kind: "evidence", content: { text: evidence.text.trim(), ...(evidence.link.trim() ? { links: [evidence.link.trim()] } : {}) } },
      });
      await act({
        title: "Submit evidence",
        contract: "DisputeResolution",
        method: "submitEvidence",
        args: [d.id, hash, evidence.text.trim().slice(0, 80)],
        details: [["Dispute", `#${d.id}`]],
      });
      setEvidence({ text: "", link: "" });
    } catch (e) {
      toast.error(friendlyError(e));
    }
  };

  const milestone = job?.milestones?.[d.milestoneIndex];
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <section className="card p-5">
          <p className="text-xs text-slate-500"><Link to="/disputes" className="hover:underline">Disputes</Link> / #{d.id}</p>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Dispute #{d.id}</h1>
            <StatusBadge status={d.status} dispute />
          </div>
          {job && (
            <p className="mt-2 text-sm text-slate-600">
              On <Link to={`/jobs/${job.id}`} className="font-medium text-brand-700 hover:underline">{job.metadata?.title || `Job #${job.id}`}</Link>, milestone {d.milestoneIndex + 1}
              {milestone && <> ({formatEth(milestone.amount)} ETH)</>}.
            </p>
          )}
          <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            <Mini label="Client">{job ? <Address value={job.client} /> : "—"}</Mini>
            <Mini label="Freelancer">{job ? <Address value={job.freelancer} /> : "—"}</Mini>
            <Mini label="Opened by"><Address value={d.raisedBy} /></Mini>
            <Mini label="Voting ends">{formatDate(d.votingDeadline)}</Mini>
          </dl>
          <div className="mt-4 rounded-lg bg-slate-50 p-3">
            <p className="mb-1 text-xs font-medium text-slate-500">Reason for the dispute</p>
            <DocView hash={d.reasonHash} />
          </div>
          {milestone?.deliverableHash && (
            <div className="mt-3 rounded-lg bg-slate-50 p-3">
              <p className="mb-1 text-xs font-medium text-slate-500">Submitted deliverable</p>
              <DocView hash={milestone.deliverableHash} />
            </div>
          )}
        </section>

        <section className="card p-5">
          <h2 className="font-semibold text-slate-900">Evidence</h2>
          {evidenceEvents.length === 0 && <p className="mt-2 text-sm text-slate-500">No evidence has been submitted yet.</p>}
          <ul className="mt-3 space-y-3">
            {evidenceEvents.map((e) => (
              <li key={e.id} className="rounded-lg border border-slate-200 p-3">
                <p className="mb-1 text-xs text-slate-500">
                  From {sameAddr(e.args.submitter, job?.client) ? "client" : "freelancer"} <Address value={e.args.submitter} /> · {formatDate(e.timestamp)}
                </p>
                <DocView hash={e.args.evidenceHash} />
              </li>
            ))}
          </ul>
          {open && authed && isParty && (
            <div className="mt-4 space-y-2 rounded-lg bg-slate-50 p-3">
              <label className="label" htmlFor="ev-text">Add evidence</label>
              <textarea id="ev-text" className="input min-h-20" value={evidence.text} onChange={(e) => setEvidence((v) => ({ ...v, text: e.target.value }))} maxLength={4000} />
              <input className="input" type="url" placeholder="Link (optional) https://…" value={evidence.link} onChange={(e) => setEvidence((v) => ({ ...v, link: e.target.value }))} aria-label="Evidence link" />
              <button className="btn-primary" disabled={busy || wrongNetwork} onClick={submitEvidence}>Submit evidence</button>
            </div>
          )}
        </section>

        <section className="card p-5">
          <h2 className="font-semibold text-slate-900">Timeline</h2>
          <ol className="mt-3 space-y-2 text-sm">
            {d.events.map((e) => (
              <li key={e.id} className="flex flex-wrap justify-between gap-2">
                <span className="text-slate-800">{describeEvent(e)}</span>
                <span className="text-xs text-slate-500">{formatDate(e.timestamp)}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <aside className="space-y-4">
        <div className="card p-5">
          <h2 className="font-semibold text-slate-900">Votes</h2>
          <Bar label="Pay the freelancer" value={d.votesFreelancer} pct={(d.votesFreelancer / total) * 100} color="bg-emerald-500" />
          <Bar label="Refund the client" value={d.votesClient} pct={(d.votesClient / total) * 100} color="bg-rose-500" />
          <p className="mt-3 text-xs text-slate-500">
            First side to {VOTES_REQUIRED} votes wins. If voting ends first, the larger side wins and a tie favours the client.
            {votingOpen && <> Time left: {formatDuration(d.votingDeadline - now)}.</>}
          </p>
          {d.votes.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-slate-600">
              {d.votes.map((v) => (
                <li key={v.arbiter} className="flex justify-between"><Address value={v.arbiter} /> <span>{v.favorFreelancer ? "freelancer" : "client"}</span></li>
              ))}
            </ul>
          )}
        </div>

        <div className="card space-y-3 p-5">
          <h2 className="font-semibold text-slate-900">Actions</h2>
          {!authed && <p className="text-sm text-slate-500">Sign in with your wallet to take part.</p>}
          {authed && !open && <p className="text-sm text-slate-500">This dispute has been resolved for the {d.freelancerWon ? "freelancer" : "client"}.</p>}
          {canVote && (
            <>
              <button className="btn-primary w-full" disabled={busy} onClick={() => vote(true)}>Vote: pay the freelancer</button>
              <button className="btn-danger w-full" disabled={busy} onClick={() => vote(false)}>Vote: refund the client</button>
            </>
          )}
          {authed && open && hasRole("arbiter") && isParty && <p className="text-sm text-amber-700">You are a party to this job, so you cannot vote.</p>}
          {authed && open && hasRole("arbiter") && hasVoted && <p className="text-sm text-emerald-700">Your vote is recorded.</p>}
          {open && decided && (
            <button className="btn-secondary w-full" disabled={busy || !authed || wrongNetwork} onClick={() => act({ title: "Execute resolution", contract: "DisputeResolution", method: "executeResolution", args: [d.id], details: [["Dispute", `#${d.id}`], ["Effect", "Moves the escrowed funds according to the votes"]] })}>
              Execute the verdict
            </button>
          )}
          {open && !decided && !canVote && <p className="text-sm text-slate-500">Waiting for arbiters to vote.</p>}
        </div>
      </aside>
    </div>
  );
}

const Mini = ({ label, children }) => (
  <div>
    <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
    <dd className="mt-0.5 font-medium text-slate-900">{children}</dd>
  </div>
);

function Bar({ label, value, pct, color }) {
  return (
    <div className="mt-3">
      <div className="mb-1 flex justify-between text-sm"><span>{label}</span><span className="font-medium">{value}</span></div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={`h-full ${color}`} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}
