import { useCallback, useEffect, useState } from "react";
import { BrowserProvider, id as keccak, isAddress } from "ethers";
import { Address, PageHeader } from "../components/ui";
import { useWeb3 } from "../context/Web3";
import { useTx } from "../context/Tx";
import { useToast } from "../context/Toast";
import { contractFor } from "../lib/chain";
import { formatDuration, formatEth } from "../lib/format";
import { useApi, useDocumentTitle } from "../lib/hooks";

const ARBITER_ROLE = keccak("ARBITER_ROLE");
const AUDITOR_ROLE = keccak("AUDITOR_ROLE");

export default function Admin() {
  useDocumentTitle("Admin");
  const { config, account, wrongNetwork } = useWeb3();
  const { sendTx } = useTx();
  const toast = useToast();
  const { data: roles, reload: reloadRoles } = useApi("/roles");
  const [chain, setChain] = useState(null);
  const [form, setForm] = useState({ fee: "", review: "", voting: "", arbiter: "", auditor: "" });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Live parameters come straight from the contracts, not from the indexer.
  const loadChain = useCallback(async () => {
    if (!config || wrongNetwork) return;
    try {
      const provider = new BrowserProvider(window.ethereum);
      const escrow = contractFor(config, "JobEscrow", provider);
      const disputes = contractFor(config, "DisputeResolution", provider);
      const [feeBps, review, fees, voting] = await Promise.all([escrow.platformFeeBps(), escrow.reviewPeriod(), escrow.accruedFees(), disputes.votingPeriod()]);
      setChain({ feeBps: Number(feeBps), review: Number(review), voting: Number(voting), fees });
    } catch {
      setChain(null);
    }
  }, [config, wrongNetwork]);
  useEffect(() => {
    loadChain();
  }, [loadChain]);

  const run = async (opts) => {
    const r = await sendTx(opts);
    if (r) {
      loadChain();
      reloadRoles();
    }
    return r;
  };

  const minutes = (v) => Math.round(Number(v) * 60);
  const badMinutes = (v) => !(Number(v) >= 1);

  return (
    <>
      <PageHeader title="Admin" subtitle="Platform parameters and role management. Every change is an on-chain transaction anyone can audit." />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card label="Platform fee" value={chain ? `${(chain.feeBps / 100).toFixed(2)}%` : "—"} />
        <Card label="Client review period" value={chain ? formatDuration(chain.review) : "—"} />
        <Card label="Arbiter voting period" value={chain ? formatDuration(chain.voting) : "—"} />
        <div className="card flex flex-col justify-between p-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Fees collected</p>
            <p className="mt-1 text-2xl font-semibold text-slate-900">{chain ? `${formatEth(chain.fees)} ETH` : "—"}</p>
          </div>
          <button className="btn-primary mt-3" disabled={!chain || chain.fees === 0n} onClick={() => run({ title: "Withdraw platform fees", contract: "JobEscrow", method: "withdrawFees", args: [account], details: [["Amount", `${formatEth(chain.fees)} ETH`], ["To", "Your wallet"]] })}>
            Withdraw to my wallet
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="card space-y-4 p-5">
          <h2 className="font-semibold text-slate-900">Parameters</h2>
          <Field label="Platform fee (%, max 5)" value={form.fee} onChange={set("fee")} placeholder="1.00" onSubmit={() => {
            const pct = Number(form.fee);
            if (!(pct >= 0 && pct <= 5)) return toast.error("Enter a fee between 0 and 5.");
            run({ title: "Update platform fee", contract: "JobEscrow", method: "setPlatformFee", args: [Math.round(pct * 100)], details: [["New fee", `${pct.toFixed(2)}%`], ["Applies to", "jobs created after this change"]] }).then((r) => r && setForm((f) => ({ ...f, fee: "" })));
          }} />
          <Field label="Client review period (minutes)" value={form.review} onChange={set("review")} placeholder="4320" onSubmit={() => {
            if (badMinutes(form.review)) return toast.error("Minimum is 1 minute.");
            run({ title: "Update review period", contract: "JobEscrow", method: "setReviewPeriod", args: [minutes(form.review)] }).then((r) => r && setForm((f) => ({ ...f, review: "" })));
          }} />
          <Field label="Arbiter voting period (minutes)" value={form.voting} onChange={set("voting")} placeholder="10080" onSubmit={() => {
            if (badMinutes(form.voting)) return toast.error("Minimum is 1 minute.");
            run({ title: "Update voting period", contract: "DisputeResolution", method: "setVotingPeriod", args: [minutes(form.voting)] }).then((r) => r && setForm((f) => ({ ...f, voting: "" })));
          }} />
        </section>

        <section className="card space-y-4 p-5">
          <h2 className="font-semibold text-slate-900">Roles</h2>
          <RoleList title="Arbiters" items={roles?.arbiters} onRevoke={(a) => run({ title: "Revoke arbiter role", contract: "DisputeResolution", method: "revokeRole", args: [ARBITER_ROLE, a], details: [["Account", a]] })} />
          <Field label="Add arbiter (address)" value={form.arbiter} onChange={set("arbiter")} placeholder="0x…" cta="Grant" onSubmit={() => {
            if (!isAddress(form.arbiter)) return toast.error("That is not a valid address.");
            run({ title: "Grant arbiter role", contract: "DisputeResolution", method: "grantRole", args: [ARBITER_ROLE, form.arbiter], details: [["Account", form.arbiter]] }).then((r) => r && setForm((f) => ({ ...f, arbiter: "" })));
          }} />
          <RoleList title="Auditors" items={roles?.auditors} onRevoke={(a) => run({ title: "Revoke auditor role", contract: "JobEscrow", method: "revokeRole", args: [AUDITOR_ROLE, a], details: [["Account", a]] })} />
          <Field label="Add auditor (address)" value={form.auditor} onChange={set("auditor")} placeholder="0x…" cta="Grant" onSubmit={() => {
            if (!isAddress(form.auditor)) return toast.error("That is not a valid address.");
            run({ title: "Grant auditor role", contract: "JobEscrow", method: "grantRole", args: [AUDITOR_ROLE, form.auditor], details: [["Account", form.auditor]] }).then((r) => r && setForm((f) => ({ ...f, auditor: "" })));
          }} />
          <div>
            <h3 className="text-sm font-medium text-slate-700">Admins</h3>
            <ul className="mt-1 space-y-1">{(roles?.admins ?? []).map((a) => <li key={a}><Address value={a} /></li>)}</ul>
          </div>
        </section>
      </div>
    </>
  );
}

const Card = ({ label, value }) => (
  <div className="card p-4">
    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-1 text-2xl font-semibold text-slate-900">{value}</p>
  </div>
);

function Field({ label, value, onChange, placeholder, onSubmit, cta = "Update" }) {
  const id = label.replace(/\W+/g, "-");
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
      <label className="label" htmlFor={id}>{label}</label>
      <div className="flex gap-2">
        <input id={id} className="input" value={value} onChange={onChange} placeholder={placeholder} />
        <button className="btn-primary" disabled={!value}>{cta}</button>
      </div>
    </form>
  );
}

function RoleList({ title, items, onRevoke }) {
  return (
    <div>
      <h3 className="text-sm font-medium text-slate-700">{title}</h3>
      {!items?.length && <p className="mt-1 text-sm text-slate-500">None yet.</p>}
      <ul className="mt-1 space-y-1">
        {(items ?? []).map((a) => (
          <li key={a} className="flex items-center justify-between rounded bg-slate-50 px-2 py-1">
            <Address value={a} />
            <button className="text-xs font-medium text-rose-600 hover:underline" onClick={() => onRevoke(a)}>Revoke</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
