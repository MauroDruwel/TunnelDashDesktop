import { useMemo, useState } from "react";
import { useSetup, TunnelSummary, Settings } from "./useSetup";
import { SetupScreen } from "./Setup";
import "./App.css";

type Tab = "tunnels" | "settings";

function App() {
  const {
    settings,
    save,
    verified,
    verifying,
    verify,
    error,
    setError,
    clearAll,
    tunnels,
    tunnelsLoading,
    tunnelsError,
    loadTunnels,
    toggleTunnel,
    activeHosts,
    connecting,
    isPortValid,
  } = useSetup();

  const [tab, setTab] = useState<Tab>("tunnels");

  const statusLine = useMemo(() => {
    if (!verified) return "Token not verified";
    if (!settings.accountName) return "Account unknown";
    return `${settings.accountName}${settings.accountId ? ` · ${settings.accountId}` : ""}`;
  }, [verified, settings.accountName, settings.accountId]);

  if (!verified) {
    return (
      <div className="app-shell">
        <header className="app-top">
          <div className="brand">
            <span className="dot" />
            <div>
              <div className="brand-title">TunnelDash</div>
              <div className="brand-sub">Desktop companion</div>
            </div>
          </div>
          <div className="status-pill warn">Setup needed</div>
        </header>

        <SetupScreen
          settings={settings}
          save={save}
          verify={verify}
          verifying={verifying}
          verified={verified}
          error={error}
          setError={setError}
          isPortValid={isPortValid}
        />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-top">
        <div className="brand">
          <span className="dot" />
          <div>
            <div className="brand-title">TunnelDash</div>
            <div className="brand-sub">Desktop companion</div>
          </div>
        </div>
        <div className={`status-pill ${verified ? "ok" : "warn"}`}>{statusLine}</div>
      </header>

      <main className="card content">
        {tab === "tunnels" ? (
          <TunnelsScreen
            accountLine={statusLine}
            tunnels={tunnels}
            loading={tunnelsLoading}
            error={tunnelsError || error}
            onRefresh={loadTunnels}
            onToggle={toggleTunnel}
            activeHosts={activeHosts}
            connecting={connecting}
          />
        ) : (
          <SettingsScreen
            settings={settings}
            save={save}
            verify={verify}
            verifying={verifying}
            verified={verified}
            error={error}
            setError={setError}
            clearAll={() => clearAll().then(() => setTab("settings"))}
            isPortValid={isPortValid}
          />
        )}
      </main>

      <nav className="tabbar">
        <button className={`tab-btn ${tab === "tunnels" ? "active" : ""}`} onClick={() => setTab("tunnels")}>
          <span>☁️</span>
          <small>Tunnels</small>
        </button>
        <button className={`tab-btn ${tab === "settings" ? "active" : ""}`} onClick={() => setTab("settings")}>
          <span>⚙️</span>
          <small>Settings</small>
        </button>
      </nav>
    </div>
  );
}

function TunnelsScreen({
  accountLine,
  tunnels,
  loading,
  error,
  onRefresh,
  onToggle,
  activeHosts,
  connecting,
}: {
  accountLine: string;
  tunnels: TunnelSummary[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onToggle: (t: TunnelSummary) => Promise<void>;
  activeHosts: Set<string>;
  connecting: string | null;
}) {
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
        {tunnels.map((t) => {
          const hostKey = tunnelHostKey(t);
          const live = activeHosts.has(hostKey);
          return (
            <div key={t.id} className="tunnel-card">
              <div className="tunnel-row">
                <div>
                  <div className="tunnel-name">{t.name || t.id}</div>
                  <div className="tunnel-meta">{t.service || hostKey}</div>
                </div>
                <div className={`badge ${t.status?.toLowerCase().includes("online") ? "online" : "offline"}`}>
                  {t.status || "unknown"}
                </div>
              </div>

              <div className="tunnel-meta">Port {t.port ?? "n/a"}</div>
              <div className="tunnel-meta">Created {t.createdAt ? new Date(t.createdAt).toLocaleString() : "Unknown"}</div>

              <div className="tunnel-actions">
                <button
                  className={`pill-btn ${live ? "on" : ""}`}
                  disabled={Boolean(connecting)}
                  onClick={() => onToggle(t)}
                >
                  {connecting === hostKey ? "Working..." : live ? "Disconnect" : "Connect"}
                </button>
                <button className="ghost small" onClick={() => navigator.clipboard.writeText(t.service || hostKey)}>
                  Copy host
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SettingsScreen({
  settings,
  save,
  verify,
  verifying,
  verified,
  error,
  setError,
  clearAll,
  isPortValid,
}: {
  settings: Settings;
  save: (data: Partial<Settings & { verified?: boolean }>) => void;
  verify: () => Promise<void>;
  verifying: boolean;
  verified: boolean;
  error: string | null;
  setError: (v: string | null) => void;
  clearAll: () => Promise<void>;
  isPortValid: boolean;
}) {
  return (
    <div className="stack">
      <p className="eyebrow">Settings</p>
      <h1>Cloudflare token</h1>
      <p className="muted">Token needs Account Settings:Read and Cloudflare Tunnel:Read.</p>

      <label className="field">
        <span>API token</span>
        <input
          type="password"
          value={settings.apiKey}
          onChange={(e) => {
            setError(null);
            save({ apiKey: e.target.value, verified: false });
          }}
          placeholder="Enter Cloudflare token"
        />
      </label>

      <label className="field">
        <span>Account ID</span>
        <input
          type="text"
          value={settings.accountId || ""}
          placeholder="Will fill after verify"
          onChange={(e) => save({ accountId: e.target.value })}
        />
      </label>

      <div className="actions">
        <button className="primary" disabled={!settings.apiKey || verifying} onClick={verify}>
          {verifying ? "Verifying..." : verified ? "Verified" : "Verify token"}
        </button>
        <button className="ghost" onClick={() => save({})}>Save</button>
      </div>

      {error && <div className="callout error">{error}</div>}
      {verified && <div className="callout ok">Token verified</div>}

      <div className="section">
        <p className="eyebrow">Port range</p>
        <label className="field">
          <span>Port range start</span>
          <input
            type="number"
            value={settings.portStart}
            min={1024}
            max={65535}
            onChange={(e) => save({ portStart: e.target.value })}
          />
          {!isPortValid && <div className="callout error">Pick a port between 1024 and 65535.</div>}
        </label>
        <p className="muted">We map tunnels to local ports starting here.</p>
      </div>

      <div className="section">
        <p className="eyebrow">Display</p>
        <ToggleRow
          label="Hide HTTP/HTTPS protocols"
          checked={settings.hideHttp}
          onChange={(v) => save({ hideHttp: v })}
        />
        <ToggleRow
          label="Hide IP address info"
          checked={settings.hideIp}
          onChange={(v) => save({ hideIp: v })}
        />
        <ToggleRow
          label="Hide offline tunnels"
          checked={settings.hideOffline}
          onChange={(v) => save({ hideOffline: v })}
        />
      </div>

      <div className="section danger">
        <p className="eyebrow">Danger zone</p>
        <p className="muted">This clears stored token, account, and local data.</p>
        <button className="danger-btn" onClick={() => { void clearAll(); }}>Clear all data</button>
      </div>
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="toggle-row">
      <div>
        <div className="toggle-label">{label}</div>
      </div>
      <button className={`switch ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}>
        <span />
      </button>
    </div>
  );
}

function tunnelHostKey(t: TunnelSummary) {
  if (t.service) {
    try {
      const url = t.service.includes("://") ? new URL(t.service) : new URL(`ssh://${t.service}`);
      return url.host;
    } catch {
      return t.service;
    }
  }
  return t.id;
}

export default App;
