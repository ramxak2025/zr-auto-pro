import { useRef, useState } from 'react';
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
  Camera,
  Loader2,
  CreditCard,
  Megaphone,
  Building2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import { authApi, uploadsApi } from '../api/services';
import type { UserPermissions } from '../types';

interface MenuItem {
  label: string;
  description: string;
  path: string;
  icon: typeof Users;
  permission?: keyof UserPermissions;
  roles?: string[];
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
    label: 'Расходы',
    description: 'Аренда, маркетинг и др.',
    path: '/expenses',
    icon: Wallet,
    roles: ['director', 'superadmin'],
    color: 'bg-rose-50',
    iconColor: 'text-rose-600',
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
    label: 'Маркетинг',
    description: 'Рассылки, акции, аналитика',
    path: '/marketing',
    icon: Megaphone,
    color: 'bg-violet-50',
    iconColor: 'text-violet-600',
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
  {
    label: 'Настройки компании',
    description: 'Реквизиты и данные для чеков',
    path: '/company-settings',
    icon: Building2,
    roles: ['director', 'superadmin'],
    color: 'bg-slate-50',
    iconColor: 'text-slate-600',
  },
  {
    label: 'Тариф и подписка',
    description: 'Ваш тариф, оплата, функционал',
    path: '/tariff',
    icon: CreditCard,
    roles: ['director', 'admin'],
    color: 'bg-rose-50',
    iconColor: 'text-rose-600',
  },
];

const roleLabels: Record<string, string> = {
  superadmin: 'Суперадмин',
  director: 'Владелец',
  owner: 'Владелец',
  admin: 'Администратор',
  master: 'Мастер',
  storekeeper: 'Товаровед',
  accountant: 'Бухгалтер',
};

export default function MorePage() {
  const { user, logout, hasPermission, refreshUser } = useAuth();
  const roleLabel = user?.role ? (roleLabels[user.role] || user.role) : '';
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleAvatarUpload = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Максимальный размер файла: 5 МБ');
      return;
    }
    setUploading(true);
    try {
      const res = await uploadsApi.upload(file);
      await authApi.updateAvatar(res.data.url);
      await refreshUser();
      toast.success('Аватарка обновлена');
    } catch {
      toast.error('Не удалось загрузить аватарку');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* User card */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center gap-4">
          <div className="relative">
            {user?.avatar ? (
              <img
                src={user.avatar}
                alt=""
                className="h-14 w-14 rounded-full object-cover border-2 border-gray-100"
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-100 text-primary-700 text-xl font-bold">
                {user?.fullName?.charAt(0) || 'U'}
              </div>
            )}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-white border-2 border-gray-200 text-gray-500 hover:bg-gray-50 transition-colors shadow-sm"
            >
              {uploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Camera className="h-3.5 w-3.5" />
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleAvatarUpload(file);
                e.target.value = '';
              }}
            />
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
          if (item.roles && user?.role && !item.roles.includes(user.role)) {
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
