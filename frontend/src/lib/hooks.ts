import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";

/** Fetch a resource, and keep refetching every `interval` ms while `active(data)` is true. */
export function usePolled<T>(path: string | null, active: (data: T) => boolean, interval = 2000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  const reload = useCallback(async () => {
    if (!path) return;
    try {
      setData(await api<T>(path));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [path]);

  useEffect(() => {
    setData(null);
    reload();
  }, [reload]);

  useEffect(() => {
    if (!data || !activeRef.current(data)) return;
    const t = setTimeout(reload, interval);
    return () => clearTimeout(t);
  }, [data, reload, interval]);

  return { data, setData, error, reload };
}

export function useToast() {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 4000);
    return () => clearTimeout(t);
  }, [message]);
  return { message, show: setMessage };
}
