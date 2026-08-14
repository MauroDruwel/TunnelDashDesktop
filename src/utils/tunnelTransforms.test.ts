import { describe, expect, it } from "vitest";
import {
  buildConfigsForTunnel,
  filterAndSortTunnels,
  isHttpProtocol,
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

describe("buildConfigsForTunnel", () => {
  it("builds configs from ingress rules and skips http_status", () => {
    const tunnel: TunnelSummary = { id: "t", name: "n", portMap: [{ host: "ssh", port: 50000, proto: "ssh" }] };
    const configs = buildConfigsForTunnel(tunnel, [
      { service: "ssh://localhost:22", hostname: "ssh.example.com" },
      { service: "http_status:404", hostname: "catch.example.com" },
    ]);
    expect(configs).toEqual([
      { service: "ssh://localhost:22", proto: "ssh", host: "ssh.example.com", hostname: "ssh.example.com", port: 50000 },
    ]);
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
