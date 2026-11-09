import { useState } from "react";
import { openUrl } from "../api";
import { checkForUpdates, type UpdateInfo } from "../utils/appUpdates";
import { version } from "../../package.json";

export function SoftwareUpdates() {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<UpdateInfo | null>(null);
  const [message, setMessage] = useState("");

  const check = async () => {
    setChecking(true);
    setResult(null);
    setMessage("");
    try {
      const info = await checkForUpdates();
      setResult(info);
      setMessage(info.has_update ? `New release available: v${info.latest_version}` : "TunnelDash is up to date");
    } catch {
      setMessage("Could not check for updates. Try again later.");
    } finally {
      setChecking(false);
    }
  };

  return (
    <section className="cf-card" aria-labelledby="software-updates-title">
      <div className="cf-card-header">
        <h2 id="software-updates-title" className="cf-card-title">Software Updates</h2>
        <div className="cf-card-desc">Installed version: v{version}</div>
        {message && <div role="status" className="cf-card-desc">{message}</div>}
      </div>
      <div className="cf-card-footer">
        {result?.has_update && (
          <button type="button" className="btn-cf-primary"
            onClick={() => void openUrl(result.html_url)}>
            View Release v{result.latest_version}
          </button>
        )}
        <button type="button" className="btn-cf-secondary" disabled={checking}
          onClick={() => void check()}>
          {checking ? "Checking…" : "Check for Updates"}
        </button>
      </div>
    </section>
  );
}
