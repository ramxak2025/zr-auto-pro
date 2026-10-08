/**
 * usePreference — небольшой локальный (AsyncStorage) хук для per-user
 * настроек, которым НЕ нужен бэкенд.
 *
 * Контракт:
 *   • значение читается асинхронно из AsyncStorage один раз при монтировании
 *     (`hydrated=false` до первого чтения);
 *   • пока не прочитали — отдаём `defaultValue` (дефолт-фолбэк при отсутствии
 *     сохранёнки);
 *   • запись идёт в стейт сразу (мгновенный UI) и зеркалится в AsyncStorage
 *     в фоне; ошибки записи проглатываются — это не критичные данные;
 *   • ключ хранения = `pref:<key>` (key уже должен содержать userId, если
 *     настройка персональная — см. `prefKey`).
 *
 * Только сериализуемый JSON. Android-safe (AsyncStorage кроссплатформенный).
 */
import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { ownedStorage } from '../contexts/ownedStorage';

import { captureDataSession } from '../contexts/dataSession';
const STORAGE_PREFIX = 'pref:v2:';

/**
 * Строит per-user ключ настройки. `userId` может быть undefined (гость /
 * экран до логина) — тогда используем общий бакет `anon`, чтобы не писать
 * `undefined` в ключ.
 */
export function prefKey(name: string, userId?: string): string {
  return `${name}:${userId || 'anon'}`;
}

export interface UsePreferenceResult<T> {
  /** Текущее значение (defaultValue, пока не прочитали хранилище). */
  value: T;
  /** Записать новое значение (стейт + AsyncStorage). */
  setValue: (next: T) => void;
  /** Удалить сохранёнку и вернуться к defaultValue. */
  reset: () => void;
  /** false до первого чтения из AsyncStorage — для скрытия мерцания. */
  hydrated: boolean;
}

export function usePreference<T>(key: string, defaultValue: T): UsePreferenceResult<T> {
  const [value, setValueState] = useState<T>(defaultValue);
  const [hydrated, setHydrated] = useState(false);
  // defaultValue может пересоздаваться на каждый рендер (литерал объекта) —
  // держим в ref, чтобы эффект чтения не перезапускался и не сбрасывал стейт.
  const defaultRef = useRef(defaultValue);
  defaultRef.current = defaultValue;

  const lease = useMemo(() => captureDataSession(), []);
  const storageKey = lease.key ? STORAGE_PREFIX + key : null;

  useEffect(() => {
    let cancelled = false;
    if (!storageKey) return;
    ownedStorage
      .get(storageKey, lease)
      .then((raw) => {
        if (cancelled || !lease.isCurrent()) return;
        if (raw != null) {
          try {
            setValueState(JSON.parse(raw) as T);
          } catch {
            // Повреждённая запись — игнорируем, остаёмся на дефолте.
          }
        }
      })
      .catch(() => {
        /* read error — остаёмся на дефолте */
      })
      .finally(() => {
        if (!cancelled && lease.isCurrent()) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
    // storageKey — единственная зависимость: смена userId/имени = новый бакет.
  }, [storageKey, lease]);

  const setValue = useCallback(
    (next: T) => {
      if (!storageKey || !lease.isCurrent()) return;
      setValueState(next);
      ownedStorage.set(storageKey, JSON.stringify(next), lease).catch(() => {
        /* write error — некритично */
      });
    },
    [storageKey, lease],
  );

  const reset = useCallback(() => {
    if (!storageKey || !lease.isCurrent()) return;
    setValueState(defaultRef.current);
    ownedStorage.remove(storageKey, lease).catch(() => {
      /* remove error — некритично */
    });
  }, [storageKey, lease]);

  return { value, setValue, reset, hydrated };
}
