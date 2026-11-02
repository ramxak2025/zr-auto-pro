const mockNative = {
  widget: jest.fn(),
  consume: jest.fn(),
  start: jest.fn(),
  update: jest.fn(),
  end: jest.fn(),
  endAll: jest.fn(),
};
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: { expoConfig: { extra: { inventoryInternal: 'ios-v1' } } },
}));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('../../../modules/autexa-liquid-glass/src/index', () => ({
  setWidgetData: (...a: unknown[]) => Reflect.apply(mockNative.widget, undefined, a),
  consumePendingAppIntent: () => mockNative.consume(),
  liveActivitiesSupported: () => true,
  startLiveActivity: () => mockNative.start(),
  updateLiveActivity: () => mockNative.update(),
  endLiveActivity: () => mockNative.end(),
  endAllLiveActivities: () => mockNative.endAll(),
}));
import { updateWidgetData, clearWidgetData } from '../widgetBridge';
import { consumePendingAppIntent } from '../appIntents';
import {
  startLiveActivity,
  updateLiveActivity,
  endLiveActivity,
  endAllLiveActivities,
  liveActivitiesAvailable,
} from '../liveActivity';
import { captureDataSession, setDataSession } from '../../contexts/dataSession';
it('internal app cannot read/clear pending public native actions or write/reset public presentations', async () => {
  setDataSession({ userId: 'stage-user', tenantId: 'stage-tenant', pointId: null });
  updateWidgetData({ role: 'owner', revenue: 5, profitToday: 2, checksCount: 1 }, captureDataSession());
  clearWidgetData();
  expect(consumePendingAppIntent()).toBeNull();
  expect(liveActivitiesAvailable()).toBe(false);
  expect(await startLiveActivity({ kind: 'shift' }, { title: 'stage', status: 'open' })).toBeNull();
  await updateLiveActivity('production-id', { title: 'stage', status: 'open' });
  await endLiveActivity('production-id');
  await endAllLiveActivities();
  for (const method of Object.values(mockNative)) expect(method).not.toHaveBeenCalled();
});
