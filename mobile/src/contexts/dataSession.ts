export interface DataOwner {
  tenantId: string | null;
  userId: string;
  pointId: string | null;
}
export const dataOwnerKey = (owner: DataOwner): string =>
  encodeURIComponent(JSON.stringify([owner.tenantId, owner.userId, owner.pointId]));
let generation = 0;
let owner: DataOwner | null = null;
export function setDataSession(next: DataOwner | null): number {
  generation += 1;
  owner = next ? Object.freeze({ ...next }) : null;
  return generation;
}
export function captureDataSession() {
  const captured = generation;
  return {
    generation: captured,
    owner,
    key: owner ? dataOwnerKey(owner) : null,
    isCurrent: () => captured === generation,
  };
}
export function userDataOwner(user: {
  id: string;
  tenantId?: string;
  currentPointId?: string | null;
}): DataOwner | null {
  if (user.currentPointId === undefined && user.tenantId) return null;
  return { userId: user.id, tenantId: user.tenantId || null, pointId: user.currentPointId ?? null };
}
