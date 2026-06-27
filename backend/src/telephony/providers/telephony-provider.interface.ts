/**
 * Provider-agnostic telephony (VPBX) contract.
 *
 * One small interface so the rest of the module (service / controller) never knows
 * which VPBX is behind it. Mango Office is implemented for real; adding a second
 * provider = one more class, no schema change.
 *
 * A provider does exactly two things with an inbound callback:
 *   1. verifySignature() — prove the callback really came from the provider, using
 *      the tenant's stored secret. The body is NEVER trusted until this passes.
 *   2. parseEvent()      — normalize the raw callback into a TelephonyCallEvent.
 *
 * Providers are stateless: the per-tenant config is passed per call.
 */

export type TelephonyProviderName = 'mango';

/** Per-tenant credentials pulled from `telephony_integrations`. Both are secrets. */
export interface TelephonyProviderConfig {
  provider: TelephonyProviderName;
  /** VPBX API key (Mango vpbx_api_key). */
  apiKey: string;
  /** Sign salt (Mango vpbx_api_salt) used to verify callback signatures. */
  apiSalt: string;
}

/**
 * What the callback is about:
 *   • 'ringing'   — a call appeared / started (push the staff now).
 *   • 'summary'   — the call ended (answered/missed, duration).
 *   • 'recording' — a recording became available for a call.
 *   • 'ignore'    — a recognizable but non-actionable state (e.g. mid-call hold).
 */
export type TelephonyEventKind = 'ringing' | 'summary' | 'recording' | 'ignore';

/** Normalized call event used by the whole module + persisted into `calls`. */
export interface TelephonyCallEvent {
  kind: TelephonyEventKind;
  /** Provider call id (correlates ringing → summary → recording of one call). */
  callId: string;
  direction: 'inbound' | 'outbound';
  /** Caller number (digits). */
  fromNumber: string;
  /** Callee number (digits). */
  toNumber: string;
  /** The external party (the client) — what we match against `clients.phone`. */
  clientNumber: string;
  /** Set on a 'summary' event: did anyone answer. */
  answered?: boolean;
  /** Talk time in seconds (summary). */
  duration?: number;
  /** Provider recording reference (Mango recording_id), on a 'recording' event. */
  recordingRef?: string | null;
}

export interface TelephonyProvider {
  readonly name: TelephonyProviderName;

  /**
   * Verify the callback signature against the tenant's stored secret. MUST return
   * false (never throw) on any malformed/forged body — the caller then drops the
   * callback as a 200 no-op without touching any data.
   */
  verifySignature(cfg: TelephonyProviderConfig, body: unknown): boolean;

  /**
   * Normalize a (signature-verified) callback into a TelephonyCallEvent, or null
   * when the body is not a recognizable call event. NEVER throws.
   */
  parseEvent(body: unknown): TelephonyCallEvent | null;
}
