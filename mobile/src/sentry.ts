import * as Sentry from '@sentry/react-native';
import Constants from 'expo-constants';

import { onAuthExpired } from './api/axios';

/**
 * Crash + error reporting for the mobile app.
 *
 * Single guardrail across this whole file: nothing reaches Sentry unless a DSN
 * is configured AND we're in a release build. With an empty DSN (the default —
 * `app.json` ships `extra.sentryDsn: ""`) every export below is a transparent
 * no-op: `Sentry.init` is never called, `Sentry.wrap` passes the component
 * through untouched, and the helpers return immediately. The app then behaves
 * exactly as it did before Sentry was wired in — no network traffic, no quota
 * burned, no startup risk. The owner activates reporting by pasting a DSN into
 * `app.json` → `extra.sentryDsn` and rebuilding; no other code change needed.
 */

// Sentry DSN (a PUBLIC client key — only allows SENDING events, safe to embed).
// Kept here as a fallback so it's baked into the JS bundle and picked up on any
// Release rebuild without needing a prebuild to re-embed `app.json` → extra.
const DSN_FALLBACK = 'https://d248fd476c55b8b4854145c66cd9c115@o4511507149291520.ingest.us.sentry.io/4511507152502784';

function getDsn(): string | undefined {
  const fromExtra = Constants.expoConfig?.extra?.sentryDsn;
  const dsn = typeof fromExtra === 'string' && fromExtra.length > 0 ? fromExtra : DSN_FALLBACK;
  return dsn && dsn.length > 0 ? dsn : undefined;
}

// `enabled` is the source of truth for every guarded call below. It is only
// true when a real DSN exists and we are NOT in a dev build (so Metro / local
// runs never emit events even if a DSN happens to be present).
let enabled = false;

// Transient connectivity / server-availability failures are NOT client bugs:
// the backend is briefly down (502/503/504), rate-limited (429), or the device
// is offline / timed out (no response, ECONNABORTED, …). The axios layer
// already surfaces these as that one screen's error state and React Query
// retries them — letting them reach Sentry only buries real JS bugs under
// infra noise (the AxiosError 502/504 and «Нет соединения» issues). We drop
// them at this single global chokepoint; they still live on as breadcrumbs
// attached to any genuine event that follows. A 500 is deliberately KEPT — a
// spike of application errors on the server is a signal worth seeing.
const TRANSIENT_HTTP_STATUSES = new Set([408, 429, 502, 503, 504]);
const TRANSIENT_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ETIMEDOUT',
  'ERR_NETWORK',
  'ERR_CANCELED',
  'ENOTFOUND',
  'ECONNRESET',
]);
const CONNECTIVITY_MESSAGE_PREFIX = 'Нет соединения с сервером';

function isTransientNetworkError(
  originalException: unknown,
  firstException?: { type?: string; value?: string },
): boolean {
  const err = originalException as {
    isAxiosError?: boolean;
    name?: string;
    code?: string;
    message?: string;
    response?: { status?: number };
  } | null;
  if (err && typeof err === 'object') {
    if (err.isAxiosError || err.name === 'AxiosError') {
      const status = err.response?.status;
      // No response at all = offline / DNS / timeout; otherwise only the
      // transient statuses above (a 404/403/400 is a real contract bug → keep).
      if (status == null || TRANSIENT_HTTP_STATUSES.has(status)) return true;
    }
    if (typeof err.code === 'string' && TRANSIENT_ERROR_CODES.has(err.code)) return true;
    if (typeof err.message === 'string' && err.message.startsWith(CONNECTIVITY_MESSAGE_PREFIX)) return true;
  }
  // Fallback: the original exception isn't always attached (e.g. events rebuilt
  // from the native layer) — match the serialized exception value too.
  if (firstException) {
    const value = typeof firstException.value === 'string' ? firstException.value : '';
    if (firstException.type === 'AxiosError' && /status code (408|429|502|503|504)\b/.test(value)) return true;
    if (value.startsWith(CONNECTIVITY_MESSAGE_PREFIX)) return true;
  }
  return false;
}

export function initSentry(): void {
  const dsn = getDsn();
  if (!dsn) {
    // No DSN → full no-op. Never init, never subscribe, never send.
    return;
  }

  enabled = !__DEV__;

  Sentry.init({
    dsn,
    enabled,
    tracesSampleRate: 0.1,
    enableNativeCrashHandling: true,
    beforeSend(event, hint) {
      if (isTransientNetworkError(hint.originalException, event.exception?.values?.[0])) return null;
      return event;
    },
  });

  // Make forced logouts (a wave of 401s the axios layer collapses into one
  // `onAuthExpired`) searchable as breadcrumb-rich warning events. The
  // emitter takes a no-arg listener and returns an unsubscribe fn (unused —
  // app-lifetime subscription).
  onAuthExpired(() => {
    if (!enabled) return;
    Sentry.captureMessage('auth_expired_forced_logout', 'warning');
  });
}

/** Report a caught error. No-op unless Sentry is enabled. */
export function captureException(err: unknown, extra?: Record<string, unknown>): void {
  if (!enabled) return;
  Sentry.captureException(err, extra ? { extra } : undefined);
}

/**
 * Associate subsequent events with the current session. Only non-PII
 * identifiers — never phone numbers, names or other personal data.
 */
export function setSentryUser(user: { id: string; tenantId: string }): void {
  if (!enabled) return;
  Sentry.setUser({ id: user.id, tenantId: user.tenantId });
}

export { Sentry };
