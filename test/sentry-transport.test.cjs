const { test } = require("node:test");
const assert = require("node:assert/strict");
const { gunzipSync } = require("node:zlib");

test("real Sentry SDK sends schema failure to a LOCAL envelope receiver, not Sentry SaaS", { timeout: 60000 }, async t => {
  const { createServer } = require("node:http");
  const received = [];
  const servers = [];
  async function serve(server) {
    servers.push(server);
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    return `http://127.0.0.1:${server.address().port}`;
  }
  t.after(async () => {
    await require("../dist/src/consumer/instrument.js").closeMonitoring();
    for (const server of servers.reverse()) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
  const collectorUrl = await serve(createServer((request, response) => {
    const chunks = [];
    request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => {
      let bytes = Buffer.concat(chunks);
      if (request.headers["content-encoding"] === "gzip") bytes = gunzipSync(bytes);
      received.push({ path: request.url, text: bytes.toString("utf8") });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end("{}");
    });
  }));
  // Override any inherited environment. This test MUST NOT reach the user's Sentry project.
  process.env.SENTRY_DSN = collectorUrl.replace("http://", "http://0123456789abcdef0123456789abcdef@") + "/1";
  process.env.SENTRY_ENVIRONMENT = "local-transport-test";
  process.env.APP_REVISION = "test-consumer-revision";
  const { reportError, sentryConfigured } = require("../dist/src/consumer/instrument.js");
  const { createConsumerServer } = require("../dist/src/consumer/server.js");
  const producerUrl = await serve(createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json", "X-App-Revision": "test-renamed-producer" });
    response.end(JSON.stringify({ customerId: "synthetic-001", fullName: "Example Customer" }));
  }));
  const consumerUrl = await serve(createConsumerServer({ producerUrl, revision: "test-consumer-revision", sentryConfigured, apiToken: "local-test-secret", reportError }));
  const response = await fetch(`${consumerUrl}/report`, { headers: { Authorization: "Bearer local-test-secret" }, signal: AbortSignal.timeout(10000) });
  const body = await response.json();
  assert.equal(response.status, 502);
  assert.match(body.sentryEventId, /^[0-9a-f]{32}$/);
  assert.equal(body.sentryTransportFlushed, true);
  const events = received.flatMap(envelope => {
    const lines = envelope.text.split("\n");
    const result = [];
    for (let i = 1; i < lines.length - 1; i += 2) {
      if (JSON.parse(lines[i]).type === "event") result.push(JSON.parse(lines[i + 1]));
    }
    return result;
  });
  assert.equal(events.length, 1);
  const event = events[0];
  assert.equal(event.event_id, body.sentryEventId);
  assert.equal(event.exception.values[0].type, "ProducerContractError");
  assert.match(event.exception.values[0].value, /customerName/);
  assert.equal(event.tags.producer_revision, "test-renamed-producer");
  assert.equal(event.tags.consumer_revision, "test-consumer-revision");
  assert.equal(event.release, "test-consumer-revision");
  assert.equal(event.request, undefined);
  assert.equal(event.user, undefined);
  assert.equal(JSON.stringify(event).includes("local-test-secret"), false);
  assert.ok(received.some(item => item.path.startsWith("/api/1/envelope/")));
});
