import { closeMonitoring, reportError, sentryConfigured } from "./instrument.js";
import { createConsumerServer } from "./server.js";
import { log, portFor, revision } from "../shared/runtime.js";

const appRevision = revision();
const port = portFor("consumer");
const producerUrl = process.env.PRODUCER_BASE_URL;
if (!producerUrl) throw new Error("PRODUCER_BASE_URL is required");
if (process.env.RENDER && !process.env.LAB_API_TOKEN) throw new Error("LAB_API_TOKEN is required on Render to protect /report");
if (process.env.RENDER && !sentryConfigured) throw new Error("SENTRY_DSN is required on Render; monitoring cannot be silently disabled");
const server = createConsumerServer({ producerUrl, revision: appRevision, sentryConfigured, apiToken: process.env.LAB_API_TOKEN, reportError });
server.listen(port, "0.0.0.0", () => log("service_started", { service: "consumer", port, revision: appRevision, sentryConfigured }));
server.on("error", (error) => { log("server_error", { service: "consumer", message: error.message }); process.exitCode = 1; });
for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => server.close(() => { void closeMonitoring(); }));
