import { createHash } from 'crypto';
import type { VinDecodeResult } from '../vin.types';
import { maskSecrets, VinDecodeOptions, VinProviderAdapter } from './types';

/**
 * Vincario (vindecoder.eu) — платный VIN-декодер, ключ покупает сам клиент.
 *
 * ПОЧЕМУ ИМЕННО ОН ПЕРВЫЙ (проверено по документации 2026-09-25, детали —
 * docs/specs/2026-09-25-VIN.md, раздел 6): единственный из кандидатов, где
 * ключ API получают самостоятельно — регистрация на vincario.com, покупка
 * пакета запросов картой, API key + Secret key появляются в личном кабинете;
 * 20 бесплатных запросов на тест, невалидные VIN не тарифицируются. Автокод и
 * Автотека дают API только по договору через менеджера.
 *
 * ПРОТОКОЛ (REST JSON, API 3.2):
 *   GET https://api.vindecoder.eu/3.2/{apiKey}/{controlSum}/decode/{vin}.json
 *   controlSum = первые 10 символов sha1("{vin}|decode|{apiKey}|{secretKey}")
 *   Ответ: { "decode": [ { "label": "Make", "value": "Skoda" }, … ] }
 *   Ошибка: HTTP 4xx/5xx либо 200 с { "error": "...", "message": "..." }.
 *
 * СЕКРЕТЫ. Ключ стоит прямо в URL — URL не логируется никогда; текст любой
 * ошибки перед выбросом наружу проходит maskSecrets.
 */
export const VINCARIO_API_BASE = 'https://api.vindecoder.eu/3.2';

export function vincarioControlSum(vin: string, apiKey: string, secretKey: string, action = 'decode'): string {
  return createHash('sha1').update(`${vin}|${action}|${apiKey}|${secretKey}`).digest('hex').slice(0, 10);
}

interface VincarioDecodeItem {
  label?: unknown;
  value?: unknown;
}

/** «Engine Displacement (ccm)» 1598 → «1.6 л»; «Engine Power (kW)» 81 → «110 л.с.». */
function formatEngine(fields: Map<string, string>): string | null {
  const parts: string[] = [];
  const ccm = Number(fields.get('engine displacement (ccm)'));
  if (Number.isFinite(ccm) && ccm > 0) parts.push(`${(ccm / 1000).toFixed(1)} л`);
  const kw = Number(fields.get('engine power (kw)'));
  if (Number.isFinite(kw) && kw > 0) parts.push(`${Math.round(kw * 1.35962)} л.с.`);
  if (parts.length === 0) {
    const full = fields.get('engine (full)') ?? fields.get('engine');
    return full || null;
  }
  return parts.join(', ');
}

export const vincarioProvider: VinProviderAdapter = {
  id: 'vincario',
  name: 'Vincario (vindecoder.eu)',
  description:
    'Европейская база расшифровки VIN: марка, модель, год, кузов, двигатель. Ключ и секрет — в личном ' +
    'кабинете vincario.com, оплата пакетами запросов (20 запросов бесплатно на тест).',
  site: 'https://vincario.com/pricing/',
  fields: [
    { key: 'apiKey', label: 'API key', secret: true, placeholder: 'Из личного кабинета Vincario' },
    { key: 'secretKey', label: 'Secret key', secret: true, placeholder: 'Из личного кабинета Vincario' },
  ],

  async decode(
    vin: string,
    credentials: Record<string, string>,
    options: VinDecodeOptions,
  ): Promise<Partial<VinDecodeResult> | null> {
    const apiKey = (credentials.apiKey || '').trim();
    const secretKey = (credentials.secretKey || '').trim();
    if (!apiKey || !secretKey) throw new Error('Vincario: не заданы API key / Secret key');
    const secrets = [apiKey, secretKey];
    const fetchImpl = options.fetchImpl ?? fetch;
    const url = `${VINCARIO_API_BASE}/${encodeURIComponent(apiKey)}/${vincarioControlSum(vin, apiKey, secretKey)}/decode/${encodeURIComponent(vin)}.json`;

    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(options.timeoutMs),
      });
    } catch (err) {
      throw new Error(`Vincario: ${maskSecrets((err as Error)?.message || 'сетевая ошибка', secrets)}`);
    }

    const raw = await response.text();
    let data: { decode?: unknown; error?: unknown; message?: unknown };
    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(`Vincario: неожиданный формат ответа (HTTP ${response.status})`);
    }
    if (!response.ok || data.error) {
      const detail = typeof data.message === 'string' ? data.message : String(data.error ?? `HTTP ${response.status}`);
      throw new Error(`Vincario: ${maskSecrets(detail, secrets)}`);
    }
    if (!Array.isArray(data.decode)) return null;

    const fields = new Map<string, string>();
    for (const item of data.decode as VincarioDecodeItem[]) {
      if (typeof item?.label !== 'string') continue;
      const value = item.value;
      if (value === null || value === undefined || value === '') continue;
      fields.set(item.label.trim().toLowerCase(), String(value).trim());
    }

    const make = fields.get('make') || null;
    if (!make) return null;
    const year = Number(fields.get('model year'));
    return {
      make,
      model: fields.get('model') || null,
      year: Number.isInteger(year) && year > 1900 ? year : null,
      bodyType: fields.get('body') || null,
      fuel: fields.get('fuel type - primary') || fields.get('fuel type') || null,
      engine: formatEngine(fields),
    };
  },
};
