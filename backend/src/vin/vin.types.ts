/**
 * Серверные типы VIN (171, 2026-09-25) — ЗЕРКАЛО контракта shared/types/index.ts
 * (секция «VIN (171)»): VinDecodeSource, VinDecodeResult, VinProviderField,
 * VinProviderInfo, VinSettings. Backend не импортирует shared/, поэтому формы
 * продублированы; поле переименовали в контракте — переименуйте и здесь.
 */

/** Откуда взяты марка/модель при расшифровке. */
export type VinDecodeSource = 'paid' | 'nhtsa' | 'wmi' | 'none';

/** POST /vin/decode { vin } → результат. */
export interface VinDecodeResult {
  /** Канонический VIN (normalizeVin). */
  vin: string;
  /** Синтаксически корректен: 17 символов допустимого алфавита. */
  valid: boolean;
  /** Марка («Kia», «Lada»). null — определить не удалось. */
  make: string | null;
  /** Модель («Rio», «Vesta»). null — не определена (частый случай у бесплатных источников). */
  model: string | null;
  /** Модельный год. */
  year: number | null;
  /** Готовая строка для поля «Марка и модель»: «Kia Rio» / «Kia» / null. */
  makeModel: string | null;
  /** Источник марки/модели. 'none' — ничего не нашли (valid при этом может быть true). */
  source: VinDecodeSource;
  /** Доп. поля, когда источник их отдаёт (платный сервис / NHTSA). */
  bodyType?: string | null;
  engine?: string | null;
  fuel?: string | null;
  /** Пояснения для UI («Платный сервис не ответил — использованы бесплатные источники»). */
  notes?: string[];
}

/** Поле учётных данных платного сервиса (ключ, секрет, логин…). */
export interface VinProviderField {
  key: string;
  label: string;
  /** Секрет — в UI поле пароля; сервер никогда не возвращает сохранённое значение. */
  secret?: boolean;
  placeholder?: string;
}

/** Описание платного сервиса расшифровки VIN — отдаётся клиентам в VinSettings.providers. */
export interface VinProviderInfo {
  id: string;
  name: string;
  description?: string;
  /** Где клиент получает ключ (сайт сервиса). */
  site?: string;
  fields: VinProviderField[];
}

/** GET /vin/settings — настройки VIN текущего тенанта. */
export interface VinSettings {
  enabled: boolean;
  /** id провайдера из providers, либо null — только бесплатные источники. */
  provider: string | null;
  /** Учётные данные провайдера сохранены (сами значения не возвращаются). */
  hasCredentials: boolean;
  providers: VinProviderInfo[];
}
