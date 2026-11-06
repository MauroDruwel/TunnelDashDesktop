import { SearchIcon, CloudIcon, TerminalIcon, GearIcon, SunIcon, MoonIcon, ZapIcon, PanelLeftIcon } from "./icons";
import appIcon from "../assets/icon.png";

export type DashboardTab = "tunnels" | "ssh" | "settings";

type Props = {
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (value: boolean) => void;
  accountDisplay: string;
  hasAccount: boolean;
  quickSearch: () => void;
  activeTab: DashboardTab;
  setActiveTab: (tab: DashboardTab) => void;
  verified: boolean;
  tunnelCount: number;
  sshCount: number;
  proxyCount: number;
  cloudflaredVersion: string | null;
  theme: string;
  toggleTheme: () => void;
};

function formatDaemonVersion(raw: string | null): string {
  return raw ? `cloudflared ${raw.trim().replace(/^cloudflared /, "")}` : "cloudflared version unavailable";
}

export function DashboardSidebar({
  sidebarCollapsed, setSidebarCollapsed, accountDisplay, hasAccount, quickSearch,
  activeTab, setActiveTab, verified, tunnelCount, sshCount, proxyCount,
  cloudflaredVersion, theme, toggleTheme,
}: Props) {
  const shortcut = document.documentElement.classList.contains("mac") ? "⌘" : "Ctrl+";
  return (
    <aside className={`cf-kumo-sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
      {/* macOS: draggable strip under the traffic lights / overlay title bar */}
      <div className="cf-kumo-sidebar-drag" data-tauri-drag-region />

      {/* Header: Flame Logo + Account Switcher + Toggle */}
      <div className="cf-kumo-sidebar-header" data-tauri-drag-region>
        <a
          href="/"
          className="cf-logo-link"
          aria-label="TunnelDash dashboard"
          title="TunnelDash dashboard"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab("tunnels");
          }}
        >
          <img src={appIcon} alt="" className="cf-collapsed-logo" draggable={false} />
        </a>

        {!sidebarCollapsed && (
          <button
            type="button"
            className="cf-account-switcher-btn"
            title="Open account settings"
            aria-label={`Open account settings for ${accountDisplay}`}
            onClick={() => setActiveTab("settings")}
          >
            <span className="cf-account-title">{accountDisplay}</span>
            <GearIcon size={14} className="cf-account-caret" />
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
          aria-label="Quick search"
            title={`Quick search (${shortcut}K)`}
          disabled={!hasAccount}
          onClick={quickSearch}
        >
          <SearchIcon size={14} />
          <span>Quick search...</span>
          <kbd className="cf-quick-search-kbd">{shortcut}K</kbd>
        </button>

        {/* Navigation Items */}
        <ul className="cf-kumo-menu">
          <li>
            <button
              type="button"
              className={`cf-kumo-menu-link ${activeTab === "tunnels" ? "active" : ""}`}
              onClick={() => setActiveTab("tunnels")}
              disabled={!verified}
              aria-current={activeTab === "tunnels" ? "page" : undefined}
                title="Tunnels"
            >
              <span className="cf-kumo-menu-link-inner">
                <span className="cf-kumo-menu-icon">
                  <CloudIcon size={16} />
                </span>
                <span>Tunnels</span>
              </span>
              {tunnelCount > 0 && (
                <span className="cf-kumo-badge">{tunnelCount}</span>
              )}
            </button>
          </li>

          <li>
            <button
              type="button"
              className={`cf-kumo-menu-link ${activeTab === "ssh" ? "active" : ""}`}
              onClick={() => setActiveTab("ssh")}
              disabled={!verified}
              aria-current={activeTab === "ssh" ? "page" : undefined}
                title="SSH Sessions"
            >
              <span className="cf-kumo-menu-link-inner">
                <span className="cf-kumo-menu-icon">
                  <TerminalIcon size={16} />
                </span>
                <span>SSH Sessions</span>
              </span>
              {sshCount > 0 && (
                <span className="cf-kumo-badge">{sshCount}</span>
              )}
            </button>
          </li>

          <li>
            <button
              type="button"
              className={`cf-kumo-menu-link ${activeTab === "settings" ? "active" : ""}`}
              onClick={() => setActiveTab("settings")}
              aria-current={activeTab === "settings" ? "page" : undefined}
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
              color: proxyCount > 0 ? "var(--cf-green-5)" : "var(--kumo-subtle)",
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
  );
}
