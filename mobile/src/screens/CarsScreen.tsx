import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import IosScreenHeader from '../components/IosScreenHeader';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { carsApi } from '../api/services';
import SearchInput from '../components/SearchInput';
import LoadingSpinner from '../components/LoadingSpinner';
import { ListSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import AnimatedCard from '../components/AnimatedCard';
import { useColors } from '../contexts/ThemeContext';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';

export default function CarsScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const tabBarHeight = useTabBarHeight();
  const palette = useColors();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const limit = 30;
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading } = useQuery<any>({
    queryKey: ['cars', { search, page, limit }],
    queryFn: async () => {
      const res = await carsApi.getAll({ search, page, limit });
      return res.data;
    },
    // Local SWR — keeps previous list while search/pagination
    // changes the key, no skeleton flash between transitions.
    placeholderData: (prev: unknown) => prev,
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['cars'] });
    setRefreshing(false);
  };

  const cars: any[] = data?.data || (Array.isArray(data) ? data : []);
  const total = data?.total || cars.length;
  const hasMore = page * limit < total;

  const renderCar = ({ item, index }: { item: any; index: number }) => (
    <AnimatedCard
      index={index}
      style={[styles.carCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
      onPress={() => {
        if (item.clientId) {
          navigation.navigate('ClientDetail', { id: item.clientId });
        }
      }}
    >
      <View style={styles.carRow}>
        <View style={styles.carIconBox}>
          <Ionicons name="car-sport-outline" size={22} color={colors.primary[600]} />
        </View>
        <View style={styles.carInfo}>
          <Text style={[styles.carMakeModel, { color: palette.text.primary }]} numberOfLines={1}>
            {item.makeModel || 'Автомобиль'}
          </Text>
          {item.plateNumber && (
            // Plate badge stays road-sign white — never themed.
            <View style={styles.plateBadge}>
              <Text style={styles.plateText}>{item.plateNumber}</Text>
            </View>
          )}
          {item.client?.fullName && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[1], marginTop: 4 }}>
              <Ionicons name="person-outline" size={12} color={palette.text.tertiary} />
              <Text style={[styles.carClient, { color: palette.text.tertiary }]}>{item.client.fullName}</Text>
            </View>
          )}
        </View>
        <Ionicons name="chevron-forward" size={18} color={palette.text.tertiary} />
      </View>
    </AnimatedCard>
  );

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Автомобили" onBack={() => navigation.goBack()} />

      {/* Clients ⇄ Cars segmented — same shape as ClientsScreen so the
          two screens read as one unified Clients section. */}
      <View style={cnStyles.segmentWrap}>
        <View style={[cnStyles.segment, { backgroundColor: palette.bg.muted }]}>
          <TouchableOpacity
            style={cnStyles.segmentItem}
            onPress={() => navigation.replace('Clients')}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            <Ionicons name="people-outline" size={14} color={palette.text.secondary} />
            <Text style={[cnStyles.segmentLabelInactive, { color: palette.text.secondary }]}>Клиенты</Text>
          </TouchableOpacity>
          <View style={[cnStyles.segmentItem, cnStyles.segmentActive, { backgroundColor: palette.bg.card }]}>
            <Ionicons name="car-sport" size={14} color={colors.primary[700]} />
            <Text style={cnStyles.segmentLabelActive}>Авто</Text>
          </View>
        </View>
      </View>

      <View style={styles.searchWrap}>
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder="Поиск по марке, номеру..."
        />
      </View>

      {data === undefined ? (
        // Cold-start: only render skeleton while genuinely empty,
        // never flash an EmptyState before the first response.
        <ListSkeleton count={8} />
      ) : (Array.isArray(cars) ? cars : []).length === 0 && !isLoading ? (
        <EmptyState
          title="Нет автомобилей"
          description={search ? 'Ничего не найдено' : 'Автомобили появятся после добавления к клиентам'}
        />
      ) : (
        <FlashList
          data={Array.isArray(cars) ? cars : []}
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[100],
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  headerIcon: { width: 30, height: 30, borderRadius: borderRadius.lg, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.gray[900], letterSpacing: -0.3 },
  searchWrap: { paddingHorizontal: spacing[4], paddingTop: spacing[3] },
  list: { paddingHorizontal: spacing[4], paddingBottom: spacing[8], gap: spacing[2], paddingTop: spacing[3] },
  carCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: colors.gray[100],
    padding: spacing[4],
    shadowColor: colors.black,
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  carRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  carIconBox: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  carInfo: { flex: 1, minWidth: 0 },
  carMakeModel: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  plateBadge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.gray[100],
    borderRadius: borderRadius.sm,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    marginTop: 4,
  },
  plateText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.gray[700], letterSpacing: 0.5 },
  carClient: { fontSize: fontSize.xs, color: colors.gray[400] },
});

// Segmented control mirroring ClientsScreen.cnStyles for the unified
// Clients ⇄ Cars top tabs.
const cnStyles = StyleSheet.create({
  segmentWrap: { paddingHorizontal: spacing[4], paddingBottom: spacing[2] },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.gray[100],
    borderRadius: 12,
    padding: 3,
    gap: 2,
    alignSelf: 'flex-start',
  },
  segmentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 9,
    minWidth: 96,
    justifyContent: 'center',
  },
  segmentActive: {
    backgroundColor: colors.white,
    shadowColor: colors.black,
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  segmentLabelActive: { fontSize: 13, fontWeight: '700', color: colors.primary[700] },
  segmentLabelInactive: { fontSize: 13, fontWeight: '500', color: colors.gray[600] },
});
