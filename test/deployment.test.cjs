const { test } = require("node:test");
const assert = require("node:assert/strict");
const { deploymentConfig, matchesVersion, deploy } = require("../scripts/deploy-render.cjs");
const env = { DEPLOY_SERVICE: "consumer", DEPLOY_COMMIT: "a".repeat(40), RENDER_DEPLOY_HOOK: "https://api.render.com/deploy/srv-test?key=not-a-real-key", SERVICE_BASE_URL: "https://test.onrender.com" };
const config = deploymentConfig(env);
test("deployment pins the trigger to the exact commit", () => assert.equal(config.hook.searchParams.get("ref"), env.DEPLOY_COMMIT));
test("deployment rejects missing credentials and short SHAs before any network call", () => {
  assert.throws(() => deploymentConfig({ ...env, RENDER_DEPLOY_HOOK: "" }), /required/);
  assert.throws(() => deploymentConfig({ ...env, DEPLOY_COMMIT: "abc123" }), /40-character/);
  assert.throws(() => deploymentConfig({ ...env, SERVICE_BASE_URL: "https://attacker.test" }), /onrender/);
});
test("wrong revision, wrong service, and disabled consumer monitoring are not deployment success", () => {
  const live = { service: "consumer", revision: env.DEPLOY_COMMIT, status: "ready", sentryConfigured: true };
  assert.equal(matchesVersion(live, config), true);
  assert.equal(matchesVersion({ ...live, revision: "old" }, config), false);
  assert.equal(matchesVersion({ ...live, service: "producer" }, config), false);
  assert.equal(matchesVersion({ ...live, sentryConfigured: false }, config), false);
});
test("successful trigger followed by stale revision never passes (mock Render responses)", async () => {
  let calls = 0;
  await assert.rejects(deploy(config, { maxAttempts: 2, intervalMs: 0, sleep: async () => {}, record: () => {}, request: async () => {
    calls++;
    return calls === 1 ? { status: 200, json: async () => ({ deploy: { id: "mock-deploy" } }) } : { ok: true, status: 200, json: async () => ({ service: "consumer", status: "ready", revision: "old", sentryConfigured: true }) };
  } }), /Timed out/);
  assert.equal(calls, 3);
});
test("queued trigger needs matching live revision, and logs omit the secret hook (mock Render responses)", async () => {
  const records = [];
  let calls = 0;
  const live = { service: "consumer", revision: env.DEPLOY_COMMIT, status: "ready", sentryConfigured: true };
  await deploy(config, { maxAttempts: 1, record: (event, fields) => records.push({ event, ...fields }), request: async () => ++calls === 1 ? { status: 202 } : { ok: true, status: 200, json: async () => live } });
  assert.equal(records.at(-1).event, "deployed_revision_observed");
  assert.equal(JSON.stringify(records).includes("not-a-real-key"), false);
});
test("a rejected trigger stops without probing the service (mock Render responses)", async () => {
  let calls = 0;
  await assert.rejects(deploy(config, { record: () => {}, request: async () => { calls++; return { status: 401 }; } }), /401/);
  assert.equal(calls, 1);
});
