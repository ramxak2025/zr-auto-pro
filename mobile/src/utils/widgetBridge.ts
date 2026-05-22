import { Platform } from 'react-native';
import { setWidgetData } from '../../modules/autexa-liquid-glass/src/index';

export interface WidgetData {
  revenue: number;
  checksCount: number;
  profitToday: number;
  shiftOpen: boolean;
}

/**
 * Push today's KPIs into the iOS home-screen widget.
 *
 * Internally delegates to setWidgetData() from the autexa-liquid-glass module,
 * which writes JSON into the shared App Group UserDefaults and calls
 * WidgetCenter.shared.reloadAllTimelines() so the widget refreshes immediately.
 *
 * The call is fire-and-forget: widgets are non-critical and failures here
 * must never affect dashboard UX.
 *
 * On Android this is a no-op.
 */
export function updateWidgetData(data: WidgetData): void {
  if (Platform.OS !== 'ios') return;
  try {
    setWidgetData(
      JSON.stringify({
        ...data,
        updatedAt: new Date().toISOString(),
      }),
    );
  } catch {
    // Silent fail — widget is non-critical.
  }
}
