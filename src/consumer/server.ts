import { createServer } from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { makeReport, ProducerContractError } from "./customer-contract.js";
import { json, log } from "../shared/runtime.js";

export interface CaptureResult { eventId: string | null; transportFlushed: boolean | null }
export interface ConsumerOptions {
  producerUrl: string;
  revision: string;
  sentryConfigured: boolean;
  apiToken?: string;
  requestTimeoutMs?: number;
  reportError: (error: Error, tags: Record<string, string>) => Promise<CaptureResult>;
}

function authorized(actual: string | undefined, expected: string): boolean {
  const left = Buffer.from(actual || "");
  const right = Buffer.from(`Bearer ${expected}`);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createConsumerServer(options: ConsumerOptions) {
  const producer = new URL(options.producerUrl);
  if (!["http:", "https:"].includes(producer.protocol) || producer.username || producer.password) throw new Error("PRODUCER_BASE_URL must be an HTTP(S) URL without credentials");
  return createServer(async (request, response) => {
    const path = new URL(request.url || "/", "http://localhost").pathname;
    response.setHeader("X-App-Revision", options.revision);
    if (request.method !== "GET") return json(response, 405, { error: "method_not_allowed" });
    if (path === "/health" || path === "/version") {
      // Liveness only: deliberately does not query the producer or claim end-to-end health.
      return json(response, 200, { service: "consumer", status: "ready", revision: options.revision, sentryConfigured: options.sentryConfigured });
    }
    if (path !== "/report") return json(response, 404, { error: "not_found" });
    if (options.apiToken && !authorized(request.headers.authorization, options.apiToken)) return json(response, 401, { error: "unauthorized" });
    const requestId = randomUUID();
    let producerRevision = "unobserved";
    try {
      const upstream = await fetch(new URL("/customer", producer), { signal: AbortSignal.timeout(options.requestTimeoutMs ?? 10000) });
      producerRevision = upstream.headers.get("x-app-revision") || "missing";
      if (!upstream.ok) throw new Error(`Producer returned HTTP ${upstream.status}`);
      const report = makeReport(await upstream.json());
      log("report_succeeded", { requestId, consumerRevision: options.revision, producerRevision });
      return json(response, 200, { ...report, requestId, consumerRevision: options.revision, producerRevision });
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error("Unknown consumer failure");
      const kind = error instanceof ProducerContractError ? "producer_contract_violation" : "upstream_failure";
      let capture: CaptureResult = { eventId: null, transportFlushed: null };
      try {
        capture = await options.reportError(error, { service: "consumer", request_id: requestId, consumer_revision: options.revision, producer_revision: producerRevision, failure_kind: kind });
      } catch {
        log("sentry_capture_failed", { requestId });
      }
      log("report_failed", { requestId, kind, errorName: error.name, message: error.message, consumerRevision: options.revision, producerRevision, ...capture });
      return json(response, 502, { error: kind, requestId, consumerRevision: options.revision, producerRevision, sentryEventId: capture.eventId, sentryTransportFlushed: capture.transportFlushed });
    }
  });
}
