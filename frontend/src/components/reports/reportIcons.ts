import {
  BarChart3,
  Building2,
  CalendarCheck,
  Coins,
  CreditCard,
  HardHat,
  Package,
  Truck,
  Users,
  Wallet,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import type { ReportId } from '../../types';

/** Иконка отчёта в хабе и в шапке экрана отчёта — по id из shared/reports/catalog.ts. */
export const REPORT_ICONS: Record<ReportId, LucideIcon> = {
  summary: BarChart3,
  masters: HardHat,
  salary: Coins,
  suppliers: Truck,
  clients: Users,
  products: Package,
  services: Wrench,
  payments: CreditCard,
  expenses: Wallet,
  bookings: CalendarCheck,
  points: Building2,
};
