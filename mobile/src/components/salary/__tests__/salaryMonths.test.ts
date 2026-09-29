/**
 * Месяц «за который» (правка 2026-09-30): ключи 'YYYY-MM', подписи, список месяцев пикера,
 * бейдж расхода «за сентябрь», долг за прошлые месяцы и подсказки суммы формы выплаты.
 */
import {
  buildPayoutSuggestions,
  carryOverRows,
  isMonthKey,
  monthKeyInline,
  monthKeyLabel,
  monthKeyOfDate,
  payoutSheetTitle,
  periodBadgeLabel,
  recentMonthOptions,
} from '../salaryFormat';

describe('isMonthKey', () => {
  test('принимает только YYYY-MM с месяцем 01..12', () => {
    expect(isMonthKey('2026-09')).toBe(true);
    expect(isMonthKey('2026-12')).toBe(true);
    expect(isMonthKey('2026-00')).toBe(false);
    expect(isMonthKey('2026-13')).toBe(false);
    expect(isMonthKey('2026-9')).toBe(false);
    expect(isMonthKey('2026-09-01')).toBe(false);
    expect(isMonthKey('')).toBe(false);
    expect(isMonthKey(null)).toBe(false);
    expect(isMonthKey(undefined)).toBe(false);
    expect(isMonthKey(202609)).toBe(false);
  });
});

describe('monthKeyLabel / monthKeyInline', () => {
  test('значение поля: «Сентябрь 2026», без года — «Сентябрь»', () => {
    expect(monthKeyLabel('2026-09')).toBe('Сентябрь 2026');
    expect(monthKeyLabel('2026-09', false)).toBe('Сентябрь');
    expect(monthKeyLabel('2027-01')).toBe('Январь 2027');
  });

  test('бегущий текст: «сентябрь», с годом — «сентябрь 2026»', () => {
    expect(monthKeyInline('2026-09')).toBe('сентябрь');
    expect(monthKeyInline('2026-09', true)).toBe('сентябрь 2026');
  });

  test('мусор и пусто — пустая строка, а не «undefined 2026»', () => {
    for (const bad of ['', '2026-13', 'сентябрь', null, undefined]) {
      expect(monthKeyLabel(bad)).toBe('');
      expect(monthKeyInline(bad)).toBe('');
    }
  });
});

describe('payoutSheetTitle', () => {
  const now = new Date(2026, 9, 5); // 5 октября 2026

  test('месяц текущего года — без года: заголовок листа должен помещаться в шапку', () => {
    expect(payoutSheetTitle('2026-09', 'Иван Петров', now)).toBe('Выплата за сентябрь — Иван Петров');
  });

  test('месяц другого года — с годом', () => {
    expect(payoutSheetTitle('2025-12', 'Иван Петров', now)).toBe('Выплата за декабрь 2025 — Иван Петров');
  });

  test('без имени сотрудника', () => {
    expect(payoutSheetTitle('2026-09', undefined, now)).toBe('Выплата за сентябрь');
    expect(payoutSheetTitle('2026-09', null, now)).toBe('Выплата за сентябрь');
  });

  test('невалидный месяц — просто «Выплата»', () => {
    expect(payoutSheetTitle('', 'Иван', now)).toBe('Выплата — Иван');
    expect(payoutSheetTitle('oops', undefined, now)).toBe('Выплата');
  });
});

describe('recentMonthOptions', () => {
  test('текущий месяц и 12 предыдущих, свежие сверху', () => {
    const opts = recentMonthOptions(13, new Date(2026, 9, 5));
    expect(opts).toHaveLength(13);
    expect(opts[0]).toEqual({ key: '2026-10', label: 'Октябрь 2026' });
    expect(opts[1]).toEqual({ key: '2026-09', label: 'Сентябрь 2026' });
    expect(opts[12]).toEqual({ key: '2025-10', label: 'Октябрь 2025' });
  });

  test('переход через границу года', () => {
    const opts = recentMonthOptions(13, new Date(2026, 0, 31));
    expect(opts.map((o) => o.key)).toEqual([
      '2026-01',
      '2025-12',
      '2025-11',
      '2025-10',
      '2025-09',
      '2025-08',
      '2025-07',
      '2025-06',
      '2025-05',
      '2025-04',
      '2025-03',
      '2025-02',
      '2025-01',
    ]);
  });

  test('include: месяц вне окна остаётся в списке, дубль не добавляется, мусор игнорируется', () => {
    const opts = recentMonthOptions(13, new Date(2026, 9, 5), ['2024-03', '2026-09', 'oops', null, undefined]);
    expect(opts).toHaveLength(14);
    expect(opts[13]).toEqual({ key: '2024-03', label: 'Март 2024' });
    expect(opts.filter((o) => o.key === '2026-09')).toHaveLength(1);
  });
});

describe('monthKeyOfDate', () => {
  test('чистая дата — месяц из самой строки, без сдвига по часовому поясу', () => {
    expect(monthKeyOfDate('2026-09-01')).toBe('2026-09');
    expect(monthKeyOfDate('2026-10-31')).toBe('2026-10');
  });

  test('ISO-время — месяц по локальному календарю устройства', () => {
    expect(monthKeyOfDate('2026-09-15T12:00:00.000Z')).toBe('2026-09');
  });

  test('пусто и мусор — пустая строка', () => {
    expect(monthKeyOfDate('')).toBe('');
    expect(monthKeyOfDate(null)).toBe('');
    expect(monthKeyOfDate(undefined)).toBe('');
    expect(monthKeyOfDate('вчера')).toBe('');
  });
});

describe('periodBadgeLabel', () => {
  test('расход оплачен в октябре за сентябрь — «за сентябрь»', () => {
    expect(periodBadgeLabel('2026-09', '2026-10-05')).toBe('за сентябрь');
  });

  test('месяц совпадает с месяцем даты — бейджа нет', () => {
    expect(periodBadgeLabel('2026-09', '2026-09-20')).toBe('');
  });

  test('другой год — с годом', () => {
    expect(periodBadgeLabel('2025-12', '2026-01-10')).toBe('за декабрь 2025');
  });

  test('месяц не задан, мусор или нет даты — бейджа нет', () => {
    expect(periodBadgeLabel(null, '2026-10-05')).toBe('');
    expect(periodBadgeLabel(undefined, '2026-10-05')).toBe('');
    expect(periodBadgeLabel('сентябрь', '2026-10-05')).toBe('');
    expect(periodBadgeLabel('2026-09', '')).toBe('');
  });
});

describe('carryOverRows', () => {
  test('порядок контракта (свежие сверху) сохраняется, остатки округляются до рубля', () => {
    const rows = carryOverRows({
      total: 13000.4,
      months: [
        { month: '2026-09', remaining: 12000.4 },
        { month: '2026-08', remaining: 999.6 },
        { month: '2026-07', remaining: -500 },
      ],
    });
    expect(rows).toEqual([
      { month: '2026-09', amount: 12000 },
      { month: '2026-08', amount: 1000 },
      { month: '2026-07', amount: -500 },
    ]);
  });

  test('нулевые после округления, невалидный месяц и нечисло отбрасываются', () => {
    const rows = carryOverRows({
      total: 0,
      months: [
        { month: '2026-09', remaining: 0.2 },
        { month: 'oops', remaining: 700 },
        { month: '2026-07', remaining: Number.NaN },
        { month: '2026-06', remaining: 300 },
      ],
    });
    expect(rows).toEqual([{ month: '2026-06', amount: 300 }]);
  });

  test('backend без carryOver — блока нет', () => {
    expect(carryOverRows(undefined)).toEqual([]);
    expect(carryOverRows(null)).toEqual([]);
    expect(carryOverRows({ total: 0, months: [] })).toEqual([]);
  });
});

describe('buildPayoutSuggestions', () => {
  test('остаток открытого месяца плюс долги прошлых; переплата — не подсказка', () => {
    const detail = {
      remainingAmount: 30000.2,
      carryOver: {
        total: 12000,
        months: [
          { month: '2026-09', remaining: 12000 },
          { month: '2026-08', remaining: -500 },
        ],
      },
    };
    expect(buildPayoutSuggestions(detail, '2026-10')).toEqual({ '2026-10': 30000, '2026-09': 12000 });
  });

  test('открытый месяц полностью выплачен — остаются только долги прошлых', () => {
    const detail = {
      remainingAmount: 0,
      carryOver: { total: 30000, months: [{ month: '2026-09', remaining: 30000 }] },
    };
    expect(buildPayoutSuggestions(detail, '2026-10')).toEqual({ '2026-09': 30000 });
  });

  test('переплата открытого месяца не превращается в отрицательную подсказку', () => {
    expect(buildPayoutSuggestions({ remainingAmount: -1200 }, '2026-10')).toEqual({});
  });

  test('backend без carryOver — подсказка только для открытого месяца', () => {
    expect(buildPayoutSuggestions({ remainingAmount: 12000 }, '2026-10')).toEqual({ '2026-10': 12000 });
  });

  test('нет данных — подсказок нет', () => {
    expect(buildPayoutSuggestions(undefined, '2026-10')).toEqual({});
    expect(buildPayoutSuggestions(null, '2026-10')).toEqual({});
  });
});
