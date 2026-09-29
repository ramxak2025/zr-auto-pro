/**
 * Строки услуг заказ-наряда — `shared/utils/checkLines.ts` (2026-09-30, услуги без
 * количества). Сервер считает сумму строки как round2(price × (quantity || 1)).
 */
import { MAX_EXPANDED_QUANTITY, expandServiceQuantities, serviceLineTotal } from '../../../../shared/utils/checkLines';

describe('serviceLineTotal', () => {
  it('новая строка — просто цена', () => {
    expect(serviceLineTotal({ price: 500 })).toBe(500);
    expect(serviceLineTotal({ price: 500, quantity: 1 })).toBe(500);
    expect(serviceLineTotal({ price: 500, quantity: null })).toBe(500);
    expect(serviceLineTotal({ price: 500, quantity: undefined })).toBe(500);
  });

  it('legacy-строка «×N» — цена на количество', () => {
    expect(serviceLineTotal({ price: 500, quantity: 3 })).toBe(1500);
    expect(serviceLineTotal({ price: 0, quantity: 5 })).toBe(0);
  });

  it('округляет до копеек без артефактов float', () => {
    expect(serviceLineTotal({ price: 0.1, quantity: 3 })).toBe(0.3); // 0.30000000000000004
    expect(serviceLineTotal({ price: 19.99, quantity: 3 })).toBe(59.97); // 59.96999999999999
    expect(serviceLineTotal({ price: 1.005 })).toBe(1.01);
    expect(serviceLineTotal({ price: 99.999 })).toBe(100);
  });

  it('игнорирует поле total: считает от цены и количества', () => {
    expect(serviceLineTotal({ price: 100, quantity: 2, total: 12345 })).toBe(200);
  });

  it('нечисловая цена — 0, нечисловое количество — 1', () => {
    expect(serviceLineTotal({ price: Number.NaN })).toBe(0);
    expect(serviceLineTotal({ price: Infinity })).toBe(0);
    expect(serviceLineTotal({ price: 100, quantity: Number.NaN })).toBe(100);
  });
});

describe('expandServiceQuantities', () => {
  const legacy = { serviceId: 's1', name: 'Мойка', price: 500, quantity: 3, total: 1500, masterId: 'm1' };

  it('строка «×3» становится тремя строками с quantity 1 и total = price', () => {
    const out = expandServiceQuantities([legacy]);
    expect(out).toHaveLength(3);
    for (const line of out) {
      expect(line).toEqual({ serviceId: 's1', name: 'Мойка', price: 500, quantity: 1, total: 500, masterId: 'm1' });
    }
  });

  it('сохраняет порядок и не трогает обычные строки', () => {
    const one = { name: 'Диагностика', price: 300, quantity: 1, total: 300 };
    const out = expandServiceQuantities([{ ...legacy, quantity: 2, total: 1000 }, one]);
    expect(out.map((l) => l.name)).toEqual(['Мойка', 'Мойка', 'Диагностика']);
    expect(out[2]).toBe(one); // та же ссылка
  });

  it('строка шаблона без total не получает total', () => {
    const tpl = { serviceId: 's2', name: 'Полировка', price: 1200, quantity: 2 };
    const out = expandServiceQuantities([tpl]);
    expect(out).toEqual([
      { serviceId: 's2', name: 'Полировка', price: 1200, quantity: 1 },
      { serviceId: 's2', name: 'Полировка', price: 1200, quantity: 1 },
    ]);
    for (const line of out) expect('total' in line).toBe(false);
  });

  it('total копий округляется как на сервере', () => {
    const out = expandServiceQuantities([{ name: 'X', price: 99.999, quantity: 2, total: 200 }]);
    expect(out.map((l) => l.total)).toEqual([100, 100]);
  });

  it('quantity пустое, 1, 0, отрицательное или дробное — строка остаётся как есть', () => {
    const lines = [
      { name: 'a', price: 1 },
      { name: 'b', price: 1, quantity: null },
      { name: 'c', price: 1, quantity: 1 },
      { name: 'd', price: 1, quantity: 0 },
      { name: 'e', price: 1, quantity: -2 },
      { name: 'f', price: 1, quantity: 2.5 },
      { name: 'g', price: 1, quantity: Number.NaN },
    ];
    const out = expandServiceQuantities(lines);
    expect(out).toHaveLength(lines.length);
    out.forEach((line, i) => expect(line).toBe(lines[i]));
  });

  it('гигантское количество не разворачивается — остаётся legacy-строкой', () => {
    const big = { name: 'Y', price: 10, quantity: MAX_EXPANDED_QUANTITY + 1, total: 10 * (MAX_EXPANDED_QUANTITY + 1) };
    const out = expandServiceQuantities([big]);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(big);
    expect(expandServiceQuantities([{ name: 'Z', price: 1, quantity: MAX_EXPANDED_QUANTITY }])).toHaveLength(
      MAX_EXPANDED_QUANTITY,
    );
    expect(expandServiceQuantities([{ name: 'Z', price: 1, quantity: 1e9 }])).toHaveLength(1);
  });

  it('не мутирует вход, копии независимы', () => {
    const input = [{ ...legacy }];
    const snapshot = JSON.parse(JSON.stringify(input));
    const out = expandServiceQuantities(input);
    expect(input).toEqual(snapshot);
    expect(out[0]).not.toBe(input[0]);
    expect(out[0]).not.toBe(out[1]);
  });

  it('пустой список — пустой список', () => {
    expect(expandServiceQuantities([])).toEqual([]);
  });

  it('сумма развёрнутых строк равна сумме legacy-строки', () => {
    const before = serviceLineTotal(legacy);
    const after = expandServiceQuantities([legacy]).reduce((sum, l) => sum + serviceLineTotal(l), 0);
    expect(after).toBe(before);
  });
});
