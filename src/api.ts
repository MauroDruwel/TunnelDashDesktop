import { invoke } from "@tauri-apps/api/core";
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

export type SshCredentialInfo = {
  username?: string | null;
  hasPassword: boolean;
};

export type SshOpenRequest = {
  host: string;
  port: number;
  username?: string;
  password?: string;
  useSaved: boolean;
};

export async function sshSaveCredential(host: string, username: string, password: string) {
  if (DEMO_MODE) return;
  return invoke("ssh_save_credential", { host, username, password });
}

export async function sshGetCredential(host: string): Promise<SshCredentialInfo> {
  if (DEMO_MODE)
    return demoDelay({ username: "demo", hasPassword: true });
  return invoke<SshCredentialInfo>("ssh_get_credential", { host });
}

export async function sshDeleteCredential(host: string) {
  if (DEMO_MODE) return;
  return invoke("ssh_delete_credential", { host });
}

export async function sshOpen(request: SshOpenRequest): Promise<string> {
  if (DEMO_MODE) return demoDelay("ssh -p 50000 demo@localhost");
  return invoke<string>("ssh_open", { request });
}

export type SshSessionConfig = {
  host: string;
  port: number;
  username?: string;
  password?: string;
  useSaved: boolean;
  cols?: number;
  rows?: number;
};

export async function sshConnect(config: SshSessionConfig): Promise<number> {
  if (DEMO_MODE) return demoDelay(1);
  return invoke<number>("ssh_connect", { config });
}

export async function sshWrite(id: number, data: string) {
  if (DEMO_MODE) return;
  return invoke("ssh_write", { id, data });
}

export async function sshResize(id: number, cols: number, rows: number) {
  if (DEMO_MODE) return;
  return invoke("ssh_resize", { id, cols, rows });
}

export async function sshClose(id: number) {
  if (DEMO_MODE) return;
  return invoke("ssh_close", { id });
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
