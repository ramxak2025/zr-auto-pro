import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Banknote,
  BarChart3,
  BookOpen,
  Box,
  Copy,
  Info,
  KeyRound,
  Loader2,
  Lock,
  Package,
  Plus,
  Receipt,
  Settings,
  ShieldCheck,
  Trash2,
  Truck,
  Users2,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import toast from 'react-hot-toast';

import { rolesApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { PERMISSION_GROUPS, CASHIER_ROLE_PRESET } from '../types';
import type { PermissionKey, Role, RoleMatrix, RoleScope, User } from '../types';
import Modal from './Modal';
import ConfirmDialog from './ConfirmDialog';

// ─────────────────────────────────────────────────────────────────────────────
//  Роли как в Битрикс24 (волна 2, web). Управление ролями: список
//  «Системные / Мои роли», редактор матрицы «право × охват», копирование,
//  удаление. Системные роли read-only — для них доступна только копия.
//  Backend: roles/ (миграция 114); карта «PermissionKey → ячейка матрицы» —
//  зеркало backend/src/common/role-matrix.ts.
// ─────────────────────────────────────────────────────────────────────────────

/** Адрес ячейки матрицы для одного плоского permission-ключа. */
interface CellDef {
  section: string;
  action: string;
  kind: 'scope' | 'bool';
  /**
   * Переопределение подписи строки редактора. Нужно scope-ячейкам, чьё имя в
   * exhaustive-карте MATRIX_LABELS содержит «: свои» (напр. cashflow_view →
   * «Движение денег: свои»), а в строке с сегментом Нет/Свои/Все охват задаёт
   * сам сегмент, поэтому строка подписывается коротко — «Движение денег».
   */
  label?: string;
}

/**
 * PermissionKey → ячейка RoleMatrix (зеркало backend/src/common/role-matrix.ts).
 * `checks_view_all` собственной ячейки не имеет — он поглощён охватом
 * checks.view ('all' → checks_view + checks_view_all), поэтому его здесь нет
 * и в редакторе он не рендерится.
 */
const MATRIX_CELLS: Partial<Record<PermissionKey, CellDef>> = {
  checks_view: { section: 'checks', action: 'view', kind: 'scope' },
  checks_create: { section: 'checks', action: 'create', kind: 'bool' },
  // Охват checks.edit ('all' → checks_edit + checks_edit_all), как у checks.view.
  checks_edit: { section: 'checks', action: 'edit', kind: 'scope' },
  checks_delete: { section: 'checks', action: 'delete', kind: 'bool' },
  checks_change_datetime: { section: 'checks', action: 'changeDatetime', kind: 'bool' },
  edit_closed_check: { section: 'checks', action: 'editClosed', kind: 'bool' },
  payment_edit: { section: 'checks', action: 'editPayment', kind: 'bool' },
  accept_payment: { section: 'checks', action: 'acceptPayment', kind: 'bool' },
  sell_installment: { section: 'checks', action: 'sellInstallment', kind: 'bool' },
  // Round 14 (миграция 148, режим «Кассир») — состав назначенного заказа.
  checks_edit_assigned_order: { section: 'checks', action: 'editAssignedOrder', kind: 'bool' },
  // Словарь v3 (миграция 136) — кассовые смены и колонки доски.
  cash_shifts_manage: { section: 'checks', action: 'cashShifts', kind: 'bool' },
  checks_board_manage: { section: 'checks', action: 'board', kind: 'bool' },
  // Услуги: view (смотреть + в чек) / manage (CRUD + %/гарантия). manage ⇒ view.
  services_view: { section: 'services', action: 'view', kind: 'bool' },
  services_manage: { section: 'services', action: 'manage', kind: 'bool' },
  // Склад: view (товары без себестоимости) / manage (себестоимость + CRUD +
  // инвентаризация; manage ⇒ view И delete) / delete (удаление).
  warehouse_access: { section: 'warehouse', action: 'view', kind: 'bool' },
  warehouse_manage: { section: 'warehouse', action: 'manage', kind: 'bool' },
  warehouse_delete: { section: 'warehouse', action: 'delete', kind: 'bool' },
  warehouse_analytics_view: { section: 'warehouse', action: 'analytics', kind: 'bool' },
  // Поставщики: view / manage (manage ⇒ view) / paymentsCorrect (сторно +
  // возврат от поставщика, миграция 145 — manage НЕ влечёт).
  suppliers_access: { section: 'suppliers', action: 'view', kind: 'bool' },
  suppliers_manage: { section: 'suppliers', action: 'manage', kind: 'bool' },
  suppliers_payments_correct: { section: 'suppliers', action: 'paymentsCorrect', kind: 'bool' },
  // Имущество: view (справочник) / manage (выдача/CRUD) / permanentDelete. manage ⇒ view.
  equipment_view: { section: 'equipment', action: 'view', kind: 'bool' },
  equipment_manage: { section: 'equipment', action: 'manage', kind: 'bool' },
  equipment_permanent_delete: { section: 'equipment', action: 'permanentDelete', kind: 'bool' },
  clients_view: { section: 'clients', action: 'view', kind: 'bool' },
  clients_edit: { section: 'clients', action: 'edit', kind: 'bool' },
  clients_delete: { section: 'clients', action: 'delete', kind: 'bool' },
  debts_manage: { section: 'clients', action: 'debts', kind: 'bool' },
  schedule_view: { section: 'schedule', action: 'view', kind: 'bool' },
  schedule_manage: { section: 'schedule', action: 'manage', kind: 'bool' },
  bookings_access: { section: 'bookings', action: 'view', kind: 'bool' },
  // Охват salary.view ('all' → salary_view + salary_view_all).
  salary_view: { section: 'salary', action: 'view', kind: 'scope', label: 'Зарплата' },
  salary_payouts_manage: { section: 'salary', action: 'payouts', kind: 'bool' },
  salary_premiums_manage: { section: 'salary', action: 'premiums', kind: 'bool' },
  motivation_manage: { section: 'salary', action: 'motivation', kind: 'bool' },
  financial_reports: { section: 'reports', action: 'view', kind: 'bool' },
  profit_view: { section: 'reports', action: 'profit', kind: 'bool' },
  export_data: { section: 'reports', action: 'export', kind: 'bool' },
  // «Движение денег» — охват (none/own/all). 'all' раскладывается сервером в
  // cashflow_view + cashflow_view_all, поэтому cashflow_view_all собственной
  // ячейки не имеет (как checks_view_all у охвата checks.view).
  cashflow_view: { section: 'reports', action: 'cashflow', kind: 'scope', label: 'Движение денег' },
  can_add_expenses: { section: 'expenses', action: 'add', kind: 'bool' },
  // Маркетинг: view (смотреть раздел) / manage (мутации: интеграции/рассылки/…). manage ⇒ view.
  marketing_access: { section: 'marketing', action: 'view', kind: 'bool' },
  marketing_manage: { section: 'marketing', action: 'manage', kind: 'bool' },
  calls_view: { section: 'calls', action: 'view', kind: 'bool' },
  calls_listen: { section: 'calls', action: 'listen', kind: 'bool' },
  user_management: { section: 'employees', action: 'manage', kind: 'bool' },
  employees_approve_profile: { section: 'employees', action: 'approveProfile', kind: 'bool' },
  // Настройки / База знаний (новые секции словаря v3).
  settings_manage: { section: 'settings', action: 'manage', kind: 'bool' },
  company_manage: { section: 'settings', action: 'company', kind: 'bool' },
  // База знаний: view (смотреть базу) / manage (мутации). manage ⇒ view.
  knowledge_view: { section: 'knowledge', action: 'view', kind: 'bool' },
  knowledge_manage: { section: 'knowledge', action: 'manage', kind: 'bool' },
};

/**
 * Подписи — паритет с mobile PERMISSION_LABELS (UsersScreen). Record —
 * exhaustive: новый PermissionKey без подписи ломает typecheck, а не UI.
 */
const MATRIX_LABELS: Record<PermissionKey, string> = {
  checks_view: 'Видит заказ-наряды',
  checks_create: 'Создаёт заказ-наряды',
  checks_edit: 'Редактирует заказ-наряды',
  checks_edit_all: 'Редактирует заказ-наряды всех мастеров', // поглощён охватом checks_edit ('all')
  checks_delete: 'Удаляет заказ-наряды',
  checks_change_datetime: 'Меняет дату и время',
  checks_view_all: 'Видит заказ-наряды всех мастеров', // поглощён охватом checks_view
  payment_edit: 'Меняет оплату',
  accept_payment: 'Кассир смены (принимает оплату)',
  sell_installment: 'Продаёт в рассрочку',
  edit_closed_check: 'Редактирует проведённый заказ-наряд',
  checks_edit_assigned_order: 'Изменяет назначенный заказ',
  services_view: 'Видит услуги (добавляет в чек)',
  services_manage: 'Управляет каталогом услуг',
  profit_view: 'Видит прибыль',
  financial_reports: 'Финансовые отчёты',
  export_data: 'Экспорт данных',
  cashflow_view: 'Движение денег: свои', // в редакторе строка охвата подписана «Движение денег» (см. CellDef.label)
  cashflow_view_all: 'Движение денег: все', // поглощён охватом reports.cashflow ('all')
  can_add_expenses: 'Вносит расходы',
  salary_view: 'Видит зарплаты: свои', // в редакторе строка охвата подписана «Зарплата» (см. CellDef.label)
  salary_view_all: 'Видит зарплаты: все', // поглощён охватом salary.view ('all')
  warehouse_access: 'Доступ к складу',
  warehouse_manage: 'Управляет складом (себестоимость, инвентаризация)',
  warehouse_delete: 'Удаление на складе',
  suppliers_access: 'Доступ к поставщикам',
  suppliers_manage: 'Управляет поставщиками',
  suppliers_payments_correct: 'Корректирует платежи поставщикам',
  equipment_view: 'Видит имущество',
  equipment_manage: 'Управляет имуществом',
  clients_view: 'Видит клиентов',
  clients_edit: 'Редактирует клиентов',
  schedule_view: 'Доступ к расписанию',
  bookings_access: 'Доступ к записям',
  marketing_access: 'Доступ к маркетингу',
  marketing_manage: 'Управляет маркетингом',
  calls_view: 'Видит звонки',
  calls_listen: 'Слушает записи звонков',
  user_management: 'Управление сотрудниками',
  // Словарь v3 (миграция 136) — паритет с mobile PERMISSION_LABELS.
  cash_shifts_manage: 'Открывает и закрывает кассовые смены',
  checks_board_manage: 'Настраивает колонки доски',
  clients_delete: 'Удаляет клиентов',
  debts_manage: 'Управляет долгами и рассрочкой',
  schedule_manage: 'Управляет расписанием',
  salary_payouts_manage: 'Выплаты, авансы и штрафы',
  salary_premiums_manage: 'Начисляет премии',
  motivation_manage: 'Управляет акциями мотивации',
  warehouse_analytics_view: 'Видит аналитику склада',
  equipment_permanent_delete: 'Удаляет имущество безвозвратно',
  employees_approve_profile: 'Согласует изменения профиля',
  settings_manage: 'Управляет настройками и интеграциями',
  company_manage: 'Управляет данными компании',
  knowledge_view: 'Доступ к базе знаний',
  knowledge_manage: 'Управляет базой знаний',
};

/** Пояснения к неочевидным строкам. */
const MATRIX_HINTS: Partial<Record<PermissionKey, string>> = {
  checks_view: '«Свои» — только собственные заказ-наряды, «Все» — всех мастеров.',
  checks_edit: '«Свои» — редактирует только свои, «Все» — заказ-наряды всех мастеров.',
  cashflow_view: '«Свои» — только собственные операции, «Все» — по всему автосервису.',
  salary_view: '«Свои» — только своя зарплата, «Все» — по всей команде.',
  accept_payment: 'Действует, когда включён режим кассовых смен.',
  checks_edit_assigned_order:
    'Может менять состав (работы и товары) заказ-наряда, назначенного через доску. Выключено — сотрудник только выполняет назначенное и двигает карточку по статусам.',
  services_manage: 'Управление включает просмотр: редактирование каталога, % мастера и гарантию.',
  warehouse_manage: 'Управление включает просмотр и удаление: себестоимость, цены, остатки, инвентаризация.',
  suppliers_manage: 'Управление включает просмотр: создание, редактирование и удаление поставщиков.',
  suppliers_payments_correct:
    'Сторно ошибочного платежа и «Возврат от поставщика». Не входит в «Управляет поставщиками» — выдаётся отдельно.',
  equipment_manage: 'Управление включает просмотр: выдача, возврат и редактирование имущества.',
  calls_listen: 'Прослушивание записей разговоров.',
  marketing_manage: 'Управление включает просмотр: интеграции, площадки, настройки и отправку рассылок.',
  knowledge_view: 'Разрешает открыть базу знаний. Без него роль раздел не видит.',
  knowledge_manage: 'Управление включает просмотр: создание и редактирование курсов, статей и регламентов.',
  salary_payouts_manage: 'Владельческое право: включить его в роли может только директор.',
  equipment_permanent_delete: 'Владельческое право: включить его в роли может только директор.',
  employees_approve_profile: 'Владельческое право: включить его в роли может только директор.',
  company_manage: 'Владельческое право: включить его в роли может только директор.',
};

/** Иконка секции редактора (по ключу PERMISSION_GROUPS). */
const GROUP_ICONS: Record<string, LucideIcon> = {
  Касса: Receipt,
  Услуги: Wrench,
  Финансы: BarChart3,
  Склад: Package,
  Поставщики: Truck,
  Имущество: Box,
  CRM: Users2,
  Управление: ShieldCheck,
  Настройки: Settings,
  'База знаний': BookOpen,
};

/**
 * Секции редактора: PERMISSION_GROUPS. Ключи-«поглощённые» охватом
 * (checks_view_all/checks_edit_all/salary_view_all/cashflow_view_all) не имеют
 * своей ячейки в MATRIX_CELLS и в редактор не попадают — их задаёт сегмент охвата.
 */
const EDITOR_GROUPS: { title: string; icon: LucideIcon; rows: { key: PermissionKey; def: CellDef }[] }[] =
  Object.entries(PERMISSION_GROUPS).map(([title, keys]) => ({
    title,
    icon: GROUP_ICONS[title] ?? KeyRound,
    rows: (keys as readonly PermissionKey[]).flatMap((key) => {
      const def = MATRIX_CELLS[key];
      return def ? [{ key, def }] : [];
    }),
  }));

const SCOPE_OPTIONS: { value: RoleScope; label: string }[] = [
  { value: 'none', label: 'Нет' },
  { value: 'own', label: 'Свои' },
  { value: 'all', label: 'Все' },
];

/** Локальное generic-представление матрицы для чтения/записи по строковым путям. */
type EditableMatrix = Record<string, Record<string, RoleScope | boolean | undefined>>;

/** Развернуть RoleMatrix роли в редактируемое состояние (fail-closed: нет → 'none'/false). */
function toEditable(matrix: RoleMatrix | null | undefined): EditableMatrix {
  // Единственный каст: RoleMatrix — интерфейс с фиксированными секциями, а для
  // универсального обхода по строковым путям нужен Record-вид.
  const src = (matrix ?? {}) as unknown as EditableMatrix;
  const out: EditableMatrix = {};
  for (const def of Object.values(MATRIX_CELLS)) {
    if (!def) continue;
    const raw = src[def.section]?.[def.action];
    const value: RoleScope | boolean =
      def.kind === 'scope' ? (raw === 'own' || raw === 'all' ? raw : 'none') : raw === true;
    out[def.section] = { ...out[def.section], [def.action]: value };
  }
  return out;
}

/**
 * Собрать полностью материализованную RoleMatrix из состояния редактора:
 * «что видишь — то и сохраняется». PATCH заменяет матрицу целиком (см.
 * UpdateRoleDto), поэтому всегда отправляем полную карту, без merge-краёв.
 */
function buildMatrix(m: EditableMatrix): RoleMatrix {
  const scope = (section: string, action: string): RoleScope => {
    const v = m[section]?.[action];
    return v === 'own' || v === 'all' ? v : 'none';
  };
  const bool = (section: string, action: string): boolean => m[section]?.[action] === true;
  return {
    checks: {
      view: scope('checks', 'view'),
      create: bool('checks', 'create'),
      edit: scope('checks', 'edit'),
      delete: bool('checks', 'delete'),
      changeDatetime: bool('checks', 'changeDatetime'),
      editClosed: bool('checks', 'editClosed'),
      editPayment: bool('checks', 'editPayment'),
      acceptPayment: bool('checks', 'acceptPayment'),
      sellInstallment: bool('checks', 'sellInstallment'),
      cashShifts: bool('checks', 'cashShifts'),
      board: bool('checks', 'board'),
      // Round 14 (миграция 148): без этой ячейки сохранение из редактора
      // молча сбрасывало бы «Изменяет назначенный заказ» в false.
      editAssignedOrder: bool('checks', 'editAssignedOrder'),
    },
    services: { view: bool('services', 'view'), manage: bool('services', 'manage') },
    warehouse: {
      view: bool('warehouse', 'view'),
      manage: bool('warehouse', 'manage'),
      delete: bool('warehouse', 'delete'),
      analytics: bool('warehouse', 'analytics'),
    },
    suppliers: {
      view: bool('suppliers', 'view'),
      manage: bool('suppliers', 'manage'),
      paymentsCorrect: bool('suppliers', 'paymentsCorrect'),
    },
    equipment: {
      view: bool('equipment', 'view'),
      manage: bool('equipment', 'manage'),
      permanentDelete: bool('equipment', 'permanentDelete'),
    },
    clients: {
      view: bool('clients', 'view'),
      edit: bool('clients', 'edit'),
      delete: bool('clients', 'delete'),
      debts: bool('clients', 'debts'),
    },
    schedule: { view: bool('schedule', 'view'), manage: bool('schedule', 'manage') },
    bookings: { view: bool('bookings', 'view') },
    salary: {
      view: scope('salary', 'view'),
      payouts: bool('salary', 'payouts'),
      premiums: bool('salary', 'premiums'),
      motivation: bool('salary', 'motivation'),
    },
    reports: {
      view: bool('reports', 'view'),
      profit: bool('reports', 'profit'),
      export: bool('reports', 'export'),
      cashflow: scope('reports', 'cashflow'),
    },
    expenses: { add: bool('expenses', 'add') },
    marketing: { view: bool('marketing', 'view'), manage: bool('marketing', 'manage') },
    calls: { view: bool('calls', 'view'), listen: bool('calls', 'listen') },
    employees: { manage: bool('employees', 'manage'), approveProfile: bool('employees', 'approveProfile') },
    settings: { manage: bool('settings', 'manage'), company: bool('settings', 'company') },
    knowledge: { view: bool('knowledge', 'view'), manage: bool('knowledge', 'manage') },
  };
}

/** 1 сотрудник, 2 сотрудника, 5 сотрудников. */
function pluralizeEmployees(n: number): string {
  const mod100 = n % 100;
  const mod10 = n % 10;
  if (mod100 >= 11 && mod100 <= 14) return 'сотрудников';
  if (mod10 === 1) return 'сотрудник';
  if (mod10 >= 2 && mod10 <= 4) return 'сотрудника';
  return 'сотрудников';
}

type View = { kind: 'list' } | { kind: 'edit'; role: Role } | { kind: 'create'; copyFrom?: Role };

interface RolesManagementProps {
  isOpen: boolean;
  onClose: () => void;
  roles: Role[];
  rolesLoading: boolean;
  /** Активные сотрудники страницы — для счётчика «N сотрудников» по roleId. */
  users: User[];
}

export default function RolesManagement({ isOpen, onClose, roles, rolesLoading, users }: RolesManagementProps) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>({ kind: 'list' });
  const [deleteRole, setDeleteRole] = useState<Role | null>(null);

  // Каждое открытие начинается со списка (сброс на open, а не на close, чтобы
  // контент не подменялся во время exit-анимации модалки).
  useEffect(() => {
    if (isOpen) setView({ kind: 'list' });
  }, [isOpen]);

  const deleteMutation = useMutation({
    mutationFn: (id: string) => rolesApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      toast.success('Роль удалена');
    },
    onError: (err: any) => {
      const data = err?.response?.data;
      if (data?.code === 'ROLE_HAS_USERS') {
        const n = typeof data.count === 'number' ? data.count : null;
        toast.error(
          n !== null
            ? `Сначала переназначьте ${n} ${pluralizeEmployees(n)} на другую роль`
            : data?.message || 'Роль используется сотрудниками',
        );
      } else {
        toast.error(data?.message || 'Не удалось удалить роль');
      }
    },
  });

  const systemRoles = roles.filter((r) => r.isSystem);
  const customRoles = roles.filter((r) => !r.isSystem);
  const countFor = (role: Role) => users.filter((u) => u.roleId === role.id).length;

  // Round 14: роль-пресет «Кассир» в один тап. Если роль с таким именем уже
  // есть — открываем её редактор вместо создания дубля.
  const cashierRole = roles.find((r) => r.name === CASHIER_ROLE_PRESET.name);
  const createCashierMutation = useMutation({
    mutationFn: () => rolesApi.create(CASHIER_ROLE_PRESET),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      toast.success('Роль «Кассир» создана');
      setView({ kind: 'edit', role: res.data });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Не удалось создать роль «Кассир»');
    },
  });
  const handleCashierPreset = () => {
    if (cashierRole) {
      setView({ kind: 'edit', role: cashierRole });
    } else {
      createCashierMutation.mutate();
    }
  };

  const title = view.kind === 'list' ? 'Роли и права доступа' : view.kind === 'edit' ? 'Настройка роли' : 'Новая роль';

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title={title} size="xl">
        {view.kind === 'list' ? (
          rolesLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-start justify-between gap-3">
                <p className="text-xs text-gray-500">
                  Роль — набор прав доступа. Назначается сотруднику в его карточке и полностью определяет, что ему
                  доступно.
                </p>
                <button onClick={() => setView({ kind: 'create' })} className="btn-primary flex-shrink-0">
                  <Plus className="w-4 h-4" />
                  Новая роль
                </button>
              </div>

              {/* Round 14: пресет «Кассир» для режима кассовой смены */}
              <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-100 bg-emerald-50/60 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-emerald-900">Режим кассовой смены</p>
                  <p className="text-xs text-emerald-700 mt-0.5">
                    {cashierRole
                      ? 'Роль «Кассир» уже создана — откройте, чтобы посмотреть или настроить.'
                      : 'Строгая роль в один тап: приём оплаты и кассовые смены, без прав мастера.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleCashierPreset}
                  disabled={createCashierMutation.isPending}
                  className="btn-secondary flex-shrink-0"
                >
                  {createCashierMutation.isPending ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Banknote className="w-4 h-4" />
                  )}
                  {cashierRole ? 'Открыть «Кассир»' : 'Создать роль «Кассир»'}
                </button>
              </div>

              <RolesSection
                title="Системные"
                roles={systemRoles}
                countFor={countFor}
                onOpen={(role) => setView({ kind: 'edit', role })}
                onCopy={(role) => setView({ kind: 'create', copyFrom: role })}
                onDelete={setDeleteRole}
              />

              <RolesSection
                title="Мои роли"
                roles={customRoles}
                countFor={countFor}
                onOpen={(role) => setView({ kind: 'edit', role })}
                onCopy={(role) => setView({ kind: 'create', copyFrom: role })}
                onDelete={setDeleteRole}
                emptyText="Пока нет своих ролей — создайте новую или скопируйте системную."
              />
            </div>
          )
        ) : (
          <RoleEditor
            key={view.kind === 'edit' ? `edit-${view.role.id}` : `create-${view.copyFrom?.id ?? 'blank'}`}
            mode={view.kind}
            role={view.kind === 'edit' ? view.role : undefined}
            copyFrom={view.kind === 'create' ? view.copyFrom : undefined}
            onBack={() => setView({ kind: 'list' })}
            onCopy={(role) => setView({ kind: 'create', copyFrom: role })}
          />
        )}
      </Modal>

      {/* Удаление своей роли */}
      <ConfirmDialog
        isOpen={!!deleteRole}
        onClose={() => setDeleteRole(null)}
        onConfirm={() => {
          if (deleteRole) deleteMutation.mutate(deleteRole.id);
          setDeleteRole(null);
        }}
        title="Удалить роль"
        message={
          deleteRole
            ? `Удалить роль «${deleteRole.name}»? Если роль назначена сотрудникам, сначала переназначьте их на другую роль.`
            : ''
        }
        confirmText="Удалить"
        variant="danger"
      />
    </>
  );
}

// ─── Секция списка ролей ─────────────────────────────────────────────

function RolesSection({
  title,
  roles,
  countFor,
  onOpen,
  onCopy,
  onDelete,
  emptyText,
}: {
  title: string;
  roles: Role[];
  countFor: (role: Role) => number;
  onOpen: (role: Role) => void;
  onCopy: (role: Role) => void;
  onDelete: (role: Role) => void;
  emptyText?: string;
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">{title}</p>
      {roles.length === 0 ? (
        emptyText ? (
          <div className="text-center py-5 text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-200">
            <KeyRound className="w-6 h-6 mx-auto mb-1.5 opacity-40" />
            <p className="text-xs">{emptyText}</p>
          </div>
        ) : (
          <p className="text-xs text-gray-400">Нет ролей</p>
        )
      ) : (
        <div className="space-y-2">
          {roles.map((role) => {
            const count = countFor(role);
            return (
              <div
                key={role.id}
                className="flex items-center justify-between gap-3 bg-gray-50 rounded-xl border border-gray-100 px-4 py-3"
              >
                <button type="button" onClick={() => onOpen(role)} className="flex-1 min-w-0 text-left group">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-900 text-sm truncate group-hover:text-primary-700 transition-colors">
                      {role.name}
                    </span>
                    {role.isSystem && <span className="badge-gray flex-shrink-0">Системная</span>}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5 truncate">
                    {role.description ? `${role.description} · ` : ''}
                    {count} {pluralizeEmployees(count)}
                  </div>
                </button>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => onCopy(role)}
                    className="p-1.5 text-gray-400 hover:text-primary-600 rounded-lg hover:bg-gray-100 transition-colors"
                    title="Создать копию"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                  {!role.isSystem && (
                    <button
                      type="button"
                      onClick={() => onDelete(role)}
                      className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                      title="Удалить роль"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Редактор роли (создание / просмотр / правка) ────────────────────

function RoleEditor({
  mode,
  role,
  copyFrom,
  onBack,
  onCopy,
}: {
  mode: 'edit' | 'create';
  /** edit: редактируемая (или системная, read-only) роль. */
  role?: Role;
  /** create: роль-источник копии (матрица берётся базой). */
  copyFrom?: Role;
  onBack: () => void;
  onCopy: (role: Role) => void;
}) {
  const queryClient = useQueryClient();
  const { refreshUser } = useAuth();
  // Волна 3 (миграция 121): системные «Мастер»/«Администратор» теперь РЕДАКТИРУЕМЫ
  // — сервер делает copy-on-write (тенантный override). Read-only остаётся ТОЛЬКО
  // у заблокированной роли (`locked: true` — это «Директор», полные права).
  const readOnly = mode === 'edit' && role?.locked === true;
  // Редактируемая системная роль — показываем ненавязчивую подсказку про override.
  const systemEditable = mode === 'edit' && !!role?.isSystem && !readOnly;

  const [name, setName] = useState(mode === 'edit' ? (role?.name ?? '') : copyFrom ? `${copyFrom.name} (копия)` : '');
  const [description, setDescription] = useState(
    mode === 'edit' ? (role?.description ?? '') : (copyFrom?.description ?? ''),
  );
  const [matrix, setMatrix] = useState<EditableMatrix>(() =>
    toEditable(mode === 'edit' ? role?.matrix : copyFrom?.matrix),
  );

  const setCell = (def: CellDef, value: RoleScope | boolean) => {
    setMatrix((prev) => ({ ...prev, [def.section]: { ...prev[def.section], [def.action]: value } }));
  };
  const scopeOf = (def: CellDef): RoleScope => {
    const v = matrix[def.section]?.[def.action];
    return v === 'own' || v === 'all' ? v : 'none';
  };
  const boolOf = (def: CellDef): boolean => matrix[def.section]?.[def.action] === true;

  // Round 14: мягкое предупреждение (НЕ блокирует сохранение) — роль
  // одновременно принимает оплату и создаёт/меняет заказы. Совмещение
  // кассира с работой мастера продуктом не рекомендуется.
  const cashierMixWarning =
    matrix.checks?.acceptPayment === true &&
    (matrix.checks?.create === true || matrix.checks?.editAssignedOrder === true);

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = { name: name.trim(), description: description.trim(), matrix: buildMatrix(matrix) };
      return mode === 'edit' && role ? rolesApi.update(role.id, payload) : rolesApi.create(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      // Матрица роли — источник эффективных прав /auth/me. Если правили роль
      // ТЕКУЩЕГО пользователя (например, admin — свою), локальные hasPermission-
      // гейты должны обновиться сразу, не дожидаясь перезагрузки страницы.
      void refreshUser();
      toast.success(
        mode === 'edit' ? 'Роль сохранена. Права сотрудников обновятся в течение ~30 секунд' : 'Роль создана',
      );
      onBack();
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Не удалось сохранить роль');
    },
  });

  const handleSave = () => {
    if (!name.trim()) {
      toast.error('Введите название роли');
      return;
    }
    saveMutation.mutate();
  };

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />К списку ролей
      </button>

      {readOnly && (
        <div className="flex items-start gap-2.5 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
          <Lock className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-blue-700">
            Директор — полные права, редактировать нельзя. При необходимости создайте копию как основу для своей роли.
          </p>
        </div>
      )}

      {systemEditable && (
        <div className="flex items-start gap-2.5 bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
          <Info className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-gray-500">
            Системная роль. Изменения сохранятся только для вашего автосервиса — общий шаблон остаётся прежним.
          </p>
        </div>
      )}

      {mode === 'create' && copyFrom && (
        <p className="text-xs text-gray-400">Права скопированы из роли «{copyFrom.name}» — настройте под себя.</p>
      )}

      <div>
        <label className="label">Название</label>
        <input
          type="text"
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Например: Приёмщик"
          maxLength={100}
          disabled={readOnly}
        />
      </div>

      <div>
        <label className="label">Описание</label>
        <input
          type="text"
          className="input"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Необязательно"
          maxLength={500}
          disabled={readOnly}
        />
      </div>

      {/* Round 14: кассир + исполнительские права — мягкое предупреждение */}
      {cashierMixWarning && (
        <div className="flex items-start gap-2.5 bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-3">
          <Info className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-yellow-800">
            Кассир обычно не совмещается с работой мастера: роль одновременно принимает оплату и создаёт или меняет
            заказы. Сохранить можно — но надёжнее разделить эти роли.
          </p>
        </div>
      )}

      {/* Матрица прав */}
      <div className="space-y-4">
        {EDITOR_GROUPS.map((group) => {
          const GroupIcon = group.icon;
          return (
            <div key={group.title}>
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1.5">
                <GroupIcon className="w-3.5 h-3.5" />
                {group.title}
              </p>
              <div className="divide-y divide-gray-50 rounded-xl border border-gray-100 px-4">
                {group.rows.map(({ key, def }) => {
                  const hint = MATRIX_HINTS[key];
                  return (
                    <div key={key} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm text-gray-700">{def.label ?? MATRIX_LABELS[key]}</p>
                        {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
                      </div>
                      {def.kind === 'scope' ? (
                        <ScopeSegmented value={scopeOf(def)} disabled={readOnly} onChange={(v) => setCell(def, v)} />
                      ) : (
                        <input
                          type="checkbox"
                          checked={boolOf(def)}
                          disabled={readOnly}
                          onChange={() => setCell(def, !boolOf(def))}
                          className="w-4 h-4 flex-shrink-0 text-primary-600 border-gray-300 rounded focus:ring-primary-500 disabled:opacity-60"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
        {readOnly && role ? (
          <>
            <button type="button" onClick={onBack} className="btn-secondary">
              Назад
            </button>
            <button type="button" onClick={() => onCopy(role)} className="btn-primary">
              <Copy className="w-4 h-4" />
              Создать копию
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={onBack} className="btn-secondary">
              Отмена
            </button>
            <button type="button" onClick={handleSave} disabled={saveMutation.isPending} className="btn-primary">
              {saveMutation.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Сохранение...
                </>
              ) : mode === 'edit' ? (
                'Сохранить'
              ) : (
                'Создать роль'
              )}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Segmented control «Нет | Свои | Все» ────────────────────────────

function ScopeSegmented({
  value,
  disabled,
  onChange,
}: {
  value: RoleScope;
  disabled?: boolean;
  onChange: (value: RoleScope) => void;
}) {
  return (
    <div className={`inline-flex flex-shrink-0 rounded-lg bg-gray-100 p-0.5 ${disabled ? 'opacity-60' : ''}`}>
      {SCOPE_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          disabled={disabled}
          onClick={() => onChange(opt.value)}
          className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
            value === opt.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          } ${disabled ? 'cursor-not-allowed' : ''}`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
