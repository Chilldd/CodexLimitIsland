import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export type VersionInputs = { npm?: unknown; cargo?: unknown; tauri?: unknown };
export function assertVersionConsistency(
  versions: VersionInputs,
): asserts versions is { npm: string; cargo: string; tauri: string } {
  const entries = (["npm", "cargo", "tauri"] as const).map((name) => [name, versions[name]]);
  if (entries.some(([, version]) => typeof version !== "string" || !version)) {
    throw new Error("npm、Cargo 或 Tauri 版本缺失");
  }
  if (new Set(entries.map(([, version]) => version)).size !== 1) {
    throw new Error(`版本不一致：${entries.map(([name, version]) => `${name}=${version}`).join("，")}`);
  }
}

export function readVersions(root: string): VersionInputs {
  const readJson = (path: string): { version?: unknown } => JSON.parse(readFileSync(path, "utf8"));
  const npm = readJson(resolve(root, "package.json")).version;
  const manifest = resolve(root, "src-tauri/Cargo.toml");
  const metadata = JSON.parse(
    execFileSync("cargo", ["metadata", "--no-deps", "--locked", "--format-version", "1", "--manifest-path", manifest], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    }),
  );
  const cargo = (metadata as { packages: { manifest_path: string; version: string }[] }).packages.find(
    (pkg) => resolve(pkg.manifest_path) === manifest,
  )?.version;
  const configPath = resolve(root, "src-tauri/tauri.conf.json");
  const configVersion = readJson(configPath).version;
  if (configVersion != null && typeof configVersion !== "string") throw new Error("Tauri 版本必须为字符串");
  const tauri =
    configVersion == null
      ? cargo
      : configVersion.endsWith(".json")
        ? readJson(resolve(dirname(configPath), configVersion)).version
        : configVersion;
  return { npm, cargo, tauri };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const versions = readVersions(fileURLToPath(new URL("../", import.meta.url)));
    assertVersionConsistency(versions);
    console.log(`版本一致：npm / Cargo / Tauri = ${versions.npm}`);
  } catch (error) {
    console.error("版本校验失败：", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
