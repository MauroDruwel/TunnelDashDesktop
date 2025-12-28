import { ChangeEvent } from "react";

export function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <>
      <p className="eyebrow">Step 1</p>
      <h1>Welcome</h1>
      <p className="muted">Store a start port and a Cloudflare token locally. You can redo this anytime.</p>
      <div className="actions">
        <button className="primary" onClick={onNext}>Continue →</button>
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
      <p className="eyebrow">Step 2</p>
      <h1>Port range</h1>
      <p className="muted">Default 50000. Must be between 1024 and 65535.</p>
      <label className="field">
        <span>Starting port</span>
        <input
          type="number"
          value={port}
          min={1024}
          max={65535}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        />
      </label>
      {!valid && <div className="callout error">Pick a valid port.</div>}
      <div className="actions">
        <button className="ghost" onClick={onBack}>← Back</button>
        <button className="primary" disabled={!valid} onClick={onNext}>Continue →</button>
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
  return (
    <>
      <p className="eyebrow">Step 3</p>
      <h1>Cloudflare token</h1>
      <p className="muted">Token needs Account Settings:Read and Cloudflare Tunnel:Read. We only call GET /accounts.</p>
      <label className="field">
        <span>API token</span>
        <input
          type="password"
          value={apiKey}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        />
      </label>
      {error && <div className="callout error">{error}</div>}
      {verified && <div className="callout ok">Token verified</div>}
      <div className="actions">
        <button className="ghost" onClick={onBack}>← Back</button>
        <button className="primary" disabled={!apiKey || verifying} onClick={onVerify}>
          {verifying ? "Verifying..." : "Verify →"}
        </button>
      </div>
    </>
  );
}

export function DoneStep({ port, accountName, onReset }: { port: string; accountName?: string; onReset: () => void }) {
  return (
    <>
      <p className="eyebrow">Done</p>
      <h1>Setup complete</h1>
      <p className="muted">Port start {port}. Account {accountName || "Unknown"}. Token stored locally.</p>
      <div className="actions">
        <button className="primary">Open TunnelDash →</button>
        <button className="ghost" onClick={onReset}>Redo setup</button>
      </div>
    </>
  );
}
