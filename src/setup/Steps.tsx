import { ChangeEvent, useState } from "react";
import { EyeIcon, EyeOffIcon } from "../components/icons";

export type SetupStep = "welcome" | "port" | "api";

export function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--text-main)" }}>
          Welcome to TunnelDash
        </h2>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
          Connect and proxy your Cloudflare Tunnels and SSH endpoints directly to local ports on this machine.
        </p>
      </div>

      <div
        style={{
          background: "var(--surface-secondary)",
          border: "1px solid var(--border)",
          borderRadius: 4,
          padding: 12,
          fontSize: 12.5,
          color: "var(--text-secondary)",
          display: "flex",
          flexDirection: "column",
          gap: 6,
        }}
      >
        <div>• Real-time tunnel status & edge datacenter monitoring</div>
        <div>• Local port binding & proxying to edge ingress routes</div>
        <div>• Integrated web SSH terminal with credential storage</div>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
        <button className="btn-cf-primary" onClick={onNext}>
          Get Started →
        </button>
      </div>
    </>
  );
}

export function PortStep({
  port,
  onChange,
  onBack,
  onNext,
  valid,
}: {
  port: string;
  onChange: (value: string) => void;
  onBack: () => void;
  onNext: () => void;
  valid: boolean;
}) {
  return (
    <>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--text-main)" }}>
          Local Port Allocation
        </h2>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
          Specify the starting port number for local tunnel bindings.
        </p>
      </div>

      <div className="cf-form-group">
        <label className="cf-form-label">Starting Port (Default: 50000)</label>
        <input
          type="number"
          className="cf-form-input"
          value={port}
          min={1024}
          max={65535}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
          style={{ fontFamily: "var(--font-mono)", maxWidth: 180 }}
        />
        {!valid && (
          <div className="cf-callout error" style={{ marginTop: 6 }}>
            Port must be between 1024 and 65535.
          </div>
        )}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
        <button className="btn-cf-secondary" onClick={onBack}>
          ← Back
        </button>
        <button className="btn-cf-primary" disabled={!valid} onClick={onNext}>
          Next: API Token →
        </button>
      </div>
    </>
  );
}

export function ApiStep({
  apiKey,
  onChange,
  onBack,
  onVerify,
  verifying,
  verified,
  error,
}: {
  apiKey: string;
  onChange: (value: string) => void;
  onBack: () => void;
  onVerify: () => void;
  verifying: boolean;
  verified: boolean;
  error: string | null;
}) {
  const [show, setShow] = useState(false);

  return (
    <>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--text-main)" }}>
          Authenticate API Token
        </h2>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
          Token requires <code style={{ fontFamily: "var(--font-mono)" }}>Account Settings: Read</code> and <code style={{ fontFamily: "var(--font-mono)" }}>Cloudflare Tunnel: Read</code>.
        </p>
      </div>

      <div className="cf-form-group">
        <label className="cf-form-label">API Token</label>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            type={show ? "text" : "password"}
            className="cf-form-input"
            style={{ flex: 1 }}
            value={apiKey}
            onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
            placeholder="Cloudflare API token"
            autoComplete="off"
            spellCheck="false"
          />
          <button
            type="button"
            className="btn-cf-secondary"
            onClick={() => setShow(!show)}
          >
            {show ? <EyeOffIcon size={14} /> : <EyeIcon size={14} />}
          </button>
        </div>
      </div>

      {error && <div className="cf-callout error">{error}</div>}
      {verified && <div className="cf-callout ok">Token verified successfully!</div>}

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
        <button className="btn-cf-secondary" onClick={onBack} disabled={verifying}>
          ← Back
        </button>
        <button
          className="btn-cf-primary"
          disabled={!apiKey.trim() || verifying}
          onClick={onVerify}
        >
          {verifying ? "Verifying…" : "Verify & Launch →"}
        </button>
      </div>
    </>
  );
}

export function DoneStep({ port, accountName, onReset }: { port: string; accountName?: string; onReset: () => void }) {
  return (
    <>
      <div>
        <h2 style={{ fontSize: 18, fontWeight: 600, color: "var(--text-main)" }}>Setup Complete</h2>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
          Connected to {accountName || "Account"}. Local ports start at {port}.
        </p>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
        <button className="btn-cf-secondary" onClick={onReset}>Redo Setup</button>
        <button className="btn-cf-primary">Open Dashboard →</button>
      </div>
    </>
  );
}
