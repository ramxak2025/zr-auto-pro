import { withIntentWrite } from '../contexts/intentWriteBarrier';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { createProcurementMutex } from '../../../shared/utils/durableProcurement';
import { createPendingNfc } from '../../../shared/utils/pendingNfc';

const storage = {
  getItem: (key: string) => AsyncStorage.getItem(key),
  setItem: (key: string, value: string) => withIntentWrite(key, () => AsyncStorage.setItem(key, value)),
  removeItem: (key: string) => withIntentWrite(key, () => AsyncStorage.removeItem(key)),
  exclusive: createProcurementMutex(),
};

export const nativePendingNfc = createPendingNfc(
  storage,
  () => Crypto.randomUUID(),
  (token) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, token),
);
