import * as Sentry from '@sentry/nestjs';

/** NFC request bodies contain the static tag bearer. Keep attendance telemetry
 * useful without exporting that credential (including accidental query copies). */
export function redactNfcTelemetry<T extends { request?: { url?: string; data?: unknown; query_string?: unknown } }>(
  event: T,
): T {
  const request = event.request;
  if (request?.url && /\/(?:api\/)?shifts\/nfc(?:[/?#]|$)/.test(request.url)) {
    delete request.data;
    delete request.query_string;
    request.url = request.url.split(/[?#]/, 1)[0];
  }
  return event;
}

export const isPublicBookingUrl = (url: string) => /\/(?:api\/)?public\/bookings(?:[/?#]|$)/.test(url);

interface BookingTelemetry {
  request?: {
    url?: string;
    data?: unknown;
    query_string?: unknown;
    headers?: Record<string, string>;
    cookies?: unknown;
  };
  extra?: unknown;
  user?: unknown;
  breadcrumbs?: unknown;
  contexts?: unknown;
  spans?: unknown;
  message?: string;
  exception?: unknown;
  transaction?: string;
  tags?: unknown;
  logentry?: unknown;
}
/** Only the anonymous form/status family has this reduced telemetry shape.
 * SQL error details, breadcrumbs and traces may repeat a form value or header,
 * so deleting request.data alone is insufficient for this privacy boundary. */
export function redactPublicBookingTelemetry<T extends BookingTelemetry>(event: T): T {
  if (event.request?.url && isPublicBookingUrl(event.request.url)) {
    event.request = { url: '/api/public/bookings/[redacted]' };
    delete event.extra;
    delete event.user;
    delete event.breadcrumbs;
    delete event.contexts;
    delete event.spans;
    delete event.exception;
    delete event.tags;
    delete event.logentry;
    event.message = 'Public booking request';
    if (event.transaction) event.transaction = 'public-booking';
  }
  return event;
}
function redactRequestTelemetry<T extends BookingTelemetry>(event: T): T {
  return redactPublicBookingTelemetry(redactNfcTelemetry(event));
}

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'production',
    tracesSampleRate: 0.2,
    profilesSampleRate: 0.1,
    integrations: [],
    beforeSend: redactRequestTelemetry,
    beforeSendTransaction: redactRequestTelemetry,
  });
}

export { Sentry };
export const isSentryEnabled = !!dsn;
