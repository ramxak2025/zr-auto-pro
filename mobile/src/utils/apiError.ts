/**
 * apiError.ts — единственный разбор текста ошибки из axios-ответа НА МОБИЛКЕ.
 *
 * ПОЧЕМУ: экраны показывали немой Alert («Ошибка при обновлении») и глотали
 * причину, из-за которой сервер отказал. Владелец видел «ошибку» и не мог
 * понять, что именно не так (реальный случай — 400 «stock must not be less
 * than 0» на товаре, проданном в минус).
 *
 * ТЕЛО ОТВЕТА читает ОБЩИЙ модуль `shared/utils/apiError.ts` — тот же, что и
 * веб: форма ошибки задана сервером, и два клиента не имеют права разбирать её
 * по-разному. Здесь остаются только мобильные надстройки, которых в вебе нет:
 * голая строка от прокси и сетевой текст самого axios.
 *
 * Порядок разбора (взят из `offlineCheckQueue.extractServerMessage` — он теперь
 * делегирует сюда, чтобы правило жило в одном месте):
 *   1. `data` — голая строка (nginx / прокси отдают текст);
 *   2. тело ответа: `data.message` (строка ИЛИ массив нарушений
 *      class-validator) → `data.error` — это и есть общий shared-разбор;
 *   3. `error.message` — сетевой текст axios («Network Error», timeout);
 *   4. fallback вызывающего.
 */
import { apiErrorMessage } from '../../../shared/utils/apiError';

/** Текст ошибки для пользователя: сообщение сервера или переданный fallback. */
export function extractApiErrorMessage(error: unknown, fallback: string): string {
  const e = error as { response?: { data?: unknown }; message?: string } | null;
  const data = e?.response?.data;
  if (typeof data === 'string' && data.trim()) return data;
  const fromBody = apiErrorMessage(error);
  if (fromBody) return fromBody;
  if (typeof e?.message === 'string' && e.message) return e.message;
  return fallback;
}
