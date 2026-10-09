import { BadRequestException } from '@nestjs/common';

export interface ServicePriceInput {
  priceType?: unknown;
  defaultPrice?: unknown;
  minPrice?: unknown;
  maxPrice?: unknown;
}

export interface ServicePricePolicy {
  priceType: 'fixed' | 'range';
  defaultPrice: number;
  minPrice: number;
  maxPrice: number;
}

function money(value: unknown): number {
  const n = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '') ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 9_999_999_999.99) {
    throw new BadRequestException({ message: 'Цена услуги: введите неотрицательную сумму' });
  }
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function normalizeServicePrice(input: ServicePriceInput, prior?: ServicePricePolicy): ServicePricePolicy {
  const priceType = input.priceType === undefined ? (prior?.priceType ?? 'fixed') : input.priceType;
  if (priceType !== 'fixed' && priceType !== 'range') {
    throw new BadRequestException({ message: 'Тип цены услуги: выберите фиксированную цену или диапазон' });
  }
  // Even unused explicit money fields must not let NaN/negative input through.
  for (const value of [input.defaultPrice, input.minPrice, input.maxPrice]) {
    if (value !== undefined) money(value);
  }
  if (priceType === 'fixed') {
    const price = money(input.defaultPrice ?? input.minPrice ?? prior?.defaultPrice ?? 0);
    return { priceType, defaultPrice: price, minPrice: price, maxPrice: price };
  }
  const wasRange = prior?.priceType === 'range';
  const minPrice = money(input.minPrice ?? (wasRange ? (input.defaultPrice ?? prior.minPrice) : undefined));
  const maxPrice = money(input.maxPrice ?? (wasRange ? prior.maxPrice : undefined));
  if (minPrice > maxPrice) {
    throw new BadRequestException({ message: 'Минимальная цена услуги не может быть больше максимальной' });
  }
  return { priceType, defaultPrice: minPrice, minPrice, maxPrice };
}
