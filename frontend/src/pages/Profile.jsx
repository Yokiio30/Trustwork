import { useParams } from "react-router-dom";
import { isAddress } from "ethers";
import JobCard from "../components/JobCard";
import { Empty, ErrorBox, PageHeader, Spinner, Stat } from "../components/ui";
import { useWeb3 } from "../context/Web3";
import { describeEvent } from "../lib/events";
import { formatDate, sameAddr } from "../lib/format";
import { useApi, useDocumentTitle } from "../lib/hooks";

export default function Profile() {
  const { address } = useParams();
  useDocumentTitle("Profile");
  const { account, signOut, authed } = useWeb3();
  const valid = isAddress(address);
  const { data: p, error, loading, reload } = useApi(valid ? `/users/${address}` : null);
  const { data: jobs } = useApi(valid ? `/jobs?limit=50&client=${address.toLowerCase()}` : null);
  const { data: worked } = useApi(valid ? `/jobs?limit=50&freelancer=${address.toLowerCase()}` : null);
  const { data: events } = useApi(valid ? `/events?limit=10&actor=${address.toLowerCase()}` : null);

  if (!valid) return <Empty title="That is not a valid address" />;
  if (loading && !p) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  const rep = p.reputation;
  const mine = sameAddr(account, address);
  return (
    <>
      <PageHeader title={mine ? "Your profile" : "Profile"} subtitle={<span className="font-mono text-xs break-all">{p.address}</span>}>
        {mine && authed && <button className="btn-secondary" onClick={signOut}>Sign out</button>}
      </PageHeader>

      <div className="mb-4 flex flex-wrap gap-2">
        {p.roles.map((r) => <span key={r} className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium capitalize text-brand-700">{r}</span>)}
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Average rating" value={p.averageRating ? `${p.averageRating.toFixed(1)} / 5` : "—"} hint={`${p.ratingCount} rating(s)`} />
        <Stat label="Jobs completed" value={rep?.jobsCompleted ?? "—"} hint="Read from the Reputation contract" />
        <Stat label="Disputes won / lost" value={rep ? `${rep.disputesWon} / ${rep.disputesLost}` : "—"} />
        <Stat label="Jobs posted / taken" value={`${p.jobsAsClient} / ${p.jobsAsFreelancer}`} />
      </div>

      <JobSection title="Posted jobs" items={jobs?.items} />
      <JobSection title="Worked on" items={worked?.items} />

      <section className="mt-8">
        <h2 className="mb-3 font-semibold text-slate-900">Recent activity</h2>
        {!events?.items.length ? <Empty title="No activity yet" /> : (
          <ul className="card divide-y divide-slate-100">
            {events.items.map((e) => (
              <li key={e.id} className="flex flex-wrap justify-between gap-2 px-4 py-2 text-sm">
                <span>{describeEvent(e)}</span>
                <span className="text-xs text-slate-500">{formatDate(e.timestamp)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function JobSection({ title, items }) {
  if (!items?.length) return null;
  return (
    <section className="mt-8">
      <h2 className="mb-3 font-semibold text-slate-900">{title}</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">{items.map((j) => <JobCard key={j.id} job={j} />)}</div>
    </section>
  );
}
