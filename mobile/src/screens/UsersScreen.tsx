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
import { usersApi, productsApi, uploadsApi } from '../api/services';
import { useRoles } from '../hooks/useRoles';
import { getImageUrl } from '../api/axios';
import { useAuth } from '../contexts/AuthContext';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import RateByMonthSheet from '../components/employee/RateByMonthSheet';
import { UserPointsSheet } from '../components/employee/UserPointsSheet';
import LoadingSpinner from '../components/LoadingSpinner';
import AnimatedCard from '../components/AnimatedCard';
import EmptyState from '../components/EmptyState';
import IosScreenHeader from '../components/IosScreenHeader';
import { useColors } from '../contexts/ThemeContext';
import { useShadow } from '../platform/iosSurface';
import { colors, fontSize, fontWeight, borderRadius, spacing, getBadgeColors } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { useUsers, decideStaffListView } from '../hooks/useUsers';
import { usePointAccess } from '../hooks/usePoints';
import { haptic } from '../platform/haptics';
import type { User, Product } from '../../../shared/types';
import { UserRole } from '../../../shared/types';
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

// ── ROLE-ONLY (консолидация 2026-07, Round 12) ──────────────────────────────
// Доступ сотрудника = его назначенная РОЛЬ (см. RoleEditorScreen). Персональные
// per-user права, шаблоны прав И тумблеры «Видимость разделов/подразделов»
// (071/073) удалены целиком: и права, и видимость пунктов меню «Ещё» определяет
// ТОЛЬКО матрица роли (hasPermission в MoreScreen, @RequirePermission на
// сервере). Здесь остаётся назначение роли (PATCH /users/:id { roleId }) +
// % зарплаты + служебные флаги (активен / скрыт из графика / скрыт везде).

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
  /**
   * ROLE-ONLY (консолидация 2026-07) — назначенная роль. null → «Без роли»
   * (легаси-дефолты строковой роли). Задана → эффективные права = flatten
   * матрицы роли. Уходит в PATCH /users/:id только если владелец трогал поле
   * (roleTouched): сохранение имени/% физически не способно сменить роль.
   */
  roleId: string | null;
  salaryPercent: number;
  productSalaryPercent: number;
  isActive: boolean;
  hiddenFromSchedule: boolean;
  hiddenEverywhere: boolean;
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
          <Ionicons name="key-outline" size={14} color={colors.primary[600]} />
          <Text style={styles.actionChipText}>Роль и доступ</Text>
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
  // Назначение роли доступно только в режиме редактирования (create-DTO на
  // сервере не принимает roleId) — новый сотрудник стартует «Без роли».
  roleId: null,
  salaryPercent: 0,
  productSalaryPercent: 0,
  isActive: true,
  hiddenFromSchedule: false,
  hiddenEverywhere: false,
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
  const { hasPermission, user: currentUser, refreshUser } = useAuth();
  const queryClient = useQueryClient();
  const tabBarHeight = useTabBarHeight();
  const palette = useColors();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  // 150 — шит «Ставка по месяцам» (смена ставки за прошлый/будущий месяц + история).
  const [rateSheetUser, setRateSheetUser] = useState<User | null>(null);
  // 163 — «Филиалы сотрудника»: на каких филиалах человек может работать.
  // Сохраняется СВОЕЙ ручкой (PUT /users/:id/points), а не вместе с формой:
  // это отдельное правило доступа, и снятие филиала мгновенно выкидывает
  // сотрудника из сессии — такое нельзя проводить «заодно» с правкой имени.
  const [pointsSheetUser, setPointsSheetUser] = useState<User | null>(null);
  const [form, setForm] = useState<UserForm>({ ...emptyForm });
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // ── Роль (ROLE-ONLY, консолидация 2026-07) ─────────────────────────────────
  // `roleSheetOpen` — шит выбора роли из поля «Роль» в edit-форме. `roleTouched`
  // — владелец РЕАЛЬНО менял роль в этой сессии редактирования; иначе roleId
  // вообще не отправляется (та же touched-семантика: сохранение имени/%/пароля
  // физически не способно сменить или снять роль).
  const [roleSheetOpen, setRoleSheetOpen] = useState(false);
  const [roleTouched, setRoleTouched] = useState(false);

  // Commission modal
  const [commissionUserId, setCommissionUserId] = useState<string | null>(null);
  const [commissionUserName, setCommissionUserName] = useState('');
  const [globalProductPercent, setGlobalProductPercent] = useState(0);
  const [commissionItems, setCommissionItems] = useState<CommissionItem[]>([]);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [productSearchText, setProductSearchText] = useState('');

  // ['users'] — общий слот, который пишут также login-prefetch и три вкладки
  // ScheduleScreen. Единая форма (`User[]`) через общий хук — см. hooks/useUsers.ts.
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

  const createMutation = useMutation({
    mutationFn: (d: any) => usersApi.create(d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      Alert.alert('Готово', 'Сотрудник создан');
      closeModal();
    },
    onError: (err: any) => Alert.alert('Ошибка', err?.response?.data?.message || 'Ошибка создания'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => usersApi.update(id, data),
    onSuccess: (_res, variables) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      // Правка СЕБЯ (например, смена собственной роли) меняет эффективные
      // права — рефетчим /auth/me, чтобы hasPermission-гейты обновились сразу.
      if (variables.id === currentUser?.id) void refreshUser();
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

  // ── Роли (ROLE-ONLY) ────────────────────────────────────────────────────────
  // Server gate is user_management (roles.controller, «права как в Битрикс24»):
  // матрица авторитетна, superadmin/director байпасятся внутри hasPermission,
  // admin — по эффективным правам из /auth/me. Роли — для пилюли «Роль» в
  // edit-форме и шита выбора. Ленивая: грузится только пока открыта форма
  // сотрудника (нужна, чтобы отрисовать ИМЯ уже назначенной роли, а не только
  // список в шите). Канонический хук useRoles — тот же слот ['roles'], что у
  // RolesScreen/RoleEditorScreen.
  const canManageRoles = hasPermission('user_management');
  // Настройка филиалов имеет смысл только у тенанта, где их больше одного
  // (одноточечный автосервис про филиалы не знает вовсе).
  const { multiPoint } = usePointAccess();
  const { data: rolesData } = useRoles(canManageRoles && modalOpen);
  const roles = Array.isArray(rolesData) ? rolesData : [];

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
    setRoleTouched(false);
    setRoleSheetOpen(false);
    setForm({
      fullName: user.fullName,
      phone: user.phone ? formatPhone(user.phone) : '',
      password: '',
      role: user.role,
      // ROLE-ONLY — назначенная роль из строки списка (users.getAll отдаёт role_id).
      // Не трогали → не отправляется, поэтому чуть устаревший seed безопасен.
      roleId: user.roleId ?? null,
      salaryPercent: user.salaryPercent,
      productSalaryPercent: user.productSalaryPercent || 0,
      isActive: user.isActive,
      hiddenFromSchedule: !!user.hiddenFromSchedule,
      hiddenEverywhere: !!user.hiddenEverywhere,
    });
    setModalOpen(true);
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
    setRoleTouched(false);
    setRoleSheetOpen(false);
    setForm({ ...emptyForm });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingUser(null);
    setRoleTouched(false);
    setRoleSheetOpen(false);
    setForm({ ...emptyForm });
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
      createMutation.mutate(payload);
    } else {
      if (form.password) payload.password = form.password;
      // ROLE-ONLY — роль уходит в generic-body PATCH /users/:id (contract:
      // UpdateUserRequest.roleId; null снимает роль), но ТОЛЬКО если владелец
      // реально менял поле в этой сессии (roleTouched). Нетронутое поле →
      // undefined → сервер роль не трогает: сохранение имени/%/пароля физически
      // не способно сменить или снять роль. Самолокаут (роль себе без
      // user_management) отбивает сервер — 400 покажется алертом onError.
      if (roleTouched) payload.roleId = form.roleId;
      updateMutation.mutate({ id: editingUser.id, data: payload });
    }
  };

  // ROLE-ONLY — имя назначенной роли для пилюли «Роль». Список ['roles'] грузится,
  // пока форма открыта; до его прихода честное «Загрузка…», не ложное «Без роли».
  const assignedRole = form.roleId ? roles.find((r) => r.id === form.roleId) : undefined;
  const assignedRoleName = form.roleId ? (assignedRole?.name ?? 'Загрузка…') : 'Без роли (как раньше)';

  // Выбор роли в шите: локально в форму + touched. Уходит на сервер только по
  // «Сохранить» (как все остальные поля формы).
  const pickRole = (roleId: string | null) => {
    haptic('select');
    setRoleTouched(true);
    setForm((prev) => ({ ...prev, roleId }));
    setRoleSheetOpen(false);
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
          <View style={styles.headerActions}>
            {/* Роли (ROLE-ONLY) — управление ролями-базами прав. Виден только
                owner-class (director/admin/superadmin) — тот же серверный гейт,
                что у GET /roles. */}
            {canManageRoles && (
              <TouchableOpacity
                onPress={() => {
                  haptic('tap');
                  navigation.navigate('Roles');
                }}
                style={[styles.rolesBtn, { backgroundColor: palette.bg.muted }]}
                accessibilityRole="button"
                accessibilityLabel="Роли"
              >
                <Ionicons name="key-outline" size={18} color={colors.primary[600]} />
              </TouchableOpacity>
            )}
            <TouchableOpacity onPress={openCreate} style={styles.addBtn}>
              <Ionicons name="add" size={20} color={colors.white} />
            </TouchableOpacity>
          </View>
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
            <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Тип</Text>
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

          {/* 150 — смена ставки задним числом / на будущее + история. Поля выше
              меняют ставку С ТЕКУЩЕГО месяца (как раньше). */}
          {editingUser ? (
            <TouchableOpacity
              style={[
                styles.rateByMonthLink,
                { borderColor: palette.border.subtle, backgroundColor: palette.bg.muted },
              ]}
              onPress={() => {
                haptic('tap');
                setRateSheetUser(editingUser);
              }}
              activeOpacity={0.72}
            >
              <Ionicons name="calendar-outline" size={15} color={palette.text.secondary} />
              <Text style={[styles.rateByMonthLinkText, { color: palette.text.primary }]}>Ставка по месяцам</Text>
              <Text style={[styles.rateByMonthLinkHint, { color: palette.text.tertiary }]}>
                прошлый / будущий месяц
              </Text>
              <Ionicons name="chevron-forward" size={14} color={palette.text.tertiary} />
            </TouchableOpacity>
          ) : null}

          {/* ── Филиалы сотрудника (163) ──────────────────────────────────
              «Настройка, на каких филиалах они могут работать» — требование
              владельца дословно. Только в режиме редактирования: у ещё не
              созданного сотрудника нет id, которому назначать доступ. */}
          {editingUser && canManageRoles && multiPoint ? (
            <TouchableOpacity
              style={[
                styles.rateByMonthLink,
                { borderColor: palette.border.subtle, backgroundColor: palette.bg.muted },
              ]}
              onPress={() => {
                haptic('tap');
                setPointsSheetUser(editingUser);
              }}
              activeOpacity={0.72}
              accessibilityRole="button"
              accessibilityLabel={`Филиалы сотрудника ${editingUser.fullName}`}
            >
              <Ionicons name="business-outline" size={15} color={palette.text.secondary} />
              <Text style={[styles.rateByMonthLinkText, { color: palette.text.primary }]}>Филиалы сотрудника</Text>
              <Text style={[styles.rateByMonthLinkHint, { color: palette.text.tertiary }]}>где может работать</Text>
              <Ionicons name="chevron-forward" size={14} color={palette.text.tertiary} />
            </TouchableOpacity>
          ) : null}

          <View style={styles.switchRow}>
            <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Активен</Text>
            <Switch
              value={form.isActive}
              onValueChange={(v) => setForm({ ...form, isActive: v })}
              trackColor={{ false: palette.border.strong, true: colors.primary[400] }}
              thumbColor={form.isActive ? colors.primary[600] : palette.bg.muted}
            />
          </View>

          {/* ── Роль и доступ (ROLE-ONLY, консолидация 2026-07) ────────────────
              Доступ сотрудника = его РОЛЬ. Никаких персональных тумблеров прав:
              чтобы дать особый набор, владелец редактирует РОЛЬ (кнопка «ключ» в
              шапке списка → RoleEditorScreen). Только owner-class (тот же гейт,
              что у GET /roles). Роль назначается только в режиме редактирования —
              create-DTO на сервере roleId не принимает. */}
          {canManageRoles && (
            <View style={styles.formField}>
              <Text style={[styles.formLabel, { color: palette.text.secondary, marginBottom: spacing[2] }]}>
                Роль и доступ
              </Text>
              {editingUser ? (
                <>
                  <View
                    style={[
                      styles.roleFieldCard,
                      { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
                    ]}
                  >
                    <View style={styles.roleFieldRow}>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[styles.visibilityTitle, { color: palette.text.primary }]}>Роль</Text>
                        <Text style={[styles.visibilitySub, { color: palette.text.tertiary }]}>
                          Определяет, что сотрудник может делать. Применится в течение ~30 секунд.
                        </Text>
                      </View>
                      <TouchableOpacity
                        style={[
                          styles.rolePill,
                          { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
                        ]}
                        onPress={() => {
                          haptic('tap');
                          setRoleSheetOpen(true);
                        }}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel={`Роль: ${assignedRoleName}. Изменить`}
                      >
                        <Ionicons
                          name={form.roleId ? 'key' : 'key-outline'}
                          size={13}
                          color={form.roleId ? colors.primary[600] : palette.text.tertiary}
                        />
                        <Text
                          style={[
                            styles.rolePillText,
                            { color: form.roleId ? colors.primary[700] : palette.text.secondary },
                          ]}
                          numberOfLines={1}
                        >
                          {assignedRoleName}
                        </Text>
                        <Ionicons name="chevron-expand-outline" size={13} color={palette.text.tertiary} />
                      </TouchableOpacity>
                    </View>
                  </View>
                  <TouchableOpacity
                    style={styles.roleEditHintRow}
                    onPress={() => {
                      haptic('tap');
                      navigation.navigate('Roles');
                    }}
                    activeOpacity={0.6}
                    accessibilityRole="button"
                    accessibilityLabel="Настроить, что может делать роль"
                  >
                    <Ionicons name="information-circle-outline" size={15} color={palette.text.tertiary} />
                    <Text style={[styles.roleEditHintText, { color: palette.text.tertiary }]}>
                      Чтобы изменить, что роль может делать — откройте «Роли» (иконка ключа в шапке). Изменения
                      применятся ко всем сотрудникам с этой ролью.
                    </Text>
                  </TouchableOpacity>
                </>
              ) : (
                <View
                  style={[
                    styles.roleCreateNote,
                    { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
                  ]}
                >
                  <Ionicons name="key-outline" size={18} color={colors.primary[600]} />
                  <Text style={[styles.roleCreateNoteText, { color: palette.text.secondary }]}>
                    Роль можно назначить после создания сотрудника — сохраните его и откройте снова.
                  </Text>
                </View>
              )}
            </View>
          )}

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

          {/* Round 12: тумблеры «Видимость разделов/подразделов» (071/073)
              удалены — они писали в мёртвые таблицы и НИЧЕГО не меняли у
              сотрудника (/auth/me их не возвращал). Видимость меню и права
              теперь определяет ТОЛЬКО роль — подсказка ведёт в «Роли». */}
          {isDirectorOrSuperadmin && (
            <TouchableOpacity
              style={[styles.roleCreateNote, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
              onPress={() => {
                haptic('tap');
                navigation.navigate('Roles');
              }}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Права и видимость разделов настраиваются в роли сотрудника. Открыть роли"
            >
              <Ionicons name="eye-outline" size={18} color={colors.primary[600]} />
              <Text style={[styles.roleCreateNoteText, { color: palette.text.secondary }]}>
                Права и видимость разделов настраиваются в роли сотрудника. Назначьте роль выше — или откройте «Роли»,
                чтобы изменить, что видит и может делать каждая роль.
              </Text>
              <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
            </TouchableOpacity>
          )}

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

        {/* ── Выбор роли (ROLE-ONLY) ─────────────────────────────────────────
            Открывается пилюлей «Роль». Системные + свои роли с бейджами, плюс
            «Без роли (как раньше)». Выбор пишется локально в форму (touched);
            на сервер уходит по «Сохранить». Nested в edit-Modal. */}
        <Modal visible={roleSheetOpen} onClose={() => setRoleSheetOpen(false)} title="Роль сотрудника">
          <View style={{ gap: spacing[2] }}>
            <Text style={[styles.sectionVisHint, { color: palette.text.tertiary, marginBottom: spacing[1] }]}>
              Роль — живая база прав: её изменения применяются ко всем сотрудникам на ней. Чтобы дать особый набор прав,
              создайте отдельную роль. Управление ролями — в шапке списка сотрудников.
            </Text>

            {/* «Без роли» — легаси-поведение (строковые дефолты роли). */}
            <TouchableOpacity
              style={[styles.roleOptionRow, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
              onPress={() => pickRole(null)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Без роли (как раньше)"
            >
              <View style={[styles.roleOptionIcon, { backgroundColor: palette.bg.card }]}>
                <Ionicons name="remove-circle-outline" size={16} color={palette.text.tertiary} />
              </View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.roleOptionName, { color: palette.text.primary }]}>Без роли (как раньше)</Text>
                <Text style={[styles.roleOptionSub, { color: palette.text.tertiary }]}>
                  Права — стандартные для типа сотрудника
                </Text>
              </View>
              {form.roleId === null && <Ionicons name="checkmark-circle" size={20} color={colors.primary[600]} />}
            </TouchableOpacity>

            {roles.map((role) => (
              <TouchableOpacity
                key={role.id}
                style={[
                  styles.roleOptionRow,
                  { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
                ]}
                onPress={() => pickRole(role.id)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Назначить роль ${role.name}`}
              >
                <View style={[styles.roleOptionIcon, { backgroundColor: palette.bg.card }]}>
                  <Ionicons
                    name={role.isSystem ? 'shield-checkmark-outline' : 'key-outline'}
                    size={16}
                    color={colors.primary[600]}
                  />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                    <Text style={[styles.roleOptionName, { color: palette.text.primary }]} numberOfLines={1}>
                      {role.name}
                    </Text>
                    {role.isSystem && (
                      <View style={[styles.roleOptionBadge, { backgroundColor: palette.bg.card }]}>
                        <Text style={[styles.roleOptionBadgeText, { color: palette.text.secondary }]}>Системная</Text>
                      </View>
                    )}
                  </View>
                  {!!role.description && (
                    <Text style={[styles.roleOptionSub, { color: palette.text.tertiary }]} numberOfLines={1}>
                      {role.description}
                    </Text>
                  )}
                </View>
                {form.roleId === role.id && <Ionicons name="checkmark-circle" size={20} color={colors.primary[600]} />}
              </TouchableOpacity>
            ))}

            {roles.length === 0 && (
              <View style={styles.templatesStateWrap}>
                <Ionicons name="key-outline" size={28} color={palette.text.tertiary} />
                <Text style={[styles.templatesStateText, { color: palette.text.secondary }]}>Роли ещё загружаются</Text>
                <Text style={[styles.templatesStateHint, { color: palette.text.tertiary }]}>
                  Если список не появился — проверьте соединение и откройте шит заново.
                </Text>
              </View>
            )}
          </View>
        </Modal>

        {/* ── Филиалы сотрудника (163) ─────────────────────────────────────
            Вложен в edit-Modal ТЕМ ЖЕ приёмом, что шит выбора роли выше: два
            RN <Modal> на одном уровне на iOS «съедают» друг друга при
            одновременной презентации, а вложенный показывается поверх
            родительского. В отличие от роли сохраняется СРАЗУ своей ручкой —
            это отдельное правило доступа, а не поле формы. */}
        {pointsSheetUser ? (
          <UserPointsSheet
            visible={!!pointsSheetUser}
            onClose={() => setPointsSheetUser(null)}
            userId={pointsSheetUser.id}
            userName={pointsSheetUser.fullName}
          />
        ) : null}
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

      {/* 150 — «Ставка по месяцам»: пересчёт выбранного месяца + история. */}
      {rateSheetUser ? (
        <RateByMonthSheet
          visible={!!rateSheetUser}
          onClose={() => setRateSheetUser(null)}
          userId={rateSheetUser.id}
          userName={rateSheetUser.fullName}
          currentSalaryPercent={rateSheetUser.salaryPercent || 0}
          currentProductPercent={rateSheetUser.productSalaryPercent || 0}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  // 150 — ссылка «Ставка по месяцам» под полями процентов.
  rateByMonthLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    marginBottom: spacing[4],
  },
  rateByMonthLinkText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  rateByMonthLinkHint: { flex: 1, fontSize: 11, textAlign: 'right' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  rolesBtn: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  // Роль (ROLE-ONLY): карточка поля, пилюля значения, строки шита выбора.
  roleFieldCard: {
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
  },
  roleFieldRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  rolePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    maxWidth: '55%',
    borderRadius: borderRadius.full,
    borderWidth: 1,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  rolePillText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, flexShrink: 1 },
  roleEditHintRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    marginTop: spacing[2],
    paddingHorizontal: spacing[1],
  },
  roleEditHintText: { flex: 1, fontSize: 11, lineHeight: 16 },
  roleCreateNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    padding: spacing[3.5],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
  },
  roleCreateNoteText: { flex: 1, fontSize: fontSize.sm, lineHeight: 19 },
  roleOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
  },
  roleOptionIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  roleOptionName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, flexShrink: 1 },
  roleOptionSub: { fontSize: 11, marginTop: 2 },
  roleOptionBadge: { paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: borderRadius.full },
  roleOptionBadgeText: { fontSize: 10, fontWeight: fontWeight.medium },
  templatesStateWrap: { alignItems: 'center', justifyContent: 'center', gap: spacing[2], paddingVertical: spacing[8] },
  templatesStateText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  templatesStateHint: { fontSize: 12, lineHeight: 17, textAlign: 'center', paddingHorizontal: spacing[4] },
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
