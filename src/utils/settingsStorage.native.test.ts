import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import { clearStoredSettings, DEFAULT_SETTINGS, loadSettings, persistSettings } from "./settingsStorage";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-store", () => ({ load: vi.fn() }));

const store = { get: vi.fn(), set: vi.fn(), save: vi.fn(), delete: vi.fn() };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  vi.mocked(load).mockResolvedValue(store as unknown as Awaited<ReturnType<typeof load>>);
});
afterEach(() => vi.unstubAllGlobals());

it("migrates a verified token before removing it from the preference file", async () => {
  store.get.mockResolvedValue({ apiKey: "legacy-secret", accountId: "account", verified: true });
  vi.mocked(invoke).mockResolvedValueOnce(null).mockResolvedValueOnce(undefined);

  const { settings, verified } = await loadSettings();
  expect(verified).toBe(true);
  expect(settings.apiKey).toBe("legacy-secret");
  expect(vi.mocked(invoke)).toHaveBeenLastCalledWith("write_api_token", { token: "legacy-secret" });
  expect(store.set).toHaveBeenCalledWith("settings", { accountId: "account", verified: true });
  expect(vi.mocked(invoke).mock.invocationCallOrder[1]).toBeLessThan(store.set.mock.invocationCallOrder[0]);
});

it("preserves legacy data if the credential store refuses migration", async () => {
  store.get.mockResolvedValue({ apiKey: "legacy-secret" });
  vi.mocked(invoke).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("locked"));
  await expect(loadSettings()).rejects.toThrow("locked");
  expect(store.set).not.toHaveBeenCalled();
  expect(store.save).not.toHaveBeenCalled();
});

it("does not let preference changes replace credentials or write them to disk", async () => {
  await persistSettings({ ...DEFAULT_SETTINGS, apiKey: "stale-secret" }, true);
  expect(invoke).not.toHaveBeenCalled();
  const payload = store.set.mock.calls[0][1];
  expect(payload).not.toHaveProperty("apiKey");
});

it("stores only a verified replacement in the credential store and removes it on reset", async () => {
  await persistSettings({ ...DEFAULT_SETTINGS, apiKey: "new-secret" }, true, true);
  expect(invoke).toHaveBeenCalledWith("write_api_token", { token: "new-secret" });
  expect(store.set.mock.calls[0][1]).not.toHaveProperty("apiKey");
  await clearStoredSettings();
  expect(store.delete).toHaveBeenCalledWith("settings");
  expect(invoke).toHaveBeenLastCalledWith("write_api_token", { token: "" });
});

it("rolls back a credential replacement when saving preferences fails", async () => {
  const original = { accountId: "old-account", verified: true };
  store.get.mockResolvedValue(original);
  vi.mocked(invoke).mockResolvedValueOnce("old-secret");
  store.save.mockRejectedValueOnce(new Error("disk unavailable"));
  await expect(persistSettings({ ...DEFAULT_SETTINGS, apiKey: "new-secret" }, true, true))
    .rejects.toThrow("disk unavailable");
  expect(invoke).toHaveBeenLastCalledWith("write_api_token", { token: "old-secret" });
  expect(store.set).toHaveBeenLastCalledWith("settings", original);
});

it("leaves preferences alone if keychain deletion fails", async () => {
  vi.mocked(invoke).mockResolvedValueOnce("old-secret").mockRejectedValueOnce(new Error("locked"));
  await expect(clearStoredSettings()).rejects.toThrow("locked");
  expect(store.delete).not.toHaveBeenCalled();
});
