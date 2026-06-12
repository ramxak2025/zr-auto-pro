import { Platform } from 'react-native';
import { setWidgetData } from '../../modules/autexa-liquid-glass/src/index';

/** Payload for masters — «Мой заработок» (сегодня + за месяц). */
export interface MasterWidgetData {
  role: 'master';
  /** Заработок мастера за сегодня, ₽. */
  earningsToday: number;
  /** Заработок мастера за текущий месяц, ₽. */
  earningsMonth: number;
  /** Открыта ли смена прямо сейчас (зелёная точка в виджете). */
  shiftOpen?: boolean;
}

/** Payload for owners/admins — оборот, чистая прибыль и чеки за сегодня. */
export interface OwnerWidgetData {
  role: 'owner';
  /** Оборот за сегодня, ₽. */
  revenue: number;
  /** Чистая прибыль за сегодня, ₽. */
  profitToday: number;
  /** Количество чеков за сегодня. */
  checksCount: number;
}

export type WidgetData = MasterWidgetData | OwnerWidgetData;

/**
 * Push today's KPIs into the iOS home-screen widget (AuTexaWidget).
 *
 * Internally delegates to setWidgetData() from the autexa-liquid-glass module,
 * which writes JSON into the shared App Group UserDefaults
 * (`group.com.autexa.mobile`, key `widget_dashboard_data`) and calls
 * WidgetCenter.shared.reloadAllTimelines() so the widget refreshes immediately.
 *
 * The widget renders role-dependently: masters see «Мой заработок», owners see
 * «Оборот» + «Чистая прибыль». See ios-extensions/AuTexaWidget/AuTexaWidget.swift.
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
