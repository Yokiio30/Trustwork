import { Link } from "react-router-dom";
import JobCard from "../components/JobCard";
import { Empty, ErrorBox, PageHeader, Spinner, Stat } from "../components/ui";
import { useWeb3 } from "../context/Web3";
import { useTx } from "../context/Tx";
import { formatEth, sameAddr } from "../lib/format";
import { useApi, useDocumentTitle } from "../lib/hooks";

const HINT = {
  client: { Open: "Needs funding", Funded: "Waiting for a freelancer", InProgress: "Review submitted work", Disputed: "In dispute" },
  freelancer: { InProgress: "Deliver the next milestone", Disputed: "In dispute" },
};

export default function MyWork() {
  useDocumentTitle("My work");
  const { account, authed, connect, signIn, profile, refreshProfile } = useWeb3();
  const { sendTx } = useTx();
  const { data, error, loading, reload } = useApi(account && authed ? "/jobs?mine=true&limit=100" : null, { refreshMs: 8000 });

  if (!account)
    return (
      <Empty title="Connect your wallet to see your jobs">
        <button className="btn-primary mt-4" onClick={() => connect().catch(() => {})}>Connect wallet</button>
      </Empty>
    );
  if (!authed)
    return (
      <Empty title="Sign in to see your jobs">
        <button className="btn-primary mt-4" onClick={signIn}>Sign in with wallet</button>
      </Empty>
    );

  const jobs = data?.items ?? [];
  const asClient = jobs.filter((j) => sameAddr(j.client, account));
  const asFreelancer = jobs.filter((j) => sameAddr(j.freelancer, account));
  const rep = profile?.reputation;
  const withdrawable = profile?.withdrawable ? BigInt(profile.withdrawable) : 0n;

  const withdraw = async () => {
    const r = await sendTx({ title: "Withdraw funds", contract: "JobEscrow", method: "withdraw", details: [["Amount", `${formatEth(withdrawable)} ETH`]] });
    if (r) {
      refreshProfile();
      reload();
    }
  };

  return (
    <>
      <PageHeader title="My work" subtitle="Everything you are involved in, in one place.">
        <Link to="/jobs/new" className="btn-primary">Post a job</Link>
      </PageHeader>

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="card flex flex-col justify-between p-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Ready to withdraw</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{formatEth(withdrawable)} ETH</p>
          </div>
          <button className="btn-primary mt-3" disabled={withdrawable === 0n} onClick={withdraw}>Withdraw</button>
        </div>
        <Stat label="Jobs completed" value={rep?.jobsCompleted ?? "—"} />
        <Stat label="Average rating" value={profile?.averageRating ? `${profile.averageRating.toFixed(1)} / 5` : "—"} hint={profile ? `${profile.ratingCount} rating(s)` : undefined} />
        <Stat label="Disputes won / lost" value={rep ? `${rep.disputesWon} / ${rep.disputesLost}` : "—"} />
      </div>

      {loading && !data && <Spinner />}
      <ErrorBox error={error} onRetry={reload} />

      <Section title="As client" items={asClient} role="client" empty="You have not posted any jobs yet." />
      <Section title="As freelancer" items={asFreelancer} role="freelancer" empty="You have not taken any jobs yet. Browse the marketplace to find one." />
    </>
  );
}

function Section({ title, items, role, empty }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 font-semibold text-slate-900">
        {title} <span className="text-sm font-normal text-slate-500">({items.length})</span>
      </h2>
      {items.length === 0 ? (
        <Empty title={empty} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((j) => <JobCard key={j.id} job={j} note={HINT[role][j.status]} />)}
        </div>
      )}
    </section>
  );
}
