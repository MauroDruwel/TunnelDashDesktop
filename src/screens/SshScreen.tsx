import { useCallback, useEffect, useMemo, useState } from "react";
import { Settings, SshServer, TunnelSummary } from "../types";
import {
  RefreshIcon,
  SearchIcon,
  TerminalIcon,
  KeyIcon,
  TrashIcon,
  CheckIcon,
  CloseIcon,
  CloudIcon,
  CopyIcon,
  ShieldCheckIcon,
} from "../components/icons";
import type {
  SshConfigStatus,
  SshCredentialInfo,
  SshCredentialSummary,
  SshHostConfig,
} from "../api";
import {
  sshDeleteCredential,
  sshGetConfigStatus,
  sshGetCredential,
  sshListCredentials,
  sshPreviewConfig,
  sshSaveCredential,
  sshSyncConfig,
} from "../api";
import { collectSshServers } from "../utils/tunnelTransforms";
import { errMsg } from "../utils/errors";
import { SshModal } from "../components/SshModal";
import { SshPreviewModal } from "../components/SshPreviewModal";

export type SshScreenProps = {
  tunnels: TunnelSummary[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  activeHosts: Set<string>;
  connecting: string | null;
  settings: Settings;
  onConnect?: (server: SshServer) => Promise<void> | void;
  /** Server key (`tunnelId::host`) whose credential editor should open, e.g. when redirected from the dashboard. */
  pendingConfigKey?: { key: string; nonce: number } | null;
  onConsumedPendingConfig?: () => void;
};

type SshIdentityDraft = {
  username: string;
  keyPath: string;
};

function isConfigured(info?: SshCredentialInfo | null): info is SshCredentialInfo {
  return Boolean(info && (info.username || info.keyPath));
}

export function SshScreen({
  tunnels,
  loading,
  error,
  refresh,
  settings,
  pendingConfigKey,
  onConsumedPendingConfig,
}: SshScreenProps) {
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "online" | "offline">("all");
  const [credMap, setCredMap] = useState<Record<string, SshCredentialInfo | undefined>>({});
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [savedCreds, setSavedCreds] = useState<SshCredentialSummary[] | null>(null);
  const [confirmingHost, setConfirmingHost] = useState<string | null>(null);
  const [copiedAlias, setCopiedAlias] = useState<string | null>(null);

  const handleCopyAlias = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedAlias(key);
      window.setTimeout(() => setCopiedAlias(null), 1800);
    } catch (e) {
      console.warn("copy failed", e);
    }
  };

  // SSH config status and modal states
  const [configStatus, setConfigStatus] = useState<SshConfigStatus | null>(null);
  const [selectedModalServer, setSelectedModalServer] = useState<SshServer | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewContent, setPreviewContent] = useState("");

  const sshServers = useMemo(() => collectSshServers(tunnels), [tunnels]);
  const knownHosts = useMemo(() => new Set(sshServers.map((s) => s.host)), [sshServers]);

  const loadConfigStatus = useCallback(async () => {
    try {
      const status = await sshGetConfigStatus();
      setConfigStatus(status);
    } catch (e) {
      console.warn("ssh_get_config_status failed", e);
    }
  }, []);

  const loadSavedCreds = useCallback(async () => {
    try {
      setSavedCreds(await sshListCredentials([...knownHosts]));
    } catch (e) {
      console.warn("ssh_list_credentials failed", e);
      setSavedCreds([]);
    }
  }, [knownHosts]);

  useEffect(() => {
    void loadSavedCreds();
    void loadConfigStatus();
  }, [loadSavedCreds, loadConfigStatus]);

  const loadCredFor = useCallback(async (server: SshServer) => {
    try {
      const info = await sshGetCredential(server.host);
      setCredMap((prev) => ({ ...prev, [server.key]: info }));
    } catch (e) {
      console.warn("ssh_get_credential failed", server.host, e);
      setCredMap((prev) => ({ ...prev, [server.key]: undefined }));
    }
  }, []);

  // Load saved-credential state for every discovered SSH endpoint.
  useEffect(() => {
    for (const s of sshServers) {
      if (!(s.key in credMap)) void loadCredFor(s);
    }
  }, [sshServers, credMap, loadCredFor]);

  // Dashboard redirect: open the credential editor for the requested server
  // once its tunnel data has loaded.
  useEffect(() => {
    if (!pendingConfigKey) return;
    const server = sshServers.find((s) => s.key === pendingConfigKey.key);
    if (!server) return;
    setEditingKey(server.key);
    setActionError(null);
    onConsumedPendingConfig?.();
  }, [pendingConfigKey, sshServers, onConsumedPendingConfig]);

  const filteredServers = useMemo(() => {
    return sshServers.filter((s) => {
      if (filterStatus === "online" && !s.online) return false;
      if (filterStatus === "offline" && s.online) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        return (
          s.hostname?.toLowerCase().includes(q) ||
          s.tunnelName.toLowerCase().includes(q) ||
          s.host.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [sshServers, filterStatus, search]);

  const onlineCount = sshServers.filter((s) => s.online).length;
  const offlineCount = sshServers.length - onlineCount;

  const handleOpenPreview = useCallback(async () => {
    try {
      const defaultUser = settings.defaultSshUser?.trim() || undefined;
      const defaultKey = settings.defaultSshKeyPath?.trim() || undefined;
      const hosts: SshHostConfig[] = sshServers.map((s) => ({
        host: s.host,
        alias: s.alias,
        hostname: s.hostname,
        username: credMap[s.key]?.username || defaultUser,
        keyPath: credMap[s.key]?.keyPath || defaultKey,
      }));
      const preview = await sshPreviewConfig(hosts);
      setPreviewContent(preview);
      setPreviewOpen(true);
    } catch (e) {
      setActionError(errMsg(e, "Could not generate SSH config preview"));
    }
  }, [sshServers, credMap, settings.defaultSshUser, settings.defaultSshKeyPath]);

  const handleSaveCred = async (server: SshServer, draft: SshIdentityDraft) => {
    setSaving(true);
    setActionError(null);
    try {
      await sshSaveCredential({
        host: server.host,
        username: draft.username.trim(),
        keyPath: draft.keyPath.trim() || undefined,
      });
      await loadCredFor(server);
      await loadSavedCreds();
      // Auto-update SSH config with new username/alias/keyPath
      const defaultUser = settings.defaultSshUser?.trim() || undefined;
      const defaultKey = settings.defaultSshKeyPath?.trim() || undefined;
      const hosts: SshHostConfig[] = sshServers.map((s) => ({
        host: s.host,
        alias: s.alias,
        hostname: s.hostname,
        username: s.key === server.key ? (draft.username.trim() || defaultUser) : (credMap[s.key]?.username || defaultUser),
        keyPath: s.key === server.key
          ? (draft.keyPath.trim() || defaultKey)
          : (credMap[s.key]?.keyPath || defaultKey),
      }));
      const updatedStatus = await sshSyncConfig(hosts);
      setConfigStatus(updatedStatus);
      setEditingKey(null);
    } catch (e) {
      setActionError(errMsg(e, "Could not save SSH identity"));
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveCred = async (server: SshServer) => {
    setSaving(true);
    setActionError(null);
    try {
      await sshDeleteCredential(server.host);
      setCredMap((prev) => ({ ...prev, [server.key]: undefined }));
      await loadSavedCreds();
      // Auto-update SSH config
      const defaultUser = settings.defaultSshUser?.trim() || undefined;
      const defaultKey = settings.defaultSshKeyPath?.trim() || undefined;
      const hosts: SshHostConfig[] = sshServers.map((s) => ({
        host: s.host,
        alias: s.alias,
        hostname: s.hostname,
        username: s.key === server.key ? defaultUser : (credMap[s.key]?.username || defaultUser),
        keyPath: s.key === server.key ? defaultKey : (credMap[s.key]?.keyPath || defaultKey),
      }));
      const updatedStatus = await sshSyncConfig(hosts);
      setConfigStatus(updatedStatus);
      setEditingKey(null);
    } catch (e) {
      setActionError(errMsg(e, "Could not remove SSH identity"));
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveSavedHost = async (host: string) => {
    if (confirmingHost !== host) {
      setConfirmingHost(host);
      window.setTimeout(() => setConfirmingHost((h) => (h === host ? null : h)), 4000);
      return;
    }
    setConfirmingHost(null);
    setActionError(null);
    try {
      await sshDeleteCredential(host);
      await loadSavedCreds();
      await loadConfigStatus();
      const server = sshServers.find((s) => s.host === host);
      if (server) setCredMap((prev) => ({ ...prev, [server.key]: undefined }));
    } catch (e) {
      setActionError(errMsg(e, "Could not remove SSH identity"));
    }
  };

  const renderAuthCell = (server: SshServer) => {
    if (!(server.key in credMap)) {
      return <span style={{ fontSize: 12, color: "var(--kumo-subtle)" }}>…</span>;
    }
    const info = credMap[server.key];
    const username = info?.username || settings.defaultSshUser;
    const keyPath = info?.keyPath || settings.defaultSshKeyPath;

    if (!username && !keyPath) {
      return (
        <span className="cf-ssh-auth warn" title="No custom identity configured — will use default OpenSSH identity">
          <KeyIcon size={12} />
          <span>Default Identity</span>
        </span>
      );
    }
    const keyLabel = keyPath ? keyPath.split("/").pop() || "SSH Key" : "Default Key";
    return (
      <span
        className="cf-ssh-auth ok"
        title={`Identity: ${username || "default user"} (${keyPath || "default key"})`}
        style={{ maxWidth: "100%", overflow: "hidden" }}
      >
        <KeyIcon size={12} style={{ flexShrink: 0 }} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {keyLabel} · {username || "default"}
        </span>
      </span>
    );
  };

  return (
    <>
      {/* ─── Page Header ─── */}
      <div className="cf-page-header">
        <div>
          <div className="cf-breadcrumbs">
            <span>Zero Trust</span>
            <span>/</span>
            <span className="current">SSH Sessions</span>
          </div>
          <h1 className="cf-page-title">SSH Sessions</h1>
          <div className="cf-page-subtitle">
            Every SSH endpoint exposed through your Cloudflare Tunnels, automatically synced to your OpenSSH configuration for passwordless terminal access.
          </div>
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            className="btn-cf-secondary"
            onClick={handleOpenPreview}
            title="Preview generated OpenSSH config entries"
          >
            <span>Preview Config</span>
          </button>
          <button
            type="button"
            className="btn-cf-secondary"
            onClick={refresh}
            disabled={loading}
            title="Refresh tunnels and SSH endpoints"
          >
            <RefreshIcon size={14} className={loading ? "animate-spin" : ""} />
            <span>{loading ? "Refreshing…" : "Refresh"}</span>
          </button>
        </div>
      </div>

      {(error || actionError) && <div className="cf-callout error">{actionError || error}</div>}

      {/* ─── Metrics Ribbon ─── */}
      <div className="cf-metrics-grid">
        <div className="cf-metric-card">
          <div className="cf-metric-label">
            <TerminalIcon size={13} />
            <span>SSH Endpoints</span>
          </div>
          <div className="cf-metric-value-row">
            <span className="cf-metric-value">{sshServers.length}</span>
            <span className="cf-metric-subtext">
              {onlineCount} online · {offlineCount} offline
            </span>
          </div>
        </div>

        <div className="cf-metric-card">
          <div className="cf-metric-label">
            <KeyIcon size={13} />
            <span>Configured Identities</span>
          </div>
          <div className="cf-metric-value-row">
            <span className="cf-metric-value">{savedCreds?.length ?? 0}</span>
            <span className="cf-metric-subtext">
              active key mappings
            </span>
          </div>
        </div>

        <div className="cf-metric-card">
          <div className="cf-metric-label">
            <CloudIcon size={13} />
            <span>Tunnels with SSH</span>
          </div>
          <div className="cf-metric-value-row">
            <span className="cf-metric-value">
              {new Set(sshServers.map((s) => s.tunnelId)).size}
            </span>
            <span className="cf-metric-subtext">
              origin servers
            </span>
          </div>
        </div>

        <div className="cf-metric-card">
          <div className="cf-metric-label">
            <ShieldCheckIcon size={13} style={{ color: "var(--cf-green-5)" }} />
            <span>OpenSSH Config</span>
          </div>
          <div className="cf-metric-value" style={{ fontSize: 18, fontWeight: 700, color: "var(--cf-green-5)", lineHeight: 1.2 }}>
            Auto-synced
          </div>
          <div
            className="cf-metric-subtext"
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              marginTop: 2,
            }}
            title={configStatus?.configPath || "~/.ssh/config"}
          >
            {configStatus?.configPath ? configStatus.configPath.replace(/^\/Users\/[^/]+/, "~") : "~/.ssh/config"}
          </div>
        </div>
      </div>

      {/* ─── SSH Servers Table Card ─── */}
      <div className="cf-table-card">
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
              placeholder="Search sessions by hostname or tunnel..."
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

          <div className="cf-filter-tabs">
            <button
              type="button"
              className={`cf-filter-tab ${filterStatus === "all" ? "active" : ""}`}
              onClick={() => setFilterStatus("all")}
            >
              All ({sshServers.length})
            </button>
            <button
              type="button"
              className={`cf-filter-tab ${filterStatus === "online" ? "active" : ""}`}
              onClick={() => setFilterStatus("online")}
            >
              Online ({onlineCount})
            </button>
            {offlineCount > 0 && (
              <button
                type="button"
                className={`cf-filter-tab ${filterStatus === "offline" ? "active" : ""}`}
                onClick={() => setFilterStatus("offline")}
              >
                Offline ({offlineCount})
              </button>
            )}
          </div>
        </div>

        <table className="cf-table">
          <thead>
            <tr>
              <th style={{ width: "42%" }}>Tunnel / Host</th>
              <th style={{ width: "14%" }}>Status</th>
              <th style={{ width: "24%" }}>SSH Key &amp; Identity</th>
              <th style={{ width: "20%", textAlign: "right" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && sshServers.length === 0 ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="cf-skeleton-row">
                  <td colSpan={4}>
                    <div className="cf-skeleton-bar" style={{ width: `${60 + (i % 3) * 15}%`, height: 16 }} />
                  </td>
                </tr>
              ))
            ) : filteredServers.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: 0 }}>
                  <div className="cf-empty-state">
                    <div className="cf-empty-icon">
                      <TerminalIcon size={24} />
                    </div>
                    <div className="cf-empty-title">
                      {search || filterStatus !== "all" ? "No matching SSH sessions" : "No SSH endpoints discovered"}
                    </div>
                    <div className="cf-empty-desc">
                      {search || filterStatus !== "all"
                        ? "Try adjusting your search keywords or filter criteria."
                        : "None of your tunnels currently expose an SSH ingress service (ssh:// or port 22)."}
                    </div>
                    {(search || filterStatus !== "all") && (
                      <button
                        type="button"
                        className="btn-cf-secondary small"
                        style={{ marginTop: 6 }}
                        onClick={() => {
                          setSearch("");
                          setFilterStatus("all");
                        }}
                      >
                        Reset filters
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              filteredServers.map((server) => {
                const isEditing = editingKey === server.key;

                return (
                  <tr key={server.key} style={{ verticalAlign: "top" }}>
                    <td colSpan={4} style={{ padding: 0 }}>
                      {/* Session Row */}
                      <div className={`cf-ssh-row ${isEditing ? "editing" : ""}`}>
                        {/* Host / Tunnel */}
                        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            {server.alias && (
                              <button
                                type="button"
                                className={`cf-alias-code ${copiedAlias === server.key ? "copied" : ""}`}
                                onClick={() => handleCopyAlias(`ssh ${server.alias}`, server.key)}
                                title={`Click to copy: ssh ${server.alias}`}
                              >
                                {copiedAlias === server.key ? (
                                  <>
                                    <CheckIcon size={11} />
                                    <span>Copied!</span>
                                  </>
                                ) : (
                                  <>
                                    <span>ssh {server.alias}</span>
                                    <CopyIcon size={11} />
                                  </>
                                )}
                              </button>
                            )}
                            <span className="cf-hostname-link" style={{ cursor: "default" }} title={server.hostname}>
                              {server.hostname}
                            </span>
                          </div>
                          <span style={{ fontSize: 11.5, color: "var(--kumo-subtle)" }}>{server.tunnelName}</span>
                        </div>

                        {/* Status */}
                        <div>
                          <span className={`cf-status-badge ${server.online ? "healthy" : "down"}`}>
                            <span className="dot" />
                            <span>{server.online ? "ONLINE" : "OFFLINE"}</span>
                          </span>
                        </div>

                        {/* Authentication */}
                        <div>{renderAuthCell(server)}</div>

                        {/* Actions */}
                        <div
                          style={{
                            textAlign: "right",
                            display: "flex",
                            justifyContent: "flex-end",
                            alignItems: "center",
                            gap: 6,
                          }}
                        >
                          <button
                            type="button"
                            className="btn-cf-secondary small"
                            onClick={() => setEditingKey(isEditing ? null : server.key)}
                            title="Configure username or private key for this host"
                          >
                            <KeyIcon size={12} />
                            <span>{isEditing ? "Close" : "Configure"}</span>
                          </button>
                          <button
                            type="button"
                            className="btn-cf-primary small"
                            onClick={() => setSelectedModalServer(server)}
                            title="View SSH connection command"
                          >
                            <TerminalIcon size={12} />
                            <span>Connect</span>
                          </button>
                        </div>
                      </div>

                      {/* Identity Editor */}
                      {isEditing && (
                        <SshIdentityEditor
                          key={server.key}
                          server={server}
                          info={credMap[server.key]}
                          defaultUser={settings.defaultSshUser}
                          defaultKeyPath={settings.defaultSshKeyPath}
                          saving={saving}
                          onSave={(draft) => handleSaveCred(server, draft)}
                          onRemove={() => handleRemoveCred(server)}
                          onClose={() => setEditingKey(null)}
                        />
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ─── Configured SSH Identities Card ─── */}
      <div className="cf-card">
        <div className="cf-card-header">
          <div className="cf-card-title">Configured SSH Identities</div>
          <div className="cf-card-desc">
            Host-specific SSH key identities and usernames stored locally and automatically synchronized into your system OpenSSH configuration.
          </div>
        </div>

        <div className="cf-card-body" style={{ padding: 0 }}>
          {savedCreds === null ? (
            <div style={{ padding: 18, fontSize: 13, color: "var(--kumo-subtle)" }}>
              Reading saved identities…
            </div>
          ) : savedCreds.length === 0 ? (
            <div style={{ padding: 18, fontSize: 13, color: "var(--kumo-subtle)" }}>
              No custom identities configured yet. Hosts inherit your default settings or standard OpenSSH keys.
            </div>
          ) : (
            savedCreds.map((cred) => (
              <div key={cred.host} className="cf-cred-row">
                <span className="cf-ssh-auth ok">
                  <KeyIcon size={12} />
                  <span>Key</span>
                </span>

                <span className="cf-hostname-link" style={{ cursor: "default" }} title={cred.host}>
                  {cred.host}
                </span>
                <span style={{ fontSize: 12, color: "var(--kumo-subtle)" }}>
                  user: <strong>{cred.username || "default"}</strong>
                </span>

                {!knownHosts.has(cred.host) && (
                  <span className="cf-proto-tag" title="No tunnel currently exposes this host">
                    Orphaned
                  </span>
                )}

                <div style={{ marginLeft: "auto" }}>
                  <button
                    type="button"
                    className={`btn-cf-danger small ${confirmingHost === cred.host ? "confirming" : ""}`}
                    disabled={saving}
                    onClick={() => handleRemoveSavedHost(cred.host)}
                    title="Remove this identity"
                  >
                    <TrashIcon size={12} />
                    <span>{confirmingHost === cred.host ? "Click again to confirm" : "Remove"}</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="cf-card-footer">
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {savedCreds ? `${savedCreds.length} custom identit${savedCreds.length === 1 ? "y" : "ies"} configured` : "…"}
          </span>
          <button
            type="button"
            className="btn-cf-secondary small"
            onClick={() => void loadSavedCreds()}
            title="Refresh saved identities"
          >
            <RefreshIcon size={12} />
            <span>Reload</span>
          </button>
        </div>
      </div>

      {/* ─── Modals ─── */}
      {selectedModalServer && (
        <SshModal
          host={selectedModalServer.host}
          hostname={selectedModalServer.hostname || selectedModalServer.host}
          alias={selectedModalServer.alias}
          tunnelName={selectedModalServer.tunnelName}
          credential={credMap[selectedModalServer.key]}
          configStatus={configStatus}
          onClose={() => setSelectedModalServer(null)}
          onOpenConfigure={() => {
            setEditingKey(selectedModalServer.key);
            setSelectedModalServer(null);
          }}
        />
      )}

      {previewOpen && (
        <SshPreviewModal
          configPath={configStatus?.configPath || "~/.ssh/config"}
          content={previewContent}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </>
  );
}

type SshIdentityEditorProps = {
  server: SshServer;
  info?: SshCredentialInfo | null;
  defaultUser?: string;
  defaultKeyPath?: string;
  saving: boolean;
  onSave: (draft: SshIdentityDraft) => void | Promise<void>;
  onRemove: () => void | Promise<void>;
  onClose: () => void;
};

function SshIdentityEditor({
  server,
  info,
  defaultUser,
  defaultKeyPath,
  saving,
  onSave,
  onRemove,
  onClose,
}: SshIdentityEditorProps) {
  const configured = isConfigured(info);
  const [username, setUsername] = useState(info?.username ?? "");
  const [keyPath, setKeyPath] = useState(info?.keyPath ?? "");

  const canSave = username.trim().length > 0 || keyPath.trim().length > 0;

  return (
    <div className="cf-subtable-container">
      <div className="cf-ssh-editor">
        <div className="cf-ssh-editor-header">
          <span className="cf-ssh-editor-title">SSH Identity for {server.hostname}</span>
          <span style={{ fontSize: 11.5, color: "var(--kumo-subtle)" }}>
            Configures <code style={{ fontFamily: "var(--font-mono)" }}>User</code> and <code style={{ fontFamily: "var(--font-mono)" }}>IdentityFile</code> in your OpenSSH configuration.
          </span>
        </div>

        <div className="cf-ssh-editor-grid">
          <div className="cf-form-group" style={{ margin: 0 }}>
            <label className="cf-form-label">Remote Username</label>
            <input
              type="text"
              className="cf-form-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={defaultUser ? `Default: ${defaultUser}` : "e.g. codermauro, root, ubuntu"}
              autoComplete="off"
              spellCheck="false"
            />
            <span className="cf-form-help">OpenSSH User directive</span>
          </div>

          <div className="cf-form-group" style={{ margin: 0 }}>
            <label className="cf-form-label">Private Key Path</label>
            <input
              type="text"
              className="cf-form-input"
              value={keyPath}
              onChange={(e) => setKeyPath(e.target.value)}
              placeholder={defaultKeyPath ? `Default: ${defaultKeyPath}` : "~/.ssh/id_ed25519"}
              autoComplete="off"
              spellCheck="false"
              style={{ fontFamily: "var(--font-mono)" }}
            />
            <span className="cf-form-help">OpenSSH IdentityFile directive (e.g. ~/.ssh/id_ed25519)</span>
          </div>
        </div>

        <div className="cf-ssh-editor-footer">
          {configured ? (
            <button type="button" className="btn-cf-danger small" disabled={saving} onClick={onRemove}>
              <TrashIcon size={12} />
              <span>Reset to defaults</span>
            </button>
          ) : (
            <span />
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn-cf-secondary small" disabled={saving} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-cf-primary small"
              disabled={saving || !canSave}
              onClick={() => onSave({ username, keyPath })}
            >
              <KeyIcon size={12} />
              <span>{saving ? "Saving…" : "Save identity"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
