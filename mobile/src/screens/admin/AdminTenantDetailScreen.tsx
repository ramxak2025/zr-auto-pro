/**
 * AdminTenantDetailScreen — full tenant management for the superadmin.
 *
 *   • Tenant identity + subscription summary.
 *   • «Показатели клиента» — activity metrics from getMetrics(id) (заказ-наряды
 *     30д/всего, выручка 30д/всего, последняя активность, сотрудники, товары).
 *   • Subscription actions:
 *       – Продлить (+30 / +90 / произвольно дней → extend)
 *       – Сменить тариф (plan picker → assignPlan, resyncs price + maxUsers)
 *       – Активен toggle (update)
 *       – Войти как владелец (impersonate → AuthContext.beginImpersonation)
 */
import React from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
  Modal,
  TextInput,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import { tenantsApi, plansApi } from '../../api/services';
import IosScreenHeader from '../../components/IosScreenHeader';
import { Text } from '../../platform/Typography';
import { haptic } from '../../platform/haptics';
import { useAuth } from '../../contexts/AuthContext';
import { useColors } from '../../contexts/ThemeContext';
import { useIosSurface } from '../../platform/iosSurface';
import { colors, spacing, borderRadius } from '../../theme';
import { useAdminTabBarScrollInsets } from '../../hooks/useAdminTabBarHeight';
import type { Tenant, Plan, TenantMetrics } from '../../../../shared/types';
import { formatMoney, formatFullDate, formatDateTime, isExpired, tenantStatus, StatusChip } from './adminShared';

export default function AdminTenantDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const id: string = route.params?.id;
  const palette = useColors();
  const surface = useIosSurface();
  const queryClient = useQueryClient();
  const { contentInset, contentContainerPaddingBottom } = useAdminTabBarScrollInsets();
  const { beginImpersonation } = useAuth();

  const [customExtendOpen, setCustomExtendOpen] = React.useState(false);
  const [customDays, setCustomDays] = React.useState('');
  const [busy, setBusy] = React.useState<null | 'extend' | 'plan' | 'toggle' | 'impersonate'>(null);

  const { data: tenant } = useQuery<Tenant>({
    queryKey: ['admin-tenant', id],
    queryFn: async () => (await tenantsApi.getById(id)).data,
  });

  const { data: metrics } = useQuery<TenantMetrics>({
    queryKey: ['admin-tenant-metrics', id],
    queryFn: async () => (await tenantsApi.getMetrics(id)).data,
  });

  const { data: plans = [] } = useQuery<Plan[]>({
    queryKey: ['admin-plans'],
    queryFn: async () => (await plansApi.getAll()).data,
  });

  const invalidate = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['admin-tenant', id] });
    queryClient.invalidateQueries({ queryKey: ['admin-tenants'] });
    queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
  }, [queryClient, id]);

  const extendMutation = useMutation({
    mutationFn: async (days: number) => {
      setBusy('extend');
      await tenantsApi.extend(id, days);
    },
    onSuccess: () => {
      haptic('success');
      invalidate();
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось продлить подписку');
    },
    onSettled: () => setBusy(null),
  });

  const assignPlanMutation = useMutation({
    mutationFn: async (planId: string) => {
      setBusy('plan');
      await tenantsApi.assignPlan(id, planId);
    },
    onSuccess: () => {
      haptic('success');
      invalidate();
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось сменить тариф');
    },
    onSettled: () => setBusy(null),
  });

  const toggleMutation = useMutation({
    mutationFn: async (next: boolean) => {
      setBusy('toggle');
      await tenantsApi.update(id, { isActive: next });
    },
    onSuccess: () => {
      haptic('success');
      invalidate();
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось изменить статус');
    },
    onSettled: () => setBusy(null),
  });

  const handleExtend = React.useCallback(() => {
    haptic('tap');
    Alert.alert('Продлить подписку', tenant ? `«${tenant.name}»` : undefined, [
      { text: '+30 дней', onPress: () => extendMutation.mutate(30) },
      { text: '+90 дней', onPress: () => extendMutation.mutate(90) },
      {
        text: 'Произвольно…',
        onPress: () => {
          setCustomDays('');
          setCustomExtendOpen(true);
        },
      },
      { text: 'Отмена', style: 'cancel' },
    ]);
  }, [extendMutation, tenant]);

  const handleChangePlan = React.useCallback(() => {
    if (!tenant) return;
    const options = plans.filter((p) => p.isActive && p.id !== tenant.planId);
    if (options.length === 0) {
      Alert.alert('Нет доступных тарифов', 'Все активные тарифы уже назначены.');
      return;
    }
    haptic('tap');
    Alert.alert('Сменить тариф', `Выберите тариф для «${tenant.name}»`, [
      ...options.map((p) => ({
        text: `${p.name} · ${formatMoney(p.monthlyPrice)}/мес`,
        onPress: () => assignPlanMutation.mutate(p.id),
      })),
      { text: 'Отмена', style: 'cancel' as const },
    ]);
  }, [plans, tenant, assignPlanMutation]);

  const handleToggle = React.useCallback(() => {
    if (!tenant) return;
    haptic('tap');
    Alert.alert(
      tenant.isActive ? 'Отключить тенанта?' : 'Активировать тенанта?',
      `«${tenant.name}» будет ${tenant.isActive ? 'отключён' : 'активирован'}.`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: tenant.isActive ? 'Отключить' : 'Активировать',
          style: tenant.isActive ? 'destructive' : 'default',
          onPress: () => toggleMutation.mutate(!tenant.isActive),
        },
      ],
    );
  }, [tenant, toggleMutation]);

  const handleImpersonate = React.useCallback(() => {
    if (!tenant) return;
    haptic('warning');
    Alert.alert(
      'Войти как владелец?',
      `Вы войдёте в аккаунт «${tenant.name}» как директор на 30 минут. Это действие фиксируется в журнале. ` +
        'Чтобы вернуться в админ-панель, нужно будет выйти и заново войти под суперадмином.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Войти',
          style: 'destructive',
          onPress: async () => {
            try {
              setBusy('impersonate');
              const res = await tenantsApi.impersonate(tenant.id);
              // Swaps the stored token + user; role flips to 'director' → the
              // root navigator re-renders into the tenant's car-service tree.
              await beginImpersonation(res.data.token, res.data.user);
            } catch {
              haptic('error');
              Alert.alert('Ошибка', 'Не удалось войти как владелец');
              setBusy(null);
            }
          },
        },
      ],
    );
  }, [tenant, beginImpersonation]);

  if (!tenant) {
    return (
      <View style={[styles.root, styles.center, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Тенант" onBack={() => navigation.goBack()} />
        <ActivityIndicator color={palette.accent.primary} style={{ marginTop: spacing[10] }} />
      </View>
    );
  }

  const planName = tenant.plan?.name || plans.find((p) => p.id === tenant.planId)?.name || 'Не назначен';
  const expired = isExpired(tenant.subscriptionEnd);

  return (
    <View style={[styles.root, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title={tenant.name} onBack={() => navigation.goBack()} />

      <ScrollView
        contentInset={contentInset}
        contentContainerStyle={[styles.scroll, { paddingBottom: contentContainerPaddingBottom }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Subscription summary */}
        <View style={[styles.card, surface.card]}>
          <View style={styles.summaryHead}>
            <Text style={[styles.summaryTitle, { color: palette.text.primary }]}>Подписка</Text>
            <StatusChip status={tenantStatus(tenant)} />
          </View>
          <InfoRow label="Тариф" value={planName} palette={palette} />
          <InfoRow label="Стоимость" value={`${formatMoney(tenant.monthlyPrice)}/мес`} palette={palette} />
          <InfoRow
            label="Оплачено до"
            value={formatFullDate(tenant.subscriptionEnd)}
            valueColor={expired ? colors.red[600] : undefined}
            palette={palette}
          />
          <InfoRow label="Макс. польз." value={String(tenant.maxUsers)} palette={palette} />
          {tenant.phone ? <InfoRow label="Телефон" value={tenant.phone} palette={palette} /> : null}
          {tenant.email ? <InfoRow label="Email" value={tenant.email} palette={palette} /> : null}
          <InfoRow label="Создан" value={formatFullDate(tenant.createdAt)} palette={palette} last />
        </View>

        {/* Client metrics */}
        <Text style={[styles.sectionLabel, { color: palette.text.tertiary }]}>Показатели клиента</Text>
        <View style={styles.metricsGrid}>
          <MetricBox
            value={metrics ? String(metrics.checksLast30d) : '—'}
            label="Заказ-наряды · 30д"
            surfaceCard={surface.card}
            palette={palette}
          />
          <MetricBox
            value={metrics ? String(metrics.checksTotal) : '—'}
            label="Заказ-наряды · всего"
            surfaceCard={surface.card}
            palette={palette}
          />
          <MetricBox
            value={metrics ? formatMoney(metrics.revenueLast30d) : '—'}
            label="Выручка · 30д"
            surfaceCard={surface.card}
            palette={palette}
          />
          <MetricBox
            value={metrics ? formatMoney(metrics.revenueTotal) : '—'}
            label="Выручка · всего"
            surfaceCard={surface.card}
            palette={palette}
          />
          <MetricBox
            value={metrics ? `${metrics.activeUsersCount}/${metrics.usersCount}` : '—'}
            label="Активные сотрудники"
            surfaceCard={surface.card}
            palette={palette}
          />
          <MetricBox
            value={metrics ? String(metrics.productsCount) : '—'}
            label="Товары на складе"
            surfaceCard={surface.card}
            palette={palette}
          />
        </View>
        <View style={[styles.card, surface.card]}>
          <InfoRow
            label="Последняя активность"
            value={metrics ? formatDateTime(metrics.lastActivityAt) : '—'}
            palette={palette}
            last
          />
        </View>

        {/* Actions */}
        <Text style={[styles.sectionLabel, { color: palette.text.tertiary }]}>Управление</Text>
        <View style={{ gap: spacing[2.5] }}>
          <ActionButton
            icon="time-outline"
            label="Продлить подписку"
            onPress={handleExtend}
            loading={busy === 'extend'}
            palette={palette}
            surfaceCard={surface.card}
          />
          <ActionButton
            icon="swap-horizontal-outline"
            label="Сменить тариф"
            onPress={handleChangePlan}
            loading={busy === 'plan'}
            palette={palette}
            surfaceCard={surface.card}
          />
          <ActionButton
            icon={tenant.isActive ? 'pause-circle-outline' : 'play-circle-outline'}
            label={tenant.isActive ? 'Отключить тенанта' : 'Активировать тенанта'}
            onPress={handleToggle}
            loading={busy === 'toggle'}
            danger={tenant.isActive}
            palette={palette}
            surfaceCard={surface.card}
          />
          {/* Impersonation — primary destructive accent. */}
          <Pressable
            onPress={handleImpersonate}
            disabled={busy === 'impersonate'}
            style={[styles.impersonateBtn, { backgroundColor: palette.accent.primary }]}
          >
            {busy === 'impersonate' ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <>
                <Ionicons name="enter-outline" size={18} color={colors.white} />
                <Text style={styles.impersonateText}>Войти как владелец</Text>
              </>
            )}
          </Pressable>
        </View>
      </ScrollView>

      {/* Custom-days extend modal */}
      <Modal
        visible={customExtendOpen}
        transparent
        statusBarTranslucent
        animationType="fade"
        onRequestClose={() => setCustomExtendOpen(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setCustomExtendOpen(false)}>
          <Pressable style={[styles.modalCard, { backgroundColor: palette.bg.card }]} onPress={() => {}}>
            <Text style={[styles.modalTitle, { color: palette.text.primary }]}>На сколько дней продлить?</Text>
            <TextInput
              style={[styles.modalInput, { color: palette.text.primary, borderColor: palette.border.subtle }]}
              placeholder="например, 14"
              placeholderTextColor={palette.text.tertiary}
              keyboardType="number-pad"
              value={customDays}
              onChangeText={setCustomDays}
              autoFocus
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancel} onPress={() => setCustomExtendOpen(false)}>
                <Text style={[styles.modalCancelText, { color: palette.text.secondary }]}>Отмена</Text>
              </Pressable>
              <Pressable
                style={[styles.modalConfirm, { backgroundColor: palette.accent.primary }]}
                onPress={() => {
                  const n = parseInt(customDays, 10);
                  if (!Number.isFinite(n) || n <= 0) {
                    Alert.alert('Неверное число', 'Введите положительное число дней.');
                    return;
                  }
                  setCustomExtendOpen(false);
                  extendMutation.mutate(n);
                }}
              >
                <Text style={styles.modalConfirmText}>Продлить</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function InfoRow({
  label,
  value,
  valueColor,
  palette,
  last,
}: {
  label: string;
  value: string;
  valueColor?: string;
  palette: ReturnType<typeof useColors>;
  last?: boolean;
}) {
  return (
    <View
      style={[
        styles.infoRow,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border.subtle },
      ]}
    >
      <Text style={[styles.infoLabel, { color: palette.text.secondary }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: valueColor ?? palette.text.primary }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function MetricBox({
  value,
  label,
  surfaceCard,
  palette,
}: {
  value: string;
  label: string;
  surfaceCard: object;
  palette: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[styles.metricBox, surfaceCard]}>
      <Text style={[styles.metricValue, { color: palette.text.primary }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={[styles.metricLabel, { color: palette.text.tertiary }]} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

function ActionButton({
  icon,
  label,
  onPress,
  loading,
  danger,
  palette,
  surfaceCard,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  loading?: boolean;
  danger?: boolean;
  palette: ReturnType<typeof useColors>;
  surfaceCard: object;
}) {
  const tint = danger ? colors.red[600] : palette.text.primary;
  return (
    <Pressable onPress={onPress} disabled={loading} style={[styles.actionBtn, surfaceCard]}>
      <Ionicons name={icon} size={20} color={tint} />
      <Text style={[styles.actionLabel, { color: tint }]}>{label}</Text>
      {loading ? (
        <ActivityIndicator size="small" color={palette.accent.primary} />
      ) : (
        <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { alignItems: 'center' },
  scroll: { paddingHorizontal: spacing[4], paddingTop: spacing[1], gap: spacing[3] },
  card: { paddingHorizontal: spacing[4], paddingVertical: spacing[1] },
  summaryHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'transparent',
  },
  summaryTitle: { fontSize: 16, fontWeight: '700' },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing[3],
    gap: spacing[3],
  },
  infoLabel: { fontSize: 14 },
  infoValue: { fontSize: 14, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: spacing[2],
    marginLeft: spacing[1],
  },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2.5] },
  metricBox: { width: '47.5%', padding: spacing[3.5], gap: spacing[1] },
  metricValue: { fontSize: 19, fontWeight: '800', letterSpacing: -0.5 },
  metricLabel: { fontSize: 11.5, fontWeight: '500' },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3.5],
  },
  actionLabel: { fontSize: 15, fontWeight: '600', flex: 1 },
  impersonateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[4],
    borderRadius: borderRadius['2xl'],
    marginTop: spacing[1],
  },
  impersonateText: { color: colors.white, fontSize: 16, fontWeight: '700' },
  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[6],
  },
  modalCard: {
    width: '100%',
    borderRadius: borderRadius['2xl'],
    padding: spacing[5],
    gap: spacing[3],
    ...Platform.select({ ios: { shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 24 }, android: { elevation: 12 } }),
  },
  modalTitle: { fontSize: 17, fontWeight: '700' },
  modalInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    fontSize: 16,
  },
  modalActions: { flexDirection: 'row', gap: spacing[3], marginTop: spacing[1] },
  modalCancel: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing[3] },
  modalCancelText: { fontSize: 15, fontWeight: '600' },
  modalConfirm: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[3],
    borderRadius: borderRadius.xl,
  },
  modalConfirmText: { color: colors.white, fontSize: 15, fontWeight: '700' },
});
