// Runs the actual compiled, intentionally incompatible entrypoints. Never sends to real Sentry.
const { spawn } = require("node:child_process");
const { createServer } = require("node:net");
const { mkdirSync, openSync, appendFileSync, closeSync } = require("node:fs");
const { resolve } = require("node:path");
const assert = require("node:assert/strict");

const evidenceDir = resolve("evidence");
mkdirSync(evidenceDir, { recursive: true });
const started = new Date().toISOString();
const evidencePath = resolve(evidenceDir, `local-schema-break-${started.replace(/[:.]/g, "-")}.jsonl`);
const evidenceFd = openSync(evidencePath, "wx");
const children = [];
function record(event, fields = {}) {
  const line = JSON.stringify({ timestamp: new Date().toISOString(), event, ...fields });
  console.log(line);
  appendFileSync(evidenceFd, `${line}\n`);
}
async function freePort() {
  const listener = createServer();
  await new Promise(resolve => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  return port;
}
async function waitReady(url, revision, child) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Service exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) {
        const body = await response.json();
        assert.equal(body.revision, revision, "Do not accidentally test another running process");
        return body;
      }
    } catch (error) { if (error.code === "ERR_ASSERTION") throw error; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Service did not become ready: ${url}`);
}
function start(service, port, revision, extra = {}) {
  const child = spawn(process.execPath, ["--enable-source-maps", `dist/src/${service}/main.js`], {
    cwd: process.cwd(), windowsHide: true,
    env: { ...process.env, PORT: String(port), APP_REVISION: revision, RENDER: "", SENTRY_DSN: "", SENTRY_ENVIRONMENT: "local-proof", LAB_API_TOKEN: "", ...extra },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  child.stdout.on("data", chunk => record("service_stdout", { service, output: chunk.toString().trim() }));
  child.stderr.on("data", chunk => record("service_stderr", { service, output: chunk.toString().trim() }));
  child.on("error", error => record("process_error", { service, message: error.message }));
  return child;
}
async function main() {
  record("proof_started", { node: process.version, scope: "local compiled-entrypoint deliberate schema failure; expected HTTP 502, not healthy service; real Sentry and Render excluded" });
  const producerPort = await freePort();
  const consumerPort = await freePort();
  const producerUrl = `http://127.0.0.1:${producerPort}`;
  const consumerUrl = `http://127.0.0.1:${consumerPort}`;
  const revision = `local-proof-${Date.now()}`;
  const producer = start("producer", producerPort, revision);
  record("producer_ready", await waitReady(producerUrl, revision, producer));
  const consumer = start("consumer", consumerPort, revision, { PRODUCER_BASE_URL: producerUrl });
  record("consumer_ready", await waitReady(consumerUrl, revision, consumer));
  const raw = await fetch(`${producerUrl}/customer`);
  const payload = await raw.json();
  record("producer_response", { status: raw.status, body: payload });
  assert.equal(raw.status, 200);
  assert.deepEqual(payload, { customerId: "synthetic-001", fullName: "Example Customer" });
  assert.equal(Object.hasOwn(payload, "customerName"), false);
  const response = await fetch(`${consumerUrl}/report`);
  const report = await response.json();
  record("consumer_response", { status: response.status, body: report });
  assert.equal(response.status, 502);
  assert.equal(report.error, "producer_contract_violation");
  assert.equal(Object.hasOwn(report, "displayName"), false);
  assert.equal(report.sentryEventId, null, "This local check deliberately disables Sentry");
  assert.equal(report.sentryTransportFlushed, null);
  assert.equal(typeof report.requestId, "string");
  assert.equal(report.producerRevision, revision);
  assert.equal(report.consumerRevision, revision);
  record("expected_schema_failure_observed", { evidencePath, status: response.status, notChecked: ["real Sentry ingestion", "Render", "GitHub Actions", "three merge histories", "deployed schema break", "Deja"] });
}
main().catch(error => { record("proof_failed", { name: error.name, message: error.message }); process.exitCode = 1; }).finally(async () => {
  await Promise.all(children.map(child => new Promise(resolve => {
    if (child.exitCode !== null || child.signalCode !== null) return resolve();
    child.once("exit", resolve);
    child.kill();
    const force = setTimeout(() => child.kill("SIGKILL"), 3000);
    force.unref();
  })));
  closeSync(evidenceFd);
});
