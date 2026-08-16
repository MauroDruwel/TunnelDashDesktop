import { useCallback, useEffect, useState } from "react";
import { DEMO_MODE, sshDeleteCredential, sshGetCredential, type SshCredentialInfo } from "../api";
import { ConfigInfo, TunnelSummary } from "../types";

export type SshCreds = { username: string; password: string; useSaved: boolean };

export type TunnelsScreenProps = {
  accountLine: string;
  tunnels: TunnelSummary[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onToggle: (t: TunnelSummary, cfg: ConfigInfo) => Promise<void>;
  onSshConnect: (t: TunnelSummary, cfg: ConfigInfo, creds: SshCreds) => Promise<void>;
  onSshOpen: (t: TunnelSummary, cfg: ConfigInfo, creds: SshCreds) => Promise<string>;
  activeHosts: Set<string>;
  connecting: string | null;
};

export function TunnelsScreen({
  accountLine,
  tunnels,
  loading,
  error,
  onRefresh,
  onToggle,
  onSshConnect,
  onSshOpen,
  activeHosts,
  connecting,
}: TunnelsScreenProps) {
  const demoSshHost =
    DEMO_MODE && new URLSearchParams(window.location.search).has("ssh")
      ? "prod-db.corp.example.com"
      : null;

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
        {tunnels.map((t) => (
          <TunnelCard
            key={t.id}
            tunnel={t}
            demoSshHost={demoSshHost}
            activeHosts={activeHosts}
            connecting={connecting}
            onToggle={onToggle}
            onSshConnect={onSshConnect}
            onSshOpen={onSshOpen}
          />
        ))}
      </div>
    </div>
  );
}

function TunnelCard({
  tunnel,
  demoSshHost,
  activeHosts,
  connecting,
  onToggle,
  onSshConnect,
  onSshOpen,
}: {
  tunnel: TunnelSummary;
  demoSshHost: string | null;
  activeHosts: Set<string>;
  connecting: string | null;
  onToggle: (t: TunnelSummary, cfg: ConfigInfo) => Promise<void>;
  onSshConnect: TunnelsScreenProps["onSshConnect"];
  onSshOpen: TunnelsScreenProps["onSshOpen"];
}) {
  const configs = (tunnel.displayConfigs && tunnel.displayConfigs.length ? tunnel.displayConfigs : tunnel.configs) || [];
  const statusLabel = tunnel.status || "unknown";
  const statusClass = statusLabel.toLowerCase().includes("healthy") || statusLabel.toLowerCase().includes("online") ? "online" : "offline";

  return (
    <div className="tunnel-card">
      <div className="tunnel-row">
        <div>
          <div className="tunnel-name">{tunnel.name || tunnel.id}</div>
          {(tunnel.coloNames?.length || tunnel.connectionIp) && (
            <div className="tunnel-meta">
              {tunnel.coloNames?.length ? tunnel.coloNames.join(", ") : ""}
              {tunnel.coloNames?.length && tunnel.connectionIp ? " - " : ""}
              {tunnel.connectionIp ? tunnel.connectionIp : ""}
            </div>
          )}
          {tunnel.clientVersion && <div className="tunnel-meta">cloudflared {tunnel.clientVersion}</div>}
        </div>
        <div className={`badge ${statusClass}`}>{statusLabel}</div>
      </div>

      <div className="config-list">
        {configs.length ? (
          configs.map((cfg, idx) => (
            <ConfigRow
              key={`${tunnel.id}-cfg-${idx}`}
              tunnel={tunnel}
              cfg={cfg}
              autoSshOpen={demoSshHost !== null && (cfg.host === demoSshHost || cfg.hostname === demoSshHost)}
              activeHosts={activeHosts}
              connecting={connecting}
              onToggle={onToggle}
              onSshConnect={onSshConnect}
              onSshOpen={onSshOpen}
            />
          ))
        ) : (
          <div className="tunnel-meta">No configs</div>
        )}
      </div>
    </div>
  );
}

function ConfigRow({
  tunnel,
  cfg,
  autoSshOpen,
  activeHosts,
  connecting,
  onToggle,
  onSshConnect,
  onSshOpen,
}: {
  tunnel: TunnelSummary;
  cfg: ConfigInfo;
  autoSshOpen: boolean;
  activeHosts: Set<string>;
  connecting: string | null;
  onToggle: (t: TunnelSummary, cfg: ConfigInfo) => Promise<void>;
  onSshConnect: TunnelsScreenProps["onSshConnect"];
  onSshOpen: TunnelsScreenProps["onSshOpen"];
}) {
  const hostKey = cfg.host || tunnelHostKey({ ...tunnel, connectHost: undefined, connectService: cfg.service, service: cfg.service });
  const live = hostKey ? activeHosts.has(hostKey) : false;
  const localPort = cfg.port ?? tunnel.port ?? "n/a";
  const protoLabel = (cfg.proto || "").toUpperCase() || (cfg.service?.split(":")[0] || "").toUpperCase() || "CONFIG";
  const isSsh = (cfg.proto || cfg.service || "").toLowerCase().includes("ssh");

  return (
    <div className="config-row">
      <div className="config-info">
        <div className="pill-lite">{protoLabel}</div>
        {(cfg.host || localPort !== "n/a") && (
          <div className="tunnel-meta">
            {cfg.host ? `${cfg.host}${localPort !== "n/a" ? `:${localPort}` : ""}` : localPort !== "n/a" ? `Port ${localPort}` : ""}
          </div>
        )}
      </div>
      <div className="tunnel-actions inline">
        {isSsh && (
          <SshRuleForm
            host={hostKey}
            autoOpen={autoSshOpen}
            tunnel={tunnel}
            cfg={cfg}
            onSshConnect={onSshConnect}
            onSshOpen={onSshOpen}
          />
        )}
        <button
          className={`pill-btn ${live ? "on" : ""}`}
          disabled={Boolean(connecting)}
          onClick={() => onToggle(tunnel, cfg)}
        >
          {connecting === hostKey ? "Working..." : live ? "Disconnect" : "Connect"}
        </button>
      </div>
    </div>
  );
}

function SshRuleForm({
  host,
  autoOpen,
  tunnel,
  cfg,
  onSshConnect,
  onSshOpen,
}: {
  host: string;
  autoOpen: boolean;
  tunnel: TunnelSummary;
  cfg: ConfigInfo;
  onSshConnect: TunnelsScreenProps["onSshConnect"];
  onSshOpen: TunnelsScreenProps["onSshOpen"];
}) {
  const [open, setOpen] = useState(autoOpen);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [saved, setSaved] = useState<SshCredentialInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    sshGetCredential(host)
      .then((info) => {
        if (cancelled) return;
        setSaved(info);
        if (info.username) setUsername(info.username);
      })
      .catch(() => setSaved({ username: null, hasPassword: false }));
    return () => {
      cancelled = true;
    };
  }, [open, host]);

  const clearSaved = useCallback(async () => {
    setBusy(true);
    try {
      await sshDeleteCredential(host);
      setSaved({ username: null, hasPassword: false });
      setMessage("Saved credentials cleared");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not clear credentials");
    } finally {
      setBusy(false);
    }
  }, [host]);

  const run = useCallback(
    async (fn: (creds: SshCreds) => Promise<unknown>, doneMessage: string) => {
      setBusy(true);
      setMessage(null);
      try {
        await fn({ username: username.trim(), password, useSaved: !password.trim() });
        setPassword("");
        setMessage(doneMessage);
      } catch (err) {
        setMessage(err instanceof Error ? err.message : "SSH connect failed");
      } finally {
        setBusy(false);
      }
    },
    [username, password]
  );

  const canConnect = !busy && (Boolean(username.trim()) || Boolean(saved?.hasPassword));

  return (
    <div className="ssh-rule">
      {!open ? (
        <button className="pill-btn ssh-btn" onClick={() => setOpen(true)}>
          SSH
        </button>
      ) : (
        <div className="ssh-rule-panel">
          <div className="ssh-rule-fields">
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="username"
              autoComplete="off"
              disabled={busy}
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={saved?.hasPassword ? "password (saved)" : "password"}
              autoComplete="off"
              disabled={busy}
            />
          </div>
          <div className="ssh-rule-actions">
            <button
              className="pill-btn on"
              disabled={!canConnect}
              onClick={() =>
                void run(
                  (creds) => onSshConnect(tunnel, cfg, creds),
                  "Connected - session opened in the Terminal tab"
                )
              }
            >
              {busy ? "Working…" : "Connect here"}
            </button>
            <button
              className="pill-btn"
              disabled={!canConnect}
              onClick={() =>
                void run(
                  (creds) => onSshOpen(tunnel, cfg, creds).then(() => undefined),
                  "Opened in your native terminal"
                )
              }
            >
              Open in Terminal
            </button>
            {saved?.hasPassword && (
              <button className="ghost small" disabled={busy} onClick={() => void clearSaved()}>
                Clear
              </button>
            )}
            <button className="ghost small" disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
          {message && <div className="ssh-rule-msg">{message}</div>}
        </div>
      )}
    </div>
  );
}

function tunnelHostKey(t: TunnelSummary) {
  if (t.connectHost) return t.connectHost;
  const candidate = t.connectService || t.service || (t.services ? t.services[0] : undefined);
  if (candidate) {
    try {
      const url = candidate.includes("://") ? new URL(candidate) : new URL(`ssh://${candidate}`);
      return url.host;
    } catch {
      return candidate;
    }
  }
  return t.id;
}
