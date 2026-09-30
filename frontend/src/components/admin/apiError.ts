/** Ошибка API → человекочитаемый текст: `message` бывает строкой или массивом (class-validator). */
export function apiErrorMessage(err: unknown, fallback: string): string {
  const message = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data?.message;
  const text = Array.isArray(message) ? message[0] : message;
  return typeof text === 'string' && text.trim() ? text : fallback;
}

/** HTTP-статус ошибочного ответа (403/404 и т. п.); undefined — ответа не было (сеть). */
export function apiErrorStatus(err: unknown): number | undefined {
  const status = (err as { response?: { status?: unknown } })?.response?.status;
  return typeof status === 'number' ? status : undefined;
}

/** Код бизнес-ошибки (`PHONE_TAKEN` и т. п.) из тела ответа. */
export function apiErrorCode(err: unknown): string | undefined {
  const code = (err as { response?: { data?: { code?: unknown } } })?.response?.data?.code;
  return typeof code === 'string' ? code : undefined;
}
