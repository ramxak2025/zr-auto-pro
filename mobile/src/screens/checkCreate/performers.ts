import type { User } from '../../../../shared/types';

/** Only positive server knowledge can make the author a visible performer. */
export function defaultConfirmedPerformers(
  user: Pick<User, 'id' | 'role'> | null | undefined,
  isCashier: boolean | undefined,
  bookingMasterId?: string,
): string[] {
  if (bookingMasterId) return [bookingMasterId];
  return user?.role === 'master' && isCashier === false ? [user.id] : [];
}

export function performerPayload(editing: boolean, dirty: boolean, ids: string[]): { assigneeIds?: string[] } {
  return !editing || dirty ? { assigneeIds: [...new Set(ids)] } : {};
}

/** Manual work assignment is evidence; automatically seeded service masters are not. */
export function explicitlyAssignedPerformers(checkMasterId: string | undefined, serviceMasterIds: string[]): string[] {
  return [...new Set([checkMasterId, ...serviceMasterIds].filter((id): id is string => !!id))];
}
