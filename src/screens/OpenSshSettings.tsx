import { useState, useEffect, useCallback } from "react";
import { EyeIcon, RefreshIcon } from "../components/icons";
import { SshPreviewModal } from "../components/SshPreviewModal";
import type { Settings, TunnelSummary } from "../types";
import {
  sshGetConfigStatus,
  sshPreviewConfig,
  sshSyncConfig,
  sshGetCredential,
  type SshHostConfig,
} from "../api";
import { collectSshServers } from "../utils/tunnelTransforms";
import { errMsg } from "../utils/errors";

export function OpenSshSettings({ settings, save, allTunnels }: {
  settings: Settings;
  save: (patch: Partial<Settings>) => void;
  allTunnels: TunnelSummary[];
}) {
  // ─── OpenSSH Config Integration state ───
  const [sshConfigPath, setSshConfigPath] = useState<string>("");
  const [syncingSsh, setSyncingSsh] = useState(false);
  const [sshSyncSuccess, setSshSyncSuccess] = useState<string | null>(null);
  const [sshSyncErr, setSshSyncErr] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewContent, setPreviewContent] = useState("");

  // Fetch OpenSSH config path & status
  useEffect(() => {
    void sshGetConfigStatus()
      .then((st) => setSshConfigPath(st.configPath))
      .catch((e) => console.warn("could not read ssh config status", e));
  }, []);

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

  return (
    <>
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
