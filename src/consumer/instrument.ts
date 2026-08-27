// Load before importing the HTTP server or any other instrumented application module.
import * as Sentry from "@sentry/node";

const appRevision = process.env.APP_REVISION || process.env.RENDER_GIT_COMMIT;
export const sentryConfigured = Boolean(process.env.SENTRY_DSN);
if (sentryConfigured) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || "local",
    release: appRevision && appRevision !== "local-uncommitted" ? appRevision : undefined,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend(event) {
      // This fixture needs stack traces and explicit tags, not request credentials or personal data.
      delete event.request;
      delete event.user;
      delete event.breadcrumbs;
      return event;
    },
  });
  if (!Sentry.getClient()?.getDsn()) throw new Error("SENTRY_DSN is invalid; monitoring was not configured");
}

export async function reportError(error: Error, tags: Record<string, string>) {
  if (!sentryConfigured) return { eventId: null, transportFlushed: null };
  const eventId = Sentry.withScope((scope) => {
    scope.setTags(tags);
    return Sentry.captureException(error);
  });
  const transportFlushed = await Sentry.flush(5000);
  // Neither captureException nor flush proves the event is visible in the Sentry dashboard.
  return { eventId, transportFlushed };
}

export async function closeMonitoring(): Promise<void> {
  if (sentryConfigured) await Sentry.close(5000);
}
