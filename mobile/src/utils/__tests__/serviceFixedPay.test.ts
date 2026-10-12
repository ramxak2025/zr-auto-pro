import type { Service } from '../../../../shared/types';
import { parseServiceImportMatrix, serviceExportMatrix } from '../../../../shared/utils/serviceSpreadsheet';
import { preservePlaceholderServicePrice, servicePriceFormValue } from '../../../../shared/utils/servicePrices';

describe('fixed service pay import and placeholder price edits', () => {
  it('round-trips fixed rubles including zero and percentage settings separately from sale price', () => {
    const services: Service[] = [0, 300.13].map((amount, i) => ({
      id: String(i),
      name: 'Работа',
      defaultPrice: 5000,
      masterPayMode: 'fixed',
      masterFixedAmount: amount,
      masterPercent: 25,
      warrantyDays: null,
      createdAt: '',
    }));
    expect(
      parseServiceImportMatrix(serviceExportMatrix(services)).map((row) => [
        row.masterPayMode,
        row.masterFixedAmount,
        row.masterPercent,
      ]),
    ).toEqual([
      ['fixed', 0, 25],
      ['fixed', 300.13, 25],
    ]);
    expect(
      parseServiceImportMatrix([
        ['Название', 'Тип цены', 'Цена'],
        ['Работа', 'Фиксированная', 1000],
      ])[0],
    ).not.toHaveProperty('masterPayMode');
  });
  it('rejects unknown wage mode and keeps missing fixed value absent for server validation', () => {
    expect(() =>
      parseServiceImportMatrix([
        ['Название', 'Тип цены', 'Цена', 'Начисление мастеру'],
        ['Работа', 'Фиксированная', 100, 'other'],
      ]),
    ).toThrow('Неизвестное начисление');
    expect(
      parseServiceImportMatrix([
        ['Название', 'Тип цены', 'Цена', 'Начисление мастеру', 'Фикс мастеру, ₽'],
        ['Работа', 'Фиксированная', 100, 'Фикс', ''],
      ])[0],
    ).not.toHaveProperty('masterFixedAmount');
  });
  it('wage-only save preserves provisional 1 ruble; explicit same-price confirmation and price change confirm', () => {
    const service = { priceIsPlaceholder: true, defaultPrice: 1 };
    expect(preservePlaceholderServicePrice(service, servicePriceFormValue('fixed', '1', '', ''), false)).toBe(true);
    expect(preservePlaceholderServicePrice(service, servicePriceFormValue('fixed', '1', '', ''), true)).toBe(false);
    expect(preservePlaceholderServicePrice(service, servicePriceFormValue('fixed', '500', '', ''), false)).toBe(false);
  });
});
