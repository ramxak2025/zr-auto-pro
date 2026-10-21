/** Recovery UUIDs are capabilities. Scrub structured headers/config and any
 * repeated copies in exception messages, breadcrumbs or nested context. */
export function redactRefreshTelemetry<T>(event: T, hint?: unknown): T {
  const secrets = new Set<string>();
  const seen = new WeakSet<object>();
  const key = /^(x-refresh-request-id|refreshRequestId)$/i;
  const labelled = /(x-refresh-request-id|refreshRequestId)[\s"':=]+([0-9a-f-]{36})/gi;
  const collect = (value: unknown): void => {
    if (typeof value === 'string') {
      for (const match of value.matchAll(labelled)) secrets.add(match[2]);
    } else if (value && typeof value === 'object' && !seen.has(value)) {
      seen.add(value);
      for (const [name, child] of Object.entries(value)) {
        if (key.test(name) && typeof child === 'string') secrets.add(child);
        collect(child);
      }
    }
  };
  collect(event);
  collect(hint);
  const copied = new WeakMap<object, unknown>();
  const scrub = (value: unknown): unknown => {
    if (typeof value === 'string') {
      let clean = value;
      for (const secret of secrets) if (secret) clean = clean.split(secret).join('[redacted]');
      return clean;
    }
    if (!value || typeof value !== 'object') return value;
    if (copied.has(value)) return copied.get(value);
    if (Array.isArray(value)) {
      const result: unknown[] = [];
      copied.set(value, result);
      for (const child of value) result.push(scrub(child));
      return result;
    }
    const result: Record<string, unknown> = {};
    copied.set(value, result);
    for (const [name, child] of Object.entries(value)) result[name] = key.test(name) ? '[redacted]' : scrub(child);
    return result;
  };
  return scrub(event) as T;
}
