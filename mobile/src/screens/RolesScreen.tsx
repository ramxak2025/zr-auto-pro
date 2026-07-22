/**
 * RolesScreen — «Роли» (Bitrix24-style, миграция 114).
 *
 * Список ролей тенанта: секция «Системные» (сеяные «Мастер» / «Администратор» /
 * «Директор»; «Мастер»/«Администратор» настраиваются под свой автосервис через
 * copy-on-write, «Директор» — locked, только просмотр) и секция «Мои роли»
 * (кастомные). Карточка —
 * имя, описание (или сводка «Разрешено X из Y»), бейдж «Системная», счётчик
 * сотрудников на роли (считается локально из общего кэша ['users'] по
 * User.roleId — без отдельного эндпоинта) и chevron.
 *
 * Вход — кнопка «Роли» в шапке экрана Пользователи (UsersScreen). Живёт в
 * MoreStack → floating tab bar виден, back идёт Roles → Users → Ещё.
 *
 * Правила (двойной гейт — тот же серверный контракт roles.controller):
 *   • экран самогейтится до director/admin/superadmin — GET /roles для
 *     остальных 403;
 *   • системная «Мастер»/«Администратор» → RoleEditor редактируем (copy-on-write);
 *     «Директор» (locked) → read-only с кнопкой «Создать копию»;
 *   • своя роль → редактирование; ellipsis → Переименовать / Удалить;
 *   • удаление занятой роли → 400 { code: 'ROLE_HAS_USERS', count } → алерт
 *     «Сначала переназначьте N сотрудников» (текст приходит с сервера).
 */
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { rolesApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import { useShadow } from '../platform/iosSurface';
import { haptic } from '../platform/haptics';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { useRoles, ROLES_QUERY_KEY } from '../hooks/useRoles';
import { useUsers } from '../hooks/useUsers';
import { matrixSummary } from '../utils/roleMatrixEditor';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import IosScreenHeader from '../components/IosScreenHeader';
import { colors, fontSize, fontWeight, borderRadius, spacing, softTint } from '../theme';
import type { Role } from '../../../shared/types';

/** «5 сотрудников» / «1 сотрудник» / «3 сотрудника». */
function employeesLabel(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} сотрудник`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} сотрудника`;
  return `${n} сотрудников`;
}

interface RoleRowProps {
  role: Role;
  employeeCount: number;
  isLast: boolean;
  onPress: (role: Role) => void;
  onMenu?: (role: Role) => void;
}

/** Строка grouped-списка (iOS Settings-style): иконка, имя+бейдж, мета, chevron. */
function RoleRow({ role, employeeCount, isLast, onPress, onMenu }: RoleRowProps) {
  const palette = useColors();
  const iconBg = softTint(colors.primary[600], palette.mode);
  const summary = matrixSummary(role.matrix);
  const meta = [
    role.isSystem ? null : `Разрешено ${summary.granted} из ${summary.total}`,
    employeesLabel(employeeCount),
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <View>
      <TouchableOpacity
        style={styles.roleRow}
        onPress={() => onPress(role)}
        activeOpacity={0.6}
        accessibilityRole="button"
        accessibilityLabel={`Роль ${role.name}${role.isSystem ? ', системная' : ''}`}
      >
        <View style={[styles.roleIcon, { backgroundColor: iconBg }]}>
          <Ionicons
            name={role.isSystem ? 'shield-checkmark-outline' : 'key-outline'}
            size={17}
            color={colors.primary[600]}
          />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={styles.roleNameRow}>
            <Text style={[styles.roleName, { color: palette.text.primary }]} numberOfLines={1}>
              {role.name}
            </Text>
            {role.isSystem && (
              <View style={[styles.systemBadge, { backgroundColor: palette.bg.muted }]}>
                <Text style={[styles.systemBadgeText, { color: palette.text.secondary }]}>Системная</Text>
              </View>
            )}
          </View>
          {!!role.description && (
            <Text style={[styles.roleDescription, { color: palette.text.secondary }]} numberOfLines={1}>
              {role.description}
            </Text>
          )}
          <Text style={[styles.roleMeta, { color: palette.text.tertiary }]} numberOfLines={1}>
            {meta}
          </Text>
        </View>
        {onMenu && (
          <TouchableOpacity
            style={styles.menuBtn}
            onPress={() => onMenu(role)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Действия с ролью ${role.name}`}
          >
            <Ionicons name="ellipsis-horizontal" size={18} color={palette.text.tertiary} />
          </TouchableOpacity>
        )}
        <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
      </TouchableOpacity>
      {!isLast && <View style={[styles.rowDivider, { backgroundColor: palette.border.subtle }]} />}
    </View>
  );
}

export default function RolesScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const palette = useColors();
  const shadow = useShadow();
  const tabBarHeight = useTabBarHeight();
  const { hasPermission } = useAuth();

  // Тот же гейт, что на сервере (roles.controller → user_management): матрица
  // авторитетна, superadmin/director байпасятся внутри hasPermission.
  const canManage = hasPermission('user_management');

  const { data: rolesData, isLoading, isError, refetch } = useRoles(canManage);
  const roles = Array.isArray(rolesData) ? rolesData : [];

  // Счётчик сотрудников на роли — из общего кэша ['users'] (уже греется
  // login-prefetch'ем), никакого нового эндпоинта.
  const { data: usersData } = useUsers();
  const countByRoleId = useMemo(() => {
    const map = new Map<string, number>();
    for (const u of Array.isArray(usersData) ? usersData : []) {
      if (u.roleId) map.set(u.roleId, (map.get(u.roleId) ?? 0) + 1);
    }
    return map;
  }, [usersData]);

  const [refreshing, setRefreshing] = useState(false);
  const [copySheetOpen, setCopySheetOpen] = useState(false);
  const [renamingRole, setRenamingRole] = useState<Role | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [deletingRole, setDeletingRole] = useState<Role | null>(null);

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => rolesApi.update(id, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...ROLES_QUERY_KEY] });
      haptic('success');
      setRenamingRole(null);
      setRenameDraft('');
    },
    onError: (err: any) => {
      haptic('error');
      Alert.alert('Ошибка', err?.response?.data?.message || 'Не удалось переименовать роль');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => rolesApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...ROLES_QUERY_KEY] });
      haptic('success');
    },
    onError: (err: any) => {
      haptic('error');
      const body = err?.response?.data;
      if (body?.code === 'ROLE_HAS_USERS') {
        // 400 с count — роль занята. Серверный текст уже человеческий
        // («Сначала переназначьте N сотрудников на другую роль»).
        Alert.alert(
          'Роль назначена сотрудникам',
          body?.message || `Сначала переназначьте ${body?.count ?? ''} сотрудников на другую роль`,
        );
        return;
      }
      Alert.alert('Ошибка', body?.message || 'Не удалось удалить роль');
    },
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: [...ROLES_QUERY_KEY] });
    setRefreshing(false);
  };

  const openRole = (role: Role) => {
    haptic('tap');
    navigation.navigate('RoleEditor', { roleId: role.id });
  };

  // «+» — выбор способа создания: с нуля или копией существующей.
  const openCreate = () => {
    haptic('tap');
    Alert.alert('Новая роль', 'Создать с нуля или скопировать существующую?', [
      { text: 'Создать с нуля', onPress: () => navigation.navigate('RoleEditor', {}) },
      { text: 'Копия существующей', onPress: () => setCopySheetOpen(true) },
      { text: 'Отмена', style: 'cancel' },
    ]);
  };

  const openMenu = (role: Role) => {
    haptic('tap');
    Alert.alert(role.name, undefined, [
      {
        text: 'Переименовать',
        onPress: () => {
          setRenameDraft(role.name);
          setRenamingRole(role);
        },
      },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () => {
          haptic('warning');
          setDeletingRole(role);
        },
      },
      { text: 'Отмена', style: 'cancel' },
    ]);
  };

  const submitRename = () => {
    const name = renameDraft.trim();
    if (!name) {
      Alert.alert('Ошибка', 'Введите название роли');
      return;
    }
    if (renamingRole) renameMutation.mutate({ id: renamingRole.id, name });
  };

  // Гейт как у UsersScreen: экран отвечает честным «Нет доступа», а не 403-алертами.
  if (!canManage) {
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Роли" onBack={() => navigation.goBack()} />
        <EmptyState title="Нет доступа" description="Управлять ролями может владелец или администратор" />
      </View>
    );
  }

  const systemRoles = roles.filter((r) => r.isSystem);
  const customRoles = roles.filter((r) => !r.isSystem);
  const hasAny = roles.length > 0;

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title="Роли"
        subtitle={hasAny ? `Всего: ${roles.length}` : undefined}
        onBack={() => navigation.goBack()}
        trailing={
          <TouchableOpacity
            onPress={openCreate}
            style={styles.addBtn}
            accessibilityRole="button"
            accessibilityLabel="Создать роль"
          >
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
        {!hasAny && isLoading ? (
          // Первая загрузка без кэша — спиннер, никогда не ложное «пусто».
          <LoadingSpinner />
        ) : !hasAny && isError ? (
          <EmptyState
            title="Не удалось загрузить"
            description="Проверьте соединение и потяните вниз или нажмите «Повторить»"
            action={{ label: 'Повторить', onPress: () => refetch() }}
          />
        ) : (
          <>
            {/* ── Системные ─────────────────────────────────────────────── */}
            <Text style={[styles.sectionLabel, { color: palette.text.tertiary }]}>Системные</Text>
            <Text style={[styles.sectionHint, { color: palette.text.tertiary }]}>
              Готовые базовые роли. «Мастер» и «Администратор» можно настроить под свой автосервис; «Директор» — полные
              права, только просмотр.
            </Text>
            <View
              style={[styles.group, shadow, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
            >
              {systemRoles.map((role, idx) => (
                <RoleRow
                  key={role.id}
                  role={role}
                  employeeCount={countByRoleId.get(role.id) ?? 0}
                  isLast={idx === systemRoles.length - 1}
                  onPress={openRole}
                />
              ))}
              {systemRoles.length === 0 && (
                <Text style={[styles.groupEmptyText, { color: palette.text.tertiary }]}>Системных ролей нет</Text>
              )}
            </View>

            {/* ── Мои роли ──────────────────────────────────────────────── */}
            <Text style={[styles.sectionLabel, { color: palette.text.tertiary, marginTop: spacing[5] }]}>Мои роли</Text>
            {customRoles.length > 0 ? (
              <View
                style={[styles.group, shadow, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
              >
                {customRoles.map((role, idx) => (
                  <RoleRow
                    key={role.id}
                    role={role}
                    employeeCount={countByRoleId.get(role.id) ?? 0}
                    isLast={idx === customRoles.length - 1}
                    onPress={openRole}
                    onMenu={openMenu}
                  />
                ))}
              </View>
            ) : (
              // Единственное легальное «пусто» — свои роли ещё не созданы.
              <TouchableOpacity
                style={[styles.emptyCustom, { borderColor: palette.border.subtle }]}
                onPress={openCreate}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Создать свою роль"
              >
                <Ionicons name="key-outline" size={20} color={palette.text.tertiary} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.emptyCustomTitle, { color: palette.text.secondary }]}>
                    Создайте свою роль — например, «Старший мастер»
                  </Text>
                  <Text style={[styles.emptyCustomSub, { color: palette.text.tertiary }]}>
                    С нуля или копией системной, затем настройте матрицу прав.
                  </Text>
                </View>
                <Ionicons name="add-circle" size={22} color={colors.primary[500]} />
              </TouchableOpacity>
            )}

            {/* Как это работает — короткая подсказка владельцу. */}
            <Text style={[styles.footHint, { color: palette.text.tertiary }]}>
              Роль — база прав сотрудника. Индивидуальные тумблеры в карточке сотрудника действуют поверх роли.
              Назначить роль: Пользователи → сотрудник → поле «Роль».
            </Text>
          </>
        )}
      </ScrollView>

      {/* ── Копия существующей: выбор роли-источника ───────────────────── */}
      <Modal visible={copySheetOpen} onClose={() => setCopySheetOpen(false)} title="Копия существующей">
        <Text style={[styles.sectionHint, { color: palette.text.tertiary, marginBottom: spacing[3] }]}>
          Выберите роль-основу — её матрица прав будет скопирована в новую роль.
        </Text>
        <View style={{ gap: spacing[2] }}>
          {roles.map((role) => (
            <TouchableOpacity
              key={role.id}
              style={[styles.copyRow, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
              onPress={() => {
                haptic('select');
                setCopySheetOpen(false);
                navigation.navigate('RoleEditor', { copyFromRoleId: role.id });
              }}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={`Создать копию роли ${role.name}`}
            >
              <Ionicons
                name={role.isSystem ? 'shield-checkmark-outline' : 'key-outline'}
                size={16}
                color={colors.primary[600]}
              />
              <Text style={[styles.copyRowName, { color: palette.text.primary }]} numberOfLines={1}>
                {role.name}
              </Text>
              {role.isSystem && (
                <View style={[styles.systemBadge, { backgroundColor: palette.bg.card }]}>
                  <Text style={[styles.systemBadgeText, { color: palette.text.secondary }]}>Системная</Text>
                </View>
              )}
              <Ionicons name="chevron-forward" size={15} color={palette.text.tertiary} />
            </TouchableOpacity>
          ))}
          {roles.length === 0 && (
            <Text style={[styles.groupEmptyText, { color: palette.text.tertiary }]}>Ролей пока нет</Text>
          )}
        </View>
      </Modal>

      {/* ── Переименование своей роли ──────────────────────────────────── */}
      <Modal
        visible={!!renamingRole}
        onClose={() => {
          setRenamingRole(null);
          setRenameDraft('');
        }}
        title="Переименовать роль"
      >
        <View style={{ marginBottom: spacing[4] }}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Название роли</Text>
          <TextInput
            value={renameDraft}
            onChangeText={setRenameDraft}
            style={[
              styles.formInput,
              { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
            ]}
            placeholder="Напр. Старший мастер"
            placeholderTextColor={palette.text.tertiary}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={submitRename}
          />
        </View>
        <View style={[styles.formActions, { borderTopColor: palette.border.subtle }]}>
          <TouchableOpacity
            style={[styles.cancelBtn, { borderColor: palette.border.strong }]}
            onPress={() => {
              setRenamingRole(null);
              setRenameDraft('');
            }}
          >
            <Text style={[styles.cancelBtnText, { color: palette.text.secondary }]}>Отмена</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.submitBtn} onPress={submitRename} disabled={renameMutation.isPending}>
            {renameMutation.isPending ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={styles.submitBtnText}>Сохранить</Text>
            )}
          </TouchableOpacity>
        </View>
      </Modal>

      {/* ── Удаление своей роли ────────────────────────────────────────── */}
      <ConfirmDialog
        visible={!!deletingRole}
        onClose={() => setDeletingRole(null)}
        onConfirm={() => {
          if (deletingRole) deleteMutation.mutate(deletingRole.id);
        }}
        title="Удалить роль?"
        message={`Роль «${deletingRole?.name ?? ''}» будет удалена безвозвратно. Если она назначена сотрудникам, сервер не даст удалить — сначала переназначьте их.`}
        confirmText="Удалить"
        variant="danger"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.primary[600],
    alignItems: 'center',
    justifyContent: 'center',
  },
  scrollContent: { padding: spacing[4] },
  sectionLabel: {
    fontSize: 11,
    fontWeight: fontWeight.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: spacing[1.5],
    marginLeft: spacing[1],
  },
  sectionHint: { fontSize: 11, lineHeight: 15, marginBottom: spacing[2], marginLeft: spacing[1] },
  group: {
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    paddingHorizontal: spacing[3.5],
  },
  groupEmptyText: { fontSize: fontSize.sm, textAlign: 'center', paddingVertical: spacing[4] },
  roleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[3],
  },
  roleIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  roleNameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  roleName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, flexShrink: 1 },
  systemBadge: { paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: borderRadius.full },
  systemBadgeText: { fontSize: 10, fontWeight: fontWeight.medium },
  roleDescription: { fontSize: 12, marginTop: 2 },
  roleMeta: { fontSize: 11, marginTop: 2 },
  menuBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  rowDivider: { height: StyleSheet.hairlineWidth, marginLeft: 34 + spacing[3] },
  emptyCustom: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[4],
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: borderRadius['2xl'],
  },
  emptyCustomTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  emptyCustomSub: { fontSize: 11, lineHeight: 15, marginTop: 2 },
  footHint: { fontSize: 11, lineHeight: 16, marginTop: spacing[5], marginHorizontal: spacing[1] },
  copyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
  },
  copyRowName: { flex: 1, minWidth: 0, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  // Форма (rename-модалка) — те же токены, что в UsersScreen.
  formLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, marginBottom: spacing[1.5] },
  formInput: {
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[2.5],
    fontSize: fontSize.sm,
  },
  formActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[3],
    paddingTop: spacing[4],
    borderTopWidth: 1,
  },
  cancelBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },
  cancelBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  submitBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primary[600],
  },
  submitBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.white },
});
