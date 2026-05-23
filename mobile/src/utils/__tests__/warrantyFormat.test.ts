import { declensionDays, declensionMonths, formatDaysLeft } from '../warrantyFormat';

describe('declensionDays', () => {
  test('1, 21, 31 → день', () => {
    expect(declensionDays(1)).toBe('день');
    expect(declensionDays(21)).toBe('день');
    expect(declensionDays(31)).toBe('день');
  });

  test('2, 3, 4, 22, 23, 24 → дня', () => {
    expect(declensionDays(2)).toBe('дня');
    expect(declensionDays(3)).toBe('дня');
    expect(declensionDays(4)).toBe('дня');
    expect(declensionDays(22)).toBe('дня');
    expect(declensionDays(23)).toBe('дня');
    expect(declensionDays(24)).toBe('дня');
  });

  test('5..20 → дней (special "teens" case)', () => {
    for (let i = 5; i <= 20; i++) {
      expect(declensionDays(i)).toBe('дней');
    }
  });

  test('11, 12, 13, 14 → дней (teens override the mod10 rule)', () => {
    expect(declensionDays(11)).toBe('дней');
    expect(declensionDays(12)).toBe('дней');
    expect(declensionDays(13)).toBe('дней');
    expect(declensionDays(14)).toBe('дней');
  });

  test('25, 26, 100 → дней', () => {
    expect(declensionDays(25)).toBe('дней');
    expect(declensionDays(26)).toBe('дней');
    expect(declensionDays(100)).toBe('дней');
  });

  test('0 → дней', () => {
    expect(declensionDays(0)).toBe('дней');
  });
});

describe('declensionMonths', () => {
  test('1, 21 → месяц', () => {
    expect(declensionMonths(1)).toBe('месяц');
    expect(declensionMonths(21)).toBe('месяц');
  });

  test('2, 3, 4, 22, 23, 24 → месяца', () => {
    expect(declensionMonths(2)).toBe('месяца');
    expect(declensionMonths(3)).toBe('месяца');
    expect(declensionMonths(4)).toBe('месяца');
    expect(declensionMonths(22)).toBe('месяца');
  });

  test('5..20 → месяцев', () => {
    expect(declensionMonths(5)).toBe('месяцев');
    expect(declensionMonths(11)).toBe('месяцев');
    expect(declensionMonths(12)).toBe('месяцев');
    expect(declensionMonths(20)).toBe('месяцев');
  });

  test('25, 100 → месяцев', () => {
    expect(declensionMonths(25)).toBe('месяцев');
    expect(declensionMonths(100)).toBe('месяцев');
  });
});

describe('formatDaysLeft', () => {
  test('zero / negative → истекла', () => {
    expect(formatDaysLeft(0)).toBe('истекла');
    expect(formatDaysLeft(-1)).toBe('истекла');
    expect(formatDaysLeft(-100)).toBe('истекла');
  });

  test('single day', () => {
    expect(formatDaysLeft(1)).toBe('ещё 1 день');
  });

  test('few days (2-4)', () => {
    expect(formatDaysLeft(2)).toBe('ещё 2 дня');
    expect(formatDaysLeft(3)).toBe('ещё 3 дня');
    expect(formatDaysLeft(4)).toBe('ещё 4 дня');
  });

  test('many days (5-20)', () => {
    expect(formatDaysLeft(5)).toBe('ещё 5 дней');
    expect(formatDaysLeft(12)).toBe('ещё 12 дней');
    expect(formatDaysLeft(15)).toBe('ещё 15 дней');
    expect(formatDaysLeft(20)).toBe('ещё 20 дней');
  });

  test('21..30 days', () => {
    expect(formatDaysLeft(21)).toBe('ещё 21 день');
    expect(formatDaysLeft(22)).toBe('ещё 22 дня');
    expect(formatDaysLeft(25)).toBe('ещё 25 дней');
    expect(formatDaysLeft(30)).toBe('ещё 30 дней');
  });

  test('exact month — no rest', () => {
    expect(formatDaysLeft(60)).toBe('ещё 2 месяца');
    expect(formatDaysLeft(90)).toBe('ещё 3 месяца');
    expect(formatDaysLeft(150)).toBe('ещё 5 месяцев');
  });

  test('months + remaining days', () => {
    // 65 = 2 months + 5 days
    expect(formatDaysLeft(65)).toBe('ещё 2 месяца 5 дней');
    // 35 = 1 month + 5 days
    expect(formatDaysLeft(35)).toBe('ещё 1 месяц 5 дней');
    // 32 = 1 month + 2 days
    expect(formatDaysLeft(32)).toBe('ещё 1 месяц 2 дня');
    // 31 = 1 month + 1 day
    expect(formatDaysLeft(31)).toBe('ещё 1 месяц 1 день');
  });

  test('long warranties', () => {
    expect(formatDaysLeft(365)).toBe('ещё 12 месяцев 5 дней');
    expect(formatDaysLeft(730)).toBe('ещё 24 месяца 10 дней');
  });
});
