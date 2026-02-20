import { Link } from 'react-router-dom';
import {
  Users,
  Wrench,
  Truck,
  Wallet,
  BarChart3,
  Shield,
  LogOut,
  ChevronRight,
  ArrowRightLeft,
  CalendarDays,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import type { UserPermissions } from '../types';

interface MenuItem {
  label: string;
  description: string;
  path: string;
  icon: typeof Users;
  permission?: keyof UserPermissions;
  color: string;
  iconColor: string;
}

const menuItems: MenuItem[] = [
  {
    label: 'Расписание',
    description: 'График работы и смены',
    path: '/schedule',
    icon: CalendarDays,
    color: 'bg-indigo-50',
    iconColor: 'text-indigo-600',
  },
  {
    label: 'Клиенты',
    description: 'База клиентов',
    path: '/clients',
    icon: Users,
    permission: 'clients_view',
    color: 'bg-blue-50',
    iconColor: 'text-blue-600',
  },
  {
    label: 'Услуги',
    description: 'Каталог услуг',
    path: '/services',
    icon: Wrench,
    color: 'bg-orange-50',
    iconColor: 'text-orange-600',
  },
  {
    label: 'Поставщики',
    description: 'Поставки и расчёты',
    path: '/suppliers',
    icon: Truck,
    permission: 'suppliers_access',
    color: 'bg-amber-50',
    iconColor: 'text-amber-600',
  },
  {
    label: 'Движение денег',
    description: 'Касса по дням и сотрудникам',
    path: '/cashflow',
    icon: ArrowRightLeft,
    color: 'bg-teal-50',
    iconColor: 'text-teal-600',
  },
  {
    label: 'Зарплата',
    description: 'Заработок мастеров',
    path: '/salary',
    icon: Wallet,
    color: 'bg-green-50',
    iconColor: 'text-green-600',
  },
  {
    label: 'Отчёты',
    description: 'Финансовые отчёты',
    path: '/reports',
    icon: BarChart3,
    permission: 'financial_reports',
    color: 'bg-purple-50',
    iconColor: 'text-purple-600',
  },
  {
    label: 'Пользователи',
    description: 'Управление доступом',
    path: '/users',
    icon: Shield,
    permission: 'user_management',
    color: 'bg-indigo-50',
    iconColor: 'text-indigo-600',
  },
];

const roleLabels: Record<string, string> = {
  superadmin: 'Суперадмин',
  owner: 'Владелец',
  admin: 'Администратор',
  master: 'Мастер',
  storekeeper: 'Товаровед',
  accountant: 'Бухгалтер',
};

export default function MorePage() {
  const { user, logout, hasPermission } = useAuth();
  const roleLabel = user?.role ? (roleLabels[user.role] || user.role) : '';

  return (
    <div className="space-y-6">
      {/* User card */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-100 text-primary-700 text-lg font-bold">
            {user?.fullName?.charAt(0) || 'U'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-base font-semibold text-gray-900 truncate">
              {user?.fullName || 'User'}
            </p>
            <p className="text-sm text-gray-500">{roleLabel}</p>
          </div>
        </div>
      </div>

      {/* Menu items */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-100 overflow-hidden">
        {menuItems.map((item) => {
          if (item.permission && !hasPermission(item.permission)) {
            return null;
          }

          const Icon = item.icon;

          return (
            <Link
              key={item.path}
              to={item.path}
              className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 active:bg-gray-100 transition-colors"
            >
              <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${item.color}`}>
                <Icon className={`h-5 w-5 ${item.iconColor}`} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900">{item.label}</p>
                <p className="text-xs text-gray-500">{item.description}</p>
              </div>
              <ChevronRight className="h-5 w-5 text-gray-300 flex-shrink-0" />
            </Link>
          );
        })}
      </div>

      {/* Logout */}
      <button
        onClick={logout}
        className="w-full flex items-center justify-center gap-2 bg-white rounded-2xl border border-gray-100 shadow-sm px-5 py-4
          text-red-600 font-medium text-sm hover:bg-red-50 active:bg-red-100 transition-colors"
      >
        <LogOut className="h-5 w-5" />
        Выйти из аккаунта
      </button>
    </div>
  );
}
