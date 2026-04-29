import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, RefreshControl,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
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
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';

export default function CarsScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const limit = 30;
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['cars', { search, page, limit }],
    queryFn: async () => {
      const res = await carsApi.getAll({ search, page, limit });
      return res.data;
    },
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
      style={styles.carCard}
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
          <Text style={styles.carMakeModel} numberOfLines={1}>{item.makeModel || 'Автомобиль'}</Text>
          {item.plateNumber && (
            <View style={styles.plateBadge}>
              <Text style={styles.plateText}>{item.plateNumber}</Text>
            </View>
          )}
          {item.client?.fullName && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[1], marginTop: 4 }}>
              <Ionicons name="person-outline" size={12} color={colors.gray[400]} />
              <Text style={styles.carClient}>{item.client.fullName}</Text>
            </View>
          )}
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.gray[300]} />
      </View>
    </AnimatedCard>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <LinearGradient
        colors={[colors.white, colors.gray[50]] as [string, string]}
        style={styles.header}
      >
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={20} color={colors.primary[600]} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <LinearGradient
            colors={[colors.blue[500], colors.blue[700]] as [string, string]}
            style={styles.headerIcon}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <Ionicons name="car-sport-outline" size={16} color={colors.white} />
          </LinearGradient>
          <Text style={styles.title}>Автомобили</Text>
        </View>
        <View style={{ width: 40 }} />
      </LinearGradient>

      <View style={styles.searchWrap}>
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Поиск по марке, номеру..." />
      </View>

      {isLoading ? (
        <ListSkeleton count={8} />
      ) : (Array.isArray(cars) ? cars : []).length === 0 ? (
        <EmptyState title="Нет автомобилей" description={search ? 'Ничего не найдено' : 'Автомобили появятся после добавления к клиентам'} />
      ) : (
        <FlashList
          data={Array.isArray(cars) ? cars : []}
          keyExtractor={(item) => item.id}
          renderItem={renderCar}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />}
          onEndReached={() => { if (hasMore) setPage(p => p + 1); }}
          onEndReachedThreshold={0.5}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing[4], paddingVertical: spacing[3],
    borderBottomWidth: 1, borderBottomColor: colors.gray[100],
  },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary[50], alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  headerIcon: { width: 30, height: 30, borderRadius: borderRadius.lg, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.gray[900], letterSpacing: -0.3 },
  searchWrap: { paddingHorizontal: spacing[4], paddingTop: spacing[3] },
  list: { paddingHorizontal: spacing[4], paddingBottom: spacing[8], gap: spacing[2], paddingTop: spacing[3] },
  carCard: {
    backgroundColor: colors.white, borderRadius: borderRadius['2xl'], borderWidth: 1,
    borderColor: colors.gray[100], padding: spacing[4],
    shadowColor: colors.black, shadowOpacity: 0.04, shadowRadius: 4, elevation: 2,
  },
  carRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  carIconBox: {
    width: 44, height: 44, borderRadius: borderRadius.xl, backgroundColor: colors.primary[50],
    alignItems: 'center', justifyContent: 'center',
  },
  carInfo: { flex: 1, minWidth: 0 },
  carMakeModel: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  plateBadge: {
    alignSelf: 'flex-start', backgroundColor: colors.gray[100], borderRadius: borderRadius.sm,
    paddingHorizontal: spacing[2], paddingVertical: 2, marginTop: 4,
  },
  plateText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.gray[700], letterSpacing: 0.5 },
  carClient: { fontSize: fontSize.xs, color: colors.gray[400] },
});
