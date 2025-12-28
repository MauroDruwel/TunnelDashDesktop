import { useEffect, useMemo, useState } from "react";
import { fetchAccounts, fetchCloudflaredVersion, fetchTunnelConfig, fetchTunnels, startTunnel, stopTunnel } from "./api";
import { ConfigInfo, Settings, TunnelSummary } from "./types";
import { clearStoredSettings, DEFAULT_SETTINGS, loadSettings, persistSettings } from "./utils/settingsStorage";
import { buildConfigsForTunnel, filterAndSortTunnels, isHttpProtocol, parseHost, parseProtocol, toTunnelSummary } from "./utils/tunnelTransforms";

// Centralized state and actions for settings, verification, and tunnel control.
export function useTunnelState() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [verified, setVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tunnels, setTunnels] = useState<TunnelSummary[]>([]);
  const [tunnelsLoading, setTunnelsLoading] = useState(false);
  const [tunnelsError, setTunnelsError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [activeHosts, setActiveHosts] = useState<Set<string>>(new Set());
  const [cfVersion, setCfVersion] = useState<string | null>(null);

  const cloudflaredVersion = useMemo(() => {
    if (cfVersion) return cfVersion;
    const firstWithVersion = tunnels.find((t) => t.clientVersion);
    return firstWithVersion?.clientVersion || null;
  }, [cfVersion, tunnels]);


  useEffect(() => {
    // Boot: hydrate settings/token from localStorage so the UI can skip setup if already verified.
    const { settings: loadedSettings, verified: wasVerified } = loadSettings();
    setSettings(loadedSettings);
    setVerified(wasVerified);
  }, []);

  const isPortValid = useMemo(() => {
    const n = Number(settings.portStart);
    return Number.isInteger(n) && n >= 1024 && n <= 65535;
  }, [settings.portStart]);

  const save = (patch: Partial<Settings & { verified?: boolean }>) => {
    // Persist immediately so reloads keep whatever the user just typed.
    const next: Settings = { ...settings, ...patch } as Settings;
    setSettings(next);
    persistSettings(next, patch.verified ?? verified);
  };

  const verify = async () => {
    if (!settings.apiKey.trim()) return;
    setError(null);
    setVerifying(true);
    setVerified(false);
    try {
      // Only call the Rust side once; we reuse the first account returned as the selected account.
      const accounts = await fetchAccounts(settings.apiKey.trim());
      if (!accounts.length) throw new Error("No accounts returned");
      const acct = accounts[0];
      save({ accountId: acct.id, accountName: acct.name, verified: true });
      setVerified(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setVerifying(false);
    }
  };

  const clearAll = async () => {
    const hosts = Array.from(activeHosts);
    if (hosts.length) {
      // try to stop any running tunnels; ignore failures
      await Promise.all(hosts.map((h) => stopTunnel(h).catch(() => undefined)));
    }

    clearStoredSettings();
    setSettings(DEFAULT_SETTINGS);
    setVerified(false);
    setError(null);
    setTunnels([]);
    setActiveHosts(new Set());
    setConnecting(null);
  };

  const loadTunnels = async () => {
    if (!settings.apiKey || !settings.accountId) return;
    setTunnelsLoading(true);
    setTunnelsError(null);
    try {
      const items = await fetchTunnels(settings.apiKey.trim(), settings.accountId);
      const base: TunnelSummary[] = items.map(toTunnelSummary);

      const withConfigs = await Promise.all(
        base.map(async (t) => {
          try {
            const cfgBody = await fetchTunnelConfig(settings.apiKey.trim(), settings.accountId!, t.id);
            const ingress = cfgBody?.result?.config?.ingress;
            // Flatten ingress rules into connectable configs and keep the original tunnel data attached.
            const configs = buildConfigsForTunnel(t, ingress);
            const serviceNames = configs.map((s) => s.service);
            return { ...t, services: serviceNames, service: serviceNames[0], configs };
          } catch {
            console.warn("config fetch failed", { tunnel: t.id });
            return t;
          }
        })
      );

      setTunnels(withConfigs);
    } catch (err) {
      console.error("load tunnels error", err);
      setTunnelsError(err instanceof Error ? err.message : "Failed to load tunnels");
      setTunnels([]);
    } finally {
      setTunnelsLoading(false);
    }
  };

  useEffect(() => {
    if (verified && settings.apiKey && settings.accountId) {
      loadTunnels();
    }
  }, [verified, settings.apiKey, settings.accountId]);

  const loadCloudflaredVersion = async () => {
    try {
      const ver = await fetchCloudflaredVersion();
      setCfVersion(ver || null);
    } catch (e) {
      console.warn("cloudflared --version failed", e);
    }
  };

  useEffect(() => {
    loadCloudflaredVersion();
  }, []);

  const toggleTunnel = async (t: TunnelSummary, cfg: ConfigInfo) => {
    const isHidden = settings.hideHttp && isHttpProtocol(cfg.service);
    if (isHidden) {
      setError("This configuration is hidden by the HTTP/HTTPS filter. Disable the filter to connect.");
      return;
    }

    const host = cfg.host || cfg.hostname || parseHost(cfg.service) || t.id;
    const localPort = Number(cfg.port ?? t.port ?? settings.portStart);
    if (!Number.isFinite(localPort)) {
      setError("Pick a valid local port before starting a tunnel");
      return;
    }

    const protocol = cfg.proto || parseProtocol(cfg.service) || "tcp";
    const isRunning = activeHosts.has(host);
    // Track which host is busy so buttons can show a working state per row.
    setConnecting(host);
    setError(null);
    try {
      if (isRunning) {
        await stopTunnel(host);
        setActiveHosts((prev) => {
          const next = new Set(prev);
          next.delete(host);
          return next;
        });
      } else {
        await startTunnel(host, localPort, protocol);
        setActiveHosts((prev) => {
          const next = new Set(prev);
          next.add(host);
          return next;
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tunnel toggle failed");
    } finally {
      setConnecting(null);
    }
  };

  const filteredTunnels = useMemo(
    () => filterAndSortTunnels(tunnels, settings),
    [tunnels, settings]
  );

  return {
    settings,
    save,
    verified,
    verifying,
    verify,
    error,
    setError,
    clearAll,
    tunnels: filteredTunnels,
    tunnelsLoading,
    tunnelsError,
    loadTunnels,
    toggleTunnel,
    activeHosts,
    connecting,
    isPortValid,
    cloudflaredVersion,
  };
}

export type { ConfigInfo, Settings, TunnelSummary } from "./types";
