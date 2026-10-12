import { BadRequestException } from '@nestjs/common';

export interface ServicePayInput {
  masterPayMode?: unknown;
  masterFixedAmount?: unknown;
}
export interface ServicePayPolicy {
  masterPayMode: 'percent' | 'fixed';
  masterFixedAmount: number | null;
}

/** Partial catalogue writes retain the existing mode; fixed zero is a real setting. */
export function normalizeServicePay(input: ServicePayInput, prior?: ServicePayPolicy): ServicePayPolicy {
  const mode = input.masterPayMode === undefined ? (prior?.masterPayMode ?? 'percent') : input.masterPayMode;
  if (mode !== 'percent' && mode !== 'fixed') {
    throw new BadRequestException({ message: 'Выберите начисление мастеру: процент или фикс' });
  }
  const raw = input.masterFixedAmount === undefined ? prior?.masterFixedAmount : input.masterFixedAmount;
  if (
    input.masterFixedAmount !== undefined &&
    input.masterFixedAmount !== null &&
    (typeof input.masterFixedAmount !== 'number' ||
      !Number.isFinite(input.masterFixedAmount) ||
      input.masterFixedAmount < 0 ||
      input.masterFixedAmount > 9999999999.99)
  ) {
    throw new BadRequestException({ message: 'Фикс мастеру должен быть неотрицательной суммой в рублях' });
  }
  if (mode === 'percent') return { masterPayMode: mode, masterFixedAmount: null };
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > 9999999999.99) {
    throw new BadRequestException({ message: 'Укажите фикс мастеру в рублях. Для нуля введите 0.' });
  }
  return { masterPayMode: mode, masterFixedAmount: Math.round((raw + Number.EPSILON) * 100) / 100 };
}
