import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, RefreshControl, TouchableOpacity } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import IosScreenHeader from '../components/IosScreenHeader';
import { Text } from '../platform/Typography';
import { ListSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import AnimatedCard from '../components/AnimatedCard';
import { debtsApi } from '../api/services';
import { useColors } from '../contexts/ThemeContext';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { formatPhone } from '../../../shared/validation/phone';
import { haptic } from '../platform/haptics';
import type { Debtor } from '../../../shared/types';

function formatMoney(v: number): string {
  return (
    Math.round(Math.abs(v))
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
  );
}

// ── DebtorRow ───────────────────────────────────────────────────────────
// Module-scope memo'd row so a pull-to-refresh / background revalidation
// that rebuilds the screen doesn't tear down + remount every row. Props
// are primitive + stable (onPress via useCallback in the parent).
interface DebtorRowProps {
  item: Debtor;
  index: number;
  onPress: (clientId: string) => void;
  cardBg: string;
  borderColor: string;
  textPrimary: string;
  textTertiary: string;
}
const DebtorRow = React.memo(function DebtorRow({
  item,
  index,
  onPress,
  cardBg,
  borderColor,
  textPrimary,
  textTertiary,
}: DebtorRowProps) {
  return (
    <AnimatedCard
      style={[styles.card, { backgroundColor: cardBg, borderColor }]}
      index={index}
      onPress={() => onPress(item.clientId)}
    >
      <View style={styles.row}>
        <View style={styles.iconCircle}>
          <Ionicons name="wallet-outline" size={18} color={colors.red[600]} />
        </View>
        <View style={styles.info}>
          <Text style={[styles.name, { color: textPrimary }]} numberOfLines={1}>
            {item.name}
          </Text>
          {item.phone ? (
            <Text style={[styles.phone, { color: textTertiary }]} numberOfLines={1}>
              {formatPhone(item.phone)}
            </Text>
          ) : null}
        </View>
        <View style={styles.balanceWrap}>
          <Text style={styles.balance} numberOfLines={1} adjustsFontSizeToFit>
            {formatMoney(item.balance)}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={textTertiary} />
        </View>
      </View>
    </AnimatedCard>
  );
});

export default function DebtorsScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const [refreshing, setRefreshing] = useState(false);

  const { data: debtorsRaw, isLoading } = useQuery<Debtor[]>({
    queryKey: ['debts', 'debtors'],
    queryFn: async () => {
      const res = await debtsApi.debtors();
      return Array.isArray(res.data) ? res.data : [];
    },
  });

  // Defensive: backend already returns balance-desc, but never trust the
  // wire — sort locally so the biggest debtor is always on top.
  const debtors = useMemo(
    () => (debtorsRaw ? [...debtorsRaw].sort((a, b) => b.balance - a.balance) : undefined),
    [debtorsRaw],
  );

  const totalDebt = useMemo(() => (debtors ?? []).reduce((sum, d) => sum + (d.balance || 0), 0), [debtors]);

  const handlePress = useCallback(
    (clientId: string) => {
      haptic('select');
      navigation.navigate('ClientDetail', { id: clientId });
    },
    [navigation],
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['debts', 'debtors'] });
    setRefreshing(false);
  };

  const renderItem = useCallback(
    ({ item, index }: { item: Debtor; index: number }) => (
      <DebtorRow
        item={item}
        index={index}
        onPress={handlePress}
        cardBg={palette.bg.card}
        borderColor={palette.border.subtle}
        textPrimary={palette.text.primary}
        textTertiary={palette.text.tertiary}
      />
    ),
    [handlePress, palette.bg.card, palette.border.subtle, palette.text.primary, palette.text.tertiary],
  );

  // Summary card — total outstanding + debtor count. Rendered as the
  // list header so it shares the same scroll surface as the rows.
  const listHeader =
    debtors && debtors.length > 0 ? (
      <View style={[styles.summaryCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryLabel, { color: palette.text.tertiary }]}>Должников</Text>
          <Text style={[styles.summaryValue, { color: palette.text.primary }]}>{debtors.length}</Text>
        </View>
        <View style={[styles.summaryDivider, { backgroundColor: palette.border.subtle }]} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryLabel, { color: palette.text.tertiary }]}>Общий долг</Text>
          <Text style={[styles.summaryValue, styles.summaryValueDebt]} numberOfLines={1} adjustsFontSizeToFit>
            {formatMoney(totalDebt)}
          </Text>
        </View>
      </View>
    ) : null;

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Долги клиентов" onBack={() => navigation.goBack()} centerTitle />

      {debtors === undefined ? (
        <ListSkeleton count={6} />
      ) : debtors.length === 0 ? (
        <EmptyState
          icon="shield-check"
          title="Должников нет"
          description="Ни у одного клиента нет непогашенной задолженности"
        />
      ) : (
        <FlashList
          data={debtors}
          keyExtractor={(i) => i.clientId}
          renderItem={renderItem}
          ListHeaderComponent={listHeader}
          contentContainerStyle={styles.list}
          contentInset={{ bottom: tabBarHeight }}
          scrollIndicatorInsets={{ bottom: tabBarHeight }}
          removeClippedSubviews
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  list: { paddingHorizontal: spacing[4], paddingTop: spacing[1] },

  // Summary card
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing[4],
    marginBottom: spacing[3],
  },
  summaryItem: { flex: 1, alignItems: 'center', gap: 4 },
  summaryDivider: { width: StyleSheet.hairlineWidth, height: 36 },
  summaryLabel: { fontSize: 12, fontWeight: fontWeight.medium },
  summaryValue: { fontSize: 20, fontWeight: fontWeight.bold, letterSpacing: -0.4 },
  summaryValueDebt: { color: colors.red[600], paddingHorizontal: spacing[2] },

  // Row
  card: {
    borderRadius: borderRadius['2xl'],
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
    marginBottom: spacing[2.5],
    borderWidth: StyleSheet.hairlineWidth,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.red[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, letterSpacing: -0.2 },
  phone: { fontSize: 13 },
  balanceWrap: { flexDirection: 'row', alignItems: 'center', gap: spacing[1], maxWidth: 150 },
  balance: { fontSize: 17, fontWeight: fontWeight.bold, color: colors.red[600], letterSpacing: -0.3 },
});
