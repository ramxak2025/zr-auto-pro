/** A notification may outlive the account that received it on a shared phone. */
export interface PlatformReminderTarget {
  tenantId: string;
  operatorUserId: string;
  kind: 'subscription_expiry' | 'follow_up';
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function platformReminderTarget(
  data: unknown,
  user: { id: string; role: string },
): PlatformReminderTarget | null {
  if (user.role !== 'superadmin' && user.role !== 'manager') return null;
  if (!data || typeof data !== 'object') return null;
  const candidate = data as Record<string, unknown>;
  if (
    candidate.type !== 'platform_reminder' ||
    candidate.operatorUserId !== user.id ||
    typeof candidate.tenantId !== 'string' ||
    !UUID.test(candidate.tenantId) ||
    (candidate.kind !== 'subscription_expiry' && candidate.kind !== 'follow_up')
  )
    return null;
  return { tenantId: candidate.tenantId, operatorUserId: user.id, kind: candidate.kind };
}

export function createPlatformReminderPushHandler(options: {
  user: { id: string; role: string };
  isCurrent: () => boolean;
  canOpenTenant: (id: string) => Promise<boolean>;
  openTenant: (id: string) => void;
  unavailable: () => void;
  handled: Set<string>;
  consumed?: (responseId: string) => void;
}) {
  const pending = new Set<string>();
  return async (responseId: string, data: unknown): Promise<void> => {
    const target = platformReminderTarget(data, options.user);
    if (!target || !options.isCurrent() || !responseId) return;
    const key = `${options.user.id}:${responseId}`;
    if (pending.has(key) || options.handled.has(key)) return;
    pending.add(key);
    try {
      // Assignment can change after delivery. Check the existing scoped API
      // before opening a card, rather than trusting the push's old snapshot.
      const accessible = await options.canOpenTenant(target.tenantId);
      if (!options.isCurrent()) return;
      if (!accessible) {
        options.unavailable();
        return;
      }
      options.openTenant(target.tenantId);
      options.handled.add(key);
      options.consumed?.(responseId);
      if (options.handled.size > 100) {
        const oldest = options.handled.values().next().value;
        if (oldest) options.handled.delete(oldest);
      }
    } catch {
      if (options.isCurrent()) options.unavailable();
    } finally {
      pending.delete(key);
    }
  };
}
