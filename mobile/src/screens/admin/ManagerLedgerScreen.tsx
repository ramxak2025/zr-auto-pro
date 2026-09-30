/**
 * ManagerLedgerScreen — «Расчёты» кабинета менеджера: сколько он должен владельцу платформы
 * и из чего сложился долг.
 *
 *   • Карточка «Долг владельцу» = Σ долей владельца по платным оплатам − Σ расчётов
 *     (`ledger.balance`, сервер считает за всё время). Красная, пока менеджер должен.
 *   • Плитки месяца из `managerApi.summary`: оплаты, доля владельца и «Моя доля» (100 − доля владельца).
 *   • Лента оплат и расчётов, новые сверху, за 12 мес.; «Показать за 36 мес.» — максимум сервера.
 *
 * Расчёты вносит только владелец платформы, поэтому кнопок записи и удаления здесь нет.
 * Данные — ключи ['manager', …], в persistent cache не попадают (деньги не кешируем на диск).
 */
import React from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { managerApi } from '../../api/services';
import IosScreenHeader from '../../components/IosScreenHeader';
import { Text } from '../../platform/Typography';
import { useColors } from '../../contexts/ThemeContext';
import { useIosSurface } from '../../platform/iosSurface';
import { colors, spacing } from '../../theme';
import { useAdminTabBarScrollInsets } from '../../hooks/useAdminTabBarHeight';
import type { ManagerLedger, ManagerSummary } from '../../../../shared/types';
import { MetricTile, balanceCaption, balanceColor, formatMoneyExact, formatPercent } from './adminShared';
import {
  LEDGER_MONTHS_DEFAULT,
  LEDGER_MONTHS_MAX,
  LedgerFeedRow,
  LedgerFeedTail,
  buildLedgerFeed,
  type LedgerFeedItem,
} from './LedgerFeed';

const keyExtractor = (item: LedgerFeedItem) => item.key;
const renderItem = ({ item }: { item: LedgerFeedItem }) => <LedgerFeedRow item={item} />;

export default function ManagerLedgerScreen() {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const surface = useIosSurface();
  const queryClient = useQueryClient();
  const { contentInset, contentContainerPaddingBottom } = useAdminTabBarScrollInsets();
  const [months, setMonths] = React.useState(LEDGER_MONTHS_DEFAULT);
  const [refreshing, setRefreshing] = React.useState(false);

  const { data: summary } = useQuery<ManagerSummary>({
    queryKey: ['manager', 'summary'],
    queryFn: async () => (await managerApi.summary()).data,
    placeholderData: (prev) => prev,
  });

  const {
    data: ledger,
    isLoading,
    isError,
    isPlaceholderData,
    refetch,
  } = useQuery<ManagerLedger>({
    queryKey: ['manager', 'ledger', months],
    queryFn: async () => (await managerApi.ledger({ months })).data,
    placeholderData: (prev) => prev,
  });

  const feed = React.useMemo(() => buildLedgerFeed(ledger), [ledger]);

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetch(), queryClient.invalidateQueries({ queryKey: ['manager', 'summary'] })]);
    setRefreshing(false);
  }, [refetch, queryClient]);

  const showMore = React.useCallback(() => setMonths(LEDGER_MONTHS_MAX), []);

  // Долг считается за всё время и не зависит от окна ленты — берём из того ответа, что уже пришёл.
  const balance = ledger?.balance ?? summary?.balance;
  const overpaid = balance !== undefined && balance <= -0.005;
  const myPercent = summary ? Math.max(0, 100 - summary.ownerSharePercent) : null;
  const money = (value: number | undefined) => (value === undefined ? '—' : formatMoneyExact(value));

  const header = (
    <View style={styles.headerBlock}>
      <View style={[styles.balanceCard, surface.card]}>
        <Text style={[styles.balanceLabel, { color: palette.text.secondary }]}>Долг владельцу</Text>
        <Text
          style={[
            styles.balanceValue,
            { color: balance === undefined ? palette.text.primary : balanceColor(balance, palette) },
          ]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
        >
          {money(balance)}
        </Text>
        {overpaid ? (
          <Text style={[styles.balanceSub, { color: palette.text.secondary }]}>{balanceCaption(balance)}</Text>
        ) : null}
        {summary ? (
          <Text style={[styles.balanceSub, { color: palette.text.tertiary }]}>
            Доля владельца за всё время {formatMoneyExact(summary.ownerShareTotal)} · передано{' '}
            {formatMoneyExact(summary.settledTotal)}
          </Text>
        ) : null}
      </View>

      <View style={styles.grid}>
        <MetricTile
          icon="card-outline"
          tint={colors.primary[600]}
          value={money(summary?.paidThisMonth)}
          label="Оплат за месяц"
          surfaceCard={surface.card}
          palette={palette}
        />
        <MetricTile
          icon="wallet-outline"
          tint={colors.orange[500]}
          value={money(summary?.ownerShareThisMonth)}
          label="Доля владельца за месяц"
          surfaceCard={surface.card}
          palette={palette}
        />
        <MetricTile
          icon="trending-up-outline"
          tint={colors.green[600]}
          value={money(summary?.myShareThisMonth)}
          label={myPercent === null ? 'Моя доля за месяц' : `Моя доля за месяц · ${formatPercent(myPercent)}`}
          surfaceCard={surface.card}
          palette={palette}
        />
        <MetricTile
          icon="receipt-outline"
          tint={colors.purple[700]}
          value={money(summary?.paidTotal)}
          label="Оплат всего"
          surfaceCard={surface.card}
          palette={palette}
        />
      </View>

      <Text style={[styles.sectionLabel, { color: palette.text.tertiary }]}>Оплаты и расчёты</Text>
    </View>
  );

  const footer = (
    <LedgerFeedTail
      months={months}
      count={feed.length}
      hasData={!!ledger}
      isLoading={isLoading}
      isError={isError}
      isPlaceholder={isPlaceholderData}
      onRetry={() => void refetch()}
      onShowMore={showMore}
    />
  );

  return (
    <View style={[styles.root, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Расчёты" subtitle="С владельцем платформы" onBack={() => navigation.goBack()} />
      <FlatList
        data={feed}
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
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  listContent: { paddingHorizontal: spacing[4], paddingTop: spacing[1], gap: spacing[2.5] },
  headerBlock: { gap: spacing[3] },
  balanceCard: { padding: spacing[5], gap: spacing[1] },
  balanceLabel: { fontSize: 13, fontWeight: '600' },
  balanceValue: { fontSize: 34, fontWeight: '800', letterSpacing: -1, fontVariant: ['tabular-nums'] },
  balanceSub: { fontSize: 13, lineHeight: 18 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: spacing[2],
    marginLeft: spacing[1],
  },
});
