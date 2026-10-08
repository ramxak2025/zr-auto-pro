import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createDurableProcurement,
  createProcurementMutex,
  type ProcurementStorage,
} from '../../../shared/utils/durableProcurement';
import { generateClientRequestId } from './offlineCheckQueue';

export const procurementStorage: ProcurementStorage = {
  getItem: (key) => AsyncStorage.getItem(key),
  setItem: (key, value) => AsyncStorage.setItem(key, value),
  removeItem: (key) => AsyncStorage.removeItem(key),
  keys: () => AsyncStorage.getAllKeys(),
  exclusive: createProcurementMutex(),
};
export const durableProcurement = createDurableProcurement(procurementStorage, generateClientRequestId);
