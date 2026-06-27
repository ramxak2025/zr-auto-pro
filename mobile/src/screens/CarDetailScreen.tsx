/**
 * CarDetailScreen — dedicated drill-down for ONE car of a client.
 *
 * Reached from ClientDetailScreen's «Гараж» — tapping a car card pushes
 * THIS screen (with a selection haptic). It answers «что мы делали с этой
 * машиной?» in one place:
 *   • hero — модель + ГОСТ-плашка госномера + владелец;
 *   • per-car stats — визитов / потрачено / последний визит / пробег;
 *   • история чеков ЭТОГО авто, сгруппированная по датам (как в карточке
 *     клиента).
 *
 * Data: ONLY existing endpoints. `carsApi.checks(carId, { limit })` gives
 * the car's checks; the stats are derived client-side EXACTLY like the
 * `carStats` memo on ClientDetailScreen (spend = sum of non-returned check
 * totals; lastMileage = mileage of the latest check that carries one).
 *
 * Cache key `['car-checks', carId, 'full']` — distinct from CarsScreen's
 * `['car-checks', carId]` (limit 20) so the two don't fight over one slot,
 * yet still covered by the `invalidateQueries(['car-checks'])` prefix that
 * ClientDetailScreen fires after a car edit/delete, so the list stays fresh.
 *
 * Android-safe: no iOS-only APIs; haptics go through the platform helper.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, RefreshControl, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRoute, useNavigation } from '@react-navigation/native';
import { carsApi } from '../api/services';
import IosScreenHeader from '../components/IosScreenHeader';
import SectionHeader from '../components/SectionHeader';
import { useColors } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { colors, fontSize, fontWeight, borderRadius, spacing, getBadgeColors, paymentMethodBadgeColor } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { haptic } from '../platform/haptics';
import type { Check } from '../../../shared/types';

const paymentLabels: Record<string, string> = {
  cash: 'Наличные',
  card: 'Карта',
  warranty: 'Гарантия',
  cash_card: 'Нал/Карта',
};

function formatMoney(v: number): string {
  return (
    Math.round(v)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
  );
}
function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function formatTime(d: string): string {
  return new Date(d).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}
function formatDateGroup(d: string): string {
  const dt = new Date(d);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (dt.toDateString() === today.toDateString()) return 'Сегодня';
  if (dt.toDateString() === yesterday.toDateString()) return 'Вчера';
  return dt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

// Same deterministic colour hash ClientDetailScreen uses for car icons, so
// the same car keeps the same accent across both screens.
const carIconColors = [
  colors.primary[500],
  colors.green[600],
  colors.orange[500],
  colors.purple[700],
  colors.teal[600],
  colors.rose[500],
];
function getCarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return carIconColors[Math.abs(hash) % carIconColors.length];
}

type CarDetailParams = {
  carId: string;
  clientId?: string;
  clientName?: string;
  makeModel?: string;
  plateNumber?: string;
  noPlate?: boolean;
};

export default function CarDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const palette = useColors();
  const { hasPermission } = useAuth();
  const tabBarHeight = useTabBarHeight();
  const canViewProfit = hasPermission('profit_view');

  const { carId, clientId, clientName, makeModel, plateNumber, noPlate } = route.params as CarDetailParams;
  const [refreshing, setRefreshing] = useState(false);

  // Car's checks — DESC by date from backend. Distinct cache slot ('full')
  // from CarsScreen's inline preview, still reachable by the broad
  // `['car-checks']` invalidation ClientDetailScreen fires on car mutations.
  const {
    data: checks,
    isLoading,
    isFetching,
  } = useQuery<Check[]>({
    queryKey: ['car-checks', carId, 'full'],
    queryFn: async () => {
      const res = await carsApi.checks(carId, { limit: 200 });
      return Array.isArray(res.data) ? res.data : [];
    },
  });

  // Per-car analytics — derived EXACTLY like ClientDetailScreen.carStats:
  //   • spent      — sum of this car's check totals, net of returns;
  //   • lastMileage — mileage of the most-recent check that carries one;
  //   • lastVisit  — latest check date;
  //   • count      — number of checks (visits).
  const stats = useMemo(() => {
    const list = checks || [];
    let spent = 0;
    let lastVisit: Date | null = null;
    let lastMileage: number | null = null;
    let lastMileageAt = 0;
    for (const c of list) {
      if (!c.isReturned) spent += c.totalRevenue || 0;
      const t = new Date(c.date).getTime();
      if (!lastVisit || t > lastVisit.getTime()) lastVisit = new Date(c.date);
      if (typeof c.mileage === 'number' && c.mileage > 0 && t >= lastMileageAt) {
        lastMileage = c.mileage;
        lastMileageAt = t;
      }
    }
    return { count: list.length, spent, lastVisit, lastMileage };
  }, [checks]);

  // Group checks by date for the history list — same calm date-divider
  // rhythm the client card uses.
  const grouped = useMemo(() => {
    const groups: { label: string; checks: Check[] }[] = [];
    let last = '';
    for (const check of checks || []) {
      const g = formatDateGroup(check.date);
      if (g !== last) {
        groups.push({ label: g, checks: [check] });
        last = g;
      } else {
        groups[groups.length - 1].checks.push(check);
      }
    }
    return groups;
  }, [checks]);

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['car-checks', carId, 'full'] });
    setRefreshing(false);
  };

  // Robust from anywhere (CarDetail can sit on MoreStack OR the root stack):
  // address the Checks tab's CheckDetail explicitly, mirroring ClientDetail.
  const openCheck = (checkId: string) => {
    navigation.navigate('Main', {
      screen: 'Checks',
      params: { screen: 'CheckDetail', params: { id: checkId } },
    });
  };

  const carColor = getCarColor(carId);
  const plate = (plateNumber || '').toUpperCase();
  const title = makeModel || plate || 'Автомобиль';

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title={title} subtitle={plate || undefined} onBack={() => navigation.goBack()} centerTitle />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + spacing[6] }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.accent.primary} />
        }
      >
        {/* HERO — car identity: icon + модель + ГОСТ-плашка + владелец. */}
        <View style={[styles.hero, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
          <View style={[styles.heroIcon, { backgroundColor: carColor + '18' }]}>
            <Ionicons name="car-sport" size={30} color={carColor} />
          </View>
          <Text style={[styles.heroModel, { color: palette.text.primary }]} numberOfLines={2}>
            {makeModel || 'Без модели'}
          </Text>
          {plate ? (
            <View style={styles.heroPlateBadge}>
              <Text style={styles.heroPlateText}>{plate}</Text>
            </View>
          ) : (
            <View style={[styles.heroNoPlate, { backgroundColor: palette.bg.muted }]}>
              <Text style={[styles.heroNoPlateText, { color: palette.text.tertiary }]}>
                {noPlate ? 'Без номера' : 'Номер не указан'}
              </Text>
            </View>
          )}
          {clientName ? (
            <TouchableOpacity
              style={[styles.ownerChip, { backgroundColor: palette.bg.muted }]}
              activeOpacity={clientId ? 0.7 : 1}
              disabled={!clientId}
              onPress={() => {
                if (!clientId) return;
                haptic('tap');
                navigation.navigate('ClientDetail', { id: clientId });
              }}
            >
              <Ionicons name="person-outline" size={13} color={palette.text.secondary} />
              <Text style={[styles.ownerChipText, { color: palette.text.secondary }]} numberOfLines={1}>
                {clientName}
              </Text>
              {clientId ? <Ionicons name="chevron-forward" size={13} color={palette.text.tertiary} /> : null}
            </TouchableOpacity>
          ) : null}
        </View>

        {/* STATS — 2×2 tile grid: визитов / потрачено / последний визит / пробег. */}
        <View style={styles.statsGrid}>
          <StatTile
            icon="receipt-outline"
            label="Визитов"
            value={String(stats.count)}
            palette={palette}
            accent={palette.accent.primary}
          />
          <StatTile
            icon="wallet-outline"
            label="Потрачено"
            value={formatMoney(stats.spent)}
            palette={palette}
            accent={colors.green[600]}
          />
          <StatTile
            icon="calendar-outline"
            label="Последний визит"
            value={stats.lastVisit ? formatDate(stats.lastVisit.toISOString()) : '—'}
            palette={palette}
            accent={colors.purple[700]}
          />
          <StatTile
            icon="speedometer-outline"
            label="Пробег"
            value={stats.lastMileage != null ? `${stats.lastMileage.toLocaleString('ru-RU')} км` : '—'}
            palette={palette}
            accent={colors.orange[500]}
          />
        </View>

        {/* HISTORY — checks for THIS car, grouped by date. */}
        <SectionHeader title="История чеков" count={checks ? checks.length : null} />

        {checks === undefined && isLoading ? (
          <View style={[styles.stateCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
            <ActivityIndicator size="small" color={palette.accent.primary} />
          </View>
        ) : !checks || checks.length === 0 ? (
          <View style={[styles.stateCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
            <View style={[styles.stateIcon, { backgroundColor: palette.bg.muted }]}>
              <Ionicons name="receipt-outline" size={22} color={palette.text.tertiary} />
            </View>
            <Text style={[styles.stateText, { color: palette.text.secondary }]}>
              {isFetching ? 'Загрузка…' : 'Нет чеков по этому авто'}
            </Text>
          </View>
        ) : (
          grouped.map((group, gi) => (
            <View key={group.label + gi}>
              <View style={styles.dateGroupHeader}>
                <View style={[styles.dateGroupLine, { backgroundColor: palette.border.subtle }]} />
                <Text style={[styles.dateGroupText, { color: palette.text.tertiary }]}>{group.label}</Text>
                <View style={[styles.dateGroupLine, { backgroundColor: palette.border.subtle }]} />
              </View>
              {group.checks.map((check) => (
                <CarCheckRow
                  key={check.id}
                  check={check}
                  palette={palette}
                  canViewProfit={canViewProfit}
                  onOpen={openCheck}
                />
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

// ── Sub-components ────────────────────────────────────────────────────

interface StatTileProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  accent: string;
  palette: ReturnType<typeof useColors>;
}
function StatTile({ icon, label, value, accent, palette }: StatTileProps) {
  return (
    <View style={[styles.statTile, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
      <View style={[styles.statTileIcon, { backgroundColor: accent + '18' }]}>
        <Ionicons name={icon} size={15} color={accent} />
      </View>
      <Text
        style={[styles.statTileValue, { color: palette.text.primary }]}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.7}
      >
        {value}
      </Text>
      <Text style={[styles.statTileLabel, { color: palette.text.tertiary }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

interface CarCheckRowProps {
  check: Check;
  palette: ReturnType<typeof useColors>;
  canViewProfit: boolean;
  onOpen: (checkId: string) => void;
}
const CarCheckRow = React.memo(function CarCheckRow({ check, palette, canViewProfit, onOpen }: CarCheckRowProps) {
  const badgeKey = paymentMethodBadgeColor[check.paymentMethod] || 'gray';
  const badge = getBadgeColors(palette.mode)[badgeKey];
  return (
    <TouchableOpacity
      style={[styles.checkCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
      onPress={() => onOpen(check.id)}
      activeOpacity={0.7}
    >
      <View style={[styles.accentBar, { backgroundColor: check.isDeferred ? colors.red[400] : colors.primary[400] }]} />
      <View style={styles.checkContent}>
        <View style={styles.checkHeader}>
          <View style={styles.checkHeaderLeft}>
            <Text style={[styles.checkNumber, { color: palette.text.primary }]}>#{check.number}</Text>
            {check.isReturned ? (
              <View style={[styles.returnBadge, { backgroundColor: colors.red[100] }]}>
                <Text style={[styles.returnText, { color: colors.red[700] }]}>Возврат</Text>
              </View>
            ) : null}
            <View style={[styles.paymentBadge, { backgroundColor: badge.bg }]}>
              <Text style={[styles.paymentBadgeText, { color: badge.text }]}>
                {paymentLabels[check.paymentMethod] ?? check.paymentMethod}
              </Text>
            </View>
          </View>
          <Text style={[styles.checkTotal, { color: palette.text.primary }]}>{formatMoney(check.totalRevenue)}</Text>
        </View>
        <View style={styles.checkFooter}>
          <Text style={[styles.footerTime, { color: palette.text.tertiary }]}>{formatTime(check.date)}</Text>
          {check.master ? (
            <Text style={[styles.footerMaster, { color: palette.text.tertiary }]} numberOfLines={1}>
              {check.master.fullName}
            </Text>
          ) : (
            <View style={{ flex: 1 }} />
          )}
          {typeof check.mileage === 'number' && check.mileage > 0 ? (
            <Text style={[styles.footerMileage, { color: palette.text.tertiary }]}>
              {check.mileage.toLocaleString('ru-RU')} км
            </Text>
          ) : null}
          {canViewProfit && check.profit !== undefined ? (
            <Text style={[styles.footerProfit, check.profit >= 0 ? styles.profitPositive : styles.profitNegative]}>
              {check.profit >= 0 ? '+' : ''}
              {formatMoney(check.profit)}
            </Text>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing[4], gap: spacing[3] },

  // Hero
  hero: {
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[5],
    paddingBottom: spacing[4],
    alignItems: 'center',
  },
  heroIcon: {
    width: 64,
    height: 64,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroModel: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.4,
    textAlign: 'center',
    marginTop: spacing[3],
  },
  // ГОСТ-style plate — physical plates are white with black glyphs in BOTH
  // themes, so this badge is intentionally theme-independent (mirrors the
  // carPlateBadge on ClientDetailScreen).
  heroPlateBadge: {
    marginTop: spacing[2],
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: '#0A0A0A',
    backgroundColor: '#FFFFFF',
  },
  heroPlateText: { fontSize: 15, fontWeight: '800', letterSpacing: 1.5, color: '#0A0A0A' },
  heroNoPlate: {
    marginTop: spacing[2],
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 7,
  },
  heroNoPlateText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  ownerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: spacing[3],
    paddingLeft: 10,
    paddingRight: 8,
    paddingVertical: 5,
    borderRadius: 999,
    maxWidth: '90%',
  },
  ownerChipText: { fontSize: 13, fontWeight: '600', flexShrink: 1 },

  // Stats grid (2×2)
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2.5],
  },
  statTile: {
    flexGrow: 1,
    flexBasis: '47%',
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
    gap: 4,
  },
  statTileIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[1],
  },
  statTileValue: { fontSize: 17, fontWeight: '700', letterSpacing: -0.3, fontVariant: ['tabular-nums'] },
  statTileLabel: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3 },

  // State cards (loading / empty)
  stateCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[6],
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    gap: spacing[3],
    marginTop: spacing[1],
  },
  stateIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stateText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },

  // Date group headers (match ClientDetailScreen rhythm)
  dateGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[2.5],
    marginTop: spacing[1],
  },
  dateGroupLine: { flex: 1, height: 1 },
  dateGroupText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Check card
  checkCard: {
    flexDirection: 'row',
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: spacing[2],
  },
  accentBar: { width: 3.5 },
  checkContent: { flex: 1, paddingHorizontal: spacing[3], paddingVertical: spacing[2.5] },
  checkHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing[1.5],
  },
  checkHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5], flex: 1 },
  checkNumber: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  returnBadge: { paddingHorizontal: spacing[1.5], paddingVertical: 1, borderRadius: borderRadius.full },
  returnText: { fontSize: 9, fontWeight: fontWeight.bold },
  paymentBadge: { paddingHorizontal: spacing[1.5], paddingVertical: 1, borderRadius: borderRadius.full },
  paymentBadgeText: { fontSize: 10, fontWeight: fontWeight.medium },
  checkTotal: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  checkFooter: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  footerTime: { fontSize: 11 },
  footerMaster: { fontSize: 11, flex: 1 },
  footerMileage: { fontSize: 11, fontVariant: ['tabular-nums'] },
  footerProfit: { fontSize: 11, fontWeight: fontWeight.bold },
  profitPositive: { color: colors.green[600] },
  profitNegative: { color: colors.red[500] },
});
