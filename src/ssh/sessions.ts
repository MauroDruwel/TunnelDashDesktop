import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { DEMO_MODE, sshClose, sshConnect, type SshSessionConfig } from "../api";
import { errMsg } from "../utils/errors";

export type SshSession = {
  id: number;
  label: string;
  status: "connecting" | "connected" | "closed";
  error?: string;
};

export function useSshSessions() {
  const [sessions, setSessions] = useState<SshSession[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);

  useEffect(() => {
    if (DEMO_MODE && new URLSearchParams(window.location.search).has("session")) {
      const demo: SshSession = {
        id: 1,
        label: "demo@prod-db.corp.example.com",
        status: "connected",
      };
      setSessions([demo]);
      setActiveId(1);
    }
  }, []);

  useEffect(() => {
    let un: (() => void) | undefined;
    if (!DEMO_MODE) {
      listen<{ id: number; error?: string | null }>("ssh-closed", (ev) => {
        setSessions((prev) =>
          prev.map((s) =>
            s.id === ev.payload.id
              ? { ...s, status: "closed" as const, error: ev.payload.error ?? undefined }
              : s
          )
        );
      }).then((fn) => {
        un = fn;
      });
    }
    return () => {
      un?.();
    };
  }, []);

  const startSession = useCallback(
    async (config: SshSessionConfig): Promise<number> => {
      const label = config.username ? `${config.username}@${config.host}` : config.host;
      let id: number;
      try {
        id = await sshConnect(config);
      } catch (err) {
        const message = errMsg(err, "SSH connection failed");
        throw new Error(message);
      }
      const session: SshSession = { id, label, status: "connected" };
      setSessions((prev) => [...prev, session]);
      setActiveId(id);
      return id;
    },
    []
  );

  const closeSession = useCallback((id: number) => {
    void sshClose(id).catch(() => {});
    setSessions((prev) => prev.filter((s) => s.id !== id));
    setActiveId((cur) => (cur === id ? null : cur));
  }, []);

  const activeSession = sessions.find((s) => s.id === activeId) ?? null;

  return { sessions, activeId, setActiveId, activeSession, startSession, closeSession };
}
