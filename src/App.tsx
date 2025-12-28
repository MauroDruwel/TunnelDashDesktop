import { useMemo, useState } from "react";
import { useSetup } from "./useSetup";
import { SetupScreen } from "./Setup";
import { SettingsScreen } from "./screens/SettingsScreen";
import { TunnelsScreen } from "./screens/TunnelsScreen";
import "./App.css";

type Tab = "tunnels" | "settings";

function App() {
  const {
    settings,
    save,
    verified,
    verifying,
    verify,
    error,
    setError,
    clearAll,
    tunnels,
    tunnelsLoading,
    tunnelsError,
    loadTunnels,
    toggleTunnel,
    activeHosts,
    connecting,
    isPortValid,
    cloudflaredVersion,
  } = useSetup();

  const [tab, setTab] = useState<Tab>("tunnels");

  const statusLine = useMemo(() => {
    if (!verified) return "Token not verified";
    if (!settings.accountName) return "Account unknown";
    return `${settings.accountName}${settings.accountId ? ` · ${settings.accountId}` : ""}`;
  }, [verified, settings.accountName, settings.accountId]);

  if (!verified) {
    return (
      <div className="app-shell">
        <header className="app-top">
          <div className="brand">
            <span className="dot" />
            <div>
              <div className="brand-title">TunnelDash</div>
              <div className="brand-sub">Desktop companion</div>
            </div>
          </div>
          <div className="status-pill warn">Setup needed</div>
        </header>

        <SetupScreen
          settings={settings}
          save={save}
          verify={verify}
          verifying={verifying}
          verified={verified}
          error={error}
          setError={setError}
          isPortValid={isPortValid}
        />
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="app-top">
        <div className="brand">
          <span className="dot" />
          <div>
            <div className="brand-title">TunnelDash</div>
            <div className="brand-sub">Desktop companion</div>
          </div>
        </div>
        <div className={`status-pill ${verified ? "ok" : "warn"}`}>{statusLine}</div>
      </header>

      <main className="card content">
        {tab === "tunnels" ? (
          <TunnelsScreen
            accountLine={statusLine}
            tunnels={tunnels}
            loading={tunnelsLoading}
            error={tunnelsError || error}
            onRefresh={loadTunnels}
            onToggle={toggleTunnel}
            activeHosts={activeHosts}
            connecting={connecting}
          />
        ) : (
          <SettingsScreen
            settings={settings}
            save={save}
            verify={verify}
            verifying={verifying}
            verified={verified}
            error={error}
            setError={setError}
            clearAll={() => clearAll().then(() => setTab("settings"))}
            isPortValid={isPortValid}
            cloudflaredVersion={cloudflaredVersion}
          />
        )}
      </main>

      <nav className="tabbar">
        <button className={`tab-btn ${tab === "tunnels" ? "active" : ""}`} onClick={() => setTab("tunnels")}>
          <span>☁️</span>
          <small>Tunnels</small>
        </button>
        <button className={`tab-btn ${tab === "settings" ? "active" : ""}`} onClick={() => setTab("settings")}>
          <span>⚙️</span>
          <small>Settings</small>
        </button>
      </nav>
    </div>
  );
}
export default App;
