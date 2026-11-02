export interface PublicProduct {
  name: string;
  photos: string[];
  sellPrice: number;
}

/** Bare public request: never attaches staff credentials or touches session state. */
export async function loadPublicProduct(token: string, signal?: AbortSignal): Promise<PublicProduct> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Ссылка недоступна или отозвана.');
  const base = new URL(import.meta.env.VITE_API_URL || '/api', window.location.origin);
  const response = await fetch(`${base.href.replace(/\/$/, '')}/public/products/${token}`, {
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    signal,
  });
  if (!response.ok)
    throw new Error(
      response.status === 404 ? 'Ссылка недоступна или отозвана.' : 'Не удалось загрузить товар. Попробуйте ещё раз.',
    );
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object') throw new Error('Не удалось загрузить товар.');
  const value = data as Partial<PublicProduct>;
  if (typeof value.name !== 'string' || typeof value.sellPrice !== 'number' || !Number.isFinite(value.sellPrice))
    throw new Error('Не удалось загрузить товар.');
  const allowed = new RegExp(`^/api/public/products/${token}/images/[0-3]$`);
  return {
    name: value.name,
    sellPrice: value.sellPrice,
    photos: (Array.isArray(value.photos) ? value.photos : [])
      .filter((path): path is string => typeof path === 'string' && allowed.test(path))
      .slice(0, 4)
      .map((path) => new URL(path, base.origin).href),
  };
}
