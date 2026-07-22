/**
 * KnowledgeTroubleshootingScreen — «Справочник неисправностей».
 *
 * Search-first: a debounced query plus single-select filter chips for system /
 * car-make / tag. The chip options are derived from the unfiltered dataset so
 * the user always sees the full vocabulary. Results are slim rows (symptom +
 * system + severity colour). Managers get a «+» to add an entry.
 *
 * Backend already does the heavy filtering via listTroubleshooting({search,
 * system, carMake, tag}); we keep the result query keyed on all inputs.
 */
import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import IosScreenHeader from '../components/IosScreenHeader';
import EmptyState from '../components/EmptyState';
import QueryErrorState from '../components/QueryErrorState';
import SearchInput from '../components/SearchInput';
import { ListSkeleton } from '../components/Skeleton';
import TroubleshootingRow from '../components/knowledge/TroubleshootingRow';
import FilterChips from '../components/knowledge/FilterChips';
import { Text } from '../platform/Typography';
import { iosSectionLabel } from '../platform/iosSurface';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useColors } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { knowledgeApi } from '../api/services';
import { spacing } from '../theme';
import { haptic } from '../platform/haptics';
import type { Troubleshooting } from '../../../shared/types';

const STALE = 60_000;

export default function KnowledgeTroubleshootingScreen() {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  // Мутации базы знаний — ключ knowledge_manage (сервер гейтит тем же ключом;
  // «права как в Битрикс24», 2026-07: admin живёт по матрице из /auth/me).
  const { hasPermission } = useAuth();
  const isManager = hasPermission('knowledge_manage');

  const [search, setSearch] = React.useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const [system, setSystem] = React.useState<string | null>(null);
  const [carMake, setCarMake] = React.useState<string | null>(null);
  const [tag, setTag] = React.useState<string | null>(null);

  // Full dataset — drives the chip vocabulary (cheap, cached).
  const {
    data: all,
    isError: allError,
    isFetching: allFetching,
    isRefetching: allRefetching,
    refetch: refetchAll,
  } = useQuery<Troubleshooting[]>({
    queryKey: ['knowledge-troubleshooting', 'all'],
    queryFn: async () => (await knowledgeApi.listTroubleshooting()).data,
    staleTime: STALE,
  });

  const facets = React.useMemo(() => {
    const systems = new Set<string>();
    const makes = new Set<string>();
    const tags = new Set<string>();
    (all ?? []).forEach((t) => {
      if (t.system) systems.add(t.system);
      if (t.carMake) makes.add(t.carMake);
      t.tags.forEach((tg) => tags.add(tg));
    });
    return {
      systems: Array.from(systems).sort(),
      makes: Array.from(makes).sort(),
      tags: Array.from(tags).sort(),
    };
  }, [all]);

  const filtersActive = !!debouncedSearch || !!system || !!carMake || !!tag;

  const {
    data: results,
    isFetching: searchFetching,
    isError: searchError,
    isRefetching: searchRefetching,
    refetch: refetchSearch,
  } = useQuery<Troubleshooting[]>({
    queryKey: ['knowledge-troubleshooting', 'search', debouncedSearch, system, carMake, tag],
    queryFn: async () =>
      (
        await knowledgeApi.listTroubleshooting({
          search: debouncedSearch || undefined,
          system: system || undefined,
          carMake: carMake || undefined,
          tag: tag || undefined,
        })
      ).data,
    enabled: filtersActive,
    staleTime: 30_000,
  });

  // When no filter is active, just show the whole list. The honest state
  // machine below reads ONLY the active query's flags — раньше «loading»
  // считался как `!all`, и упавший запрос крутил скелетон вечно.
  const list = filtersActive ? results : all;
  const listFetching = filtersActive ? searchFetching : allFetching;
  const listError = filtersActive ? searchError : allError;
  const retry = filtersActive ? refetchSearch : refetchAll;

  const onRefresh = React.useCallback(() => {
    refetchAll();
    if (filtersActive) refetchSearch();
  }, [refetchAll, refetchSearch, filtersActive]);
  const refreshing = filtersActive ? searchRefetching : allRefetching;

  const openEntry = React.useCallback(
    (entry: Troubleshooting) => {
      navigation.navigate('KnowledgeTroubleshootingDetail', { id: entry.id, title: entry.title });
    },
    [navigation],
  );

  const headerTrailing = isManager ? (
    <Pressable
      onPress={() => {
        haptic('tap');
        navigation.navigate('KnowledgeTroubleshootingEditor', {});
      }}
      hitSlop={10}
      style={[styles.headerBtn, { backgroundColor: palette.accent.primarySoft }]}
      accessibilityRole="button"
      accessibilityLabel="Добавить неисправность"
    >
      <Ionicons name="add" size={22} color={palette.accent.primary} />
    </Pressable>
  ) : undefined;

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Неисправности" onBack={() => navigation.goBack()} trailing={headerTrailing} />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + spacing[4] }]}
        contentInset={{ bottom: tabBarHeight }}
        scrollIndicatorInsets={{ bottom: tabBarHeight }}
        automaticallyAdjustContentInsets={false}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.text.tertiary} />
        }
      >
        <SearchInput value={search} onChange={setSearch} placeholder="Симптом, причина, узел…" />

        {/* Filter chips */}
        {facets.systems.length > 0 ? (
          <View style={styles.filterGroup}>
            <Text style={[iosSectionLabel, styles.filterLabel, { color: palette.text.tertiary }]}>Система</Text>
            <FilterChips options={facets.systems} value={system} onChange={setSystem} />
          </View>
        ) : null}
        {facets.makes.length > 0 ? (
          <View style={styles.filterGroup}>
            <Text style={[iosSectionLabel, styles.filterLabel, { color: palette.text.tertiary }]}>Марка</Text>
            <FilterChips options={facets.makes} value={carMake} onChange={setCarMake} />
          </View>
        ) : null}
        {facets.tags.length > 0 ? (
          <View style={styles.filterGroup}>
            <Text style={[iosSectionLabel, styles.filterLabel, { color: palette.text.tertiary }]}>Теги</Text>
            <FilterChips options={facets.tags} value={tag} onChange={setTag} />
          </View>
        ) : null}

        {/* Results — honest state machine: skeleton while fetching without
            data → error state (НИКОГДА не «пусто» при ошибке) → list →
            truly-empty success. */}
        <View style={styles.results}>
          {list === undefined && listFetching ? (
            <ListSkeleton count={6} />
          ) : listError && list === undefined ? (
            <QueryErrorState description="Проверьте соединение и попробуйте снова." onRetry={() => retry()} />
          ) : list === undefined ? (
            // pending без активного запроса (например, offline-пауза) —
            // держим скелетон, «пусто» здесь было бы враньём.
            <ListSkeleton count={6} />
          ) : list.length > 0 ? (
            <View style={styles.rowList}>
              {list.map((entry) => (
                <TroubleshootingRow key={entry.id} entry={entry} onPress={openEntry} />
              ))}
            </View>
          ) : filtersActive ? (
            <EmptyState icon="search" title="Ничего не найдено" description="Измените запрос или сбросьте фильтры." />
          ) : (
            <EmptyState
              icon="build"
              title="Справочник пуст"
              description={
                isManager
                  ? 'Добавьте первую запись — нажмите «+» в правом верхнем углу.'
                  : 'Здесь появятся типовые неисправности и решения.'
              }
              action={
                isManager
                  ? { label: 'Добавить', onPress: () => navigation.navigate('KnowledgeTroubleshootingEditor', {}) }
                  : undefined
              }
            />
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: spacing[4], paddingTop: spacing[2] },
  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterGroup: { marginBottom: spacing[3] },
  filterLabel: { marginLeft: spacing[1], marginBottom: spacing[1.5] },
  results: { marginTop: spacing[2] },
  rowList: { gap: spacing[2] },
});
