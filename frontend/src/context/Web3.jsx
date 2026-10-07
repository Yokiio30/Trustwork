import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { BrowserProvider } from "ethers";
import { api, clearToken, hasToken, saveToken, setActiveAccount, subscribeSession } from "../lib/api";
import { friendlyError } from "../lib/errors";

const Web3Ctx = createContext(null);
const LOCAL_RPC = import.meta.env.VITE_RPC_URL || "http://127.0.0.1:8545";

export function Web3Provider({ children }) {
  const [config, setConfig] = useState(null);
  const [configError, setConfigError] = useState(null);
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [, rerender] = useReducer((n) => n + 1, 0);
  const [profile, setProfile] = useState(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState(null);
  const lastAttempt = useRef(null);

  const eth = typeof window !== "undefined" ? window.ethereum : undefined;
  const hasWallet = !!eth;

  // ---- protocol config (addresses + ABIs) from the backend
  useEffect(() => {
    api("/config?abi=true").then(setConfig).catch((e) => setConfigError(e.message));
  }, []);

  // ---- wallet account / chain tracking
  useEffect(() => {
    if (!eth) return;
    eth.request({ method: "eth_accounts" }).then((a) => setAccount(a[0]?.toLowerCase() ?? null)).catch(() => {});
    eth.request({ method: "eth_chainId" }).then((c) => setChainId(parseInt(c, 16))).catch(() => {});
    const onAccounts = (a) => setAccount(a[0]?.toLowerCase() ?? null);
    const onChain = (c) => setChainId(parseInt(c, 16));
    eth.on?.("accountsChanged", onAccounts);
    eth.on?.("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, [eth]);

  // The API client sends the token of whichever wallet account is active. Set during render (it is an
  // idempotent assignment) so that children's effects, which run before ours, already use the right token.
  setActiveAccount(account);
  useEffect(() => subscribeSession(rerender), []);

  const authed = hasToken(account);
  const wrongNetwork = !!(config && chainId && chainId !== config.chainId);

  // ---- profile (roles, reputation, withdrawable balance); public endpoint, refreshed after txs
  const refreshProfile = useCallback(async () => {
    if (!account) return setProfile(null);
    try {
      setProfile(await api(`/users/${account}`));
    } catch {
      setProfile(null);
    }
  }, [account]);
  useEffect(() => {
    refreshProfile();
  }, [refreshProfile]);

  const switchNetwork = useCallback(async () => {
    if (!eth || !config) return;
    const hex = `0x${config.chainId.toString(16)}`;
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
    } catch (e) {
      if (e.code === 4902 || e.data?.originalError?.code === 4902) {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [{ chainId: hex, chainName: config.network === "localhost" ? "Hardhat Local" : config.network, rpcUrls: [LOCAL_RPC], nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 } }],
        });
      } else throw e;
    }
  }, [eth, config]);

  const signIn = useCallback(async () => {
    if (!eth || !account) return;
    setAuthBusy(true);
    setAuthError(null);
    try {
      const domain = window.location.host;
      const { message } = await api(`/auth/nonce?address=${account}&domain=${encodeURIComponent(domain)}`);
      const signer = await new BrowserProvider(eth).getSigner();
      const signature = await signer.signMessage(message);
      const res = await api("/auth/login", { method: "POST", body: { address: account, signature, domain } });
      saveToken(res.address, res.token);
      refreshProfile();
    } catch (e) {
      setAuthError(friendlyError(e));
    } finally {
      setAuthBusy(false);
    }
  }, [eth, account, refreshProfile]);

  const connect = useCallback(async () => {
    if (!eth) throw new Error("No wallet found. Install MetaMask to continue.");
    const accounts = await eth.request({ method: "eth_requestAccounts" });
    setAccount(accounts[0]?.toLowerCase() ?? null);
    if (config && parseInt(await eth.request({ method: "eth_chainId" }), 16) !== config.chainId) await switchNetwork();
  }, [eth, config, switchNetwork]);

  const signOut = useCallback(() => {
    clearToken(account);
    refreshProfile();
  }, [account, refreshProfile]);

  // Ask for a signature once per account when there is no valid token. A rejected request is not repeated.
  useEffect(() => {
    if (authed) lastAttempt.current = null;
    else if (account && config && !wrongNetwork && chainId && !authBusy && lastAttempt.current !== account) {
      lastAttempt.current = account;
      signIn();
    }
  }, [account, config, wrongNetwork, chainId, authed, authBusy, signIn]);

  const roles = authed ? profile?.roles ?? ["user"] : [];
  const value = useMemo(
    () => ({
      config, configError, hasWallet, account, chainId, wrongNetwork, authed, authBusy, authError, roles, profile,
      hasRole: (r) => roles.includes(r),
      connect, switchNetwork, signIn, signOut, refreshProfile,
    }),
    [config, configError, hasWallet, account, chainId, wrongNetwork, authed, authBusy, authError, roles, profile, connect, switchNetwork, signIn, signOut, refreshProfile]
  );

  return <Web3Ctx.Provider value={value}>{children}</Web3Ctx.Provider>;
}

export const useWeb3 = () => useContext(Web3Ctx);
