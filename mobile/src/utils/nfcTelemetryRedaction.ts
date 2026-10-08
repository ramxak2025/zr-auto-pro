const NFC_TOKEN_VALUE = /((?:^|[#?&])(?:v=1&)?token=)[A-Za-z0-9_-]{43}(?=$|[&#\s"'<>])/gi;

export function isNfcTelemetry(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    /(?:\/api\/shifts\/nfc(?:\/|\?|$)|\/nfc\/attendance(?:#|\?|$)|autexa:\/\/nfc\/attendance)/i.test(value)
  );
}

export function scrubNfcTelemetryValue(value: unknown): unknown {
  return scrubNfcData(value);
}

export function scrubNfcTelemetryString(value: string): string {
  return value.replace(NFC_TOKEN_VALUE, '$1[redacted]');
}

function scrubNfcData(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') {
    if (/^\s*[\[{]/.test(value)) {
      try {
        return JSON.stringify(scrubNfcData(JSON.parse(value), seen));
      } catch {
        /* Keep non-JSON strings as-is. */
      }
    }
    return scrubNfcTelemetryString(value);
  }
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value as object)) return '[circular]';
  seen.add(value as object);
  if (Array.isArray(value)) return value.map((item) => scrubNfcData(item, seen));
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (/^(?:token|ndefUri|uri)$/i.test(key)) result[key] = '[redacted]';
    else result[key] = scrubNfcData(item, seen);
  }
  return result;
}
