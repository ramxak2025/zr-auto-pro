import { Link } from 'react-router-dom';
import {
  Wrench,
  Truck,
  Wallet,
  BarChart3,
  Banknote,
  Calendar,
  UserCog,
  CreditCard,
  Shield,
  LucideIcon,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { UserRole } from '../types';

interface MenuItem {
  label: string;
  path: string;
  icon: LucideIcon;
  permission?: string;
  roleOnly?: UserRole;
}

const menuItems: MenuItem[] = [
  { label: 'Услуги', path: '/services', icon: Wrench },
  { label: 'Поставщики', path: '/suppliers', icon: Truck },
  { label: 'Зарплата', path: '/salary', icon: Wallet },
  { label: 'Отчёты', path: '/reports', icon: BarChart3 },
  { label: 'Движение денег', path: '/cashflow', icon: Banknote },
  { label: 'Расписание', path: '/schedule', icon: Calendar },
  { label: 'Сотрудники', path: '/users', icon: UserCog, permission: 'user_management' },
  { label: 'Тариф', path: '/tariff', icon: CreditCard },
  { label: 'Админ панель', path: '/admin', icon: Shield, roleOnly: UserRole.SUPERADMIN },
];

export default function MorePage() {
  const { hasPermission, user } = useAuth();

  const visibleItems = menuItems.filter((item) => {
    if (item.permission && !hasPermission(item.permission as any)) return false;
    if (item.roleOnly && user?.role !== item.roleOnly) return false;
    return true;
  });

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Ещё</h1>
      </div>

      <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.path}
              to={item.path}
              className="flex flex-col items-center justify-center rounded-xl bg-white shadow-sm border border-gray-200 py-4 px-2 hover:shadow-md hover:border-primary-200 transition-all"
            >
              <div className="mb-2 p-2.5 bg-primary-50 rounded-xl">
                <Icon className="w-6 h-6 text-primary-600" />
              </div>
              <span className="text-sm font-medium text-gray-700 text-center leading-tight">
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
