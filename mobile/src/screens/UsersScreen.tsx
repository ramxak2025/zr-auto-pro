import React, { useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, TextInput, StyleSheet,
  RefreshControl, ActivityIndicator, Alert, Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { usersApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import { colors, fontSize, fontWeight, borderRadius, spacing, badgeColors } from '../theme';
import type { User, UserPermissions } from '../../../shared/types';
import { UserRole } from '../../../shared/types';

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

const permissionLabels: Record<keyof UserPermissions, string> = {
  checks_view: 'Просмотр заказ-нарядов',
  checks_create: 'Создание заказ-нарядов',
  checks_edit: 'Редактирование заказ-нарядов',
  checks_delete: 'Удаление заказ-нарядов',
  profit_view: 'Просмотр прибыли',
  clients_view: 'Просмотр клиентов',
  clients_edit: 'Редактирование клиентов',
  warehouse_access: 'Доступ к складу',
  suppliers_access: 'Доступ к поставщикам',
  financial_reports: 'Финансовые отчёты',
  export_data: 'Экспорт данных',
  user_management: 'Управление сотрудниками',
};

const defaultPermissions: UserPermissions = {
  checks_view: true, checks_create: true, checks_edit: false, checks_delete: false,
  profit_view: false, clients_view: true, clients_edit: false,
  warehouse_access: false, suppliers_access: false, financial_reports: false,
  export_data: false, user_management: false,
};

interface UserForm {
  fullName: string;
  phone: string;
  password: string;
  role: UserRole;
  salaryPercent: number;
  isActive: boolean;
  permissions: UserPermissions;
}

const emptyForm: UserForm = {
  fullName: '', phone: '', password: '',
  role: UserRole.MASTER, salaryPercent: 0, isActive: true,
  permissions: { ...defaultPermissions },
};

export default function UsersScreen() {
  const navigation = useNavigation<any>();
  const { hasPermission, user: currentUser } = useAuth();
  const queryClient = useQueryClient();

  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [form, setForm] = useState<UserForm>({ ...emptyForm });
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.getAll(),
    select: (res) => res.data as User[],
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

  if (!hasPermission('user_management')) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <EmptyState title="Нет доступа" description="У вас нет прав для управления сотрудниками" />
      </SafeAreaView>
    );
  }

  const openCreate = () => {
    setEditingUser(null);
    setForm({ ...emptyForm });
    setModalOpen(true);
  };

  const openEdit = (user: User) => {
    setEditingUser(user);
    setForm({
      fullName: user.fullName,
      phone: user.phone || '',
      password: '',
      role: user.role,
      salaryPercent: user.salaryPercent,
      isActive: user.isActive,
      permissions: { ...defaultPermissions, ...user.permissions },
    });
    setModalOpen(true);
  };

  const closeModal = () => { setModalOpen(false); setEditingUser(null); setForm({ ...emptyForm }); };

  const handleSubmit = () => {
    if (!form.fullName.trim()) { Alert.alert('Ошибка', 'Введите ФИО'); return; }
    if (!form.phone.trim()) { Alert.alert('Ошибка', 'Введите телефон'); return; }
    if (!editingUser && !form.password) { Alert.alert('Ошибка', 'Введите пароль'); return; }

    const payload: any = {
      fullName: form.fullName,
      phone: form.phone,
      role: form.role,
      salaryPercent: Number(form.salaryPercent),
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
    setForm(prev => ({
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

  if (isLoading) return <LoadingSpinner />;

  const getRoleBadge = (role: string) => {
    const key = roleBadgeMap[role] || 'gray';
    const badge = badgeColors[key] || badgeColors.gray;
    return badge;
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← Назад</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Сотрудники</Text>
        <TouchableOpacity onPress={openCreate} style={styles.addBtn}>
          <Ionicons name="add" size={20} color={colors.white} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />}
      >
        {users.length === 0 ? (
          <EmptyState
            title="Нет сотрудников"
            description="Добавьте первого сотрудника"
            action={{ label: 'Добавить', onPress: openCreate }}
          />
        ) : (
          users.map(user => {
            const badge = getRoleBadge(user.role);
            const canDelete = user.id !== currentUser?.id && user.role !== 'superadmin' && user.role !== 'director';
            return (
              <TouchableOpacity key={user.id} style={styles.userCard} onPress={() => openEdit(user)} activeOpacity={0.7}>
                <View style={styles.userRow}>
                  <View style={[styles.avatar, { backgroundColor: badge.bg }]}>
                    <Text style={[styles.avatarText, { color: badge.text }]}>{user.fullName?.charAt(0) || 'U'}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                      <Text style={styles.userName} numberOfLines={1}>{user.fullName}</Text>
                      <View style={[styles.roleBadge, { backgroundColor: badge.bg }]}>
                        <Text style={[styles.roleBadgeText, { color: badge.text }]}>{roleLabels[user.role] || user.role}</Text>
                      </View>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginTop: 4 }}>
                      <Text style={styles.userPhone}>{user.phone}</Text>
                      <Text style={styles.userDivider}>|</Text>
                      <Text style={styles.userPhone}>{user.salaryPercent}%</Text>
                      <Text style={styles.userDivider}>|</Text>
                      {user.isActive ? (
                        <Text style={[styles.statusText, { color: colors.green[600] }]}>Активен</Text>
                      ) : (
                        <Text style={[styles.statusText, { color: colors.red[500] }]}>Неактивен</Text>
                      )}
                    </View>
                  </View>
                  <View style={{ flexDirection: 'row', gap: spacing[1] }}>
                    <TouchableOpacity style={styles.actionBtn} onPress={() => openEdit(user)}>
                      <Ionicons name="pencil-outline" size={16} color={colors.gray[400]} />
                    </TouchableOpacity>
                    {canDelete && (
                      <TouchableOpacity style={styles.actionBtn} onPress={() => setDeleteId(user.id)}>
                        <Ionicons name="trash-outline" size={16} color={colors.red[400]} />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {/* Create/Edit Modal */}
      <Modal visible={modalOpen} onClose={closeModal} title={editingUser ? 'Редактировать' : 'Новый сотрудник'}>
        <ScrollView contentContainerStyle={styles.formContent} showsVerticalScrollIndicator={false}>
          <View style={styles.formField}>
            <Text style={styles.formLabel}>ФИО</Text>
            <TextInput
              value={form.fullName}
              onChangeText={v => setForm({ ...form, fullName: v })}
              style={styles.formInput}
              placeholder="Иванов Иван Иванович"
              placeholderTextColor={colors.gray[400]}
            />
          </View>

          <View style={styles.formField}>
            <Text style={styles.formLabel}>Телефон (логин)</Text>
            <TextInput
              value={form.phone}
              onChangeText={v => setForm({ ...form, phone: v })}
              style={styles.formInput}
              placeholder="+7 (XXX) XXX-XX-XX"
              placeholderTextColor={colors.gray[400]}
              keyboardType="phone-pad"
            />
          </View>

          <View style={styles.formField}>
            <Text style={styles.formLabel}>{editingUser ? 'Новый пароль (пустой = не менять)' : 'Пароль'}</Text>
            <TextInput
              value={form.password}
              onChangeText={v => setForm({ ...form, password: v })}
              style={styles.formInput}
              placeholder={editingUser ? 'Новый пароль' : 'Введите пароль'}
              placeholderTextColor={colors.gray[400]}
              secureTextEntry
            />
          </View>

          <View style={styles.formField}>
            <Text style={styles.formLabel}>Роль</Text>
            <View style={styles.roleRow}>
              {[UserRole.DIRECTOR, UserRole.ADMIN, UserRole.MASTER].map(r => (
                <TouchableOpacity
                  key={r}
                  style={[styles.roleChip, form.role === r && styles.roleChipActive]}
                  onPress={() => setForm({ ...form, role: r })}
                >
                  <Text style={[styles.roleChipText, form.role === r && styles.roleChipTextActive]}>
                    {roleLabels[r] || r}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.formField}>
            <Text style={styles.formLabel}>% ставка от услуг</Text>
            <TextInput
              value={String(form.salaryPercent)}
              onChangeText={v => setForm({ ...form, salaryPercent: Number(v) || 0 })}
              style={styles.formInput}
              keyboardType="numeric"
            />
          </View>

          <View style={styles.switchRow}>
            <Text style={styles.formLabel}>Активен</Text>
            <Switch
              value={form.isActive}
              onValueChange={v => setForm({ ...form, isActive: v })}
              trackColor={{ false: colors.gray[300], true: colors.primary[400] }}
              thumbColor={form.isActive ? colors.primary[600] : colors.gray[100]}
            />
          </View>

          {/* Permissions */}
          <View style={styles.formField}>
            <Text style={styles.formLabel}>Права доступа</Text>
            <View style={styles.permGrid}>
              {(Object.keys(permissionLabels) as (keyof UserPermissions)[]).map(key => (
                <TouchableOpacity
                  key={key}
                  style={styles.permRow}
                  onPress={() => togglePermission(key)}
                >
                  <Ionicons
                    name={form.permissions[key] ? 'checkbox' : 'square-outline'}
                    size={20}
                    color={form.permissions[key] ? colors.primary[600] : colors.gray[400]}
                  />
                  <Text style={styles.permLabel}>{permissionLabels[key]}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.formActions}>
            <TouchableOpacity style={styles.cancelBtn} onPress={closeModal}>
              <Text style={styles.cancelBtnText}>Отмена</Text>
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

      <ConfirmDialog
        visible={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => { if (deleteId) deleteMutation.mutate(deleteId); setDeleteId(null); }}
        title="Удалить сотрудника"
        message="Вы уверены? Это действие нельзя отменить."
        confirmText="Удалить"
        variant="danger"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing[4], paddingVertical: spacing[3], backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.gray[200] },
  backText: { fontSize: fontSize.sm, color: colors.primary[600], fontWeight: fontWeight.medium },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.gray[900] },
  addBtn: { width: 36, height: 36, borderRadius: borderRadius.xl, backgroundColor: colors.primary[600], alignItems: 'center', justifyContent: 'center' },
  scrollContent: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[8] },
  userCard: { backgroundColor: colors.white, borderRadius: borderRadius['2xl'], borderWidth: 1, borderColor: colors.gray[100], padding: spacing[4], shadowColor: colors.black, shadowOpacity: 0.05, shadowRadius: 3, elevation: 2 },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  userName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900], flexShrink: 1 },
  roleBadge: { paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: borderRadius.full },
  roleBadgeText: { fontSize: 11, fontWeight: fontWeight.medium },
  userPhone: { fontSize: fontSize.sm, color: colors.gray[500] },
  userDivider: { color: colors.gray[300] },
  statusText: { fontSize: fontSize.xs, fontWeight: fontWeight.medium },
  actionBtn: { padding: spacing[1.5] },
  // Form
  formContent: { gap: spacing[1], paddingBottom: spacing[4] },
  formField: { marginBottom: spacing[4] },
  formLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700], marginBottom: spacing[1.5] },
  formInput: { backgroundColor: colors.gray[50], borderWidth: 1, borderColor: colors.gray[300], borderRadius: borderRadius.lg, paddingHorizontal: spacing[3.5], paddingVertical: spacing[2.5], fontSize: fontSize.sm, color: colors.gray[900] },
  roleRow: { flexDirection: 'row', gap: spacing[2] },
  roleChip: { flex: 1, paddingVertical: spacing[2.5], borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colors.gray[300], alignItems: 'center', backgroundColor: colors.gray[50] },
  roleChipActive: { backgroundColor: colors.primary[50], borderColor: colors.primary[500] },
  roleChipText: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: colors.gray[500] },
  roleChipTextActive: { color: colors.primary[700], fontWeight: fontWeight.semibold },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[4] },
  permGrid: { gap: spacing[2], marginTop: spacing[1] },
  permRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  permLabel: { fontSize: fontSize.sm, color: colors.gray[700] },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing[3], paddingTop: spacing[4], borderTopWidth: 1, borderTopColor: colors.gray[200] },
  cancelBtn: { paddingHorizontal: spacing[4], paddingVertical: spacing[2.5], borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colors.gray[300] },
  cancelBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
  submitBtn: { paddingHorizontal: spacing[4], paddingVertical: spacing[2.5], borderRadius: borderRadius.lg, backgroundColor: colors.primary[600] },
  submitBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.white },
});
