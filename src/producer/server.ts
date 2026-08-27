import { createServer } from "node:http";
import { exampleCustomer } from "./customer-schema.js";
import { json } from "../shared/runtime.js";

export function createProducerServer(revision: string) {
  return createServer((request, response) => {
    response.setHeader("X-App-Revision", revision);
    if (request.method !== "GET") return json(response, 405, { error: "method_not_allowed" });
    const path = new URL(request.url || "/", "http://localhost").pathname;
    if (path === "/health" || path === "/version") return json(response, 200, { service: "producer", status: "ready", revision });
    if (path === "/customer") return json(response, 200, exampleCustomer());
    json(response, 404, { error: "not_found" });
  });
}
