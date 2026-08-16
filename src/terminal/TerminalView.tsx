import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { DEMO_MODE, sshResize, sshWrite } from "../api";
import type { SshSession } from "../ssh/sessions";

const MONO = 'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';

export function TerminalView({ session, active }: { session: SshSession; active: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: MONO,
      fontSize: 13,
      scrollback: 4000,
      theme: {
        background: "#101014",
        foreground: "#e8e8ed",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    let un1: UnlistenFn | undefined;
    let un2: UnlistenFn | undefined;
    if (!DEMO_MODE) {
      Promise.all([
        listen<{ id: number; data: string }>("ssh-output", (ev) => {
          if (ev.payload.id === session.id) term.write(decodeB64(ev.payload.data));
        }),
        listen<{ id: number; error?: string | null }>("ssh-closed", (ev) => {
          if (ev.payload.id === session.id) {
            term.write("\r\n\x1b[90m[connection closed]\x1b[0m\r\n");
          }
        }),
      ]).then(([a, b]) => {
        un1 = a;
        un2 = b;
      });
    } else {
      term.write(demoShellOutput());
    }

    const onData = (data: string) => {
      void sshWrite(session.id, encodeB64(data)).catch(() => {});
    };
    const onResize = ({ cols, rows }: { cols: number; rows: number }) => {
      void sshResize(session.id, cols, rows).catch(() => {});
    };
    term.onData(onData);
    term.onResize(onResize);
    term.focus();

    return () => {
      un1?.();
      un2?.();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [session.id]);

  useEffect(() => {
    if (active) {
      fitRef.current?.fit();
      termRef.current?.focus();
    }
  }, [active]);

  return <div className="terminal-wrap" ref={containerRef} />;
}

function demoShellOutput(): string {
  const line = (s: string) => `${s}\r\n`;
  return (
    line("Welcome to Ubuntu 24.04.1 LTS (GNU/Linux 6.8.0-51-generic x86_64)")
    + line("")
    + line(" * Documentation:  https://help.ubuntu.com")
    + line(" * Management:     https://landscape.canonical.com")
    + line("")
    + line("Last login: Fri Aug 14 09:12:07 2026 from 10.0.0.24")
    + line("")
    + "user@prod-db:~$ \x1b[0m"
  );
}

function encodeB64(data: string): string {
  const bytes = new Uint8Array(data.length);
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
