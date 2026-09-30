/**
 * adminMoney tests — деньги менеджерских расчётов: доля владельца до копейки,
 * подписи баланса и разбор введённой суммы. Цифры повторяют приёмку спеки §6:
 * оплата 5 000 ₽ при доле владельца 60 % → «Долг владельцу 3 000», «Моя доля 2 000».
 */
import { balanceCaption, computeOwnerShare, formatMoneyExact, formatPercent, parseAmount } from '../adminMoney';

describe('computeOwnerShare', () => {
  test('приёмка спеки: 5 000 ₽ при 60 % — владельцу 3 000, менеджеру 2 000', () => {
    const owner = computeOwnerShare(5000, 60);
    expect(owner).toBe(3000);
    expect(5000 - owner).toBe(2000);
  });

  test('копейки округляются до копейки, как round(amount × pct / 100, 2) на сервере', () => {
    expect(computeOwnerShare(1000, 60)).toBe(600);
    expect(computeOwnerShare(1234.56, 60)).toBe(740.74);
    expect(computeOwnerShare(5000, 33.5)).toBe(1675);
  });

  test('половина копейки округляется вверх, двоичный хвост не мешает', () => {
    // 1.13 × 50 = 56.49999999999999 в double, а numeric в PG даёт 0.565 → 0.57.
    expect(computeOwnerShare(1.13, 50)).toBe(0.57);
    expect(computeOwnerShare(0.29, 50)).toBe(0.15);
  });

  test('ноль и крайние проценты', () => {
    expect(computeOwnerShare(0, 60)).toBe(0);
    expect(computeOwnerShare(5000, 0)).toBe(0);
    expect(computeOwnerShare(5000, 100)).toBe(5000);
  });
});

describe('formatMoneyExact', () => {
  test('целые рубли без копеек, разряды пробелом', () => {
    expect(formatMoneyExact(3000)).toBe('3 000 ₽');
    expect(formatMoneyExact(0)).toBe('0 ₽');
    expect(formatMoneyExact(1234567)).toBe('1 234 567 ₽');
  });

  test('копейки показываются с двумя знаками', () => {
    expect(formatMoneyExact(740.74)).toBe('740,74 ₽');
    expect(formatMoneyExact(0.05)).toBe('0,05 ₽');
    expect(formatMoneyExact(1234.5)).toBe('1 234,50 ₽');
  });

  test('минус типографский, пустое значение — ноль', () => {
    expect(formatMoneyExact(-300)).toBe('−300 ₽');
    expect(formatMoneyExact(Number.NaN)).toBe('0 ₽');
  });
});

describe('formatPercent', () => {
  test('целые и дробные проценты', () => {
    expect(formatPercent(60)).toBe('60 %');
    expect(formatPercent(33.5)).toBe('33,5 %');
    expect(formatPercent(0)).toBe('0 %');
  });

  test('лишние знаки отсекаются до сотых', () => {
    expect(formatPercent(33.333333)).toBe('33,33 %');
  });
});

describe('balanceCaption', () => {
  test('положительный баланс — долг владельцу', () => {
    expect(balanceCaption(3000)).toBe('Долг 3 000 ₽');
    expect(balanceCaption(0.01)).toBe('Долг 0,01 ₽');
  });

  test('отрицательный — переплата', () => {
    expect(balanceCaption(-500)).toBe('Переплата 500 ₽');
  });

  test('шум меньше полкопейки — «Долга нет»', () => {
    expect(balanceCaption(0)).toBe('Долга нет');
    expect(balanceCaption(0.004)).toBe('Долга нет');
    expect(balanceCaption(-0.004)).toBe('Долга нет');
  });

  test('приёмка спеки: после расчёта 3 000 долг 3 000 закрывается', () => {
    expect(balanceCaption(3000 - 3000)).toBe('Долга нет');
  });
});

describe('parseAmount', () => {
  test('целые и дробные суммы с запятой, точкой и пробелами', () => {
    expect(parseAmount('3000')).toBe(3000);
    expect(parseAmount('3 000,50')).toBe(3000.5);
    expect(parseAmount('3000.5')).toBe(3000.5);
  });

  test('лишние знаки после копеек округляются', () => {
    expect(parseAmount('10,999')).toBe(11);
  });

  test('пусто, ноль, минус и мусор — null', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('   ')).toBeNull();
    expect(parseAmount('0')).toBeNull();
    expect(parseAmount('-5')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('1,2,3')).toBeNull();
  });
});
