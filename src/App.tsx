import { lazy, Suspense, useMemo, useState } from "react";
import { useTunnelState } from "./useTunnelState";
import { SetupScreen } from "./Setup";
import { SettingsScreen } from "./screens/SettingsScreen.tsx";
import { TunnelsScreen } from "./screens/TunnelsScreen.tsx";
import { CloudIcon, GearIcon, TerminalIcon } from "./components/icons.tsx";
import { useTheme } from "./theme.ts";
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
  const { theme, toggle } = useTheme();

  const statusLine = useMemo(() => {
    if (!verified) return "Setup needed";
    if (!settings.accountName) return "Account unknown";
    return settings.accountName;
  }, [verified, settings.accountName]);

  return (
    <div className="app-shell">
      <nav className="topnav">
        <div className="nav-brand">
          Tunnel<span>Dash</span>
        </div>
        <div className="nav-tabs">
          {(["tunnels", "terminal", "settings"] as Tab[]).map((t) => (
            <button
              key={t}
              className={`nav-tab ${tab === t && verified ? "active" : ""}`}
              onClick={() => verified && setTab(t)}
              disabled={!verified}
            >
              {t === "tunnels" && <CloudIcon size={14} />}
              {t === "terminal" && <TerminalIcon size={14} />}
              {t === "settings" && <GearIcon size={14} />}
              <span>{t[0].toUpperCase() + t.slice(1)}</span>
            </button>
          ))}
        </div>
        <div className="nav-status">
          {verified ? statusLine : "not configured"}
          {cloudflaredVersion && !verified ? "" : ""}
        </div>
        <button
          className="theme-toggle"
          onClick={toggle}
          title="Toggle theme"
          aria-label="Toggle theme"
        >
          {theme === "dark" ? <SunIcon /> : <MoonIcon />}
        </button>
      </nav>

      <main>
        {!verified ? (
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
        ) : (
          <>
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
          </>
        )}
      </main>
    </div>
  );
}

function SunIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2" x2="12" y2="4" />
      <line x1="12" y1="20" x2="12" y2="22" />
      <line x1="4.93" y1="4.93" x2="6.34" y2="6.34" />
      <line x1="17.66" y1="17.66" x2="19.07" y2="19.07" />
      <line x1="2" y1="12" x2="4" y2="12" />
      <line x1="20" y1="12" x2="22" y2="12" />
      <line x1="4.93" y1="19.07" x2="6.34" y2="17.66" />
      <line x1="17.66" y1="6.34" x2="19.07" y2="4.93" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

export default App;
