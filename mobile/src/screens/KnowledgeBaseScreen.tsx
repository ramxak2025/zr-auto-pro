/**
 * KnowledgeBaseScreen — «Обучение и база знаний» home (#15 / #17).
 *
 * Три понятные группы (имя экрана шире, чем внутренняя группа «База знаний», —
 * родительский пункт в «Ещё» назван «Обучение и база знаний», чтобы имя не
 * дублировалось):
 *   1. Учебный центр — курсы + справочник неисправностей.
 *   2. Регламенты — всегда доступная точка входа (жёлтый акцент при долге).
 *   3. База знаний — закреплённые + категории + недавние статьи.
 *
 * Умный поиск:
 *   • Search bar (debounced → listArticles({search})) — бэкенд ищет по
 *     title + body. При наличии запроса экран сворачивается в плоский список.
 *   • Фасеты по типу вложения (С видео / С документами / С фото) →
 *     listArticles({ hasAttachmentType }). Активный фасет сам запускает поиск,
 *     даже без текста; комбинируется с текстом.
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
import QueryErrorState from '../components/QueryErrorState';
import SearchInput from '../components/SearchInput';
import { ListSkeleton } from '../components/Skeleton';
import ArticleRow from '../components/knowledge/ArticleRow';
import CategoryRow from '../components/knowledge/CategoryRow';
import CourseCard from '../components/knowledge/CourseCard';
import { Text } from '../platform/Typography';
import { iosSectionLabel } from '../platform/iosSurface';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useColors } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { knowledgeApi } from '../api/services';
import { spacing, borderRadius, colors, softTint } from '../theme';
import { haptic } from '../platform/haptics';
import { rootCategories } from '../utils/knowledgeTree';
import { UserRole } from '../../../shared/types';
import type {
  KnowledgeArticle,
  KnowledgeCategory,
  KnowledgeCourse,
  KnowledgeSearchResults,
} from '../../../shared/types';

const STALE = 60_000;

/** Smart search needs ≥2 chars (server returns empty buckets below that). */
const MIN_QUERY = 2;

export default function KnowledgeBaseScreen() {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const { isRole } = useAuth();
  const isManager = isRole(UserRole.DIRECTOR, UserRole.ADMIN, UserRole.SUPERADMIN);

  const [search, setSearch] = React.useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  // The search bar drives the GLOBAL smart search (articles + folders + courses).
  // Any text collapses the screen into ranked results; <2 chars shows a hint.
  const isSearching = debouncedSearch.length > 0;
  const queryReady = debouncedSearch.length >= MIN_QUERY;

  // ── Categories ──────────────────────────────────────────────────────────
  const { data: categories, refetch: refetchCategories } = useQuery<KnowledgeCategory[]>({
    queryKey: ['knowledge-categories'],
    queryFn: async () => (await knowledgeApi.listCategories()).data,
    staleTime: 5 * 60_000,
  });

  // ── Courses (for the «Учебный центр» entry's overall progress) ──────────
  // Чисто декоративный запрос: при ошибке (включая текущий 500 на
  // /knowledge/courses) плитка просто показывает подпись без прогресса.
  const { data: courses, refetch: refetchCourses } = useQuery<KnowledgeCourse[]>({
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
  const { data: pending, refetch: refetchPending } = useQuery<{ count: number }>({
    queryKey: ['knowledge-regulations-pending'],
    queryFn: async () => (await knowledgeApi.regulationsPendingCount()).data,
    staleTime: STALE,
  });
  const pendingCount = pending?.count ?? 0;

  // ── Pinned ──────────────────────────────────────────────────────────────
  const { data: pinned, refetch: refetchPinned } = useQuery<KnowledgeArticle[]>({
    queryKey: ['knowledge-articles', 'pinned'],
    queryFn: async () => (await knowledgeApi.listArticles({ pinned: 'true' })).data,
    staleTime: STALE,
  });

  // ── Recent (all, slim) — this is the screen's main list ─────────────────
  const {
    data: recent,
    isLoading: recentLoading,
    isFetching: recentFetching,
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

  // Pull-to-refresh оживляет ВЕСЬ экран (категории, курсы, бейдж регламентов,
  // закреплённые, недавние), а не только «Недавние» — иначе после починки
  // сервера часть секций оставалась бы пустой до истечения staleTime.
  const onRefreshAll = React.useCallback(() => {
    refetchCategories();
    refetchCourses();
    refetchPending();
    refetchPinned();
    refetchRecent();
  }, [refetchCategories, refetchCourses, refetchPending, refetchPinned, refetchRecent]);

  // ── Global smart search (articles + folders + courses) ───────────────────
  // knowledgeApi.search ranks across all three; below MIN_QUERY chars the
  // server returns empty buckets, so we only fire the query when it's ready.
  const {
    data: results,
    isFetching: searchFetching,
    isError: searchError,
    refetch: refetchSearch,
  } = useQuery<KnowledgeSearchResults>({
    queryKey: ['knowledge-search', debouncedSearch],
    queryFn: async () => (await knowledgeApi.search(debouncedSearch)).data,
    enabled: queryReady,
    staleTime: 30_000,
    retry: 1,
  });

  const resultCount = results ? results.articles.length + results.categories.length + results.courses.length : 0;

  // Root-level folders only — subfolders surface after drilling into a folder.
  const rootCats = React.useMemo(() => (categories ? rootCategories(categories) : []), [categories]);

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

  const openCourse = React.useCallback(
    (course: KnowledgeCourse) => {
      navigation.navigate('KnowledgeCourseDetail', { id: course.id, title: course.title });
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
      <IosScreenHeader title="Обучение и база знаний" onBack={() => navigation.goBack()} trailing={headerTrailing} />

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
            onRefresh={onRefreshAll}
            tintColor={palette.text.tertiary}
          />
        }
      >
        <SearchInput value={search} onChange={setSearch} placeholder="Поиск: статьи, папки, курсы" />

        {isSearching ? (
          // ── SMART SEARCH — honest state machine: too-short hint → skeleton →
          // error (никогда не «ничего не найдено» при упавшем запросе) →
          // ranked buckets (статьи / папки / курсы) → truly-empty success.
          <View style={styles.section}>
            {!queryReady ? (
              <EmptyState
                icon="search"
                title="Введите минимум 2 символа"
                description="Ищем по статьям, папкам и курсам базы знаний."
              />
            ) : results === undefined && searchFetching ? (
              <ListSkeleton count={5} />
            ) : searchError && results === undefined ? (
              <QueryErrorState description="Проверьте соединение и попробуйте снова." onRetry={() => refetchSearch()} />
            ) : results === undefined ? (
              <ListSkeleton count={5} />
            ) : resultCount > 0 ? (
              <View style={styles.results}>
                {results.articles.length > 0 ? (
                  <View>
                    <Text style={[iosSectionLabel, styles.sectionTitle, { color: palette.text.secondary }]}>
                      Статьи
                    </Text>
                    <View style={styles.rowList}>
                      {results.articles.map((a) => (
                        <ArticleRow key={a.id} article={a} onPress={openArticle} />
                      ))}
                    </View>
                  </View>
                ) : null}

                {results.categories.length > 0 ? (
                  <View>
                    <Text style={[iosSectionLabel, styles.sectionTitle, { color: palette.text.secondary }]}>Папки</Text>
                    <View style={styles.rowList}>
                      {results.categories.map((c) => (
                        <CategoryRow key={c.id} category={c} onPress={openCategory} />
                      ))}
                    </View>
                  </View>
                ) : null}

                {results.courses.length > 0 ? (
                  <View>
                    <Text style={[iosSectionLabel, styles.sectionTitle, { color: palette.text.secondary }]}>Курсы</Text>
                    <View style={styles.courseList}>
                      {results.courses.map((c) => (
                        <CourseCard key={c.id} course={c} onPress={openCourse} />
                      ))}
                    </View>
                  </View>
                ) : null}
              </View>
            ) : (
              <EmptyState
                icon="search"
                title="Ничего не найдено"
                description={`По запросу «${debouncedSearch}» ничего нет. Попробуйте другие слова.`}
              />
            )}
          </View>
        ) : (
          <>
            {/* ═══ Группа 1 — УЧЕБНЫЙ ЦЕНТР ════════════════════════════════
                Курсы + справочник неисправностей: всё, что про обучение. */}
            <View style={styles.section}>
              <Text style={[iosSectionLabel, styles.sectionTitle, { color: palette.text.secondary }]}>
                Учебный центр
              </Text>
              <View style={styles.featureRow}>
                <Pressable
                  onPress={openCourses}
                  style={({ pressed }) => [
                    styles.feature,
                    {
                      backgroundColor: palette.bg.card,
                      borderColor: palette.border.subtle,
                      opacity: pressed ? 0.8 : 1,
                    },
                  ]}
                >
                  <View style={[styles.featureIcon, { backgroundColor: palette.accent.primarySoft }]}>
                    <Ionicons name="school" size={22} color={palette.accent.primary} />
                  </View>
                  <Text variant="bodyEmph" numberOfLines={1} style={{ color: palette.text.primary }}>
                    Курсы
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
                    {
                      backgroundColor: palette.bg.card,
                      borderColor: palette.border.subtle,
                      opacity: pressed ? 0.8 : 1,
                    },
                  ]}
                >
                  <View
                    style={[
                      styles.featureIcon,
                      {
                        backgroundColor:
                          palette.mode === 'dark' ? softTint(colors.amber[600], 'dark') : colors.amber[50],
                      },
                    ]}
                  >
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
            </View>

            {/* ═══ Группа 2 — РЕГЛАМЕНТЫ ═══════════════════════════════════
                Всегда доступная точка входа; жёлтый акцент при долге. */}
            <View style={styles.section}>
              <Text style={[iosSectionLabel, styles.sectionTitle, { color: palette.text.secondary }]}>Регламенты</Text>
              <Pressable
                onPress={openRegulations}
                style={({ pressed }) => [
                  styles.regBanner,
                  pendingCount > 0
                    ? palette.mode === 'dark'
                      ? { backgroundColor: softTint(colors.amber[600], 'dark'), borderColor: palette.border.subtle }
                      : { backgroundColor: colors.amber[50], borderColor: colors.amber[200] }
                    : { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
                  { opacity: pressed ? 0.85 : 1 },
                ]}
              >
                <View
                  style={[
                    styles.regIcon,
                    {
                      backgroundColor:
                        pendingCount > 0
                          ? palette.mode === 'dark'
                            ? softTint(colors.amber[600], 'dark')
                            : colors.amber[100]
                          : palette.accent.primarySoft,
                    },
                  ]}
                >
                  <Ionicons
                    name="shield-checkmark"
                    size={22}
                    color={pendingCount > 0 ? colors.amber[600] : palette.accent.primary}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    variant="bodyEmph"
                    style={{ color: pendingCount > 0 ? colors.amber[800] : palette.text.primary }}
                  >
                    {pendingCount > 0 ? 'Регламенты ждут ознакомления' : 'Регламенты автосервиса'}
                  </Text>
                  <Text
                    variant="footnote"
                    style={{ color: pendingCount > 0 ? colors.amber[700] : palette.text.tertiary }}
                  >
                    {pendingCount > 0
                      ? pendingCount === 1
                        ? '1 документ требует вашего «Ознакомлен»'
                        : `${pendingCount} документов требуют вашего «Ознакомлен»`
                      : 'Открыть и подтвердить ознакомление'}
                  </Text>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={pendingCount > 0 ? colors.amber[600] : palette.text.tertiary}
                />
              </Pressable>
            </View>

            {/* ═══ Группа 3 — БАЗА ЗНАНИЙ (статьи) ═════════════════════════ */}
            <Text style={[iosSectionLabel, styles.sectionTitle, styles.groupHeader, { color: palette.text.secondary }]}>
              База знаний
            </Text>

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

            {/* ── Категории (только корневые папки; подпапки — внутри) ──── */}
            {rootCats.length > 0 ? (
              <View style={styles.section}>
                <Text style={[iosSectionLabel, styles.sectionTitle, { color: palette.text.secondary }]}>Категории</Text>
                <View style={styles.tileGrid}>
                  {rootCats.map((cat) => (
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
              {recent === undefined && recentFetching ? (
                <ListSkeleton count={5} />
              ) : recentError && recent === undefined ? (
                // Ошибка без кэша — честный error-state с «Повторить».
                // «Пока пусто» при ошибке здесь и был баг «то показывает,
                // то пишет что пусто».
                <QueryErrorState
                  description="Проверьте соединение и попробуйте снова."
                  onRetry={() => refetchRecent()}
                />
              ) : recent === undefined ? (
                <ListSkeleton count={5} />
              ) : recent.length > 0 ? (
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
                  action={
                    isManager
                      ? { label: 'Создать статью', onPress: () => navigation.navigate('KnowledgeEditor', {}) }
                      : undefined
                  }
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
  groupHeader: { marginTop: spacing[1] },
  rowList: { gap: spacing[2] },
  results: { gap: spacing[5] },
  courseList: { gap: spacing[3.5] },

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
  },
  regIcon: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },

  featureRow: { flexDirection: 'row', gap: spacing[3] },
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
