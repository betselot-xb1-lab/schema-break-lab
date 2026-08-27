# Local reproduction

Use synthetic customer data only. Run commands from the repository root.

## Compatible baseline

1. Install with `npm ci --include=dev --ignore-scripts`.
2. Create an ignored `.env` from `.env.example`. Keep the default local ports and producer URL. Populate `SENTRY_DSN` privately only when checking the real Sentry project.
3. Run `npm run verify:all`. The baseline should build, pass its local tests, and return HTTP 200 from the compiled consumer. This automated check deliberately disables real Sentry delivery.
4. For a real Sentry check, run `npm run build`, then `npm run start:producer` and `npm run start:consumer` in separate terminals. The start scripts load `.env`.
5. Request `http://127.0.0.1:3101/customer`, then `http://127.0.0.1:3102/report`. If `LAB_API_TOKEN` is populated, send it in an Authorization Bearer header for `/report`; never put it in a URL or committed command.

Expected baseline payload: `customerId: synthetic-001`, `customerName: Example Customer`. The consumer returns HTTP 200 and `displayName: EXAMPLE CUSTOMER`.

Record the HTTP status and body, request ID, both revisions, and actual timestamp. A health response alone does not test the producer-to-consumer request. An SDK-generated event ID does not prove Sentry received an event.

## Deliberate producer change

Start from a recorded successful baseline, with the consumer still running. On a dedicated incident branch, change the producer's `customerName` property to `fullName` in both its interface and returned object. Do not change the consumer's contract.

Rebuild and restart only the producer. Label uncommitted code honestly; do not give it the unchanged baseline's revision. Request `/customer` again: expect `fullName` and no `customerName`. Then request the same consumer's `/report`: expect HTTP 502, `producer_contract_violation`, and a `ProducerContractError` mentioning `customerName`.

Open the matching Sentry event and compare its request ID, producer revision, and consumer revision with the HTTP response and log. The release represents the consumer, while `producer_revision` identifies its upstream service. `handled: yes` means the exception was caught; it does not turn the failed request into a success.

The baseline's compatibility tests should fail after this rename. Preserve that result. Before merging a deliberately incompatible fixture, explicitly test its expected failure and keep separate coverage proving the consumer still accepts the original contract. Do not disable assertions or update the consumer to accept the new field just to get green checks.

Keep event screenshots, credentials, local paths, and private reports outside the public repository. A completed local scenario does not establish a deployment, three merge methods, or any external incident-attribution result. Record those separately.
