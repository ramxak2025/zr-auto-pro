import type { IconName } from '../platform/Icon';
export type AdminShellMode = 'superadmin' | 'manager';
export interface AdminTabDef {
  routeName: string;
  label: string;
  icon: IconName;
}
export const ADMIN_TAB_DEFINITIONS: AdminTabDef[] = [
  { routeName: 'AdminOverview', label: 'Обзор', icon: 'home' },
  { routeName: 'AdminTenants', label: 'Клиенты', icon: 'business' },
  { routeName: 'AdminAnalytics', label: 'Аналитика', icon: 'chart-bar' },
  { routeName: 'AdminTeam', label: 'Команда', icon: 'people' },
  { routeName: 'AdminMore', label: 'Ещё', icon: 'menu' },
];
export const MANAGER_TAB_DEFINITIONS: AdminTabDef[] = [
  { routeName: 'AdminOverview', label: 'Сегодня', icon: 'home' },
  { routeName: 'AdminTenants', label: 'Клиенты', icon: 'business' },
  { routeName: 'AdminIncome', label: 'Доход', icon: 'wallet' },
  { routeName: 'AdminMore', label: 'Ещё', icon: 'menu' },
];
