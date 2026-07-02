import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Copy, KeyRound, Loader2, Lock, Plus, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

import { rolesApi } from '../api/services';
import { PERMISSION_GROUPS } from '../types';
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
  checks_edit: { section: 'checks', action: 'edit', kind: 'scope' },
  checks_delete: { section: 'checks', action: 'delete', kind: 'bool' },
  checks_change_datetime: { section: 'checks', action: 'changeDatetime', kind: 'bool' },
  edit_closed_check: { section: 'checks', action: 'editClosed', kind: 'bool' },
  payment_edit: { section: 'checks', action: 'editPayment', kind: 'bool' },
  accept_payment: { section: 'checks', action: 'acceptPayment', kind: 'bool' },
  sell_installment: { section: 'checks', action: 'sellInstallment', kind: 'bool' },
  warehouse_access: { section: 'warehouse', action: 'view', kind: 'bool' },
  warehouse_delete: { section: 'warehouse', action: 'delete', kind: 'bool' },
  suppliers_access: { section: 'suppliers', action: 'view', kind: 'bool' },
  clients_view: { section: 'clients', action: 'view', kind: 'bool' },
  clients_edit: { section: 'clients', action: 'edit', kind: 'bool' },
  schedule_view: { section: 'schedule', action: 'view', kind: 'bool' },
  bookings_access: { section: 'bookings', action: 'view', kind: 'bool' },
  salary_view: { section: 'salary', action: 'view', kind: 'scope' },
  financial_reports: { section: 'reports', action: 'view', kind: 'bool' },
  profit_view: { section: 'reports', action: 'profit', kind: 'bool' },
  export_data: { section: 'reports', action: 'export', kind: 'bool' },
  can_add_expenses: { section: 'expenses', action: 'add', kind: 'bool' },
  marketing_access: { section: 'marketing', action: 'view', kind: 'bool' },
  calls_view: { section: 'calls', action: 'view', kind: 'bool' },
  calls_listen: { section: 'calls', action: 'listen', kind: 'bool' },
  user_management: { section: 'employees', action: 'manage', kind: 'bool' },
};

/**
 * Подписи — паритет с mobile PERMISSION_LABELS (UsersScreen). Record —
 * exhaustive: новый PermissionKey без подписи ломает typecheck, а не UI.
 */
const MATRIX_LABELS: Record<PermissionKey, string> = {
  checks_view: 'Видит заказ-наряды',
  checks_create: 'Создаёт заказ-наряды',
  checks_edit: 'Редактирует заказ-наряды',
  checks_delete: 'Удаляет заказ-наряды',
  checks_change_datetime: 'Меняет дату и время',
  checks_view_all: 'Видит заказ-наряды всех мастеров', // поглощён охватом checks_view
  payment_edit: 'Меняет оплату',
  accept_payment: 'Кассир смены (принимает оплату)',
  sell_installment: 'Продаёт в рассрочку',
  edit_closed_check: 'Редактирует проведённый заказ-наряд',
  profit_view: 'Видит прибыль',
  financial_reports: 'Финансовые отчёты',
  export_data: 'Экспорт данных',
  can_add_expenses: 'Вносит расходы',
  salary_view: 'Видит зарплаты',
  warehouse_access: 'Доступ к складу',
  suppliers_access: 'Доступ к поставщикам',
  warehouse_delete: 'Удаление на складе',
  clients_view: 'Видит клиентов',
  clients_edit: 'Редактирует клиентов',
  schedule_view: 'Доступ к расписанию',
  bookings_access: 'Доступ к записям',
  marketing_access: 'Доступ к маркетингу',
  calls_view: 'Видит звонки',
  calls_listen: 'Слушает записи звонков',
  user_management: 'Управление сотрудниками',
};

/** Пояснения к неочевидным строкам. */
const MATRIX_HINTS: Partial<Record<PermissionKey, string>> = {
  checks_view: '«Свои» — только собственные заказ-наряды, «Все» — всех мастеров.',
  accept_payment: 'Действует, когда включён режим кассовых смен.',
};

/** Секции редактора: PERMISSION_GROUPS минус checks_view_all (охват checks_view). */
const EDITOR_GROUPS: { title: string; rows: { key: PermissionKey; def: CellDef }[] }[] = Object.entries(
  PERMISSION_GROUPS,
).map(([title, keys]) => ({
  title,
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
    },
    warehouse: { view: bool('warehouse', 'view'), delete: bool('warehouse', 'delete') },
    suppliers: { view: bool('suppliers', 'view') },
    clients: { view: bool('clients', 'view'), edit: bool('clients', 'edit') },
    schedule: { view: bool('schedule', 'view') },
    bookings: { view: bool('bookings', 'view') },
    salary: { view: scope('salary', 'view') },
    reports: { view: bool('reports', 'view'), profit: bool('reports', 'profit'), export: bool('reports', 'export') },
    expenses: { add: bool('expenses', 'add') },
    marketing: { view: bool('marketing', 'view') },
    calls: { view: bool('calls', 'view'), listen: bool('calls', 'listen') },
    employees: { manage: bool('employees', 'manage') },
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
                  Роль — базовый набор прав. Назначается сотруднику в его карточке; личные галочки сотрудника действуют
                  поверх роли.
                </p>
                <button onClick={() => setView({ kind: 'create' })} className="btn-primary flex-shrink-0">
                  <Plus className="w-4 h-4" />
                  Новая роль
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
  const readOnly = mode === 'edit' && !!role?.isSystem;

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

  const saveMutation = useMutation({
    mutationFn: () => {
      const payload = { name: name.trim(), description: description.trim(), matrix: buildMatrix(matrix) };
      return mode === 'edit' && role ? rolesApi.update(role.id, payload) : rolesApi.create(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
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
            Системная роль — только для чтения. Создайте копию, чтобы настроить права под себя.
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

      {/* Матрица прав */}
      <div className="space-y-4">
        {EDITOR_GROUPS.map((group) => (
          <div key={group.title}>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1.5">{group.title}</p>
            <div className="divide-y divide-gray-50 rounded-xl border border-gray-100 px-4">
              {group.rows.map(({ key, def }) => {
                const hint = MATRIX_HINTS[key];
                return (
                  <div key={key} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm text-gray-700">{MATRIX_LABELS[key]}</p>
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
        ))}
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
