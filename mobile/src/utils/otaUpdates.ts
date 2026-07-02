/**
 * otaUpdates — фоновая доставка EAS Updates (OTA) без прерывания работы.
 *
 * Как JS-фиксы доезжают до установленного приложения:
 *   1. Нативная сторона (`app.json` → `updates.checkAutomatically: "ON_LOAD"`,
 *      `fallbackToCacheTimeout: 0`): каждый холодный старт мгновенно
 *      поднимает закешированный бандл и ПАРАЛЛЕЛЬНО скачивает свежий —
 *      он применится на СЛЕДУЮЩЕМ холодном старте.
 *   2. Этот модуль добавляет второй канал: при возврате приложения в
 *      foreground (мастер свернул и развернул) мы тихо проверяем и скачиваем
 *      обновление. Так свежий бандл уже лежит на диске к моменту следующего
 *      холодного старта — обновление применяется за ОДИН перезапуск, а не за
 *      два (без этого хука: старт N скачивает, старт N+1 применяет).
 *
 * Почему НЕ `Updates.reloadAsync()` и НЕ баннер:
 *   • reload посреди работы мастера убивает набранный чек / открытый экран —
 *     недопустимо для учёта (незакрытая касса дороже свежего бандла);
 *   • баннер «перезапустите приложение» — лишняя UI-поверхность и прерывание;
 *     iOS сам выгружает приложение из памяти в течение часов, так что
 *     следующий холодный старт (= применение обновления) наступает быстро.
 *   Выбран минимально-инвазивный вариант: тихая догрузка, применение на
 *   следующем холодном старте.
 *
 * Безопасность:
 *   • `__DEV__` / `Updates.isEnabled === false` (Metro, dev-client, Expo Go) —
 *     модуль превращается в no-op: expo-updates в этих окружениях кидает.
 *   • Все вызовы в try/catch — сбой проверки обновления никогда не виден
 *     пользователю и не может ничего сломать.
 *   • Троттлинг 5 минут + защита от параллельных проверок: notification-center
 *     pull на iOS дёргает inactive→active пачками.
 *   • runtimeVersion policy = appVersion: OTA прилетает только в сборки той же
 *     версии (3.0.0) — несовместимый native никогда не получит чужой JS.
 */
import { AppState, type AppStateStatus, type NativeEventSubscription } from 'react-native';
import * as Updates from 'expo-updates';

/** Минимальный интервал между двумя foreground-проверками обновлений. */
const OTA_CHECK_THROTTLE_MS = 5 * 60_000;

/**
 * Подписка на AppState: возврат в foreground → тихий check + fetch OTA.
 * Возвращает unsubscribe — вызывать в cleanup (App.tsx unmount).
 */
export function attachOtaUpdates(): () => void {
  // Metro / dev-client / Expo Go: expo-updates отключён и его методы кидают
  // "Updates.checkForUpdateAsync() is not supported in development builds".
  // Гейтим на входе — модуль полностью инертен вне release-сборки.
  if (__DEV__ || !Updates.isEnabled) {
    return () => {};
  }

  // Нативный ON_LOAD-чек только что отработал на этом же старте — первая
  // JS-проверка имеет смысл не раньше чем через троттлинг-окно.
  let lastCheckedAt = Date.now();
  let inFlight = false;
  let prevState: AppStateStatus = AppState.currentState;

  const checkAndFetch = async (): Promise<void> => {
    if (inFlight) return;
    inFlight = true;
    try {
      const check = await Updates.checkForUpdateAsync();
      if (check.isAvailable) {
        // Скачиваем в фоне; expo-updates сам атомарно положит бандл в кеш.
        // Применится на следующем холодном старте — никакого reload сейчас.
        await Updates.fetchUpdateAsync();
      }
    } catch {
      // Тихо: офлайн / сервер обновлений недоступен / гонка — не наша проблема
      // здесь и сейчас, следующий foreground или холодный старт попробует снова.
    } finally {
      inFlight = false;
    }
  };

  const onChange = (next: AppStateStatus) => {
    // Только чистый переход в active (паттерн foregroundRevalidation):
    // игнорируем active→active шум и стартовый unknown.
    const isComingToForeground = next === 'active' && prevState !== 'active';
    prevState = next;
    if (!isComingToForeground) return;

    const now = Date.now();
    if (now - lastCheckedAt < OTA_CHECK_THROTTLE_MS) return;
    lastCheckedAt = now;

    void checkAndFetch();
  };

  const sub: NativeEventSubscription = AppState.addEventListener('change', onChange);
  return () => {
    sub.remove();
  };
}
