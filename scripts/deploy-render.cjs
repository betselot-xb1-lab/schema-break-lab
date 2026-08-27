const { mkdirSync, openSync, appendFileSync, closeSync } = require("node:fs");
const { resolve } = require("node:path");

function deploymentConfig(env) {
  const service = env.DEPLOY_SERVICE;
  if (!["producer", "consumer"].includes(service)) throw new Error("DEPLOY_SERVICE must be producer or consumer");
  const commit = env.DEPLOY_COMMIT;
  if (!/^[0-9a-f]{40}$/.test(commit || "")) throw new Error("DEPLOY_COMMIT must be the exact 40-character commit SHA");
  if (!env.RENDER_DEPLOY_HOOK || !env.SERVICE_BASE_URL) throw new Error("RENDER_DEPLOY_HOOK and SERVICE_BASE_URL are required");
  const hook = new URL(env.RENDER_DEPLOY_HOOK);
  if (hook.origin !== "https://api.render.com" || !hook.pathname.startsWith("/deploy/") || !hook.searchParams.get("key")) throw new Error("Expected a Render deploy hook");
  const base = new URL(env.SERVICE_BASE_URL);
  if (base.protocol !== "https:" || !base.hostname.endsWith(".onrender.com") || base.username || base.password || base.search || base.hash || base.pathname !== "/") throw new Error("SERVICE_BASE_URL must be the HTTPS onrender.com service origin");
  hook.searchParams.set("ref", commit);
  return { service, commit, hook, base };
}

function matchesVersion(body, config) {
  return body.service === config.service && body.revision === config.commit && body.status === "ready" && (config.service !== "consumer" || body.sentryConfigured === true);
}

async function deploy(config, { request = fetch, record = console.log, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), maxAttempts = 80, intervalMs = 15000 } = {}) {
  // Never print the hook: it contains a credential. A response acknowledges START, not completion.
  const trigger = await request(config.hook, { method: "POST", signal: AbortSignal.timeout(30000) });
  if (![200, 202].includes(trigger.status)) throw new Error(`Render rejected the deploy trigger with HTTP ${trigger.status}`);
  const started = trigger.status === 200 ? await trigger.json() : {};
  record("deploy_requested", { service: config.service, commit: config.commit, status: trigger.status, deployId: started.deploy?.id || started.id || null });
  const versionUrl = new URL("/version", config.base);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await request(versionUrl, { signal: AbortSignal.timeout(30000), headers: { "Cache-Control": "no-cache" } });
      if (response.ok) {
        const version = await response.json();
        if (matchesVersion(version, config)) {
          record("deployed_revision_observed", { service: config.service, commit: config.commit, url: versionUrl.toString(), httpStatus: response.status, body: version, scope: "running revision and liveness only; no report request or Sentry receipt proven" });
          return version;
        }
        record("waiting_for_revision", { attempt, observedRevision: typeof version.revision === "string" ? version.revision : null });
      } else record("waiting_for_service", { attempt, status: response.status });
    } catch {
      record("version_check_unavailable", { attempt });
    }
    if (attempt < maxAttempts) await sleep(intervalMs);
  }
  throw new Error("Timed out without observing the exact deployed revision and required configuration");
}

async function main() {
  const config = deploymentConfig(process.env);
  mkdirSync("evidence", { recursive: true });
  const path = resolve("evidence", `deploy-${config.service}-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
  const fd = openSync(path, "wx");
  function record(event, fields) {
    const line = JSON.stringify({ timestamp: new Date().toISOString(), event, ...fields });
    console.log(line);
    appendFileSync(fd, `${line}\n`);
  }
  try {
    await deploy(config, { record });
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `environment_url=${config.base.toString()}\n`);
  }
  catch (error) { record("deploy_failed", { message: error.message }); throw error; }
  finally { closeSync(fd); }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { deploymentConfig, matchesVersion, deploy };
