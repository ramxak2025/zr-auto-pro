import { humanizeMake } from '../vin.util';
import type { VinDecodeResult } from '../vin.types';
import type { VinDecodeOptions } from './types';

/**
 * NHTSA vPIC — бесплатный справочник Минтранса США, без ключа.
 * GET https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/{vin}?format=json
 *
 * Что он знает: всё, что продавалось в Северной Америке, плюс европейские и
 * корейские заводы (BMW, Kia…) по их WMI/VDS. Чего НЕ знает (проверено
 * 2026-09-25): российские сборки (XTA АвтоВАЗ, XW8 Калуга, Z94 Хёндэ СПб, X7L
 * Рено, XWE Автотор) и китайские бренды (LVV Chery, LGW Haval) — для них Make
 * пустой, ErrorCode «1,7». Поэтому NHTSA — второй источник после платного, а
 * для рынка РФ основную работу делает офлайн-таблица WMI.
 *
 * Любая ошибка (сеть, таймаут, не-JSON, пустой Make) → null, без throw:
 * сервис молча идёт дальше.
 */
export const NHTSA_DECODE_URL = 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues';

/** Тип топлива NHTSA → по-русски (неизвестное значение остаётся как есть). */
const FUEL_RU: Record<string, string> = {
  gasoline: 'Бензин',
  diesel: 'Дизель',
  electric: 'Электро',
  'compressed natural gas (cng)': 'Метан (CNG)',
  'liquefied petroleum gas (propane or lpg)': 'Пропан (LPG)',
  'flexible fuel vehicle (ffv)': 'Бензин/этанол (FFV)',
  ethanol: 'Этанол',
  hydrogen: 'Водород',
  'fuel cell': 'Топливные элементы',
  hybrid: 'Гибрид',
};

/** Тип кузова NHTSA → по-русски (подстрочное совпадение, первое выигрывает). */
const BODY_RU: Array<[RegExp, string]> = [
  [/sedan|saloon/i, 'Седан'],
  [/hatchback|liftback|notchback/i, 'Хэтчбек'],
  [/wagon|estate/i, 'Универсал'],
  [/sport utility|suv|crossover|multi-purpose|mpv/i, 'Внедорожник / кроссовер'],
  [/coupe/i, 'Купе'],
  [/convertible|cabriolet|roadster/i, 'Кабриолет'],
  [/minivan/i, 'Минивэн'],
  [/pickup/i, 'Пикап'],
  [/^van|cargo van|passenger van/i, 'Фургон'],
  [/bus/i, 'Автобус'],
  [/truck/i, 'Грузовик'],
  [/motorcycle/i, 'Мотоцикл'],
];

function nonEmpty(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function translateFuel(raw: string | null): string | null {
  if (!raw) return null;
  return FUEL_RU[raw.toLowerCase()] ?? raw;
}

function translateBody(raw: string | null): string | null {
  if (!raw) return null;
  for (const [re, ru] of BODY_RU) if (re.test(raw)) return ru;
  return raw;
}

/** «2.998832712» → «3.0 л», «1.6» → «1.6 л»; мусор → null. */
function formatDisplacementL(raw: string | null): string | null {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${n.toFixed(1)} л`;
}

export async function decodeVinNhtsa(
  vin: string,
  options: Partial<VinDecodeOptions> = {},
): Promise<Partial<VinDecodeResult> | null> {
  const timeoutMs = options.timeoutMs ?? 4000;
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(`${NHTSA_DECODE_URL}/${encodeURIComponent(vin)}?format=json`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { Results?: Array<Record<string, unknown>> };
    const row = Array.isArray(data?.Results) ? data.Results[0] : null;
    if (!row) return null;

    const make = humanizeMake(row.Make);
    if (!make) return null;

    const yearRaw = Number(nonEmpty(row.ModelYear));
    return {
      make,
      model: nonEmpty(row.Model),
      year: Number.isInteger(yearRaw) && yearRaw > 1900 ? yearRaw : null,
      bodyType: translateBody(nonEmpty(row.BodyClass)),
      fuel: translateFuel(nonEmpty(row.FuelTypePrimary)),
      engine: formatDisplacementL(nonEmpty(row.DisplacementL)),
    };
  } catch {
    return null;
  }
}
