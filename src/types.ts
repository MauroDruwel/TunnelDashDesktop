export type ConfigInfo = {
  service: string;
  proto?: string;
  host?: string;
  port?: number;
  hostname?: string;
};

export type TunnelSummary = {
  id: string;
  name: string;
  status?: string;
  createdAt?: string;
  port?: number;
  service?: string;
  services?: string[];
  metadata?: Record<string, unknown>;
  displayConfigs?: ConfigInfo[];
  configs?: ConfigInfo[];
  hiddenHttpCount?: number;
  connectService?: string;
  connectHost?: string;
  portMap?: Array<{ host: string; port: number; proto?: string }>;
  connectionIp?: string;
  clientVersion?: string;
  connectionCount?: number;
  coloNames?: string[];
};

export type TunnelDescription = "id" | "ip" | "none";

export type SshServer = {
  /** Stable key: `${tunnelId}::${host}` */
  key: string;
  tunnelId: string;
  tunnelName: string;
  tunnelStatus?: string;
  online: boolean;
  hostname?: string;
  /** Clean alias: like the Cloudflare tunnel name, lowercase connected. */
  alias?: string;
  service?: string;
  port?: number;
  /** Keychain lookup key (same string used to save/load credentials). */
  host: string;
};

export type Settings = {
  apiKey: string;
  accountId?: string;
  accountName?: string;
  portStart: string;
  hideHttp: boolean;
  hideIp: boolean;
  hideOffline: boolean;
  tunnelDescription?: TunnelDescription;
  sshLast?: SshPrefs;
  /** Automatically sync SSH endpoints to ~/.ssh/config. Defaults to true. */
  autoSyncSshConfig?: boolean;
  /** Global default SSH username for ~/.ssh/config entries. */
  defaultSshUser?: string;
  /** Global default private key path (IdentityFile) for ~/.ssh/config entries (e.g. ~/.ssh/id_ed25519). */
  defaultSshKeyPath?: string;
  /** Last version we auto-opened the releases page for (update nag guard). */
  lastNudgedVersion?: string;
};

export type TunnelCommandDetails = {
  hostname: string;
  local_port: number;
  protocol: string;
  binary: string;
  command: string;
  args: string[];
  running: boolean;
  pid?: number;
  log_path: string;
};

export type SshPrefs = {
  host: string;
  port: string;
  username: string;
  keyPath?: string;
};
