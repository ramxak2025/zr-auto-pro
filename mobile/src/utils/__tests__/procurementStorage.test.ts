const mockDisk = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (key: string) => mockDisk.get(key) ?? null),
    setItem: jest.fn(async (key: string, value: string) => {
      mockDisk.set(key, value);
    }),
    removeItem: jest.fn(async (key: string) => {
      mockDisk.delete(key);
    }),
    getAllKeys: jest.fn(async () => [...mockDisk.keys()]),
  },
}));
jest.mock('../offlineCheckQueue', () => ({ generateClientRequestId: () => '55555555-5555-4555-8555-555555555555' }));
import { procurementStorage as nativeStorage } from '../procurementStorage';
import { procurementStorage as webStorage } from '../../../../frontend/src/utils/procurementStorage';

describe('platform procurement storage adapters', () => {
  afterEach(() => {
    mockDisk.clear();
  });
  it('native persistence and mutex require no navigator/Web Locks', async () => {
    await nativeStorage.exclusive('test', () => nativeStorage.setItem('test', 'saved'));
    expect(await nativeStorage.getItem('test')).toBe('saved');
    expect(await nativeStorage.keys()).toContain('test');
    await nativeStorage.removeItem('test');
    expect(await nativeStorage.getItem('test')).toBeNull();
  });
  it('web fails closed when cross-tab locks are unavailable', async () => {
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true });
    const network = jest.fn(async () => {});
    await expect(webStorage.exclusive('test', network)).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
    expect(network).not.toHaveBeenCalled();
  });
  it('web uses the target-specific Web Lock and reports storage failures', async () => {
    const request = jest.fn(async (_key: string, run: () => Promise<unknown>) => run());
    Object.defineProperty(globalThis, 'navigator', { value: { locks: { request } }, configurable: true });
    await webStorage.exclusive('owner/source', async () => {});
    expect(request.mock.calls[0][0]).toBe('owner/source');
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem: () => {
          throw new Error('unavailable');
        },
      },
      configurable: true,
    });
    await expect(webStorage.getItem('key')).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
  });
});
