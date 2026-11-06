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
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { chmod, mkdtemp, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const binariesDir = join(root, "src-tauri", "binaries");

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

  const extension = triple.includes("-windows-") ? ".exe" : "";
  const destination = join(binariesDir, `cloudflared-${triple}${extension}`);
  if (existsSync(destination) && process.env.CLOUDFLARED_FORCE !== "1") {
    console.log(`cloudflared sidecar already present: ${destination}`);
    process.exit(0);
  }

  const version = process.env.CLOUDFLARED_VERSION || "latest";
  const releasePath = version === "latest" ? "latest/download" : `download/${encodeURIComponent(version)}`;
  const url = `https://github.com/cloudflare/cloudflared/releases/${releasePath}/${asset.file}`;

  mkdirSync(binariesDir, { recursive: true });

  console.log(`Downloading cloudflared (${triple}) from ${url}`);

  const staging = await mkdtemp(join(binariesDir, ".cloudflared-"));
  try {
    const temp = join(staging, asset.file);
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Download failed: HTTP ${response.status} for ${url}`);
    await pipeline(response.body, createWriteStream(temp));
    let binary = temp;
    if (asset.archive) {
      execFileSync("tar", ["-xzf", temp, "-C", staging, "cloudflared"]);
      binary = join(staging, "cloudflared");
    }
    if (!extension) await chmod(binary, 0o755);
    await rename(binary, destination);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }

  console.log(`Saved cloudflared sidecar: ${destination}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
