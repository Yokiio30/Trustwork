const BASE = import.meta.env.VITE_API_URL || "http://localhost:4000";
const STORE_KEY = "trustwork.sessions";

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// One login token per wallet address, so switching accounts back and forth does not force a new signature.
// Browser storage can be unavailable (private mode); the app must work without it.
function readStored() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
  } catch {
    return {};
  }
}

const tokens = readStored(); // { [lowercase address]: jwt }
let active = null;
const listeners = new Set();

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(tokens));
  } catch {
    /* ignore */
  }
  listeners.forEach((fn) => fn());
}

export const subscribeSession = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Choose which wallet's token the API client sends. */
export function setActiveAccount(address) {
  active = address ? address.toLowerCase() : null;
}
export const hasToken = (address) => !!(address && tokens[address.toLowerCase()]);
export function saveToken(address, token) {
  tokens[address.toLowerCase()] = token;
  persist();
}
export function clearToken(address) {
  delete tokens[address?.toLowerCase()];
  persist();
}

export async function api(path, { method = "GET", body, signal } = {}) {
  const token = active ? tokens[active] : null;
  let res;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      signal,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new ApiError("Cannot reach the TrustWork server. Is the backend running?", 0, "NETWORK");
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    if (res.status === 401 && token) clearToken(active); // expired or revoked token
    throw new ApiError(data?.error?.message || `Request failed (${res.status})`, res.status, data?.error?.code);
  }
  return data;
}

export const qs = (params) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") s.set(k, v);
  const out = s.toString();
  return out ? `?${out}` : "";
};
