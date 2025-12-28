import { Tunnel } from "../api";
import { ConfigInfo, Settings, TunnelSummary } from "../types";

export function parseHost(service?: string): string | null {
  if (!service) return null;
  try {
    const url = service.includes("://") ? new URL(service) : new URL(`ssh://${service}`);
    return url.host;
  } catch (e) {
    console.warn("could not parse service", service, e);
    return null;
  }
}

export function isHttpProtocol(service: string): boolean {
  return service.startsWith("http://") || service.startsWith("https://");
}

export function parseProtocol(service: string | undefined): string | undefined {
  if (!service) return undefined;
  try {
    const url = service.includes("://") ? new URL(service) : new URL(`ssh://${service}`);
    return url.protocol.replace(":", "");
  } catch {
    const proto = service.split(":")[0];
    return proto || undefined;
  }
}

export function pickHostPort(
  portMap: Array<{ host: string; port: number; proto?: string }> | undefined,
  proto?: string,
  hostname?: string
) {
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
}

export function toTunnelSummary(t: Tunnel): TunnelSummary {
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
}

export function buildConfigsForTunnel(
  tunnel: TunnelSummary,
  ingress?: Array<{ service?: string; hostname?: string }>
): ConfigInfo[] {
  if (!Array.isArray(ingress)) return [];

  const services = ingress
    .filter((entry) => Boolean(entry?.service) && Boolean(entry?.hostname))
    .map((entry) => ({ service: entry?.service as string, hostname: (entry as any).hostname as string | undefined }))
    .filter((svc) => Boolean(svc.service) && !svc.service.startsWith("http_status:"));

  return services.map((svc) => {
    const proto = parseProtocol(svc.service);
    const hostPort = pickHostPort(tunnel.portMap, proto, svc.hostname);
    return {
      service: svc.service,
      proto,
      host: svc.hostname || hostPort?.host,
      hostname: svc.hostname,
      port: hostPort?.port ?? tunnel.port,
    };
  });
}

export function filterAndSortTunnels(tunnels: TunnelSummary[], settings: Settings): TunnelSummary[] {
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
}
