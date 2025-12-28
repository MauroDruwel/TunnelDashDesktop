import { Settings } from "../types";

export const STORAGE_KEY = "tunneldash:settings";

export const DEFAULT_SETTINGS: Settings = {
  apiKey: "",
  accountId: undefined,
  accountName: undefined,
  portStart: "50000",
  hideHttp: false,
  hideIp: false,
  hideOffline: false,
};

export type PersistedSettings = Settings & { verified?: boolean };

export function loadSettings(): { settings: Settings; verified: boolean } {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return { settings: DEFAULT_SETTINGS, verified: false };

  try {
    const parsed: PersistedSettings = JSON.parse(saved);
    return {
      settings: { ...DEFAULT_SETTINGS, ...parsed },
      verified: Boolean(parsed.verified),
    };
  } catch (e) {
    console.warn("could not read saved settings", e);
    return { settings: DEFAULT_SETTINGS, verified: false };
  }
}

export function persistSettings(settings: Settings, verified: boolean) {
  const payload: PersistedSettings = { ...settings, verified };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function clearStoredSettings() {
  localStorage.removeItem(STORAGE_KEY);
}
