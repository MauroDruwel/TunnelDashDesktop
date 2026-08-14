#!/usr/bin/env node
/**
 * Downloads the cloudflared binary for the current build target and places it
 * at src-tauri/binaries/cloudflared-<target-triple>[.exe] so Tauri can bundle
 * it as a sidecar (externalBin).
 *
 * Skips the download when the binary already exists unless CLOUDFLARED_FORCE=1.
 * Pin a version with CLOUDFLARED_VERSION (default: latest release).
 */

import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, chmodSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binariesDir = join(root, "src-tauri", "binaries");
const extension = process.platform === "win32" ? ".exe" : "";

const ASSETS = {
  "x86_64-unknown-linux-gnu": { file: "cloudflared-linux-amd64" },
  "aarch64-unknown-linux-gnu": { file: "cloudflared-linux-arm64" },
  "arm-unknown-linux-gnueabihf": { file: "cloudflared-linux-arm" },
  "i686-unknown-linux-gnu": { file: "cloudflared-linux-386" },
  "x86_64-apple-darwin": { file: "cloudflared-darwin-amd64.tgz", archive: true },
  "aarch64-apple-darwin": { file: "cloudflared-darwin-arm64.tgz", archive: true },
  "x86_64-pc-windows-msvc": { file: "cloudflared-windows-amd64.exe" },
  "aarch64-pc-windows-msvc": { file: "cloudflared-windows-arm64.exe" },
};

function hostTriple() {
  try {
    return execFileSync("rustc", ["--print", "host-tuple"], { encoding: "utf8" }).trim();
  } catch {
    return execFileSync("rustc", ["-vV"], { encoding: "utf8" })
      .split("\n")
      .find((line) => line.startsWith("host:"))
      ?.split(":")[1]
      .trim();
  }
}

async function main() {
  const triple = process.env.TAURI_ENV_TARGET_TRIPLE || process.env.CLOUDFLARED_TARGET_TRIPLE || hostTriple();
  const asset = ASSETS[triple];
  if (!asset) {
    console.error(`No cloudflared asset known for target triple "${triple}"`);
    process.exit(1);
  }

  const destination = join(binariesDir, `cloudflared-${triple}${extension}`);
  if (existsSync(destination) && process.env.CLOUDFLARED_FORCE !== "1") {
    console.log(`cloudflared sidecar already present: ${destination}`);
    process.exit(0);
  }

  const version = process.env.CLOUDFLARED_VERSION || "latest";
  const url = `https://github.com/cloudflare/cloudflared/releases/${version}/download/${asset.file}`;

  mkdirSync(binariesDir, { recursive: true });

  console.log(`Downloading cloudflared (${triple}) from ${url}`);

  const temp = join(tmpdir(), `cloudflared-${triple}-${Date.now()}${asset.archive ? ".tgz" : extension}`);
  const response = await fetch(url);
  if (!response.ok) {
    console.error(`Download failed: HTTP ${response.status} for ${url}`);
    process.exit(1);
  }

  await pipeline(response.body, createWriteStream(temp));

  if (asset.archive) {
    execFileSync("tar", ["-xzf", temp, "-C", binariesDir]);
    const extracted = join(binariesDir, "cloudflared");
    const staged = join(binariesDir, `cloudflared-${triple}${extension}`);
    if (existsSync(extracted)) {
      await import("node:fs/promises").then((fs) => fs.rename(extracted, staged));
    }
  } else {
    const fs = await import("node:fs/promises");
    await fs.rename(temp, destination);
    if (extension === "") chmodSync(destination, 0o755);
  }

  console.log(`Saved cloudflared sidecar: ${destination}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
