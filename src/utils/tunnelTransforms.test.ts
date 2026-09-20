import { describe, expect, it } from "vitest";
import {
  assignLocalPorts,
  buildConfigsForTunnel,
  collectSshServers,
  deriveHostAlias,
  extractPortsFromMetadata,
  filterAndSortTunnels,
  isHttpProtocol,
  isTunnelOnline,
  mergeTunneldashPort,
  parseHost,
  parseProtocol,
  toTunnelSummary,
} from "./tunnelTransforms";
import type { Settings, TunnelSummary } from "../types";

describe("parseHost", () => {
  it("parses url-style services", () => {
    expect(parseHost("http://app.example.com:8080")).toBe("app.example.com:8080");
  });

  it("parses hostname-style services", () => {
    expect(parseHost("ssh://server.example.com")).toBe("server.example.com");
  });

  it("returns null for garbage", () => {
    expect(parseHost("")).toBeNull();
  });
});

describe("isHttpProtocol", () => {
  it("detects http and https", () => {
    expect(isHttpProtocol("http://a.b")).toBe(true);
    expect(isHttpProtocol("https://a.b")).toBe(true);
    expect(isHttpProtocol("ssh://a.b")).toBe(false);
  });
});

describe("parseProtocol", () => {
  it("extracts the scheme", () => {
    expect(parseProtocol("ssh://a.b")).toBe("ssh");
    expect(parseProtocol("https://a.b")).toBe("https");
    expect(parseProtocol("tcp")).toBe("tcp");
    expect(parseProtocol("rdp://192.168.1.50:3389")).toBe("rdp");
    expect(parseProtocol("smb://nas.local:445")).toBe("smb");
    expect(parseProtocol("unix:/tmp/test.sock")).toBe("unix");
    expect(parseProtocol("bastion")).toBe("bastion");
  });

  it("infers protocol from standard ports when scheme is omitted", () => {
    expect(parseProtocol("192.168.1.100:3389")).toBe("rdp");
    expect(parseProtocol("192.168.1.100:445")).toBe("smb");
    expect(parseProtocol("192.168.1.100:22")).toBe("ssh");
  });

  it("infers protocol from hostname prefix", () => {
    expect(parseProtocol("custom-service", "rdp-workstation.corp.com")).toBe("rdp");
    expect(parseProtocol("custom-service", "smb-share.corp.com")).toBe("smb");
  });
});

describe("toTunnelSummary", () => {
  it("maps cloudflare fields and connection info", () => {
    const t = {
      id: "t1",
      name: "web",
      status: "healthy",
      created_at: "2024-01-01T00:00:00Z",
      metadata: { tunneldashPort: 4000 },
      connections: [
        { origin_ip: "1.2.3.4", client_version: "2024.1.0", colo_name: "BRU" },
        { origin_ip: "1.2.3.4", client_version: "2024.1.0", colo_name: "FRA" },
      ],
    };
    const summary = toTunnelSummary(t as never);
    expect(summary.port).toBe(4000);
    expect(summary.connectionIp).toBe("1.2.3.4");
    expect(summary.connectionCount).toBe(2);
    expect(summary.coloNames).toEqual(["BRU", "FRA"]);
    expect(summary.clientVersion).toBe("2024.1.0");
  });

  it("parses per-host port maps", () => {
    const t = {
      id: "t2",
      name: "multi",
      metadata: { tunneldashPort: { "ssh-a": 50000, "http-b": 50001 } },
    };
    const summary = toTunnelSummary(t as never);
    expect(summary.portMap).toEqual([
      { host: "ssh-a", port: 50000, proto: "ssh" },
      { host: "http-b", port: 50001, proto: "http" },
    ]);
  });
});

describe("extractPortsFromMetadata", () => {
  it("reads nested tunneldashPort map with lowercased keys", () => {
    const map = extractPortsFromMetadata({ tunneldashPort: { "Ssh-A": 50000, "http-b": 50001 } });
    expect(map.get("ssh-a")).toBe(50000);
    expect(map.get("http-b")).toBe(50001);
  });

  it("falls back to flat metadata", () => {
    const map = extractPortsFromMetadata({ "ssh-a": "50000", tunneldashPort: undefined });
    expect(map.get("ssh-a")).toBe(50000);
  });

  it("ignores non-numeric values", () => {
    const map = extractPortsFromMetadata({ tunneldashPort: { "ssh-a": "nope" } });
    expect(map.size).toBe(0);
  });
});

describe("mergeTunneldashPort", () => {
  it("merges new ports into existing tunneldashPort and preserves others", () => {
    const merged = mergeTunneldashPort({ tunneldashPort: { "old-a": 50000 } }, { "new-b": 50001 });
    expect(merged).toEqual({ tunneldashPort: { "old-a": 50000, "new-b": 50001 } });
  });

  it("creates tunneldashPort when absent", () => {
    const merged = mergeTunneldashPort(undefined, { "a.example.com": 50000 });
    expect(merged).toEqual({ tunneldashPort: { "a.example.com": 50000 } });
  });
});

describe("buildConfigsForTunnel", () => {
  it("builds configs from ingress rules and skips http_status", () => {
    const tunnel: TunnelSummary = {
      id: "t",
      name: "n",
      portMap: [{ host: "ssh.example.com", port: 50000, proto: "ssh" }],
    };
    const configs = buildConfigsForTunnel(tunnel, [
      { service: "ssh://localhost:22", hostname: "ssh.example.com" },
      { service: "http_status:404", hostname: "catch.example.com" },
    ]);
    expect(configs).toEqual([
      { service: "ssh://localhost:22", proto: "ssh", host: "ssh.example.com", hostname: "ssh.example.com", port: 50000 },
    ]);
  });

  it("leaves port unset when no metadata map (filled by assignLocalPorts)", () => {
    const tunnel: TunnelSummary = { id: "t", name: "n" };
    const configs = buildConfigsForTunnel(tunnel, [
      { service: "ssh://localhost:22", hostname: "a.example.com" },
      { service: "tcp://localhost:5432", hostname: "b.example.com" },
    ]);
    expect(configs.map((c) => c.port)).toEqual([undefined, undefined]);
  });
});

describe("assignLocalPorts", () => {
  it("assigns sequential ports from portStart across all routes", () => {
    const tunnels: TunnelSummary[] = [
      {
        id: "t1",
        name: "a",
        configs: [
          { service: "ssh://x", hostname: "a.example.com" },
          { service: "tcp://y", hostname: "b.example.com" },
        ],
      },
      {
        id: "t2",
        name: "b",
        configs: [{ service: "http://z", hostname: "c.example.com" }],
      },
    ];
    const { tunnels: result, newAssignments } = assignLocalPorts(tunnels, 50000);
    expect(result[0].configs?.map((c) => c.port)).toEqual([50000, 50001]);
    expect(result[1].configs?.map((c) => c.port)).toEqual([50002]);
    expect(result[0].port).toBe(50000);
    // All routes were new -> recorded for Cloudflare persistence
    expect(newAssignments.get("t1")).toEqual({ "a.example.com": 50000, "b.example.com": 50001 });
    expect(newAssignments.get("t2")).toEqual({ "c.example.com": 50002 });
  });

  it("preserves unique metadata ports and fills the rest", () => {
    const tunnels: TunnelSummary[] = [
      {
        id: "t1",
        name: "a",
        configs: [
          { service: "ssh://x", hostname: "a.example.com", port: 51000 },
          { service: "tcp://y", hostname: "b.example.com" },
        ],
      },
    ];
    const { tunnels: result, newAssignments } = assignLocalPorts(tunnels, 50000);
    expect(result[0].configs?.map((c) => c.port)).toEqual([51000, 50000]);
    // Only the newly assigned route should be recorded
    expect(newAssignments.get("t1")).toEqual({ "b.example.com": 50000 });
  });

  it("avoids collisions when metadata reuses the start port", () => {
    const tunnels: TunnelSummary[] = [
      {
        id: "t1",
        name: "a",
        configs: [
          { service: "ssh://x", hostname: "a.example.com", port: 50000 },
          { service: "tcp://y", hostname: "b.example.com" },
        ],
      },
    ];
    const { tunnels: result } = assignLocalPorts(tunnels, 50000);
    expect(result[0].configs?.map((c) => c.port)).toEqual([50000, 50001]);
  });
});

describe("isTunnelOnline", () => {
  it("treats healthy/online as online", () => {
    expect(isTunnelOnline("healthy")).toBe(true);
    expect(isTunnelOnline("HEALTHY")).toBe(true);
    expect(isTunnelOnline("online")).toBe(true);
  });
  it("treats down/unknown/degraded as offline", () => {
    expect(isTunnelOnline("down")).toBe(false);
    expect(isTunnelOnline("idle")).toBe(false);
    expect(isTunnelOnline(undefined)).toBe(false);
  });
});

describe("collectSshServers", () => {
  const tunnels: TunnelSummary[] = [
    {
      id: "t1",
      name: "prod",
      status: "healthy",
      configs: [
        { service: "ssh://localhost:22", hostname: "ssh.prod.com", proto: "ssh" },
        { service: "https://localhost:443", hostname: "web.prod.com" },
        { service: "tcp://localhost:5432", hostname: "db.prod.com" },
      ],
    },
    {
      id: "t2",
      name: "staging",
      status: "down",
      configs: [{ service: "ssh://localhost:22", hostname: "ssh.staging.com", proto: "ssh" }],
    },
  ];

  it("collects only ssh routes and marks online status", () => {
    const servers = collectSshServers(tunnels);
    expect(servers).toHaveLength(2);
    expect(servers[0]).toMatchObject({
      tunnelId: "t1",
      host: "ssh.prod.com",
      hostname: "ssh.prod.com",
      online: true,
    });
    expect(servers[1]).toMatchObject({ tunnelId: "t2", host: "ssh.staging.com", online: false });
  });

  it("does not misclassify https as ssh", () => {
    const servers = collectSshServers(tunnels);
    expect(servers.some((s) => s.host === "web.prod.com")).toBe(false);
  });

  it("keys credentials by the host string", () => {
    const servers = collectSshServers(tunnels);
    expect(servers[0].key).toBe("t1::ssh.prod.com");
  });

  it("derives clean lowercase connected alias from tunnel name", () => {
    const servers = collectSshServers(tunnels);
    expect(servers[0].alias).toBe("prod");
    expect(servers[1].alias).toBe("staging");
  });
});

describe("deriveHostAlias", () => {
  it("derives lowercase connected alias from spaced tunnel name", () => {
    expect(deriveHostAlias("General Server", "ssh-generalserver.maurodruwel.be")).toBe("generalserver");
    expect(deriveHostAlias("Rpi Luc", "ssh-rpiluc.maurodruwel.be")).toBe("rpiluc");
  });

  it("handles prefixes and punctuation", () => {
    expect(deriveHostAlias("ssh-generalserver", "ssh-generalserver.maurodruwel.be")).toBe("generalserver");
    expect(deriveHostAlias("rpi-luc", "ssh-rpiluc.maurodruwel.be")).toBe("rpiluc");
  });

  it("falls back to hostname prefix when tunnel name is absent", () => {
    expect(deriveHostAlias(undefined, "ssh-generalserver.maurodruwel.be")).toBe("generalserver");
    expect(deriveHostAlias("", "ssh-rpiluc.maurodruwel.be")).toBe("rpiluc");
  });
});

describe("filterAndSortTunnels", () => {
  const settings: Settings = {
    apiKey: "x",
    portStart: "50000",
    hideHttp: false,
    hideIp: false,
    hideOffline: false,
  };

  it("hides http configs when requested and counts them", () => {
    const tunnels: TunnelSummary[] = [
      {
        id: "t1",
        name: "web",
        status: "healthy",
        configs: [
          { service: "http://a.example.com" },
          { service: "ssh://a.example.com", proto: "ssh" },
        ],
      },
    ];
    const result = filterAndSortTunnels(tunnels, { ...settings, hideHttp: true });
    expect(result[0].hiddenHttpCount).toBe(1);
    expect(result[0].displayConfigs?.map((c) => c.proto)).toEqual(["ssh"]);
  });

  it("filters offline tunnels and sorts healthy first", () => {
    const tunnels: TunnelSummary[] = [
      { id: "down", name: "down", status: "down" },
      { id: "up", name: "up", status: "healthy" },
    ];
    const result = filterAndSortTunnels(tunnels, { ...settings, hideOffline: true });
    expect(result.map((t) => t.id)).toEqual(["up"]);
  });

  it("strips ip info when requested", () => {
    const tunnels: TunnelSummary[] = [{ id: "t", name: "n", status: "healthy", connectionIp: "1.2.3.4" }];
    const result = filterAndSortTunnels(tunnels, { ...settings, hideIp: true });
    expect(result[0].connectionIp).toBeUndefined();
  });
});
