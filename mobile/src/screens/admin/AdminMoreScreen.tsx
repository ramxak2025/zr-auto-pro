/**
 * AdminMoreScreen — the «Ещё» tab of the platform-operator shell (суперадмин и менеджер).
 *
 *   • Суперадмин: «Менеджеры» и «Заявки на регистрацию».
 *   • Менеджер: «Расчёты» с текущим долгом владельцу.
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
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { adminApi, managerApi } from '../../api/services';
import IosScreenHeader from '../../components/IosScreenHeader';
import { Text } from '../../platform/Typography';
import { haptic } from '../../platform/haptics';
import { useAuth } from '../../contexts/AuthContext';
import { useColors, useThemeMode } from '../../contexts/ThemeContext';
import { useIosSurface } from '../../platform/iosSurface';
import { colors, spacing, borderRadius } from '../../theme';
import { useAdminTabBarScrollInsets } from '../../hooks/useAdminTabBarHeight';
import type { ManagerSummary, RegistrationRequest } from '../../../../shared/types';
import { balanceCaption, balanceColor, useAdminMode } from './adminShared';
import AccountPickerSheet from '../AccountPickerSheet';

export default function AdminMoreScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<{ AdminMoreHome: { accountPickerRequest?: number } }, 'AdminMoreHome'>>();
  const palette = useColors();
  const surface = useIosSurface();
  const { contentInset, contentContainerPaddingBottom } = useAdminTabBarScrollInsets();
  const { logout, user, savedAccounts } = useAuth();
  const { mode, toggle } = useThemeMode();
  const isManager = useAdminMode() === 'manager';
  const [refreshing, setRefreshing] = React.useState(false);
  const [accountsOpen, setAccountsOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof route.params?.accountPickerRequest !== 'number') return;
    setAccountsOpen(true);
    navigation.setParams({ accountPickerRequest: undefined });
  }, [navigation, route.params?.accountPickerRequest]);

  // Pending registration requests — count badge on the «Заявки» row. Same query
  // key the Overview card + review screen use, so all three stay consistent.
  // Заявки — суперадминский маршрут: менеджеру запрос не шлём.
  const { data: pendingRequests = [], refetch: refetchRequests } = useQuery<RegistrationRequest[]>({
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

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    try {
      await (isManager ? refetchSummary() : refetchRequests());
    } finally {
      setRefreshing(false);
    }
  }, [refetchRequests, refetchSummary, isManager]);

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
        <Pressable
          onPress={() => setAccountsOpen(true)}
          style={[styles.card, surface.card, styles.accountPickerRow]}
          accessibilityRole="button"
        >
          <Ionicons name="people-outline" size={20} color={palette.accent.primaryText} />
          <Text style={[styles.settingLabel, { color: palette.text.primary }]}>Аккаунты</Text>
          <Text style={[styles.settingValue, { color: palette.text.tertiary }]}>{savedAccounts.length}/3</Text>
          <Ionicons name="chevron-forward" size={17} color={palette.text.tertiary} />
        </Pressable>
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

        {/* Logout */}
        <Pressable onPress={handleLogout} style={[styles.logoutBtn, surface.card]}>
          <Ionicons name="log-out-outline" size={20} color={colors.red[600]} />
          <Text style={styles.logoutText}>Выйти</Text>
        </Pressable>
      </ScrollView>
      <AccountPickerSheet visible={accountsOpen} onClose={() => setAccountsOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingHorizontal: spacing[4], paddingTop: spacing[1], gap: spacing[3] },
  card: { paddingHorizontal: spacing[4], paddingVertical: spacing[1] },
  accountPickerRow: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
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
  logoutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[4],
  },
  logoutText: { color: colors.red[600], fontSize: 16, fontWeight: '700' },
});
