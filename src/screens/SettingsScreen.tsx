import { useState, useEffect, useCallback } from "react";
import { Settings, TunnelSummary } from "../types";
import {
  ShieldCheckIcon,
  EyeIcon,
  EyeOffIcon,
  TrashIcon,
  RefreshIcon,
  CopyIcon,
  CheckIcon,
  KeyIcon,
} from "../components/icons";
import {
  fetchAccounts,
  sshGetConfigStatus,
  sshPreviewConfig,
  sshSyncConfig,
  sshGetCredential,
  type SshHostConfig,
} from "../api";
import { collectSshServers } from "../utils/tunnelTransforms";
import { errMsg } from "../utils/errors";
import { SshPreviewModal } from "../components/SshPreviewModal";

export type SettingsScreenProps = {
  settings: Settings;
  save: (data: Partial<Settings & { verified?: boolean }>) => void;
  verify: () => Promise<void>;
  verifying: boolean;
  verified: boolean;
  error: string | null;
  setError: (v: string | null) => void;
  clearAll: () => Promise<void>;
  isPortValid: boolean;
  cloudflaredVersion: string | null;
  /** Unfiltered tunnels — used to pick candidate hosts for credential export. */
  allTunnels: TunnelSummary[];
};

export function SettingsScreen({
  settings,
  save,
  verify,
  verifying,
  verified,
  error,
  setError,
  clearAll,
  isPortValid,
  cloudflaredVersion,
  allTunnels,
}: SettingsScreenProps) {
  // ─── Token Protection & Safe Update State ───
  const [isUpdatingToken, setIsUpdatingToken] = useState(false);
  const [newTokenInput, setNewTokenInput] = useState("");
  const [showActiveToken, setShowActiveToken] = useState(false);
  const [showNewToken, setShowNewToken] = useState(false);
  const [testingNewToken, setTestingNewToken] = useState(false);
  const [tokenUpdateError, setTokenUpdateError] = useState<string | null>(null);
  const [tokenUpdateSuccess, setTokenUpdateSuccess] = useState<string | null>(null);
  const [testConnectionSuccess, setTestConnectionSuccess] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);

  const [copiedAccount, setCopiedAccount] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [launchAtLogin, setLaunchAtLogin] = useState<boolean | null>(null);

  // ─── OpenSSH Config Integration state ───
  const [sshConfigPath, setSshConfigPath] = useState<string>("");
  const [syncingSsh, setSyncingSsh] = useState(false);
  const [sshSyncSuccess, setSshSyncSuccess] = useState<string | null>(null);
  const [sshSyncErr, setSshSyncErr] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewContent, setPreviewContent] = useState("");

  // Read the current login-item state once (Tauri only).
  useEffect(() => {
    if (typeof (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ === "undefined") {
      return;
    }
    void import("@tauri-apps/plugin-autostart")
      .then((m) => m.isEnabled())
      .then(setLaunchAtLogin)
      .catch(() => setLaunchAtLogin(false));
  }, []);

  // Fetch OpenSSH config path & status
  useEffect(() => {
    void sshGetConfigStatus()
      .then((st) => setSshConfigPath(st.configPath))
      .catch((e) => console.warn("could not read ssh config status", e));
  }, []);

  const toggleLaunchAtLogin = async () => {
    const next = !(launchAtLogin ?? false);
    try {
      const m = await import("@tauri-apps/plugin-autostart");
      if (next) {
        await m.enable();
      } else {
        await m.disable();
      }
      setLaunchAtLogin(await m.isEnabled());
    } catch (e) {
      console.warn("autostart toggle failed", e);
    }
  };

  const handleManualSync = useCallback(async () => {
    setSyncingSsh(true);
    setSshSyncSuccess(null);
    setSshSyncErr(null);
    try {
      const servers = collectSshServers(allTunnels);
      const defaultUser = settings.defaultSshUser?.trim() || undefined;
      const defaultKey = settings.defaultSshKeyPath?.trim() || undefined;

      const hosts: SshHostConfig[] = await Promise.all(
        servers.map(async (s) => {
          const cred = await sshGetCredential(s.host).catch(() => null);
          return {
            host: s.host,
            alias: s.alias,
            hostname: s.hostname,
            username: cred?.username || defaultUser,
            keyPath: cred?.keyPath || defaultKey,
          };
        })
      );

      const status = await sshSyncConfig(hosts);
      setSshConfigPath(status.configPath);
      setSshSyncSuccess(
        `OpenSSH configuration synchronized (${status.managedHosts.length} host entry/entries updated).`
      );
      window.setTimeout(() => setSshSyncSuccess(null), 4000);
    } catch (e) {
      setSshSyncErr(errMsg(e, "SSH config sync failed"));
    } finally {
      setSyncingSsh(false);
    }
  }, [allTunnels, settings.defaultSshUser, settings.defaultSshKeyPath]);

  const handlePreviewSshConfig = useCallback(async () => {
    setSshSyncErr(null);
    try {
      const servers = collectSshServers(allTunnels);
      const defaultUser = settings.defaultSshUser?.trim() || undefined;
      const defaultKey = settings.defaultSshKeyPath?.trim() || undefined;

      const hosts: SshHostConfig[] = await Promise.all(
        servers.map(async (s) => {
          const cred = await sshGetCredential(s.host).catch(() => null);
          return {
            host: s.host,
            alias: s.alias,
            hostname: s.hostname,
            username: cred?.username || defaultUser,
            keyPath: cred?.keyPath || defaultKey,
          };
        })
      );

      const preview = await sshPreviewConfig(hosts);
      setPreviewContent(preview);
      setPreviewOpen(true);
    } catch (e) {
      setSshSyncErr(errMsg(e, "Could not generate SSH config preview"));
    }
  }, [allTunnels, settings.defaultSshUser, settings.defaultSshKeyPath]);

  const handleClearAll = async () => {
    setClearing(true);
    setConfirming(false);
    try {
      await clearAll();
    } finally {
      setClearing(false);
    }
  };

  const handleTestCurrentToken = async () => {
    setTestConnectionSuccess(null);
    setError(null);
    try {
      await verify();
      setTestConnectionSuccess("Connection verified: Cloudflare API responded 200 OK.");
      window.setTimeout(() => setTestConnectionSuccess(null), 4000);
    } catch (e) {
      setError(errMsg(e, "Connection test failed"));
    }
  };

  const handleApplyNewToken = async () => {
    const candidate = newTokenInput.trim();
    if (!candidate) return;

    setTestingNewToken(true);
    setTokenUpdateError(null);
    setTokenUpdateSuccess(null);

    try {
      const accounts = await fetchAccounts(candidate);
      if (!accounts || accounts.length === 0) {
        throw new Error(
          "No Cloudflare accounts accessible with this token. Check that the token includes 'Account Settings: Read' and 'Cloudflare Tunnel: Read' permissions."
        );
      }
      const account = accounts[0];
      save({
        apiKey: candidate,
        accountId: account.id,
        accountName: account.name,
        verified: true,
      });
      setIsUpdatingToken(false);
      setNewTokenInput("");
      setTokenUpdateSuccess(`Token validated and updated for account "${account.name}".`);
      window.setTimeout(() => setTokenUpdateSuccess(null), 5000);
    } catch (err) {
      setTokenUpdateError(errMsg(err, "Failed to authenticate candidate token with Cloudflare API"));
    } finally {
      setTestingNewToken(false);
    }
  };

  const portNum = Number(settings.portStart) || 50000;

  return (
    <>
      {/* ─── Cloudflare Page Header ─── */}
      <div className="cf-page-header">
        <div>
          <div className="cf-breadcrumbs">
            <span>Zero Trust</span>
            <span>/</span>
            <span className="current">Settings</span>
          </div>
          <h1 className="cf-title">Settings &amp; Access</h1>
          <div className="cf-subtitle">
            Configure your Cloudflare API token, local port allocation defaults, OpenSSH client integration, and UI preferences.
          </div>
        </div>
      </div>

      {error && <div className="cf-callout error">{error}</div>}
      {verified && !error && (
        <div className="cf-callout ok">
          <ShieldCheckIcon size={16} />
          <span>API Token active and authenticated for account <b>{settings.accountName || "Cloudflare Account"}</b> ({settings.accountId}).</span>
        </div>
      )}

      {/* ─── Card 1: API Authentication ─── */}
      <div className="cf-card">
        <div className="cf-card-header">
          <div className="cf-card-title">Cloudflare API Token Authentication</div>
          <div className="cf-card-desc">
            Your token requires <code style={{ fontFamily: "var(--font-mono)" }}>Account Settings: Read</code> and <code style={{ fontFamily: "var(--font-mono)" }}>Cloudflare Tunnel: Read</code> permissions.
          </div>
        </div>

        <div className="cf-card-body">
          {tokenUpdateSuccess && (
            <div className="cf-callout ok" style={{ marginBottom: 16 }}>
              <ShieldCheckIcon size={16} />
              <span>{tokenUpdateSuccess}</span>
            </div>
          )}

          {testConnectionSuccess && (
            <div className="cf-callout ok" style={{ marginBottom: 16 }}>
              <ShieldCheckIcon size={16} />
              <span>{testConnectionSuccess}</span>
            </div>
          )}

          {tokenUpdateError && (
            <div className="cf-callout error" style={{ marginBottom: 16 }}>
              <span>{tokenUpdateError}</span>
            </div>
          )}

          {verified && settings.apiKey && !isUpdatingToken ? (
            /* Protected Active Token View */
            <>
              <div className="cf-form-group">
                <label className="cf-form-label">Active API Token</label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type={showActiveToken ? "text" : "password"}
                    className="cf-form-input"
                    style={{ flex: 1, fontFamily: "var(--font-mono)", cursor: "default" }}
                    value={settings.apiKey}
                    readOnly
                    onFocus={(e) => e.target.select()}
                  />
                  <button
                    type="button"
                    className="btn-cf-secondary"
                    onClick={() => setShowActiveToken(!showActiveToken)}
                    title={showActiveToken ? "Mask token" : "Reveal token"}
                  >
                    {showActiveToken ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />}
                  </button>
                  <button
                    type="button"
                    className="btn-cf-secondary"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(settings.apiKey);
                        setCopiedToken(true);
                        setTimeout(() => setCopiedToken(false), 2000);
                      } catch (e) {
                        console.warn("Failed to copy token", e);
                      }
                    }}
                    title="Copy token to clipboard"
                  >
                    {copiedToken ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                    <span>{copiedToken ? "Copied" : "Copy"}</span>
                  </button>
                </div>
                <span className="cf-form-help">
                  Active token is protected from accidental edits. Click &ldquo;Change Token&rdquo; below to rotate or update.
                </span>
              </div>

              <div className="cf-form-group">
                <label className="cf-form-label">Account ID</label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type="text"
                    className="cf-form-input"
                    value={settings.accountId || ""}
                    placeholder="Will populate automatically upon token verification"
                    readOnly
                    onFocus={(e) => e.target.select()}
                    style={{ fontFamily: "var(--font-mono)", flex: 1, opacity: 0.85, cursor: "default" }}
                  />
                  {settings.accountId && (
                    <button
                      type="button"
                      className="btn-cf-secondary"
                      onClick={async () => {
                        if (!settings.accountId) return;
                        try {
                          await navigator.clipboard.writeText(settings.accountId);
                          setCopiedAccount(true);
                          setTimeout(() => setCopiedAccount(false), 2000);
                        } catch (e) {
                          console.warn("Failed to copy Account ID", e);
                        }
                      }}
                      title="Copy Account ID to clipboard"
                    >
                      {copiedAccount ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
                      <span>{copiedAccount ? "Copied" : "Copy"}</span>
                    </button>
                  )}
                </div>
                <span className="cf-form-help">
                  Authenticated for <b>{settings.accountName || "Account"}</b> (ID: {settings.accountId}).
                </span>
              </div>
            </>
          ) : (
            /* Update / Initial Input View */
            <>
              <div className="cf-form-group">
                <label className="cf-form-label">
                  {isUpdatingToken ? "New API Token" : "Cloudflare API Token"}
                </label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type={showNewToken ? "text" : "password"}
                    className="cf-form-input"
                    style={{ flex: 1, fontFamily: "var(--font-mono)" }}
                    value={newTokenInput}
                    onChange={(e) => {
                      setTokenUpdateError(null);
                      setNewTokenInput(e.target.value);
                    }}
                    placeholder="Paste Cloudflare API token..."
                    autoComplete="off"
                    spellCheck="false"
                    autoFocus
                  />
                  <button
                    type="button"
                    className="btn-cf-secondary"
                    onClick={() => setShowNewToken(!showNewToken)}
                    title={showNewToken ? "Hide token" : "Show token"}
                  >
                    {showNewToken ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />}
                  </button>
                  <button
                    type="button"
                    className="btn-cf-secondary"
                    onClick={async () => {
                      try {
                        const clip = await navigator.clipboard.readText();
                        if (clip) {
                          setNewTokenInput(clip.trim());
                          setTokenUpdateError(null);
                        }
                      } catch (e) {
                        console.warn("Clipboard paste failed", e);
                      }
                    }}
                    title="Paste from clipboard"
                  >
                    Paste
                  </button>
                </div>
                <span className="cf-form-help">
                  TunnelDash will test this token against the Cloudflare API before applying.
                  {isUpdatingToken && " Your active token remains safe and unchanged if verification fails."}
                </span>
              </div>
            </>
          )}
        </div>

        <div className="cf-card-footer">
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {verified && !isUpdatingToken ? (
              <span style={{ color: "var(--color-success)", display: "inline-flex", alignItems: "center", gap: 6 }}>
                <ShieldCheckIcon size={14} /> Authenticated
              </span>
            ) : isUpdatingToken ? (
              "Updating token — current token still active"
            ) : (
              "Status: Not verified"
            )}
          </span>

          <div style={{ display: "flex", gap: 8 }}>
            {verified && settings.apiKey && !isUpdatingToken ? (
              <>
                <button
                  type="button"
                  className="btn-cf-secondary"
                  disabled={verifying}
                  onClick={handleTestCurrentToken}
                  title="Verify active token against Cloudflare API"
                >
                  <RefreshIcon size={13} className={verifying ? "spin" : ""} />
                  <span>{verifying ? "Testing…" : "Test Connection"}</span>
                </button>
                <button
                  type="button"
                  className="btn-cf-primary"
                  onClick={() => {
                    setIsUpdatingToken(true);
                    setNewTokenInput("");
                    setTokenUpdateError(null);
                  }}
                >
                  <KeyIcon size={13} />
                  <span>Change Token</span>
                </button>
              </>
            ) : (
              <>
                {isUpdatingToken && settings.apiKey && (
                  <button
                    type="button"
                    className="btn-cf-secondary"
                    disabled={testingNewToken}
                    onClick={() => {
                      setIsUpdatingToken(false);
                      setNewTokenInput("");
                      setTokenUpdateError(null);
                    }}
                  >
                    Cancel
                  </button>
                )}
                <button
                  type="button"
                  className="btn-cf-primary"
                  disabled={!newTokenInput.trim() || testingNewToken}
                  onClick={handleApplyNewToken}
                >
                  {testingNewToken ? "Verifying Token…" : "Test & Save Token"}
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ─── Card 2: Local Network Binding ─── */}
      <div className="cf-card">
        <div className="cf-card-header">
          <div className="cf-card-title">Local Port Allocation Range</div>
          <div className="cf-card-desc">
            TunnelDash assigns sequential <b>local</b> ports starting from this number for each ingress route, then saves them to the tunnel's <code style={{ fontFamily: "var(--font-mono)" }}>tunneldashPort</code> metadata on Cloudflare (requires <b>Cloudflare Tunnel: Edit</b>). With a read-only token, ports still work in-session but won't persist between devices.
          </div>
        </div>

        <div className="cf-card-body">
          <div className="cf-form-group">
            <label className="cf-form-label">Starting Local Port (Default: 50000)</label>
            <input
              type="number"
              className="cf-form-input"
              value={settings.portStart}
              min={1024}
              max={65535}
              onChange={(e) => save({ portStart: e.target.value })}
              style={{ fontFamily: "var(--font-mono)", maxWidth: 200 }}
            />
            {!isPortValid && (
              <span style={{ color: "var(--cf-red)", fontSize: 12 }}>
                Please specify a valid port number between 1024 and 65535.
              </span>
            )}
            <span className="cf-form-help">
              Routes bind as <code style={{ fontFamily: "var(--font-mono)" }}>localhost:{portNum}</code>, <code style={{ fontFamily: "var(--font-mono)" }}>localhost:{portNum + 1}</code>, … — one unique port per ingress rule. Changing this reloads the list.
            </span>
          </div>
        </div>

        <div className="cf-card-footer">
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Port range validity: {isPortValid ? "Valid" : "Invalid"}</span>
          <button className="btn-cf-secondary" onClick={() => save({})}>
            Save
          </button>
        </div>
      </div>

      {/* ─── Card 3: App Startup ─── */}
      <div className="cf-card">
        <div className="cf-card-header">
          <div className="cf-card-title">Startup</div>
          <div className="cf-card-desc">
            Control how TunnelDash behaves when you log in to your computer.
          </div>
        </div>

        <div className="cf-card-body" style={{ padding: "0 18px" }}>
          <div className="cf-switch-row">
            <div>
              <div className="cf-form-label">Launch at login</div>
              <div className="cf-form-help">
                Start TunnelDash automatically when you sign in — the menu bar icon keeps your proxy status one click away.
              </div>
            </div>
            <button
              type="button"
              className={`cf-switch ${launchAtLogin ? "on" : ""}`}
              disabled={launchAtLogin === null}
              onClick={() => void toggleLaunchAtLogin()}
            >
              <span />
            </button>
          </div>
        </div>
      </div>

      {/* ─── Card 4: OpenSSH Client Integration ─── */}
      <div className="cf-card">
        <div className="cf-card-header">
          <div className="cf-card-title">OpenSSH Client Configuration</div>
          <div className="cf-card-desc">
            TunnelDash automatically generates clean, isolated host entries within delimited markers in your system OpenSSH configuration. Works natively on <b>macOS</b> and <b>Linux</b> (<code style={{ fontFamily: "var(--font-mono)" }}>~/.ssh/config</code>) and <b>Windows 10/11</b> (<code style={{ fontFamily: "var(--font-mono)" }}>%USERPROFILE%\.ssh\config</code>).
          </div>
        </div>

        <div className="cf-card-body">
          <div className="cf-switch-row" style={{ padding: "0 0 14px 0" }}>
            <div>
              <div className="cf-form-label">Auto-sync tunnels to OpenSSH config</div>
              <div className="cf-form-help">
                Automatically keep your system SSH config synchronized with active tunnel hosts and aliases. Any manual configurations outside the markers are strictly preserved.
              </div>
            </div>
            <button
              type="button"
              className={`cf-switch ${settings.autoSyncSshConfig !== false ? "on" : ""}`}
              onClick={() =>
                save({ autoSyncSshConfig: settings.autoSyncSshConfig === false ? true : false })
              }
              title="Toggle automatic OpenSSH config sync"
            >
              <span />
            </button>
          </div>

          <div className="cf-form-group">
            <label className="cf-form-label">Default SSH Username (Optional)</label>
            <input
              type="text"
              className="cf-form-input"
              style={{ maxWidth: 320 }}
              value={settings.defaultSshUser ?? ""}
              onChange={(e) => save({ defaultSshUser: e.target.value })}
              placeholder="e.g. codermauro, root, ubuntu"
              autoComplete="off"
              spellCheck="false"
            />
            <span className="cf-form-help">
              Fallback username written to <code style={{ fontFamily: "var(--font-mono)" }}>User &lt;name&gt;</code> in your SSH config for endpoints that don't have a specific user configured.
            </span>
          </div>

          <div className="cf-form-group">
            <label className="cf-form-label">Default SSH Private Key (Optional)</label>
            <input
              type="text"
              className="cf-form-input"
              style={{ maxWidth: 360, fontFamily: "var(--font-mono)" }}
              value={settings.defaultSshKeyPath ?? ""}
              onChange={(e) => save({ defaultSshKeyPath: e.target.value })}
              placeholder="~/.ssh/id_ed25519"
              autoComplete="off"
              spellCheck="false"
            />
            <span className="cf-form-help">
              Default private key written to <code style={{ fontFamily: "var(--font-mono)" }}>IdentityFile &lt;path&gt;</code> for seamless, passwordless Zero Trust SSH connections.
            </span>
          </div>

          {sshSyncSuccess && <div className="cf-callout ok">{sshSyncSuccess}</div>}
          {sshSyncErr && <div className="cf-callout error">{sshSyncErr}</div>}
        </div>

        <div className="cf-card-footer">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="cf-vault-badge active">
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  backgroundColor: "var(--cf-green-5)",
                  display: "inline-block",
                }}
              />
              <span>Config: {sshConfigPath || "~/.ssh/config"}</span>
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              className="btn-cf-secondary small"
              onClick={() => void handlePreviewSshConfig()}
              title="Preview generated OpenSSH config entries"
            >
              <EyeIcon size={12} />
              <span>Preview config</span>
            </button>
            <button
              type="button"
              className="btn-cf-primary small"
              disabled={syncingSsh}
              onClick={() => void handleManualSync()}
              title="Immediately write managed block to OpenSSH config"
            >
              <RefreshIcon size={12} />
              <span>{syncingSsh ? "Syncing…" : "Sync now"}</span>
            </button>
          </div>
        </div>
      </div>

      {/* ─── Card 5: Display Preferences & Protocol Filters ─── */}
      <div className="cf-card">
        <div className="cf-card-header">
          <div className="cf-card-title">Display Preferences &amp; Protocol Filters</div>
          <div className="cf-card-desc">
            Filter out specific protocol types and edge metadata from the dashboard list.
          </div>
        </div>

        <div className="cf-card-body" style={{ padding: "0 18px" }}>
          <div className="cf-switch-row">
            <div>
              <div className="cf-form-label">Hide HTTP/HTTPS Endpoints</div>
              <div className="cf-form-help">Only show non-HTTP services (SSH, TCP, UDP, RDP) in the main tunnel list</div>
            </div>
            <button
              type="button"
              className={`cf-switch ${settings.hideHttp ? "on" : ""}`}
              onClick={() => save({ hideHttp: !settings.hideHttp })}
            >
              <span />
            </button>
          </div>

          <div className="cf-switch-row">
            <div>
              <div className="cf-form-label">Hide IP &amp; Edge Colocation Metadata</div>
              <div className="cf-form-help">Hide origin IP addresses and datacenter codes from table rows</div>
            </div>
            <button
              type="button"
              className={`cf-switch ${settings.hideIp ? "on" : ""}`}
              onClick={() => save({ hideIp: !settings.hideIp })}
            >
              <span />
            </button>
          </div>

          <div className="cf-switch-row">
            <div>
              <div className="cf-form-label">Hide Offline / Inactive Tunnels</div>
              <div className="cf-form-help">Only display tunnels with healthy active connections</div>
            </div>
            <button
              type="button"
              className={`cf-switch ${settings.hideOffline ? "on" : ""}`}
              onClick={() => save({ hideOffline: !settings.hideOffline })}
            >
              <span />
            </button>
          </div>

          <div className="cf-switch-row" style={{ flexWrap: "wrap", gap: 8 }}>
            <div>
              <div className="cf-form-label">Tunnel description shows</div>
              <div className="cf-form-help">What appears under each tunnel name in the list</div>
            </div>
            <select
              className="cf-form-input"
              style={{ width: "auto", minWidth: 160, cursor: "pointer" }}
              value={settings.tunnelDescription ?? "id"}
              onChange={(e) =>
                save({ tunnelDescription: e.target.value as "id" | "ip" | "none" })
              }
            >
              <option value="id">Tunnel ID</option>
              <option value="ip">Origin IP</option>
              <option value="none">Blank</option>
            </select>
          </div>
        </div>

        <div className="cf-card-footer">
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Daemon: {cloudflaredVersion ? (cloudflaredVersion.startsWith("cloudflared ") ? cloudflaredVersion : `cloudflared ${cloudflaredVersion}`) : "Not detected in system PATH"}
          </span>
          <button className="btn-cf-secondary" onClick={() => save({})}>
            Save
          </button>
        </div>
      </div>

      {/* ─── Card 6: Danger Zone ─── */}
      <div className="cf-card" style={{ borderColor: "var(--cf-red-border)" }}>
        <div className="cf-card-header">
          <div className="cf-card-title" style={{ color: "var(--cf-red)" }}>Clear Stored Application Data</div>
          <div className="cf-card-desc">
            Disconnects all active local tunnel proxies and clears your stored API token and account settings.
          </div>
        </div>

        <div className="cf-card-footer">
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>This action cannot be undone.</span>
          <button
            className="btn-cf-danger"
            onClick={() => {
              if (confirming) {
                void handleClearAll();
              } else {
                setConfirming(true);
                window.setTimeout(() => setConfirming(false), 4000);
              }
            }}
            disabled={clearing}
          >
            <TrashIcon size={13} />
            <span>
              {clearing
                ? "Clearing Data…"
                : confirming
                  ? "Click again to confirm"
                  : "Clear Stored Data"}
            </span>
          </button>
        </div>
      </div>

      {/* ─── Preview Modal ─── */}
      {previewOpen && (
        <SshPreviewModal
          configPath={sshConfigPath || "~/.ssh/config"}
          content={previewContent}
          onClose={() => setPreviewOpen(false)}
        />
      )}
    </>
  );
}
