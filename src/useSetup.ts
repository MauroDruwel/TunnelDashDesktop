import { useEffect, useMemo, useState } from "react";
import { fetchAccounts, fetchCloudflaredVersion, fetchTunnelConfig, fetchTunnels, startTunnel, stopTunnel } from "./api";

export type ConfigInfo = {
  service: string;
  proto?: string;
  host?: string;
  port?: number;
  hostname?: string;
};

export type TunnelSummary = {
  id: string;
  name: string;
  status?: string;
  createdAt?: string;
  port?: number;
  service?: string; // legacy single-service reference
  services?: string[];
  metadata?: Record<string, unknown>;
  displayConfigs?: ConfigInfo[];
  configs?: ConfigInfo[];
  hiddenHttpCount?: number;
  connectService?: string;
  connectHost?: string;
  portMap?: Array<{ host: string; port: number; proto?: string }>;
  connectionIp?: string;
  clientVersion?: string;
  connectionCount?: number;
  coloNames?: string[];
};

export type Settings = {
  apiKey: string;
  accountId?: string;
  accountName?: string;
  portStart: string;
  hideHttp: boolean;
  hideIp: boolean;
  hideOffline: boolean;
};

type Persisted = Settings & { verified?: boolean };

const STORAGE_KEY = "tunneldash:settings";
const DEFAULTS: Settings = {
  apiKey: "",
  accountId: undefined,
  accountName: undefined,
  portStart: "50000",
  hideHttp: false,
  hideIp: false,
  hideOffline: false,
};

export function useSetup() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
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
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    try {
      const parsed: Persisted = JSON.parse(saved);
      setSettings({ ...DEFAULTS, ...parsed });
      setVerified(Boolean(parsed.verified));
    } catch (e) {
      console.warn("could not read saved settings", e);
    }
  }, []);

  const isPortValid = useMemo(() => {
    const n = Number(settings.portStart);
    return Number.isInteger(n) && n >= 1024 && n <= 65535;
  }, [settings.portStart]);

  const save = (patch: Partial<Settings & { verified?: boolean }>) => {
    const next: Settings = { ...settings, ...patch } as Settings;
    setSettings(next);
    const payload: Persisted = { ...next, verified: patch.verified ?? verified };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  };

  const verify = async () => {
    if (!settings.apiKey.trim()) return;
    setError(null);
    setVerifying(true);
    setVerified(false);
    try {
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

    localStorage.removeItem(STORAGE_KEY);
    setSettings(DEFAULTS);
    setVerified(false);
    setError(null);
    setTunnels([]);
    setActiveHosts(new Set());
    setConnecting(null);
  };

  const parseHost = (service?: string) => {
    if (!service) return null;
    try {
      const url = service.includes("://") ? new URL(service) : new URL(`ssh://${service}`);
      return url.host; // keep port if present
    } catch (e) {
      console.warn("could not parse service", service, e);
      return null;
    }
  };

  const isHttpProtocol = (service: string) => service.startsWith("http://") || service.startsWith("https://");

  const parseProtocol = (service: string | undefined): string | undefined => {
    if (!service) return undefined;
    try {
      const url = service.includes("://") ? new URL(service) : new URL(`ssh://${service}`);
      return url.protocol.replace(":", "");
    } catch {
      const proto = service.split(":")[0];
      return proto || undefined;
    }
  };

  const pickHostPort = (
    portMap: Array<{ host: string; port: number; proto?: string }> | undefined,
    proto?: string,
    hostname?: string
  ) => {
    if (!portMap || !portMap.length) return undefined;
    if (hostname) {
      const byHost = portMap.find((p) => p.host === hostname);
      if (byHost) return byHost;
    }
    if (proto) {
      const match = portMap.find((p) => p.proto === proto);
      if (match) return match;
    }
    return portMap[0];
  };

  const loadTunnels = async () => {
    if (!settings.apiKey || !settings.accountId) return;
    setTunnelsLoading(true);
    setTunnelsError(null);
    try {
      const items = await fetchTunnels(settings.apiKey.trim(), settings.accountId);
      const base: TunnelSummary[] = items.map((t) => {
        const meta = (t?.metadata as Record<string, unknown>) || {};
        const rawPort = (meta as any).tunneldashPort ?? (meta as any).tunnelPort ?? (meta as any).port ?? (meta as any).startPort;
        const portNum = typeof rawPort === "number" ? rawPort : Number(rawPort);
        const portMapEntries = typeof (meta as any).tunneldashPort === "object" && (meta as any).tunneldashPort !== null
          ? Object.entries((meta as any).tunneldashPort as Record<string, number | string>)
              .map(([host, port]) => ({
                host,
                port: Number(port),
                proto: host.split("-")[0] || undefined,
              }))
              .filter((p) => Number.isFinite(p.port))
          : [];

        const firstConn = Array.isArray(t.connections) ? t.connections[0] : undefined;
        const firstIp = firstConn?.origin_ip;
        const firstVersion = firstConn?.client_version;
        const connCount = Array.isArray(t.connections) ? t.connections.length : 0;
        const coloNames = Array.isArray(t.connections)
          ? Array.from(new Set(t.connections.map((c) => c?.colo_name).filter(Boolean) as string[]))
          : [];
        return {
          id: t.id,
          name: t.name,
          status: t.status,
          createdAt: t.created_at,
          port: Number.isFinite(portNum) ? portNum : undefined,
          metadata: Object.keys(meta).length ? meta : undefined,
          portMap: portMapEntries.length ? portMapEntries : undefined,
          connectionIp: firstIp,
          clientVersion: firstVersion,
          connectionCount: connCount,
          coloNames,
        };
      });

      const withConfigs = await Promise.all(
        base.map(async (t) => {
          try {
            const cfgBody = await fetchTunnelConfig(settings.apiKey.trim(), settings.accountId!, t.id);
            const ingress = cfgBody?.result?.config?.ingress;
            const services = Array.isArray(ingress)
              ? ingress
                  .filter((entry) => Boolean(entry?.service) && Boolean((entry as any).hostname))
                  .map((entry) => ({ service: entry?.service as string, hostname: (entry as any).hostname as string | undefined }))
                  .filter((svc) => Boolean(svc.service) && !svc.service.startsWith("http_status:"))
              : [];

            const configs: ConfigInfo[] = services.map((svc) => {
              const proto = parseProtocol(svc.service);
              const hostPort = pickHostPort(t.portMap, proto, svc.hostname);
              return {
                service: svc.service,
                proto,
                host: svc.hostname || hostPort?.host,
                hostname: svc.hostname,
                port: hostPort?.port ?? t.port,
              };
            });

            const serviceNames = services.map((s) => s.service);
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

  const filteredTunnels = useMemo(() => {
    return tunnels
      .map((t) => {
        const configs = t.configs ?? (t.service ? [{ service: t.service }] : []);
        const displayConfigs = settings.hideHttp ? configs.filter((c) => !isHttpProtocol(c.service)) : configs;
        const hiddenHttpCount = Math.max(0, configs.length - displayConfigs.length);
        const connectConfig = displayConfigs[0] || configs[0];
        const connectHost = connectConfig ? connectConfig.host || parseHost(connectConfig.service) || undefined : undefined;

        return {
          ...t,
          connectionIp: settings.hideIp ? undefined : t.connectionIp,
          connectService: connectConfig?.service,
          connectHost,
          displayConfigs,
          configs,
          hiddenHttpCount,
        } as TunnelSummary;
      })
      .filter((t) => {
        if (settings.hideOffline && t.status) {
          const s = t.status.toLowerCase();
          if (s.includes("offline") || s.includes("down")) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const aOnline = a.status ? a.status.toLowerCase().includes("healthy") || a.status.toLowerCase().includes("online") : false;
        const bOnline = b.status ? b.status.toLowerCase().includes("healthy") || b.status.toLowerCase().includes("online") : false;
        if (aOnline === bOnline) return 0;
        return aOnline ? -1 : 1;
      });
  }, [tunnels, settings.hideOffline, settings.hideHttp, settings.hideIp]);

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
