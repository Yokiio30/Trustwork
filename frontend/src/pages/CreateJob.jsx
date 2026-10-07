import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { parseEther } from "ethers";
import { PageHeader } from "../components/ui";
import { useWeb3 } from "../context/Web3";
import { useTx } from "../context/Tx";
import { useToast } from "../context/Toast";
import { api } from "../lib/api";
import { findEvent } from "../lib/chain";
import { friendlyError } from "../lib/errors";
import { useDocumentTitle } from "../lib/hooks";

const MAX_MILESTONES = 5;
const CATEGORIES = ["Development", "Design", "Writing", "Translation", "Data", "Audio / Video", "Security", "Other"];

export default function CreateJob() {
  useDocumentTitle("Post a job");
  const { config, account, authed, connect, signIn, wrongNetwork } = useWeb3();
  const { sendTx } = useTx();
  const toast = useToast();
  const navigate = useNavigate();

  const [form, setForm] = useState({ title: "", description: "", category: CATEGORIES[0] });
  const [amounts, setAmounts] = useState(["0.1"]);
  const [fundNow, setFundNow] = useState(true);
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const parsed = amounts.map((a) => {
    try {
      const v = parseEther(a || "0");
      return v > 0n ? v : null;
    } catch {
      return null;
    }
  });
  const amountsValid = parsed.every((v) => v !== null);
  const total = amountsValid ? parsed.reduce((s, v) => s + v, 0n) : 0n;
  const feeBps = config?.params?.feeBps ?? 100;
  const errors = {
    title: form.title.trim().length < 3 ? "Give the job a title (3+ characters)." : null,
    description: form.description.trim().length < 10 ? "Describe the work in at least 10 characters." : null,
    amounts: !amountsValid ? "Every milestone needs an amount greater than 0." : null,
  };
  const valid = !errors.title && !errors.description && !errors.amounts;
  const [touched, setTouched] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    if (!account) return connect().catch((err) => toast.error(friendlyError(err)));
    if (!authed) return signIn();

    setBusy(true);
    try {
      const { hash } = await api("/documents", {
        method: "POST",
        body: { kind: "job", content: { title: form.title.trim(), description: form.description.trim(), category: form.category } },
      });

      const receipt = await sendTx({
        title: "Create job",
        contract: "JobEscrow",
        method: "createJob",
        args: [hash, parsed],
        details: [["Job", form.title.trim()], ["Milestones", String(parsed.length)]],
      });
      if (!receipt) return;
      const jobId = findEvent(config, "JobEscrow", receipt, "JobCreated")?.args.jobId;

      if (fundNow && jobId !== undefined) {
        await sendTx({
          title: "Lock funds in escrow",
          contract: "JobEscrow",
          method: "fundJob",
          args: [jobId],
          value: total,
          details: [["Job", `#${jobId} ${form.title.trim()}`]],
        });
      }
      navigate(`/jobs/${jobId}`);
    } catch (err) {
      toast.error(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  const show = (k) => touched && errors[k];

  return (
    <>
      <PageHeader title="Post a job" subtitle="Split the work into milestones. The freelancer is paid as you approve each one." />
      <form onSubmit={submit} className="grid grid-cols-1 gap-6 lg:grid-cols-3" noValidate>
        <div className="card space-y-4 p-5 lg:col-span-2">
          <div>
            <label className="label" htmlFor="title">Title</label>
            <input id="title" className="input" value={form.title} onChange={set("title")} maxLength={120} placeholder="e.g. Redesign our landing page" />
            {show("title") && <p className="mt-1 text-xs text-rose-600">{errors.title}</p>}
          </div>
          <div>
            <label className="label" htmlFor="category">Category</label>
            <select id="category" className="input" value={form.category} onChange={set("category")}>
              {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="description">What needs to be done?</label>
            <textarea id="description" className="input min-h-32" value={form.description} onChange={set("description")} maxLength={4000} placeholder="Scope, deliverables and what counts as done." />
            {show("description") && <p className="mt-1 text-xs text-rose-600">{errors.description}</p>}
          </div>

          <fieldset>
            <legend className="label">Milestones (paid in ETH)</legend>
            <div className="space-y-2">
              {amounts.map((a, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-28 shrink-0 whitespace-nowrap text-sm text-slate-500">Milestone {i + 1}</span>
                  <input
                    className="input"
                    inputMode="decimal"
                    value={a}
                    onChange={(e) => setAmounts((arr) => arr.map((x, j) => (j === i ? e.target.value : x)))}
                    aria-label={`Milestone ${i + 1} amount in ETH`}
                  />
                  <button type="button" className="btn-ghost" disabled={amounts.length === 1} onClick={() => setAmounts((arr) => arr.filter((_, j) => j !== i))} aria-label={`Remove milestone ${i + 1}`}>
                    ✕
                  </button>
                </div>
              ))}
            </div>
            {show("amounts") && <p className="mt-1 text-xs text-rose-600">{errors.amounts}</p>}
            <button type="button" className="btn-secondary mt-3" disabled={amounts.length >= MAX_MILESTONES} onClick={() => setAmounts((a) => [...a, "0.1"])}>
              Add milestone
            </button>
          </fieldset>
        </div>

        <aside className="card h-fit space-y-4 p-5">
          <h2 className="font-semibold text-slate-900">Summary</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Job total</dt><dd className="font-semibold">{amountsValid ? Number(total) / 1e18 : "—"} ETH</dd></div>
            <div className="flex justify-between"><dt className="text-slate-500">Platform fee ({(feeBps / 100).toFixed(2)}%)</dt><dd>{amountsValid ? ((Number(total) / 1e18) * feeBps) / 10000 : "—"} ETH</dd></div>
            <p className="text-xs text-slate-500">The fee is taken from the freelancer's payout, so you only lock the job total.</p>
          </dl>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" checked={fundNow} onChange={(e) => setFundNow(e.target.checked)} />
            <span>Lock the funds right away (2 transactions). You can also fund later from the job page.</span>
          </label>
          <button className="btn-primary w-full" disabled={busy || wrongNetwork}>
            {busy ? "Working…" : !account ? "Connect wallet to continue" : !authed ? "Sign in to continue" : "Create job"}
          </button>
        </aside>
      </form>
    </>
  );
}
