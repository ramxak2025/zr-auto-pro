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
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import IosScreenHeader from '../components/IosScreenHeader';
import EmptyState from '../components/EmptyState';
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
import { UserRole } from '../../../shared/types';
import type { Troubleshooting } from '../../../shared/types';

const STALE = 60_000;

export default function KnowledgeTroubleshootingScreen() {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const { isRole } = useAuth();
  const isManager = isRole(UserRole.DIRECTOR, UserRole.ADMIN, UserRole.SUPERADMIN);

  const [search, setSearch] = React.useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const [system, setSystem] = React.useState<string | null>(null);
  const [carMake, setCarMake] = React.useState<string | null>(null);
  const [tag, setTag] = React.useState<string | null>(null);

  // Full dataset — drives the chip vocabulary (cheap, cached).
  const { data: all } = useQuery<Troubleshooting[]>({
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

  const { data: results, isFetching } = useQuery<Troubleshooting[]>({
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

  // When no filter is active, just show the whole list.
  const list = filtersActive ? results : all;
  const loading = filtersActive ? isFetching && !results : !all;

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

        {/* Results */}
        <View style={styles.results}>
          {loading ? (
            <ListSkeleton count={6} />
          ) : list && list.length > 0 ? (
            <View style={styles.rowList}>
              {list.map((entry) => (
                <TroubleshootingRow key={entry.id} entry={entry} onPress={openEntry} />
              ))}
            </View>
          ) : filtersActive ? (
            <EmptyState
              icon="search"
              title="Ничего не найдено"
              description="Измените запрос или сбросьте фильтры."
            />
          ) : (
            <EmptyState
              icon="build"
              title="Справочник пуст"
              description={
                isManager
                  ? 'Добавьте первую запись — нажмите «+» в правом верхнем углу.'
                  : 'Здесь появятся типовые неисправности и решения.'
              }
              action={isManager ? { label: 'Добавить', onPress: () => navigation.navigate('KnowledgeTroubleshootingEditor', {}) } : undefined}
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
