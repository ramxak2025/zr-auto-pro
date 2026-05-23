import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import IosScreenHeader from '../components/IosScreenHeader';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { carsApi } from '../api/services';
import SearchInput from '../components/SearchInput';
import { ListSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import FreshnessBadge from '../components/FreshnessBadge';
import { useColors } from '../contexts/ThemeContext';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { normalizePlateQuery, plateMatches, looksLikePlateQuery } from '../utils/plateNormalize';
import { haptic } from '../platform/haptics';
import type { Car, Check } from '../../../shared/types';

function formatDateShort(d?: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function formatMoney(v: number): string {
  return (
    Math.round(v)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
  );
}

export default function CarsScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const tabBarHeight = useTabBarHeight();
  const palette = useColors();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const limit = 30;
  const [refreshing, setRefreshing] = useState(false);
  // Inline-checks expansion — one car at a time. Setting to null
  // collapses everything (cheaper than rendering a list of expanded
  // states; the user usually scans one car at a time).
  const [expandedCarId, setExpandedCarId] = useState<string | null>(null);

  const carsQuery = useQuery<{ data: Car[]; total: number } | Car[]>({
    queryKey: ['cars', { search, page, limit }],
    queryFn: async () => {
      const res = await carsApi.getAll({ search, page, limit });
      return res.data;
    },
    placeholderData: (prev) => prev,
  });
  const { data, isLoading, isFetching, dataUpdatedAt } = carsQuery;

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['cars'] });
    setRefreshing(false);
  };

  const rawCars = useMemo<Car[]>(
    () => (Array.isArray(data) ? (data as Car[]) : ((data as any)?.data ?? [])),
    [data],
  );
  const total = Array.isArray(data) ? rawCars.length : ((data as any)?.total ?? rawCars.length);
  const hasMore = page * limit < total;

  // Client-side plate-priority sort: when the user is typing what
  // looks like a plate, surface plate hits at the top regardless of
  // backend ordering (server search is substring against multiple
  // fields and may surface a makeModel match above a plate hit).
  const sortedCars = useMemo<Car[]>(() => {
    if (!search || !looksLikePlateQuery(search)) return rawCars;
    const q = normalizePlateQuery(search);
    const hits: Car[] = [];
    const misses: Car[] = [];
    for (const car of rawCars) {
      (plateMatches(car.plateNumber, q) ? hits : misses).push(car);
    }
    return [...hits, ...misses];
  }, [rawCars, search]);

  const toggleCar = useCallback((id: string) => {
    haptic('select');
    setExpandedCarId((prev) => (prev === id ? null : id));
  }, []);

  const renderCar = useCallback(
    ({ item }: { item: Car }) => {
      const expanded = expandedCarId === item.id;
      return (
        <View>
          <TouchableOpacity
            style={[styles.carRow, { backgroundColor: palette.bg.card, borderBottomColor: palette.border.subtle }]}
            activeOpacity={0.7}
            onPress={() => toggleCar(item.id)}
          >
            {/* Plate is the visual anchor — bigger and more contrast than the
                model, since the owner identifies the car by its plate first. */}
            <View style={styles.plateColumn}>
              {item.plateNumber ? (
                <View style={[styles.plateBadge, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
                  <Text style={[styles.plateText, { color: palette.text.primary }]}>{item.plateNumber}</Text>
                </View>
              ) : (
                <View style={styles.carIconBox}>
                  <Ionicons name="car-sport-outline" size={22} color={colors.primary[600]} />
                </View>
              )}
            </View>
            <View style={styles.info}>
              <Text style={[styles.makeModel, { color: palette.text.primary }]} numberOfLines={1}>
                {item.makeModel || 'Без модели'}
              </Text>
              {item.client?.fullName ? (
                <View style={styles.ownerRow}>
                  <Ionicons name="person-outline" size={11} color={palette.text.tertiary} />
                  <Text style={[styles.ownerText, { color: palette.text.secondary }]} numberOfLines={1}>
                    {item.client.fullName}
                  </Text>
                </View>
              ) : (
                <Text style={[styles.ownerText, { color: palette.text.tertiary }]} numberOfLines={1}>
                  Без владельца
                </Text>
              )}
            </View>
            <Ionicons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={palette.text.tertiary}
            />
          </TouchableOpacity>
          {expanded ? <CarChecksInline carId={item.id} palette={palette} /> : null}
        </View>
      );
    },
    [expandedCarId, palette, toggleCar],
  );

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Авто" onBack={() => navigation.goBack()} />
      <View style={styles.freshnessRow}>
        <FreshnessBadge query={{ isFetching, isLoading, dataUpdatedAt }} />
      </View>

      <View style={styles.searchWrap}>
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Госномер или марка"
        />
      </View>

      {data === undefined ? (
        <ListSkeleton count={8} />
      ) : sortedCars.length === 0 && !isLoading ? (
        <EmptyState
          title="Нет автомобилей"
          description={search ? 'Ничего не найдено' : 'Автомобили появятся после добавления к клиентам'}
        />
      ) : (
        <FlashList
          data={sortedCars}
          keyExtractor={(item) => item.id}
          renderItem={renderCar}
          contentContainerStyle={{ ...styles.list, paddingBottom: tabBarHeight + spacing[4] }}
          removeClippedSubviews
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
          }
          onEndReached={() => {
            if (hasMore) setPage((p) => p + 1);
          }}
          onEndReachedThreshold={0.5}
        />
      )}
    </View>
  );
}

/**
 * Inline checks for a single car — fetched on demand the first time
 * the row is expanded, then cached in react-query. Surfaces date,
 * total, master and payment so the owner can answer "what did we do
 * last time for this car?" without leaving the list.
 */
function CarChecksInline({
  carId,
  palette,
}: {
  carId: string;
  palette: ReturnType<typeof useColors>;
}) {
  const { data: checks, isLoading } = useQuery<Check[]>({
    queryKey: ['car-checks', carId],
    queryFn: async () => {
      const res = await carsApi.checks(carId, { limit: 20 });
      return res.data;
    },
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <View style={[styles.inlinePanel, { backgroundColor: palette.bg.muted }]}>
        <ActivityIndicator size="small" color={palette.accent.primary} />
      </View>
    );
  }
  if (!checks || checks.length === 0) {
    return (
      <View style={[styles.inlinePanel, { backgroundColor: palette.bg.muted }]}>
        <Text style={[styles.inlineEmpty, { color: palette.text.tertiary }]}>Нет чеков по этому авто</Text>
      </View>
    );
  }
  return (
    <View style={[styles.inlinePanel, { backgroundColor: palette.bg.muted }]}>
      {checks.slice(0, 10).map((c) => (
        <View
          key={c.id}
          style={[styles.checkLine, { borderBottomColor: palette.border.subtle, backgroundColor: palette.bg.card }]}
        >
          <View style={{ flex: 1 }}>
            <Text style={[styles.checkLineTop, { color: palette.text.primary }]} numberOfLines={1}>
              #{c.number} · {formatDateShort(c.date)}
            </Text>
            <Text style={[styles.checkLineSub, { color: palette.text.secondary }]} numberOfLines={1}>
              {c.master?.fullName || 'Без мастера'}
            </Text>
          </View>
          <Text style={[styles.checkLineAmount, { color: palette.text.primary }]}>{formatMoney(c.totalRevenue)}</Text>
        </View>
      ))}
      {checks.length > 10 ? (
        <Text style={[styles.inlineMore, { color: palette.text.tertiary }]}>
          Показано 10 из {checks.length}. Откройте клиента, чтобы увидеть полную историю.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  freshnessRow: { paddingHorizontal: spacing[4], alignItems: 'flex-end', minHeight: 14 },
  searchWrap: { paddingHorizontal: spacing[4], paddingBottom: spacing[2] },
  list: { paddingHorizontal: 0, paddingBottom: spacing[8] },

  carRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray[200],
    backgroundColor: colors.white,
  },
  plateColumn: { minWidth: 96, alignItems: 'flex-start' },
  carIconBox: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  plateBadge: {
    paddingHorizontal: spacing[2.5],
    paddingVertical: 6,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    backgroundColor: colors.white,
    borderColor: colors.gray[300],
  },
  plateText: { fontSize: 14, fontWeight: '700', letterSpacing: 0.7, color: colors.gray[900] },
  info: { flex: 1, minWidth: 0 },
  makeModel: { fontSize: 15, fontWeight: '600', letterSpacing: -0.1 },
  ownerRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  ownerText: { fontSize: 12 },

  // Inline expand panel
  inlinePanel: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    gap: spacing[1.5],
  },
  inlineEmpty: { fontSize: fontSize.sm, paddingVertical: spacing[2] },
  inlineMore: { fontSize: 11, marginTop: spacing[2] },
  checkLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  checkLineTop: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, letterSpacing: -0.1 },
  checkLineSub: { fontSize: 11, marginTop: 2 },
  checkLineAmount: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },
});
