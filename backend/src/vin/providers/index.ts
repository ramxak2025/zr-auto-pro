import type { VinProviderInfo } from '../vin.types';
import type { VinProviderAdapter } from './types';
import { vincarioProvider } from './vincario';

/**
 * Реестр платных провайдеров расшифровки VIN. Новый сервис = новый файл-адаптер
 * + строка здесь: клиенты (web/mobile) получают его через GET /vin/settings →
 * providers и рисуют форму по `fields`, без обновления приложений.
 */
export const VIN_PROVIDERS: readonly VinProviderAdapter[] = [vincarioProvider];

export function findVinProvider(id: string | null | undefined): VinProviderAdapter | null {
  if (!id) return null;
  return VIN_PROVIDERS.find((p) => p.id === id) ?? null;
}

/** Публичное описание провайдера — без decode и без чего-либо секретного. */
export function vinProviderInfo(p: VinProviderAdapter): VinProviderInfo {
  return {
    id: p.id,
    name: p.name,
    ...(p.description ? { description: p.description } : {}),
    ...(p.site ? { site: p.site } : {}),
    fields: p.fields.map((f) => ({ ...f })),
  };
}

export type { VinProviderAdapter, VinDecodeOptions } from './types';
export { decodeVinNhtsa } from './nhtsa';
