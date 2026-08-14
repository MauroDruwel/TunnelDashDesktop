import { lazy, Suspense, useMemo, useState } from "react";
import { useTunnelState } from "./useTunnelState";
import { SetupScreen } from "./Setup";
import { SettingsScreen } from "./screens/SettingsScreen.tsx";
import { TunnelsScreen } from "./screens/TunnelsScreen.tsx";
import { CloudIcon, GearIcon, TerminalIcon } from "./components/icons.tsx";
import "./App.css";

const TerminalScreen = lazy(() =>
  import("./terminal/TerminalScreen.tsx").then((m) => ({ default: m.TerminalScreen }))
);

type Tab = "tunnels" | "terminal" | "settings";

function initialTab(): Tab {
  const tab = new URLSearchParams(window.location.search).get("tab");
  return tab === "terminal" || tab === "settings" ? tab : "tunnels";
}

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
  } = useTunnelState();

  const [tab, setTab] = useState<Tab>(initialTab);

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
        <div hidden={tab !== "tunnels"}>
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
        </div>

        <div hidden={tab !== "terminal"} className="terminal-tab">
          <Suspense fallback={<div className="callout">Loading terminal...</div>}>
            <TerminalScreen settings={settings} save={save} />
          </Suspense>
        </div>

        <div hidden={tab !== "settings"}>
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
        </div>
      </main>

      <nav className="tabbar">
        <button className={`tab-btn ${tab === "tunnels" ? "active" : ""}`} onClick={() => setTab("tunnels")}>
          <CloudIcon />
          <small>Tunnels</small>
        </button>
        <button className={`tab-btn ${tab === "terminal" ? "active" : ""}`} onClick={() => setTab("terminal")}>
          <TerminalIcon />
          <small>Terminal</small>
        </button>
        <button className={`tab-btn ${tab === "settings" ? "active" : ""}`} onClick={() => setTab("settings")}>
          <GearIcon />
          <small>Settings</small>
        </button>
      </nav>
    </div>
  );
}
export default App;
