import { ethers } from "ethers";

export const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "—");
export const shortHash = (h) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : "—");

// Amounts are truncated, never rounded up. The number of decimals follows the size of the amount, so a
// 0.000198 ETH payout is not shown as 0.0001 and a tiny fee is not shown as 0.
export function formatEth(wei, maxDecimals) {
  if (wei === null || wei === undefined) return "—";
  const v = BigInt(wei);
  const decimals = maxDecimals ?? (v >= 10n ** 16n ? 4 : v >= 10n ** 14n ? 6 : 9);
  const [int, frac = ""] = ethers.formatEther(v).split(".");
  const trimmed = frac.slice(0, decimals).replace(/0+$/, "");
  return trimmed ? `${int}.${trimmed}` : int;
}

export const fromUnix = (ts) => (ts ? new Date(ts * 1000) : null);

export function formatDate(ts) {
  const d = fromUnix(ts);
  return d ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
}

export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return "—";
  const s = Math.abs(Math.round(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`;
}

export function timeAgo(ts) {
  if (!ts) return "—";
  const diff = Date.now() / 1000 - ts;
  if (diff < 5) return "just now";
  const d = formatDuration(diff);
  return diff >= 0 ? `${d} ago` : `in ${d}`;
}

export const sameAddr = (a, b) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
export const nowSec = () => Math.floor(Date.now() / 1000);

/** Network fees can be far below 0.000001 ETH on testnets; never show them as a misleading "0". */
export function formatFee(wei) {
  const v = BigInt(wei);
  if (v === 0n) return "0";
  if (v < 1_000_000_000_000n) return "< 0.000001";
  return formatEth(v, 6);
}

export function formatGwei(wei) {
  const g = Number(ethers.formatUnits(BigInt(wei), "gwei"));
  return g >= 0.01 ? g.toFixed(2) : g.toPrecision(2);
}
