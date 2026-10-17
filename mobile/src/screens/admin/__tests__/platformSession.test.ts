import type { InternalAxiosRequestConfig } from 'axios';
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiUrl: 'https://test.invalid/api', apiFallbackUrls: [] } } },
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async () => null,
    setItem: async () => {},
    removeItem: async () => {},
    getAllKeys: async () => [],
  },
}));
it('binds notes, reminders and password reset to their captured operator and rejects replacement-account writes', async () => {
  jest.resetModules();
  const transport = jest.requireActual('../../../api/axios') as typeof import('../../../api/axios');
  const data = jest.requireActual('../../../contexts/dataSession') as typeof import('../../../contexts/dataSession');
  const { capturePlatformSession, assertPlatformSession } = jest.requireActual(
    '../platformSession',
  ) as typeof import('../platformSession');
  data.setDataSession({ userId: 'operator-A', tenantId: null, pointId: null });
  transport.setAuthToken('token-A', true);
  const session = capturePlatformSession(),
    sent: InternalAxiosRequestConfig[] = [];
  transport.default.defaults.adapter = async (config) => {
    sent.push(config);
    return { config, status: 200, statusText: 'OK', data: {}, headers: {} };
  };
  await session.manager.addNote('tenant-A', { text: 'Internal', requestId: 'uuid' });
  await session.manager.setFollowUp('tenant-A', { nextContactAt: null });
  await session.manager.resetOwnerPassword('tenant-A', { password: 'transient' });
  expect(sent.map((c) => c.url)).toEqual([
    '/manager/tenants/tenant-A/notes',
    '/manager/tenants/tenant-A/follow-up',
    '/manager/tenants/tenant-A/reset-owner-password',
  ]);
  expect(sent.every((c) => c.headers.Authorization === 'Bearer token-A')).toBe(true);
  data.setDataSession({ userId: 'operator-B', tenantId: null, pointId: null });
  transport.setAuthToken('token-B');
  expect(() => assertPlatformSession(session)).toThrow();
  await expect(session.manager.addNote('tenant-A', { text: 'Internal', requestId: 'uuid' })).rejects.toMatchObject({
    code: 'ERR_CANCELED',
  });
  await expect(
    session.manager.updateReminderSettings({ expiryEnabled: true, daysBefore: [0], pushEnabled: false }),
  ).rejects.toMatchObject({ code: 'ERR_CANCELED' });
  expect(sent).toHaveLength(3);
});
