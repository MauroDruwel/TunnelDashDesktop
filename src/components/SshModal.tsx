import { useState, useMemo } from "react";
import {
  CloseIcon,
  TerminalIcon,
  CopyIcon,
  CheckIcon,
  KeyIcon,
  PlayIcon,
} from "./icons";
import { launchTerminal, type SshConfigStatus, type SshCredentialInfo } from "../api";

export type SshModalProps = {
  host: string;
  hostname: string;
  alias?: string;
  tunnelName?: string;
  credential?: SshCredentialInfo | null;
  configStatus?: SshConfigStatus | null;
  onClose: () => void;
  onOpenConfigure?: () => void;
};

export function SshModal({
  hostname,
  alias,
  tunnelName,
  credential,
  configStatus,
  onClose,
  onOpenConfigure,
}: SshModalProps) {
  const [copied, setCopied] = useState(false);
  const [launched, setLaunched] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const connectTarget = alias || hostname;
  const username = credential?.username?.trim();

  // With ~/.ssh/config auto-synced, `ssh alias` connects immediately.
  const primaryCommand = useMemo(() => {
    return username ? `ssh ${connectTarget}` : `ssh ${connectTarget}`;
  }, [connectTarget, username]);

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error("Failed to copy:", e);
    }
  };

  const handleLaunch = async () => {
    try {
      setLaunchError(null);
      await launchTerminal(primaryCommand);
      setLaunched(true);
      window.setTimeout(() => setLaunched(false), 2500);
    } catch (e) {
      console.error("Failed to launch terminal:", e);
      setLaunchError("Could not open system terminal");
      window.setTimeout(() => setLaunchError(null), 3000);
    }
  };

  const cleanTunnelName = tunnelName?.trim();
  const aliasDerivedFromTunnel =
    cleanTunnelName &&
    alias?.toLowerCase() === cleanTunnelName.toLowerCase().replace(/[^a-z0-9]/g, "");

  return (
    <div className="cf-modal-backdrop" onClick={onClose}>
      <div className="cf-modal-card" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="cf-modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div className="cf-modal-icon-wrap">
              <TerminalIcon size={18} />
            </div>
            <div>
              <h2 className="cf-modal-title">Connect via SSH</h2>
              <div className="cf-modal-subtitle">
                {alias ? (
                  <>
                    <strong style={{ color: "var(--kumo-text)" }}>{alias}</strong>
                    <span> · {hostname}</span>
                  </>
                ) : (
                  hostname
                )}
                {cleanTunnelName && !aliasDerivedFromTunnel ? ` · ${cleanTunnelName}` : ""}
              </div>
            </div>
          </div>
          <button
            type="button"
            className="cf-modal-close-btn"
            onClick={onClose}
            title="Close"
          >
            <CloseIcon size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="cf-modal-body">
          {/* Primary Command Block */}
          <div className="cf-cmd-section">
            <div className="cf-cmd-label-row">
              <span className="cf-cmd-label">SSH Command</span>
            </div>

            <div className="cf-cmd-box">
              <span className="cf-cmd-prompt">$</span>
              <code className="cf-cmd-text">{primaryCommand}</code>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button
                  type="button"
                  className={`btn-cf-secondary small cf-copy-btn ${copied ? "copied" : ""}`}
                  onClick={() => handleCopy(primaryCommand)}
                  title="Copy command to clipboard"
                >
                  {copied ? (
                    <>
                      <CheckIcon size={12} />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <CopyIcon size={12} />
                      <span>Copy</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className={`btn-cf-primary small ${launched ? "btn-cf-success" : ""}`}
                  onClick={handleLaunch}
                  title="Open Terminal.app and execute ssh command"
                >
                  {launched ? (
                    <>
                      <CheckIcon size={12} />
                      <span>Launched!</span>
                    </>
                  ) : (
                    <>
                      <PlayIcon size={11} />
                      <span>Launch Terminal</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {launchError && (
              <div style={{ fontSize: 12, color: "var(--cf-red-5)", marginTop: 6 }}>
                {launchError}
              </div>
            )}

            <div style={{ fontSize: 12, color: "var(--kumo-subtle)", marginTop: 8, lineHeight: 1.4 }}>
              OpenSSH connects via Cloudflare Zero Trust on-demand. Click <strong>Launch Terminal</strong> to open instantly, or copy the command to run in your preferred shell (iTerm, Warp, VS Code).
            </div>
          </div>

          {/* Authentication info */}
          <div className="cf-auth-info-row">
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              {credential?.hasKey ? (
                <>
                  <KeyIcon size={13} style={{ color: "var(--cf-green-5)" }} />
                  <span>SSH Key authentication ({username || "default user"})</span>
                </>
              ) : credential?.username ? (
                <>
                  <KeyIcon size={13} style={{ color: "var(--cf-green-5)" }} />
                  <span>User: <strong>{username}</strong></span>
                </>
              ) : (
                <span style={{ color: "var(--kumo-subtle)" }}>Standard OpenSSH identity</span>
              )}
            </div>

            {onOpenConfigure && (
              <button
                type="button"
                className="btn-cf-secondary small"
                onClick={() => {
                  onClose();
                  onOpenConfigure();
                }}
              >
                Configure identity
              </button>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="cf-modal-footer">
          <div style={{ fontSize: 11.5, color: "var(--kumo-subtle)" }}>
            Automatically synced in OpenSSH config ({configStatus?.configPath || "~/.ssh/config"})
          </div>
          <button type="button" className="btn-cf-secondary small" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
