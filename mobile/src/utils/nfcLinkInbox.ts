/** One-use, process-memory handoff. Never put tag bearers in navigation state or storage. */
let pending: { token: string; sessionToken: string; scope: string } | null = null;
const listeners = new Set<(token: string, sessionToken: string, scope: string) => void>();

export function setPendingAttendanceLink(token: string, sessionToken: string, scope: string): void {
  pending = { token, sessionToken, scope };
  listeners.forEach((listener) => listener(token, sessionToken, scope));
}

export function takePendingAttendanceLink(sessionToken: string, scope: string): string | null {
  const value = pending;
  pending = null;
  return value?.sessionToken === sessionToken && value.scope === scope ? value.token : null;
}

export function subscribePendingAttendanceLink(
  listener: (token: string, sessionToken: string, scope: string) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearPendingAttendanceLink(): void {
  pending = null;
}
