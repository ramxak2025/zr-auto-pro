/**
 * Разбор ОТКАЗОВ СЕРВЕРА — один на веб и мобилку.
 *
 * ЗАЧЕМ ОБЩИЙ МОДУЛЬ. Форма ошибки задаётся сервером (NestJS-фильтр
 * исключений), и оба клиента обязаны читать её ОДИНАКОВО. Пока разбор жил
 * копиями по экранам, половина из них глотала причину («Ошибка при создании
 * клиента» вместо «этот номер уже занят»), а половина — разъезжалась в
 * деталях. Здесь же живут два отказа, у которых есть ОСМЫСЛЕННОЕ ДЕЙСТВИЕ, а
 * не только текст:
 *
 *   • 400 «Выберите филиал, …» (backend/src/common/point-scope.ts,
 *     resolvePointForWrite) — прилетает из кассы, расходов, зарплаты и
 *     кассовой смены. Правильная реакция одна: показать текст сервера и дать
 *     переключатель филиала прямо из диалога. Пока распознавание жило внутри
 *     одного экрана (CashShiftScreen), остальные показывали тупик — сообщение
 *     есть, а способа его исполнить на экране нет;
 *   • 409 CLIENT_PHONE_EXISTS_OTHER_POINT — номер занят карточкой чужого
 *     филиала. Навигировать некуда: карточки не видно, id сервер не отдаёт.
 *
 * ПОЧЕМУ РАСПОЗНАЁМ ПО ТЕКСТУ, А НЕ ПО КОДУ. Форма ошибки задана давно и
 * зафиксирована серверным тестом: HTTP 400 + `{ message: 'Выберите филиал, …' }`,
 * где различается только хвост-цель («чтобы пробить чек», «чтобы открыть
 * кассовую смену»). Заводить второй контракт (машинный `code`) значило бы
 * выкатывать сервер и клиенты синхронно и до тех пор показывать старым
 * сборкам тупик. Префикс проверяется целиком, поэтому чужое сообщение со
 * словом «филиал» в середине сюда не попадает.
 *
 * Модуль чистый (без axios и React) — работает и в вебе, и в мобилке, и в
 * юнит-тестах.
 */

/** Начало сообщения серверного гейта филиала. Один в один с сервером. */
export const CHOOSE_POINT_PREFIX = 'Выберите филиал';

/** Код 409, когда номер занят карточкой ДРУГОГО филиала (см. shared/types). */
export const CLIENT_PHONE_OTHER_POINT_CODE = 'CLIENT_PHONE_EXISTS_OTHER_POINT';

/** Тело ошибки, как его отдаёт NestJS-фильтр исключений. */
interface ApiErrorBody {
  message?: string | string[];
  error?: string;
  code?: string;
}

interface ApiErrorLike {
  response?: { status?: number; data?: ApiErrorBody | string };
  message?: string;
}

/** Тело ответа, если ошибка похожа на отказ HTTP-клиента; иначе null. */
function errorBody(err: unknown): ApiErrorBody | null {
  const data = (err as ApiErrorLike | null)?.response?.data;
  return data && typeof data === 'object' ? data : null;
}

/** HTTP-статус отказа или null (сетевой сбой — статуса нет). */
export function apiErrorStatus(err: unknown): number | null {
  const status = (err as ApiErrorLike | null)?.response?.status;
  return typeof status === 'number' ? status : null;
}

/**
 * Текст ошибки от сервера ДОСЛОВНО. Массив (class-validator отдаёт список
 * нарушений) склеиваем переводами строк, чтобы владелец увидел все причины,
 * а не первую. null — сервер текста не дал, вызывающий подставляет свой.
 */
export function apiErrorMessage(err: unknown): string | null {
  const body = errorBody(err);
  const msg = body?.message;
  if (typeof msg === 'string' && msg.trim()) return msg;
  if (Array.isArray(msg)) {
    const joined = msg.filter((m) => typeof m === 'string' && m.trim()).join('\n');
    if (joined) return joined;
  }
  if (typeof body?.error === 'string' && body.error.trim()) return body.error;
  return null;
}

/**
 * Тот самый гейт филиала: 400 с сообщением «Выберите филиал, …». Возвращает
 * ТЕКСТ сервера (его и показываем — он объясняет, ЗАЧЕМ филиал нужен именно
 * здесь) либо null, если ошибка другая.
 *
 * Статус проверяем мягко: если ответа нет вовсе (офлайн), проверять нечего и
 * возвращается null; если статус есть — он обязан быть 400, иначе это чужая
 * ошибка с похожим текстом.
 */
export function choosePointMessage(err: unknown): string | null {
  const status = apiErrorStatus(err);
  if (status !== 400) return null;
  const message = apiErrorMessage(err);
  return message && message.startsWith(CHOOSE_POINT_PREFIX) ? message : null;
}

/**
 * 409 «номер занят карточкой другого филиала». Карточки владельца НЕТ в
 * ответе намеренно (ни имени, ни id — иначе мастер узнавал бы клиента чужого
 * филиала), поэтому клиент обязан показать текст и НЕ пытаться никуда
 * навигировать: «Перейти к клиенту» привело бы в 404.
 */
export function otherPointPhoneConflictMessage(err: unknown): string | null {
  if (apiErrorStatus(err) !== 409) return null;
  const body = errorBody(err);
  if (body?.code !== CLIENT_PHONE_OTHER_POINT_CODE) return null;
  return apiErrorMessage(err) ?? 'Этот номер уже занят карточкой другого филиала';
}
