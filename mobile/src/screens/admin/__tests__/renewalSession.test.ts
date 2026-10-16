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
it('binds manager and superadmin renewal transports before dispatch and never adopts a replacement bearer', async () => {
  jest.resetModules();
  const transport = jest.requireActual('../../../api/axios') as typeof import('../../../api/axios');
  const data = jest.requireActual('../../../contexts/dataSession') as typeof import('../../../contexts/dataSession');
  const { captureRenewalSession } = jest.requireActual('../renewalSession') as typeof import('../renewalSession');
  data.setDataSession({ userId: 'admin-A', tenantId: null, pointId: null });
  transport.setAuthToken('token-A', true);
  const session = captureRenewalSession(),
    sent: InternalAxiosRequestConfig[] = [];
  transport.default.defaults.adapter = async (config) => {
    sent.push(config);
    return { config, status: 200, statusText: 'OK', data: {}, headers: {} };
  };
  const request = {
    type: 'paid' as const,
    amount: 205000,
    period: 'yearly' as const,
    employees: 51,
    points: 2,
    quoteToken: 'quote',
    requestId: 'request',
  };
  await session.manager.extend('tenant', request);
  await session.tenants.extend('tenant', request);
  expect(sent.map((config) => config.url)).toEqual(['/manager/tenants/tenant/extend', '/tenants/tenant/extend']);
  expect(sent.every((config) => config.headers.Authorization === 'Bearer token-A')).toBe(true);
  expect(JSON.parse(sent[0].data)).toEqual(request);
  transport.setAuthToken('token-A2');
  expect(session.isCurrent()).toBe(false);
  await expect(session.manager.extend('tenant', request)).rejects.toMatchObject({ code: 'ERR_CANCELED' });
  expect(sent).toHaveLength(2);
});
