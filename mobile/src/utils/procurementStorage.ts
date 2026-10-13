import { withIntentWrite } from '../contexts/intentWriteBarrier';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import {
  createDurableProcurement,
  createProcurementMutex,
  type ProcurementStorage,
} from '../../../shared/utils/durableProcurement';
import { generateClientRequestId } from './offlineCheckQueue';
import { enqueueStorageMutation, setItemWithCacheRecovery } from './persistentCacheStorage';

const IOS_MANIFEST_FENCE = 'autexa:procurement:manifest-fence:v1';
async function writeIntent(key: string, value: string): Promise<void> {
  if (Platform.OS === 'ios') {
    // AsyncStorage 2.2 can retain a new large key in its RAM manifest after a
    // failed disk-manifest write. Rewriting that key alone then skips the flush.
    // An inline value ALWAYS marks the manifest changed, even when unchanged.
    // One native batch must acknowledge BOTH the exact intent and this flush.
    await AsyncStorage.multiSet([
      [key, value],
      [IOS_MANIFEST_FENCE, '1'],
    ]);
  } else {
    await AsyncStorage.setItem(key, value);
  }
}

export const procurementStorage: ProcurementStorage = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => withIntentWrite(key, () => setItemWithCacheRecovery(key, value, writeIntent)),
  removeItem: (key) => withIntentWrite(key, () => enqueueStorageMutation(() => AsyncStorage.removeItem(key))),
  keys: () => AsyncStorage.getAllKeys(),
  exclusive: createProcurementMutex(),
};
export const durableProcurement = createDurableProcurement(procurementStorage, generateClientRequestId);
