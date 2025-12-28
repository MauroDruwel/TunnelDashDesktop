import { ConfigInfo, TunnelSummary } from "../types";

export type TunnelsScreenProps = {
  accountLine: string;
  tunnels: TunnelSummary[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onToggle: (t: TunnelSummary, cfg: ConfigInfo) => Promise<void>;
  activeHosts: Set<string>;
  connecting: string | null;
};

export function TunnelsScreen({
  accountLine,
  tunnels,
  loading,
  error,
  onRefresh,
  onToggle,
  activeHosts,
  connecting,
}: TunnelsScreenProps) {
  return (
    <div className="stack">
      <div className="row between">
        <div>
          <p className="eyebrow">Your tunnels</p>
          <h1>Cloudflare tunnels</h1>
          <p className="muted">{accountLine}</p>
        </div>
        <button className="ghost" onClick={onRefresh} disabled={loading}>
          {loading ? "..." : "↻"}
        </button>
      </div>

      {error && <div className="callout error">{error}</div>}
      {loading && !tunnels.length && <div className="callout">Loading tunnels...</div>}
      {!loading && !error && !tunnels.length && <div className="callout">No tunnels yet.</div>}

      <div className="tunnel-list">
        {tunnels.map((t) => (
          <TunnelCard
            key={t.id}
            tunnel={t}
            activeHosts={activeHosts}
            connecting={connecting}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
}

function TunnelCard({
  tunnel,
  activeHosts,
  connecting,
  onToggle,
}: {
  tunnel: TunnelSummary;
  activeHosts: Set<string>;
  connecting: string | null;
  onToggle: (t: TunnelSummary, cfg: ConfigInfo) => Promise<void>;
}) {
  const configs = (tunnel.displayConfigs && tunnel.displayConfigs.length ? tunnel.displayConfigs : tunnel.configs) || [];
  const statusLabel = tunnel.status || "unknown";
  const statusClass = statusLabel.toLowerCase().includes("healthy") || statusLabel.toLowerCase().includes("online") ? "online" : "offline";

  return (
    <div className="tunnel-card">
      <div className="tunnel-row">
        <div>
          <div className="tunnel-name">{tunnel.name || tunnel.id}</div>
          {(tunnel.coloNames?.length || tunnel.connectionIp) && (
            <div className="tunnel-meta">
              {tunnel.coloNames?.length ? tunnel.coloNames.join(", ") : ""}
              {tunnel.coloNames?.length && tunnel.connectionIp ? " - " : ""}
              {tunnel.connectionIp ? tunnel.connectionIp : ""}
            </div>
          )}
          {tunnel.clientVersion && <div className="tunnel-meta">Cloudflared: {tunnel.clientVersion}</div>}
        </div>
        <div className={`badge ${statusClass}`}>{statusLabel}</div>
      </div>

      <div className="tunnel-meta">Protocols</div>
      {configs.length ? (
        <div className="config-list">
          {configs.map((cfg, idx) => (
            <ConfigRow
              key={`${tunnel.id}-cfg-${idx}`}
              tunnel={tunnel}
              cfg={cfg}
              activeHosts={activeHosts}
              connecting={connecting}
              onToggle={onToggle}
            />
          ))}
        </div>
      ) : (
        <div className="tunnel-meta">No configs</div>
      )}
    </div>
  );
}

function ConfigRow({
  tunnel,
  cfg,
  activeHosts,
  connecting,
  onToggle,
}: {
  tunnel: TunnelSummary;
  cfg: ConfigInfo;
  activeHosts: Set<string>;
  connecting: string | null;
  onToggle: (t: TunnelSummary, cfg: ConfigInfo) => Promise<void>;
}) {
  const hostKey = cfg.host || tunnelHostKey({ ...tunnel, connectHost: undefined, connectService: cfg.service, service: cfg.service });
  const live = hostKey ? activeHosts.has(hostKey) : false;
  const localPort = cfg.port ?? tunnel.port ?? "n/a";
  const protoLabel = (cfg.proto || "").toUpperCase() || (cfg.service?.split(":")[0] || "").toUpperCase() || "CONFIG";

  return (
    <div className="config-row">
      <div className="config-info">
        <div className="pill-lite">{protoLabel}</div>
        {(cfg.host || localPort !== "n/a") && (
          <div className="tunnel-meta">
            {cfg.host ? `${cfg.host}${localPort !== "n/a" ? `:${localPort}` : ""}` : localPort !== "n/a" ? `Port ${localPort}` : ""}
          </div>
        )}
      </div>
      <div className="tunnel-actions inline">
        <button
          className={`pill-btn ${live ? "on" : ""}`}
          disabled={Boolean(connecting)}
          onClick={() => onToggle(tunnel, cfg)}
        >
          {connecting === hostKey ? "Working..." : live ? "Disconnect" : "Connect"}
        </button>
      </div>
    </div>
  );
}

function tunnelHostKey(t: TunnelSummary) {
  if (t.connectHost) return t.connectHost;
  const candidate = t.connectService || t.service || (t.services ? t.services[0] : undefined);
  if (candidate) {
    try {
      const url = candidate.includes("://") ? new URL(candidate) : new URL(`ssh://${candidate}`);
      return url.host;
    } catch {
      return candidate;
    }
  }
  return t.id;
}
