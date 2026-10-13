import { withIntentWrite } from '../contexts/intentWriteBarrier';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createDurableProcurement,
  createProcurementMutex,
  type ProcurementStorage,
} from '../../../shared/utils/durableProcurement';
import { generateClientRequestId } from './offlineCheckQueue';
import { enqueueStorageMutation, setItemWithCacheRecovery } from './persistentCacheStorage';

export const procurementStorage: ProcurementStorage = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => withIntentWrite(key, () => setItemWithCacheRecovery(key, value)),
  removeItem: (key) => withIntentWrite(key, () => enqueueStorageMutation(() => AsyncStorage.removeItem(key))),
  keys: () => AsyncStorage.getAllKeys(),
  exclusive: createProcurementMutex(),
};
export const durableProcurement = createDurableProcurement(procurementStorage, generateClientRequestId);
