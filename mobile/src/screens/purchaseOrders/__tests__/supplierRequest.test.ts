import { buildSupplierRequestText, buildWhatsappLink } from '../purchaseOrderHelpers';

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
