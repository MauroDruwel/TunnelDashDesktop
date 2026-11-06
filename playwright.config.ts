import { defineConfig } from "@playwright/test";

const url = "http://127.0.0.1:1426";
export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: url, trace: "retain-on-failure" },
  webServer: { command: "pnpm exec vite --host 127.0.0.1 --port 1426 --strictPort", url },
});
