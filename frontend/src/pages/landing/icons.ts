import {
  BarChart3,
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  ClipboardList,
  LayoutGrid,
  Megaphone,
  Mic,
  Package,
  Percent,
  Receipt,
  ShieldCheck,
  Truck,
  UserCog,
  Users,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Единый словарь иконок разделов лендинга по имени из content.ts.
 * Используется и в bento-сетке (Features), и на странице раздела
 * (FeatureDetailPage) — новый раздел достаточно добавить здесь один раз.
 * Промах по имени закрывается fallback'ом `?? LayoutGrid` на месте вызова.
 */
export const SECTION_ICONS: Record<string, LucideIcon> = {
  Receipt,
  ClipboardList,
  Package,
  Users,
  CalendarCheck,
  CalendarDays,
  Percent,
  CalendarClock,
  Wallet,
  BarChart3,
  Truck,
  UserCog,
  Megaphone,
  Mic,
  ShieldCheck,
  LayoutGrid,
};
