/**
 * KnowledgeBaseScreen — «База знаний» home.
 *
 * Three directions, like the web (`frontend/src/pages/KnowledgeBasePage.tsx`):
 *   1. База знаний  — папки + закреплённые + недавние статьи (основной контент).
 *   2. Регламенты   — всегда доступная точка входа (жёлтый акцент при долге).
 *   3. Учебный центр — курсы и аттестация.
 *
 * «Справочник» (справочник неисправностей) удалён из мобильного приложения по
 * просьбе владельца — точки входа на него больше нет.
 *
 * Умный поиск:
 *   • Search bar (debounced → knowledgeApi.search) — глобальный ранжированный
 *     поиск по статьям + папкам + курсам. Любой текст сворачивает экран в
 *     результаты; <2 символов показывает подсказку.
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
import FolderManagerModal from '../components/knowledge/FolderManagerModal';
import { Text } from '../platform/Typography';
import { iosSectionLabel } from '../platform/iosSurface';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useColors } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { knowledgeApi } from '../api/services';
import { spacing, borderRadius, colors, softTint } from '../theme';
import { haptic } from '../platform/haptics';
import { rootCategories, childCategories } from '../utils/knowledgeTree';
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

/** Russian plural picker: 1 → one, 2–4 → few, else many (10–20 → many). */
function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
const foldersLabel = (n: number) => `${n} ${plural(n, 'папка', 'папки', 'папок')}`;
const articlesLabel = (n: number) => `${n} ${plural(n, 'статья', 'статьи', 'статей')}`;

export default function KnowledgeBaseScreen() {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const { isRole } = useAuth();
  const isManager = isRole(UserRole.DIRECTOR, UserRole.ADMIN, UserRole.SUPERADMIN);

  const [search, setSearch] = React.useState('');
  const [folderModalOpen, setFolderModalOpen] = React.useState(false);
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

  // ── Courses (for the «Учебный центр» card's overall progress) ───────────
  // Чисто декоративный запрос: при ошибке плитка просто показывает подпись
  // без прогресса.
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

  // «3 папки · 12 статей» под каждой корневой папкой — count из дерева (подпапки)
  // + из загруженного списка всех статей (прямые статьи в папке), как на вебе.
  const folderSubtitle = React.useCallback(
    (cat: KnowledgeCategory): string | undefined => {
      const subN = categories ? childCategories(categories, cat.id).length : 0;
      const artN = recent ? recent.filter((a) => (a.categoryId ?? null) === cat.id).length : 0;
      const parts: string[] = [];
      if (subN > 0) parts.push(foldersLabel(subN));
      if (artN > 0) parts.push(articlesLabel(artN));
      return parts.length > 0 ? parts.join('  ·  ') : undefined;
    },
    [categories, recent],
  );

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

  const openNewFolder = React.useCallback(() => {
    haptic('tap');
    setFolderModalOpen(true);
  }, []);

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

  // Pending-aware amber treatment for the «Регламенты» direction card.
  const regAmber = pendingCount > 0;
  const regCardBg = regAmber
    ? palette.mode === 'dark'
      ? softTint(colors.amber[600], 'dark')
      : colors.amber[50]
    : palette.bg.card;
  const regCardBorder = regAmber
    ? palette.mode === 'dark'
      ? palette.border.subtle
      : colors.amber[200]
    : palette.border.subtle;

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title="База знаний"
        subtitle="Регламенты, учебный центр и статьи"
        onBack={() => navigation.goBack()}
        trailing={headerTrailing}
      />

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
          // ranked buckets (папки / статьи / курсы) → truly-empty success.
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
            {/* ═══ НАПРАВЛЕНИЯ — Регламенты + Учебный центр ════════════════
                Две премиальные карточки-входа: всё, что не «статьи». */}
            <View style={styles.directions}>
              {/* Регламенты — жёлтый акцент при невыполненном «Ознакомлен». */}
              <Pressable
                onPress={openRegulations}
                style={({ pressed }) => [
                  styles.directionCard,
                  { backgroundColor: regCardBg, borderColor: regCardBorder, opacity: pressed ? 0.85 : 1 },
                ]}
                accessibilityRole="button"
              >
                <View
                  style={[
                    styles.directionIcon,
                    {
                      backgroundColor: regAmber
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
                    color={regAmber ? colors.amber[600] : palette.accent.primary}
                  />
                </View>
                <View style={styles.directionBody}>
                  <Text
                    variant="callout"
                    numberOfLines={1}
                    style={{ color: regAmber ? colors.amber[800] : palette.text.primary }}
                  >
                    {regAmber ? 'Регламенты ждут вас' : 'Регламенты'}
                  </Text>
                  <Text
                    variant="footnote"
                    numberOfLines={1}
                    style={{ color: regAmber ? colors.amber[700] : palette.text.tertiary }}
                  >
                    {regAmber
                      ? pendingCount === 1
                        ? '1 документ требует «Ознакомлен»'
                        : `${pendingCount} ${plural(pendingCount, 'документ требует', 'документа требуют', 'документов требуют')} «Ознакомлен»`
                      : 'Правила и стандарты автосервиса'}
                  </Text>
                </View>
                {regAmber ? <View style={styles.dot} /> : null}
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={regAmber ? colors.amber[600] : palette.text.tertiary}
                />
              </Pressable>

              {/* Учебный центр — курсы и аттестация. */}
              <Pressable
                onPress={openCourses}
                style={({ pressed }) => [
                  styles.directionCard,
                  { backgroundColor: palette.bg.card, borderColor: palette.border.subtle, opacity: pressed ? 0.85 : 1 },
                ]}
                accessibilityRole="button"
              >
                <View style={[styles.directionIcon, { backgroundColor: palette.accent.primarySoft }]}>
                  <Ionicons name="school" size={22} color={palette.accent.primary} />
                </View>
                <View style={styles.directionBody}>
                  <Text variant="callout" numberOfLines={1} style={{ color: palette.text.primary }}>
                    Учебный центр
                  </Text>
                  {courseProgress !== null ? (
                    <Text
                      variant="footnote"
                      numberOfLines={1}
                      style={{ color: palette.accent.primary, fontWeight: '600' }}
                    >
                      Курсы пройдены на {courseProgress}%
                    </Text>
                  ) : (
                    <Text variant="footnote" numberOfLines={1} style={{ color: palette.text.tertiary }}>
                      Курсы, уроки и аттестация
                    </Text>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={18} color={palette.text.tertiary} />
              </Pressable>
            </View>

            {/* ═══ БАЗА ЗНАНИЙ (папки + статьи) ════════════════════════════ */}
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

            {/* ── Папки (только корневые; подпапки — внутри) ───────────── */}
            {rootCats.length > 0 || isManager ? (
              <View style={styles.section}>
                <View style={styles.sectionHeaderRow}>
                  <Text
                    style={[
                      iosSectionLabel,
                      styles.sectionTitle,
                      styles.sectionTitleFlush,
                      { color: palette.text.secondary },
                    ]}
                  >
                    Папки
                  </Text>
                  {isManager ? (
                    <Pressable onPress={openNewFolder} hitSlop={8} style={styles.addFolderBtn}>
                      <Ionicons name="folder-open-outline" size={15} color={palette.accent.primary} />
                      <Text variant="footnote" style={{ color: palette.accent.primary, fontWeight: '600' }}>
                        Новая папка
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
                {rootCats.length === 0 ? (
                  <Text variant="footnote" style={{ color: palette.text.tertiary, marginLeft: spacing[1] }}>
                    Папок пока нет. Создайте первую, чтобы разложить статьи по разделам.
                  </Text>
                ) : (
                  <View style={styles.rowList}>
                    {rootCats.map((cat) => (
                      <CategoryRow key={cat.id} category={cat} subtitle={folderSubtitle(cat)} onPress={openCategory} />
                    ))}
                  </View>
                )}
              </View>
            ) : null}

            {/* ── Недавние ─────────────────────────────────────────────── */}
            <View style={styles.section}>
              <Text style={[iosSectionLabel, styles.sectionTitle, { color: palette.text.secondary }]}>Недавние</Text>
              {recent === undefined && recentFetching ? (
                <ListSkeleton count={5} />
              ) : recentError && recent === undefined ? (
                // Ошибка без кэша — честный error-state с «Повторить».
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

      {/* Manager: create a root folder (or any nesting) from the home screen.
          After creation we drill straight into the new folder. */}
      {isManager ? (
        <FolderManagerModal
          visible={folderModalOpen}
          presetParentId={null}
          categories={categories ?? []}
          onClose={() => setFolderModalOpen(false)}
          onCreated={(cat) => openCategory(cat)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: spacing[4], paddingTop: spacing[2] },
  section: { marginBottom: spacing[5] },
  sectionTitle: { marginLeft: spacing[1], marginBottom: spacing[2] },
  sectionTitleFlush: { marginBottom: 0 },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[2],
  },
  addFolderBtn: { flexDirection: 'row', alignItems: 'center', gap: 3 },
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

  // Direction cards (Регламенты / Учебный центр)
  directions: { gap: spacing[2.5], marginBottom: spacing[5] },
  directionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3.5],
  },
  directionIcon: {
    width: 46,
    height: 46,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  directionBody: { flex: 1, minWidth: 0, gap: 2 },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.amber[600],
  },
});
