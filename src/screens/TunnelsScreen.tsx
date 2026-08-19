import { useState, useMemo, ChangeEvent } from "react";
import { TunnelSummary, ConfigInfo, Settings } from "../types";
import {
  RefreshIcon,
  SearchIcon,
  CopyIcon,
  CheckIcon,
  TerminalIcon,
  ExternalLinkIcon,
  ServerIcon,
  ZapIcon,
} from "../components/icons";
import { isHttpProtocol, parseHost } from "../utils/tunnelTransforms";

export type TunnelsScreenProps = {
  tunnels: TunnelSummary[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  toggleTunnel: (t: TunnelSummary, cfg: ConfigInfo) => Promise<void> | void;
  activeHosts: Set<string>;
  connecting: string | null;
  onStartSshWeb?: (t: TunnelSummary, cfg: ConfigInfo, creds: { username: string; password: string }) => void;
  settings: Settings;
};

export function TunnelsScreen({
  tunnels,
  loading,
  error,
  refresh,
  toggleTunnel,
  activeHosts,
  connecting,
  onStartSshWeb,
  settings,
}: TunnelsScreenProps) {
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "healthy" | "down">("all");
  const [expandedTunnels, setExpandedTunnels] = useState<Record<string, boolean>>(() => {
    return tunnels[0]?.id ? { [tunnels[0].id]: true } : {};
  });
  const [sshDrawerKey, setSshDrawerKey] = useState<string | null>(null);
  const [sshUser, setSshUser] = useState("root");
  const [sshPass, setSshPass] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1800);
  };

  const toggleTunnelExpand = (id: string) => {
    setExpandedTunnels((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const renderTunnelDescription = (
    mode: Settings["tunnelDescription"],
    tunnel: TunnelSummary,
    copied: string | null,
    copy: (text: string, key: string) => void
  ) => {
    if (mode === "none") return null;
    if (mode === "ip") {
      return (
        <span className="cf-uuid-text" style={{ color: "var(--kumo-subtle)" }}>
          {tunnel.connectionIp || "—"}
        </span>
      );
    }
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span className="cf-uuid-text">{tunnel.id}</span>
        <button
          type="button"
          className="cf-copy-btn"
          title="Copy Tunnel ID"
          onClick={(e) => {
            e.stopPropagation();
            copy(tunnel.id, `tunnel-${tunnel.id}`);
          }}
        >
          {copied === `tunnel-${tunnel.id}` ? (
            <CheckIcon size={12} style={{ color: "var(--cf-green-5)" }} />
          ) : (
            <CopyIcon size={12} />
          )}
        </button>
      </div>
    );
  };

  const filteredTunnels = useMemo(() => {
    return tunnels.filter((t) => {
      const isHealthy = (t.status || "").toLowerCase() === "healthy";
      if (settings.hideOffline && !isHealthy) return false;

      if (filterStatus === "healthy" && !isHealthy) return false;
      if (filterStatus === "down" && isHealthy) return false;

      if (search.trim()) {
        const q = search.toLowerCase();
        const matchesName = t.name.toLowerCase().includes(q);
        const matchesId = t.id.toLowerCase().includes(q);
        const matchesHost = (t.configs || []).some((c) =>
          (c.hostname || c.host || c.service).toLowerCase().includes(q)
        );
        if (!matchesName && !matchesId && !matchesHost) return false;
      }

      return true;
    });
  }, [tunnels, settings.hideOffline, filterStatus, search]);

  const healthyCount = tunnels.filter((t) => (t.status || "").toLowerCase() === "healthy").length;
  const downCount = tunnels.length - healthyCount;

  return (
    <>
      {/* ─── Cloudflare Header ─── */}
      <div className="cf-page-header">
        <div>
          <div className="cf-breadcrumbs">
            <span>Zero Trust</span>
            <span>/</span>
            <span>Networks</span>
            <span>/</span>
            <span className="current">Tunnels</span>
          </div>
          <h1 className="cf-page-title">Cloudflare Tunnels</h1>
          <div className="cf-page-subtitle">
            Manage your Cloudflare Tunnel connections, ingress endpoints, and local port bindings.
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            className="btn-cf-secondary"
            onClick={refresh}
            disabled={loading}
            title="Refresh active tunnels"
          >
            <RefreshIcon size={14} className={loading ? "animate-spin" : ""} />
            <span>{loading ? "Refreshing…" : "Refresh"}</span>
          </button>
        </div>
      </div>

      {error && <div className="cf-callout error">{error}</div>}

      {/* ─── Tunnels Table Card ─── */}
      <div className="cf-table-card">
        {/* Toolbar */}
        <div className="cf-table-toolbar">
          <div className="cf-search-wrapper">
            <span className="cf-search-icon">
              <SearchIcon size={14} />
            </span>
            <input
              type="text"
              className="cf-search-input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search tunnels by name, ID, or hostname..."
            />
          </div>

          <div className="cf-filter-tabs">
            <button
              type="button"
              className={`cf-filter-tab ${filterStatus === "all" ? "active" : ""}`}
              onClick={() => setFilterStatus("all")}
            >
              All ({tunnels.length})
            </button>
            <button
              type="button"
              className={`cf-filter-tab ${filterStatus === "healthy" ? "active" : ""}`}
              onClick={() => setFilterStatus("healthy")}
            >
              Healthy ({healthyCount})
            </button>
            {downCount > 0 && (
              <button
                type="button"
                className={`cf-filter-tab ${filterStatus === "down" ? "active" : ""}`}
                onClick={() => setFilterStatus("down")}
              >
                Down ({downCount})
              </button>
            )}
          </div>
        </div>

        {/* Real Data Table */}
        <table className="cf-table">
          <thead>
            <tr>
              <th style={{ width: "35%" }}>Name / Tunnel ID</th>
              <th style={{ width: "15%" }}>Status</th>
              {!settings.hideIp && <th style={{ width: "25%" }}>Edge Colocation</th>}
              <th style={{ width: "25%", textAlign: "right" }}>Ingress Routes</th>
            </tr>
          </thead>
          <tbody>
            {filteredTunnels.length === 0 ? (
              <tr>
                <td
                  colSpan={settings.hideIp ? 3 : 4}
                  style={{ textAlign: "center", padding: 36, color: "var(--kumo-subtle)" }}
                >
                  {loading
                    ? "Loading tunnels from Cloudflare Zero Trust API…"
                    : "No tunnels found matching your criteria."}
                </td>
              </tr>
            ) : (
              filteredTunnels.map((tunnel) => {
                const isHealthy = (tunnel.status || "").toLowerCase() === "healthy";
                const isExpanded = !!expandedTunnels[tunnel.id];
                const rawConfigs = tunnel.displayConfigs || tunnel.configs || [];
                const visibleConfigs = settings.hideHttp
                  ? rawConfigs.filter((c) => !isHttpProtocol(c.service))
                  : rawConfigs;

                return (
                  <tr key={tunnel.id} style={{ verticalAlign: "top" }}>
                    <td colSpan={settings.hideIp ? 3 : 4} style={{ padding: 0 }}>
                      {/* Main Tunnel Row */}
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: settings.hideIp ? "35% 15% 50%" : "35% 15% 25% 25%",
                          padding: "12px 16px",
                          alignItems: "center",
                          cursor: "pointer",
                        }}
                        onClick={() => toggleTunnelExpand(tunnel.id)}
                      >
                        {/* Name & Description */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                          <div style={{ fontWeight: 600, fontSize: 13.5, color: "var(--kumo-default)" }}>
                            {tunnel.name}
                          </div>
                          {renderTunnelDescription(settings.tunnelDescription, tunnel, copiedKey, copyToClipboard)}
                        </div>

                        {/* Status */}
                        <div>
                          <span className={`cf-status-badge ${isHealthy ? "healthy" : "down"}`}>
                            <span className="dot" />
                            <span>{isHealthy ? "HEALTHY" : "DOWN"}</span>
                          </span>
                        </div>

                        {/* Edge Colocations */}
                        {!settings.hideIp && (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                            {tunnel.coloNames && tunnel.coloNames.length > 0 ? (
                              tunnel.coloNames.map((colo, i) => (
                                <span key={i} className="cf-proto-tag" title={`Datacenter: ${colo}`}>
                                  {colo}
                                </span>
                              ))
                            ) : (
                              <span style={{ fontSize: 12, color: "var(--kumo-subtle)" }}>—</span>
                            )}
                          </div>
                        )}

                        {/* Expand Button / Route Counter */}
                        <div
                          style={{
                            textAlign: "right",
                            display: "flex",
                            justifyContent: "flex-end",
                            alignItems: "center",
                            gap: 8,
                          }}
                        >
                          <span style={{ fontSize: 12, color: "var(--kumo-subtle)" }}>
                            {visibleConfigs.length} {visibleConfigs.length === 1 ? "route" : "routes"}
                          </span>
                          <button
                            type="button"
                            className="btn-cf-secondary small"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleTunnelExpand(tunnel.id);
                            }}
                          >
                            {isExpanded ? "Collapse ▲" : "View Routes ▼"}
                          </button>
                        </div>
                      </div>

                      {/* Expandable Ingress Routes Sub-Table */}
                      {isExpanded && visibleConfigs.length > 0 && (
                        <div className="cf-subtable-container">
                          <table className="cf-subtable">
                            <thead>
                              <tr>
                                <th style={{ width: "12%" }}>Type</th>
                                <th style={{ width: "35%" }}>Public Hostname / Route</th>
                                <th style={{ width: "23%" }}>Local Binding</th>
                                <th style={{ width: "30%", textAlign: "right" }}>Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {visibleConfigs.map((cfg, rIdx) => {
                                const host = cfg.host || cfg.hostname || parseHost(cfg.service) || tunnel.id;
                                const isRunning = activeHosts.has(host);
                                const isBusy = connecting === host;
                                const ruleKey = `${tunnel.id}-${host}`;
                                const isSsh =
                                  cfg.service.toLowerCase().includes("ssh") ||
                                  (cfg.proto || "").toLowerCase() === "ssh" ||
                                  host.includes("ssh");
                                const isFormOpen = sshDrawerKey === ruleKey;
                                const displayHost = cfg.hostname || cfg.host || cfg.service;

                                return (
                                  <tr key={rIdx}>
                                    <td colSpan={4} style={{ padding: 0 }}>
                                      <div
                                        style={{
                                          display: "grid",
                                          gridTemplateColumns: "12% 35% 23% 30%",
                                          padding: "8px 12px",
                                          alignItems: "center",
                                        }}
                                      >
                                        {/* Protocol */}
                                        <div>
                                          <span
                                            className={`cf-proto-tag ${
                                              isSsh ? "ssh" : isHttpProtocol(cfg.service) ? "http" : "tcp"
                                            }`}
                                          >
                                            {isSsh ? "SSH" : isHttpProtocol(cfg.service) ? "HTTP" : "TCP"}
                                          </span>
                                        </div>

                                        {/* Hostname */}
                                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                                          <a
                                            href={`https://${displayHost}`}
                                            target="_blank"
                                            rel="noreferrer"
                                            className="cf-hostname-link"
                                          >
                                            {displayHost}
                                          </a>
                                          <button
                                            type="button"
                                            className="cf-copy-btn"
                                            title="Copy Route Hostname"
                                            onClick={() => copyToClipboard(displayHost, `host-${ruleKey}`)}
                                          >
                                            {copiedKey === `host-${ruleKey}` ? (
                                              <CheckIcon size={12} style={{ color: "var(--cf-green-5)" }} />
                                            ) : (
                                              <CopyIcon size={12} />
                                            )}
                                          </button>
                                        </div>

                                        {/* Local Binding Port */}
                                        <div>
                                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>
                                            localhost:{cfg.port ?? tunnel.port ?? settings.portStart}
                                          </span>
                                        </div>

                                        {/* Actions */}
                                        <div
                                          style={{
                                            textAlign: "right",
                                            display: "flex",
                                            justifyContent: "flex-end",
                                            gap: 6,
                                          }}
                                        >
                                          <button
                                            type="button"
                                            className={`btn-cf-secondary small ${isRunning ? "active" : ""}`}
                                            disabled={isBusy}
                                            onClick={() => toggleTunnel(tunnel, cfg)}
                                          >
                                            <ZapIcon
                                              size={12}
                                              style={{
                                                color: isRunning ? "var(--cf-green-5)" : "currentColor",
                                              }}
                                            />
                                            <span>
                                              {isBusy
                                                ? "Connecting…"
                                                : isRunning
                                                ? "Disconnect"
                                                : "Proxy Local"}
                                            </span>
                                          </button>

                                          {isSsh && (
                                            <button
                                              type="button"
                                              className="btn-cf-secondary small"
                                              onClick={() =>
                                                setSshDrawerKey(isFormOpen ? null : ruleKey)
                                              }
                                            >
                                              <TerminalIcon size={12} />
                                              <span>{isFormOpen ? "Hide SSH" : "Web SSH"}</span>
                                            </button>
                                          )}

                                          {isHttpProtocol(cfg.service) && (
                                            <a
                                              href={`https://${displayHost}`}
                                              target="_blank"
                                              rel="noreferrer"
                                              className="btn-cf-secondary small"
                                            >
                                              <ExternalLinkIcon size={12} />
                                              <span>Open</span>
                                            </a>
                                          )}
                                        </div>
                                      </div>

                                      {/* Inline SSH Connect Drawer */}
                                      {isFormOpen && (
                                        <div style={{ padding: "0 12px 12px" }}>
                                          <div className="cf-ssh-panel">
                                            <div
                                              style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: 6,
                                                fontWeight: 600,
                                                fontSize: 12.5,
                                              }}
                                            >
                                              <ServerIcon size={14} />
                                              <span>Web Shell Bastion Credentials ({displayHost})</span>
                                            </div>

                                            <div className="cf-ssh-fields">
                                              <div className="cf-ssh-field">
                                                <label>Username</label>
                                                <input
                                                  type="text"
                                                  className="cf-ssh-input"
                                                  value={sshUser}
                                                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                                                    setSshUser(e.target.value)
                                                  }
                                                  placeholder="root"
                                                />
                                              </div>

                                              <div className="cf-ssh-field">
                                                <label>Password (Optional if key used)</label>
                                                <input
                                                  type="password"
                                                  className="cf-ssh-input"
                                                  value={sshPass}
                                                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                                                    setSshPass(e.target.value)
                                                  }
                                                  placeholder="••••••••"
                                                />
                                              </div>
                                            </div>

                                            <div
                                              style={{
                                                display: "flex",
                                                justifyContent: "flex-end",
                                                gap: 6,
                                                marginTop: 4,
                                              }}
                                            >
                                              <button
                                                type="button"
                                                className="btn-cf-primary"
                                                onClick={() => {
                                                  if (onStartSshWeb) {
                                                    onStartSshWeb(tunnel, cfg, {
                                                      username: sshUser,
                                                      password: sshPass,
                                                    });
                                                  }
                                                }}
                                              >
                                                <TerminalIcon size={13} />
                                                <span>Launch Web Terminal</span>
                                              </button>
                                            </div>
                                          </div>
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
