import { QueryClient } from '@tanstack/react-query';
import { invalidateAttendanceQueries } from '../../../../shared/utils/attendanceQueries';

it('refreshes calendar, journal and employee attendance consumers without invalidating unrelated lists', async () => {
  const client = new QueryClient();
  const affected = [
    ['schedule', '2026-10-01', '2026-10-31'],
    ['schedule-today'],
    ['shifts', 'attendance', 'tenant', 'point', '2026-10-05'],
    ['shifts', 'my'],
    ['schedule-my-stats', 2026, 9],
    ['my-schedule-stats'],
    ['employee-full-profile', 'user'],
    ['employee-schedule', '2026-10-05'],
    ['salary', 'my-summary'],
    ['salary-my'],
    ['salary-all'],
    ['my-summary'],
    ['employee-salary', '2026-10-01'],
    ['employee-salary-prev', '2026-09-01'],
  ];
  for (const key of affected) client.setQueryData(key, []);
  client.setQueryData(['users', 'point'], []);
  await invalidateAttendanceQueries(client);
  for (const key of affected) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  expect(client.getQueryState(['users', 'point'])?.isInvalidated).toBe(false);
  client.clear();
});
