import { useState } from "react";
import { CloseIcon, CopyIcon, CheckIcon, CloudIcon } from "./icons";

export type SshPreviewModalProps = {
  configPath: string;
  content: string;
  onClose: () => void;
};

export function SshPreviewModal({
  configPath,
  content,
  onClose,
}: SshPreviewModalProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error("Failed to copy:", e);
    }
  };

  return (
    <div className="cf-modal-backdrop" onClick={onClose}>
      <div className="cf-modal-card" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="cf-modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div className="cf-modal-icon-wrap">
              <CloudIcon size={18} />
            </div>
            <div>
              <h2 className="cf-modal-title">SSH Config Preview</h2>
              <div className="cf-modal-subtitle" style={{ fontFamily: "var(--font-mono)" }}>
                {configPath}
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
          <div style={{ fontSize: 12, color: "var(--kumo-subtle)", marginBottom: 10 }}>
            TunnelDash maintains this isolated block in your SSH configuration. Your other custom hosts are never modified.
          </div>

          <div className="cf-code-preview-wrap">
            <div className="cf-code-preview-toolbar">
              <span style={{ fontSize: 11, color: "var(--kumo-subtle)", fontFamily: "var(--font-mono)" }}>
                ~/.ssh/config
              </span>
              <button
                type="button"
                className={`btn-cf-secondary small cf-copy-btn ${copied ? "copied" : ""}`}
                onClick={handleCopy}
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
            </div>
            <pre className="cf-code-preview-content">{content || "# No SSH endpoints to configure"}</pre>
          </div>
        </div>

        {/* Footer */}
        <div className="cf-modal-footer">
          <div style={{ fontSize: 11.5, color: "var(--kumo-subtle)" }}>
            Compatible with macOS, Linux, and Windows OpenSSH
          </div>
          <button type="button" className="btn-cf-secondary small" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
