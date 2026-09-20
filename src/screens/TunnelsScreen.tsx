import { useState, useMemo, useEffect, useRef } from "react";
import { TunnelSummary, ConfigInfo, Settings } from "../types";
import {
  RefreshIcon,
  SearchIcon,
  CopyIcon,
  CheckIcon,
  ZapIcon,
  TerminalIcon,
  ChevronDownIcon,
  CloseIcon,
  CloudIcon,
  ServerIcon,
} from "../components/icons";
import { isHttpProtocol, parseHost, parseProtocol } from "../utils/tunnelTransforms";
import { openUrl } from "../api";

export type TunnelsScreenProps = {
  tunnels: TunnelSummary[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  toggleTunnel: (t: TunnelSummary, cfg: ConfigInfo) => Promise<void> | void;
  activeHosts: Set<string>;
  connecting: string | null;
  onOpenSsh?: (host: string, hostname?: string, tunnelName?: string) => void;
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
  onOpenSsh,
  settings,
}: TunnelsScreenProps) {
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "healthy" | "down">("all");
  const [selectedProtos, setSelectedProtos] = useState<string[]>([]);
  const [protoDropdownOpen, setProtoDropdownOpen] = useState(false);
  const protoDropdownRef = useRef<HTMLDivElement>(null);
  const [expandedTunnels, setExpandedTunnels] = useState<Record<string, boolean>>(() => {
    return tunnels[0]?.id ? { [tunnels[0].id]: true } : {};
  });
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Close dropdown on click outside
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (protoDropdownRef.current && !protoDropdownRef.current.contains(e.target as Node)) {
        setProtoDropdownOpen(false);
      }
    };
    if (protoDropdownOpen) {
      document.addEventListener("mousedown", handleOutside);
      return () => document.removeEventListener("mousedown", handleOutside);
    }
  }, [protoDropdownOpen]);

  // Keep first tunnel expanded once data loads (handles initial empty state)
  useEffect(() => {
    if (tunnels.length > 0 && Object.keys(expandedTunnels).length === 0) {
      setExpandedTunnels({ [tunnels[0].id]: true });
    }
  }, [tunnels, expandedTunnels]);

  const copyToClipboard = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Fallback for non-secure contexts or denied permissions
      const el = document.createElement("textarea");
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      document.body.removeChild(el);
    }
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

  const {
    totalRoutesCount,
    sshRoutesCount,
    rdpRoutesCount,
    smbRoutesCount,
    httpRoutesCount,
    tcpRoutesCount,
  } = useMemo(() => {
    let routes = 0;
    let ssh = 0;
    let rdp = 0;
    let smb = 0;
    let http = 0;
    let tcp = 0;

    for (const t of tunnels) {
      const cfgs = t.displayConfigs || t.configs || [];
      routes += cfgs.length;
      for (const c of cfgs) {
        const p = (c.proto || parseProtocol(c.service, c.hostname || c.host) || "tcp").toLowerCase();
        if (p === "ssh" || (c.hostname || c.host || "").includes("ssh")) ssh++;
        else if (p === "rdp") rdp++;
        else if (p === "smb") smb++;
        else if (p === "http" || p === "https" || isHttpProtocol(c.service)) http++;
        else tcp++;
      }
    }
    return {
      totalRoutesCount: routes,
      sshRoutesCount: ssh,
      rdpRoutesCount: rdp,
      smbRoutesCount: smb,
      httpRoutesCount: http,
      tcpRoutesCount: tcp,
    };
  }, [tunnels]);

  const matchesProto = (cfg: ConfigInfo, protos: string[]) => {
    if (!protos.length) return true;
    const p = (cfg.proto || parseProtocol(cfg.service, cfg.hostname || cfg.host) || "tcp").toLowerCase();
    const isSsh = p === "ssh" || (cfg.hostname || cfg.host || "").includes("ssh");
    const isHttp = p === "http" || p === "https" || isHttpProtocol(cfg.service);
    const isRdp = p === "rdp";
    const isSmb = p === "smb";
    const isTcp = !isSsh && !isHttp && !isRdp && !isSmb;

    if (protos.includes("ssh") && isSsh) return true;
    if (protos.includes("http") && isHttp) return true;
    if (protos.includes("tcp") && isTcp) return true;
    if (protos.includes("rdp") && isRdp) return true;
    if (protos.includes("smb") && isSmb) return true;
    return false;
  };

  const toggleProtoFilter = (proto: string) => {
    setSelectedProtos((prev) =>
      prev.includes(proto) ? prev.filter((p) => p !== proto) : [...prev, proto]
    );
  };

  // `tunnels` is already filtered for hideOffline/hideHttp by useTunnelState;
  // apply UI-level filters here (search + healthy/down tabs + protocol multi-filter).
  const filteredTunnels = useMemo(() => {
    return tunnels.filter((t) => {
      const isHealthy = (t.status || "").toLowerCase() === "healthy";

      if (filterStatus === "healthy" && !isHealthy) return false;
      if (filterStatus === "down" && isHealthy) return false;

      const cfgs = t.displayConfigs || t.configs || [];

      if (selectedProtos.length > 0) {
        const hasMatchingProto = cfgs.some((c) => matchesProto(c, selectedProtos));
        if (!hasMatchingProto) return false;
      }

      if (search.trim()) {
        const q = search.toLowerCase();
        const matchesName = t.name.toLowerCase().includes(q);
        const matchesId = t.id.toLowerCase().includes(q);
        const matchesHost = cfgs.some((c) =>
          (c.hostname || c.host || c.service).toLowerCase().includes(q)
        );
        if (!matchesName && !matchesId && !matchesHost) return false;
      }

      return true;
    });
  }, [tunnels, filterStatus, selectedProtos, search]);

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

      {/* ─── Metrics Ribbon ─── */}
      <div className="cf-metrics-grid">
        <div className="cf-metric-card">
          <div className="cf-metric-label">
            <CloudIcon size={13} />
            <span>Tunnels</span>
          </div>
          <div className="cf-metric-value-row">
            <span className="cf-metric-value">{tunnels.length}</span>
            <span className="cf-metric-subtext">
              {healthyCount} healthy · {downCount} down
            </span>
          </div>
        </div>

        <div className="cf-metric-card">
          <div className="cf-metric-label">
            <ZapIcon size={13} style={{ color: activeHosts.size > 0 ? "var(--cf-green-5)" : "inherit" }} />
            <span>Local Proxies</span>
          </div>
          <div className="cf-metric-value-row">
            <span className="cf-metric-value">{activeHosts.size}</span>
            <span className="cf-metric-subtext">
              {activeHosts.size === 1 ? "active listener" : "active listeners"}
            </span>
          </div>
        </div>

        <div className="cf-metric-card">
          <div className="cf-metric-label">
            <ServerIcon size={13} />
            <span>Ingress Routes</span>
          </div>
          <div className="cf-metric-value-row">
            <span className="cf-metric-value">{totalRoutesCount}</span>
            <span className="cf-metric-subtext">
              across all tunnels
            </span>
          </div>
        </div>

        <div className="cf-metric-card">
          <div className="cf-metric-label">
            <TerminalIcon size={13} />
            <span>SSH Endpoints</span>
          </div>
          <div className="cf-metric-value-row">
            <span className="cf-metric-value">{sshRoutesCount}</span>
            <span className="cf-metric-subtext">
              Zero Trust access
            </span>
          </div>
        </div>
      </div>

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
            {search.length > 0 && (
              <button
                type="button"
                className="cf-search-clear-btn"
                onClick={() => setSearch("")}
                title="Clear search query"
              >
                <CloseIcon size={12} />
              </button>
            )}
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
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

            <div className="cf-filter-dropdown-wrapper" ref={protoDropdownRef}>
              <button
                type="button"
                className={`cf-filter-dropdown-btn ${selectedProtos.length > 0 ? "active" : ""}`}
                onClick={() => setProtoDropdownOpen((prev) => !prev)}
                title="Filter routes by protocol"
              >
                <span>
                  {selectedProtos.length === 0
                    ? `All Routes (${totalRoutesCount})`
                    : selectedProtos.length === 1
                    ? `${selectedProtos[0].toUpperCase()} (${
                        selectedProtos[0] === "ssh"
                          ? sshRoutesCount
                          : selectedProtos[0] === "http"
                          ? httpRoutesCount
                          : selectedProtos[0] === "tcp"
                          ? tcpRoutesCount
                          : selectedProtos[0] === "rdp"
                          ? rdpRoutesCount
                          : smbRoutesCount
                      })`
                    : `Routes: ${selectedProtos.map((p) => p.toUpperCase()).join(", ")}`}
                </span>
                <ChevronDownIcon
                  size={12}
                  style={{
                    transition: "transform 0.2s ease",
                    transform: protoDropdownOpen ? "rotate(180deg)" : "rotate(0deg)",
                  }}
                />
              </button>

              {protoDropdownOpen && (
                <div className="cf-filter-dropdown-menu">
                  <div className="cf-filter-dropdown-header">Filter Routes</div>
                  <div
                    className="cf-filter-dropdown-item"
                    onClick={() => setSelectedProtos([])}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={selectedProtos.length === 0}
                        onChange={() => setSelectedProtos([])}
                      />
                      <span>All Protocols</span>
                    </span>
                    <span className="cf-filter-dropdown-count">{totalRoutesCount}</span>
                  </div>

                  <div style={{ height: 1, backgroundColor: "var(--kumo-line)", margin: "4px 0" }} />

                  <div
                    className="cf-filter-dropdown-item"
                    onClick={() => toggleProtoFilter("ssh")}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={selectedProtos.includes("ssh")}
                        onChange={() => toggleProtoFilter("ssh")}
                      />
                      <span className="cf-proto-tag ssh">SSH</span>
                    </span>
                    <span className="cf-filter-dropdown-count">{sshRoutesCount}</span>
                  </div>

                  <div
                    className="cf-filter-dropdown-item"
                    onClick={() => toggleProtoFilter("http")}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={selectedProtos.includes("http")}
                        onChange={() => toggleProtoFilter("http")}
                      />
                      <span className="cf-proto-tag http">HTTP</span>
                    </span>
                    <span className="cf-filter-dropdown-count">{httpRoutesCount}</span>
                  </div>

                  <div
                    className="cf-filter-dropdown-item"
                    onClick={() => toggleProtoFilter("tcp")}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={selectedProtos.includes("tcp")}
                        onChange={() => toggleProtoFilter("tcp")}
                      />
                      <span className="cf-proto-tag tcp">TCP</span>
                    </span>
                    <span className="cf-filter-dropdown-count">{tcpRoutesCount}</span>
                  </div>

                  {rdpRoutesCount > 0 && (
                    <div
                      className="cf-filter-dropdown-item"
                      onClick={() => toggleProtoFilter("rdp")}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <input
                          type="checkbox"
                          checked={selectedProtos.includes("rdp")}
                          onChange={() => toggleProtoFilter("rdp")}
                        />
                        <span className="cf-proto-tag rdp">RDP</span>
                      </span>
                      <span className="cf-filter-dropdown-count">{rdpRoutesCount}</span>
                    </div>
                  )}

                  {smbRoutesCount > 0 && (
                    <div
                      className="cf-filter-dropdown-item"
                      onClick={() => toggleProtoFilter("smb")}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <input
                          type="checkbox"
                          checked={selectedProtos.includes("smb")}
                          onChange={() => toggleProtoFilter("smb")}
                        />
                        <span className="cf-proto-tag smb">SMB</span>
                      </span>
                      <span className="cf-filter-dropdown-count">{smbRoutesCount}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
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
            {loading && filteredTunnels.length === 0 ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={settings.hideIp ? 3 : 4} style={{ padding: "16px 18px" }}>
                    <div
                      style={{
                        display: "grid",
                        gridTemplateColumns: settings.hideIp ? "35% 15% 50%" : "35% 15% 25% 25%",
                        gap: 16,
                        alignItems: "center",
                      }}
                    >
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <div className="cf-skeleton-bar" style={{ width: "65%" }} />
                        <div className="cf-skeleton-bar" style={{ width: "40%", height: 10 }} />
                      </div>
                      <div className="cf-skeleton-bar" style={{ width: "60px", height: 18 }} />
                      {!settings.hideIp && (
                        <div className="cf-skeleton-bar" style={{ width: "45px" }} />
                      )}
                      <div className="cf-skeleton-bar" style={{ width: "70px", justifySelf: "end" }} />
                    </div>
                  </td>
                </tr>
              ))
            ) : filteredTunnels.length === 0 ? (
              <tr>
                <td
                  colSpan={settings.hideIp ? 3 : 4}
                  style={{ padding: 0 }}
                >
                  <div className="cf-empty-state">
                    <div className="cf-empty-icon">
                      <SearchIcon size={22} />
                    </div>
                    <div className="cf-empty-title">
                      {search || filterStatus !== "all" || selectedProtos.length > 0
                        ? "No matching tunnels found"
                        : "No Cloudflare Tunnels discovered"}
                    </div>
                    <div className="cf-empty-desc">
                      {search || filterStatus !== "all" || selectedProtos.length > 0
                        ? "Try adjusting your search terms or filters to locate your tunnel."
                        : "No tunnels were found on your Cloudflare account. Create a tunnel in the Zero Trust dashboard to get started."}
                    </div>
                    {(search || filterStatus !== "all" || selectedProtos.length > 0) && (
                      <button
                        type="button"
                        className="btn-cf-secondary small"
                        style={{ marginTop: 6 }}
                        onClick={() => {
                          setSearch("");
                          setFilterStatus("all");
                          setSelectedProtos([]);
                        }}
                      >
                        Reset filters
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              filteredTunnels.map((tunnel) => {
                const isHealthy = (tunnel.status || "").toLowerCase() === "healthy";
                const isExpanded = !!expandedTunnels[tunnel.id];
                const rawConfigs = tunnel.displayConfigs || tunnel.configs || [];
                const visibleConfigs = (settings.hideHttp
                  ? rawConfigs.filter((c) => !isHttpProtocol(c.service))
                  : rawConfigs
                ).filter((c) => matchesProto(c, selectedProtos));

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
                            style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleTunnelExpand(tunnel.id);
                            }}
                          >
                            <span>{isExpanded ? "Hide Routes" : "View Routes"}</span>
                            <ChevronDownIcon
                              size={12}
                              style={{
                                transition: "transform 0.2s ease",
                                transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                              }}
                            />
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
                                <th style={{ width: "38%" }}>Public Hostname / Route</th>
                                <th style={{ width: "22%" }}>Local Binding</th>
                                <th style={{ width: "28%", textAlign: "right" }}>Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {visibleConfigs.map((cfg, rIdx) => {
                                const host = cfg.host || cfg.hostname || parseHost(cfg.service) || tunnel.id;
                                const isRunning = activeHosts.has(host);
                                const isBusy = connecting === host;
                                const ruleKey = `${tunnel.id}-${host}`;
                                const proto = (cfg.proto || parseProtocol(cfg.service, cfg.hostname || cfg.host) || "tcp").toLowerCase();
                                const isSsh = proto === "ssh" || host.includes("ssh");
                                const isHttp = proto === "http" || proto === "https" || isHttpProtocol(cfg.service);
                                const displayHost =
                                  cfg.hostname || cfg.host || parseHost(cfg.service) || cfg.service;
                                const linkHost = displayHost.replace(/^[a-z]+:\/\//i, "");

                                return (
                                  <tr
                                    key={rIdx}
                                    className={isHttp ? "cf-clickable-route" : ""}
                                    style={{ cursor: isHttp ? "pointer" : "default" }}
                                    onClick={() => {
                                      if (isHttp) {
                                        void openUrl(`https://${linkHost}`);
                                      }
                                    }}
                                    title={isHttp ? `Click to open https://${linkHost}` : undefined}
                                  >
                                    <td colSpan={4} style={{ padding: "8px 12px" }}>
                                      <div
                                        style={{
                                          display: "grid",
                                          gridTemplateColumns: "12% 38% 22% 28%",
                                          alignItems: "center",
                                        }}
                                      >
                                        {/* Protocol */}
                                        <div>
                                          <span className={`cf-proto-tag ${proto}`}>
                                            {proto.toUpperCase()}
                                          </span>
                                        </div>

                                        {/* Hostname */}
                                        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, overflow: "hidden" }}>
                                          {isHttp ? (
                                            <span
                                              className="cf-hostname-link"
                                              style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                void openUrl(`https://${linkHost}`);
                                              }}
                                              title={`Open https://${linkHost} in browser`}
                                            >
                                              {displayHost}
                                            </span>
                                          ) : (
                                            <span
                                              className="cf-hostname-link"
                                              style={{ cursor: "default", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                                              title={displayHost}
                                            >
                                              {displayHost}
                                            </span>
                                          )}
                                          <button
                                            type="button"
                                            className="cf-copy-btn"
                                            title="Copy Route Hostname"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              copyToClipboard(displayHost, `host-${ruleKey}`);
                                            }}
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
                                          <span
                                            style={{
                                              fontFamily: "var(--font-mono)",
                                              fontSize: 12,
                                              display: "inline-flex",
                                              alignItems: "center",
                                              gap: 6,
                                            }}
                                          >
                                            {isRunning && (
                                              <span
                                                style={{
                                                  width: 7,
                                                  height: 7,
                                                  borderRadius: "50%",
                                                  backgroundColor: "var(--cf-green-5)",
                                                  boxShadow: "0 0 6px var(--cf-green-5)",
                                                }}
                                                title="Proxy listener active on this local port"
                                              />
                                            )}
                                            localhost:{cfg.port ?? tunnel.port ?? settings.portStart}
                                          </span>
                                        </div>

                                        {/* Actions */}
                                        <div
                                          style={{
                                            textAlign: "right",
                                            display: "flex",
                                            justifyContent: "flex-end",
                                            alignItems: "center",
                                            gap: 6,
                                            flexWrap: "wrap",
                                          }}
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <button
                                            type="button"
                                            className={`btn-cf-secondary small ${isRunning ? "active" : ""}`}
                                            disabled={isBusy}
                                            onClick={() => toggleTunnel(tunnel, cfg)}
                                            title={isRunning ? "Stop local proxy listener" : "Start local proxy listener"}
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
                                              onClick={() => onOpenSsh?.(host, cfg.hostname, tunnel.name)}
                                              title="View SSH command and ~/.ssh/config status"
                                            >
                                              <TerminalIcon size={12} />
                                              <span>SSH</span>
                                            </button>
                                          )}
                                        </div>
                                      </div>
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
