import { Settings } from "../types";

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
        <p className="muted">Cloudflared version: {cloudflaredVersion || "Not detected yet"}</p>
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
