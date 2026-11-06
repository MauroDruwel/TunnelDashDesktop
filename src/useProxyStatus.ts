import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DEMO_MODE } from "./api";

export function useProxyStatus(
  busy: boolean,
  onHosts: (hosts: string[]) => void,
) {
  useEffect(() => {
    if (busy || DEMO_MODE || !("__TAURI_INTERNALS__" in window)) return;
    let disposed = false;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const hosts = await invoke<string[]>("list_active_proxy_hosts");
        if (!disposed) onHosts(hosts);
      } catch {
        // Retain the last known state until the backend responds again.
      } finally {
        pending = false;
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [busy, onHosts]);
}
