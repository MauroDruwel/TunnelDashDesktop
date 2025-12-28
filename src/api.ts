import { invoke } from "@tauri-apps/api/core";
export type Account = { id: string; name: string };
export type Tunnel = {
  id: string;
  name: string;
  status?: string;
  created_at?: string;
  metadata?: Record<string, unknown>;
};

export type TunnelConfig = {
  result?: {
    config?: {
      ingress?: Array<{ service?: string }>;
    };
  };
};

export type CloudflareList<T> = {
  success?: boolean;
  errors?: Array<{ message?: string }>;
  result?: T;
};

export async function fetchAccounts(token: string): Promise<Account[]> {
  const res = await invoke<CloudflareList<Account[]>>("cf_accounts", { token });
  return unwrapResult(res);
}

export async function fetchTunnels(token: string, accountId: string): Promise<Tunnel[]> {
  const res = await invoke<CloudflareList<Tunnel[]>>("cf_tunnels", { token, accountId });
  return unwrapResult(res);
}

export async function fetchTunnelConfig(token: string, accountId: string, tunnelId: string): Promise<TunnelConfig> {
  const data = await invoke<TunnelConfig>("cf_tunnel_config", { token, accountId, tunnelId });
  return data || {};
}

export async function startTunnel(hostname: string, localPort: number) {
  return invoke("start_tunnel", { hostname, localPort });
}

export async function stopTunnel(hostname: string) {
  return invoke("stop_tunnel", { hostname });
}

function formatError(data: any): string {
  const msg = data?.errors?.[0]?.message;
  return msg || "Cloudflare request failed";
}

function unwrapResult<T>(res: CloudflareList<T>): T {
  if (res?.errors?.length) {
    throw new Error(formatError(res));
  }
  return res?.result || ([] as unknown as T);
}
