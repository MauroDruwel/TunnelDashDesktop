import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearStoredSettings, DEFAULT_SETTINGS, loadSettings, persistSettings } from "./settingsStorage";

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).localStorage;
});

describe("settingsStorage", () => {
  it("returns defaults when nothing is stored", async () => {
    const { settings, verified } = await loadSettings();
    expect(verified).toBe(false);
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it("persists and reloads settings with verification flag", async () => {
    await persistSettings({ ...DEFAULT_SETTINGS, apiKey: "abc", accountId: "acct" }, true);
    const { settings, verified } = await loadSettings();
    expect(verified).toBe(true);
    expect(settings.apiKey).toBe("abc");
    expect(settings.accountId).toBe("acct");
  });

  it("clears stored settings", async () => {
    await persistSettings({ ...DEFAULT_SETTINGS, apiKey: "abc" }, true);
    await clearStoredSettings();
    const { settings, verified } = await loadSettings();
    expect(verified).toBe(false);
    expect(settings.apiKey).toBe("");
  });

  it("tolerates corrupt stored data", async () => {
    store.set("tunneldash:settings", "{not json");
    const { verified } = await loadSettings();
    expect(verified).toBe(false);
  });
});
