import { Settings } from "../types";

export const DEFAULT_SETTINGS: Settings = {
  apiKey: "",
  accountId: undefined,
  accountName: undefined,
  portStart: "50000",
  hideHttp: false,
  hideIp: false,
  hideOffline: false,
  tunnelDescription: "id",
};

export type PersistedSettings = Settings & { verified?: boolean };

const STORAGE_KEY = "tunneldash:settings";
const STORE_FILE = "settings.json";
const STORE_KEY = "settings";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function readStored(): Promise<PersistedSettings | null> {
  if (isTauri()) {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load(STORE_FILE, { autoSave: true });
    const value = await store.get<PersistedSettings>(STORE_KEY);
    return value ?? null;
  }
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return null;
  try {
    return JSON.parse(saved) as PersistedSettings;
  } catch (e) {
    console.warn("could not read saved settings", e);
    return null;
  }
}

async function writeStored(payload: PersistedSettings): Promise<void> {
  if (isTauri()) {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load(STORE_FILE, { autoSave: true });
    await store.set(STORE_KEY, payload);
    await store.save();
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

async function clearStored(): Promise<void> {
  if (isTauri()) {
    const { load } = await import("@tauri-apps/plugin-store");
    const store = await load(STORE_FILE, { autoSave: true });
    await store.delete(STORE_KEY);
    await store.save();
    return;
  }
  localStorage.removeItem(STORAGE_KEY);
}

export async function loadSettings(): Promise<{ settings: Settings; verified: boolean }> {
  const saved = await readStored();
  if (!saved) return { settings: DEFAULT_SETTINGS, verified: false };
  return {
    settings: { ...DEFAULT_SETTINGS, ...saved },
    verified: Boolean(saved.verified),
  };
}

export async function persistSettings(settings: Settings, verified: boolean): Promise<void> {
  const payload: PersistedSettings = { ...settings, verified };
  await writeStored(payload);
}

export async function clearStoredSettings(): Promise<void> {
  await clearStored();
}
