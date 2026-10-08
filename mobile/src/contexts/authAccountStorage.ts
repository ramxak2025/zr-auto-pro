import AsyncStorage from '@react-native-async-storage/async-storage';
import type { User } from '../../../shared/types';
import { activeAccount, createAccountRegistry, type AccountKeyValueStorage } from './accountRegistry';

/** Lazy native import keeps non-native pure/axios tests independent of RN.
 * Unsupported secure storage fails closed; there is no plaintext fallback. */
export const secureAccountStorage: AccountKeyValueStorage = {
  getItem: async (key) => {
    const secure = await import('expo-secure-store');
    return secure.getItemAsync(key, { keychainAccessible: secure.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  },
  setItem: async (key, value) => {
    const secure = await import('expo-secure-store');
    return secure.setItemAsync(key, value, { keychainAccessible: secure.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  },
  removeItem: async (key) => {
    const secure = await import('expo-secure-store');
    return secure.deleteItemAsync(key, { keychainAccessible: secure.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  },
};
export const authAccounts = createAccountRegistry<User>(
  secureAccountStorage,
  AsyncStorage,
  (value): value is User => !!value && typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string',
);
export async function readStoredAccountSession() {
  const registry = await authAccounts.read();
  return activeAccount(registry)?.session ?? { token: null, user: null, impersonating: false };
}
