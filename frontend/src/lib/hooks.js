import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

/** Fetch an API path; refetches when the path changes, on reload(), and optionally on an interval. */
export function useApi(path, { refreshMs } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: !!path });
  const seq = useRef(0);

  const load = useCallback(
    async (silent = false) => {
      if (!path) return;
      const my = ++seq.current;
      if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const data = await api(path);
        if (my === seq.current) setState({ data, error: null, loading: false });
      } catch (e) {
        if (my === seq.current) setState((s) => ({ data: silent ? s.data : null, error: e, loading: false }));
      }
    },
    [path]
  );

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!refreshMs) return;
    const t = setInterval(() => load(true), refreshMs);
    return () => clearInterval(t);
  }, [load, refreshMs]);

  return { ...state, reload: () => load(true) };
}

/** Re-render every `ms` so countdowns stay live. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function useDocumentTitle(title) {
  useEffect(() => {
    document.title = title ? `${title} · TrustWork` : "TrustWork";
  }, [title]);
}
