import { readFileSync } from "node:fs";

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const tauri = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).version;
const cargo = readFileSync("src-tauri/Cargo.toml", "utf8").match(/^version\s*=\s*"([^"]+)"/m)?.[1];
if (!version || version !== tauri || version !== cargo) {
  throw new Error(`Version mismatch: package=${version}, Tauri=${tauri}, Cargo=${cargo}`);
}
if (process.argv.includes("--release") && process.env.GITHUB_REF !== `refs/tags/v${version}`) {
  throw new Error(`Release must run from tag v${version}`);
}
console.log(`Versions match: ${version}`);
