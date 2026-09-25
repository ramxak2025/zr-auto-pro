import type { VinDecodeResult, VinProviderField } from '../vin.types';

/** Опции вызова адаптера: дедлайн и подменяемый fetch (для тестов без сети). */
export interface VinDecodeOptions {
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

/**
 * Адаптер ПЛАТНОГО сервиса расшифровки VIN. Ключи — у самого клиента
 * (tenants.vin_decoder_credentials), Autexa за запросы не платит.
 *
 * Контракт:
 *   • `fields` описывает, какие учётные данные нужны (и какие из них секреты);
 *     этот же список уезжает клиентам в VinSettings.providers — форму настроек
 *     они рисуют по нему, ничего не хардкодя;
 *   • `decode` возвращает найденные поля (хотя бы make) или null, если сервис
 *     ничего не знает о VIN; сетевая/авторизационная ошибка — throw. Сервис
 *     ловит и то и другое и уходит к бесплатным источникам с пометкой в notes.
 *   • Секреты НИКОГДА не попадают в сообщения ошибок и логи: URL с ключом не
 *     логируется, текст ошибки провайдера пропускается через маскирование.
 */
export interface VinProviderAdapter {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly site?: string;
  readonly fields: VinProviderField[];
  decode(
    vin: string,
    credentials: Record<string, string>,
    options: VinDecodeOptions,
  ): Promise<Partial<VinDecodeResult> | null>;
}

/** Убрать секреты из произвольного текста (сообщения ошибок, тела ответов). */
export function maskSecrets(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 4) out = out.split(secret).join('***');
  }
  return out;
}
