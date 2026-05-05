/**
 * Shared data for the bottom tab bar — route keys, labels, semantic icon names.
 * Both TabBar.ios.tsx and TabBar.android.tsx consume this so labels and order
 * are never out of sync.
 */
import { IconName } from '../platform/Icon';

export interface TabDefinition {
  routeName: string;
  label: string;
  icon: IconName;
  /** True for the center "Касса" tab — renders a floating action style button
   *  regardless of platform. */
  isKassa?: boolean;
}

export const TAB_DEFINITIONS: TabDefinition[] = [
  { routeName: 'Dashboard', label: 'Главная', icon: 'home' },
  { routeName: 'Products', label: 'Склад', icon: 'warehouse' },
  { routeName: 'NewCheck', label: 'Касса', icon: 'receipt', isKassa: true },
  { routeName: 'Checks', label: 'Журнал', icon: 'journal' },
  { routeName: 'MoreTab', label: 'Ещё', icon: 'menu' },
];
