import { useState } from "react";
import { Link } from "react-router-dom";
import JobCard from "../components/JobCard";
import { Empty, ErrorBox, PageHeader, Spinner } from "../components/ui";
import { useApi, useDocumentTitle } from "../lib/hooks";
import { qs } from "../lib/api";

const PAGE = 12;
const FILTERS = [
  ["", "All jobs"],
  ["Funded", "Open for work"],
  ["InProgress", "In progress"],
  ["Disputed", "In dispute"],
  ["Completed", "Completed"],
];

export default function Marketplace() {
  useDocumentTitle("Marketplace");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const { data, error, loading, reload } = useApi(`/jobs${qs({ status, limit: PAGE, offset: page * PAGE })}`, { refreshMs: 10000 });

  const q = search.trim().toLowerCase();
  const items = (data?.items ?? []).filter((j) => !q || `${j.metadata?.title ?? ""} ${j.metadata?.description ?? ""} ${j.metadata?.category ?? ""} #${j.id}`.toLowerCase().includes(q));
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE)) : 1;

  return (
    <>
      <PageHeader title="Marketplace" subtitle="Funds are locked in a smart contract until the work is approved.">
        <Link to="/jobs/new" className="btn-primary">
          Post a job
        </Link>
      </PageHeader>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filter jobs">
          {FILTERS.map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={status === value}
              onClick={() => { setStatus(value); setPage(0); }}
              className={`rounded-full px-3 py-1.5 text-sm font-medium ${status === value ? "bg-brand-600 text-white" : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-100"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <input className="input ml-auto w-full sm:w-64" type="search" placeholder="Search this page…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search jobs" />
      </div>

      {loading && !data && <Spinner />}
      <ErrorBox error={error} onRetry={reload} />
      {data && items.length === 0 && (
        <Empty title="No jobs here yet">
          {status ? "Try another filter." : <Link to="/jobs/new" className="text-brand-600 underline">Post the first job</Link>}
        </Empty>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((j) => (
          <JobCard key={j.id} job={j} />
        ))}
      </div>

      {data && pages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-3 text-sm">
          <button className="btn-secondary" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            Previous
          </button>
          <span className="text-slate-500">
            Page {page + 1} of {pages}
          </span>
          <button className="btn-secondary" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </button>
        </div>
      )}
    </>
  );
}
