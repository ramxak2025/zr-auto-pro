import { parseMoneyInput, readNumericField } from '../numberInput';

describe('parseMoneyInput', () => {
  it('принимает точку и запятую как один и тот же разделитель', () => {
    expect(parseMoneyInput('1250.50')).toBe(1250.5);
    // Главный кейс бага: русская цифровая клавиатура iOS даёт запятую.
    expect(parseMoneyInput('1250,50')).toBe(1250.5);
  });

  it('убирает пробелы-разряды (в т. ч. неразрывные)', () => {
    expect(parseMoneyInput('1 250,50')).toBe(1250.5);
    expect(parseMoneyInput('1 250')).toBe(1250);
    expect(parseMoneyInput('1 250')).toBe(1250);
  });

  it('округляет до 2 знаков — NUMERIC(12,2)', () => {
    expect(parseMoneyInput('12,345')).toBe(12.35);
    expect(parseMoneyInput('0,004')).toBe(0);
  });

  it('пустая строка и мусор — null, а НЕ 0', () => {
    expect(parseMoneyInput('')).toBeNull();
    expect(parseMoneyInput('   ')).toBeNull();
    expect(parseMoneyInput('абв')).toBeNull();
    expect(parseMoneyInput('12,5,7')).toBeNull();
    expect(parseMoneyInput('12abc')).toBeNull();
  });

  it('отрицательные и нулевые значения проходят как есть', () => {
    expect(parseMoneyInput('0')).toBe(0);
    expect(parseMoneyInput('-3,5')).toBe(-3.5);
  });
});

describe('readNumericField', () => {
  it('пустое поле трактуется как 0', () => {
    expect(readNumericField('', 'money')).toBe(0);
    expect(readNumericField('   ', 'qty')).toBe(0);
  });

  it('деньги — 2 знака, количества — 3 знака', () => {
    expect(readNumericField('12,345', 'money')).toBe(12.35);
    expect(readNumericField('12,3456', 'qty')).toBe(12.346);
  });

  it('мусор — null, чтобы форма показала ошибку вместо тихого нуля', () => {
    expect(readNumericField('абв', 'money')).toBeNull();
    expect(readNumericField('абв', 'qty')).toBeNull();
  });
});
