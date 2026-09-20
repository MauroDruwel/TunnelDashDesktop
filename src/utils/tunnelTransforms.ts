import { Tunnel } from "../api";
import { ConfigInfo, Settings, SshServer, TunnelSummary } from "../types";

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

export function isHttpProtocol(service?: string): boolean {
  if (!service) return false;
  const s = service.toLowerCase();
  return s.startsWith("http://") || s.startsWith("https://") || s === "http" || s === "https";
}

export function parseProtocol(service: string | undefined, hostname?: string): string | undefined {
  if (!service) return undefined;
  const s = service.trim().toLowerCase();

  // 1. Explicit protocol schemes
  if (s.startsWith("rdp://") || s.startsWith("rdp:")) return "rdp";
  if (s.startsWith("smb://") || s.startsWith("smb:")) return "smb";
  if (s.startsWith("ssh://") || s.startsWith("ssh:")) return "ssh";
  if (s.startsWith("https://") || s.startsWith("https:")) return "https";
  if (s.startsWith("http://") || s.startsWith("http:")) return "http";
  if (s.startsWith("tcp://") || s.startsWith("tcp:")) return "tcp";
  if (s.startsWith("unix+tls:") || s.startsWith("unix+tls://")) return "unix+tls";
  if (s.startsWith("unix:") || s.startsWith("unix://")) return "unix";
  if (s === "bastion" || s.startsWith("bastion:")) return "bastion";
  if (s.startsWith("http_status:") || s.startsWith("http_status")) return "http_status";

  // 2. Port-based inference
  const portMatch = s.match(/:(\d+)$/);
  if (portMatch) {
    const port = Number(portMatch[1]);
    if (port === 3389) return "rdp";
    if (port === 445 || port === 139) return "smb";
    if (port === 22 || port === 2222) return "ssh";
    if (port === 80 || port === 8080) return "http";
    if (port === 443 || port === 8443) return "https";
  }

  // 3. Hostname-based inference
  const h = (hostname || "").toLowerCase();
  if (h.startsWith("rdp-") || h.includes(".rdp.") || h.endsWith("-rdp")) return "rdp";
  if (h.startsWith("smb-") || h.includes(".smb.") || h.endsWith("-smb")) return "smb";
  if (h.startsWith("ssh-") || h.includes(".ssh.") || h.endsWith("-ssh")) return "ssh";

  // 4. Standard URL scheme extraction
  if (s.includes("://")) {
    try {
      const url = new URL(s);
      return url.protocol.replace(":", "");
    } catch {
      // ignore
    }
  }

  const bare = s.split(":")[0];
  return bare || "tcp";
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

function toPortValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * Extract hostname→port map from tunnel metadata.
 * Matches mobile: nested `tunneldashPort.{hostname: port}` (keys lowercased),
 * with flat metadata fallback for older data.
 */
export function extractPortsFromMetadata(
  metadata?: Record<string, unknown> | null
): Map<string, number> {
  const out = new Map<string, number>();
  if (!metadata) return out;

  const nested = metadata.tunneldashPort;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    for (const [key, value] of Object.entries(nested as Record<string, unknown>)) {
      const port = toPortValue(value);
      if (port !== undefined) out.set(key.toLowerCase(), port);
    }
    return out;
  }

  // Flat fallback (legacy)
  for (const [key, value] of Object.entries(metadata)) {
    if (key === "tunneldashPort") continue;
    const port = toPortValue(value);
    if (port !== undefined) out.set(key.toLowerCase(), port);
  }
  return out;
}

/**
 * Merge newly assigned ports into existing tunneldashPort metadata.
 * Same shape as mobile TunnelParser.mergeTunneldashPort.
 */
export function mergeTunneldashPort(
  existingMetadata: Record<string, unknown> | undefined,
  newPorts: Record<string, number>
): Record<string, unknown> {
  const existing =
    existingMetadata?.tunneldashPort &&
    typeof existingMetadata.tunneldashPort === "object" &&
    !Array.isArray(existingMetadata.tunneldashPort)
      ? { ...(existingMetadata.tunneldashPort as Record<string, unknown>) }
      : {};
  for (const [hostname, port] of Object.entries(newPorts)) {
    existing[hostname] = port;
  }
  // Preserve every other top-level metadata key (e.g. tunneldashSshSync) so a
  // port persist never clobbers the credential sync vault stored alongside it.
  const base = { ...(existingMetadata ?? {}) };
  delete (base as Record<string, unknown>).tunneldashPort;
  return { ...base, tunneldashPort: existing };
}

export function toTunnelSummary(t: Tunnel): TunnelSummary {
  const meta = (t?.metadata ?? {}) as Record<string, unknown>;
  const hostnamePorts = extractPortsFromMetadata(meta);

  // Scalar port only when tunneldashPort is a bare number (legacy)
  const rawScalar = meta.tunneldashPort;
  const scalarPort =
    typeof rawScalar === "number" || typeof rawScalar === "string"
      ? toPortValue(rawScalar)
      : toPortValue(meta.tunnelPort ?? meta.port ?? meta.startPort);

  const portMapEntries = Array.from(hostnamePorts.entries()).map(([host, port]) => ({
    host,
    port,
    proto: host.split("-")[0] || undefined,
  }));

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
    port: scalarPort,
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
    .map((entry) => ({
      service: entry?.service as string,
      hostname: entry?.hostname as string | undefined,
    }))
    .filter((svc) => Boolean(svc.service) && !svc.service.startsWith("http_status:"));

  // Hostname keys in metadata are lowercased (mobile parity)
  const byHostLower = new Map(
    (tunnel.portMap ?? []).map((p) => [p.host.toLowerCase(), p.port] as const)
  );

  return services.map((svc) => {
    const proto = parseProtocol(svc.service, svc.hostname);
    const hostKey = svc.hostname?.toLowerCase();
    const mapped = hostKey ? byHostLower.get(hostKey) : undefined;
    return {
      service: svc.service,
      proto,
      host: svc.hostname,
      hostname: svc.hostname,
      port: mapped,
    };
  });
}

export type PortAssignmentResult = {
  tunnels: TunnelSummary[];
  /** Per-tunnel map of newly assigned hostname → port (needs Cloudflare persist). */
  newAssignments: Map<string, Record<string, number>>;
};

/**
 * Assign unique local ports to every ingress route (mobile parity).
 * - Keeps ports already set from tunnel metadata when they don't collide.
 * - Fills the rest sequentially from `portStart` (default 50000).
 * - Returns `newAssignments` so callers can PATCH metadata.tunneldashPort.
 */
export function assignLocalPorts(tunnels: TunnelSummary[], portStart: number): PortAssignmentResult {
  const start =
    Number.isInteger(portStart) && portStart >= 1024 && portStart <= 65535 ? portStart : 50000;
  const used = new Set<number>();
  let next = start;
  const newAssignments = new Map<string, Record<string, number>>();

  // Seed used set from all known metadata ports first (global uniqueness)
  for (const t of tunnels) {
    for (const c of t.configs ?? []) {
      if (typeof c.port === "number" && c.port >= 1024 && c.port <= 65535) {
        used.add(c.port);
      }
    }
  }

  const takeNext = (): number => {
    while (used.has(next) && next < 65535) next += 1;
    const port = Math.min(next, 65535);
    used.add(port);
    if (next < 65535) next += 1;
    return port;
  };

  const result = tunnels.map((t) => {
    const configs = (t.configs ?? []).map((c) => {
      const existing = typeof c.port === "number" && Number.isFinite(c.port) ? c.port : undefined;
      if (existing !== undefined && existing >= 1024 && existing <= 65535) {
        return c; // already reserved in seed pass
      }
      const port = takeNext();
      const hostname = c.hostname || c.host;
      if (hostname) {
        const bucket = newAssignments.get(t.id) ?? {};
        bucket[hostname] = port;
        newAssignments.set(t.id, bucket);
      }
      return { ...c, port };
    });
    return {
      ...t,
      configs,
      port: configs[0]?.port ?? t.port,
    };
  });

  return { tunnels: result, newAssignments };
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

/**
 * A tunnel is considered online when Cloudflare reports it healthy/online.
 * Anything else (down, degraded, idle, unknown) is treated as offline so the
 * SSH dashboard can surface unreachable servers.
 */
export function isTunnelOnline(status?: string): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return s.includes("healthy") || s.includes("online");
}

/**
 * Derive a clean, friendly SSH host alias: like the Cloudflare tunnel name,
 * but lowercase connected to each other (e.g. "General Server" -> "generalserver",
 * "Rpi Luc" -> "rpiluc").
 */
export function deriveHostAlias(tunnelName?: string, hostname?: string): string {
  if (tunnelName && tunnelName.trim()) {
    const stripped = tunnelName.replace(/^ssh[-_]?/i, "");
    const cleaned = stripped.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (cleaned) return cleaned;
  }
  if (hostname && hostname.trim()) {
    const firstPart = hostname.split(".")[0] || "";
    const stripped = firstPart.replace(/^ssh[-_]?/i, "");
    const cleaned = stripped.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (cleaned) return cleaned;
  }
  return (hostname || "server").toLowerCase();
}

/**
 * Flatten every ingress route that exposes SSH across all tunnels into a single
 * list of SSH servers for the dashboard. Uses the same host key as the rest of
 * the app (cfg.host || cfg.hostname || parseHost(service) || tunnel.id), which
 * is what the OS keychain credential storage is keyed on.
 */
export function collectSshServers(tunnels: TunnelSummary[]): SshServer[] {
  const servers: SshServer[] = [];
  const usedAliases = new Map<string, number>();

  for (const t of tunnels) {
    const configs = t.configs ?? t.displayConfigs ?? [];
    for (const c of configs) {
      const proto = parseProtocol(c.service, c.hostname || c.host);
      const isSsh =
        proto === "ssh" ||
        (c.proto || "").toLowerCase() === "ssh" ||
        (c.hostname || "").toLowerCase().startsWith("ssh");
      if (!isSsh) continue;

      const host = c.host || c.hostname || parseHost(c.service) || t.id;
      const hostname = c.hostname || c.host || parseHost(c.service) || c.service;

      const baseAlias = deriveHostAlias(t.name, hostname);
      let alias = baseAlias;
      const count = usedAliases.get(baseAlias) || 0;
      if (count > 0) {
        alias = `${baseAlias}${count + 1}`;
      }
      usedAliases.set(baseAlias, count + 1);

      servers.push({
        key: `${t.id}::${host}`,
        tunnelId: t.id,
        tunnelName: t.name,
        tunnelStatus: t.status,
        online: isTunnelOnline(t.status),
        hostname,
        alias,
        service: c.service,
        port: c.port ?? t.port,
        host,
      });
    }
  }
  return servers;
}
