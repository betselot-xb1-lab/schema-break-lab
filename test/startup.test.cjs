const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

function start(extra) {
  return spawnSync(process.execPath, ["dist/src/consumer/main.js"], {
    timeout: 10000, encoding: "utf8", windowsHide: true,
    env: { ...process.env, SENTRY_DSN: "", RENDER: "", PRODUCER_BASE_URL: "http://127.0.0.1:1", LAB_API_TOKEN: "", ...extra },
  });
}
test("invalid Sentry configuration fails startup instead of claiming monitoring is configured", () => {
  const result = start({ SENTRY_DSN: "invalid-test-dsn" });
  assert.equal(result.status, 1, result.error?.message);
  assert.match(result.stderr, /SENTRY_DSN is invalid/);
});
test("public Render consumer refuses to start without its incident-generation token", () => {
  const result = start({ RENDER: "true" });
  assert.equal(result.status, 1, result.error?.message);
  assert.match(result.stderr, /LAB_API_TOKEN is required/);
});
test("Render consumer refuses to start with monitoring disabled", () => {
  const result = start({ RENDER: "true", LAB_API_TOKEN: "test-only-token" });
  assert.equal(result.status, 1, result.error?.message);
  assert.match(result.stderr, /SENTRY_DSN is required/);
});
