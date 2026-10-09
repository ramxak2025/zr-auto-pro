import type { CheckServiceLine, Service } from '../types';

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
