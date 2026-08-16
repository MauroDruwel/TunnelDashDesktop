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
  if (!sessions.length) {
    return (
      <div className="stack ssh-screen">
        <p className="eyebrow">Terminal</p>
        <h1>SSH sessions</h1>
        <div className="callout empty-sessions">
          <TerminalIcon size={18} />
          <span>
            No active sessions. Open the <b>SSH</b> option on a tunnel and choose{" "}
            <b>Connect here</b> to start one.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="stack ssh-screen">
      <div className="row between">
        <div>
          <p className="eyebrow">Terminal</p>
          <h1>SSH sessions</h1>
        </div>
      </div>

      <div className="session-tabs">
        {sessions.map((s) => (
          <button
            key={s.id}
            className={`session-tab ${s.id === activeId ? "active" : ""} ${s.status}`}
            onClick={() => onSelect(s.id)}
            title={s.error ?? s.label}
          >
            <span className="session-dot" />
            {s.label}
            <span
              className="session-close"
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
        ))}
      </div>

      {sessions.map((s) => (
        <div className="terminal-pane" hidden={s.id !== activeId} key={s.id}>
          <TerminalView session={s} active={s.id === activeId} />
        </div>
      ))}
    </div>
  );
}
