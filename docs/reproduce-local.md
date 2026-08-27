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
