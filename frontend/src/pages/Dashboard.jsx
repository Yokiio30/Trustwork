import { useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Address, ErrorBox, PageHeader, Spinner, Stat } from "../components/ui";
import { describeEvent, EVENT_NAMES } from "../lib/events";
import { formatDate, formatDuration, shortHash } from "../lib/format";
import { qs } from "../lib/api";
import { useApi, useDocumentTitle } from "../lib/hooks";

const STATUS_COLOR = { Open: "#94a3b8", Funded: "#0ea5e9", InProgress: "#6366f1", Disputed: "#f59e0b", Completed: "#10b981", Cancelled: "#cbd5e1", Terminated: "#f43f5e" };
const STATUS_LABEL = { InProgress: "In progress", Funded: "Awaiting freelancer", Open: "Awaiting funds" };
const eth = (n) => `${Number(n).toLocaleString(undefined, { maximumFractionDigits: 4 })} ETH`;

export default function Dashboard() {
  useDocumentTitle("Dashboard");
  const { data: s, error, loading, reload } = useApi("/stats", { refreshMs: 10000 });
  const [eventName, setEventName] = useState("");
  const { data: events } = useApi(`/events${qs({ limit: 15, name: eventName })}`, { refreshMs: 10000 });

  if (loading && !s) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  const statusData = Object.entries(s.jobs.byStatus).filter(([, n]) => n > 0).map(([name, value]) => ({ name: STATUS_LABEL[name] || name, key: name, value }));
  const gasData = s.gasByMethod.filter((g) => !["grantRole", "revokeRole", "setDisputeResolution", "deploy"].includes(g.method)).map((g) => ({ ...g }));

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Live platform activity, read from the blockchain by the indexer." />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Jobs" value={s.jobs.total} hint={`${s.users.clients} clients · ${s.users.freelancers} freelancers`} />
        <Stat label="Locked in escrow" value={eth(s.volume.lockedEth)} hint="Held by the contract right now" />
        <Stat label="Paid out" value={eth(s.volume.releasedEth)} hint={`Platform fees: ${eth(s.volume.feesEth)} (${s.platformFeePct}%)`} />
        <Stat label="On-chain transactions" value={s.transactions} />
        <Stat label="Avg. time to complete" value={formatDuration(s.avgCompletionSeconds)} hint="From acceptance to final payment" />
        <Stat label="Dispute rate" value={`${(s.disputes.rate * 100).toFixed(0)}%`} hint={`${s.disputes.total} total · ${s.disputes.open} open`} />
        <Stat label="Avg. dispute resolution" value={formatDuration(s.disputes.avgResolutionSeconds)} hint="From opening to verdict" />
        <Stat label="Freelancer win rate" value={s.disputes.freelancerWinRate === null ? "—" : `${(s.disputes.freelancerWinRate * 100).toFixed(0)}%`} hint="Of resolved disputes" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Jobs by status">
          <div className="h-64">
            <ResponsiveContainer>
              <PieChart>
                <Pie isAnimationActive={false} data={statusData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                  {statusData.map((d) => <Cell key={d.key} fill={STATUS_COLOR[d.key]} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Daily volume (ETH)">
          {s.daily.length === 0 ? <p className="py-16 text-center text-sm text-slate-500">No activity yet.</p> : (
            <div className="h-64">
              <ResponsiveContainer>
                <BarChart data={s.daily}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => eth(v)} />
                  <Legend />
                  <Bar isAnimationActive={false} dataKey="funded" name="Locked" fill="#6366f1" radius={[4, 4, 0, 0]} />
                  <Bar isAnimationActive={false} dataKey="released" name="Paid out" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Panel>

        <Panel title="Gas per transaction type" className="lg:col-span-2" note="Average gas units used on this network. Lower is cheaper for users.">
          <div className="h-72">
            <ResponsiveContainer>
              <BarChart data={gasData} layout="vertical" margin={{ left: 30 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="method" tick={{ fontSize: 11 }} width={130} interval={0} />
                <Tooltip formatter={(v, n, p) => [`${Number(v).toLocaleString()} gas (${p.payload.count} tx)`, "Average"]} />
                <Bar dataKey="avgGas" fill="#6366f1" radius={[0, 4, 4, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <section className="card mt-6">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-4">
          <h2 className="font-semibold text-slate-900">Event log</h2>
          <select className="input !w-auto" value={eventName} onChange={(e) => setEventName(e.target.value)} aria-label="Filter by event">
            <option value="">All events</option>
            {EVENT_NAMES.map((n) => <option key={n}>{n}</option>)}
          </select>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>Event</th><th>What happened</th><th>By</th><th>Job</th><th>Tx</th></tr></thead>
            <tbody>
              {(events?.items ?? []).map((e) => (
                <tr key={e.id}>
                  <td>{formatDate(e.timestamp)}</td>
                  <td className="font-medium">{e.name}</td>
                  <td className="max-w-md truncate" title={describeEvent(e)}>{describeEvent(e)}</td>
                  <td><Address value={e.actor} /></td>
                  <td>{e.jobId ? <Link className="text-brand-700 hover:underline" to={`/jobs/${e.jobId}`}>#{e.jobId}</Link> : "—"}</td>
                  <td className="font-mono text-xs">{shortHash(e.txHash)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function Panel({ title, note, children, className = "" }) {
  return (
    <section className={`card p-5 ${className}`}>
      <h2 className="font-semibold text-slate-900">{title}</h2>
      {note && <p className="mt-0.5 text-xs text-slate-500">{note}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}
