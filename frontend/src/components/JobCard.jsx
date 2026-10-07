import { Link } from "react-router-dom";
import { Address, StatusBadge } from "./ui";
import { formatEth, timeAgo } from "../lib/format";

export default function JobCard({ job, note }) {
  const title = job.metadata?.title || `Job #${job.id}`;
  return (
    <Link to={`/jobs/${job.id}`} className="card block p-4 transition hover:border-brand-500 hover:shadow-md focus-visible:outline-2 focus-visible:outline-brand-500">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-slate-900">{title}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            #{job.id}
            {job.metadata?.category && <> · {job.metadata.category}</>} · {timeAgo(job.createdAt)}
          </p>
        </div>
        <StatusBadge status={job.status} />
      </div>
      {job.metadata?.description && <p className="mt-2 line-clamp-2 text-sm text-slate-600">{job.metadata.description}</p>}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-semibold text-slate-900">{formatEth(job.totalAmount)} ETH</span>
        <span className="text-xs text-slate-500">
          {job.milestoneCount} milestone{job.milestoneCount > 1 ? "s" : ""} · client <Address value={job.client} link={false} />
        </span>
      </div>
      {job.flagged && <p className="mt-2 text-xs font-medium text-amber-700">⚑ Flagged by an auditor</p>}
      {note && <p className="mt-2 rounded bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700">{note}</p>}
    </Link>
  );
}
