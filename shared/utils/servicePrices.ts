import type { CheckServiceLine, Service } from '../types';

export interface ServicePriceFormValue {
  priceType: 'fixed' | 'range';
  defaultPrice: number;
  minPrice: number;
  maxPrice: number;
}

function parseFormPrice(raw: string): number | null {
  if (!raw.trim()) return null;
  const value = Number(raw.replace(/[\s\u00a0]/g, '').replace(',', '.'));
  return Number.isFinite(value) && value >= 0 && value <= 9_999_999_999.99
    ? Math.round((value + Number.EPSILON) * 100) / 100
    : null;
}

/** Shared catalogue form validation. Range bounds are descriptive; a check price may be outside them. */
export function servicePriceFormValue(
  priceType: 'fixed' | 'range',
  fixedRaw: string,
  minRaw: string,
  maxRaw: string,
): ServicePriceFormValue {
  if (priceType === 'fixed') {
    const price = parseFormPrice(fixedRaw);
    if (price === null) throw new Error('Введите неотрицательную цену');
    return { priceType, defaultPrice: price, minPrice: price, maxPrice: price };
  }
  const minPrice = parseFormPrice(minRaw);
  const maxPrice = parseFormPrice(maxRaw);
  if (minPrice === null || maxPrice === null) throw new Error('Введите обе цены диапазона');
  if (maxPrice < minPrice) throw new Error('Максимум не может быть меньше минимума');
  return { priceType, defaultPrice: minPrice, minPrice, maxPrice };
}

/** Range catalogue prices require an explicit entered/selected check price; bounds are never auto-picked. */
export function isServicePriceSelectionValid(priceType: 'fixed' | 'range', price: number, explicitlyEntered: boolean): boolean {
  return Number.isFinite(price) && price >= 0 && price <= 9_999_999_999.99 && (priceType !== 'range' || explicitlyEntered);
}

/** Production form transition: clearing resets the amount, and only a valid committed value is confirmed. */
export function applyServicePriceInput<T extends { price: number; priceConfirmed?: boolean }>(
  line: T,
  price: number,
  explicitlyEntered: boolean,
): T {
  return { ...line, price, priceConfirmed: explicitlyEntered };
}

/** Legacy catalogue entries are fixed-price entries. A range starts at minPrice. */
export function servicePriceBounds(service: Pick<Service, 'defaultPrice' | 'priceType' | 'minPrice' | 'maxPrice'>) {
  const priceType = service.priceType ?? 'fixed';
  const minPrice = priceType === 'range' ? (service.minPrice ?? service.defaultPrice) : service.defaultPrice;
  const maxPrice = priceType === 'range' ? (service.maxPrice ?? minPrice) : service.defaultPrice;
  return { priceType, minPrice, maxPrice, threshold: priceType === 'range' ? maxPrice : service.defaultPrice };
}

/** For an edit preview only; the server computes and persists authoritative excess. */
export function serviceLinePriceExcess(
  line: Pick<CheckServiceLine, 'price' | 'quantity' | 'priceSnapshotStatus' | 'priceThreshold'>,
): number {
  if (line.priceSnapshotStatus !== 'catalog' || line.priceThreshold == null) return 0;
  const value = (line.price - line.priceThreshold) * (line.quantity || 1);
  return Number.isFinite(value) ? Math.max(0, Math.round((value + Number.EPSILON) * 100) / 100) : 0;
}
