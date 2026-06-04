/**
 * KnowledgeBaseScreen — «База знаний» home (#17, Wave 1).
 *
 * Layout (premium, balanced, iOS Settings-grade):
 *   • Search bar (debounced → listArticles({search})) — when there's a query
 *     the screen collapses into a flat search-results list.
 *   • «Регламенты» highlight — only when the user has pending acknowledgments
 *     (regulationsPendingCount > 0). Tap → filtered regulation list.
 *   • «Закреплённые» — pinned articles (horizontal scroller of rows).
 *   • Category tiles — icon + name (Ionicons names from listCategories).
 *   • «Недавние» — most-recently-updated articles.
 *
 * Managers (director/admin/superadmin) get a «+» in the header that opens the
 * editor.
 *
 * Data freshness: React Query staleTime keeps it cache-first without touching
 * persistentCache. Lists revalidate quietly in the background.
 */
import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import IosScreenHeader from '../components/IosScreenHeader';
import EmptyState from '../components/EmptyState';
import SearchInput from '../components/SearchInput';
import { ListSkeleton } from '../components/Skeleton';
import ArticleRow from '../components/knowledge/ArticleRow';
import { Text } from '../platform/Typography';
import { iosSectionLabel } from '../platform/iosSurface';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useColors } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { knowledgeApi } from '../api/services';
import { spacing, borderRadius, colors } from '../theme';
import { haptic } from '../platform/haptics';
import { UserRole } from '../../../shared/types';
import type { KnowledgeArticle, KnowledgeCategory, KnowledgeCourse } from '../../../shared/types';

const STALE = 60_000;

export default function KnowledgeBaseScreen() {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const { isRole } = useAuth();
  const isManager = isRole(UserRole.DIRECTOR, UserRole.ADMIN, UserRole.SUPERADMIN);

  const [search, setSearch] = React.useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const isSearching = debouncedSearch.length > 0;

  // ── Categories ──────────────────────────────────────────────────────────
  const { data: categories } = useQuery<KnowledgeCategory[]>({
    queryKey: ['knowledge-categories'],
    queryFn: async () => (await knowledgeApi.listCategories()).data,
    staleTime: 5 * 60_000,
  });

  // ── Courses (for the «Учебный центр» entry's overall progress) ──────────
  const { data: courses } = useQuery<KnowledgeCourse[]>({
    queryKey: ['knowledge-courses'],
    queryFn: async () => (await knowledgeApi.listCourses()).data,
    staleTime: STALE,
  });
  const courseProgress = React.useMemo(() => {
    if (!courses || courses.length === 0) return null;
    const totalLessons = courses.reduce((sum, c) => sum + c.lessonCount, 0);
    const doneLessons = courses.reduce((sum, c) => sum + c.completedLessons, 0);
    if (doneLessons === 0) return null;
    return totalLessons > 0 ? Math.round((doneLessons / totalLessons) * 100) : 0;
  }, [courses]);

  // ── Pending regulations badge ───────────────────────────────────────────
  const { data: pending } = useQuery<{ count: number }>({
    queryKey: ['knowledge-regulations-pending'],
    queryFn: async () => (await knowledgeApi.regulationsPendingCount()).data,
    staleTime: STALE,
  });
  const pendingCount = pending?.count ?? 0;

  // ── Pinned ──────────────────────────────────────────────────────────────
  const { data: pinned } = useQuery<KnowledgeArticle[]>({
    queryKey: ['knowledge-articles', 'pinned'],
    queryFn: async () => (await knowledgeApi.listArticles({ pinned: 'true' })).data,
    staleTime: STALE,
  });

  // ── Recent (all, slim) — this is the screen's main list ─────────────────
  const {
    data: recent,
    isLoading: recentLoading,
    isError: recentError,
    refetch: refetchRecent,
    isRefetching: recentRefetching,
  } = useQuery<KnowledgeArticle[]>({
    queryKey: ['knowledge-articles', 'recent'],
    queryFn: async () => (await knowledgeApi.listArticles({})).data,
    staleTime: STALE,
    // Surface a failed load quickly instead of retrying with long backoff.
    retry: 1,
  });

  // ── Search results ──────────────────────────────────────────────────────
  const {
    data: results,
    isFetching: searchFetching,
    isError: searchError,
    refetch: refetchSearch,
  } = useQuery<KnowledgeArticle[]>({
    queryKey: ['knowledge-articles', 'search', debouncedSearch],
    queryFn: async () => (await knowledgeApi.listArticles({ search: debouncedSearch })).data,
    enabled: isSearching,
    staleTime: 30_000,
    retry: 1,
  });

  const openArticle = React.useCallback(
    (article: KnowledgeArticle) => {
      navigation.navigate('KnowledgeArticle', { id: article.id, title: article.title });
    },
    [navigation],
  );

  const openCategory = React.useCallback(
    (cat: KnowledgeCategory) => {
      haptic('tap');
      navigation.navigate('KnowledgeCategory', { categoryId: cat.id, name: cat.name });
    },
    [navigation],
  );

  const openRegulations = React.useCallback(() => {
    haptic('tap');
    navigation.navigate('KnowledgeCategory', { type: 'regulation', name: 'Регламенты' });
  }, [navigation]);

  const openCourses = React.useCallback(() => {
    haptic('tap');
    navigation.navigate('KnowledgeCourseList');
  }, [navigation]);

  const openTroubleshooting = React.useCallback(() => {
    haptic('tap');
    navigation.navigate('KnowledgeTroubleshooting');
  }, [navigation]);

  const headerTrailing = isManager ? (
    <Pressable
      onPress={() => {
        haptic('tap');
        navigation.navigate('KnowledgeEditor', {});
      }}
      hitSlop={10}
      style={[styles.headerBtn, { backgroundColor: palette.accent.primarySoft }]}
      accessibilityRole="button"
      accessibilityLabel="Создать статью"
    >
      <Ionicons name="add" size={22} color={palette.accent.primary} />
    </Pressable>
  ) : undefined;

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="База знаний" onBack={() => navigation.goBack()} trailing={headerTrailing} />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + spacing[4] }]}
        contentInset={{ bottom: tabBarHeight }}
        scrollIndicatorInsets={{ bottom: tabBarHeight }}
        automaticallyAdjustContentInsets={false}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={recentRefetching && !recentLoading}
            onRefresh={refetchRecent}
            tintColor={palette.text.tertiary}
          />
        }
      >
        <SearchInput value={search} onChange={setSearch} placeholder="Поиск по базе знаний" />

        {isSearching ? (
          // ── SEARCH RESULTS ──────────────────────────────────────────────
          <View style={styles.section}>
            {searchFetching && !results ? (
              <ListSkeleton count={5} />
            ) : searchError && !results ? (
              <EmptyState
                icon="warning"
                title="Не удалось загрузить"
                description="Проверьте соединение и попробуйте снова."
                action={{ label: 'Повторить', onPress: () => refetchSearch() }}
              />
            ) : results && results.length > 0 ? (
              <View style={styles.rowList}>
                {results.map((a) => (
                  <ArticleRow key={a.id} article={a} onPress={openArticle} />
                ))}
              </View>
            ) : (
              <EmptyState
                icon="search"
                title="Ничего не найдено"
                description={`По запросу «${debouncedSearch}» статей нет. Попробуйте другие слова.`}
              />
            )}
          </View>
        ) : (
          <>
            {/* ── Регламенты highlight ─────────────────────────────────── */}
            {pendingCount > 0 ? (
              <Pressable
                onPress={openRegulations}
                style={({ pressed }) => [
                  styles.regBanner,
                  { backgroundColor: colors.amber[50], borderColor: colors.amber[200], opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <View style={[styles.regIcon, { backgroundColor: colors.amber[100] }]}>
                  <Ionicons name="shield-checkmark" size={22} color={colors.amber[600]} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyEmph" style={{ color: colors.amber[800] }}>
                    Регламенты ждут ознакомления
                  </Text>
                  <Text variant="footnote" style={{ color: colors.amber[700] }}>
                    {pendingCount === 1
                      ? '1 документ требует вашего «Ознакомлен»'
                      : `${pendingCount} документов требуют вашего «Ознакомлен»`}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.amber[600]} />
              </Pressable>
            ) : null}

            {/* ── Учебный центр + Справочник неисправностей ────────────── */}
            <View style={styles.featureRow}>
              <Pressable
                onPress={openCourses}
                style={({ pressed }) => [
                  styles.feature,
                  { backgroundColor: palette.bg.card, borderColor: palette.border.subtle, opacity: pressed ? 0.8 : 1 },
                ]}
              >
                <View style={[styles.featureIcon, { backgroundColor: palette.accent.primarySoft }]}>
                  <Ionicons name="school" size={22} color={palette.accent.primary} />
                </View>
                <Text variant="bodyEmph" numberOfLines={1} style={{ color: palette.text.primary }}>
                  Учебный центр
                </Text>
                {courseProgress !== null ? (
                  <Text variant="caption" style={{ color: palette.accent.primary, fontWeight: '600' }}>
                    Пройдено {courseProgress}%
                  </Text>
                ) : (
                  <Text variant="caption" numberOfLines={1} style={{ color: palette.text.tertiary }}>
                    Курсы и аттестация
                  </Text>
                )}
              </Pressable>

              <Pressable
                onPress={openTroubleshooting}
                style={({ pressed }) => [
                  styles.feature,
                  { backgroundColor: palette.bg.card, borderColor: palette.border.subtle, opacity: pressed ? 0.8 : 1 },
                ]}
              >
                <View style={[styles.featureIcon, { backgroundColor: colors.amber[50] }]}>
                  <Ionicons name="construct" size={22} color={colors.amber[600]} />
                </View>
                <Text variant="bodyEmph" numberOfLines={1} style={{ color: palette.text.primary }}>
                  Неисправности
                </Text>
                <Text variant="caption" numberOfLines={1} style={{ color: palette.text.tertiary }}>
                  Симптом → решение
                </Text>
              </Pressable>
            </View>

            {/* ── Закреплённые ─────────────────────────────────────────── */}
            {pinned && pinned.length > 0 ? (
              <View style={styles.section}>
                <Text style={[iosSectionLabel, styles.sectionTitle, { color: palette.text.secondary }]}>
                  Закреплённые
                </Text>
                <View style={styles.rowList}>
                  {pinned.map((a) => (
                    <ArticleRow key={a.id} article={a} onPress={openArticle} />
                  ))}
                </View>
              </View>
            ) : null}

            {/* ── Категории ────────────────────────────────────────────── */}
            {categories && categories.length > 0 ? (
              <View style={styles.section}>
                <Text style={[iosSectionLabel, styles.sectionTitle, { color: palette.text.secondary }]}>
                  Категории
                </Text>
                <View style={styles.tileGrid}>
                  {categories.map((cat) => (
                    <Pressable
                      key={cat.id}
                      onPress={() => openCategory(cat)}
                      style={({ pressed }) => [
                        styles.tile,
                        {
                          backgroundColor: palette.bg.card,
                          borderColor: palette.border.subtle,
                          opacity: pressed ? 0.7 : 1,
                        },
                      ]}
                    >
                      <View style={[styles.tileIcon, { backgroundColor: palette.accent.primarySoft }]}>
                        <Ionicons
                          name={(cat.icon as keyof typeof Ionicons.glyphMap) || 'folder-outline'}
                          size={22}
                          color={palette.accent.primary}
                        />
                      </View>
                      <Text variant="footnote" numberOfLines={2} style={{ color: palette.text.primary }}>
                        {cat.name}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}

            {/* ── Недавние ─────────────────────────────────────────────── */}
            <View style={styles.section}>
              <Text style={[iosSectionLabel, styles.sectionTitle, { color: palette.text.secondary }]}>Недавние</Text>
              {recentLoading && !recent ? (
                <ListSkeleton count={5} />
              ) : recentError && !recent ? (
                <EmptyState
                  icon="warning"
                  title="Не удалось загрузить"
                  description="Проверьте соединение и попробуйте снова."
                  action={{ label: 'Повторить', onPress: () => refetchRecent() }}
                />
              ) : recent && recent.length > 0 ? (
                <View style={styles.rowList}>
                  {recent.slice(0, 12).map((a) => (
                    <ArticleRow key={a.id} article={a} onPress={openArticle} />
                  ))}
                </View>
              ) : (
                <EmptyState
                  icon="journal"
                  title="Пока пусто"
                  description={
                    isManager
                      ? 'Создайте первую статью или регламент — нажмите «+» в правом верхнем углу.'
                      : 'Здесь появятся статьи и регламенты автосервиса.'
                  }
                  action={isManager ? { label: 'Создать статью', onPress: () => navigation.navigate('KnowledgeEditor', {}) } : undefined}
                />
              )}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: spacing[4], paddingTop: spacing[2] },
  section: { marginBottom: spacing[5] },
  sectionTitle: { marginLeft: spacing[1], marginBottom: spacing[2] },
  rowList: { gap: spacing[2] },

  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },

  regBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
    marginBottom: spacing[5],
  },
  regIcon: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },

  featureRow: { flexDirection: 'row', gap: spacing[3], marginBottom: spacing[5] },
  feature: {
    flex: 1,
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3.5],
    gap: spacing[2],
    minHeight: 112,
  },
  featureIcon: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[1],
  },

  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },
  tile: {
    width: '47%',
    flexGrow: 1,
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3.5],
    gap: spacing[2.5],
    minHeight: 96,
  },
  tileIcon: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
