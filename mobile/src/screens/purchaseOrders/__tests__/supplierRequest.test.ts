import {
  buildSupplierRequestText,
  buildWhatsappLink,
  formatSupplyDate,
  isFutureDay,
  isSameDay,
  toSupplyDateStr,
} from '../purchaseOrderHelpers';

describe('buildSupplierRequestText', () => {
  it('lists each line as «• <name> — <qty> шт» without prices or totals', () => {
    const text = buildSupplierRequestText(
      [
        { name: 'Масло 5W-30', quantity: 4 },
        { name: 'Фильтр масляный', quantity: 10 },
      ],
      'ООО Запчасти',
    );
    expect(text).toContain('ООО Запчасти');
    expect(text).toContain('• Масло 5W-30 — 4 шт');
    expect(text).toContain('• Фильтр масляный — 10 шт');
    // No money: never a ₽ symbol and no "Итого".
    expect(text).not.toMatch(/₽/);
    expect(text).not.toMatch(/Итого/i);
  });

  it('greets generically without a supplier name and skips blank lines', () => {
    const text = buildSupplierRequestText([
      { name: '  ', quantity: 2 },
      { name: 'Свеча', quantity: 1 },
    ]);
    expect(text.startsWith('Здравствуйте!')).toBe(true);
    expect(text).toContain('• Свеча — 1 шт');
    expect(text).not.toContain('—  —');
  });

  it('rounds and floors quantity to at least 1', () => {
    const text = buildSupplierRequestText([{ name: 'Ремень', quantity: 0 }]);
    expect(text).toContain('• Ремень — 1 шт');
  });
});

describe('buildWhatsappLink', () => {
  it('strips non-digits from the phone and encodes the text', () => {
    const link = buildWhatsappLink('привет', '+7 (900) 123-45-67');
    expect(link).toBe(`whatsapp://send?phone=79001234567&text=${encodeURIComponent('привет')}`);
  });

  it('omits the phone param when no usable phone is present', () => {
    expect(buildWhatsappLink('hi', '')).toBe(`whatsapp://send?text=${encodeURIComponent('hi')}`);
    expect(buildWhatsappLink('hi', null)).toBe(`whatsapp://send?text=${encodeURIComponent('hi')}`);
  });
});

// ── Дата поставки (159): выбор даты приёмки / смена даты проведённой ─────────
describe('supply date helpers', () => {
  it('toSupplyDateStr пишет локальный календарный день без UTC-сдвига', () => {
    // 1 января 00:30 локального времени: toISOString() на МСК дал бы 31 декабря.
    expect(toSupplyDateStr(new Date(2026, 0, 1, 0, 30))).toBe('2026-01-01');
    expect(toSupplyDateStr(new Date(2026, 8, 9, 23, 59))).toBe('2026-09-09');
  });

  it('formatSupplyDate печатает ДД.ММ.ГГГГ с ведущими нулями', () => {
    expect(formatSupplyDate(new Date(2026, 8, 3))).toBe('03.09.2026');
  });

  it('isFutureDay: завтра — будущее, сегодня и вчера — нет', () => {
    const now = new Date();
    const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    expect(isFutureDay(tomorrow)).toBe(true);
    expect(isFutureDay(now)).toBe(false);
    expect(isFutureDay(yesterday)).toBe(false);
  });

  it('isSameDay сравнивает календарный день, а не миллисекунды', () => {
    expect(isSameDay(new Date(2026, 8, 9, 1, 0), new Date(2026, 8, 9, 23, 0))).toBe(true);
    expect(isSameDay(new Date(2026, 8, 9), new Date(2026, 8, 10))).toBe(false);
  });
});
