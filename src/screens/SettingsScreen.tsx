import { useState } from "react";
import { Settings } from "../types";
import {
  ShieldCheckIcon,
  EyeIcon,
  EyeOffIcon,
  TrashIcon,
} from "../components/icons";

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
}: SettingsScreenProps) {
  const [showToken, setShowToken] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const handleClearAll = async () => {
    setClearing(true);
    setConfirming(false);
    try {
      await clearAll();
    } finally {
      setClearing(false);
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
          <h1 className="cf-title">Settings & Access</h1>
          <div className="cf-subtitle">
            Configure your Cloudflare API token, local port forwarding defaults, and UI preferences.
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
          <div className="cf-form-group">
            <label className="cf-form-label">API Token</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type={showToken ? "text" : "password"}
                className="cf-form-input"
                style={{ flex: 1 }}
                value={settings.apiKey}
                onChange={(e) => {
                  setError(null);
                  save({ apiKey: e.target.value, verified: false });
                }}
                placeholder="Paste your Cloudflare API token..."
                autoComplete="off"
                spellCheck="false"
              />
              <button
                type="button"
                className="btn-cf-secondary"
                onClick={() => setShowToken(!showToken)}
                title={showToken ? "Hide token" : "Show token"}
              >
                {showToken ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />}
              </button>
            </div>
          </div>

          <div className="cf-form-group">
            <label className="cf-form-label">Account ID</label>
            <input
              type="text"
              className="cf-form-input"
              value={settings.accountId || ""}
              placeholder="Will populate automatically upon token verification"
              readOnly
              onFocus={(e) => e.target.select()}
              style={{ fontFamily: "var(--font-mono)", opacity: 0.8, cursor: "default" }}
            />
            <span className="cf-form-help">Read-only — automatically retrieved from GET /accounts when you verify the token.</span>
          </div>
        </div>

        <div className="cf-card-footer">
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            {verified ? "Status: Authenticated" : "Status: Not verified"}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn-cf-primary"
              disabled={!settings.apiKey.trim() || verifying}
              onClick={verify}
            >
              {verifying ? "Verifying Token…" : verified ? "Re-verify Token" : "Verify Token"}
            </button>
            <button className="btn-cf-secondary" onClick={() => save({})}>
              Save
            </button>
          </div>
        </div>
      </div>

      {/* ─── Card 2: Local Network Binding ─── */}
      <div className="cf-card">
        <div className="cf-card-header">
          <div className="cf-card-title">Local Port Allocation Range</div>
          <div className="cf-card-desc">
            TunnelDash assigns sequential local ports starting from this number for active tunnel proxies.
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
              Active tunnels bind locally starting at <code style={{ fontFamily: "var(--font-mono)" }}>localhost:{portNum}</code>, incrementing by one for each tunnel.
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

      {/* ─── Card 3: Display Filters ─── */}
      <div className="cf-card">
        <div className="cf-card-header">
          <div className="cf-card-title">Display Preferences & Protocol Filters</div>
          <div className="cf-card-desc">
            Filter out specific protocol types and edge metadata from the dashboard list.
          </div>
        </div>

        <div className="cf-card-body" style={{ padding: "0 18px" }}>
          <div className="cf-switch-row">
            <div>
              <div className="cf-form-label">Hide HTTP / HTTPS Ingress Rules</div>
              <div className="cf-form-help">Only show SSH and TCP endpoints in the tunnels table</div>
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
              <div className="cf-form-label">Hide IP & Edge Colocation Metadata</div>
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
            Daemon: {cloudflaredVersion || "Not detected in system PATH"}
          </span>
        </div>
      </div>

      {/* ─── Card 4: Danger Zone ─── */}
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
    </>
  );
}
