import { useState, useEffect } from "react";
import { useTunnelState } from "./useTunnelState";
import { useSshSessions } from "./ssh/sessions";
import { SetupScreen } from "./Setup";
import { TunnelsScreen } from "./screens/TunnelsScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { TerminalScreen } from "./terminal/TerminalScreen";
import {
  CloudflareLogo,
  CaretUpDownIcon,
  SearchIcon,
  CloudIcon,
  TerminalIcon,
  GearIcon,
  SunIcon,
  MoonIcon,
  ZapIcon,
  PanelLeftIcon,
} from "./components/icons";
import appIcon from "./assets/icon.png";
import type { ConfigInfo, TunnelSummary } from "./types";
import "./App.css";

export function App() {
  const {
    settings,
    save: saveSettings,
    verified,
    verifying,
    verify: verifyToken,
    error,
    setError,
    clearAll: clearAllData,
    tunnels,
    tunnelsLoading,
    tunnelsError,
    loadTunnels,
    toggleTunnel,
    startSshSession,
    activeHosts,
    connecting,
    isPortValid,
    cloudflaredVersion,
  } = useTunnelState();

  const {
    sessions: sshSessions,
    activeId: activeSessionId,
    setActiveId: setActiveSessionId,
    startSession,
    closeSession: closeSshSession,
  } = useSshSessions();

  const [activeTab, setActiveTab] = useState<"tunnels" | "terminal" | "settings">(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    return t === "terminal" || t === "settings" ? t : "tunnels";
  });
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const urlTheme = new URLSearchParams(window.location.search).get("theme");
    if (urlTheme === "light" || urlTheme === "dark") return urlTheme;
    return (localStorage.getItem("cf-theme") as "light" | "dark") || "light";
  });

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    const urlCollapsed = new URLSearchParams(window.location.search).get("collapsed");
    if (urlCollapsed === "1" || urlCollapsed === "true") return true;
    return localStorage.getItem("cf-sidebar-collapsed") === "true";
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark-theme", theme === "dark");
    localStorage.setItem("cf-theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("cf-sidebar-collapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  // Handle Cmd+K for quick search and Cmd+B or '[' to toggle sidebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        const searchInput = document.querySelector(".cf-search-input") as HTMLInputElement;
        if (searchInput) {
          searchInput.focus();
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setSidebarCollapsed((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // When a new SSH session is launched, jump directly to Terminal tab
  useEffect(() => {
    if (sshSessions.length > 0 && activeSessionId !== null) {
      setActiveTab("terminal");
    }
  }, [sshSessions.length, activeSessionId]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  };

  const handleStartSshWeb = async (
    tunnel: TunnelSummary,
    cfg: ConfigInfo,
    creds: { username: string; password: string }
  ) => {
    try {
      await startSshSession(
        tunnel,
        cfg,
        { username: creds.username, password: creds.password, useSaved: false },
        startSession
      );
      setActiveTab("terminal");
    } catch {
      // Error handled in useTunnelState
    }
  };

  const accountDisplay =
    settings.accountName ||
    (settings.accountId ? `Account: ${settings.accountId.slice(0, 8)}…` : "Not connected");

  if (!verified) {
    return (
      <div className="cf-setup-fullscreen">
        <div className="cf-setup-theme-toggle">
          <button type="button" onClick={toggleTheme} title="Toggle theme">
            {theme === "light" ? <MoonIcon size={16} /> : <SunIcon size={16} />}
          </button>
        </div>
        <SetupScreen
          settings={settings}
          save={saveSettings}
          verify={verifyToken}
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
    <div className="cf-kumo-app">
      {/* ─── Cloudflare Kumo Sidebar (Collapsible) ─── */}
      <aside className={`cf-kumo-sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
        {/* macOS: draggable strip under the traffic lights / overlay title bar */}
        <div className="cf-kumo-sidebar-drag" data-tauri-drag-region />

        {/* Header: Flame Logo + Account Switcher + Toggle */}
        <div className="cf-kumo-sidebar-header" data-tauri-drag-region>
          <a
            href="/"
            className="cf-logo-link"
            title="Cloudflare Dashboard"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab("tunnels");
            }}
          >
            {sidebarCollapsed ? (
              <img src={appIcon} alt="TunnelDash" className="cf-collapsed-logo" draggable={false} />
            ) : (
              <CloudflareLogo size={34} />
            )}
          </a>

          {!sidebarCollapsed && (
            <button
              type="button"
              className="cf-account-switcher-btn"
              title={accountDisplay}
              onClick={() => setActiveTab("settings")}
            >
              <span className="cf-account-title">{accountDisplay}</span>
              <CaretUpDownIcon size={14} className="cf-account-caret" />
            </button>
          )}

          <button
            type="button"
            className="cf-sidebar-toggle-btn"
            title={sidebarCollapsed ? "Expand sidebar (⌘B)" : "Collapse sidebar (⌘B)"}
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            <PanelLeftIcon size={16} />
          </button>
        </div>

        {/* Sidebar Body */}
        <div className="cf-kumo-sidebar-body">
          {/* Quick Search trigger button */}
          <button
            type="button"
            className="cf-quick-search-btn"
            title="Quick search (⌘K)"
            onClick={() => {
              if (sidebarCollapsed) {
                setSidebarCollapsed(false);
              }
              setTimeout(() => {
                const searchInput = document.querySelector(".cf-search-input") as HTMLInputElement;
                if (searchInput) searchInput.focus();
              }, 100);
            }}
          >
            <SearchIcon size={14} />
            <span>Quick search...</span>
            <kbd className="cf-quick-search-kbd">⌘K</kbd>
          </button>

          {/* Navigation Items */}
          <ul className="cf-kumo-menu">
            <li>
              <button
                type="button"
                className={`cf-kumo-menu-link ${activeTab === "tunnels" ? "active" : ""}`}
                onClick={() => setActiveTab("tunnels")}
                disabled={!verified}
                title="Tunnels"
              >
                <span className="cf-kumo-menu-link-inner">
                  <span className="cf-kumo-menu-icon">
                    <CloudIcon size={16} />
                  </span>
                  <span>Tunnels</span>
                </span>
                {tunnels.length > 0 && (
                  <span className="cf-kumo-badge">{tunnels.length}</span>
                )}
              </button>
            </li>

            <li>
              <button
                type="button"
                className={`cf-kumo-menu-link ${activeTab === "terminal" ? "active" : ""}`}
                onClick={() => setActiveTab("terminal")}
                title="SSH Terminal Console"
              >
                <span className="cf-kumo-menu-link-inner">
                  <span className="cf-kumo-menu-icon">
                    <TerminalIcon size={16} />
                  </span>
                  <span>SSH Terminal</span>
                </span>
                {sshSessions.length > 0 && (
                  <span className="cf-kumo-badge">{sshSessions.length}</span>
                )}
              </button>
            </li>

            <li>
              <button
                type="button"
                className={`cf-kumo-menu-link ${activeTab === "settings" ? "active" : ""}`}
                onClick={() => setActiveTab("settings")}
                title="Settings & Access"
              >
                <span className="cf-kumo-menu-link-inner">
                  <span className="cf-kumo-menu-icon">
                    <GearIcon size={16} />
                  </span>
                  <span>Settings & Access</span>
                </span>
              </button>
            </li>
          </ul>
        </div>

        {/* Sidebar Footer */}
        <div className="cf-kumo-sidebar-footer">
          <div
            style={{ display: "flex", alignItems: "center", gap: 6 }}
            title={cloudflaredVersion ? `cloudflared ${cloudflaredVersion}` : "cloudflared ready"}
          >
            <ZapIcon
              size={13}
              style={{
                color: activeHosts.size > 0 ? "var(--cf-green-5)" : "var(--kumo-subtle)",
              }}
            />
            <span className="cf-daemon-text" style={{ fontSize: 11.5 }}>
              {cloudflaredVersion ? `cloudflared ${cloudflaredVersion}` : "cloudflared ready"}
            </span>
          </div>

          <button
            type="button"
            className="cf-theme-toggle-btn"
            onClick={toggleTheme}
            title={theme === "light" ? "Switch to Dark Mode" : "Switch to Light Mode"}
          >
            {theme === "light" ? <MoonIcon size={14} /> : <SunIcon size={14} />}
          </button>
        </div>
      </aside>

      {/* ─── Main Content Area (Full Resolution) ─── */}
      <main className="cf-kumo-main">
        <div className="cf-kumo-content-container">
          {!verified ? (
            <SetupScreen
              settings={settings}
              save={saveSettings}
              verify={verifyToken}
              verifying={verifying}
              verified={verified}
              error={error}
              setError={setError}
              isPortValid={isPortValid}
            />
          ) : activeTab === "tunnels" ? (
            <TunnelsScreen
              tunnels={tunnels}
              loading={tunnelsLoading}
              error={tunnelsError || error}
              refresh={loadTunnels}
              toggleTunnel={toggleTunnel}
              activeHosts={activeHosts}
              connecting={connecting}
              onStartSshWeb={handleStartSshWeb}
              settings={settings}
            />
          ) : activeTab === "terminal" ? (
            <TerminalScreen
              sessions={sshSessions}
              activeId={activeSessionId}
              onSelect={setActiveSessionId}
              onClose={closeSshSession}
            />
          ) : (
            <SettingsScreen
              settings={settings}
              save={saveSettings}
              verify={verifyToken}
              verifying={verifying}
              verified={verified}
              error={error}
              setError={setError}
              clearAll={clearAllData}
              isPortValid={isPortValid}
              cloudflaredVersion={cloudflaredVersion}
            />
          )}
        </div>
      </main>
    </div>
  );
}

export default App;
