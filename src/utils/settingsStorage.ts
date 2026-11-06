import { Settings } from "../types";
import { invoke } from "@tauri-apps/api/core";

export const DEFAULT_SETTINGS: Settings = {
  apiKey: "",
  accountId: undefined,
  accountName: undefined,
  portStart: "50000",
  hideHttp: false,
  hideIp: false,
  hideOffline: false,
  tunnelDescription: "id",
  autoSyncSshConfig: true,
  defaultSshUser: "",
  defaultSshKeyPath: "",
};

export type PersistedSettings = Settings & { verified?: boolean };

const STORAGE_KEY = "tunneldash:settings";
const STORE_FILE = "settings.json";
const STORE_KEY = "settings";
let browserToken = "";
let pending: Promise<unknown> = Promise.resolve();

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation);
  pending = result.catch(() => undefined);
  return result;
}

function isTauri(): boolean {
  return typeof window !== "undefined"
    && "__TAURI_INTERNALS__" in window
    && !new URLSearchParams(window.location?.search).has("demo");
}

async function readStored(): Promise<PersistedSettings | null> {
  if (isTauri()) {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load(STORE_FILE, { autoSave: false });
    const value = await store.get<PersistedSettings>(STORE_KEY);
    if (!value) return null;
    const { apiKey: legacy, ...preferences } = value;
    let token = await invoke<string | null>("read_api_token");
    if (legacy !== undefined) {
      if (!token && legacy) {
        await invoke("write_api_token", { token: legacy });
        token = legacy;
      }
      await store.set(STORE_KEY, preferences);
      try {
        await store.save();
      } catch (error) {
        await store.set(STORE_KEY, value);
        throw error;
      }
    }
    return { ...preferences, apiKey: token ?? "" };
  }
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return null;
  try {
    const { apiKey: legacy, ...preferences } = JSON.parse(saved) as PersistedSettings;
    if (legacy !== undefined) localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
    return { ...preferences, apiKey: browserToken };
  } catch (e) {
    console.warn("could not read saved settings", e);
    return null;
  }
}

async function writeStored(payload: PersistedSettings, updateToken: boolean): Promise<void> {
  const { apiKey, ...preferences } = payload;
  if (isTauri()) {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load(STORE_FILE, { autoSave: false });
    const previous = await store.get<PersistedSettings>(STORE_KEY);
    if (!updateToken && previous?.apiKey) {
      throw new Error("Load and migrate existing credentials before saving settings");
    }
    const previousToken = updateToken ? await invoke<string | null>("read_api_token") : null;
    if (updateToken) await invoke("write_api_token", { token: apiKey });
    try {
      await store.set(STORE_KEY, preferences);
      await store.save();
    } catch (error) {
      if (updateToken) await invoke("write_api_token", { token: previousToken ?? "" });
      if (previous) await store.set(STORE_KEY, previous);
      else await store.delete(STORE_KEY);
      throw error;
    }
    return;
  }
  if (updateToken) browserToken = apiKey;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
}

async function clearStored(): Promise<void> {
  if (isTauri()) {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load(STORE_FILE, { autoSave: false });
    const previous = await store.get<PersistedSettings>(STORE_KEY);
    const previousToken = await invoke<string | null>("read_api_token");
    await invoke("write_api_token", { token: "" });
    try {
      await store.delete(STORE_KEY);
      await store.save();
    } catch (error) {
      if (previousToken) await invoke("write_api_token", { token: previousToken });
      if (previous) await store.set(STORE_KEY, previous);
      throw error;
    }
    return;
  }
  browserToken = "";
  localStorage.removeItem(STORAGE_KEY);
}

export async function loadSettings(): Promise<{ settings: Settings; verified: boolean }> {
  const saved = await serialize(readStored);
  if (!saved) return { settings: DEFAULT_SETTINGS, verified: false };
  const { verified, ...rest } = saved;
  return {
    settings: { ...DEFAULT_SETTINGS, ...(rest as Settings) },
    verified: Boolean(verified && rest.apiKey),
  };
}

export async function persistSettings(settings: Settings, verified: boolean, updateToken = false): Promise<void> {
  const payload: PersistedSettings = { ...settings, verified };
  await serialize(() => writeStored(payload, updateToken));
}

export async function clearStoredSettings(): Promise<void> {
  await serialize(clearStored);
}
