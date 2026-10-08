import {
  createDurableProcurement,
  ProcurementRecoveryError,
  type ProcurementStorage,
} from '../../../shared/utils/durableProcurement';
import { newUuid } from './uuid';

const unavailable = () =>
  new ProcurementRecoveryError(
    'STORAGE_UNAVAILABLE',
    'Для безопасной отправки нужно доступное хранилище браузера и Web Locks. Откройте Autexa в поддерживаемом браузере и повторите.',
  );
export const procurementStorage: ProcurementStorage = {
  getItem: async (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      throw unavailable();
    }
  },
  setItem: async (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      throw unavailable();
    }
  },
  removeItem: async (key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      throw unavailable();
    }
  },
  keys: async () => {
    try {
      return Object.keys(localStorage);
    } catch {
      throw unavailable();
    }
  },
  exclusive: async (key, run) => {
    if (!navigator.locks) return Promise.reject(unavailable());
    return await navigator.locks.request(key, run);
  },
};
export const durableProcurement = createDurableProcurement(procurementStorage, newUuid);
