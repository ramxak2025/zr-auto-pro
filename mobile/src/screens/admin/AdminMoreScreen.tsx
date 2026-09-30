/**
 * AdminMoreScreen — the «Ещё» tab of the platform-operator shell (суперадмин и менеджер).
 *
 *   • Суперадмин: «Менеджеры» и «Заявки на регистрацию»; журнал действий — adminApi.listAuditLog().
 *   • Менеджер: «Расчёты» с текущим долгом владельцу; журнал ЕГО действий — managerApi.auditLog().
 *   • Тема (light / dark toggle — оба получают её).
 *   • Версия приложения.
 *   • Выйти (logout via AuthContext).
 *
 * The operator's own notifications keep working — BroadcastNotificationProvider
 * is mounted app-wide in App.tsx, above the role branch, so nothing here needs
 * to re-wire it.
 */
import React from 'react';
import { View, StyleSheet, ScrollView, Pressable, RefreshControl } from 'react-native';
import Constants from 'expo-constants';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { adminApi, managerApi } from '../../api/services';
import IosScreenHeader from '../../components/IosScreenHeader';
import { Text } from '../../platform/Typography';
import { haptic } from '../../platform/haptics';
import { useAuth } from '../../contexts/AuthContext';
import { useColors, useThemeMode } from '../../contexts/ThemeContext';
import { useIosSurface } from '../../platform/iosSurface';
import { colors, spacing, borderRadius } from '../../theme';
import { useAdminTabBarScrollInsets } from '../../hooks/useAdminTabBarHeight';
import type { AuditLogEntry, ManagerSummary, RegistrationRequest } from '../../../../shared/types';
import { balanceCaption, balanceColor, formatDateTime, useAdminMode } from './adminShared';

// Human-readable Russian labels for the platform audit actions. Keys mirror the
// FACTUAL audit.log()/audit.logTx() calls in backend (single source of truth —
// frontend/src/components/admin/auditActions.ts, сверен grep'ом по backend/src):
//   tenants.service.ts       → tenant_extend, tenant_change_plan, tenant_suspend,
//                              tenant_unsuspend, impersonate, tenant_toggle_active,
//                              tenant_delete
//   registration.service.ts  → registration_approve, registration_reject
//   notifications.service.ts → broadcast_cancel
//   checks.service.ts        → check_closed_edit
//   менеджеры (173)          → tenant_create, tenant_transfer_manager, manager_create,
//                              manager_update, manager_settlement, owner_password_reset
// Unknown actions fall back to a humanised version of the raw key.
const ACTION_LABELS: Record<string, string> = {
  tenant_extend: 'Продление подписки',
  tenant_change_plan: 'Смена тарифа',
  tenant_suspend: 'Приостановка',
  tenant_unsuspend: 'Возобновление работы',
  impersonate: 'Вход как владелец',
  tenant_toggle_active: 'Вкл/выкл автосервиса',
  tenant_delete: 'Удаление автосервиса',
  registration_approve: 'Заявка одобрена',
  registration_reject: 'Заявка отклонена',
  broadcast_cancel: 'Рассылка отменена',
  check_closed_edit: 'Правка закрытого чека',
  tenant_create: 'Создание автосервиса',
  tenant_transfer_manager: 'Передача клиента менеджеру',
  manager_create: 'Создание менеджера',
  manager_update: 'Правка менеджера',
  manager_settlement: 'Расчёт с менеджером',
  owner_password_reset: 'Сброс пароля владельца',
};

function actionLabel(action: string): string {
  if (ACTION_LABELS[action]) return ACTION_LABELS[action];
  const words = action.replace(/_/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function actionIcon(action: string): keyof typeof Ionicons.glyphMap {
  if (action.includes('impersonate')) return 'enter-outline';
  if (action.startsWith('registration')) return 'mail-open-outline';
  if (action.startsWith('broadcast')) return 'megaphone-outline';
  if (action.startsWith('check')) return 'receipt-outline';
  if (action === 'manager_settlement') return 'cash-outline';
  if (action.startsWith('manager')) return 'people-outline';
  if (action === 'owner_password_reset') return 'lock-closed-outline';
  if (action === 'tenant_transfer_manager') return 'swap-horizontal-outline';
  if (action.startsWith('tenant')) return 'business-outline';
  if (action.startsWith('plan')) return 'pricetags-outline';
  if (action.startsWith('user')) return 'person-outline';
  return 'ellipse-outline';
}

export default function AdminMoreScreen() {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const surface = useIosSurface();
  const { contentInset, contentContainerPaddingBottom } = useAdminTabBarScrollInsets();
  const { logout, user } = useAuth();
  const { mode, toggle } = useThemeMode();
  const isManager = useAdminMode() === 'manager';
  const [refreshing, setRefreshing] = React.useState(false);

  // Pending registration requests — count badge on the «Заявки» row. Same query
  // key the Overview card + review screen use, so all three stay consistent.
  // Заявки — суперадминский маршрут: менеджеру запрос не шлём.
  const { data: pendingRequests = [] } = useQuery<RegistrationRequest[]>({
    queryKey: ['admin-registration-requests', 'pending'],
    queryFn: async () => (await adminApi.listRegistrationRequests('pending')).data,
    enabled: !isManager,
  });
  const pendingCount = pendingRequests.length;

  // Долг владельцу на строке «Расчёты» — тот же ключ, что у обзора менеджера.
  const { data: managerSummary, refetch: refetchSummary } = useQuery<ManagerSummary>({
    queryKey: ['manager', 'summary'],
    queryFn: async () => (await managerApi.summary()).data,
    enabled: isManager,
    placeholderData: (prev) => prev,
  });

  const {
    data: log = [],
    isLoading,
    refetch,
  } = useQuery<AuditLogEntry[]>({
    // Журнал менеджера — только его действия; журнал суперадмина — вся платформа.
    queryKey: isManager ? ['manager', 'audit-log'] : ['admin-audit-log'],
    queryFn: async () =>
      isManager ? (await managerApi.auditLog({ limit: 50 })).data : (await adminApi.listAuditLog()).data,
  });

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetch(), isManager ? refetchSummary() : Promise.resolve()]);
    setRefreshing(false);
  }, [refetch, refetchSummary, isManager]);

  const handleLogout = React.useCallback(() => {
    haptic('tap');
    logout();
  }, [logout]);

  const version = Constants.expoConfig?.version ?? '—';

  return (
    <View style={[styles.root, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Ещё" subtitle={user?.fullName ?? (isManager ? 'Менеджер' : 'Суперадмин')} />

      <ScrollView
        contentInset={contentInset}
        contentContainerStyle={[styles.scroll, { paddingBottom: contentContainerPaddingBottom }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.accent.primary} />
        }
      >
        {/* Settings */}
        <View style={[styles.card, surface.card]}>
          <Pressable
            onPress={() => {
              haptic('select');
              toggle();
            }}
            style={styles.settingRow}
          >
            <View style={[styles.settingIcon, { backgroundColor: palette.bg.muted }]}>
              <Ionicons name={mode === 'dark' ? 'moon' : 'sunny'} size={18} color={palette.text.primary} />
            </View>
            <Text style={[styles.settingLabel, { color: palette.text.primary }]}>Тема оформления</Text>
            <Text style={[styles.settingValue, { color: palette.text.tertiary }]}>
              {mode === 'dark' ? 'Тёмная' : 'Светлая'}
            </Text>
          </Pressable>
          <View style={[styles.divider, { backgroundColor: palette.border.subtle }]} />
          <View style={styles.settingRow}>
            <View style={[styles.settingIcon, { backgroundColor: palette.bg.muted }]}>
              <Ionicons name="information-circle-outline" size={18} color={palette.text.primary} />
            </View>
            <Text style={[styles.settingLabel, { color: palette.text.primary }]}>Версия Autexa</Text>
            <Text style={[styles.settingValue, { color: palette.text.tertiary }]}>{version}</Text>
          </View>
        </View>

        {/* Management */}
        <Text style={[styles.sectionLabel, { color: palette.text.tertiary }]}>
          {isManager ? 'Деньги' : 'Управление'}
        </Text>
        {isManager ? (
          <Pressable
            onPress={() => {
              haptic('tap');
              navigation.navigate('ManagerLedger');
            }}
            style={[styles.card, surface.card, styles.navRow]}
          >
            <View style={[styles.settingIcon, { backgroundColor: palette.bg.muted }]}>
              <Ionicons name="wallet-outline" size={18} color={palette.text.primary} />
            </View>
            <Text style={[styles.settingLabel, { color: palette.text.primary }]}>Расчёты</Text>
            {managerSummary ? (
              <Text style={[styles.settingValue, { color: balanceColor(managerSummary.balance, palette) }]}>
                {balanceCaption(managerSummary.balance)}
              </Text>
            ) : null}
            <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
          </Pressable>
        ) : (
          <>
            <Pressable
              onPress={() => {
                haptic('tap');
                navigation.navigate('AdminManagers');
              }}
              style={[styles.card, surface.card, styles.navRow]}
            >
              <View style={[styles.settingIcon, { backgroundColor: palette.bg.muted }]}>
                <Ionicons name="people-outline" size={18} color={palette.text.primary} />
              </View>
              <Text style={[styles.settingLabel, { color: palette.text.primary }]}>Менеджеры</Text>
              <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
            </Pressable>
            <Pressable
              onPress={() => {
                haptic('tap');
                // Nested navigate — the review screen lives in the Overview tab's
                // stack (AdminShellNavigator). This switches to it and pushes the list.
                navigation.navigate('AdminOverview', { screen: 'AdminRegistrationRequests' });
              }}
              style={[styles.card, surface.card, styles.navRow]}
            >
              <View style={[styles.settingIcon, { backgroundColor: palette.bg.muted }]}>
                <Ionicons name="mail-unread-outline" size={18} color={palette.text.primary} />
              </View>
              <Text style={[styles.settingLabel, { color: palette.text.primary }]}>Заявки на регистрацию</Text>
              {pendingCount > 0 ? (
                <View style={[styles.navBadge, { backgroundColor: palette.accent.primary }]}>
                  <Text style={styles.navBadgeText}>{pendingCount}</Text>
                </View>
              ) : null}
              <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
            </Pressable>
          </>
        )}

        {/* Audit log */}
        <Text style={[styles.sectionLabel, { color: palette.text.tertiary }]}>
          {isManager ? 'Мои действия' : 'Журнал действий'}
        </Text>
        <View style={[styles.card, surface.card]}>
          {isLoading ? (
            <View style={styles.emptyBlock}>
              <Text style={[styles.emptyText, { color: palette.text.tertiary }]}>Загрузка…</Text>
            </View>
          ) : log.length === 0 ? (
            <View style={styles.emptyBlock}>
              <Ionicons name="document-text-outline" size={36} color={palette.text.tertiary} />
              <Text style={[styles.emptyText, { color: palette.text.secondary }]}>Журнал пуст</Text>
            </View>
          ) : (
            log.map((entry, i) => (
              <View
                key={entry.id}
                style={[
                  styles.logRow,
                  i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border.subtle },
                ]}
              >
                <View style={[styles.logIcon, { backgroundColor: palette.bg.muted }]}>
                  <Ionicons name={actionIcon(entry.action)} size={16} color={palette.text.secondary} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.logAction, { color: palette.text.primary }]} numberOfLines={1}>
                    {actionLabel(entry.action)}
                    {entry.targetName ? (
                      <Text style={{ color: palette.text.secondary }}> · {entry.targetName}</Text>
                    ) : null}
                  </Text>
                  <Text style={[styles.logMeta, { color: palette.text.tertiary }]} numberOfLines={1}>
                    {entry.actorName ?? 'Система'} · {formatDateTime(entry.createdAt)}
                  </Text>
                </View>
              </View>
            ))
          )}
        </View>

        {/* Logout */}
        <Pressable onPress={handleLogout} style={[styles.logoutBtn, surface.card]}>
          <Ionicons name="log-out-outline" size={20} color={colors.red[600]} />
          <Text style={styles.logoutText}>Выйти</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: spacing[4], paddingTop: spacing[1], gap: spacing[3] },
  card: { paddingHorizontal: spacing[4], paddingVertical: spacing[1] },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingVertical: spacing[3] },
  settingIcon: { width: 32, height: 32, borderRadius: borderRadius.lg, alignItems: 'center', justifyContent: 'center' },
  settingLabel: { fontSize: 15, fontWeight: '500', flex: 1 },
  settingValue: { fontSize: 14, fontWeight: '500' },
  navRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingVertical: spacing[3.5] },
  navBadge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navBadgeText: { color: colors.white, fontSize: 11, fontWeight: '800' },
  divider: { height: StyleSheet.hairlineWidth },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: spacing[2],
    marginLeft: spacing[1],
  },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingVertical: spacing[3] },
  logIcon: { width: 32, height: 32, borderRadius: borderRadius.lg, alignItems: 'center', justifyContent: 'center' },
  logAction: { fontSize: 14, fontWeight: '600' },
  logMeta: { fontSize: 12, marginTop: 1 },
  emptyBlock: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing[8], gap: spacing[2] },
  emptyText: { fontSize: 14 },
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[4],
  },
  logoutText: { color: colors.red[600], fontSize: 16, fontWeight: '700' },
});
