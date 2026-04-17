import * as Sentry from '@sentry/nestjs';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'production',
    tracesSampleRate: 0.2,
    profilesSampleRate: 0.1,
    integrations: [],
  });
}

export { Sentry };
export const isSentryEnabled = !!dsn;
