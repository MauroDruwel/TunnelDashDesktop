import { TunnelSummary } from "./types";

export function MainView({
  accountName,
  accountId,
  tunnels,
  loading,
  error,
  onRefresh,
  onReset,
}: {
  accountName?: string;
  accountId?: string;
  tunnels: TunnelSummary[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onReset: () => void;
}) {
  return (
    <>
      <p className="eyebrow">Tunnels</p>
      <h1>Cloudflare tunnels</h1>
      <p className="muted">{accountName || "Unknown account"}{accountId ? ` · ${accountId}` : ""}</p>

      <div className="actions">
        <button className="primary" onClick={onRefresh} disabled={loading}>{loading ? "Loading..." : "Refresh"}</button>
        <button className="ghost" onClick={onReset}>Redo setup</button>
      </div>

      {error && <div className="callout error">{error}</div>}
      {loading && !tunnels.length && <div className="callout">Loading tunnels...</div>}
      {!loading && !error && !tunnels.length && <div className="callout">No tunnels found.</div>}

      <div className="tunnel-list">
        {tunnels.map((t) => (
          <div key={t.id} className="tunnel-card">
            <div className="tunnel-row">
              <div>
                <div className="tunnel-name">{t.name || t.id}</div>
                <div className="tunnel-meta">{t.service || (t.services && t.services[0]) || t.id}</div>
              </div>
              {t.status && <span className="pill-lite">{t.status}</span>}
            </div>
            <div className="tunnel-meta">Created {t.createdAt ? new Date(t.createdAt).toLocaleString() : "Unknown"}</div>
            <div className="tunnel-meta">Port {t.port ?? "n/a"} · Service {t.service || (t.services && t.services[0]) || "n/a"}</div>
          </div>
        ))}
      </div>
    </>
  );
}
