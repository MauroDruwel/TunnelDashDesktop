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

export type Settings = {
  apiKey: string;
  accountId?: string;
  accountName?: string;
  portStart: string;
  hideHttp: boolean;
  hideIp: boolean;
  hideOffline: boolean;
};
