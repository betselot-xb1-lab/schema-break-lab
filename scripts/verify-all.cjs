// Reproducible, timestamped evidence from commands actually executed on this machine.
const { spawnSync } = require("node:child_process");
const { mkdirSync, openSync, appendFileSync, closeSync, readdirSync } = require("node:fs");
const { resolve } = require("node:path");

mkdirSync("evidence", { recursive: true });
const path = resolve("evidence", `verification-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
const fd = openSync(path, "wx");
function record(event, fields) {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), event, ...fields });
  appendFileSync(fd, `${line}\n`);
  console.log(line);
}
function run(label, args) {
  record("command_started", { label, executable: process.execPath, args, node: process.version });
  const result = spawnSync(process.execPath, args, { encoding: "utf8", windowsHide: true, timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
  record("command_finished", { label, exitCode: result.status, signal: result.signal, error: result.error?.message ?? null, stdout: result.stdout, stderr: result.stderr });
  if (result.status !== 0) throw new Error(`${label} did not exit 0`);
}
try {
  run("typecheck", ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json", "--noEmit"]);
  run("build", ["node_modules/typescript/bin/tsc", "-p", "tsconfig.json"]);
  const tests = [
    ...readdirSync("dist/test").filter(name => name.endsWith(".test.js")).map(name => `dist/test/${name}`),
    ...readdirSync("test").filter(name => name.endsWith(".test.cjs")).map(name => `test/${name}`),
  ];
  run("all-local-tests", ["--test", "--test-timeout=60000", ...tests]);
  run("compiled-entrypoint-baseline", ["scripts/verify-local.cjs"]);
  record("verification_passed", { evidencePath: path, notChecked: ["real Sentry", "Render", "GitHub workflows or merge history", "deployed breaking change", "Deja"] });
} catch (error) {
  record("verification_failed", { message: error.message });
  process.exitCode = 1;
} finally { closeSync(fd); }
