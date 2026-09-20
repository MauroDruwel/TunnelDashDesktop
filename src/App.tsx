import { useCallback, useMemo, useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTunnelState } from "./useTunnelState";
import { useTheme } from "./theme";
import { SetupScreen } from "./Setup";
import { TunnelsScreen } from "./screens/TunnelsScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { SshScreen } from "./screens/SshScreen";
import {
  sshGetCredential,
  sshGetConfigStatus,
  sshSyncConfig,
  type SshConfigStatus,
  type SshCredentialInfo,
} from "./api";
import { collectSshServers, deriveHostAlias } from "./utils/tunnelTransforms";
import { SshModal } from "./components/SshModal";
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
  CloseIcon,
} from "./components/icons";
import appIcon from "./assets/icon.png";
import "./App.css";

function formatDaemonVersion(raw: string | null): string {
  if (!raw) return "cloudflared ready";
  let cleaned = raw.trim();
  if (cleaned.startsWith("cloudflared ")) {
    cleaned = cleaned.slice("cloudflared ".length).trim();
  }
  return `cloudflared ${cleaned}`;
}

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
    activeHosts,
    connecting,
    isPortValid,
    cloudflaredVersion,
    allTunnels,
    update,
    dismissUpdate,
    openUpdatePage,
  } = useTunnelState();

  const [activeTab, setActiveTab] = useState<"tunnels" | "ssh" | "settings">(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    return t === "settings" || t === "ssh" ? t : "tunnels";
  });

  // SSH credential editor to auto-open (set when the dashboard redirects an
  // unauthenticated Terminal click into the SSH tab).
  const [sshConfigKey, setSshConfigKey] = useState<{ key: string; nonce: number } | null>(null);

  const sshServers = useMemo(() => collectSshServers(tunnels), [tunnels]);

  // Tray menu: focus the tunnels list when a proxying tunnel is clicked.
  useEffect(() => {
    if (typeof (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ === "undefined") return;
    let unsub: (() => void) | null = null;
    void listen<string>("tray-navigate", () => {
      setActiveTab("tunnels");
    }).then((fn) => {
      unsub = fn;
    });
    return () => unsub?.();
  }, []);

  const { theme, toggle: toggleTheme } = useTheme();

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    const urlCollapsed = new URLSearchParams(window.location.search).get("collapsed");
    if (urlCollapsed === "1" || urlCollapsed === "true") return true;
    return localStorage.getItem("cf-sidebar-collapsed") === "true";
  });

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

  const accountDisplay =
    settings.accountName ||
    (settings.accountId ? `Account: ${settings.accountId.slice(0, 8)}…` : "Not connected");

  const [sshModalTarget, setSshModalTarget] = useState<{
    host: string;
    hostname?: string;
    alias?: string;
    tunnelName?: string;
  } | null>(null);
  const [modalConfigStatus, setModalConfigStatus] = useState<SshConfigStatus | null>(null);
  const [modalCred, setModalCred] = useState<SshCredentialInfo | null>(null);

  // Auto-sync all SSH endpoints into ~/.ssh/config whenever tunnels are loaded/refreshed
  useEffect(() => {
    if (!tunnels.length) return;
    if (settings.autoSyncSshConfig === false) return;

    let cancelled = false;
    (async () => {
      try {
        const servers = collectSshServers(tunnels);
        if (!servers.length) return;

        const defaultUser = settings.defaultSshUser?.trim() || undefined;
        const defaultKey = settings.defaultSshKeyPath?.trim() || undefined;

        const hosts = await Promise.all(
          servers.map(async (s) => {
            const cred = await sshGetCredential(s.host).catch(() => null);
            return {
              host: s.host,
              alias: s.alias,
              hostname: s.hostname,
              username: cred?.username || defaultUser,
              keyPath: cred?.keyPath || defaultKey,
            };
          })
        );
        if (!cancelled) {
          const nextStatus = await sshSyncConfig(hosts);
          setModalConfigStatus(nextStatus);
        }
      } catch (e) {
        console.warn("auto-sync ssh config failed", e);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tunnels, settings.autoSyncSshConfig, settings.defaultSshUser, settings.defaultSshKeyPath]);

  const handleOpenSshModal = useCallback(
    async (host: string, hostname?: string, tunnelName?: string) => {
      const alias = deriveHostAlias(tunnelName, hostname || host);
      setSshModalTarget({ host, hostname: hostname || host, alias, tunnelName });
      try {
        const [status, cred] = await Promise.all([
          sshGetConfigStatus(),
          sshGetCredential(host).catch(() => null),
        ]);
        setModalConfigStatus(status);
        setModalCred(cred);
      } catch (e) {
        console.warn("failed to load ssh status", e);
      }
    },
    []
  );



  // Full-screen onboarding only when there's no account yet — re-verifying a
  // token from Settings must NOT kick the user back to the setup wizard.
  if (!verified && !settings.accountId) {
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
                className={`cf-kumo-menu-link ${activeTab === "ssh" ? "active" : ""}`}
                onClick={() => setActiveTab("ssh")}
                disabled={!verified}
                title="SSH Sessions"
              >
                <span className="cf-kumo-menu-link-inner">
                  <span className="cf-kumo-menu-icon">
                    <TerminalIcon size={16} />
                  </span>
                  <span>SSH Sessions</span>
                </span>
                {sshServers.length > 0 && (
                  <span className="cf-kumo-badge">{sshServers.length}</span>
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
            style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, overflow: "hidden" }}
            title={formatDaemonVersion(cloudflaredVersion)}
          >
            <ZapIcon
              size={13}
              style={{
                flexShrink: 0,
                color: activeHosts.size > 0 ? "var(--cf-green-5)" : "var(--kumo-subtle)",
              }}
            />
            <span
              className="cf-daemon-text"
              style={{
                fontSize: 11.5,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {formatDaemonVersion(cloudflaredVersion)}
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
        <div className="cf-kumo-main-drag" data-tauri-drag-region />
        <div className="cf-kumo-content-container">
          {update && (
            <div className="cf-update-banner" role="status">
              <span>
                A new TunnelDash version ({update.version.replace(/^v/i, "")}) is available.
              </span>
              <span className="cf-update-banner-actions">
                <button type="button" className="btn-cf-secondary small" onClick={openUpdatePage}>
                  Download
                </button>
                <button
                  type="button"
                  className="cf-icon-btn"
                  title="Dismiss"
                  aria-label="Dismiss update notice"
                  onClick={dismissUpdate}
                >
                  <CloseIcon size={14} />
                </button>
              </span>
            </div>
          )}
          {activeTab === "tunnels" ? (
            <TunnelsScreen
              tunnels={tunnels}
              loading={tunnelsLoading}
              error={tunnelsError || error}
              refresh={loadTunnels}
              toggleTunnel={toggleTunnel}
              activeHosts={activeHosts}
              connecting={connecting}
              onOpenSsh={handleOpenSshModal}
              settings={settings}
            />
          ) : activeTab === "ssh" ? (
            <SshScreen
              tunnels={tunnels}
              loading={tunnelsLoading}
              error={tunnelsError || error}
              refresh={loadTunnels}
              activeHosts={activeHosts}
              connecting={connecting}
              settings={settings}
              pendingConfigKey={sshConfigKey}
              onConsumedPendingConfig={() => setSshConfigKey(null)}
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
              allTunnels={allTunnels}
            />
          )}
        </div>
      </main>

      {/* Global SSH Modal (e.g. opened from Tunnels screen) */}
      {sshModalTarget && (
        <SshModal
          host={sshModalTarget.host}
          hostname={sshModalTarget.hostname || sshModalTarget.host}
          alias={sshModalTarget.alias}
          tunnelName={sshModalTarget.tunnelName}
          credential={modalCred}
          configStatus={modalConfigStatus}
          onClose={() => setSshModalTarget(null)}
          onOpenConfigure={() => {
            const server = sshServers.find((s) => s.host === sshModalTarget.host);
            if (server) {
              setSshConfigKey({ key: server.key, nonce: Date.now() });
            }
            setActiveTab("ssh");
            setSshModalTarget(null);
          }}
        />
      )}
    </div>
  );
}

export default App;
