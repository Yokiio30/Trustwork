import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { useWeb3 } from "../context/Web3";
import { useToast } from "../context/Toast";
import { friendlyError } from "../lib/errors";
import { shortAddr } from "../lib/format";

const ROLE_STYLE = { admin: "bg-rose-100 text-rose-800", auditor: "bg-amber-100 text-amber-800", arbiter: "bg-violet-100 text-violet-800", user: "bg-slate-100 text-slate-700" };

export default function Layout() {
  const w = useWeb3();
  const toast = useToast();
  const [open, setOpen] = useState(false);

  const links = [
    ["/", "Marketplace", true],
    ["/my-work", "My work", !!w.account],
    ["/disputes", "Disputes", true],
    ["/dashboard", "Dashboard", true],
    ["/audit", "Audit", w.hasRole("auditor") || w.hasRole("admin")],
    ["/admin", "Admin", w.hasRole("admin")],
  ].filter((l) => l[2]);

  const connect = () => w.connect().catch((e) => toast.error(friendlyError(e)));
  const topRole = ["admin", "auditor", "arbiter"].find((r) => w.roles.includes(r));

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 font-semibold text-slate-900">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">✓</span>
            TrustWork
          </Link>

          <nav className="hidden flex-1 items-center gap-1 md:flex" aria-label="Main">
            {links.map(([to, label]) => (
              <NavItem key={to} to={to} label={label} />
            ))}
          </nav>
          <div className="flex-1 md:hidden" />

          <div className="flex items-center gap-2">
            {!w.hasWallet ? (
              <a className="btn-primary" href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer">
                Install MetaMask
              </a>
            ) : !w.account ? (
              <button className="btn-primary" onClick={connect}>
                Connect wallet
              </button>
            ) : (
              <div className="flex items-center gap-2">
                {topRole && <span className={`hidden rounded-full px-2 py-0.5 text-xs font-medium sm:inline ${ROLE_STYLE[topRole]}`}>{topRole}</span>}
                <Link to={`/profile/${w.account}`} className="btn-secondary font-mono text-xs" title={w.account}>
                  <span className={`h-2 w-2 rounded-full ${w.authed ? "bg-emerald-500" : "bg-amber-500"}`} />
                  {shortAddr(w.account)}
                </Link>
              </div>
            )}
            <button className="btn-ghost md:hidden" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Menu">
              ☰
            </button>
          </div>
        </div>
        {open && (
          <nav className="border-t border-slate-100 px-4 pb-3 md:hidden" aria-label="Mobile">
            {links.map(([to, label]) => (
              <NavItem key={to} to={to} label={label} onClick={() => setOpen(false)} block />
            ))}
          </nav>
        )}
      </header>

      <Banners />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <Outlet />
      </main>

      <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-500">
        TrustWork · SC6113 group project · funds are held by smart contracts, not by the platform
      </footer>
    </div>
  );
}

function NavItem({ to, label, onClick, block }) {
  return (
    <NavLink
      to={to}
      end={to === "/"}
      onClick={onClick}
      className={({ isActive }) =>
        `rounded-lg px-3 py-2 text-sm font-medium ${block ? "block" : ""} ${isActive ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100"}`
      }
    >
      {label}
    </NavLink>
  );
}

function Banners() {
  const w = useWeb3();
  const toast = useToast();
  const items = [];

  if (w.configError) items.push({ key: "cfg", tone: "rose", text: `Cannot load platform configuration: ${w.configError}` });
  if (w.account && w.wrongNetwork)
    items.push({
      key: "net",
      tone: "amber",
      text: `Your wallet is on the wrong network. Switch to ${w.config.network} (chain ${w.config.chainId}).`,
      action: ["Switch network", () => w.switchNetwork().catch((e) => toast.error(friendlyError(e)))],
    });
  else if (w.account && !w.authed)
    items.push({
      key: "auth",
      tone: "amber",
      text: w.authError ? `Sign-in failed: ${w.authError}` : "Sign in with your wallet to use role-based features. It is free and does not send a transaction.",
      action: [w.authBusy ? "Waiting…" : "Sign in", w.signIn, w.authBusy],
    });

  if (!items.length) return null;
  const tone = { amber: "bg-amber-50 text-amber-900 border-amber-200", rose: "bg-rose-50 text-rose-900 border-rose-200" };
  return (
    <div>
      {items.map((b) => (
        <div key={b.key} className={`border-b px-4 py-2 text-sm ${tone[b.tone]}`} role="alert">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
            <span>{b.text}</span>
            {b.action && (
              <button className="btn-secondary !py-1" onClick={b.action[1]} disabled={b.action[2]}>
                {b.action[0]}
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
