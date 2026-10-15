import { execFileSync } from "node:child_process";
const generate = !process.argv.includes("--check");
execFileSync(
  "cargo",
  [
    "test",
    "--locked",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "--lib",
    "contracts::frontend_contract_matches_rust",
    "--quiet",
  ],
  { stdio: "inherit", env: { ...process.env, CODEXLIMIT_GENERATE_TYPES: generate ? "1" : "0" } },
);
