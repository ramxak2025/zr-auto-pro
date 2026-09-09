/**
 * apiError.ts — единственный разбор текста ошибки из axios-ответа.
 *
 * ПОЧЕМУ: экраны показывали немой Alert («Ошибка при обновлении») и глотали
 * причину, из-за которой сервер отказал. Владелец видел «ошибку» и не мог
 * понять, что именно не так (реальный случай — 400 «stock must not be less
 * than 0» на товаре, проданном в минус).
 *
 * Порядок разбора взят из `offlineCheckQueue.extractServerMessage` (он теперь
 * делегирует сюда, чтобы правило жило в одном месте):
 *   1. `data` — голая строка (nginx / прокси отдают текст);
 *   2. `data.message` — массив (class-validator шлёт список нарушений);
 *   3. `data.message` — строка (наши BadRequestException с русским текстом);
 *   4. `data.error` — заголовок статуса от Nest;
 *   5. `error.message` — сетевой текст axios («Network Error», timeout);
 *   6. fallback вызывающего.
 */

/** Текст ошибки для пользователя: сообщение сервера или переданный fallback. */
export function extractApiErrorMessage(error: unknown, fallback: string): string {
  const e = error as {
    response?: { data?: { message?: string | string[]; error?: string } | string };
    message?: string;
  } | null;
  const data = e?.response?.data;
  if (typeof data === 'string' && data.trim()) return data;
  const message = (data as { message?: string | string[] } | undefined)?.message;
  if (Array.isArray(message) && message.length > 0) return message.join('\n');
  if (typeof message === 'string' && message) return message;
  const errorText = (data as { error?: string } | undefined)?.error;
  if (typeof errorText === 'string' && errorText) return errorText;
  if (typeof e?.message === 'string' && e.message) return e.message;
  return fallback;
}
