import { dataOwnerKey, type DataOwner } from '../contexts/dataSession';
export const PENDING_CHECK_PHOTOS_PREFIX = 'autexa:pending-check-photos:v1:';
export interface PendingCheckPhotos {
  version: 1;
  owner: DataOwner;
  checkId: string;
  photos: Array<{ uri: string; state: 'pending' | 'uncertain' }>;
}
export function parsePendingCheckPhotos(raw: string, owner: DataOwner, checkId?: string): PendingCheckPhotos {
  const record = JSON.parse(raw) as PendingCheckPhotos;
  if (
    record.version !== 1 ||
    !record.owner ||
    typeof record.owner.userId !== 'string' ||
    !record.owner.userId ||
    (record.owner.tenantId !== null && typeof record.owner.tenantId !== 'string') ||
    (record.owner.pointId !== null && typeof record.owner.pointId !== 'string') ||
    dataOwnerKey(record.owner) !== dataOwnerKey(owner) ||
    typeof record.checkId !== 'string' ||
    !record.checkId ||
    (checkId !== undefined && record.checkId !== checkId) ||
    !Array.isArray(record.photos) ||
    record.photos.some((p) => typeof p.uri !== 'string' || !p.uri || !['pending', 'uncertain'].includes(p.state))
  )
    throw new Error('Не удалось прочитать сохранённые фото.');
  return record;
}
