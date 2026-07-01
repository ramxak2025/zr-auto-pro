import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Switch,
} from 'react-native';
import CachedImage from '../components/CachedImage';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { usersApi, productsApi, uploadsApi, permissionTemplatesApi } from '../api/services';
import { getImageUrl } from '../api/axios';
import { useAuth } from '../contexts/AuthContext';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import LoadingSpinner from '../components/LoadingSpinner';
import AnimatedCard from '../components/AnimatedCard';
import EmptyState from '../components/EmptyState';
import IosScreenHeader from '../components/IosScreenHeader';
import { useColors } from '../contexts/ThemeContext';
import { useShadow } from '../platform/iosSurface';
import { colors, fontSize, fontWeight, borderRadius, spacing, getBadgeColors } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { useUsers, decideStaffListView } from '../hooks/useUsers';
import { haptic } from '../platform/haptics';
import type {
  User,
  UserPermissions,
  Product,
  SectionVisibility,
  ItemVisibility,
  PermissionKey,
  PermissionTemplate,
} from '../../../shared/types';
import {
  UserRole,
  ITEM_KEYS,
  ALL_ITEM_KEYS,
  PERMISSION_GROUPS,
  PERMISSION_KEYS,
  ROLE_PERMISSION_DEFAULTS,
} from '../../../shared/types';
import { formatPhone } from '../../../shared/validation/phone';

const roleBadgeMap: Record<string, string> = {
  director: 'purple',
  admin: 'blue',
  master: 'green',
  superadmin: 'red',
};

const roleLabels: Record<string, string> = {
  superadmin: 'Суперадмин',
  director: 'Владелец',
  admin: 'Администратор',
  master: 'Мастер',
};

// ── Action permissions (server-enforced) ─────────────────────────────────────
// SEPARATE from the section/item menu-VISIBILITY editors below: visibility says
// which «Ещё» rows a user SEES; these say which server ACTIONS a user may DO.
// The vocabulary (keys + grouping) is the canonical PERMISSION_GROUPS contract
// from shared/types — backend's PermissionsGuard enforces the exact same keys.
//
// Owner-friendly Russian labels for every canonical PermissionKey. Phrased as a
// capability ("Видит…", "Меняет…", "Доступ к…") so a non-technical owner reads
// each row as a plain sentence about what the employee can do.
const PERMISSION_LABELS: Record<PermissionKey, string> = {
  // Касса
  checks_view: 'Видит чеки',
  checks_create: 'Создаёт чеки',
  checks_edit: 'Редактирует чеки',
  checks_delete: 'Удаляет чеки',
  checks_change_datetime: 'Меняет дату и время чека',
  checks_view_all: 'Видит чеки всех мастеров',
  payment_edit: 'Меняет оплату чека',
  accept_payment: 'Кассир смены (принимает оплату)',
  sell_installment: 'Продаёт в рассрочку',
  // Финансы
  profit_view: 'Видит прибыль',
  financial_reports: 'Финансовые отчёты',
  export_data: 'Экспорт данных',
  can_add_expenses: 'Вносит расходы',
  salary_view: 'Видит зарплаты',
  // Склад
  warehouse_access: 'Доступ к складу',
  suppliers_access: 'Доступ к поставщикам',
  warehouse_delete: 'Удаление на складе',
  // CRM
  clients_view: 'Видит клиентов',
  clients_edit: 'Редактирует клиентов',
  schedule_view: 'Доступ к расписанию',
  bookings_access: 'Доступ к записям',
  marketing_access: 'Доступ к маркетингу',
  calls_view: 'Видит звонки',
  calls_listen: 'Слушает записи звонков',
  // Управление
  user_management: 'Управление пользователями',
};

// Subtitle for the two keys whose names hide a subtlety the owner should know.
const PERMISSION_HINTS: Partial<Record<PermissionKey, string>> = {
  checks_view_all: 'Без этого права мастер видит только свои чеки.',
  user_management: 'Даёт доступ к этому экрану — правам и сотрудникам.',
  warehouse_delete: 'Разрешает удалять товары и папки склада. Удалённое попадает в Корзину — можно восстановить.',
};

// Per-group SF-style icon + display order. Keys of PERMISSION_GROUPS drive the
// sections; this only supplies the leading glyph for each header.
const PERMISSION_GROUP_ICONS: Record<keyof typeof PERMISSION_GROUPS, keyof typeof Ionicons.glyphMap> = {
  Касса: 'receipt-outline',
  Финансы: 'wallet-outline',
  Склад: 'cube-outline',
  CRM: 'people-outline',
  Управление: 'shield-checkmark-outline',
};

// Render-ready, typed view of the contract grouping (stable module-scope const).
const PERMISSION_GROUP_DEFS: {
  title: keyof typeof PERMISSION_GROUPS;
  icon: keyof typeof Ionicons.glyphMap;
  keys: readonly PermissionKey[];
}[] = (Object.keys(PERMISSION_GROUPS) as (keyof typeof PERMISSION_GROUPS)[]).map((title) => ({
  title,
  icon: PERMISSION_GROUP_ICONS[title],
  keys: PERMISSION_GROUPS[title],
}));

// Owner-class roles hold EVERY permission implicitly — the backend's
// PermissionsGuard short-circuits superadmin / director / admin before it ever
// consults the stored map. The editor renders a read-only note for these
// instead of toggles (mirrors the server bypass).
const OWNER_CLASS_ROLES = new Set<UserRole>([UserRole.SUPERADMIN, UserRole.DIRECTOR, UserRole.ADMIN]);

// Role preset buttons — fill the toggles from ROLE_PERMISSION_DEFAULTS so the
// owner gets a sensible baseline, then tweaks. Master is the only role with a
// non-empty default (owner-class roles bypass the map entirely).
const PERMISSION_PRESETS: { role: UserRole; label: string }[] = [
  { role: UserRole.MASTER, label: 'Мастер' },
  { role: UserRole.ADMIN, label: 'Администратор' },
  { role: UserRole.DIRECTOR, label: 'Директор' },
];

/**
 * Build a full PermissionKey→bool map from a role's ROLE_PERMISSION_DEFAULTS.
 * The defaults are sparse (only `true` keys matter for master; owner-class roles
 * are empty → everything implicit). We materialize every canonical key so the
 * switches render deterministically: a key absent from the role default is
 * `false` (for owner-class presets that means "all off" locally — the owner is
 * expected to grant explicitly, while the server still treats the role as full).
 */
function permissionsFromRoleDefaults(role: UserRole): Record<PermissionKey, boolean> {
  const defaults = ROLE_PERMISSION_DEFAULTS[role] ?? {};
  const map = {} as Record<PermissionKey, boolean>;
  for (const key of PERMISSION_KEYS) map[key] = defaults[key] === true;
  return map;
}

/**
 * Materialize a full PermissionKey→bool map from a role TEMPLATE's stored
 * permission blob. Templates persist `Record<string, boolean>`; the matrix
 * needs every canonical key present (a key absent from the template ⇒ `false`),
 * exactly like {@link permissionsFromRoleDefaults}. Applying a template = filling
 * the local matrix from this map, then saving through the SAME self-lockout-
 * protected updatePermissions path the manual toggles use — so the matrix and
 * the server never diverge (one write, not two).
 */
function permissionsFromTemplate(tpl: Record<string, boolean>): Record<PermissionKey, boolean> {
  const map = {} as Record<PermissionKey, boolean>;
  for (const key of PERMISSION_KEYS) map[key] = tpl[key] === true;
  return map;
}

// ── Section visibility (#071) ─────────────────────────────────────────
// Owner toggles which top-level «Ещё» groups an employee sees. Five buckets
// mirror MoreScreen's groups. Default is visible — only an explicit
// `isVisible: false` override hides a section for that user.
type SectionKey = SectionVisibility['sectionKey'];

const SECTION_DEFS: { key: SectionKey; label: string; description: string }[] = [
  { key: 'work', label: 'Работа', description: 'Расписание, клиенты, база знаний' },
  { key: 'finance', label: 'Финансы', description: 'Движение денег, зарплата, расходы, отчёты' },
  { key: 'warehouse', label: 'Склад', description: 'Услуги, поставщики, имущество, аналитика' },
  { key: 'marketing', label: 'Маркетинг', description: 'Отзывы, звонки, рассылки, интеграции' },
  { key: 'other', label: 'Остальное', description: 'Сотрудники, пользователи, компания, подписка' },
];

type SectionVisibilityMap = Record<SectionKey, boolean>;

const defaultSectionVisibility: SectionVisibilityMap = {
  work: true,
  finance: true,
  warehouse: true,
  marketing: true,
  other: true,
};

/** Fold the contract's sparse override list into a full key→bool map. */
function toVisibilityMap(overrides: SectionVisibility[] | undefined): SectionVisibilityMap {
  const map = { ...defaultSectionVisibility };
  for (const o of Array.isArray(overrides) ? overrides : []) {
    if (o.sectionKey in map) map[o.sectionKey] = o.isVisible;
  }
  return map;
}

/** Expand the full key→bool map into the contract's explicit override list. */
function mapToSections(map: SectionVisibilityMap): SectionVisibility[] {
  return SECTION_DEFS.map(({ key }) => ({ sectionKey: key, isVisible: map[key] }));
}

// ── Item visibility (#073) ────────────────────────────────────────────
// Granular layer UNDER section visibility: the owner can hide a single «Ещё»
// row even while its parent group stays visible. Item keys + grouping come
// straight from the shared ITEM_KEYS contract; labels mirror the MoreScreen
// menu rows (kept in the same order the owner sees them).
const ITEM_LABELS: Record<string, string> = {
  schedule: 'Расписание',
  clients: 'Клиенты',
  'knowledge-base': 'База знаний',
  cashflow: 'Движение денег',
  salary: 'Зарплата',
  expenses: 'Расходы',
  reports: 'Финансовые отчёты',
  services: 'Услуги',
  suppliers: 'Поставщики',
  equipment: 'Имущество',
  'warehouse-analytics': 'Складская аналитика',
  marketing: 'Отзывы и репутация',
  calls: 'Звонки',
  mailings: 'Рассылки',
  integrations: 'Интеграции',
  employees: 'Сотрудники',
  users: 'Пользователи',
  'company-settings': 'Настройки компании',
  subscription: 'Подписка',
};

// Group def for the editor: reuse SECTION_DEFS' label + the contract's item set.
const ITEM_GROUP_DEFS: { sectionKey: SectionKey; label: string; items: { key: string; label: string }[] }[] =
  SECTION_DEFS.map(({ key, label }) => ({
    sectionKey: key,
    label,
    items: (ITEM_KEYS[key] as readonly string[]).map((k) => ({ key: k, label: ITEM_LABELS[k] ?? k })),
  }));

// Owner (superadmin/director) can NEVER be denied these access-control /
// billing items — hiding them would be a self-lockout. Mirrors the same set in
// AuthContext.isItemVisible. The editor renders their toggles forced-on +
// disabled when the edited user holds an owner role.
const OWNER_PROTECTED_ITEM_KEYS = new Set<string>(['users', 'company-settings', 'subscription']);

type ItemVisibilityMap = Record<string, boolean>;

/** Default: every known item visible. */
function defaultItemVisibility(): ItemVisibilityMap {
  const map: ItemVisibilityMap = {};
  for (const k of ALL_ITEM_KEYS) map[k] = true;
  return map;
}

/** Fold the contract's sparse/materialized override list into a full map. */
function toItemVisibilityMap(overrides: ItemVisibility[] | undefined): ItemVisibilityMap {
  const map = defaultItemVisibility();
  for (const o of Array.isArray(overrides) ? overrides : []) {
    // Only keep keys we know about — a future server key we don't render yet
    // shouldn't crash the editor (it just won't get a toggle).
    if (o.itemKey in map) map[o.itemKey] = o.isVisible;
  }
  return map;
}

/** Expand the full map into the contract's explicit override list (all keys). */
function mapToItems(map: ItemVisibilityMap): ItemVisibility[] {
  return ALL_ITEM_KEYS.map((k) => ({ itemKey: k, isVisible: map[k] ?? true }));
}

const defaultPermissions: UserPermissions = {
  checks_view: true,
  checks_create: true,
  checks_edit: false,
  checks_delete: false,
  checks_change_datetime: false,
  profit_view: false,
  clients_view: true,
  clients_edit: false,
  warehouse_access: false,
  suppliers_access: false,
  financial_reports: false,
  export_data: false,
  user_management: false,
  schedule_view: false,
  salary_view: false,
  marketing_access: false,
};

function formatMoney(v: number) {
  return (
    Math.round(v)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
  );
}

interface UserForm {
  fullName: string;
  phone: string;
  password: string;
  role: UserRole;
  salaryPercent: number;
  productSalaryPercent: number;
  isActive: boolean;
  hiddenFromSchedule: boolean;
  hiddenEverywhere: boolean;
  permissions: UserPermissions;
  sectionVisibility: SectionVisibilityMap;
  itemVisibility: ItemVisibilityMap;
}

// ── UserCard ──────────────────────────────────────────────────────────
// Module-scope memoised user row. Previously the entire user list was
// re-rendered on every state change in UsersScreen (refresh toggle,
// commission modal open, product search). Memo + stable callbacks
// short-circuit unchanged rows.
interface UserCardProps {
  user: User;
  index: number;
  isDirectorOrSuperadmin: boolean;
  canDelete: boolean;
  badge: { bg: string; text: string };
  roleLabel: string;
  avatarUrl?: string | null;
  onEdit: (user: User) => void;
  onCommissions: (user: User) => void;
  onAvatarChange: (userId: string) => void;
  onDelete: (userId: string) => void;
}
const UserCard = React.memo(function UserCard({
  user,
  index,
  isDirectorOrSuperadmin,
  canDelete,
  badge,
  roleLabel,
  avatarUrl,
  onEdit,
  onCommissions,
  onAvatarChange,
  onDelete,
}: UserCardProps) {
  const palette = useColors();
  const shadow = useShadow();
  return (
    <AnimatedCard
      index={index}
      style={[styles.userCard, shadow, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
    >
      <TouchableOpacity style={styles.userRow} onPress={() => onEdit(user)} activeOpacity={0.7}>
        <View style={styles.avatarWrap}>
          {avatarUrl ? (
            <CachedImage source={{ uri: avatarUrl }} style={styles.avatarImage} />
          ) : (
            <View style={[styles.avatar, { backgroundColor: badge.bg }]}>
              <Text style={[styles.avatarText, { color: badge.text }]}>{user.fullName?.charAt(0) || 'U'}</Text>
            </View>
          )}
          {isDirectorOrSuperadmin && (
            <TouchableOpacity
              style={styles.avatarCameraBtn}
              onPress={() => onAvatarChange(user.id)}
              activeOpacity={0.7}
            >
              <Ionicons name="camera-outline" size={14} color={colors.white} />
            </TouchableOpacity>
          )}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
            <Text style={[styles.userName, { color: palette.text.primary }]} numberOfLines={1}>
              {user.fullName}
            </Text>
            <View style={[styles.roleBadge, { backgroundColor: badge.bg }]}>
              <Text style={[styles.roleBadgeText, { color: badge.text }]}>{roleLabel}</Text>
            </View>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginTop: 4 }}>
            <Text style={[styles.userPhone, { color: palette.text.secondary }]}>{formatPhone(user.phone)}</Text>
            <Text style={[styles.userDivider, { color: palette.text.tertiary }]}>|</Text>
            <Text style={[styles.userPhone, { color: palette.text.secondary }]}>
              {user.salaryPercent}%{user.productSalaryPercent ? ` / ${user.productSalaryPercent}%` : ''}
            </Text>
            <Text style={[styles.userDivider, { color: palette.text.tertiary }]}>|</Text>
            {user.isActive ? (
              <Text style={[styles.statusText, { color: colors.green[600] }]}>Активен</Text>
            ) : (
              <Text style={[styles.statusText, { color: colors.red[500] }]}>Неактивен</Text>
            )}
          </View>
        </View>
      </TouchableOpacity>

      {/* Action buttons row */}
      <View style={[styles.actionRow, { borderTopColor: palette.border.subtle }]}>
        <TouchableOpacity style={styles.actionChip} onPress={() => onEdit(user)}>
          <Ionicons name="pencil-outline" size={14} color={colors.primary[600]} />
          <Text style={styles.actionChipText}>Права</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.actionChip, { backgroundColor: colors.green[50], borderColor: colors.green[200] }]}
          onPress={() => onCommissions(user)}
        >
          <Ionicons name="gift-outline" size={14} color={colors.green[600]} />
          <Text style={[styles.actionChipText, { color: colors.green[700] }]}>Комиссии</Text>
        </TouchableOpacity>
        {canDelete && (
          <TouchableOpacity
            style={[styles.actionChip, { backgroundColor: colors.red[50], borderColor: colors.red[200] }]}
            onPress={() => onDelete(user.id)}
          >
            <Ionicons name="trash-outline" size={14} color={colors.red[500]} />
          </TouchableOpacity>
        )}
      </View>
    </AnimatedCard>
  );
});

const emptyForm: UserForm = {
  fullName: '',
  phone: '',
  password: '',
  role: UserRole.MASTER,
  salaryPercent: 0,
  productSalaryPercent: 0,
  isActive: true,
  hiddenFromSchedule: false,
  hiddenEverywhere: false,
  permissions: { ...defaultPermissions },
  sectionVisibility: { ...defaultSectionVisibility },
  itemVisibility: defaultItemVisibility(),
};

interface CommissionItem {
  productId: string;
  productName: string;
  percent: number;
  sellPrice: number;
  costPrice: number;
}

export default function UsersScreen() {
  const navigation = useNavigation<any>();
  const { hasPermission, user: currentUser } = useAuth();
  const queryClient = useQueryClient();
  const tabBarHeight = useTabBarHeight();
  const palette = useColors();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [form, setForm] = useState<UserForm>({ ...emptyForm });
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // 073 — which item-visibility group is expanded in the editor (accordion;
  // only one open at a time keeps the modal tidy). null = all collapsed.
  const [expandedGroup, setExpandedGroup] = useState<SectionKey | null>(null);
  // Action-permissions matrix: while the authoritative map is (re)fetched for
  // the edited user we show a spinner so the owner never toggles against a
  // stale seed. Seeded false; set true the moment openEdit kicks off the fetch.
  const [permissionsLoading, setPermissionsLoading] = useState(false);

  // ── Role templates (saved permission blueprints) ──────────────────────────
  // `templatesSheetOpen` shows the «Применить роль» picker (also the manage hub:
  // rename/delete live there). `templateNameDraft` backs the inline name prompt
  // for «Сохранить как роль» (RNModal — Alert.prompt is iOS-only, this screen is
  // shared with Android). `renamingTemplate` switches that same prompt to rename
  // mode. A small name modal beats Alert.prompt for cross-platform parity.
  const [templatesSheetOpen, setTemplatesSheetOpen] = useState(false);
  const [nameModalMode, setNameModalMode] = useState<'create' | 'rename' | null>(null);
  const [templateNameDraft, setTemplateNameDraft] = useState('');
  const [renamingTemplate, setRenamingTemplate] = useState<PermissionTemplate | null>(null);
  const [deleteTemplateId, setDeleteTemplateId] = useState<string | null>(null);

  // Commission modal
  const [commissionUserId, setCommissionUserId] = useState<string | null>(null);
  const [commissionUserName, setCommissionUserName] = useState('');
  const [globalProductPercent, setGlobalProductPercent] = useState(0);
  const [commissionItems, setCommissionItems] = useState<CommissionItem[]>([]);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [productSearchText, setProductSearchText] = useState('');

  // ['users'] — общий слот, который пишут также login-prefetch и три вкладки
  // ScheduleScreen. Раньше ЗДЕСЬ queryFn возвращала сырой AxiosResponse, а
  // массив доставал `select` — единственный писатель не-массива в общий ключ.
  // Когда слот перезаписывали массивом (Schedule/prefetch), `select(массив)
  // .data === undefined` → users = [] → ложное «Нет сотрудников». Теперь форма
  // едина (`User[]`) через общий хук — см. hooks/useUsers.ts.
  const { data, isLoading, isError, isSuccess, refetch } = useUsers();

  const { data: allProducts } = useQuery<Product[]>({
    queryKey: ['all-products-commissions'],
    queryFn: async () => {
      const res = await productsApi.getAll({ limit: 500 });
      return Array.isArray(res.data.data) ? res.data.data : Array.isArray(res.data) ? res.data : [];
    },
    enabled: !!commissionUserId,
  });

  const users = Array.isArray(data) ? data : [];

  // Дискриминация loading / error / empty / list (чистая, юнит-тестируемая —
  // hooks/useUsers.ts). «Нет сотрудников» рисуем ТОЛЬКО при подтверждённом
  // успехе и реально пустом списке — никогда при загрузке/ошибке/placeholder.
  const staffView = decideStaffListView({
    hasData: data !== undefined,
    isError,
    isSuccess,
    visibleCount: users.length,
  });

  // Section visibility (#071) is persisted via its own endpoint AFTER the user
  // row exists. On create we only have the id from the create response, so the
  // follow-up save is chained in onSuccess; on update we already have the id.
  const createMutation = useMutation({
    mutationFn: (d: any) => {
      // Strip the transient visibility carriers — they're persisted via their
      // own endpoints in onSuccess, never sent in the create body.
      const { __sectionVisibility, __itemVisibility, ...body } = d;
      void __sectionVisibility;
      void __itemVisibility;
      return usersApi.create(body);
    },
    onSuccess: async (res, variables) => {
      const newId = (res?.data as User | undefined)?.id;
      const sections = (variables as { __sectionVisibility?: SectionVisibilityMap }).__sectionVisibility;
      const items = (variables as { __itemVisibility?: ItemVisibilityMap }).__itemVisibility;
      if (newId && sections) {
        await usersApi.updateSectionVisibility(newId, mapToSections(sections)).catch(() => {});
      }
      if (newId && items) {
        await usersApi.updateItemVisibility(newId, mapToItems(items)).catch(() => {});
      }
      queryClient.invalidateQueries({ queryKey: ['users'] });
      Alert.alert('Готово', 'Сотрудник создан');
      closeModal();
    },
    onError: (err: any) => Alert.alert('Ошибка', err?.response?.data?.message || 'Ошибка создания'),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: any;
      __sectionVisibility?: SectionVisibilityMap;
      __itemVisibility?: ItemVisibilityMap;
      __permissions?: UserPermissions;
    }) => usersApi.update(id, data),
    onSuccess: async (_res, variables) => {
      const sections = variables.__sectionVisibility;
      if (sections) {
        await usersApi.updateSectionVisibility(variables.id, mapToSections(sections)).catch(() => {});
      }
      const items = variables.__itemVisibility;
      if (items) {
        await usersApi.updateItemVisibility(variables.id, mapToItems(items)).catch(() => {});
      }
      // Action permissions go through the DEDICATED endpoint (self-lockout
      // guard + per-user auth-cache drop) rather than the generic update body.
      // A failure here is non-destructive — the rest of the profile already
      // saved — so surface the server message but DON'T lose the other fields.
      let permError: string | null = null;
      const permissions = variables.__permissions;
      if (permissions) {
        try {
          await usersApi.updatePermissions(variables.id, permissions);
        } catch (e: any) {
          permError = e?.response?.data?.message || 'Не удалось сохранить права доступа';
        }
      }
      queryClient.invalidateQueries({ queryKey: ['users'] });
      if (permError) {
        haptic('error');
        Alert.alert('Права доступа не сохранены', permError);
        // Keep the modal open so the owner can correct the toggle and retry —
        // the rest of the profile is already persisted.
        return;
      }
      haptic('success');
      Alert.alert('Готово', 'Сотрудник обновлён');
      closeModal();
    },
    onError: (err: any) => Alert.alert('Ошибка', err?.response?.data?.message || 'Ошибка обновления'),
  });

  // remove() no longer hard-deletes — it SOFT-DISMISSES (moves the employee
  // to «Уволенные», restorable within a year). Invalidate the dismissed-list
  // count too so the Сотрудники entry point stays in sync.
  const deleteMutation = useMutation({
    mutationFn: (id: string) => usersApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.invalidateQueries({ queryKey: ['users-all'] });
      queryClient.invalidateQueries({ queryKey: ['users-dismissed'] });
      Alert.alert('Готово', 'Сотрудник перемещён в «Уволенные»');
    },
    onError: (err: any) => Alert.alert('Ошибка', err?.response?.data?.message || 'Ошибка увольнения'),
  });

  const saveCommissionsMutation = useMutation({
    mutationFn: ({ userId, data }: { userId: string; data: any }) => usersApi.setProductCommissions(userId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      Alert.alert('Готово', 'Настройки комиссий сохранены');
      setCommissionUserId(null);
    },
    onError: (err: any) => Alert.alert('Ошибка', err?.response?.data?.message || 'Ошибка сохранения'),
  });

  // ── Role templates ─────────────────────────────────────────────────────────
  // Server gate is director/admin/superadmin — match it so the gated endpoint is
  // never hit by a plain `user_management` admin who'd just get a 403. The query
  // is lazy (only fetches while the «Применить роль» sheet is open) so opening an
  // employee for a quick toggle costs no extra request.
  const canManageTemplates =
    currentUser?.role === 'director' || currentUser?.role === 'admin' || currentUser?.role === 'superadmin';

  const {
    data: templates = [],
    isLoading: templatesLoading,
    isError: templatesError,
    refetch: refetchTemplates,
  } = useQuery({
    queryKey: ['permission-templates'],
    queryFn: () => permissionTemplatesApi.list(),
    select: (res) => (Array.isArray(res.data) ? res.data : []),
    enabled: canManageTemplates && templatesSheetOpen,
  });

  // Save the CURRENT matrix as a named template. Sparse-friendly: persists the
  // full canonical map (every key) so applying it later is deterministic.
  const createTemplateMutation = useMutation({
    mutationFn: (name: string) =>
      // UserPermissions is a fixed-key boolean object — structurally a
      // Record<string, boolean> but lacks the index signature TS wants, so
      // widen through `unknown` (the values are all booleans, safe).
      permissionTemplatesApi.create({
        name,
        permissions: form.permissions as unknown as Record<string, boolean>,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['permission-templates'] });
      haptic('success');
      Alert.alert('Готово', 'Роль сохранена. Её можно применить к любому сотруднику.');
      setNameModalMode(null);
      setTemplateNameDraft('');
    },
    onError: (err: any) => {
      haptic('error');
      Alert.alert('Ошибка', err?.response?.data?.message || 'Не удалось сохранить роль');
    },
  });

  const renameTemplateMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => permissionTemplatesApi.update(id, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['permission-templates'] });
      haptic('success');
      setNameModalMode(null);
      setRenamingTemplate(null);
      setTemplateNameDraft('');
    },
    onError: (err: any) => {
      haptic('error');
      Alert.alert('Ошибка', err?.response?.data?.message || 'Не удалось переименовать роль');
    },
  });

  const deleteTemplateMutation = useMutation({
    mutationFn: (id: string) => permissionTemplatesApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['permission-templates'] });
      haptic('success');
      setDeleteTemplateId(null);
    },
    onError: (err: any) => {
      haptic('error');
      Alert.alert('Ошибка', err?.response?.data?.message || 'Не удалось удалить роль');
      setDeleteTemplateId(null);
    },
  });

  // Product search for commission modal.
  // MUST be declared before any early return to satisfy rules-of-hooks.
  const filteredProducts = useMemo(() => {
    const products = Array.isArray(allProducts) ? allProducts : [];
    const alreadyAdded = new Set(commissionItems.map((c) => c.productId));
    const available = products.filter((p) => !alreadyAdded.has(p.id));
    if (!productSearchText) return available;
    const q = productSearchText.toLowerCase();
    return available.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.category && p.category.toLowerCase().includes(q)),
    );
  }, [allProducts, commissionItems, productSearchText]);

  // useCallback hooks MUST come before the early `if (!hasPermission)` return
  // below — rules-of-hooks demands every hook is called in the same order
  // on every render. Each handler is also passed into UserCard.memo, so
  // identity stability matters for the list re-render cost.
  const openEdit = useCallback((user: User) => {
    setEditingUser(user);
    setExpandedGroup(null);
    setPermissionsLoading(true);
    setForm({
      fullName: user.fullName,
      phone: user.phone ? formatPhone(user.phone) : '',
      password: '',
      role: user.role,
      salaryPercent: user.salaryPercent,
      productSalaryPercent: user.productSalaryPercent || 0,
      isActive: user.isActive,
      hiddenFromSchedule: !!user.hiddenFromSchedule,
      hiddenEverywhere: !!user.hiddenEverywhere,
      permissions: { ...defaultPermissions, ...user.permissions },
      // Seed from whatever the list payload already carries (avoids a flash of
      // wrong toggles); the authoritative overrides are then refetched below.
      sectionVisibility: toVisibilityMap(user.sectionVisibility),
      itemVisibility: toItemVisibilityMap(user.itemVisibility),
    });
    setModalOpen(true);
    // 071 / 073 — fetch the authoritative per-section AND per-item overrides for
    // this employee. The list endpoint may omit them; these guarantee the
    // toggles reflect the stored state. Failure is non-fatal — we keep the
    // optimistic seed above.
    usersApi
      .getSectionVisibility(user.id)
      .then((res) => {
        setForm((prev) => ({ ...prev, sectionVisibility: toVisibilityMap(res.data) }));
      })
      .catch(() => {});
    usersApi
      .getItemVisibility(user.id)
      .then((res) => {
        setForm((prev) => ({ ...prev, itemVisibility: toItemVisibilityMap(res.data) }));
      })
      .catch(() => {});
    // Action permissions — load the AUTHORITATIVE stored map from the dedicated
    // endpoint (the list payload's `permissions` may be partial/empty for an
    // existing master). Merge over defaults so every canonical key has a value.
    usersApi
      .getPermissions(user.id)
      .then((res) => {
        setForm((prev) => ({ ...prev, permissions: { ...defaultPermissions, ...res.data } }));
      })
      .catch(() => {})
      .finally(() => setPermissionsLoading(false));
  }, []);

  const openCommissions = useCallback(async (user: User) => {
    setCommissionUserId(user.id);
    setCommissionUserName(user.fullName);
    try {
      const res = await usersApi.getProductCommissions(user.id);
      const data = res.data;
      setGlobalProductPercent(data.productSalaryPercent || 0);
      setCommissionItems(data.items || []);
    } catch {
      setGlobalProductPercent(user.productSalaryPercent || 0);
      setCommissionItems([]);
    }
  }, []);

  const handleAvatarChange = useCallback(
    async (userId: string) => {
      try {
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.8,
        });
        if (result.canceled || !result.assets?.length) return;
        const asset = result.assets[0];
        const filename = asset.fileName || `avatar_${userId}.jpg`;
        const uploadRes = await uploadsApi.upload(asset.uri, filename);
        const uploadedUrl = uploadRes.data.url;
        await usersApi.update(userId, { avatar: uploadedUrl } as any);
        queryClient.invalidateQueries({ queryKey: ['users'] });
        Alert.alert('Готово', 'Аватар обновлён');
      } catch (err: any) {
        Alert.alert('Ошибка', err?.response?.data?.message || 'Не удалось загрузить аватар');
      }
    },
    [queryClient],
  );

  // Stable delete-trigger so UserCard.memo holds across other UI toggles.
  const triggerDelete = useCallback((userId: string) => setDeleteId(userId), []);

  if (!hasPermission('user_management')) {
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Сотрудники" onBack={() => navigation.goBack()} />
        <EmptyState title="Нет доступа" description="У вас нет прав для управления сотрудниками" />
      </View>
    );
  }

  const openCreate = () => {
    setEditingUser(null);
    setExpandedGroup(null);
    setForm({ ...emptyForm, itemVisibility: defaultItemVisibility() });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingUser(null);
    setExpandedGroup(null);
    setForm({ ...emptyForm, itemVisibility: defaultItemVisibility() });
  };

  const handleSubmit = () => {
    if (!form.fullName.trim()) {
      Alert.alert('Ошибка', 'Введите ФИО');
      return;
    }
    if (!form.phone.trim()) {
      Alert.alert('Ошибка', 'Введите телефон');
      return;
    }
    if (!editingUser && !form.password) {
      Alert.alert('Ошибка', 'Введите пароль');
      return;
    }

    const payload: any = {
      fullName: form.fullName,
      phone: form.phone,
      role: form.role,
      salaryPercent: Number(form.salaryPercent),
      productSalaryPercent: Number(form.productSalaryPercent) || 0,
      isActive: form.isActive,
      hiddenFromSchedule: form.hiddenFromSchedule,
      hiddenEverywhere: form.hiddenEverywhere,
    };

    if (!editingUser) {
      payload.password = form.password;
      // On CREATE there is no id yet, so the dedicated permissions endpoint
      // can't run — the create body's `permissions` field seeds the new user's
      // map (backend accepts it). Section + item visibility ride along via the
      // `__*` carriers and are persisted in onSuccess once the id exists.
      payload.permissions = form.permissions;
      createMutation.mutate({
        ...payload,
        __sectionVisibility: form.sectionVisibility,
        __itemVisibility: form.itemVisibility,
      });
    } else {
      if (form.password) payload.password = form.password;
      // On EDIT the action-permissions map is saved through the DEDICATED
      // endpoint (self-lockout guard + auth-cache drop) via `__permissions`,
      // NOT the generic update body — so it's intentionally omitted from
      // `payload`. Owner-class users render a read-only note (the server
      // bypasses their map), so we skip the permissions PATCH entirely for them
      // — nothing the owner could change. Final client-side self-lockout net:
      // editing your OWN account can never drop `user_management`.
      const editsOwnAccount = editingUser.id === currentUser?.id;
      const permissions: UserPermissions | undefined = editedIsOwnerClass
        ? undefined
        : editsOwnAccount
          ? { ...form.permissions, user_management: true }
          : form.permissions;
      updateMutation.mutate({
        id: editingUser.id,
        data: payload,
        __sectionVisibility: form.sectionVisibility,
        __itemVisibility: form.itemVisibility,
        __permissions: permissions,
      });
    }
  };

  // Whether the owner is editing THEIR OWN account — drives the self-lockout
  // pin on `user_management` (can't strip the right that gates this screen).
  const editingSelf = !!editingUser && editingUser.id === currentUser?.id;

  // The edited user holds an owner-class role (superadmin/director/admin) →
  // server bypasses the permission map entirely. The matrix renders a read-only
  // note instead of toggles for these.
  const editedIsOwnerClass = OWNER_CLASS_ROLES.has(form.role);

  // Toggle one action permission. `user_management` is pinned ON when editing
  // your own account (self-lockout). No-op for owner-class users (read-only).
  const togglePermission = (key: PermissionKey) => {
    if (editedIsOwnerClass) return;
    if (key === 'user_management' && editingSelf) return;
    haptic('select');
    setForm((prev) => ({
      ...prev,
      permissions: { ...prev.permissions, [key]: !prev.permissions[key] },
    }));
  };

  // Role preset: fill the whole matrix from ROLE_PERMISSION_DEFAULTS, then let
  // the owner tweak before saving. Never strips your own user_management.
  const applyPermissionPreset = (role: UserRole) => {
    if (editedIsOwnerClass) return;
    haptic('impact');
    const preset = permissionsFromRoleDefaults(role);
    setForm((prev) => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        ...preset,
        ...(editingSelf ? { user_management: true } : null),
      },
    }));
  };

  // ── Role-template actions ──────────────────────────────────────────────────
  // «Сохранить как роль» → open the inline name prompt in create mode.
  const openSaveAsTemplate = () => {
    if (editedIsOwnerClass) return;
    haptic('tap');
    setRenamingTemplate(null);
    setTemplateNameDraft('');
    setNameModalMode('create');
  };

  // Confirm the name prompt: branch create vs rename. Trimmed-empty guarded.
  const submitTemplateName = () => {
    const name = templateNameDraft.trim();
    if (!name) {
      Alert.alert('Ошибка', 'Введите название роли');
      return;
    }
    if (nameModalMode === 'rename' && renamingTemplate) {
      renameTemplateMutation.mutate({ id: renamingTemplate.id, name });
    } else {
      createTemplateMutation.mutate(name);
    }
  };

  // «Применить роль» → open the picker sheet (also the manage hub).
  const openTemplatesSheet = () => {
    if (editedIsOwnerClass) return;
    haptic('tap');
    setTemplatesSheetOpen(true);
  };

  // Apply a template: fill the local matrix from its saved map, then close the
  // sheet so the owner reviews the loaded toggles and saves through the normal
  // (self-lockout-protected) path — exactly like a role preset, so the matrix
  // and the eventual server write never diverge. Editing-self keeps
  // user_management pinned on. Works identically for a brand-new unsaved user.
  const applyTemplate = (tpl: PermissionTemplate) => {
    if (editedIsOwnerClass) return;
    haptic('impact');
    const next = permissionsFromTemplate(tpl.permissions);
    setForm((prev) => ({
      ...prev,
      permissions: {
        ...prev.permissions,
        ...next,
        ...(editingSelf ? { user_management: true } : null),
      },
    }));
    setTemplatesSheetOpen(false);
    Alert.alert('Роль загружена', `«${tpl.name}» применена к матрице. Нажмите «Сохранить», чтобы записать.`);
  };

  // Open the name prompt in rename mode for an existing template.
  const openRenameTemplate = (tpl: PermissionTemplate) => {
    haptic('tap');
    setRenamingTemplate(tpl);
    setTemplateNameDraft(tpl.name);
    setNameModalMode('rename');
  };

  const toggleSection = (key: SectionKey) => {
    setForm((prev) => ({
      ...prev,
      sectionVisibility: { ...prev.sectionVisibility, [key]: !prev.sectionVisibility[key] },
    }));
  };

  // The user being edited holds an owner role → its access-control / billing
  // items can't be hidden (self-lockout guard; mirrors AuthContext).
  const editedIsOwner = form.role === 'director' || form.role === 'superadmin';

  // Toggle a single item. Protected items on an owner-role user are pinned on.
  const toggleItem = (itemKey: string) => {
    if (editedIsOwner && OWNER_PROTECTED_ITEM_KEYS.has(itemKey)) return;
    setForm((prev) => ({
      ...prev,
      itemVisibility: { ...prev.itemVisibility, [itemKey]: !prev.itemVisibility[itemKey] },
    }));
  };

  // Master toggle for a whole group: flip every item in it to `value`, but
  // never force-hide an owner's protected items.
  const toggleItemGroup = (sectionKey: SectionKey, value: boolean) => {
    setForm((prev) => {
      const next = { ...prev.itemVisibility };
      for (const k of ITEM_KEYS[sectionKey] as readonly string[]) {
        if (!value && editedIsOwner && OWNER_PROTECTED_ITEM_KEYS.has(k)) continue;
        next[k] = value;
      }
      return { ...prev, itemVisibility: next };
    });
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['users'] });
    setRefreshing(false);
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const isDirectorOrSuperadmin = currentUser?.role === 'director' || currentUser?.role === 'superadmin';

  if (isLoading) return <LoadingSpinner />;

  const getRoleBadge = (role: string) => {
    const key = roleBadgeMap[role] || 'gray';
    const map = getBadgeColors(palette.mode);
    const badge = map[key] || map.gray;
    return badge;
  };

  const addCommissionProduct = (product: Product) => {
    setCommissionItems((prev) => [
      ...prev,
      {
        productId: product.id,
        productName: product.name,
        percent: 10,
        sellPrice: product.sellPrice,
        costPrice: product.costPrice,
      },
    ]);
    setShowAddProduct(false);
    setProductSearchText('');
  };

  const removeCommissionItem = (productId: string) => {
    setCommissionItems((prev) => prev.filter((c) => c.productId !== productId));
  };

  const updateCommissionPercent = (productId: string, percent: number) => {
    setCommissionItems((prev) => prev.map((c) => (c.productId === productId ? { ...c, percent } : c)));
  };

  const handleSaveCommissions = () => {
    if (!commissionUserId) return;
    saveCommissionsMutation.mutate({
      userId: commissionUserId,
      data: {
        productSalaryPercent: globalProductPercent,
        items: commissionItems.map((c) => ({ productId: c.productId, percent: c.percent })),
      },
    });
  };

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title="Сотрудники"
        subtitle={users.length ? `Всего: ${users.length}` : undefined}
        onBack={() => navigation.goBack()}
        trailing={
          <TouchableOpacity onPress={openCreate} style={styles.addBtn}>
            <Ionicons name="add" size={20} color={colors.white} />
          </TouchableOpacity>
        }
      />

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + spacing[4] }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
        }
      >
        {staffView === 'list' ? (
          users.map((user, idx) => {
            const badge = getRoleBadge(user.role);
            const canDelete = user.id !== currentUser?.id && user.role !== 'superadmin' && user.role !== 'director';
            return (
              <UserCard
                key={user.id}
                user={user}
                index={idx}
                isDirectorOrSuperadmin={isDirectorOrSuperadmin}
                canDelete={canDelete}
                badge={badge}
                roleLabel={roleLabels[user.role] || user.role}
                avatarUrl={getImageUrl(user.avatar)}
                onEdit={openEdit}
                onCommissions={openCommissions}
                onAvatarChange={handleAvatarChange}
                onDelete={triggerDelete}
              />
            );
          })
        ) : staffView === 'error' ? (
          // Ошибка без кэша (например, окно деплоя) — НЕ «Нет сотрудников» (это
          // вводит в заблуждение), а явная ошибка с «Повторить». Список не
          // выглядит пустым из-за сбоя сети.
          <EmptyState
            title="Не удалось загрузить"
            description="Проверьте соединение и потяните вниз или нажмите «Повторить»"
            action={{ label: 'Повторить', onPress: () => refetch() }}
          />
        ) : staffView === 'empty' ? (
          // Единственное легальное «пусто»: запрос ['users'] подтверждённо
          // успешен и сотрудников реально нет.
          <EmptyState
            title="Нет сотрудников"
            description="Добавьте первого сотрудника"
            action={{ label: 'Добавить', onPress: openCreate }}
          />
        ) : (
          // 'skeleton' — placeholder/stale без подтверждения: спиннер, НЕ «пусто».
          <LoadingSpinner />
        )}
      </ScrollView>

      {/* Create/Edit Modal */}
      <Modal visible={modalOpen} onClose={closeModal} title={editingUser ? 'Редактировать' : 'Новый сотрудник'}>
        <ScrollView contentContainerStyle={styles.formContent} showsVerticalScrollIndicator={false}>
          <View style={styles.formField}>
            <Text style={[styles.formLabel, { color: palette.text.secondary }]}>ФИО</Text>
            <TextInput
              value={form.fullName}
              onChangeText={(v) => setForm({ ...form, fullName: v })}
              style={[
                styles.formInput,
                { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
              ]}
              placeholder="Иванов Иван Иванович"
              placeholderTextColor={palette.text.tertiary}
            />
          </View>

          <View style={styles.formField}>
            <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Телефон (логин)</Text>
            {/* Phone mask shared with LoginScreen — user types digits,
                formatPhone re-formats to +7 (XXX) XXX-XX-XX live. */}
            <TextInput
              value={form.phone}
              onChangeText={(v) => setForm({ ...form, phone: formatPhone(v.replace(/\D/g, '')) })}
              style={[
                styles.formInput,
                { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
              ]}
              placeholder="+7 (___) ___-__-__"
              placeholderTextColor={palette.text.tertiary}
              keyboardType="phone-pad"
              autoComplete="tel"
            />
          </View>

          <View style={styles.formField}>
            <Text style={[styles.formLabel, { color: palette.text.secondary }]}>
              {editingUser ? 'Новый пароль (пустой = не менять)' : 'Пароль'}
            </Text>
            <TextInput
              value={form.password}
              onChangeText={(v) => setForm({ ...form, password: v })}
              style={[
                styles.formInput,
                { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
              ]}
              placeholder={editingUser ? 'Новый пароль' : 'Введите пароль'}
              placeholderTextColor={palette.text.tertiary}
              secureTextEntry
            />
          </View>

          <View style={styles.formField}>
            <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Роль</Text>
            <View style={styles.roleRow}>
              {[UserRole.DIRECTOR, UserRole.ADMIN, UserRole.MASTER].map((r) => (
                <TouchableOpacity
                  key={r}
                  style={[
                    styles.roleChip,
                    { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
                    form.role === r && styles.roleChipActive,
                  ]}
                  onPress={() => setForm({ ...form, role: r })}
                >
                  <Text
                    style={[
                      styles.roleChipText,
                      { color: palette.text.secondary },
                      form.role === r && styles.roleChipTextActive,
                    ]}
                  >
                    {roleLabels[r] || r}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={{ flexDirection: 'row', gap: spacing[3] }}>
            <View style={[styles.formField, { flex: 1 }]}>
              <Text style={[styles.formLabel, { color: palette.text.secondary }]}>% от услуг</Text>
              <TextInput
                value={String(form.salaryPercent)}
                onChangeText={(v) => setForm({ ...form, salaryPercent: Number(v) || 0 })}
                style={[
                  styles.formInput,
                  {
                    backgroundColor: palette.bg.muted,
                    borderColor: palette.border.subtle,
                    color: palette.text.primary,
                  },
                ]}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={palette.text.tertiary}
              />
            </View>
            <View style={[styles.formField, { flex: 1 }]}>
              <Text style={[styles.formLabel, { color: palette.text.secondary }]}>% от товаров</Text>
              <TextInput
                value={String(form.productSalaryPercent)}
                onChangeText={(v) => setForm({ ...form, productSalaryPercent: Number(v) || 0 })}
                style={[
                  styles.formInput,
                  {
                    backgroundColor: palette.bg.muted,
                    borderColor: palette.border.subtle,
                    color: palette.text.primary,
                  },
                ]}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={palette.text.tertiary}
              />
            </View>
          </View>

          <View style={styles.switchRow}>
            <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Активен</Text>
            <Switch
              value={form.isActive}
              onValueChange={(v) => setForm({ ...form, isActive: v })}
              trackColor={{ false: palette.border.strong, true: colors.primary[400] }}
              thumbColor={form.isActive ? colors.primary[600] : palette.bg.muted}
            />
          </View>

          {/* Visibility — only director/admin/superadmin can change who is
              hidden from the schedule grid / rating and who is hidden
              everywhere (incl. master selection in Касса). */}
          {isDirectorOrSuperadmin && (
            <View
              style={[
                styles.visibilityGroup,
                { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
              ]}
            >
              <View style={styles.visibilityRow}>
                <View style={styles.visibilityTextWrap}>
                  <Text style={[styles.visibilityTitle, { color: palette.text.primary }]}>
                    Скрыть из графика и рейтинга
                  </Text>
                </View>
                <Switch
                  value={form.hiddenFromSchedule}
                  onValueChange={(v) => setForm({ ...form, hiddenFromSchedule: v })}
                  trackColor={{ false: palette.border.strong, true: colors.primary[400] }}
                  thumbColor={form.hiddenFromSchedule ? colors.primary[600] : palette.bg.card}
                />
              </View>

              <View style={[styles.visibilityDivider, { backgroundColor: palette.border.subtle }]} />

              <View style={styles.visibilityRow}>
                <View style={styles.visibilityTextWrap}>
                  <Text style={[styles.visibilityTitle, { color: palette.text.primary }]}>Скрыть везде</Text>
                  <Text style={[styles.visibilitySub, { color: palette.text.tertiary }]}>
                    Сотрудник не появится в списках, и на него нельзя будет создать чек в Кассе.
                  </Text>
                </View>
                <Switch
                  value={form.hiddenEverywhere}
                  onValueChange={(v) => setForm({ ...form, hiddenEverywhere: v })}
                  trackColor={{ false: palette.border.strong, true: colors.primary[400] }}
                  thumbColor={form.hiddenEverywhere ? colors.primary[600] : palette.bg.card}
                />
              </View>
            </View>
          )}

          {/* Section visibility (#071) — owner picks which top-level «Ещё»
              groups this employee sees. Director/superadmin only, same as the
              hidden-from-schedule controls above. */}
          {isDirectorOrSuperadmin && (
            <View style={styles.formField}>
              <Text style={[styles.formLabel, { color: palette.text.secondary, marginBottom: spacing[2] }]}>
                Видимость разделов
              </Text>
              <Text style={[styles.sectionVisHint, { color: palette.text.tertiary }]}>
                Выключенные разделы не появятся у сотрудника в меню «Ещё».
              </Text>
              <View
                style={[
                  styles.visibilityGroup,
                  { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, marginTop: spacing[2] },
                ]}
              >
                {SECTION_DEFS.map((section, idx) => (
                  <React.Fragment key={section.key}>
                    {idx > 0 && <View style={[styles.visibilityDivider, { backgroundColor: palette.border.subtle }]} />}
                    <View style={styles.visibilityRow}>
                      <View style={styles.visibilityTextWrap}>
                        <Text style={[styles.visibilityTitle, { color: palette.text.primary }]}>{section.label}</Text>
                        <Text style={[styles.visibilitySub, { color: palette.text.tertiary }]}>
                          {section.description}
                        </Text>
                      </View>
                      <Switch
                        value={form.sectionVisibility[section.key]}
                        onValueChange={() => toggleSection(section.key)}
                        trackColor={{ false: palette.border.strong, true: colors.primary[400] }}
                        thumbColor={form.sectionVisibility[section.key] ? colors.primary[600] : palette.bg.card}
                      />
                    </View>
                  </React.Fragment>
                ))}
              </View>
            </View>
          )}

          {/* Item visibility (#073) — granular per-row control UNDER the group
              level above. Each group expands to per-item toggles + a master
              toggle for the whole group. Director/superadmin only. */}
          {isDirectorOrSuperadmin && (
            <View style={styles.formField}>
              <Text style={[styles.formLabel, { color: palette.text.secondary, marginBottom: spacing[2] }]}>
                Видимость подразделов
              </Text>
              <Text style={[styles.sectionVisHint, { color: palette.text.tertiary }]}>
                Точечно скройте отдельные пункты внутри разделов. Раскройте группу, чтобы настроить каждый пункт.
              </Text>
              <View
                style={[
                  styles.visibilityGroup,
                  { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, marginTop: spacing[2] },
                ]}
              >
                {ITEM_GROUP_DEFS.map((group, gIdx) => {
                  const onCount = group.items.filter((it) => form.itemVisibility[it.key]).length;
                  const allOn = onCount === group.items.length;
                  const expanded = expandedGroup === group.sectionKey;
                  // When the parent SECTION is hidden, the whole group is gone
                  // from the employee's menu regardless of item toggles — surface
                  // that so the owner isn't confused why nothing shows.
                  const sectionHidden = !form.sectionVisibility[group.sectionKey];
                  return (
                    <React.Fragment key={group.sectionKey}>
                      {gIdx > 0 && (
                        <View style={[styles.visibilityDivider, { backgroundColor: palette.border.subtle }]} />
                      )}
                      <View style={styles.itemGroupHeader}>
                        <TouchableOpacity
                          style={styles.itemGroupTitleWrap}
                          onPress={() => setExpandedGroup(expanded ? null : group.sectionKey)}
                          activeOpacity={0.6}
                          accessibilityRole="button"
                          accessibilityLabel={`${group.label}, ${expanded ? 'свернуть' : 'развернуть'}`}
                        >
                          <Ionicons
                            name={expanded ? 'chevron-down' : 'chevron-forward'}
                            size={16}
                            color={palette.text.tertiary}
                          />
                          <View style={styles.visibilityTextWrap}>
                            <Text style={[styles.visibilityTitle, { color: palette.text.primary }]}>{group.label}</Text>
                            <Text style={[styles.visibilitySub, { color: palette.text.tertiary }]}>
                              {sectionHidden ? 'Раздел скрыт целиком' : `Показано ${onCount} из ${group.items.length}`}
                            </Text>
                          </View>
                        </TouchableOpacity>
                        <Switch
                          value={allOn}
                          onValueChange={(v) => toggleItemGroup(group.sectionKey, v)}
                          trackColor={{ false: palette.border.strong, true: colors.primary[400] }}
                          thumbColor={allOn ? colors.primary[600] : palette.bg.card}
                        />
                      </View>

                      {expanded &&
                        group.items.map((it) => {
                          const pinned = editedIsOwner && OWNER_PROTECTED_ITEM_KEYS.has(it.key);
                          const value = pinned ? true : !!form.itemVisibility[it.key];
                          return (
                            <View key={it.key} style={styles.itemSubRow}>
                              <Text style={[styles.itemSubLabel, { color: palette.text.secondary }]} numberOfLines={1}>
                                {it.label}
                                {pinned ? '  (всегда доступно владельцу)' : ''}
                              </Text>
                              <Switch
                                value={value}
                                disabled={pinned}
                                onValueChange={() => toggleItem(it.key)}
                                trackColor={{ false: palette.border.strong, true: colors.primary[400] }}
                                thumbColor={value ? colors.primary[600] : palette.bg.card}
                              />
                            </View>
                          );
                        })}
                    </React.Fragment>
                  );
                })}
              </View>
            </View>
          )}

          {/* ── Права доступа (action-permission matrix) ──────────────────────
              SEPARATE from «Видимость разделов/подразделов» above: visibility
              controls which menu rows the user SEES; this controls which server
              actions the user may DO. Loaded via usersApi.getPermissions, saved
              via usersApi.updatePermissions (self-lockout-protected). */}
          <View style={styles.formField}>
            <Text style={[styles.formLabel, { color: palette.text.secondary, marginBottom: spacing[2] }]}>
              Права доступа
            </Text>
            <Text style={[styles.sectionVisHint, { color: palette.text.tertiary }]}>
              Что сотрудник может ДЕЛАТЬ в приложении. Это не то же самое, что видимость разделов в меню.
            </Text>

            {editedIsOwnerClass ? (
              // Owner-class roles bypass the permission map on the server — show
              // a read-only note instead of toggles (matches the bypass).
              <View
                style={[
                  styles.permOwnerNote,
                  { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
                ]}
              >
                <Ionicons name="shield-checkmark" size={18} color={colors.primary[600]} />
                <Text style={[styles.permOwnerNoteText, { color: palette.text.secondary }]}>
                  {roleLabels[form.role] || form.role} имеет все права автоматически. Отдельная настройка не требуется.
                </Text>
              </View>
            ) : (
              <>
                {/* Role presets — fill the toggles from a role's defaults. */}
                <View style={styles.presetRow}>
                  {PERMISSION_PRESETS.map((preset) => (
                    <TouchableOpacity
                      key={preset.role}
                      style={[
                        styles.presetChip,
                        { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
                      ]}
                      onPress={() => applyPermissionPreset(preset.role)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`Применить шаблон прав: ${preset.label}`}
                    >
                      <Ionicons name="sparkles-outline" size={13} color={colors.primary[600]} />
                      <Text style={[styles.presetChipText, { color: colors.primary[700] }]}>{preset.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* Role templates — saved, named permission blueprints. Distinct
                    from the quick role-defaults presets above: these are the
                    owner's OWN saved roles, applied to / managed across
                    employees. Director/admin/superadmin only (server gate). */}
                {canManageTemplates && (
                  <View style={styles.templateActionRow}>
                    <TouchableOpacity
                      style={[
                        styles.templateActionBtn,
                        { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
                      ]}
                      onPress={openSaveAsTemplate}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel="Сохранить текущие права как роль"
                    >
                      <Ionicons name="bookmark-outline" size={14} color={palette.text.secondary} />
                      <Text style={[styles.templateActionText, { color: palette.text.secondary }]}>
                        Сохранить как роль
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[
                        styles.templateActionBtn,
                        { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
                      ]}
                      onPress={openTemplatesSheet}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel="Применить сохранённую роль"
                    >
                      <Ionicons name="albums-outline" size={14} color={palette.text.secondary} />
                      <Text style={[styles.templateActionText, { color: palette.text.secondary }]}>Применить роль</Text>
                    </TouchableOpacity>
                  </View>
                )}

                {permissionsLoading ? (
                  <View style={styles.permLoading}>
                    <ActivityIndicator size="small" color={colors.primary[600]} />
                  </View>
                ) : (
                  PERMISSION_GROUP_DEFS.map((group) => (
                    <View
                      key={group.title}
                      style={[
                        styles.permGroup,
                        { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
                      ]}
                    >
                      <View style={[styles.permGroupHeader, { borderBottomColor: palette.border.subtle }]}>
                        <Ionicons name={group.icon} size={14} color={palette.text.secondary} />
                        <Text style={[styles.permGroupTitle, { color: palette.text.secondary }]}>{group.title}</Text>
                      </View>
                      {group.keys.map((key) => {
                        // Self-lockout: editing your OWN account can't strip the
                        // permission that gates this very screen.
                        const pinned = key === 'user_management' && editingSelf;
                        const value = pinned ? true : !!form.permissions[key];
                        const hint = PERMISSION_HINTS[key];
                        return (
                          <View key={key} style={styles.permSwitchRow}>
                            <View style={styles.permSwitchTextWrap}>
                              <Text style={[styles.permLabel, { color: palette.text.primary }]}>
                                {PERMISSION_LABELS[key]}
                              </Text>
                              {pinned ? (
                                <Text style={[styles.permRowHint, { color: palette.text.tertiary }]}>
                                  Нельзя снять у себя — иначе потеряете доступ к этому экрану.
                                </Text>
                              ) : hint ? (
                                <Text style={[styles.permRowHint, { color: palette.text.tertiary }]}>{hint}</Text>
                              ) : null}
                            </View>
                            <Switch
                              value={value}
                              disabled={pinned}
                              onValueChange={() => togglePermission(key)}
                              trackColor={{ false: palette.border.strong, true: colors.primary[400] }}
                              thumbColor={value ? colors.primary[600] : palette.bg.card}
                            />
                          </View>
                        );
                      })}
                    </View>
                  ))
                )}
              </>
            )}
          </View>

          <View style={[styles.formActions, { borderTopColor: palette.border.subtle }]}>
            <TouchableOpacity style={[styles.cancelBtn, { borderColor: palette.border.strong }]} onPress={closeModal}>
              <Text style={[styles.cancelBtnText, { color: palette.text.secondary }]}>Отмена</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} disabled={isSaving}>
              {isSaving ? (
                <ActivityIndicator color={colors.white} size="small" />
              ) : (
                <Text style={styles.submitBtnText}>{editingUser ? 'Сохранить' : 'Создать'}</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>

        {/* ── Templates picker / manage sheet ────────────────────────────────
            Opened by «Применить роль». Tapping a row loads it into the matrix
            (applyTemplate). Each row also exposes rename + delete. Nested inside
            the edit Modal so it overlays the open employee form. */}
        <Modal visible={templatesSheetOpen} onClose={() => setTemplatesSheetOpen(false)} title="Роли">
          {templatesLoading ? (
            <View style={styles.permLoading}>
              <ActivityIndicator size="small" color={colors.primary[600]} />
            </View>
          ) : templatesError ? (
            <View style={styles.templatesStateWrap}>
              <Ionicons name="cloud-offline-outline" size={28} color={palette.text.tertiary} />
              <Text style={[styles.templatesStateText, { color: palette.text.secondary }]}>
                Не удалось загрузить роли
              </Text>
              <TouchableOpacity
                style={[styles.templatesRetryBtn, { borderColor: palette.border.strong }]}
                onPress={() => refetchTemplates()}
              >
                <Text style={[styles.cancelBtnText, { color: palette.text.secondary }]}>Повторить</Text>
              </TouchableOpacity>
            </View>
          ) : templates.length === 0 ? (
            <View style={styles.templatesStateWrap}>
              <Ionicons name="albums-outline" size={28} color={palette.text.tertiary} />
              <Text style={[styles.templatesStateText, { color: palette.text.secondary }]}>
                Пока нет сохранённых ролей
              </Text>
              <Text style={[styles.templatesStateHint, { color: palette.text.tertiary }]}>
                Настройте права сотрудника и нажмите «Сохранить как роль», чтобы создать первую.
              </Text>
            </View>
          ) : (
            <View style={{ gap: spacing[2] }}>
              <Text style={[styles.sectionVisHint, { color: palette.text.tertiary, marginBottom: spacing[1] }]}>
                Нажмите на роль, чтобы загрузить её права в матрицу. Затем сохраните сотрудника.
              </Text>
              {templates.map((tpl) => {
                const grantedCount = PERMISSION_KEYS.filter((k) => tpl.permissions[k] === true).length;
                return (
                  <View
                    key={tpl.id}
                    style={[
                      styles.templateRow,
                      { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
                    ]}
                  >
                    <TouchableOpacity
                      style={styles.templateRowMain}
                      onPress={() => applyTemplate(tpl)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`Применить роль ${tpl.name}`}
                    >
                      <View style={[styles.templateRowIcon, { backgroundColor: colors.primary[50] }]}>
                        <Ionicons name="shield-half-outline" size={16} color={colors.primary[600]} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[styles.templateRowName, { color: palette.text.primary }]} numberOfLines={1}>
                          {tpl.name}
                        </Text>
                        <Text style={[styles.templateRowSub, { color: palette.text.tertiary }]}>
                          {grantedCount} {grantedCount === 1 ? 'право' : grantedCount < 5 ? 'права' : 'прав'}
                        </Text>
                      </View>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.templateRowAction}
                      onPress={() => openRenameTemplate(tpl)}
                      accessibilityRole="button"
                      accessibilityLabel={`Переименовать роль ${tpl.name}`}
                    >
                      <Ionicons name="pencil-outline" size={16} color={palette.text.secondary} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.templateRowAction}
                      onPress={() => {
                        haptic('warning');
                        setDeleteTemplateId(tpl.id);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`Удалить роль ${tpl.name}`}
                    >
                      <Ionicons name="trash-outline" size={16} color={colors.red[500]} />
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          )}
        </Modal>

        {/* ── Name prompt (create / rename) ─────────────────────────────────
            Cross-platform replacement for Alert.prompt (iOS-only). One modal,
            two modes driven by nameModalMode. */}
        <Modal
          visible={nameModalMode !== null}
          onClose={() => {
            setNameModalMode(null);
            setRenamingTemplate(null);
            setTemplateNameDraft('');
          }}
          title={nameModalMode === 'rename' ? 'Переименовать роль' : 'Новая роль'}
        >
          <View style={styles.formField}>
            <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Название роли</Text>
            <TextInput
              value={templateNameDraft}
              onChangeText={setTemplateNameDraft}
              style={[
                styles.formInput,
                { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
              ]}
              placeholder="Напр. Старший мастер"
              placeholderTextColor={palette.text.tertiary}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={submitTemplateName}
            />
            {nameModalMode === 'create' && (
              <Text style={[styles.sectionVisHint, { color: palette.text.tertiary, marginTop: spacing[2] }]}>
                Сохранит текущий набор прав из матрицы как роль, которую можно применять к сотрудникам.
              </Text>
            )}
          </View>
          <View style={[styles.formActions, { borderTopColor: palette.border.subtle }]}>
            <TouchableOpacity
              style={[styles.cancelBtn, { borderColor: palette.border.strong }]}
              onPress={() => {
                setNameModalMode(null);
                setRenamingTemplate(null);
                setTemplateNameDraft('');
              }}
            >
              <Text style={[styles.cancelBtnText, { color: palette.text.secondary }]}>Отмена</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.submitBtn}
              onPress={submitTemplateName}
              disabled={createTemplateMutation.isPending || renameTemplateMutation.isPending}
            >
              {createTemplateMutation.isPending || renameTemplateMutation.isPending ? (
                <ActivityIndicator color={colors.white} size="small" />
              ) : (
                <Text style={styles.submitBtnText}>Сохранить</Text>
              )}
            </TouchableOpacity>
          </View>
        </Modal>
      </Modal>

      {/* Product Commission Modal */}
      <Modal
        visible={!!commissionUserId}
        onClose={() => setCommissionUserId(null)}
        title={`Комиссии — ${commissionUserName?.split(' ')[0]}`}
      >
        <ScrollView
          contentContainerStyle={{ gap: spacing[4], paddingBottom: spacing[4] }}
          showsVerticalScrollIndicator={false}
        >
          {/* Global product percent */}
          <View style={styles.commGlobalCard}>
            <View style={styles.commGlobalHeader}>
              <Ionicons name="layers-outline" size={18} color={colors.blue[600]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.commGlobalTitle}>% со всех товаров</Text>
                <Text style={styles.commGlobalSub}>Процент с чистой прибыли от продажи любого товара</Text>
              </View>
            </View>
            <View style={styles.commPercentRow}>
              <TextInput
                value={String(globalProductPercent)}
                onChangeText={(v) => setGlobalProductPercent(Number(v) || 0)}
                style={styles.commPercentInput}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={palette.text.tertiary}
              />
              <Text style={styles.commPercentSign}>%</Text>
            </View>
          </View>

          {/* Individual products */}
          <View style={styles.commSection}>
            <View style={styles.commSectionHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.commSectionTitle, { color: palette.text.primary }]}>Акционные товары</Text>
                <Text style={[styles.commSectionSub, { color: palette.text.tertiary }]}>
                  Отдельный % с прибыли для конкретных товаров
                </Text>
              </View>
              <TouchableOpacity
                style={styles.commAddBtn}
                onPress={() => {
                  setProductSearchText('');
                  setShowAddProduct(true);
                }}
              >
                <Ionicons name="add" size={18} color={colors.primary[600]} />
              </TouchableOpacity>
            </View>

            {commissionItems.length === 0 ? (
              <TouchableOpacity
                style={[styles.commEmptyAdd, { borderColor: palette.border.subtle }]}
                onPress={() => {
                  setProductSearchText('');
                  setShowAddProduct(true);
                }}
              >
                <Ionicons name="gift-outline" size={20} color={palette.text.tertiary} />
                <Text style={[styles.commEmptyText, { color: palette.text.tertiary }]}>Добавить акционный товар</Text>
              </TouchableOpacity>
            ) : (
              commissionItems.map((item) => {
                const profit = item.sellPrice - item.costPrice;
                const bonus = Math.round(profit * (item.percent / 100));
                return (
                  <View
                    key={item.productId}
                    style={[styles.commItem, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.commItemName, { color: palette.text.primary }]} numberOfLines={1}>
                        {item.productName}
                      </Text>
                      <Text style={[styles.commItemInfo, { color: palette.text.tertiary }]}>
                        Цена: {formatMoney(item.sellPrice)} · Прибыль: {formatMoney(profit)}
                      </Text>
                    </View>
                    <View style={styles.commItemRight}>
                      <View style={styles.commItemPercentRow}>
                        <TextInput
                          value={String(item.percent)}
                          onChangeText={(v) => updateCommissionPercent(item.productId, Number(v) || 0)}
                          style={[
                            styles.commItemPercentInput,
                            {
                              backgroundColor: palette.bg.muted,
                              borderColor: palette.border.subtle,
                              color: palette.text.primary,
                            },
                          ]}
                          keyboardType="numeric"
                        />
                        <Text style={[styles.commItemPercentSign, { color: palette.text.secondary }]}>%</Text>
                      </View>
                      <Text style={styles.commItemBonus}>+{formatMoney(bonus)}</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.commItemDelete}
                      onPress={() => removeCommissionItem(item.productId)}
                    >
                      <Ionicons name="close-circle-outline" size={18} color={colors.red[400]} />
                    </TouchableOpacity>
                  </View>
                );
              })
            )}
          </View>

          {/* Save */}
          <View style={[styles.formActions, { borderTopColor: palette.border.subtle }]}>
            <TouchableOpacity
              style={[styles.cancelBtn, { borderColor: palette.border.strong }]}
              onPress={() => setCommissionUserId(null)}
            >
              <Text style={[styles.cancelBtnText, { color: palette.text.secondary }]}>Отмена</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.submitBtn}
              onPress={handleSaveCommissions}
              disabled={saveCommissionsMutation.isPending}
            >
              {saveCommissionsMutation.isPending ? (
                <ActivityIndicator color={colors.white} size="small" />
              ) : (
                <Text style={styles.submitBtnText}>Сохранить</Text>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>

        {/* Add product sub-modal */}
        <Modal visible={showAddProduct} onClose={() => setShowAddProduct(false)} title="Выбрать товар">
          <TextInput
            value={productSearchText}
            onChangeText={setProductSearchText}
            style={[
              styles.formInput,
              {
                marginBottom: spacing[3],
                backgroundColor: palette.bg.muted,
                borderColor: palette.border.subtle,
                color: palette.text.primary,
              },
            ]}
            placeholder="Поиск товара..."
            placeholderTextColor={palette.text.tertiary}
            autoFocus
          />
          <ScrollView style={{ maxHeight: 300 }} keyboardShouldPersistTaps="handled">
            {filteredProducts.map((p) => (
              <TouchableOpacity
                key={p.id}
                style={[styles.productPickerItem, { borderBottomColor: palette.border.subtle }]}
                onPress={() => addCommissionProduct(p)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.productPickerName, { color: palette.text.primary }]} numberOfLines={1}>
                    {p.name}
                  </Text>
                  <Text style={[styles.productPickerPrice, { color: palette.text.tertiary }]}>
                    {formatMoney(p.sellPrice)} · Прибыль: {formatMoney(p.sellPrice - p.costPrice)}
                  </Text>
                </View>
                <Ionicons name="add-circle" size={24} color={colors.primary[500]} />
              </TouchableOpacity>
            ))}
            {productSearchText && filteredProducts.length === 0 && (
              <Text style={{ textAlign: 'center', color: colors.gray[400], paddingVertical: spacing[4] }}>
                Ничего не найдено
              </Text>
            )}
          </ScrollView>
        </Modal>
      </Modal>

      <ConfirmDialog
        visible={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) deleteMutation.mutate(deleteId);
          setDeleteId(null);
        }}
        title="Уволить сотрудника?"
        message="Сотрудник переместится в «Уволенные» и пропадёт из списков, графика и Кассы. В течение года его можно вернуть."
        confirmText="Уволить"
        variant="danger"
      />

      <ConfirmDialog
        visible={!!deleteTemplateId}
        onClose={() => setDeleteTemplateId(null)}
        onConfirm={() => {
          if (deleteTemplateId) deleteTemplateMutation.mutate(deleteTemplateId);
        }}
        title="Удалить роль?"
        message="Роль будет удалена безвозвратно. Сотрудники, к которым она уже применена, сохранят свои права без изменений."
        confirmText="Удалить"
        variant="danger"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.primary[600],
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[8] },
  // User card
  userCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: colors.gray[100],
    padding: spacing[4],
    shadowColor: colors.black,
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
    gap: spacing[3],
  },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarImage: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: colors.gray[100] },
  avatarText: { fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  avatarWrap: { position: 'relative' },
  avatarCameraBtn: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.primary[600],
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.white,
  },
  userName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900], flexShrink: 1 },
  roleBadge: { paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: borderRadius.full },
  roleBadgeText: { fontSize: 11, fontWeight: fontWeight.medium },
  userPhone: { fontSize: fontSize.sm, color: colors.gray[500] },
  userDivider: { color: colors.gray[300] },
  statusText: { fontSize: fontSize.xs, fontWeight: fontWeight.medium },
  // Action row
  actionRow: {
    flexDirection: 'row',
    gap: spacing[2],
    borderTopWidth: 1,
    borderTopColor: colors.gray[100],
    paddingTop: spacing[3],
  },
  actionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primary[50],
    borderWidth: 1,
    borderColor: colors.primary[200],
  },
  actionChipText: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: colors.primary[700] },
  // Form
  formContent: { gap: spacing[1], paddingBottom: spacing[4] },
  formField: { marginBottom: spacing[4] },
  formLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.gray[700],
    marginBottom: spacing[1.5],
  },
  formInput: {
    backgroundColor: colors.gray[50],
    borderWidth: 1,
    borderColor: colors.gray[300],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[2.5],
    fontSize: fontSize.sm,
    color: colors.gray[900],
  },
  roleRow: { flexDirection: 'row', gap: spacing[2] },
  roleChip: {
    flex: 1,
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.gray[300],
    alignItems: 'center',
    backgroundColor: colors.gray[50],
  },
  roleChipActive: { backgroundColor: colors.primary[50], borderColor: colors.primary[500] },
  roleChipText: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: colors.gray[500] },
  roleChipTextActive: { color: colors.primary[700], fontWeight: fontWeight.semibold },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[4] },
  // Visibility toggles
  visibilityGroup: {
    marginBottom: spacing[4],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    paddingHorizontal: spacing[3.5],
  },
  visibilityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
    paddingVertical: spacing[3],
  },
  visibilityTextWrap: { flex: 1, minWidth: 0 },
  visibilityTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  visibilitySub: { fontSize: 11, lineHeight: 15, marginTop: 2 },
  visibilityDivider: { height: 1 },
  sectionVisHint: { fontSize: 11, lineHeight: 15 },
  // Item-visibility accordion (#073)
  itemGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
    paddingVertical: spacing[3],
  },
  itemGroupTitleWrap: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  itemSubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
    paddingVertical: spacing[2],
    paddingLeft: spacing[6],
  },
  itemSubLabel: { flex: 1, minWidth: 0, fontSize: fontSize.sm },
  // Permissions — grouped
  permGroup: {
    marginBottom: spacing[3],
    backgroundColor: colors.gray[50],
    borderRadius: borderRadius.xl,
    padding: spacing[3],
    borderWidth: 1,
    borderColor: colors.gray[100],
  },
  permGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[2],
    paddingBottom: spacing[1.5],
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[200],
  },
  permGroupTitle: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.gray[600],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  permLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
  // Action-permission matrix (switch-per-key) — the toggle row, its caption,
  // role-preset chips, the owner-class read-only note, and the load spinner.
  permSwitchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
    paddingVertical: spacing[2.5],
  },
  permSwitchTextWrap: { flex: 1, minWidth: 0 },
  permRowHint: { fontSize: 11, lineHeight: 15, marginTop: 2 },
  presetRow: { flexDirection: 'row', gap: spacing[2], marginTop: spacing[3], marginBottom: spacing[1] },
  presetChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },
  presetChipText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  // Role-template actions («Сохранить как роль» / «Применить роль») + the
  // templates picker sheet rows and its empty/error states.
  templateActionRow: { flexDirection: 'row', gap: spacing[2], marginTop: spacing[2], marginBottom: spacing[1] },
  templateActionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },
  templateActionText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  templateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    paddingLeft: spacing[3],
    paddingRight: spacing[1],
  },
  templateRowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[3],
  },
  templateRowIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  templateRowName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  templateRowSub: { fontSize: 11, marginTop: 2 },
  templateRowAction: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  templatesStateWrap: { alignItems: 'center', justifyContent: 'center', gap: spacing[2], paddingVertical: spacing[8] },
  templatesStateText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  templatesStateHint: { fontSize: 12, lineHeight: 17, textAlign: 'center', paddingHorizontal: spacing[4] },
  templatesRetryBtn: {
    marginTop: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },
  permLoading: { paddingVertical: spacing[6], alignItems: 'center', justifyContent: 'center' },
  permOwnerNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    marginTop: spacing[3],
    padding: spacing[3.5],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
  },
  permOwnerNoteText: { flex: 1, fontSize: fontSize.sm, lineHeight: 19 },
  formActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[3],
    paddingTop: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colors.gray[200],
  },
  cancelBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.gray[300],
  },
  cancelBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
  submitBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primary[600],
  },
  submitBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.white },
  // Commission modal
  commGlobalCard: {
    backgroundColor: colors.blue[50],
    borderRadius: borderRadius.xl,
    padding: spacing[4],
    borderWidth: 1,
    borderColor: colors.blue[200],
    gap: spacing[3],
  },
  commGlobalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2.5] },
  commGlobalTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  commGlobalSub: { fontSize: 11, color: colors.gray[500], marginTop: 2 },
  commPercentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  commPercentInput: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.blue[300],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[2.5],
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
    width: 80,
    textAlign: 'center',
  },
  commPercentSign: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.gray[500] },
  commSection: { gap: spacing[2] },
  commSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  commSectionTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  commSectionSub: { fontSize: 11, color: colors.gray[500] },
  commAddBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  commEmptyAdd: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[4],
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.gray[200],
    borderRadius: borderRadius.xl,
  },
  commEmptyText: { fontSize: fontSize.sm, color: colors.gray[400] },
  commItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    padding: spacing[3],
    borderWidth: 1,
    borderColor: colors.gray[100],
  },
  commItemName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900] },
  commItemInfo: { fontSize: 11, color: colors.gray[400], marginTop: 2 },
  commItemRight: { alignItems: 'flex-end' },
  commItemPercentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  commItemPercentInput: {
    backgroundColor: colors.gray[50],
    borderWidth: 1,
    borderColor: colors.gray[200],
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
    width: 50,
    textAlign: 'center',
  },
  commItemPercentSign: { fontSize: fontSize.sm, color: colors.gray[500] },
  commItemBonus: { fontSize: 12, fontWeight: fontWeight.bold, color: colors.green[600], marginTop: 2 },
  commItemDelete: { padding: spacing[1] },
  // Product picker for commissions
  productPickerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[100],
  },
  productPickerName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900] },
  productPickerPrice: { fontSize: 11, color: colors.gray[400], marginTop: 2 },
});
