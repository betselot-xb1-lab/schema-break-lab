import type { ServerResponse } from "node:http";

export function revision(): string {
  return process.env.APP_REVISION || process.env.RENDER_GIT_COMMIT || "local-uncommitted";
}

export function portFor(service: "producer" | "consumer"): number {
  const value = process.env.PORT || process.env[`${service.toUpperCase()}_PORT`] || (service === "producer" ? "3101" : "3102");
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Port must be an integer from 1 to 65535");
  return port;
}

export function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  response.end(JSON.stringify(body));
}

export function log(event: string, fields: Record<string, unknown>): void {
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), event, ...fields }));
}
