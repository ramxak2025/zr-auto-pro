import { QueryClient } from '@tanstack/react-query';
import { invalidateEmployeeAvatarQueries } from '../employeeAvatarQueries';

describe('invalidateEmployeeAvatarQueries', () => {
  it('invalidates the warmed avatar-bearing employee caches after apply or approval', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const keys = [
      ['users-all'],
      ['users-dismissed'],
      ['schedule-today'],
      ['shifts', 'attendance', 'tenant', null, '2026-10-07'],
      ['checks', 'board', 'tenant', null],
      ['eq-summary'],
      ['eq-user', 'employee-1'],
      ['employee-full-profile', 'employee-1'],
      ['user', 'employee-1'],
      ['salary', '2026-10-01', '2026-10-31'],
      ['motivation', 'accruals', '2026-10-01', '2026-10-31'],
    ] as const;
    for (const key of keys) client.setQueryData(key, { avatar: '/old-avatar.webp' });
    client.setQueryData(['products', 'all'], { rows: [] });

    await invalidateEmployeeAvatarQueries(client, 'employee-1');

    for (const key of keys) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    expect(client.getQueryState(['products', 'all'])?.isInvalidated).toBe(false);
  });
});
