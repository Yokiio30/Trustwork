import { useState } from "react";
import { Link } from "react-router-dom";
import { id as keccak, formatUnits } from "ethers";
import { Address, Empty, ErrorBox, PageHeader, Spinner } from "../components/ui";
import JobCard from "../components/JobCard";
import { useWeb3 } from "../context/Web3";
import { useTx } from "../context/Tx";
import { describeEvent, EVENT_NAMES } from "../lib/events";
import { formatDate, shortHash } from "../lib/format";
import { qs } from "../lib/api";
import { useApi, useDocumentTitle } from "../lib/hooks";

const TABS = [["flagged", "Flagged jobs"], ["txs", "Transactions & gas"], ["events", "Event log"]];

function downloadCsv(name, rows) {
  const esc = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const csv = rows.map((r) => r.map(esc).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

export default function Audit() {
  useDocumentTitle("Audit");
  const [tab, setTab] = useState("flagged");
  return (
    <>
      <PageHeader title="Audit" subtitle="Read-only view of everything that happened on-chain. Auditors can flag jobs but cannot move funds." />
      <div className="mb-4 flex flex-wrap gap-1" role="tablist">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded-full px-3 py-1.5 text-sm font-medium ${tab === k ? "bg-brand-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"}`}>
            {l}
          </button>
        ))}
      </div>
      {tab === "flagged" && <Flagged />}
      {tab === "txs" && <Txs />}
      {tab === "events" && <Events />}
    </>
  );
}

function Flagged() {
  const { hasRole } = useWeb3();
  const { sendTx } = useTx();
  const { data, error, loading, reload } = useApi("/jobs?flagged=true&limit=50");
  const [jobId, setJobId] = useState("");
  const [reason, setReason] = useState("");

  const flag = async () => {
    if (!jobId || !reason.trim()) return;
    const r = await sendTx({ title: "Flag job for review", contract: "JobEscrow", method: "flagJob", args: [jobId, keccak(reason.trim())], details: [["Job", `#${jobId}`], ["Reason", reason.trim()]] });
    if (r) { setJobId(""); setReason(""); reload(); }
  };

  return (
    <>
      {hasRole("auditor") && (
        <div className="card mb-4 flex flex-wrap items-end gap-3 p-4">
          <div><label className="label" htmlFor="fj">Job #</label><input id="fj" className="input !w-24" inputMode="numeric" value={jobId} onChange={(e) => setJobId(e.target.value.replace(/\D/g, ""))} /></div>
          <div className="min-w-48 flex-1"><label className="label" htmlFor="fr">Reason</label><input id="fr" className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What looks suspicious?" /></div>
          <button className="btn-primary" disabled={!jobId || !reason.trim()} onClick={flag}>Flag job</button>
        </div>
      )}
      {loading && !data && <Spinner />}
      <ErrorBox error={error} onRetry={reload} />
      {data && data.items.length === 0 && <Empty title="No flagged jobs">Flags are permanent on-chain notes; they do not freeze funds.</Empty>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{data?.items.map((j) => <JobCard key={j.id} job={j} />)}</div>
    </>
  );
}

function Txs() {
  const [page, setPage] = useState(0);
  const [method, setMethod] = useState("");
  const LIMIT = 25;
  const { data, error, loading, reload } = useApi(`/txs${qs({ limit: LIMIT, offset: page * LIMIT, method })}`);
  const { data: stats } = useApi("/stats");
  const methods = stats?.gasByMethod.map((g) => g.method) ?? [];

  const exportCsv = () =>
    downloadCsv("transactions.csv", [
      ["time", "block", "hash", "from", "method", "gas_used", "gas_price_gwei", "success"],
      ...data.items.map((t) => [new Date(t.timestamp * 1000).toISOString(), t.block, t.hash, t.from, t.method, t.gasUsed, formatUnits(t.gasPrice, "gwei"), t.success]),
    ]);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select className="input !w-auto" value={method} onChange={(e) => { setMethod(e.target.value); setPage(0); }} aria-label="Filter by method">
          <option value="">All methods</option>
          {methods.map((m) => <option key={m}>{m}</option>)}
        </select>
        <button className="btn-secondary ml-auto" disabled={!data?.items.length} onClick={exportCsv}>Export this page (CSV)</button>
      </div>
      {loading && !data && <Spinner />}
      <ErrorBox error={error} onRetry={reload} />
      {data && (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>When</th><th>Block</th><th>Method</th><th>From</th><th>Gas used</th><th>Gas price</th><th>Status</th><th>Hash</th></tr></thead>
            <tbody>
              {data.items.map((t) => (
                <tr key={t.hash}>
                  <td>{formatDate(t.timestamp)}</td><td>{t.block}</td><td className="font-medium">{t.method}</td>
                  <td><Address value={t.from} /></td><td>{t.gasUsed.toLocaleString()}</td>
                  <td>{Number(formatUnits(t.gasPrice, "gwei")).toFixed(2)} gwei</td>
                  <td className={t.success ? "text-emerald-700" : "text-rose-700"}>{t.success ? "Success" : "Failed"}</td>
                  <td className="font-mono text-xs">{shortHash(t.hash)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} setPage={setPage} total={data?.total ?? 0} limit={LIMIT} />
    </>
  );
}

function Events() {
  const [page, setPage] = useState(0);
  const [name, setName] = useState("");
  const LIMIT = 25;
  const { data, error, loading, reload } = useApi(`/events${qs({ limit: LIMIT, offset: page * LIMIT, name })}`);

  const exportCsv = () =>
    downloadCsv("events.csv", [
      ["time", "block", "contract", "event", "job", "dispute", "actor", "tx", "description"],
      ...data.items.map((e) => [new Date(e.timestamp * 1000).toISOString(), e.block, e.contract, e.name, e.jobId, e.disputeId, e.actor, e.txHash, describeEvent(e)]),
    ]);

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <select className="input !w-auto" value={name} onChange={(e) => { setName(e.target.value); setPage(0); }} aria-label="Filter by event">
          <option value="">All events</option>
          {EVENT_NAMES.map((n) => <option key={n}>{n}</option>)}
        </select>
        <button className="btn-secondary ml-auto" disabled={!data?.items.length} onClick={exportCsv}>Export this page (CSV)</button>
      </div>
      {loading && !data && <Spinner />}
      <ErrorBox error={error} onRetry={reload} />
      {data && (
        <div className="card table-wrap">
          <table>
            <thead><tr><th>When</th><th>Contract</th><th>Event</th><th>Description</th><th>By</th><th>Job</th></tr></thead>
            <tbody>
              {data.items.map((e) => (
                <tr key={e.id}>
                  <td>{formatDate(e.timestamp)}</td><td>{e.contract}</td><td className="font-medium">{e.name}</td>
                  <td className="max-w-md truncate" title={describeEvent(e)}>{describeEvent(e)}</td>
                  <td><Address value={e.actor} /></td>
                  <td>{e.jobId ? <Link className="text-brand-700 hover:underline" to={`/jobs/${e.jobId}`}>#{e.jobId}</Link> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} setPage={setPage} total={data?.total ?? 0} limit={LIMIT} />
    </>
  );
}

function Pager({ page, setPage, total, limit }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-center gap-3 text-sm">
      <button className="btn-secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
      <span className="text-slate-500">Page {page + 1} of {pages}</span>
      <button className="btn-secondary" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</button>
    </div>
  );
}
