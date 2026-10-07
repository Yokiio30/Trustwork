import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { shortAddr } from "../lib/format";
import { useWeb3 } from "../context/Web3";

const STATUS_STYLE = {
  Open: "bg-slate-100 text-slate-700",
  Funded: "bg-sky-100 text-sky-800",
  InProgress: "bg-indigo-100 text-indigo-800",
  Disputed: "bg-amber-100 text-amber-800",
  Completed: "bg-emerald-100 text-emerald-800",
  Cancelled: "bg-slate-100 text-slate-500",
  Terminated: "bg-rose-100 text-rose-800",
  Pending: "bg-slate-100 text-slate-600",
  Submitted: "bg-sky-100 text-sky-800",
  Approved: "bg-emerald-100 text-emerald-800",
  Refunded: "bg-rose-100 text-rose-800",
  Resolved: "bg-emerald-100 text-emerald-800",
};
const STATUS_LABEL = { InProgress: "In progress", Funded: "Awaiting freelancer", Open: "Awaiting funds" };

const DISPUTE_LABEL = { Open: "Voting open", Resolved: "Resolved" };

export function StatusBadge({ status, dispute }) {
  const style = dispute && status === "Open" ? "bg-amber-100 text-amber-800" : STATUS_STYLE[status] || "bg-slate-100 text-slate-700";
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${style}`}>
      {(dispute ? DISPUTE_LABEL[status] : STATUS_LABEL[status]) || status}
    </span>
  );
}

export function Address({ value, link = true, you }) {
  const { account } = useWeb3();
  if (!value) return <span className="text-slate-400">—</span>;
  const mine = (you ?? true) && account && value.toLowerCase() === account;
  const inner = (
    <span className="font-mono text-xs" title={value}>
      {shortAddr(value)}
      {mine && <span className="ml-1 rounded bg-brand-100 px-1 py-0.5 font-sans text-[10px] font-semibold text-brand-700">YOU</span>}
    </span>
  );
  return link ? (
    <Link to={`/profile/${value}`} className="hover:underline">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function Spinner({ label = "Loading…" }) {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-sm text-slate-500" role="status">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
      {label}
    </div>
  );
}

export function ErrorBox({ error, onRetry }) {
  if (!error) return null;
  return (
    <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert">
      <p>{error.message || String(error)}</p>
      {onRetry && (
        <button onClick={onRetry} className="mt-2 font-medium underline">
          Try again
        </button>
      )}
    </div>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center">
      <p className="font-medium text-slate-700">{title}</p>
      {children && <div className="mt-1 text-sm text-slate-500">{children}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, hint }) {
  return (
    <div className="card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

/** Page gate: shows why access is denied instead of a blank screen. */
export function RequireRole({ roles, children }) {
  const { account, authed, hasRole, connect, signIn, authBusy } = useWeb3();
  if (!account)
    return (
      <Empty title="Connect your wallet">
        <p>This page is only for signed-in {roles.join(" / ")} accounts.</p>
        <button className="btn-primary mt-4" onClick={() => connect().catch(() => {})}>
          Connect wallet
        </button>
      </Empty>
    );
  if (!authed)
    return (
      <Empty title="Sign in to continue">
        <button className="btn-primary mt-4" onClick={signIn} disabled={authBusy}>
          {authBusy ? "Waiting for signature…" : "Sign in with wallet"}
        </button>
      </Empty>
    );
  if (!roles.some(hasRole))
    return (
      <Empty title="Access restricted">
        This page needs the {roles.join(" or ")} role. Roles are granted on-chain by the platform admin.
      </Empty>
    );
  return children;
}

/** Loads and shows an off-chain document referenced by hash. Private documents may be forbidden; that is shown, not hidden. */
export function DocView({ hash, fallback = "No text attached." }) {
  const [state, setState] = useState({ loading: true });
  const { authed } = useWeb3();

  useEffect(() => {
    let live = true;
    if (!hash || /^0x0+$/.test(hash)) {
      setState({ empty: true });
      return;
    }
    setState({ loading: true });
    api(`/documents/${hash}`)
      .then((d) => live && setState({ doc: d }))
      .catch((e) => live && setState({ error: e }));
    return () => {
      live = false;
    };
  }, [hash, authed]);

  if (state.loading) return <p className="text-sm text-slate-400">Loading…</p>;
  if (state.empty) return <p className="text-sm text-slate-400">{fallback}</p>;
  if (state.error) {
    const restricted = state.error.status === 401 || state.error.status === 403;
    return (
      <p className="text-sm text-slate-400">
        {restricted ? "Only the job's parties, arbiters and auditors can read this. Sign in with an authorised account." : state.error.status === 404 ? "The text for this hash is not stored on this server." : state.error.message}
      </p>
    );
  }
  const c = state.doc.content;
  return (
    <div className="text-sm text-slate-700">
      <p className="whitespace-pre-wrap">{c.text ?? c.description}</p>
      {c.links?.length > 0 && (
        <ul className="mt-2 space-y-1">
          {c.links.map((l) => (
            <li key={l}>
              <a href={l} target="_blank" rel="noopener noreferrer" className="break-all text-brand-600 hover:underline">
                {l}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
