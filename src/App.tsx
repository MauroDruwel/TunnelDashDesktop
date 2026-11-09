import { useCallback, useMemo, useState, useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useTunnelState } from "./useTunnelState";
import { useQuickSearch } from "./useQuickSearch";
import { useTheme } from "./theme";
import { SetupScreen } from "./Setup";
import { TunnelsScreen } from "./screens/TunnelsScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { SshScreen } from "./screens/SshScreen";
import {
  DEMO_MODE,
  openUrl,
  sshGetCredential,
  sshGetConfigStatus,
  sshSyncConfig,
  type SshConfigStatus,
  type SshCredentialInfo,
} from "./api";
import { collectSshServers, deriveHostAlias } from "./utils/tunnelTransforms";
import { SshModal } from "./components/SshModal";
import { SunIcon, MoonIcon } from "./components/icons";
import { DashboardSidebar } from "./components/DashboardSidebar";
import { useStartupUpdate } from "./utils/appUpdates";
import "./App.css";

export function App() {
  const { update, dismissUpdate } = useStartupUpdate(!DEMO_MODE);
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
    let disposed = false;
    let unsub: (() => void) | null = null;
    void listen<string>("tray-navigate", () => {
      if (!disposed) setActiveTab("tunnels");
    }).then((fn) => {
      if (disposed) fn();
      else unsub = fn;
    }).catch((err) => {
      console.warn("Could not register tray navigation listener", err);
    });
    return () => {
      disposed = true;
      unsub?.();
    };
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

  const openTunnels = useCallback(() => setActiveTab("tunnels"), []);
  const quickSearch = useQuickSearch(openTunnels, activeTab, Boolean(settings.accountId));

  // Handle Cmd/Ctrl+K for search and Cmd/Ctrl+B to toggle the sidebar.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k" && settings.accountId) {
        if (document.querySelector("dialog[open]")) return;
        e.preventDefault();
        quickSearch();
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setSidebarCollapsed((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [quickSearch, settings.accountId]);

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



  const updateNotice = update && (
    <div className="cf-update-banner">
      <span role="status">TunnelDash v{update.latest_version} is available.</span>
      <span className="cf-update-banner-actions">
        <button type="button" className="btn-cf-secondary small" onClick={() => void openUrl(update.html_url)}>View Release</button>
        <button type="button" className="btn-cf-secondary small" aria-label="Dismiss update notice" onClick={dismissUpdate}>Dismiss</button>
      </span>
    </div>
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
        {updateNotice && <div>{updateNotice}</div>}
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
      <DashboardSidebar
        sidebarCollapsed={sidebarCollapsed}
        setSidebarCollapsed={setSidebarCollapsed}
        accountDisplay={accountDisplay}
        hasAccount={Boolean(settings.accountId)}
        quickSearch={quickSearch}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        verified={verified}
        tunnelCount={tunnels.length}
        sshCount={sshServers.length}
        proxyCount={activeHosts.size}
        cloudflaredVersion={cloudflaredVersion}
        theme={theme}
        toggleTheme={toggleTheme}
      />

      {/* ─── Main Content Area (Full Resolution) ─── */}
      <main className="cf-kumo-main">
        <div className="cf-kumo-main-drag" data-tauri-drag-region />
        <div className="cf-kumo-content-container">
          {updateNotice}
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
