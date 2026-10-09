import type { Service } from '../../../../shared/types';
import {
  assertNoServiceWorkbookFormulas,
  assertServiceWorkbookSafe,
  parseServiceImportMatrix,
  serviceExportMatrix,
} from '../../../../shared/utils/serviceSpreadsheet';
import { isServicePriceSelectionValid, servicePriceFormValue } from '../../../../shared/utils/servicePrices';

describe('service pricing and spreadsheet contract', () => {
  it('uses fixed price for every bound and allows zero', () => {
    expect(servicePriceFormValue('fixed', '0', '', '')).toEqual({
      priceType: 'fixed',
      defaultPrice: 0,
      minPrice: 0,
      maxPrice: 0,
    });
  });

  it('requires both range values and validates order without imposing range limits on check prices', () => {
    expect(() => servicePriceFormValue('range', '', '', '900')).toThrow('Введите обе цены диапазона');
    expect(() => servicePriceFormValue('range', '', '901', '900')).toThrow('Максимум не может быть меньше минимума');
    expect(() => servicePriceFormValue('range', '', '-1', '900')).toThrow('Введите обе цены диапазона');
    expect(servicePriceFormValue('range', '', '500', '900')).toEqual({
      priceType: 'range',
      defaultPrice: 500,
      minPrice: 500,
      maxPrice: 900,
    });
    expect(isServicePriceSelectionValid('range', 0, true)).toBe(true);
    expect(isServicePriceSelectionValid('range', 100, true)).toBe(true);
    expect(isServicePriceSelectionValid('range', 1500, true)).toBe(true);
    expect(isServicePriceSelectionValid('range', 500, false)).toBe(false);
    expect(isServicePriceSelectionValid('range', -1, true)).toBe(false);
    expect(isServicePriceSelectionValid('range', 10_000_000_000, true)).toBe(false);
  });

  it('round-trips fixed, zero and nested range services through the import columns', () => {
    const services: Service[] = [
      {
        id: 'fixed-id',
        name: 'Нулевая услуга',
        category: 'Диагностика/Электрика',
        defaultPrice: 0,
        priceType: 'fixed',
        masterPercent: 0,
        warrantyDays: 0,
        createdAt: '2026-01-01',
      },
      {
        id: 'range-id',
        name: 'Поиск неисправности',
        category: 'Диагностика/Электрика/Сложная',
        defaultPrice: 500,
        minPrice: 500,
        maxPrice: 1200,
        priceType: 'range',
        masterPercent: 35,
        warrantyDays: 30,
        createdAt: '2026-01-01',
      },
    ];
    const parsed = parseServiceImportMatrix(serviceExportMatrix(services));
    expect(parsed).toEqual([
      {
        sourceRow: 2,
        id: 'fixed-id',
        name: 'Нулевая услуга',
        category: 'Диагностика/Электрика',
        priceType: 'fixed',
        defaultPrice: 0,
        masterPercent: 0,
        warrantyDays: 0,
      },
      {
        sourceRow: 3,
        id: 'range-id',
        name: 'Поиск неисправности',
        category: 'Диагностика/Электрика/Сложная',
        priceType: 'range',
        defaultPrice: 500,
        minPrice: 500,
        maxPrice: 1200,
        masterPercent: 35,
        warrantyDays: 30,
      },
    ]);
  });

  it('does not coerce blank workbook prices to zero; explicit zero is valid', () => {
    const headers = [['ID', 'Название', 'Категория', 'Тип цены', 'Цена', 'От', 'До', '% мастера', 'Гарантия, дней']];
    expect(() =>
      parseServiceImportMatrix([...headers, ['', 'Работа', '', 'Фиксированная', '', '', '', '', '']]),
    ).toThrow('не указана цена');
    expect(
      parseServiceImportMatrix([...headers, ['', 'Работа', '', 'Фиксированная', 0, '', '', '', '']])[0].defaultPrice,
    ).toBe(0);
    expect(() => parseServiceImportMatrix([...headers, ['', 'Работа', '', 'Диапазон', '', '', 800, '', '']])).toThrow(
      'обе границы диапазона',
    );
  });

  it('rejects formulas and XLSX archives with excessive expanded size', () => {
    expect(() => assertNoServiceWorkbookFormulas([{ A1: { f: '1+1' } }])).toThrow('Формулы');
    const archive = new Uint8Array(68);
    const view = new DataView(archive.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint32(24, 20 * 1024 * 1024 + 1, true);
    view.setUint32(46, 0x06054b50, true);
    view.setUint16(56, 1, true);
    view.setUint16(58, 1, true);
    view.setUint32(62, 0, true);
    expect(() => assertServiceWorkbookSafe(archive)).toThrow('Распакованный размер');
    expect(() => assertServiceWorkbookSafe(new Uint8Array(5 * 1024 * 1024 + 1))).toThrow('5 МБ');
  });
});
