import { useId, useState } from "react";
import type { SshCredentialInfo } from "../api";
import type { SshServer } from "../types";
import { KeyIcon, TrashIcon } from "../components/icons";

export type SshIdentityDraft = {
  username: string;
  keyPath: string;
};

function isConfigured(info?: SshCredentialInfo | null): info is SshCredentialInfo {
  return Boolean(info && (info.username || info.keyPath));
}

type SshIdentityEditorProps = {
  server: SshServer;
  info?: SshCredentialInfo | null;
  defaultUser?: string;
  defaultKeyPath?: string;
  saving: boolean;
  onSave: (draft: SshIdentityDraft) => void | Promise<void>;
  onRemove: () => void | Promise<void>;
  onClose: () => void;
};

export function SshIdentityEditor({
  server,
  info,
  defaultUser,
  defaultKeyPath,
  saving,
  onSave,
  onRemove,
  onClose,
}: SshIdentityEditorProps) {
  const usernameId = useId();
  const keyPathId = useId();
  const configured = isConfigured(info);
  const [username, setUsername] = useState(info?.username ?? "");
  const [keyPath, setKeyPath] = useState(info?.keyPath ?? "");

  const canSave = username.trim().length > 0 || keyPath.trim().length > 0;

  return (
    <div className="cf-subtable-container">
      <div className="cf-ssh-editor">
        <div className="cf-ssh-editor-header">
          <span className="cf-ssh-editor-title">SSH Identity for {server.hostname}</span>
          <span style={{ fontSize: 11.5, color: "var(--kumo-subtle)" }}>
            Configures <code style={{ fontFamily: "var(--font-mono)" }}>User</code> and <code style={{ fontFamily: "var(--font-mono)" }}>IdentityFile</code> in your OpenSSH configuration.
          </span>
        </div>

        <div className="cf-ssh-editor-grid">
          <div className="cf-form-group" style={{ margin: 0 }}>
            <label htmlFor={usernameId} className="cf-form-label">Remote Username</label>
            <input
              id={usernameId}
              type="text"
              className="cf-form-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={defaultUser ? `Default: ${defaultUser}` : "e.g. codermauro, root, ubuntu"}
              autoComplete="off"
              spellCheck="false"
            />
            <span className="cf-form-help">OpenSSH User directive</span>
          </div>

          <div className="cf-form-group" style={{ margin: 0 }}>
            <label htmlFor={keyPathId} className="cf-form-label">Private Key Path</label>
            <input
              id={keyPathId}
              type="text"
              className="cf-form-input"
              value={keyPath}
              onChange={(e) => setKeyPath(e.target.value)}
              placeholder={defaultKeyPath ? `Default: ${defaultKeyPath}` : "~/.ssh/id_ed25519"}
              autoComplete="off"
              spellCheck="false"
              style={{ fontFamily: "var(--font-mono)" }}
            />
            <span className="cf-form-help">OpenSSH IdentityFile directive (e.g. ~/.ssh/id_ed25519)</span>
          </div>
        </div>

        <div className="cf-ssh-editor-footer">
          {configured ? (
            <button type="button" className="btn-cf-danger small" disabled={saving} onClick={onRemove}>
              <TrashIcon size={12} />
              <span>Reset to defaults</span>
            </button>
          ) : (
            <span />
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn-cf-secondary small" disabled={saving} onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="btn-cf-primary small"
              disabled={saving || !canSave}
              onClick={() => onSave({ username, keyPath })}
            >
              <KeyIcon size={12} />
              <span>{saving ? "Saving…" : "Save identity"}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
