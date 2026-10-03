import { formatSalaryNoticeAmount, isSalaryNoticePush, loadSalaryNotice } from '../salaryNotices';
import type { SalaryFine, SalaryPayout } from '../../../../shared/types';

const fine = (id: string, extra: Partial<SalaryFine> = {}): SalaryFine => ({
  id,
  userId: 'employee-A',
  amount: 631000,
  comment: 'Причина',
  date: '2026-10-03',
  createdAt: '2026-10-03',
  ...extra,
});
const deps = () => ({
  userId: 'employee-A',
  fines: jest.fn(async (): Promise<SalaryFine[]> => []),
  payouts: jest.fn(async (): Promise<SalaryPayout[]> => []),
  payments: jest.fn(async () => []),
  suppressed: jest.fn((_kind: string, _id: string) => false),
  isCurrent: jest.fn(() => true),
});

test.each([
  [0.01, '0,01 ₽'],
  [12.5, '12,50 ₽'],
  [631000.5, '631 000,50 ₽'],
  [9999999999.99, '9 999 999 999,99 ₽'],
])('уведомление сохраняет сумму %s с копейками', (amount, expected) => {
  expect(formatSalaryNoticeAmount(Number(amount)).replace(/\u00a0|\u202f/g, ' ')).toBe(expected);
});

test('фактический backend kind=penalty будит inbox, посторонние пуши — нет', () => {
  expect(isSalaryNoticePush({ kind: 'penalty', penaltyId: 'p1' })).toBe(true);
  expect(isSalaryNoticePush({ type: 'payout-cancelled' })).toBe(true);
  expect(isSalaryNoticePush({ kind: 'check_closed' })).toBe(false);
  expect(isSalaryNoticePush(undefined)).toBe(false);
});

test('показывает только свой непросмотренный штраф и пропускает отложенные id', async () => {
  const d = deps();
  d.fines.mockResolvedValue([
    fine('other', { userId: 'employee-B' }),
    fine('seen', { viewedAt: '2026-10-03' }),
    fine('queued'),
    fine('fresh'),
  ]);
  d.suppressed.mockImplementation((_kind, id) => id === 'queued');
  const result = await loadSalaryNotice(d);
  expect(result.notice).toEqual({ kind: 'fineViewed', item: fine('fresh') });
  expect(d.payouts).not.toHaveBeenCalled();
});

test('один и тот же ответ после refetch не превращает просмотренный штраф в новый', async () => {
  const d = deps();
  d.fines.mockResolvedValue([fine('fresh')]);
  expect((await loadSalaryNotice(d)).notice?.item.id).toBe('fresh');
  d.suppressed.mockReturnValue(true);
  expect((await loadSalaryNotice(d)).notice).toBeNull();
});

test('поздний ответ прошлого аккаунта не публикует данные и не запускает следующий запрос', async () => {
  const d = deps();
  d.fines.mockImplementation(async () => {
    d.isCurrent.mockReturnValue(false);
    return [fine('old-user')];
  });
  expect((await loadSalaryNotice(d)).stale).toBe(true);
  expect(d.payouts).not.toHaveBeenCalled();
});

test('исчезнувший/удалённый штраф очищается, ошибка сети сохраняет информацию о неизвестном источнике', async () => {
  const d = deps();
  expect(await loadSalaryNotice(d)).toEqual({ stale: false, notice: null, failed: [] });
  d.fines.mockRejectedValue(new Error('offline'));
  expect(await loadSalaryNotice(d)).toEqual({ stale: false, notice: null, failed: ['fineViewed'] });
});

test('новый штраф не нужен для старого API выплат: fallback после404 продолжает работать', async () => {
  const d = deps();
  d.fines.mockRejectedValue({ response: { status: 404 } });
  d.payouts.mockResolvedValue([
    { id: 'payout-1', userId: 'employee-A', status: 'accepted', amount: 1000, type: 'advance' } as SalaryPayout,
  ]);
  expect((await loadSalaryNotice(d)).notice?.kind).toBe('payoutViewed');
});
