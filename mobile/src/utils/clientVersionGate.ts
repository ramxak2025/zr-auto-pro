/**
 * clientVersionGate — логика «минимальной версии клиента» (мягкий kill-switch).
 *
 * Сервер (`GET /api/client-version`, публичный, без JWT) отдаёт минимально
 * допустимый native build per-платформенно. Сборка старше минимума получает
 * блокирующий экран «Нужно обновление» (см. components/UpdateGate.tsx) —
 * так владелец может отрезать сборки с известным критичным багом, который
 * не чинится по OTA (например, сломанный native-слой).
 *
 * Контракт надёжности (важнее самой блокировки):
 *   • дефолт сервера min=0 → shouldBlockClient всегда false → код инертен,
 *     пока владелец явно не выставит MIN_IOS_BUILD / MIN_ANDROID_BUILD;
 *   • ЛЮБАЯ ошибка (офлайн, таймаут, 5xx, кривой JSON) → null → пропускаем
 *     без блокировки. Отсутствие сети НИКОГДА не должно запирать мастера
 *     перед кассой — kill-switch мягкий, fail-open;
 *   • некорректный текущий build (null / не-число) → fail-open.
 *
 * Чистый модуль: НИКАКИХ импортов react-native / expo — юнит-тестируется под
 * node-jest (см. __tests__/clientVersionGate.test.ts). Платформа передаётся
 * строкой, `fetch`/`AbortController` — глобальные и в RN (Hermes), и в node.
 */

/** Ответ GET /api/client-version (см. backend/src/health/client-version.controller.ts). */
export interface ClientVersionInfo {
  minIosBuild: number;
  minAndroidBuild: number;
  iosUrl: string;
  androidUrl: string;
  message?: string;
}

/** Таймаут запроса версии: дольше 5с ждать нельзя — гейт не должен ощущаться. */
export const CLIENT_VERSION_TIMEOUT_MS = 5_000;

/** Foreground-перепроверка минимума — не чаще раза в час. */
export const CLIENT_VERSION_RECHECK_MS = 60 * 60_000;

/**
 * Ядро kill-switch: блокировать ли клиент с native-build `currentBuild`
 * при серверном минимуме `minBuild`.
 *
 * `currentBuild` — строка из `Application.nativeBuildVersion`
 * (iOS: CFBundleVersion «36», Android: versionCode «13») либо null.
 * Fail-open во всех сомнительных случаях — см. шапку модуля.
 */
export function shouldBlockClient(
  currentBuild: string | number | null | undefined,
  minBuild: number | null | undefined,
): boolean {
  // Минимум не задан / выключен (0) / мусор — гейт выключен.
  if (typeof minBuild !== 'number' || !Number.isFinite(minBuild) || minBuild <= 0) {
    return false;
  }
  // Текущий build неизвестен — не рискуем ложной блокировкой.
  if (currentBuild === null || currentBuild === undefined) {
    return false;
  }
  const current = typeof currentBuild === 'number' ? currentBuild : parseInt(String(currentBuild).trim(), 10);
  if (!Number.isFinite(current)) {
    return false;
  }
  return current < minBuild;
}

/** Минимальный build для платформы ('ios' | 'android' | прочее → 0 = выкл). */
export function minBuildForPlatform(info: ClientVersionInfo, platform: string): number {
  if (platform === 'ios') return info.minIosBuild;
  if (platform === 'android') return info.minAndroidBuild;
  return 0;
}

/** URL стора/TestFlight для кнопки «Обновить» (пустая строка = кнопки нет). */
export function updateUrlForPlatform(info: ClientVersionInfo, platform: string): string {
  if (platform === 'ios') return info.iosUrl;
  if (platform === 'android') return info.androidUrl;
  return '';
}

/**
 * Защитный парс серверного ответа. Числа приводим и нормализуем (мусор → 0,
 * т. е. «выключено»), URL — только строки. Любая структурная неожиданность →
 * null → вызывающий код молча пропускает (fail-open).
 */
export function parseClientVersionResponse(raw: unknown): ClientVersionInfo | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  const toMin = (v: unknown): number => {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  };
  const toUrl = (v: unknown): string => (typeof v === 'string' ? v : '');

  const message = typeof obj.message === 'string' && obj.message.trim() ? obj.message : undefined;

  return {
    minIosBuild: toMin(obj.minIosBuild),
    minAndroidBuild: toMin(obj.minAndroidBuild),
    iosUrl: toUrl(obj.iosUrl),
    androidUrl: toUrl(obj.androidUrl),
    ...(message ? { message } : {}),
  };
}

/**
 * Запрос GET `${baseUrl}/client-version` с жёстким таймаутом.
 * Возвращает null на ЛЮБОЙ ошибке (сеть, таймаут, не-2xx, кривой JSON) —
 * контракт fail-open. Обычный fetch, НЕ общий axios-инстанс: гейт не должен
 * зависеть от интерсепторов/failover-логики и не должен уметь их триггерить.
 */
export async function fetchClientVersion(
  baseUrl: string,
  timeoutMs: number = CLIENT_VERSION_TIMEOUT_MS,
): Promise<ClientVersionInfo | null> {
  try {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}/client-version`, {
        method: 'GET',
        signal: abort.signal,
      });
      if (!res.ok) return null;
      return parseClientVersionResponse(await res.json());
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}
