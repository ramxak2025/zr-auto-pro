import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureDataSession, dataOwnerKey, type DataOwner } from '../contexts/dataSession';
import { withIntentWrite } from '../contexts/intentWriteBarrier';
import { createProcurementMutex } from '../../../shared/utils/durableProcurement';

import {
  PENDING_CHECK_PHOTOS_PREFIX,
  parsePendingCheckPhotos,
  type PendingCheckPhotos,
} from './pendingCheckPhotoRecord';
export {
  PENDING_CHECK_PHOTOS_PREFIX,
  parsePendingCheckPhotos,
  type PendingCheckPhotos,
} from './pendingCheckPhotoRecord';
const exclusive = createProcurementMutex();
const keyFor = (owner: DataOwner, checkId: string) => `${PENDING_CHECK_PHOTOS_PREFIX}${dataOwnerKey(owner)}:${checkId}`;
type Lease = ReturnType<typeof captureDataSession>;
const changed = () => Object.assign(new Error('Сессия изменилась.'), { code: 'ERR_CANCELED' });
export async function readPendingCheckPhotos(checkId: string, lease: Lease): Promise<PendingCheckPhotos | null> {
  if (!lease.owner || !lease.isCurrent()) throw changed();
  const raw = await AsyncStorage.getItem(keyFor(lease.owner, checkId));
  if (!lease.isCurrent()) throw changed();
  return raw ? parsePendingCheckPhotos(raw, lease.owner, checkId) : null;
}
/** Manual-only recovery for an ALREADY saved check. No financial payload,
 * booking conversion, bearer, or automatic upload is stored here. */
export function updatePendingCheckPhotos(
  checkId: string,
  lease: Lease,
  edit: (photos: PendingCheckPhotos['photos']) => PendingCheckPhotos['photos'],
): Promise<PendingCheckPhotos> {
  if (!lease.owner || !lease.isCurrent()) return Promise.reject(changed());
  const owner = lease.owner;
  const key = keyFor(owner, checkId);
  return withIntentWrite(key, () =>
    exclusive(key, async () => {
      if (!lease.isCurrent()) throw changed();
      const raw = await AsyncStorage.getItem(key);
      if (!lease.isCurrent()) throw changed();
      const previous = raw ? parsePendingCheckPhotos(raw, owner, checkId).photos : [];
      const record: PendingCheckPhotos = { version: 1, owner, checkId, photos: edit(previous) };
      if (record.photos.length === 0) await AsyncStorage.removeItem(key);
      else {
        const serialized = JSON.stringify(record);
        await AsyncStorage.setItem(key, serialized);
        if ((await AsyncStorage.getItem(key)) !== serialized)
          throw new Error('Не удалось надёжно сохранить фото для повтора.');
      }
      if (!lease.isCurrent()) throw changed();
      return record;
    }),
  );
}
