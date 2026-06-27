import { createHash, timingSafeEqual } from 'crypto';
import { TelephonyCallEvent, TelephonyProvider, TelephonyProviderConfig } from './telephony-provider.interface';

/**
 * Real Mango Office VPBX provider — https://www.mango-office.ru/support/api/vpbx/
 *
 * ── Callback transport ───────────────────────────────────────────────────────
 * Mango POSTs callbacks as `application/x-www-form-urlencoded` with three fields:
 *   vpbx_api_key = <our VPBX API key>
 *   json         = <the event payload, as a JSON string>
 *   sign         = sha256(vpbx_api_key + json + vpbx_api_salt)   (hex, lowercase)
 * Because main.ts enables express urlencoded(), the controller receives these as a
 * plain object `{ vpbx_api_key, json, sign }`, with `json` already URL-decoded —
 * exactly the string Mango signed, so we hash it verbatim (no re-serialization).
 *
 * ── Signature ────────────────────────────────────────────────────────────────
 * We recompute sha256(api_key + json + api_salt) with OUR stored secrets and
 * timing-safe-compare it to `sign`. A mismatch ⇒ false ⇒ the caller drops the
 * callback. Secrets are NEVER logged.
 *
 * ── Event kinds we care about ────────────────────────────────────────────────
 *   • call   — call state changes ({ call_state: 'Appeared' | 'Connected' | ... }).
 *              'Appeared' is a new ringing call → kind 'ringing'; other states are
 *              non-actionable → 'ignore'.
 *   • summary — fired once the call ends ({ start, answer, end, talk_time,
 *              disconnect_reason, ... }) → kind 'summary' (answered = answer>0).
 *   • recording — a recording is ready ({ recording_id / recording_state }) →
 *              kind 'recording' (recordingRef = recording_id).
 *
 * ── Direction ────────────────────────────────────────────────────────────────
 * Mango numbers itself are not labelled inbound/outbound in one field, so we infer
 * from which side is the EXTERNAL party (a real phone number, ≥ 6 digits) vs an
 * internal extension (3–4 digits), with the DID line_number as a tie-breaker.
 */
export class MangoProvider implements TelephonyProvider {
  readonly name = 'mango' as const;

  // ─── Signature ───────────────────────────────────────────────────────────────

  verifySignature(cfg: TelephonyProviderConfig, body: unknown): boolean {
    const b = (body ?? {}) as { vpbx_api_key?: unknown; json?: unknown; sign?: unknown };
    const json = b.json;
    const sign = b.sign;
    if (typeof json !== 'string' || typeof sign !== 'string') return false;
    if (!cfg.apiKey || !cfg.apiSalt) return false;

    // If Mango announced a key, it must be OUR key (defends against a callback
    // signed for a different tenant being replayed at our :tenantId).
    if (typeof b.vpbx_api_key === 'string' && b.vpbx_api_key !== cfg.apiKey) return false;

    const expected = createHash('sha256')
      .update(cfg.apiKey + json + cfg.apiSalt)
      .digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const c = Buffer.from(sign, 'utf8');
    if (a.length !== c.length) return false;
    try {
      return timingSafeEqual(a, c);
    } catch {
      return false;
    }
  }

  // ─── Parsing ─────────────────────────────────────────────────────────────────

  parseEvent(body: unknown): TelephonyCallEvent | null {
    const b = (body ?? {}) as { json?: unknown };
    if (typeof b.json !== 'string') return null;

    let p: Record<string, unknown>;
    try {
      const parsed = JSON.parse(b.json);
      if (!parsed || typeof parsed !== 'object') return null;
      p = parsed as Record<string, unknown>;
    } catch {
      return null;
    }

    const callId = this.str(p.call_id) || this.str(p.entry_id);
    if (!callId) return null;

    const from = (p.from ?? {}) as Record<string, unknown>;
    const to = (p.to ?? {}) as Record<string, unknown>;
    const fromNumber = this.digits(from.number);
    const toNumber = this.digits(to.number);
    const toLine = this.digits(to.line_number);
    const fromLine = this.digits(from.line_number);

    const { direction, clientNumber } = this.inferDirection(fromNumber, toNumber, fromLine, toLine);

    // ── recording event ──
    const recordingRef = this.str(p.recording_id);
    if (recordingRef || p.recording_state !== undefined) {
      return { kind: 'recording', callId, direction, fromNumber, toNumber, clientNumber, recordingRef };
    }

    // ── call-state event ──
    const callState = this.str(p.call_state);
    if (callState) {
      // Only a freshly appeared call is actionable (ring → push). Connected /
      // OnHold / Disconnected etc. are tracked via the summary instead.
      const kind = callState.toLowerCase() === 'appeared' ? 'ringing' : 'ignore';
      return { kind, callId, direction, fromNumber, toNumber, clientNumber };
    }

    // ── summary event (call ended) ──
    if (p.disconnect_reason !== undefined || p.end !== undefined || p.talk_time !== undefined) {
      const answerTs = this.numberOf(p.answer);
      const talkTime = this.numberOf(p.talk_time);
      const answered = answerTs > 0 || talkTime > 0;
      return {
        kind: 'summary',
        callId,
        direction,
        fromNumber,
        toNumber,
        clientNumber,
        answered,
        duration: talkTime,
      };
    }

    return null;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /** External party = the side that is a real phone number (≥ 6 digits). */
  private inferDirection(
    fromNumber: string,
    toNumber: string,
    fromLine: string,
    toLine: string,
  ): { direction: 'inbound' | 'outbound'; clientNumber: string } {
    const isExternal = (n: string) => n.length >= 6;
    if (isExternal(fromNumber) && !isExternal(toNumber)) {
      return { direction: 'inbound', clientNumber: fromNumber };
    }
    if (!isExternal(fromNumber) && isExternal(toNumber)) {
      return { direction: 'outbound', clientNumber: toNumber };
    }
    // Both look external (or both internal) — fall back to the DID line marker:
    // a `to.line_number` means the call landed on one of our city lines (inbound);
    // a `from.line_number` means it left from one (outbound).
    if (toLine) return { direction: 'inbound', clientNumber: fromNumber || toNumber };
    if (fromLine) return { direction: 'outbound', clientNumber: toNumber || fromNumber };
    return { direction: 'inbound', clientNumber: fromNumber || toNumber };
  }

  private str(v: unknown): string {
    return typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);
  }

  private digits(v: unknown): string {
    return this.str(v).replace(/\D/g, '');
  }

  private numberOf(v: unknown): number {
    const n = typeof v === 'number' ? v : parseFloat(this.str(v));
    return Number.isFinite(n) ? n : 0;
  }
}
