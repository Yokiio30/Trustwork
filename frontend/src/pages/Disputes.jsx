import { useState } from "react";
import { Link } from "react-router-dom";
import { Empty, ErrorBox, PageHeader, Spinner, StatusBadge } from "../components/ui";
import { useWeb3 } from "../context/Web3";
import { formatDate } from "../lib/format";
import { qs } from "../lib/api";
import { useApi, useDocumentTitle } from "../lib/hooks";

export default function Disputes() {
  useDocumentTitle("Disputes");
  const { hasRole } = useWeb3();
  const [status, setStatus] = useState("");
  const { data, error, loading, reload } = useApi(`/disputes${qs({ status, limit: 50 })}`, { refreshMs: 8000 });

  return (
    <>
      <PageHeader
        title="Disputes"
        subtitle={hasRole("arbiter") ? "You are an arbiter. Open disputes need your vote." : "When client and freelancer disagree, independent arbiters decide."}
      />
      <div className="mb-4 flex gap-1" role="tablist" aria-label="Filter disputes">
        {[["", "All"], ["Open", "Open"], ["Resolved", "Resolved"]].map(([v, l]) => (
          <button key={v} role="tab" aria-selected={status === v} onClick={() => setStatus(v)} className={`rounded-full px-3 py-1.5 text-sm font-medium ${status === v ? "bg-brand-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"}`}>
            {l}
          </button>
        ))}
      </div>

      {loading && !data && <Spinner />}
      <ErrorBox error={error} onRetry={reload} />
      {data && data.items.length === 0 && <Empty title="No disputes">Nothing to decide right now.</Empty>}
      {data && data.items.length > 0 && (
        <div className="card table-wrap">
          <table>
            <thead>
              <tr><th>Dispute</th><th>Job</th><th>Status</th><th>Votes (freelancer / client)</th><th>Opened</th><th>Voting ends</th></tr>
            </thead>
            <tbody>
              {data.items.map((d) => (
                <tr key={d.id} className="hover:bg-slate-50">
                  <td><Link className="font-medium text-brand-700 hover:underline" to={`/disputes/${d.id}`}>#{d.id}</Link></td>
                  <td><Link className="hover:underline" to={`/jobs/${d.jobId}`}>Job #{d.jobId}</Link></td>
                  <td><StatusBadge status={d.status} dispute />{d.freelancerWon !== null && <span className="ml-2 text-xs text-slate-500">for {d.freelancerWon ? "freelancer" : "client"}</span>}</td>
                  <td>{d.votesFreelancer} / {d.votesClient}</td>
                  <td>{formatDate(d.createdAt)}</td>
                  <td>{formatDate(d.votingDeadline)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
