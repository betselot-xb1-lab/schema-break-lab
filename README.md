# Schema Break Lab

A synthetic, independent TypeScript/Node producer and consumer. The producer returns a hand-written customer schema; the consumer owns its own contract and reports violations to Sentry. No real customer data, database, framework, or Deja source code is involved.

## Current scope

This revision is the **intentional breaking scenario**. The producer now returns `fullName` instead of `customerName`; the consumer still requires the original field. `/report` is expected to fail with HTTP 502. The original compatible baseline is commit `38fe04d20cf69b1d8c961c2927941a2770e58f1a`. Use a compatible main-branch revision from before the incident PR merge for the first deployment. This repository alone is not proof that GitHub Actions, Render, or a real Sentry project have been exercised.

## Local commands

Node is pinned to `22.15.1` to match the chosen local runtime. This is not a claim that it has current security fixes. Review the Node 22 security updates before broader use. Dependencies are pinned in `package-lock.json`; `npm ci` installs them without silently upgrading.

```sh
npm ci --include=dev --ignore-scripts
npm run typecheck
npm test
npm run verify:local
npm run verify:all
```

`verify:local` launches both compiled entrypoints, records actual JSONL timestamps under ignored `evidence/`, checks the renamed producer payload and the consumer's expected 502, and shuts down its own processes. A successful check means the intentional failure was observed, not that `/report` worked. It deliberately overrides any inherited Sentry DSN so it cannot send to a real account. Tests preserve the original compatible payload as an explicit fixture and also exercise the actual incompatible producer; Sentry checks use only local receivers or explicitly labeled stubs.

`verify:all` records the actual commands, outputs, and exit codes for typecheck, build, the complete local suite, and the compiled-entrypoint expected-failure check in an additional JSONL file. A failed step stops that verification run and stays in its evidence file; it is not overwritten by a later pass.

For manual work, create an ignored `.env` using `.env.example`, run `npm run build`, then run `npm run start:producer` and `npm run start:consumer` in separate terminals. Defaults are ports 3101 and 3102.

- Producer `GET /customer`: synthetic customer payload.
- Both services `GET /health` and `GET /version`: liveness and running revision only.
- Consumer `GET /report`: fetches the producer's payload and requires `customerName` to be a string.
- When `LAB_API_TOKEN` is set, `/report` requires `Authorization: Bearer <token>`. This is required on Render to avoid unauthenticated incident spam. Health/version endpoints stay public and contain no credentials.

A compatible response is HTTP 200 with `displayName: EXAMPLE CUSTOMER`. A schema violation is HTTP 502 with `producer_contract_violation`; network/non-2xx upstream failures are separately classified. The request ID and independently observed producer/consumer revisions appear in structured logs and Sentry tags. The Sentry release identifies the **consumer** build, not the producer build.

## Sentry

Use your own Node project. Set `SENTRY_DSN` in the consumer's environment, not source code. The consumer initializes the SDK before its HTTP module, strips request/user/breadcrumb data from error events, and does not enable tracing. All payloads must remain synthetic.

`sentryConfigured: true` means a syntactically valid DSN was configured. It does not establish account access or successful ingestion. An event ID and `sentryTransportFlushed: true` do not independently establish dashboard receipt. For that claim, open the matching event in the real Sentry project and record its URL, ID, timestamp, stack, and revision tags. If an alert is configured, verify receipt separately.

## Render dashboard setup — after the code is published

Create **two Web Services**, both connected to this repository's `main` branch. Use Node runtime and Free instances; no database, disk, paid plan, or custom domain is needed. Leave Root Directory blank.

For both services:

- Build Command: `npm ci --include=dev --ignore-scripts && npm run build`
- Health Check Path: `/health`
- Disable Auto-Deploy so an unrelated merge cannot silently redeploy the unchanged consumer.
- Do not set `APP_REVISION`: Render supplies `RENDER_GIT_COMMIT`, which the application reports.
- Keep the actual service URLs and Render deployment IDs as evidence. Do not assume the suggested names guarantee a particular URL.

Producer (suggested name `xb1-producer`):

- Start Command: `npm run start:producer`
- No Sentry DSN or consumer token required.

Consumer (suggested name `xb1-consumer`):

- Start Command: `npm run start:consumer`
- `PRODUCER_BASE_URL`: the producer's actual public HTTPS Render URL. Free services cannot receive private-network traffic.
- `SENTRY_DSN`: your project's DSN, entered privately.
- `SENTRY_ENVIRONMENT`: `xb1-lab`
- `LAB_API_TOKEN`: a strong random token, kept privately. Never put it in a screenshot or committed request example.

Render service creation may initiate an initial deployment. Record it honestly; it is not the required Actions-triggered deployment. Free services sleep after 15 idle minutes and may take about a minute to wake. Warm both health endpoints before the intentional schema test. A cold-start timeout is not evidence of a schema break. Do not add keep-alive jobs to conceal this limitation.

## GitHub Actions deployment setup

Create GitHub environments `lab-producer` and `lab-consumer`. In EACH environment:

- Secret `RENDER_DEPLOY_HOOK`: that Render service's secret deploy hook URL.
- Variable `SERVICE_BASE_URL`: that service's actual public Render URL.

The same variable names intentionally have different values in each environment. Keep deploy hooks out of logs and source. The workflow is manual (`workflow_dispatch`), limited to `main`, and deploys one selected service at a time. Run it once for each service to establish the baseline.

The workflow's GitHub environment produces deployment/status records. The script pins the Render trigger to `github.sha`, then polls `/version` until the exact service/revision is observed; a successful hook response alone is not success. It also requires consumer monitoring configuration. This proves revision/liveness only, not successful Sentry ingestion or the `/report` business operation. JSONL evidence is uploaded as a workflow artifact.

Public-repository Actions artifacts/logs are public evidence: use synthetic data and no secrets. Default artifact retention is finite; preserve needed evidence before it expires.

## Merge history and deliberate incident — later stage

Enable squash, rebase, and merge-commit methods, then perform real PR merges using all three. Enabling the settings does not establish the history. Record each PR URL, chosen method, original commit(s), and resulting main-branch SHA; rebase/squash methods are not reliably distinguishable from the final graph alone.

Before merging the breaking change, capture a successful deployed `/report` response and both running revisions. This incident PR changes the producer's hand-written schema and payload; it must not update or redeploy the consumer. Tests explicitly expect the actual producer's incompatibility and retain the original compatible contract as a separate fixture. No rejection checks are disabled. The earlier two failing compatibility tests remain useful historical evidence; green incident-scenario tests mean the expected failure is reproducible, not that the services are compatible.

Before triggering the incident, write the expected field failure and revisions. After deploying ONLY the producer, invoke the authenticated consumer `/report` and inspect the real Sentry event. Preserve wrong turns and failures as well as successful attempts. Do not create a generic error and claim it proves the schema-break requirement. No Deja signup or integration is part of this stage.

## Reference documentation

- [Render free-service limits](https://render.com/docs/free)
- [Render deploy hooks and exact-commit deployment](https://render.com/docs/deploy-hooks)
- [GitHub deployment environments and status records](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments)
- [Sentry Node SDK](https://github.com/getsentry/sentry-javascript/tree/develop/packages/node)
