import { TerminalIcon } from "../components/icons";
import { TerminalView } from "./TerminalView";
import type { SshSession } from "../ssh/sessions";

export function TerminalScreen({
  sessions,
  activeId,
  onSelect,
  onClose,
}: {
  sessions: SshSession[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onClose: (id: number) => void;
}) {
  const activeSession = sessions.find((s) => s.id === activeId);

  if (!sessions.length) {
    return (
      <>
        <div className="cf-page-header">
          <div>
            <div className="cf-breadcrumbs">
              <span>Zero Trust</span>
              <span>/</span>
              <span className="current">SSH Terminal</span>
            </div>
            <h1 className="cf-title">SSH Terminal Console</h1>
            <div className="cf-subtitle">
              Secure interactive shell access to remote servers over Cloudflare Tunnels.
            </div>
          </div>
        </div>

        <div className="cf-card" style={{ padding: 36, textAlign: "center" }}>
          <div style={{ color: "var(--text-muted)", display: "flex", justifyContent: "center", marginBottom: 10 }}>
            <TerminalIcon size={32} />
          </div>
          <div style={{ fontWeight: 600, fontSize: 15, color: "var(--text-main)" }}>No Active SSH Sessions</div>
          <p style={{ color: "var(--text-muted)", fontSize: 13, maxWidth: 440, margin: "6px auto 0" }}>
            To open an encrypted SSH session, go to the <b>Tunnels</b> tab, click the <b>SSH</b> button on any tunnel route, and select <b>Connect in Web Shell</b>.
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="cf-page-header">
        <div>
          <div className="cf-breadcrumbs">
            <span>Zero Trust</span>
            <span>/</span>
            <span className="current">SSH Terminal</span>
          </div>
          <h1 className="cf-title">SSH Terminal Console</h1>
        </div>
      </div>

      <div className="cf-terminal-card">
        {/* Terminal Tabs Header */}
        <div className="cf-terminal-header">
          <div className="cf-terminal-tabs">
            {sessions.map((s) => {
              const isActive = s.id === activeId;
              return (
                <button
                  key={s.id}
                  className={`cf-terminal-tab ${isActive ? "active" : ""} ${s.status}`}
                  onClick={() => onSelect(s.id)}
                  title={s.error ?? s.label}
                >
                  <span className="cf-terminal-tab-dot" />
                  <span>{s.label}</span>
                  <span
                    style={{ marginLeft: 4, opacity: 0.6, fontSize: 13 }}
                    role="button"
                    aria-label="Close session"
                    onClick={(e) => {
                      e.stopPropagation();
                      onClose(s.id);
                    }}
                  >
                    ×
                  </span>
                </button>
              );
            })}
          </div>

          <div>
            {activeSession && (
              <button
                className="btn-cf-secondary small"
                style={{
                  background: "transparent",
                  color: "#9CA3AF",
                  borderColor: "#374151",
                  fontSize: 11.5,
                }}
                onClick={() => onClose(activeSession.id)}
              >
                Disconnect Session
              </button>
            )}
          </div>
        </div>

        {/* Terminal Canvas */}
        {sessions.map((s) => (
          <div
            style={{ flex: 1, display: s.id === activeId ? "flex" : "none", minHeight: 0 }}
            key={s.id}
          >
            <TerminalView session={s} active={s.id === activeId} />
          </div>
        ))}
      </div>
    </>
  );
}
