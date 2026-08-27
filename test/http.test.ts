import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { createProducerServer } from "../src/producer/server.js";
import { createConsumerServer, type ConsumerOptions } from "../src/consumer/server.js";
import { ProducerContractError } from "../src/consumer/customer-contract.js";

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP listener");
  return `http://127.0.0.1:${address.port}`;
}
async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

test("the original compatible fixture crosses HTTP to the consumer without reporting an error", async (t) => {
  // Preserve the old producer contract explicitly; this is a fixture, not the current producer.
  const producer = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json", "X-App-Revision": "producer-baseline" });
    response.end(JSON.stringify({ customerId: "synthetic-001", customerName: "Example Customer" }));
  });
  const producerUrl = await listen(producer);
  t.after(() => close(producer));
  let reports = 0;
  const consumer = createConsumerServer({ producerUrl, revision: "consumer-baseline", sentryConfigured: false, reportError: async () => { reports++; return { eventId: null, transportFlushed: null }; } });
  const consumerUrl = await listen(consumer);
  t.after(() => close(consumer));
  const response = await fetch(`${consumerUrl}/report`);
  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.displayName, "EXAMPLE CUSTOMER");
  assert.equal(body.producerRevision, "producer-baseline");
  assert.equal(body.consumerRevision, "consumer-baseline");
  assert.equal(typeof body.requestId, "string");
  assert.equal(reports, 0);
});

test("the actual renamed producer over HTTP produces a 502 and invokes the reporter with both revisions (stub reporter)", async (t) => {
  const producer = createProducerServer("renamed-producer");
  const producerUrl = await listen(producer);
  t.after(() => close(producer));
  const raw = await fetch(`${producerUrl}/customer`);
  assert.equal(raw.status, 200);
  assert.deepEqual(await raw.json(), { customerId: "synthetic-001", fullName: "Example Customer" });
  const captured: { error: Error; tags: Record<string, string> }[] = [];
  const consumer = createConsumerServer({ producerUrl, revision: "unchanged-consumer", sentryConfigured: true, reportError: async (error, tags) => {
    captured.push({ error, tags });
    return { eventId: "stub-event-not-sentry-evidence", transportFlushed: true };
  } });
  const consumerUrl = await listen(consumer);
  t.after(() => close(consumer));
  const response = await fetch(`${consumerUrl}/report`);
  assert.equal(response.status, 502);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.error, "producer_contract_violation");
  assert.equal(body.sentryEventId, "stub-event-not-sentry-evidence");
  assert.equal(captured.length, 1);
  assert.ok(captured[0].error instanceof ProducerContractError);
  assert.equal(captured[0].error.field, "customerName");
  assert.equal(captured[0].tags.request_id, body.requestId);
  assert.equal(captured[0].tags.failure_kind, "producer_contract_violation");
  assert.equal(captured[0].tags.producer_revision, "renamed-producer");
  assert.equal(captured[0].tags.consumer_revision, "unchanged-consumer");
});

test("a removed field over HTTP reports the contract failure with request and revision correlation (stub reporter)", async (t) => {
  const producer = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json", "X-App-Revision": "removed-field-producer" });
    response.end(JSON.stringify({ customerId: "synthetic-001" }));
  });
  const producerUrl = await listen(producer);
  t.after(() => close(producer));
  const captured: { error: Error; tags: Record<string, string> }[] = [];
  const consumer = createConsumerServer({ producerUrl, revision: "unchanged-consumer", sentryConfigured: true, reportError: async (error, tags) => {
    captured.push({ error, tags });
    return { eventId: "stub-removed-field", transportFlushed: true };
  } });
  const consumerUrl = await listen(consumer);
  t.after(() => close(consumer));
  const response = await fetch(`${consumerUrl}/report`);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(response.status, 502);
  assert.equal(body.error, "producer_contract_violation");
  assert.equal(body.sentryEventId, "stub-removed-field");
  assert.equal(body.producerRevision, "removed-field-producer");
  assert.equal(body.consumerRevision, "unchanged-consumer");
  assert.equal(captured.length, 1);
  assert.ok(captured[0].error instanceof ProducerContractError);
  assert.equal(captured[0].error.field, "customerName");
  assert.equal(captured[0].tags.request_id, body.requestId);
  assert.equal(captured[0].tags.producer_revision, body.producerRevision);
  assert.equal(captured[0].tags.consumer_revision, body.consumerRevision);
  assert.equal(captured[0].tags.failure_kind, "producer_contract_violation");
});

test("a retyped field over HTTP reports the contract failure even if no event ID is returned (stub reporter)", async (t) => {
  const producer = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json", "X-App-Revision": "retyped-field-producer" });
    response.end(JSON.stringify({ customerId: "synthetic-001", customerName: 42 }));
  });
  const producerUrl = await listen(producer);
  t.after(() => close(producer));
  const captured: { error: Error; tags: Record<string, string> }[] = [];
  const consumer = createConsumerServer({ producerUrl, revision: "unchanged-consumer", sentryConfigured: false, reportError: async (error, tags) => {
    captured.push({ error, tags });
    return { eventId: null, transportFlushed: null };
  } });
  const consumerUrl = await listen(consumer);
  t.after(() => close(consumer));
  const response = await fetch(`${consumerUrl}/report`);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(response.status, 502);
  assert.equal(body.error, "producer_contract_violation");
  assert.equal(body.sentryEventId, null);
  assert.equal(body.sentryTransportFlushed, null);
  assert.equal(body.producerRevision, "retyped-field-producer");
  assert.equal(body.consumerRevision, "unchanged-consumer");
  assert.equal(captured.length, 1);
  assert.ok(captured[0].error instanceof ProducerContractError);
  assert.equal(captured[0].error.field, "customerName");
  assert.equal(captured[0].tags.request_id, body.requestId);
  assert.equal(captured[0].tags.producer_revision, body.producerRevision);
  assert.equal(captured[0].tags.consumer_revision, body.consumerRevision);
  assert.equal(captured[0].tags.failure_kind, "producer_contract_violation");
});

test("upstream HTTP failure is not misclassified as a schema break, even if reporting fails", async (t) => {
  const producer = createServer((_request, response) => { response.writeHead(503); response.end(); });
  const producerUrl = await listen(producer);
  t.after(() => close(producer));
  const consumer = createConsumerServer({ producerUrl, revision: "test", sentryConfigured: true, reportError: async () => { throw new Error("reporter unavailable"); } });
  const consumerUrl = await listen(consumer);
  t.after(() => close(consumer));
  const response = await fetch(`${consumerUrl}/report`);
  assert.equal(response.status, 502);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.error, "upstream_failure");
  assert.equal(body.sentryEventId, null);
  assert.equal(body.sentryTransportFlushed, null);
});

test("health does not claim upstream health; authorization protects incident generation", async (t) => {
  let reports = 0;
  const options: ConsumerOptions = { producerUrl: "http://127.0.0.1:1", revision: "test", sentryConfigured: false, apiToken: "test-only-token", reportError: async () => { reports++; return { eventId: null, transportFlushed: null }; } };
  const consumer = createConsumerServer(options);
  const url = await listen(consumer);
  t.after(() => close(consumer));
  const health = await fetch(`${url}/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json() as Record<string, unknown>).sentryConfigured, false);
  assert.equal((await fetch(`${url}/report`)).status, 401);
  assert.equal((await fetch(`${url}/report`, { headers: { Authorization: "Bearer incorrect" } })).status, 401);
  assert.equal(reports, 0);
  assert.equal((await fetch(`${url}/missing`)).status, 404);
  assert.equal((await fetch(`${url}/report`, { method: "POST" })).status, 405);
});
