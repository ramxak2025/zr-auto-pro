/**
 * AdminManagerDetailScreen — менеджер платформы глазами суперадмина.
 *
 *   • Баланс: долг менеджера = Σ долей владельца по платным оплатам − Σ расчётов; «Внести расчёт».
 *   • Профиль и доля владельца (правка — карандаш в шапке: доля, активность, пароль).
 *   • Клиенты менеджера: тап открывает карточку автосервиса, «⇄» — передать другому менеджеру
 *     или снять с менеджера (долг по уже проведённым оплатам остаётся за тем, кто их провёл).
 *   • Лента оплат и расчётов за 12 мес. (до 36); расчёт можно удалить — баланс пересчитается.
 * Данные — ключи ['admin-managers', …], в persistent cache не попадают (деньги не кешируем на диск).
 */
import React from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import { adminManagersApi } from '../../api/services';
import IosScreenHeader from '../../components/IosScreenHeader';
import { Text } from '../../platform/Typography';
import { haptic } from '../../platform/haptics';
import { useColors } from '../../contexts/ThemeContext';
import { useIosSurface } from '../../platform/iosSurface';
import { borderRadius, colors, spacing } from '../../theme';
import type { SemanticPalette } from '../../theme/palette';
import { useAdminTabBarScrollInsets } from '../../hooks/useAdminTabBarHeight';
import { extractApiErrorMessage } from '../../utils/apiError';
import { formatPhone } from '../../../../shared/validation/phone';
import type { ManagerLedger, ManagerSettlement, PlatformManagerDetail, Tenant } from '../../../../shared/types';
import {
  MetricTile,
  StatusChip,
  balanceCaption,
  balanceColor,
  formatDate,
  formatDayMonth,
  formatMoneyExact,
  formatPercent,
  inactiveStatusInfo,
  invalidatePlatformQueries,
  tenantRowStatus,
} from './adminShared';
import {
  LEDGER_MONTHS_DEFAULT,
  LEDGER_MONTHS_MAX,
  LedgerFeedRow,
  LedgerFeedTail,
  buildLedgerFeed,
  type LedgerFeedItem,
} from './LedgerFeed';
import ManagerFormSheet from './ManagerFormSheet';
import SettlementSheet from './SettlementSheet';
import TransferManagerSheet from './TransferManagerSheet';

type DetailRow =
  | { kind: 'label'; key: string; title: string }
  | { kind: 'note'; key: string; text: string }
  | { kind: 'client'; key: string; tenant: Tenant }
  | { kind: 'feed'; key: string; item: LedgerFeedItem };

const keyExtractor = (row: DetailRow) => row.key;

const ClientRow = React.memo(function ClientRow({
  tenant,
  palette,
  surfaceCard,
  onOpen,
  onTransfer,
}: {
  tenant: Tenant;
  palette: SemanticPalette;
  surfaceCard: object;
  onOpen: (id: string) => void;
  onTransfer: (tenant: Tenant) => void;
}) {
  const until = tenant.subscriptionEnd ? `до ${formatDayMonth(tenant.subscriptionEnd)}` : 'без подписки';
  return (
    <Pressable onPress={() => onOpen(tenant.id)} style={[styles.clientRow, surfaceCard]}>
      <View style={styles.clientBody}>
        <Text style={[styles.name, { color: palette.text.primary }]} numberOfLines={1}>
          {tenant.name}
        </Text>
        <Text style={[styles.meta, { color: palette.text.tertiary }]} numberOfLines={1}>
          {tenant.plan?.name || 'Без тарифа'} · {until}
        </Text>
      </View>
      <StatusChip status={tenantRowStatus(tenant, palette.mode)} />
      <Pressable
        onPress={() => onTransfer(tenant)}
        hitSlop={6}
        style={[styles.transferBtn, { backgroundColor: palette.accent.primarySoft }]}
        accessibilityRole="button"
        accessibilityLabel="Передать другому менеджеру"
      >
        <Ionicons name="swap-horizontal-outline" size={18} color={palette.accent.primaryText} />
      </Pressable>
    </Pressable>
  );
});

function InfoRow({
  label,
  value,
  palette,
  last,
}: {
  label: string;
  value: string;
  palette: SemanticPalette;
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
      <Text style={[styles.infoValue, { color: palette.text.primary }]} numberOfLines={3}>
        {value}
      </Text>
    </View>
  );
}

export default function AdminManagerDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const id: string = route.params?.id;
  const palette = useColors();
  const surface = useIosSurface();
  const queryClient = useQueryClient();
  const { contentInset, contentContainerPaddingBottom } = useAdminTabBarScrollInsets();

  const [months, setMonths] = React.useState(LEDGER_MONTHS_DEFAULT);
  const [refreshing, setRefreshing] = React.useState(false);
  const [editOpen, setEditOpen] = React.useState(false);
  const [settleOpen, setSettleOpen] = React.useState(false);
  // Клиент остаётся в state и после закрытия шторки — иначе она пропала бы без анимации.
  const [transferOpen, setTransferOpen] = React.useState(false);
  const [transferTenant, setTransferTenant] = React.useState<Tenant | null>(null);

  const {
    data: manager,
    isLoading,
    isError,
    refetch: refetchManager,
  } = useQuery<PlatformManagerDetail>({
    queryKey: ['admin-managers', 'detail', id],
    queryFn: async () => (await adminManagersApi.get(id)).data,
    enabled: !!id,
    placeholderData: (prev) => prev,
  });

  const {
    data: ledger,
    isLoading: ledgerLoading,
    isError: ledgerError,
    isPlaceholderData: ledgerPlaceholder,
    refetch: refetchLedger,
  } = useQuery<ManagerLedger>({
    queryKey: ['admin-managers', 'ledger', id, months],
    queryFn: async () => (await adminManagersApi.ledger(id, { months })).data,
    enabled: !!id,
    placeholderData: (prev) => prev,
  });

  const { mutate: removeSettlement } = useMutation({
    mutationFn: async (settlementId: string) => (await adminManagersApi.removeSettlement(id, settlementId)).data,
    onSuccess: () => {
      haptic('success');
      invalidatePlatformQueries(queryClient);
    },
    onError: (err) => {
      haptic('error');
      Alert.alert('Не удалось удалить расчёт', extractApiErrorMessage(err, 'Попробуйте ещё раз'));
    },
  });
  const onDeleteSettlement = React.useCallback(
    (settlement: ManagerSettlement) => removeSettlement(settlement.id),
    [removeSettlement],
  );

  const feed = React.useMemo(() => buildLedgerFeed(ledger), [ledger]);

  const rows = React.useMemo<DetailRow[]>(() => {
    const tenants = manager?.tenants ?? [];
    const out: DetailRow[] = [{ kind: 'label', key: 'clients-label', title: `Клиенты · ${tenants.length}` }];
    if (tenants.length === 0) out.push({ kind: 'note', key: 'clients-empty', text: 'У менеджера пока нет клиентов' });
    for (const tenant of tenants) out.push({ kind: 'client', key: `c-${tenant.id}`, tenant });
    out.push({ kind: 'label', key: 'ledger-label', title: 'Оплаты и расчёты' });
    for (const item of feed) out.push({ kind: 'feed', key: item.key, item });
    return out;
  }, [manager?.tenants, feed]);

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchManager(), refetchLedger()]);
    setRefreshing(false);
  }, [refetchManager, refetchLedger]);

  const showMore = React.useCallback(() => setMonths(LEDGER_MONTHS_MAX), []);

  const openTenant = React.useCallback(
    (tenantId: string) => {
      haptic('tap');
      navigation.navigate('AdminTenantDetail', { id: tenantId });
    },
    [navigation],
  );

  const openTransfer = React.useCallback((tenant: Tenant) => {
    haptic('tap');
    setTransferTenant(tenant);
    setTransferOpen(true);
  }, []);

  const renderItem = React.useCallback(
    ({ item }: { item: DetailRow }) => {
      switch (item.kind) {
        case 'label':
          return <Text style={[styles.sectionLabel, { color: palette.text.tertiary }]}>{item.title}</Text>;
        case 'note':
          return <Text style={[styles.noteText, { color: palette.text.tertiary }]}>{item.text}</Text>;
        case 'client':
          return (
            <ClientRow
              tenant={item.tenant}
              palette={palette}
              surfaceCard={surface.cardCompact}
              onOpen={openTenant}
              onTransfer={openTransfer}
            />
          );
        default:
          return <LedgerFeedRow item={item.item} onDeleteSettlement={onDeleteSettlement} />;
      }
    },
    [palette, surface.cardCompact, openTenant, openTransfer, onDeleteSettlement],
  );

  if (!manager) {
    return (
      <View style={[styles.root, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Менеджер" onBack={() => navigation.goBack()} />
        <View style={styles.stateBlock}>
          {isError && !isLoading ? (
            <>
              <Ionicons name="cloud-offline-outline" size={40} color={palette.text.tertiary} />
              <Text style={[styles.stateText, { color: palette.text.secondary }]}>Не удалось загрузить менеджера</Text>
              <Pressable
                onPress={() => {
                  haptic('tap');
                  void refetchManager();
                }}
                hitSlop={8}
              >
                <Text style={[styles.retryText, { color: palette.accent.primary }]}>Повторить</Text>
              </Pressable>
            </>
          ) : (
            <ActivityIndicator color={palette.accent.primary} />
          )}
        </View>
      </View>
    );
  }

  const { summary } = manager;
  const balance = manager.balance;
  const overpaid = balance <= -0.005;
  const managerPercent = Math.max(0, 100 - manager.ownerSharePercent);

  const header = (
    <View style={styles.headerBlock}>
      <View style={[styles.balanceCard, surface.card]}>
        <Text style={[styles.balanceLabel, { color: palette.text.secondary }]}>Долг менеджера</Text>
        <Text
          style={[styles.balanceValue, { color: balanceColor(balance, palette) }]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
        >
          {formatMoneyExact(balance)}
        </Text>
        {overpaid ? (
          <Text style={[styles.balanceSub, { color: palette.text.secondary }]}>{balanceCaption(balance)}</Text>
        ) : null}
        <Text style={[styles.balanceSub, { color: palette.text.tertiary }]}>
          Доля владельца за всё время {formatMoneyExact(summary.ownerShareTotal)} · внесено{' '}
          {formatMoneyExact(summary.settledTotal)}
        </Text>
        <Pressable
          onPress={() => {
            haptic('tap');
            setSettleOpen(true);
          }}
          style={[styles.primaryBtn, { backgroundColor: palette.accent.primary }]}
          accessibilityRole="button"
        >
          <Ionicons name="cash-outline" size={18} color={colors.white} />
          <Text style={styles.primaryBtnText}>Внести расчёт</Text>
        </Pressable>
      </View>

      <View style={[styles.infoCard, surface.card]}>
        <InfoRow label="Телефон" value={formatPhone(manager.phone)} palette={palette} />
        <InfoRow
          label="Доля владельца"
          value={`${formatPercent(manager.ownerSharePercent)} · менеджеру ${formatPercent(managerPercent)}`}
          palette={palette}
        />
        <View
          style={[
            styles.infoRow,
            { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border.subtle },
          ]}
        >
          <Text style={[styles.infoLabel, { color: palette.text.secondary }]}>Доступ</Text>
          {manager.isActive ? (
            <Text style={[styles.infoValue, { color: palette.text.primary }]}>Может входить</Text>
          ) : (
            <StatusChip status={inactiveStatusInfo(palette.mode)} />
          )}
        </View>
        {manager.note ? <InfoRow label="Заметка" value={manager.note} palette={palette} /> : null}
        <InfoRow label="Заведён" value={formatDate(manager.createdAt)} palette={palette} last />
      </View>

      <View style={styles.grid}>
        <MetricTile
          icon="people-outline"
          tint={colors.primary[600]}
          value={String(summary.tenants.total)}
          label="Клиентов"
          surfaceCard={surface.card}
          palette={palette}
        />
        <MetricTile
          icon="checkmark-circle"
          tint={colors.green[600]}
          value={String(summary.tenants.active)}
          label="Активных"
          surfaceCard={surface.card}
          palette={palette}
        />
        <MetricTile
          icon="hourglass-outline"
          tint={colors.amber[600]}
          value={String(summary.tenants.expiringIn7d)}
          label="Истекает за 7 дней"
          surfaceCard={surface.card}
          palette={palette}
        />
        <MetricTile
          icon="alert-circle-outline"
          tint={colors.red[500]}
          value={String(summary.tenants.expired)}
          label="Истекли"
          surfaceCard={surface.card}
          palette={palette}
        />
        <MetricTile
          icon="card-outline"
          tint={colors.blue[600]}
          value={formatMoneyExact(summary.paidThisMonth)}
          label="Оплат за месяц"
          surfaceCard={surface.card}
          palette={palette}
        />
        <MetricTile
          icon="wallet-outline"
          tint={colors.orange[500]}
          value={formatMoneyExact(summary.ownerShareThisMonth)}
          label="Доля владельца за месяц"
          surfaceCard={surface.card}
          palette={palette}
        />
      </View>
    </View>
  );

  const footer = (
    <LedgerFeedTail
      months={months}
      count={feed.length}
      hasData={!!ledger}
      isLoading={ledgerLoading}
      isError={ledgerError}
      isPlaceholder={ledgerPlaceholder}
      onRetry={() => void refetchLedger()}
      onShowMore={showMore}
    />
  );

  return (
    <View style={[styles.root, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title={manager.fullName}
        subtitle="Менеджер платформы"
        onBack={() => navigation.goBack()}
        trailing={
          <Pressable
            onPress={() => {
              haptic('tap');
              setEditOpen(true);
            }}
            style={[styles.headerBtn, { backgroundColor: palette.bg.muted }]}
            hitSlop={6}
            accessibilityRole="button"
            accessibilityLabel="Редактировать менеджера"
          >
            <Ionicons name="create-outline" size={20} color={palette.text.primary} />
          </Pressable>
        }
      />

      <FlatList
        data={rows}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ListHeaderComponent={header}
        ListFooterComponent={footer}
        contentInset={contentInset}
        contentContainerStyle={[styles.listContent, { paddingBottom: contentContainerPaddingBottom }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.accent.primary} />
        }
      />

      <ManagerFormSheet visible={editOpen} manager={manager} onClose={() => setEditOpen(false)} />
      <SettlementSheet
        visible={settleOpen}
        manager={{ id: manager.id, fullName: manager.fullName, balance: manager.balance }}
        onClose={() => setSettleOpen(false)}
      />
      <TransferManagerSheet
        visible={transferOpen}
        tenant={
          transferTenant
            ? {
                id: transferTenant.id,
                name: transferTenant.name,
                managerId: manager.id,
                managerName: manager.fullName,
              }
            : null
        }
        onClose={() => setTransferOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  listContent: { paddingHorizontal: spacing[4], paddingTop: spacing[1], gap: spacing[2.5] },
  headerBlock: { gap: spacing[3], marginBottom: spacing[1] },
  headerBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  balanceCard: { padding: spacing[5], gap: spacing[1] },
  balanceLabel: { fontSize: 13, fontWeight: '600' },
  balanceValue: { fontSize: 34, fontWeight: '800', letterSpacing: -1, fontVariant: ['tabular-nums'] },
  balanceSub: { fontSize: 13, lineHeight: 18 },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3.5],
    borderRadius: borderRadius['2xl'],
    marginTop: spacing[3],
  },
  primaryBtnText: { color: colors.white, fontSize: 16, fontWeight: '700' },
  infoCard: { paddingHorizontal: spacing[4], paddingVertical: spacing[1] },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing[3],
    gap: spacing[3],
  },
  infoLabel: { fontSize: 14 },
  infoValue: { fontSize: 14, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: spacing[2],
    marginLeft: spacing[1],
  },
  noteText: { fontSize: 14, paddingVertical: spacing[2], paddingHorizontal: spacing[1] },
  clientRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2.5], paddingVertical: spacing[3] },
  clientBody: { flex: 1, minWidth: 0 },
  name: { fontSize: 15, fontWeight: '700' },
  meta: { fontSize: 12, marginTop: 2 },
  transferBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  stateBlock: { alignItems: 'center', justifyContent: 'center', paddingTop: spacing[16], gap: spacing[3] },
  stateText: { fontSize: 15, textAlign: 'center' },
  retryText: { fontSize: 15, fontWeight: '600' },
});
