import { createProducerServer } from "./server.js";
import { log, portFor, revision } from "../shared/runtime.js";

const appRevision = revision();
const port = portFor("producer");
const server = createProducerServer(appRevision);
server.listen(port, "0.0.0.0", () => log("service_started", { service: "producer", port, revision: appRevision }));
server.on("error", (error) => { log("server_error", { service: "producer", message: error.message }); process.exitCode = 1; });
for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => server.close());
