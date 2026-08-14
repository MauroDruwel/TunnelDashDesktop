import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { SshAuth, SshConnectConfig, DEMO_MODE, sshClose, sshConnect, sshResize, sshWrite } from "../api";
import { Settings } from "../types";

type Status = "idle" | "connecting" | "connected";

export function TerminalScreen({
  settings,
  save,
}: {
  settings: Settings;
  save: (patch: Partial<Settings>) => void;
}) {
  const last = settings.sshLast;

  const [host, setHost] = useState(last?.host ?? "");
  const [port, setPort] = useState(last?.port ?? "22");
  const [username, setUsername] = useState(last?.username ?? "");
  const [authType, setAuthType] = useState<"password" | "key">(last?.authType ?? "password");
  const [password, setPassword] = useState("");
  const [keyPath, setKeyPath] = useState(last?.keyPath ?? "");
  const [passphrase, setPassphrase] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const unlistenRef = useRef<UnlistenFn[]>([]);
  const sessionRef = useRef<number | null>(null);

  const remember = useCallback(() => {
    save({
      sshLast: { host, port, username, authType, keyPath },
    } as Partial<Settings>);
  }, [host, port, username, authType, keyPath, save]);

  useEffect(() => {
    return () => {
      unlistenRef.current.forEach((fn) => fn());
      termRef.current?.dispose();
      termRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (DEMO_MODE && new URLSearchParams(window.location.search).has("connect")) {
      setStatus("connecting");
      const timer = window.setTimeout(() => void connect(), 60);
      return () => window.clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const teardown = useCallback(() => {
    unlistenRef.current.forEach((fn) => fn());
    unlistenRef.current = [];
    termRef.current?.dispose();
    termRef.current = null;
    fitRef.current = null;
    sessionRef.current = null;
    containerRef.current!.innerHTML = "";
  }, []);

  const connect = useCallback(async () => {
    if (!DEMO_MODE && (!host.trim() || !username.trim())) {
      setError("Host and username are required");
      return;
    }

    const auth: SshAuth =
      authType === "password"
        ? { type: "password", password }
        : {
            type: "key",
            keyPath: keyPath.trim() || undefined,
            passphrase: passphrase || undefined,
          };

    const container = containerRef.current!;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      fontSize: 13,
      scrollback: 4000,
      theme: {
        background: "#0c0f14",
        foreground: "#e6e9ef",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    const config: SshConnectConfig = {
      host: host.trim(),
      port: Math.min(65535, Math.max(1, Number(port) || 22)),
      username: username.trim(),
      auth,
      cols: term.cols,
      rows: term.rows,
    };

    setStatus("connecting");
    setError(null);
    remember();

    try {
      const id = await sshConnect(config);
      sessionRef.current = id;

      if (!DEMO_MODE) {
        const un1 = await listen<{ id: number; data: string }>("ssh-output", (ev) => {
          if (ev.payload.id === id) term.write(decodeB64(ev.payload.data));
        });
        const un2 = await listen<{ id: number; error?: string | null }>("ssh-closed", (ev) => {
          if (ev.payload.id !== id) return;
          if (ev.payload.error) setError(ev.payload.error);
          term.write("\r\n\x1b[90m[connection closed]\x1b[0m\r\n");
          teardown();
          setStatus("idle");
        });
        unlistenRef.current = [un1, un2];
      }

      term.onData((data) => {
        if (sessionRef.current !== null) void sshWrite(sessionRef.current!, encodeB64(data)).catch(() => {});
      });
      term.onResize(({ cols, rows }) => {
        if (sessionRef.current !== null) void sshResize(sessionRef.current!, cols, rows).catch(() => {});
      });

      if (DEMO_MODE) {
        term.write(demoShellOutput(term.cols));
      }
      term.focus();

      setStatus("connected");
    } catch (err) {
      teardown();
      setStatus("idle");
      setError(err instanceof Error ? err.message : "SSH connection failed");
    }
  }, [host, port, username, authType, password, keyPath, passphrase, remember, teardown]);

  const disconnect = useCallback(() => {
    if (sessionRef.current !== null) void sshClose(sessionRef.current!).catch(() => {});
    teardown();
    setStatus("idle");
  }, [teardown]);

  const connected = status === "connected";

  return (
    <div className="stack ssh-screen">
      <div className="row between">
        <div>
          <p className="eyebrow">Terminal</p>
          <h1>SSH client</h1>
        </div>
        {connected && (
          <button className="danger-btn" onClick={disconnect}>
            Disconnect
          </button>
        )}
      </div>

      {error && <div className="callout error">{error}</div>}

      {!connected ? (
        <form
          className="ssh-form"
          hidden={status === "connecting"}
          onSubmit={(e) => {
            e.preventDefault();
            void connect();
          }}
        >
          <div className="ssh-grid">
            <label className="field">
              <span>Host</span>
              <input
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="example.com"
                autoComplete="off"
              />
            </label>
            <label className="field ssh-port">
              <span>Port</span>
              <input
                type="number"
                value={port}
                min={1}
                max={65535}
                onChange={(e) => setPort(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Username</span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="root"
                autoComplete="off"
              />
            </label>
          </div>

          <div className="ssh-auth">
            <button
              type="button"
              className={`pill-btn ${authType === "password" ? "on" : ""}`}
              onClick={() => setAuthType("password")}
            >
              Password
            </button>
            <button
              type="button"
              className={`pill-btn ${authType === "key" ? "on" : ""}`}
              onClick={() => setAuthType("key")}
            >
              Private key
            </button>
          </div>

          {authType === "password" ? (
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="off"
              />
            </label>
          ) : (
            <>
              <label className="field">
                <span>Key file path</span>
                <input
                  type="text"
                  value={keyPath}
                  onChange={(e) => setKeyPath(e.target.value)}
                  placeholder="~/.ssh/id_ed25519"
                  autoComplete="off"
                />
              </label>
              <label className="field">
                <span>Key passphrase (optional)</span>
                <input
                  type="password"
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  autoComplete="off"
                />
              </label>
            </>
          )}

          <div className="actions">
            <button className="primary" disabled={status === "connecting"}>
              {status === "connecting" ? "Connecting..." : "Connect"}
            </button>
          </div>
          <p className="muted">
            Tip: start a tunnel in the Tunnels tab, then connect with host <code>localhost</code> and
            the mapped local port.
          </p>
        </form>
      ) : (
        <div className="terminal-wrap" ref={containerRef} />
      )}
      {status === "connecting" && <div className="terminal-wrap" ref={containerRef} />}
    </div>
  );
}

function demoShellOutput(_cols: number): string {
  const line = (s: string) => `${s}\r\n`;
  return (
    line("Welcome to Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0-51-generic x86_64)")
    + line("")
    + line(" * Documentation:  https://help.ubuntu.com")
    + line(" * Management:     https://landscape.canonical.com")
    + line(" * Support:        https://ubuntu.com/pro")
    + line("")
    + line("Last login: Fri Aug 14 09:12:07 2026 from 10.0.0.24")
    + line("")
    + "user@prod-db:~$ \x1b[0m"
  );
}

function encodeB64(data: string): string {  const bytes = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) bytes[i] = data.charCodeAt(i) & 0xff;
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

function decodeB64(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  let out = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return out;
}
