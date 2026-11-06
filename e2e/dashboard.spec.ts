import { expect, test } from "@playwright/test";

test("setup rejects invalid ports and opens the dashboard after token verification", async ({ page }) => {
  await page.goto("/?demo&setup");
  await page.getByRole("button", { name: /Get Started/ }).click();
  const port = page.getByRole("spinbutton");
  const next = page.getByRole("button", { name: /Next: API Token/ });
  await port.fill("65536");
  await expect(next).toBeDisabled();
  await port.fill("51000");
  await next.click();
  const verify = page.getByRole("button", { name: /Verify & Launch/ });
  await expect(verify).toBeDisabled();
  await page.getByRole("button", { name: "Show API token" }).click();
  await expect(page.getByLabel("API Token", { exact: true })).toHaveAttribute("type", "text");
  await page.getByRole("button", { name: "Hide API token" }).click();
  await page.getByPlaceholder("Cloudflare API token").fill("fixture-token");
  await verify.click();
  await expect(page.getByText("prod-db.corp.example.com", { exact: true })).toBeVisible();
});

test("quick search leaves settings and focuses the tunnel filter", async ({ page }) => {
  await page.goto("/?demo&tab=settings");
  await expect(page.getByRole("heading", { name: "Settings & Access" })).toBeVisible();
  await page.getByRole("button", { name: "Quick search" }).click();
  const filter = page.getByRole("textbox", { name: "Search tunnels" });
  await expect(filter).toBeFocused();
  await page.getByRole("button", { name: "Settings & Access" }).click();
  await page.keyboard.press("Control+k");
  await expect(filter).toBeFocused();
});

test("dashboard loads fixture tunnels and navigates to settings and back", async ({ page }) => {
  await page.goto("/?demo");
  const endpoint = page.getByText("prod-db.corp.example.com", { exact: true });
  await expect(endpoint).toBeVisible();
  await page.getByRole("button", { name: "Settings & Access" }).click();
  await expect(endpoint).toBeHidden();
  await page.getByRole("button", { name: /^Tunnels(?: \d+)?$/ }).click();
  await expect(endpoint).toBeVisible();
});

test("SSH preview traps focus and restores it on Escape", async ({ page }) => {
  await page.goto("/?demo&tab=settings");
  const trigger = page.getByRole("button", { name: "Preview config" });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "SSH Config Preview" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close", exact: true }).first()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test("clicking a protocol checkbox changes the filter once", async ({ page }) => {
  await page.goto("/?demo");
  await expect(page.getByText("prod-db.corp.example.com", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /All Routes/ }).click();
  const ssh = page.getByRole("checkbox", { name: "SSH", exact: true });
  await ssh.click();
  await expect(ssh).toBeChecked();
  await expect(page.getByRole("button", { name: /^SSH \(/ })).toBeVisible();
  await ssh.press("Escape");
  await expect(page.getByRole("button", { name: /^SSH \(/ })).toBeFocused();
});
