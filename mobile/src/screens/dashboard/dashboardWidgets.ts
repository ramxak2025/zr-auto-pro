/**
 * dashboardWidgets — реестр настраиваемых виджетов дашборда владельца/директора.
 *
 * Видимость каждого виджета хранится ЛОКАЛЬНО per-user (AsyncStorage через
 * usePreference) — без бэкенда. По умолчанию все виджеты включены; при
 * отсутствии сохранёнки или при появлении нового виджета (id, которого нет
 * в карте предпочтений) он считается включённым (дефолт-фолбэк).
 *
 * Источник правды по составу и порядку дашборда — массив `DASHBOARD_WIDGETS`.
 * AdminDashboard рендерит виджеты по этому списку, фильтруя по сохранённой
 * видимости. Hero / KPI / график / снапшот-строка — НЕ в списке: это
 * фиксированный «скелет» дашборда, его не отключают.
 */
import type { ComponentType } from 'react';

export interface DashboardWidgetDef {
  /** Стабильный id — ключ в карте предпочтений. Не переименовывать. */
  id: string;
  /** Русская подпись для экрана настроек. */
  label: string;
  /** Сам виджет (рендерится без пропсов). */
  Component: ComponentType;
}

/** Карта видимости: id → включён ли. Отсутствующий id ⇒ включён. */
export type WidgetVisibility = Record<string, boolean>;

/**
 * Видим ли виджет с учётом сохранёнки. Отсутствие ключа = включён
 * (дефолт-фолбэк для новых виджетов и пустой сохранёнки).
 */
export function isWidgetVisible(visibility: WidgetVisibility, id: string): boolean {
  return visibility[id] !== false;
}

/** Ключ настройки видимости виджетов (per-user через prefKey). */
export const DASHBOARD_WIDGETS_PREF = 'dashboard-widgets';
