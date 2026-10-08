const mockMap = new Map<string, string>();
const mockNative = {
  start: jest.fn(),
  update: jest.fn(async () => {}),
  end: jest.fn(async () => {}),
  endAll: jest.fn(async () => {}),
  widget: jest.fn(),
};
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => mockMap.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      mockMap.set(k, v);
    },
    getAllKeys: async () => [...mockMap.keys()],
    multiRemove: async (keys: string[]) => {
      keys.forEach((k) => mockMap.delete(k));
    },
  },
}));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('../liveActivity', () => ({
  liveActivitiesAvailable: () => true,
  startLiveActivity: (...a: unknown[]) => mockNative.start(...a),
  updateLiveActivity: () => mockNative.update(),
  endLiveActivity: (...a: unknown[]) => Reflect.apply(mockNative.end, undefined, a),
  endAllLiveActivities: () => mockNative.endAll(),
}));
jest.mock('../../../modules/autexa-liquid-glass/src/index', () => ({
  setWidgetData: (raw: string) => mockNative.widget(raw),
}));
import { captureDataSession, setDataSession } from '../../contexts/dataSession';
import { startTrackedActivity, resetLiveActivitySession, updateTrackedActivity } from '../liveActivityStore';
import { updateWidgetData, clearWidgetData } from '../widgetBridge';
const A = { tenantId: 'a', userId: 'a', pointId: 'p' },
  B = { tenantId: 'b', userId: 'b', pointId: 'q' };
beforeEach(() => {
  mockMap.clear();
  jest.clearAllMocks();
});
it('late widget effect A is suppressed after B and A→B→A while current B updates normally', () => {
  setDataSession(A);
  const old = captureDataSession();
  setDataSession(B);
  clearWidgetData();
  updateWidgetData({ role: 'owner', revenue: 999, profitToday: 99, checksCount: 9 }, old);
  expect(mockNative.widget).toHaveBeenCalledTimes(1);
  updateWidgetData({ role: 'master', earningsToday: 1, earningsMonth: 2 }, captureDataSession());
  expect(mockNative.widget).toHaveBeenCalledTimes(2);
  setDataSession(A);
  updateWidgetData({ role: 'master', earningsToday: 999, earningsMonth: 999 }, old);
  expect(mockNative.widget).toHaveBeenCalledTimes(2);
});
it('late native A activity is ended, reset completes before B starts, old A updates never touch B', async () => {
  setDataSession(A);
  const old = captureDataSession();
  let release!: (id: string) => void;
  const gate = new Promise<string>((r) => {
    release = r;
  });
  mockNative.start.mockReturnValueOnce(gate).mockResolvedValue('B-activity');
  const a = startTrackedActivity('cash-shift', { kind: 'shift' }, { title: 'A', status: 'open' }, old);
  while (!mockNative.start.mock.calls.length) await Promise.resolve();
  const reset = resetLiveActivitySession();
  setDataSession(B);
  const b = startTrackedActivity('cash-shift', { kind: 'shift' }, { title: 'B', status: 'open' }, captureDataSession());
  release('A-activity');
  await Promise.all([a, reset, b]);
  expect(mockNative.end).toHaveBeenCalledWith('A-activity', undefined, true);
  expect(mockNative.endAll).toHaveBeenCalledTimes(1);
  expect([...mockMap.values()].join('')).toContain('B-activity');
  expect([...mockMap.values()].join('')).not.toContain('A-activity');
  await updateTrackedActivity('cash-shift', { title: 'old A', status: 'closed' }, old);
  expect(mockNative.update).not.toHaveBeenCalled();
});
