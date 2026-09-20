import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  DEMO_MODE,
  fetchAccounts,
  fetchCloudflaredVersion,
  fetchTunnelConfig,
  fetchTunnels,
  startTunnel,
  stopTunnel,
  updateTunnelMetadata,
} from "./api";
import { ConfigInfo, Settings, TunnelSummary } from "./types";
import { clearStoredSettings, DEFAULT_SETTINGS, loadSettings, persistSettings } from "./utils/settingsStorage";
import {
  assignLocalPorts,
  buildConfigsForTunnel,
  filterAndSortTunnels,
  mergeTunneldashPort,
  parseHost,
  parseProtocol,
  toTunnelSummary,
} from "./utils/tunnelTransforms";
import { errMsg } from "./utils/errors";

export type UpdateBanner = { version: string; url: string };

// Centralized state and actions for settings, verification, and tunnel control.
export function useTunnelState() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [verified, setVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allTunnels, setAllTunnels] = useState<TunnelSummary[]>([]);
  const [tunnelsLoading, setTunnelsLoading] = useState(false);
  const [tunnelsError, setTunnelsError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [activeHosts, setActiveHosts] = useState<Set<string>>(new Set());
  const [cfVersion, setCfVersion] = useState<string | null>(null);
  const [update, setUpdate] = useState<UpdateBanner | null>(null);

  // Refs to avoid stale closures in callbacks
  const settingsRef = useRef(settings);
  const verifiedRef = useRef(verified);
  const activeHostsRef = useRef(activeHosts);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);
  useEffect(() => {
    verifiedRef.current = verified;
  }, [verified]);
  useEffect(() => {
    activeHostsRef.current = activeHosts;
  }, [activeHosts]);

  const cloudflaredVersion = cfVersion;

  const isPortValid = useMemo(() => {
    const n = Number(settings.portStart);
    return Number.isInteger(n) && n >= 1024 && n <= 65535;
  }, [settings.portStart]);

  const save = useCallback((patch: Partial<Settings & { verified?: boolean }>) => {
    const { verified: patchVerified, ...settingsPatch } = patch as Settings & { verified?: boolean };
    const nextVerified = patchVerified ?? verifiedRef.current;
    const prevSettings = settingsRef.current;
    const nextSettings = { ...prevSettings, ...settingsPatch } as Settings;

    // Update refs synchronously so subsequent calls see latest values
    settingsRef.current = nextSettings;
    if (patchVerified !== undefined) verifiedRef.current = patchVerified;

    setSettings(nextSettings);
    if (patchVerified !== undefined) setVerified(patchVerified);
    void persistSettings(nextSettings, nextVerified).catch((e) => {
      console.warn("persist settings failed", e);
    });
  }, []);

  // Update check: silent best-effort probe of the latest GitHub release. When
  // a new version appears, the releases page is opened once per version (the
  // nag guard lives in settings) and a dismissible banner is shown.
  const checkForUpdate = useCallback(
    async (nudged?: string) => {
      if (DEMO_MODE) return;
      if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
      try {
        const info = await invoke<UpdateBanner | null>("check_for_update");
        if (!info) return;
        setUpdate(info);
        if (nudged !== info.version) {
          void invoke("open_release_page").catch(() => undefined);
          save({ lastNudgedVersion: info.version });
        }
      } catch {
        // Offline / rate-limited / web preview — never nag about failures.
      }
    },
    [save]
  );

  const dismissUpdate = useCallback(() => setUpdate(null), []);
  const openUpdatePage = useCallback(() => {
    void invoke("open_release_page").catch(() => undefined);
  }, []);

  useEffect(() => {
    // Boot: hydrate settings/token from storage so the UI can skip setup if already verified.
    // In demo mode (`?demo`) skip setup unless `?setup` is present, so docs screenshots
    // can show either the wizard or the verified app.
    let cancelled = false;
    loadSettings().then(({ settings: loadedSettings, verified: wasVerified }) => {
      if (cancelled) return;
      if (DEMO_MODE) {
        const showSetup = new URLSearchParams(window.location.search).has("setup");
        const demo: Settings = {
          ...loadedSettings,
          apiKey: "demo-token",
          accountName: "Demo Corp",
          accountId: "demo-account",
        };
        setSettings(demo);
        settingsRef.current = demo;
        setVerified(!showSetup);
        verifiedRef.current = !showSetup;
        return;
      }
      setSettings(loadedSettings);
      settingsRef.current = loadedSettings;
      setVerified(wasVerified);
      verifiedRef.current = wasVerified;
      void checkForUpdate(loadedSettings.lastNudgedVersion);
    });
    return () => {
      cancelled = true;
    };
  }, [checkForUpdate]);

  const verify = useCallback(async () => {
    const apiKey = settingsRef.current.apiKey.trim();
    if (!apiKey) return;
    setError(null);
    setVerifying(true);
    try {
      const accounts = await fetchAccounts(apiKey);
      if (!accounts.length) throw new Error("No accounts returned");
      const acct = accounts[0];
      save({ accountId: acct.id, accountName: acct.name, verified: true });
    } catch (err) {
      setError(errMsg(err, "Verification failed"));
    } finally {
      setVerifying(false);
    }
  }, [save]);

  const clearAll = useCallback(async () => {
    const hosts = Array.from(activeHostsRef.current);
    if (hosts.length) {
      await Promise.all(hosts.map((h) => stopTunnel(h).catch(() => undefined)));
    }
    await clearStoredSettings();
    const defaultCopy = { ...DEFAULT_SETTINGS };
    settingsRef.current = defaultCopy;
    verifiedRef.current = false;
    setSettings(defaultCopy);
    setVerified(false);
    setError(null);
    setAllTunnels([]);
    setActiveHosts(new Set());
    activeHostsRef.current = new Set();
    setConnecting(null);
  }, []);

  const persistAssignments = useCallback(
    async (apiKey: string, accountId: string, tunnels: TunnelSummary[]) => {
      await Promise.all(
        tunnels.map(async (t) => {
          // Mirror mobile's syncPortsToMetadata: persist the full current
          // hostname→port map (keyed by the full, lowercased ingress hostname),
          // not just the newly assigned routes, so saved metadata stays
          // authoritative and identical in structure across apps.
          const fullMap: Record<string, number> = {};
          for (const c of t.configs ?? []) {
            const host = c.hostname || c.host;
            if (host && typeof c.port === "number") fullMap[host] = c.port;
          }
          if (!Object.keys(fullMap).length) return;
          const metadata = mergeTunneldashPort(t.metadata, fullMap);
          try {
            await updateTunnelMetadata(apiKey, accountId, t.id, metadata);
          } catch (err) {
            // Non-fatal: ports still work in-session. Most likely cause is a
            // read-only token (needs Cloudflare Tunnel:Edit to persist).
            console.warn("could not persist port assignments", { tunnelId: t.id, err });
          }
        })
      );
    },
    []
  );

  const loadTunnels = useCallback(async () => {
    const { apiKey, accountId, portStart } = settingsRef.current;
    if (!apiKey || !accountId) return;
    setTunnelsLoading(true);
    setTunnelsError(null);
    try {
      const items = await fetchTunnels(apiKey.trim(), accountId);
      const base: TunnelSummary[] = items.map(toTunnelSummary);

      const withConfigs = await Promise.all(
        base.map(async (t) => {
          try {
            const cfgBody = await fetchTunnelConfig(apiKey.trim(), accountId, t.id);
            const ingress = cfgBody?.result?.config?.ingress;
            const configs = buildConfigsForTunnel(t, ingress);
            const serviceNames = configs.map((s) => s.service);
            return { ...t, services: serviceNames, service: serviceNames[0], configs };
          } catch {
            console.warn("config fetch failed", { tunnel: t.id });
            return t;
          }
        })
      );

      // Sequential local ports from settings.portStart. Reuse ports already set
      // in tunnel metadata (mobile parity) and PATCH the assigned ports back so
      // they stay consistent across devices.
      const start = Number(portStart) || 50000;
      const { tunnels: assigned, newAssignments } = assignLocalPorts(withConfigs, start);
      setAllTunnels(assigned);

      if (!DEMO_MODE && newAssignments.size) {
        void persistAssignments(apiKey.trim(), accountId, assigned);
      }
    } catch (err) {
      console.error("load tunnels error", err);
      setTunnelsError(errMsg(err, "Failed to load tunnels"));
      // Retain existing tunnels so the UI never flashes or despawns on transient errors
    } finally {
      setTunnelsLoading(false);
    }
  }, [persistAssignments]);

  useEffect(() => {
    if (verified && settingsRef.current.apiKey && settings.accountId) {
      void loadTunnels();
    }
  }, [verified, settings.accountId, loadTunnels]);

  // When portStart changes, reassign local ports in-memory without a redundant network fetch
  useEffect(() => {
    setAllTunnels((prev) => {
      if (!prev.length) return prev;
      const start = Number(settings.portStart) || 50000;
      const { tunnels: reassigned } = assignLocalPorts(prev, start);
      return reassigned;
    });
  }, [settings.portStart]);

  // Auto-refresh tunnels every 5 minutes while verified.
  useEffect(() => {
    if (!verified || !settingsRef.current.apiKey || !settings.accountId) return;
    const timer = window.setInterval(() => {
      void loadTunnels();
    }, 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [verified, settings.accountId, loadTunnels]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ver = await fetchCloudflaredVersion();
        if (!cancelled) setCfVersion(ver || null);
      } catch (e) {
        if (!cancelled) console.warn("cloudflared --version failed", e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleTunnel = useCallback(
    async (t: TunnelSummary, cfg: ConfigInfo) => {
      const portStart = settingsRef.current.portStart;
      const host = cfg.host || cfg.hostname || parseHost(cfg.service) || t.id;
      const localPort = Number(cfg.port ?? t.port ?? portStart);
      if (!Number.isFinite(localPort) || localPort < 1024 || localPort > 65535) {
        setError("Pick a valid local port before starting a tunnel");
        return;
      }

      const protocol = cfg.proto || parseProtocol(cfg.service) || "tcp";
      const isRunning = activeHostsRef.current.has(host);
      setConnecting(host);
      setError(null);
      try {
        if (isRunning) {
          await stopTunnel(host);
          setActiveHosts((prev) => {
            const next = new Set(prev);
            next.delete(host);
            activeHostsRef.current = next;
            return next;
          });
        } else {
          await startTunnel(host, localPort, protocol);
          setActiveHosts((prev) => {
            const next = new Set(prev);
            next.add(host);
            activeHostsRef.current = next;
            return next;
          });
        }
      } catch (err) {
        setError(errMsg(err, "Tunnel toggle failed"));
      } finally {
        setConnecting(null);
      }
    },
    []
  );

  const filteredTunnels = useMemo(() => filterAndSortTunnels(allTunnels, settings), [allTunnels, settings]);

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
    allTunnels,
    tunnelsLoading,
    tunnelsError,
    loadTunnels,
    toggleTunnel,
    activeHosts,
    connecting,
    isPortValid,
    cloudflaredVersion,
    update,
    dismissUpdate,
    openUpdatePage,
  };
}

export type { ConfigInfo, Settings, TunnelSummary } from "./types";
