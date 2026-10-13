import { BadRequestException } from '@nestjs/common';

/** Strict read-filter validation before any SQL. Off/absent discount means all. */
export function validateJournalFilters(query: Record<string, unknown>) {
  const amount = (key: string): number | undefined => {
    const value = query[key];
    if (value === undefined) return undefined;
    if (
      (typeof value !== 'string' && typeof value !== 'number') ||
      (typeof value === 'string' && !/^\d+(?:\.\d+)?$/.test(value)) ||
      !Number.isFinite(Number(value)) ||
      Number(value) < 0
    ) {
      throw new BadRequestException(`Некорректная граница суммы: ${key}`);
    }
    return Number(value);
  };
  const date = (key: string): string | undefined => {
    const value = query[key];
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1) {
      throw new BadRequestException(`Некорректная дата: ${key}`);
    }
    const parsed = new Date(`${value}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
      throw new BadRequestException(`Некорректная дата: ${key}`);
    }
    return value;
  };
  const amountFrom = amount('amountFrom');
  const amountTo = amount('amountTo');
  const dateFrom = date('dateFrom');
  const dateTo = date('dateTo');
  if (amountFrom !== undefined && amountTo !== undefined && amountFrom > amountTo) {
    throw new BadRequestException('Сумма «От» должна быть не больше суммы «До»');
  }
  if (dateFrom && dateTo && dateFrom > dateTo) throw new BadRequestException('Обратный диапазон дат');
  const value = query.hasDiscount;
  if (value !== undefined && value !== true && value !== false && value !== 'true' && value !== 'false') {
    throw new BadRequestException('Некорректный фильтр скидки');
  }
  // false is explicitly the same as absence: UI only offers "with discount".
  return { amountFrom, amountTo, hasDiscount: value === true || value === 'true' };
}
