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
import { getImageUrl } from '../api/axios';
import { useAuth } from '../contexts/AuthContext';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import LoadingSpinner from '../components/LoadingSpinner';
import AnimatedCard from '../components/AnimatedCard';
import EmptyState from '../components/EmptyState';
import IosScreenHeader from '../components/IosScreenHeader';
import { useColors } from '../contexts/ThemeContext';
import { colors, fontSize, fontWeight, borderRadius, spacing, badgeColors } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import type { User, UserPermissions, Product } from '../../../shared/types';
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

// Grouped permissions for better UX
const permissionGroups: {
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  items: { key: keyof UserPermissions; label: string }[];
}[] = [
  {
    title: 'Заказ-наряды',
    icon: 'receipt-outline',
    items: [
      { key: 'checks_view', label: 'Просмотр' },
      { key: 'checks_create', label: 'Создание' },
      { key: 'checks_edit', label: 'Редактирование' },
      { key: 'checks_delete', label: 'Удаление' },
      { key: 'checks_change_datetime', label: 'Изменять дату/время' },
    ],
  },
  {
    title: 'Финансы',
    icon: 'wallet-outline',
    items: [
      { key: 'profit_view', label: 'Просмотр прибыли' },
      { key: 'financial_reports', label: 'Финансовые отчёты' },
      { key: 'salary_view', label: 'Просмотр зарплат' },
      { key: 'export_data', label: 'Экспорт данных' },
    ],
  },
  {
    title: 'Клиенты и склад',
    icon: 'people-outline',
    items: [
      { key: 'clients_view', label: 'Просмотр клиентов' },
      { key: 'clients_edit', label: 'Редактирование клиентов' },
      { key: 'warehouse_access', label: 'Доступ к складу' },
      { key: 'suppliers_access', label: 'Доступ к поставщикам' },
    ],
  },
  {
    title: 'Управление',
    icon: 'settings-outline',
    items: [
      { key: 'user_management', label: 'Управление сотрудниками' },
      { key: 'schedule_view', label: 'Расписание' },
      { key: 'marketing_access', label: 'Маркетинг' },
    ],
  },
];

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
  permissions: UserPermissions;
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
  return (
    <AnimatedCard
      index={index}
      style={[styles.userCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
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
  permissions: { ...defaultPermissions },
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

  // Commission modal
  const [commissionUserId, setCommissionUserId] = useState<string | null>(null);
  const [commissionUserName, setCommissionUserName] = useState('');
  const [globalProductPercent, setGlobalProductPercent] = useState(0);
  const [commissionItems, setCommissionItems] = useState<CommissionItem[]>([]);
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [productSearchText, setProductSearchText] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.getAll(),
    select: (res) => res.data as User[],
  });

  const { data: allProducts } = useQuery<Product[]>({
    queryKey: ['all-products-commissions'],
    queryFn: async () => {
      const res = await productsApi.getAll({ limit: 500 });
      return res.data.data || res.data;
    },
    enabled: !!commissionUserId,
  });

  const users = data ?? [];

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      Alert.alert('Готово', 'Сотрудник обновлён');
      closeModal();
    },
    onError: (err: any) => Alert.alert('Ошибка', err?.response?.data?.message || 'Ошибка обновления'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => usersApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      Alert.alert('Готово', 'Сотрудник удалён');
    },
    onError: (err: any) => Alert.alert('Ошибка', err?.response?.data?.message || 'Ошибка удаления'),
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

  // Product search for commission modal.
  // MUST be declared before any early return to satisfy rules-of-hooks.
  const filteredProducts = useMemo(() => {
    const products = allProducts || [];
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
    setForm({
      fullName: user.fullName,
      phone: user.phone ? formatPhone(user.phone) : '',
      password: '',
      role: user.role,
      salaryPercent: user.salaryPercent,
      productSalaryPercent: user.productSalaryPercent || 0,
      isActive: user.isActive,
      permissions: { ...defaultPermissions, ...user.permissions },
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
    setForm({ ...emptyForm });
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingUser(null);
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
      permissions: form.permissions,
    };

    if (!editingUser) {
      payload.password = form.password;
      createMutation.mutate(payload);
    } else {
      if (form.password) payload.password = form.password;
      updateMutation.mutate({ id: editingUser.id, data: payload });
    }
  };

  const togglePermission = (key: keyof UserPermissions) => {
    setForm((prev) => ({
      ...prev,
      permissions: { ...prev.permissions, [key]: !prev.permissions[key] },
    }));
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
    const badge = badgeColors[key] || badgeColors.gray;
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
        {users.length === 0 ? (
          <EmptyState
            title="Нет сотрудников"
            description="Добавьте первого сотрудника"
            action={{ label: 'Добавить', onPress: openCreate }}
          />
        ) : (
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
                  { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
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
                  { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
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

          {/* Permissions — grouped */}
          <View style={styles.formField}>
            <Text style={[styles.formLabel, { color: palette.text.secondary, marginBottom: spacing[3] }]}>
              Права доступа
            </Text>
            {permissionGroups.map((group) => (
              <View
                key={group.title}
                style={[styles.permGroup, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
              >
                <View style={[styles.permGroupHeader, { borderBottomColor: palette.border.subtle }]}>
                  <Ionicons name={group.icon} size={14} color={palette.text.secondary} />
                  <Text style={[styles.permGroupTitle, { color: palette.text.secondary }]}>{group.title}</Text>
                </View>
                {group.items.map((item) => (
                  <TouchableOpacity key={item.key} style={styles.permRow} onPress={() => togglePermission(item.key)}>
                    <Ionicons
                      name={form.permissions[item.key] ? 'checkbox' : 'square-outline'}
                      size={20}
                      color={form.permissions[item.key] ? colors.primary[600] : palette.text.tertiary}
                    />
                    <Text style={[styles.permLabel, { color: palette.text.primary }]}>{item.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ))}
          </View>

          <View style={[styles.formActions, { borderTopColor: palette.border.subtle }]}>
            <TouchableOpacity
              style={[styles.cancelBtn, { borderColor: palette.border.strong }]}
              onPress={closeModal}
            >
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
                <Text style={[styles.commEmptyText, { color: palette.text.tertiary }]}>
                  Добавить акционный товар
                </Text>
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
                      <Ionicons name="close-circle" size={18} color={colors.red[400]} />
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
        title="Удалить сотрудника"
        message="Вы уверены? Это действие нельзя отменить."
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
  permRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: spacing[1.5] },
  permLabel: { fontSize: fontSize.sm, color: colors.gray[700] },
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
