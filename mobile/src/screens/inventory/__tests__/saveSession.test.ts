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
const owner = (id: string) => ({ userId: id, tenantId: 'tenant-' + id, pointId: 'point-' + id });
const body = {
  type: 'inventory' as const,
  quantity: 0.5,
  reason: 'Инвентаризация',
  requestId: '75711471-908a-431b-84db-c5e2686039c6',
  expectedStock: -1,
  expectedWarehouseId: 'warehouse-A',
};

function setup() {
  jest.resetModules();
  const transport = jest.requireActual('../../../api/axios') as typeof import('../../../api/axios');
  const data = jest.requireActual('../../../contexts/dataSession') as typeof import('../../../contexts/dataSession');
  const helper = jest.requireActual('../saveSession') as typeof import('../saveSession');
  data.setDataSession(owner('A'));
  transport.setAuthToken('token-A', true);
  const sent: InternalAxiosRequestConfig[] = [];
  transport.default.defaults.adapter = async (config) => {
    sent.push(config);
    return {
      config,
      status: 200,
      statusText: 'OK',
      headers: {},
      data: { stock: 0.5, requestId: body.requestId, linkedExpenseId: null },
    };
  };
  return { transport, data, helper, sent };
}
it('uses the dedicated route and captured bearer, carrying every concurrency guard', async () => {
  const h = setup();
  const session = h.helper.captureInventorySession();
  await session.updateStock('product-A', body);
  expect(h.sent).toHaveLength(1);
  expect(h.sent[0].url).toBe('/products/product-A/inventory');
  expect(h.sent[0].headers.Authorization).toBe('Bearer token-A');
  expect(JSON.parse(h.sent[0].data)).toEqual(body);
});
it.each([false, true])(
  'a captured pre-confirmation session cannot inherit a new account token, including A→B→A=%s',
  async (backToA) => {
    const h = setup();
    const old = h.helper.captureInventorySession();
    h.data.setDataSession(owner('B'));
    h.transport.setAuthToken('token-B', true);
    if (backToA) {
      h.data.setDataSession(owner('A'));
      h.transport.setAuthToken('token-A', true);
    }
    expect(old.isCurrent()).toBe(false);
    await expect(old.updateStock('product-A', body)).rejects.toMatchObject({ code: 'ERR_CANCELED' });
    expect(h.sent).toHaveLength(0);
  },
);
it('pagination stops at a point/session boundary before dispatching the next page', async () => {
  const h = setup();
  h.transport.default.defaults.adapter = async (config) => {
    h.sent.push(config);
    h.data.setDataSession(owner('other-point'));
    return {
      config,
      status: 200,
      statusText: 'OK',
      headers: {},
      data: {
        data: [{ id: 'a' }],
        total: 2,
        limit: 1,
        page: 1,
      },
    };
  };
  const old = h.helper.captureInventorySession();
  await expect(old.loadProducts('warehouse-A')).rejects.toThrow('Inventory session expired');
  expect(h.sent).toHaveLength(1);
});
it('a point-only data epoch change also prevents a captured request before transport', async () => {
  const h = setup();
  const old = h.helper.captureInventorySession();
  h.data.setDataSession(owner('point-B'));
  await expect(old.updateStock('product-A', body)).rejects.toMatchObject({ code: 'ERR_CANCELED' });
  expect(h.sent).toHaveLength(0);
});
