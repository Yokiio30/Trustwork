import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { BrowserProvider } from "ethers";
import { useWeb3 } from "./Web3";
import { useToast } from "./Toast";
import { contractFor, waitForIndexer } from "../lib/chain";
import { friendlyError } from "../lib/errors";
import { formatEth, formatFee, formatGwei, shortHash } from "../lib/format";

const TxCtx = createContext(null);

/**
 * Fee settings from the node itself. ethers' default adds a flat 1 gwei tip, which on a testnet whose base fee
 * is near zero overstates the real price about a thousand times (and would make the wallet overpay).
 * Returns null on chains without EIP-1559 so the wallet decides.
 */
async function currentFees(provider) {
  try {
    const [block, tipHex] = await Promise.all([provider.getBlock("latest"), provider.send("eth_maxPriorityFeePerGas", [])]);
    const base = block?.baseFeePerGas;
    if (base === null || base === undefined) return null;
    const tip = BigInt(tipHex);
    return { price: base + tip, tx: { maxPriorityFeePerGas: tip, maxFeePerGas: base * 2n + tip } };
  } catch {
    return null;
  }
}

const STEPS = [
  ["wallet", "Confirm in your wallet"],
  ["mining", "Waiting for the network"],
  ["indexing", "Updating the dashboard"],
];

export function TxProvider({ children }) {
  const { config, account, refreshProfile } = useWeb3();
  const toast = useToast();
  const [modal, setModal] = useState(null);
  const decide = useRef(null);

  /**
   * Estimate gas, show it, ask for confirmation, send, and wait until the backend has indexed the block.
   * Resolves with the receipt, or null if the user cancelled or the transaction failed (the modal explains why).
   */
  const sendTx = useCallback(
    async ({ title, contract, method, args = [], value = 0n, details = [] }) => {
      if (!window.ethereum || !account || !config) {
        toast.error("Connect your wallet first.");
        return null;
      }
      setModal({ phase: "estimating", title });
      try {
        const provider = new BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const c = contractFor(config, contract, signer);

        // Estimating also simulates the call, so reverts surface here as readable errors, before any wallet popup.
        const gas = await c[method].estimateGas(...args, { value });
        const fees = await currentFees(provider);
        const fallback = fees ? null : await provider.getFeeData();
        const price = fees?.price ?? fallback.maxFeePerGas ?? fallback.gasPrice ?? 0n;
        const cost = gas * price;

        const approved = await new Promise((resolve) => {
          decide.current = resolve;
          setModal({ phase: "confirm", title, method, contract, gas, cost, price, value, details });
        });
        if (!approved) {
          setModal(null);
          return null;
        }

        setModal((m) => ({ ...m, phase: "wallet" }));
        const tx = await c[method](...args, { value, gasLimit: (gas * 12n) / 10n, ...(fees?.tx ?? {}) });
        setModal((m) => ({ ...m, phase: "mining", hash: tx.hash }));
        const receipt = await tx.wait();
        if (receipt.status !== 1) throw new Error("The transaction was reverted on-chain.");

        setModal((m) => ({ ...m, phase: "indexing" }));
        await waitForIndexer(receipt.blockNumber);
        refreshProfile();
        setModal(null);
        toast.success(`${title}: confirmed (gas used ${receipt.gasUsed.toLocaleString()})`);
        return receipt;
      } catch (e) {
        setModal({ phase: "error", title, message: friendlyError(e) });
        return null;
      }
    },
    [account, config, toast, refreshProfile]
  );

  const value = useMemo(() => ({ sendTx }), [sendTx]);

  return (
    <TxCtx.Provider value={value}>
      {children}
      {modal && <TxModal modal={modal} onDecide={(ok) => decide.current?.(ok)} onClose={() => setModal(null)} />}
    </TxCtx.Provider>
  );
}

function TxModal({ modal, onDecide, onClose }) {
  const { phase } = modal;
  const stepIndex = STEPS.findIndex(([k]) => k === phase);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label={modal.title}>
      <div className="card w-full max-w-md p-5">
        <h2 className="text-lg font-semibold text-slate-900">{modal.title}</h2>

        {phase === "estimating" && <p className="mt-4 text-sm text-slate-500">Estimating gas and simulating the transaction…</p>}

        {phase === "confirm" && (
          <>
            <dl className="mt-4 space-y-2 text-sm">
              {modal.details.map(([k, v]) => (
                <Row key={k} k={k} v={v} />
              ))}
              <Row k="Contract call" v={`${modal.contract}.${modal.method}()`} mono />
              {modal.value > 0n && <Row k="Amount sent" v={`${formatEth(modal.value)} ETH`} strong />}
              <Row k="Estimated gas" v={`${modal.gas.toLocaleString()} units`} />
              <Row k="Gas price" v={`${formatGwei(modal.price)} gwei`} />
              <Row k="Estimated network fee" v={`${formatFee(modal.cost)} ETH`} strong />
            </dl>
            <p className="mt-3 text-xs text-slate-500">Your wallet will ask you to sign next. The actual fee can differ slightly.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => onDecide(false)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={() => onDecide(true)} autoFocus>
                Continue
              </button>
            </div>
          </>
        )}

        {stepIndex >= 0 && (
          <>
            <ol className="mt-4 space-y-3">
              {STEPS.map(([k, label], i) => (
                <li key={k} className="flex items-center gap-3 text-sm">
                  <span
                    className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                      i < stepIndex ? "bg-emerald-100 text-emerald-700" : i === stepIndex ? "bg-brand-100 text-brand-700" : "bg-slate-100 text-slate-400"
                    }`}
                  >
                    {i < stepIndex ? "✓" : i + 1}
                  </span>
                  <span className={i === stepIndex ? "font-medium text-slate-900" : "text-slate-500"}>{label}</span>
                  {i === stepIndex && <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />}
                </li>
              ))}
            </ol>
            {modal.hash && <p className="mt-4 break-all font-mono text-xs text-slate-500">tx {shortHash(modal.hash)}</p>}
          </>
        )}

        {phase === "error" && (
          <>
            <p className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{modal.message}</p>
            <div className="mt-5 flex justify-end">
              <button className="btn-secondary" onClick={onClose} autoFocus>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ k, v, mono, strong }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="text-slate-500">{k}</dt>
      <dd className={`text-right ${mono ? "font-mono text-xs" : ""} ${strong ? "font-semibold text-slate-900" : "text-slate-700"}`}>{v}</dd>
    </div>
  );
}

export const useTx = () => useContext(TxCtx);
