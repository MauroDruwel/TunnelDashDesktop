import { invoke } from "@tauri-apps/api/core";
import type { TunnelCommandDetails } from "./types";
export type Account = { id: string; name: string };
export type Tunnel = {
  id: string;
  name: string;
  status?: string;
  created_at?: string;
  metadata?: Record<string, unknown>;
  connections?: Array<{
    id?: string;
    uuid?: string;
    colo_name?: string;
    origin_ip?: string;
    client_version?: string;
    opened_at?: string;
    is_pending_reconnect?: boolean;
  }>;
};

export type TunnelConfig = {
  result?: {
    config?: {
      ingress?: Array<{ service?: string; hostname?: string }>;
    };
  };
};

export type CloudflareList<T> = {
  success?: boolean;
  errors?: Array<{ message?: string }>;
  result?: T;
};

// `?demo` renders the UI with mock data - used for screenshots and docs.
export const DEMO_MODE =
  typeof window !== "undefined" &&
  typeof window.location !== "undefined" &&
  new URLSearchParams(window.location.search).has("demo");

function demoDelay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), 350));
}

const DEMO_TUNNELS: Tunnel[] = [
  {
    id: "tunnel-prod-db",
    name: "prod-db",
    status: "healthy",
    created_at: "2024-03-12T10:00:00Z",
    metadata: { tunneldashPort: { "ssh-prod-db": 50000 } },
    connections: [
      { colo_name: "BRU", origin_ip: "172.70.110.4", client_version: "2026.7.1", opened_at: "2026-08-14T06:12:00Z" },
      { colo_name: "FRA", origin_ip: "172.71.30.9", client_version: "2026.7.1", opened_at: "2026-08-14T06:12:01Z" },
    ],
  },
  {
    id: "tunnel-web-staging",
    name: "web-staging",
    status: "healthy",
    created_at: "2024-05-01T10:00:00Z",
    metadata: { tunneldashPort: { "http-web-staging": 50001 } },
    connections: [
      { colo_name: "BRU", origin_ip: "172.70.98.21", client_version: "2026.6.0", opened_at: "2026-08-14T06:10:00Z" },
    ],
  },
  {
    id: "tunnel-backup-nas",
    name: "backup-nas",
    status: "down",
    created_at: "2023-11-20T10:00:00Z",
    metadata: {},
    connections: [],
  },
];

const DEMO_CONFIGS: Record<string, TunnelConfig> = {
  "tunnel-prod-db": {
    result: {
      config: {
        ingress: [
          { service: "ssh://localhost:22", hostname: "prod-db.corp.example.com" },
          { service: "tcp://localhost:5432", hostname: "prod-db-postgres.corp.example.com" },
        ],
      },
    },
  },
  "tunnel-web-staging": {
    result: {
      config: {
        ingress: [
          { service: "http://localhost:8080", hostname: "staging.example.com" },
          { service: "https://localhost:8443", hostname: "staging-api.example.com" },
        ],
      },
    },
  },
};

export async function fetchAccounts(token: string): Promise<Account[]> {
  if (DEMO_MODE) return demoDelay([{ id: "demo-account", name: "Demo Corp" }]);
  const res = await invoke<CloudflareList<Account[]>>("cf_accounts", { token });
  return unwrapResult(res);
}

export async function fetchTunnels(token: string, accountId: string): Promise<Tunnel[]> {
  if (DEMO_MODE) return demoDelay(DEMO_TUNNELS);
  const res = await invoke<CloudflareList<Tunnel[]>>("cf_tunnels", { token, accountId });
  return unwrapResult(res);
}

export async function fetchTunnelConfig(token: string, accountId: string, tunnelId: string): Promise<TunnelConfig> {
  if (DEMO_MODE) return demoDelay(DEMO_CONFIGS[tunnelId] ?? { result: { config: { ingress: [] } } });
  const data = await invoke<TunnelConfig>("cf_tunnel_config", { token, accountId, tunnelId });
  return data || {};
}

/**
 * Persist auto-assigned ports into tunnel metadata (same shape as mobile):
 * `{ tunneldashPort: { "hostname": port, ... } }`.
 * Requires Cloudflare Tunnel:Edit. 403 is non-fatal (ports still work in-session).
 */
export async function updateTunnelMetadata(
  token: string,
  accountId: string,
  tunnelId: string,
  metadata: Record<string, unknown>
): Promise<void> {
  if (DEMO_MODE) return;
  await invoke("cf_update_tunnel_metadata", { token, accountId, tunnelId, metadata });
}

export async function fetchCloudflaredVersion(): Promise<string> {
  if (DEMO_MODE) return demoDelay("cloudflared version 2026.8.2");
  return invoke<string>("cloudflared_version");
}

export async function startTunnel(hostname: string, localPort: number, protocol?: string) {
  if (DEMO_MODE) return;
  return invoke("start_tunnel", { hostname, localPort, protocol });
}

export async function stopTunnel(hostname: string) {
  if (DEMO_MODE) return;
  return invoke("stop_tunnel", { hostname });
}

export async function getTunnelCommand(
  hostname: string,
  localPort: number,
  protocol?: string
): Promise<TunnelCommandDetails> {
  if (DEMO_MODE) {
    const sub = (protocol || "tcp").toLowerCase();
    return {
      hostname,
      local_port: localPort,
      protocol: sub,
      binary: "/usr/local/bin/cloudflared",
      command: `/usr/local/bin/cloudflared access ${sub} --hostname ${hostname} --url localhost:${localPort}`,
      args: ["access", sub, "--hostname", hostname, "--url", `localhost:${localPort}`],
      running: false,
      log_path: `~/.tunneldash/logs/cloudflared-${hostname}.log`,
    };
  }
  return invoke<TunnelCommandDetails>("get_tunnel_command", { hostname, localPort, protocol });
}

export async function getTunnelLogs(hostname: string, limit?: number): Promise<string[]> {
  if (DEMO_MODE) {
    return [
      `[demo] 2026-09-19T19:00:00Z INF Starting tunnel ${hostname}`,
      `[demo] 2026-09-19T19:00:01Z INF Proxying to Cloudflare edge`,
      `[demo] 2026-09-19T19:00:02Z INF Ready for connections`,
    ];
  }
  return invoke<string[]>("get_tunnel_logs", { hostname, limit });
}

export async function launchRdp(host: string, port: number): Promise<void> {
  if (DEMO_MODE) return;
  return invoke("launch_rdp", { host, port });
}

export async function launchSmb(host: string, port: number): Promise<void> {
  if (DEMO_MODE) return;
  return invoke("launch_smb", { host, port });
}

export type SshCredentialInfo = {
  username?: string | null;
  hasPassword: boolean;
  hasKey: boolean;
  authType?: string | null;
  keyPath?: string | null;
};

export type SshConfigStatus = {
  configPath: string;
  fileExists: boolean;
  managedHosts: string[];
  cloudflaredCommand: string;
};

export type SshHostConfig = {
  host: string;
  alias?: string;
  hostname?: string;
  username?: string;
  keyPath?: string;
};

export type SshCredentialInput = {
  host: string;
  username: string;
  password?: string;
  keyPath?: string;
  keyPassphrase?: string;
};

export async function sshSaveCredential(input: SshCredentialInput) {
  if (DEMO_MODE) return;
  return invoke("ssh_save_credential", {
    host: input.host,
    username: input.username,
    password: input.password ?? null,
    keyPath: input.keyPath ?? null,
    keyPassphrase: input.keyPassphrase ?? null,
  });
}

export async function sshGetCredential(host: string): Promise<SshCredentialInfo> {
  if (DEMO_MODE)
    return demoDelay({ username: "demo", hasPassword: true, hasKey: false, authType: "password" });
  return invoke<SshCredentialInfo>("ssh_get_credential", { host });
}

export async function sshDeleteCredential(host: string) {
  if (DEMO_MODE) return;
  return invoke("ssh_delete_credential", { host });
}

export type SshCredentialSummary = {
  host: string;
  username?: string | null;
  hasPassword: boolean;
  hasKey: boolean;
};

export async function sshListCredentials(candidateHosts: string[]): Promise<SshCredentialSummary[]> {
  if (DEMO_MODE)
    return demoDelay([
      { host: "legacy-jumpbox.corp.example.com", username: "ops", hasPassword: false, hasKey: true },
    ]);
  return invoke<SshCredentialSummary[]>("ssh_list_credentials", { hosts: candidateHosts });
}

// ─── Credential sync (encrypted vault inside tunnel metadata) ────────────────

export type SyncMode = "token" | "passphrase";

export type SshFullCredential = {
  host: string;
  username: string;
  password?: string | null;
  keyPath?: string | null;
  keyPassphrase?: string | null;
};

export type SyncVault = {
  v: number;
  mode: SyncMode;
  kdf: { alg: string; salt: string; iter: number };
  creds: Record<string, string>;
};

/** Full local secrets (macOS enumerates every entry; elsewhere pass known hosts). */
export async function sshExportLocal(candidateHosts: string[]): Promise<SshFullCredential[]> {
  if (DEMO_MODE) return demoDelay([]);
  return invoke<SshFullCredential[]>("ssh_export_local", { hosts: candidateHosts });
}

export async function sshSyncBuildVault(
  mode: SyncMode,
  secret: string,
  salt: string | null,
  creds: SshFullCredential[]
): Promise<SyncVault> {
  if (DEMO_MODE)
    return demoDelay({
      v: 1,
      mode,
      kdf: { alg: "pbkdf2-sha256", salt: "ZGVtb3NhbHQ=", iter: 600000 },
      creds: Object.fromEntries(creds.map((c) => [c.host.toLowerCase(), "ZGVtb2Jsb2I="])),
    });
  return invoke<SyncVault>("ssh_sync_build_vault", { mode, secret, salt, creds });
}

export async function sshSyncOpenVault(
  mode: SyncMode,
  secret: string,
  vault: SyncVault
): Promise<SshFullCredential[]> {
  if (DEMO_MODE) return demoDelay([]);
  return invoke<SshFullCredential[]>("ssh_sync_open_vault", { mode, secret, vault });
}

export async function sshGetConfigStatus(): Promise<SshConfigStatus> {
  if (DEMO_MODE)
    return demoDelay({
      configPath: "~/.ssh/config",
      fileExists: true,
      managedHosts: ["prod-db.corp.example.com"],
      cloudflaredCommand: "cloudflared",
    });
  return invoke<SshConfigStatus>("ssh_get_config_status");
}

export async function sshSyncConfig(hosts: SshHostConfig[]): Promise<SshConfigStatus> {
  if (DEMO_MODE)
    return demoDelay({
      configPath: "~/.ssh/config",
      fileExists: true,
      managedHosts: hosts.map((h) => h.hostname || h.host),
      cloudflaredCommand: "cloudflared",
    });
  return invoke<SshConfigStatus>("ssh_sync_config", { hosts });
}

export async function sshRemoveFromConfig(hosts: string[]): Promise<SshConfigStatus> {
  if (DEMO_MODE)
    return demoDelay({
      configPath: "~/.ssh/config",
      fileExists: true,
      managedHosts: [],
      cloudflaredCommand: "cloudflared",
    });
  return invoke<SshConfigStatus>("ssh_remove_from_config", { hosts });
}

export async function sshPreviewConfig(hosts: SshHostConfig[]): Promise<string> {
  if (DEMO_MODE)
    return demoDelay("# TunnelDash SSH preview\nHost example.com\n  ProxyCommand cloudflared access ssh --hostname %h");
  return invoke<string>("ssh_preview_config", { hosts });
}

export async function launchTerminal(command: string): Promise<void> {
  if (DEMO_MODE) return;
  return invoke("launch_terminal", { command });
}

export async function openUrl(url: string): Promise<void> {
  if (DEMO_MODE) {
    window.open(url, "_blank");
    return;
  }
  try {
    await invoke("open_url", { url });
  } catch {
    window.open(url, "_blank");
  }
}

function formatError(data: CloudflareList<unknown>): string {
  const msg = data?.errors?.[0]?.message;
  return msg || "Cloudflare request failed";
}

function unwrapResult<T>(res: CloudflareList<T>): T {
  if (res?.errors?.length) {
    throw new Error(formatError(res));
  }
  return res?.result || ([] as unknown as T);
}
