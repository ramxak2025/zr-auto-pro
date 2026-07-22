/**
 * KnowledgeCategoryScreen — the universal Knowledge Base AREA + FOLDER screen.
 *
 * One screen, three entry modes (driven by route params):
 *   • { articlesRoot: true }        → «Статьи» area: own search + root folders +
 *                                     root-level articles. Drilling into a folder
 *                                     pushes another instance (folder mode).
 *   • { type: 'regulation' }        → «Регламенты» area: own search «по
 *                                     регламентам и тексту внутри» + flat list.
 *   • { categoryId, name }          → a FOLDER: subfolders + its articles.
 *
 * Manager content-management (#54), reachable from each row's «…» menu:
 *   • articles — Изменить / Переместить / Скрыть(published) / Удалить
 *   • folders  — переименовать / переместить / удалить (FolderManagerModal)
 * Hidden articles (`published === false`) stay visible to managers with a
 * «Скрыто» badge and vanish for employees (enforced server-side).
 *
 * Search scopes the GLOBAL ranked search (title + body + block-text) to this
 * area's article type, and — in the Статьи area — also surfaces folder matches.
 */
import React from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import IosScreenHeader from '../components/IosScreenHeader';
import EmptyState from '../components/EmptyState';
import QueryErrorState from '../components/QueryErrorState';
import SearchInput from '../components/SearchInput';
import { ListSkeleton } from '../components/Skeleton';
import ArticleRow from '../components/knowledge/ArticleRow';
import CategoryRow from '../components/knowledge/CategoryRow';
import FolderManagerModal from '../components/knowledge/FolderManagerModal';
import ArticleActionsSheet from '../components/knowledge/ArticleActionsSheet';
import MoveToFolderModal from '../components/knowledge/MoveToFolderModal';
import { Text } from '../platform/Typography';
import { iosSectionLabel } from '../platform/iosSurface';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useColors } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { knowledgeApi } from '../api/services';
import { spacing } from '../theme';
import { haptic } from '../platform/haptics';
import { childCategories, categoryAncestors, rootCategories } from '../utils/knowledgeTree';
import type {
  KnowledgeArticle,
  KnowledgeArticleType,
  KnowledgeCategory,
  KnowledgeSearchResults,
} from '../../../shared/types';

type ParamList = {
  KnowledgeCategory: { categoryId?: string; type?: KnowledgeArticleType; name?: string; articlesRoot?: boolean };
};

/** Smart search needs ≥2 chars (server returns empty buckets below that). */
const MIN_QUERY = 2;

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
const foldersLabel = (n: number) => `${n} ${plural(n, 'папка', 'папки', 'папок')}`;
const articlesLabel = (n: number) => `${n} ${plural(n, 'статья', 'статьи', 'статей')}`;

export default function KnowledgeCategoryScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<ParamList, 'KnowledgeCategory'>>();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const queryClient = useQueryClient();
  // Мутации базы знаний — ключ knowledge_manage (сервер гейтит тем же ключом;
  // «права как в Битрикс24», 2026-07: admin живёт по матрице из /auth/me).
  const { hasPermission } = useAuth();
  const isManager = hasPermission('knowledge_manage');

  const categoryId = route.params?.categoryId;
  const type = route.params?.type;
  const isRegulationArea = type === 'regulation';
  const isArticlesRoot = route.params?.articlesRoot === true;
  const isFolder = !!categoryId;
  // The two AREA roots carry their own search; a drilled folder is browse-only.
  const showSearch = isArticlesRoot || isRegulationArea;
  const title = route.params?.name ?? (isRegulationArea ? 'Регламенты' : isArticlesRoot ? 'Статьи' : 'Папка');

  // ── Local UI state ──────────────────────────────────────────────────────
  const [search, setSearch] = React.useState('');
  const debouncedSearch = useDebouncedValue(search.trim(), 300);
  const isSearching = showSearch && debouncedSearch.length > 0;
  const queryReady = debouncedSearch.length >= MIN_QUERY;

  const [createFolderOpen, setCreateFolderOpen] = React.useState(false);
  const [editFolder, setEditFolder] = React.useState<KnowledgeCategory | null>(null);
  const [actionArticle, setActionArticle] = React.useState<KnowledgeArticle | null>(null);
  const [moveArticle, setMoveArticle] = React.useState<KnowledgeArticle | null>(null);

  // ── Articles in this area/folder ────────────────────────────────────────
  const listParams = isFolder ? { categoryId } : isRegulationArea ? { type: 'regulation' as const } : {};
  const articlesKey = isArticlesRoot
    ? ['knowledge-articles', 'all']
    : ['knowledge-articles', 'category', categoryId ?? null, type ?? null];
  const {
    data: rawArticles,
    isError,
    isFetching,
    refetch,
    isRefetching,
    isLoading,
  } = useQuery<KnowledgeArticle[]>({
    queryKey: articlesKey,
    queryFn: async () => (await knowledgeApi.listArticles(listParams)).data,
    staleTime: 60_000,
    retry: 1,
  });

  // ── Categories (cached app-wide) — subfolders + breadcrumb + counts +
  //    the move-to-folder picker (also reachable for regulations). ──────────
  const { data: categories, refetch: refetchCategories } = useQuery<KnowledgeCategory[]>({
    queryKey: ['knowledge-categories'],
    queryFn: async () => (await knowledgeApi.listCategories()).data,
    staleTime: 5 * 60_000,
  });

  // ── Global smart search, scoped to this area ────────────────────────────
  const {
    data: results,
    isFetching: searchFetching,
    isError: searchError,
    refetch: refetchSearch,
  } = useQuery<KnowledgeSearchResults>({
    queryKey: ['knowledge-search', debouncedSearch],
    queryFn: async () => (await knowledgeApi.search(debouncedSearch)).data,
    enabled: isSearching && queryReady,
    staleTime: 30_000,
    retry: 1,
  });

  // ── Derived browse data ─────────────────────────────────────────────────
  const articles = React.useMemo<KnowledgeArticle[]>(() => {
    const all = rawArticles ?? [];
    if (isRegulationArea) return all; // server already type-filtered
    if (isArticlesRoot) return all.filter((a) => a.type === 'article' && (a.categoryId ?? null) === null);
    return all.filter((a) => a.type === 'article'); // folder: articles only
  }, [rawArticles, isRegulationArea, isArticlesRoot]);

  const folders = React.useMemo<KnowledgeCategory[]>(() => {
    if (!categories) return [];
    if (isArticlesRoot) return rootCategories(categories);
    if (isFolder && categoryId) return childCategories(categories, categoryId);
    return [];
  }, [categories, isArticlesRoot, isFolder, categoryId]);

  const ancestors = React.useMemo(
    () => (categoryId && categories ? categoryAncestors(categories, categoryId) : []),
    [categories, categoryId],
  );

  // Per-folder subtitle: «3 папки · 12 статей» (article count only where we have
  // the full article list — i.e. the Статьи root).
  const folderSubtitle = React.useCallback(
    (cat: KnowledgeCategory): string | undefined => {
      const subN = categories ? childCategories(categories, cat.id).length : 0;
      const parts: string[] = [];
      if (subN > 0) parts.push(foldersLabel(subN));
      if (isArticlesRoot && rawArticles) {
        const artN = rawArticles.filter((a) => a.type === 'article' && a.categoryId === cat.id).length;
        if (artN > 0) parts.push(articlesLabel(artN));
      }
      return parts.length > 0 ? parts.join('  ·  ') : undefined;
    },
    [categories, isArticlesRoot, rawArticles],
  );

  // ── Search buckets, scoped to this area ─────────────────────────────────
  const searchArticles = React.useMemo<KnowledgeArticle[]>(() => {
    if (!results) return [];
    return results.articles.filter((a) => (isRegulationArea ? a.type === 'regulation' : a.type === 'article'));
  }, [results, isRegulationArea]);
  const searchFolders = isRegulationArea ? [] : (results?.categories ?? []);
  const searchCount = searchArticles.length + searchFolders.length;

  // ── Mutations (manager content management) ──────────────────────────────
  const invalidate = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['knowledge-articles'] });
    queryClient.invalidateQueries({ queryKey: ['knowledge-regulations-pending'] });
  }, [queryClient]);

  const hideMutation = useMutation({
    mutationFn: async (a: KnowledgeArticle) =>
      (await knowledgeApi.updateArticle(a.id, { title: a.title, published: a.published === false })).data,
    onSuccess: () => {
      haptic('success');
      invalidate();
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось изменить видимость. Попробуйте ещё раз.');
    },
  });

  const moveMutation = useMutation({
    mutationFn: async (vars: { article: KnowledgeArticle; targetId: string | null }) =>
      (await knowledgeApi.updateArticle(vars.article.id, { title: vars.article.title, categoryId: vars.targetId }))
        .data,
    onSuccess: () => {
      haptic('success');
      invalidate();
      setMoveArticle(null);
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось переместить статью. Попробуйте ещё раз.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => (await knowledgeApi.deleteArticle(id)).data,
    onSuccess: () => {
      haptic('success');
      invalidate();
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось удалить статью. Попробуйте ещё раз.');
    },
  });

  // ── Navigation / actions ────────────────────────────────────────────────
  const openArticle = React.useCallback(
    (article: KnowledgeArticle) => {
      navigation.navigate('KnowledgeArticle', { id: article.id, title: article.title });
    },
    [navigation],
  );

  const openFolder = React.useCallback(
    (cat: KnowledgeCategory) => {
      navigation.push('KnowledgeCategory', { categoryId: cat.id, name: cat.name });
    },
    [navigation],
  );

  const goHome = React.useCallback(() => {
    haptic('tap');
    navigation.navigate('KnowledgeBase');
  }, [navigation]);

  const openNewArticle = React.useCallback(() => {
    haptic('tap');
    navigation.navigate('KnowledgeEditor', { categoryId, type });
  }, [navigation, categoryId, type]);

  // Article «…» menu handlers (the sheet closes, then the next step runs).
  const onEditArticle = React.useCallback(() => {
    const a = actionArticle;
    setActionArticle(null);
    if (a) navigation.navigate('KnowledgeEditor', { id: a.id });
  }, [actionArticle, navigation]);

  const onMoveArticle = React.useCallback(() => {
    const a = actionArticle;
    setActionArticle(null);
    // Let the action sheet dismiss before presenting the move sheet.
    setTimeout(() => setMoveArticle(a), 260);
  }, [actionArticle]);

  const onToggleHide = React.useCallback(() => {
    const a = actionArticle;
    setActionArticle(null);
    if (a) hideMutation.mutate(a);
  }, [actionArticle, hideMutation]);

  const onDeleteArticle = React.useCallback(() => {
    const a = actionArticle;
    setActionArticle(null);
    if (!a) return;
    Alert.alert('Удалить статью?', `«${a.title}» будет удалена без возможности восстановления.`, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => deleteMutation.mutate(a.id) },
    ]);
  }, [actionArticle, deleteMutation]);

  const onRefreshAll = React.useCallback(() => {
    refetch();
    refetchCategories();
  }, [refetch, refetchCategories]);

  // Manager affordances: «…» menus only when this user can manage content.
  const articleMore = isManager ? (a: KnowledgeArticle) => setActionArticle(a) : undefined;
  const folderMore = isManager ? (c: KnowledgeCategory) => setEditFolder(c) : undefined;

  const canCreateFolder = isManager && !isRegulationArea; // root folder or subfolder
  const folderAddLabel = isFolder ? 'Подпапка' : 'Новая папка';

  const headerTrailing = isManager ? (
    <Pressable
      onPress={openNewArticle}
      hitSlop={10}
      style={[styles.headerBtn, { backgroundColor: palette.accent.primarySoft }]}
      accessibilityRole="button"
      accessibilityLabel={isRegulationArea ? 'Новый регламент' : 'Новая статья'}
    >
      <Ionicons name="add" size={22} color={palette.accent.primary} />
    </Pressable>
  ) : undefined;

  const hasArticles = articles.length > 0;
  const hasFolders = folders.length > 0;

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title={title} onBack={() => navigation.goBack()} trailing={headerTrailing} />

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
            refreshing={isRefetching && !isLoading}
            onRefresh={onRefreshAll}
            tintColor={palette.text.tertiary}
          />
        }
      >
        {/* Breadcrumb — «База знаний» (tap → home) › area › … › current. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.breadcrumb}
        >
          <Pressable onPress={goHome} hitSlop={6} style={styles.crumbBtn} accessibilityRole="button">
            <Ionicons name="library-outline" size={13} color={palette.text.tertiary} />
            <Text variant="caption" style={{ color: palette.text.tertiary }}>
              База знаний
            </Text>
          </Pressable>
          {/* Area crumb (Статьи / Регламенты) */}
          <Crumb label={isRegulationArea ? 'Регламенты' : 'Статьи'} bold={!isFolder} palette={palette} />
          {/* Folder ancestors + current (folder mode only) */}
          {isFolder
            ? [
                ...ancestors.map((a) => <Crumb key={a.id} label={a.name} palette={palette} />),
                <Crumb key="cur" label={title} bold palette={palette} />,
              ]
            : null}
        </ScrollView>

        {/* Per-area search bar (Статьи / Регламенты) */}
        {showSearch ? (
          <SearchInput
            value={search}
            onChange={setSearch}
            placeholder={isRegulationArea ? 'Поиск по регламентам и тексту' : 'Поиск по статьям и папкам'}
          />
        ) : null}

        {isSearching ? (
          // ── Search results (honest state machine) ──────────────────────
          <View style={styles.section}>
            {!queryReady ? (
              <EmptyState icon="search" title="Введите минимум 2 символа" description="Ищем по названию и тексту." />
            ) : results === undefined && searchFetching ? (
              <ListSkeleton count={5} />
            ) : searchError && results === undefined ? (
              <QueryErrorState description="Проверьте соединение и попробуйте снова." onRetry={() => refetchSearch()} />
            ) : results === undefined ? (
              <ListSkeleton count={5} />
            ) : searchCount > 0 ? (
              <View style={styles.results}>
                {searchFolders.length > 0 ? (
                  <View>
                    <Text style={[iosSectionLabel, styles.sectionLabel, { color: palette.text.secondary }]}>Папки</Text>
                    <View style={styles.rowList}>
                      {searchFolders.map((c) => (
                        <CategoryRow key={c.id} category={c} onPress={openFolder} onMore={folderMore} />
                      ))}
                    </View>
                  </View>
                ) : null}
                {searchArticles.length > 0 ? (
                  <View>
                    <Text style={[iosSectionLabel, styles.sectionLabel, { color: palette.text.secondary }]}>
                      {isRegulationArea ? 'Регламенты' : 'Статьи'}
                    </Text>
                    <View style={styles.rowList}>
                      {searchArticles.map((a) => (
                        <ArticleRow key={a.id} article={a} onPress={openArticle} onMore={articleMore} />
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
        ) : rawArticles === undefined && isFetching ? (
          <ListSkeleton count={6} />
        ) : isError && rawArticles === undefined ? (
          <QueryErrorState description="Проверьте соединение и попробуйте снова." onRetry={() => refetch()} />
        ) : rawArticles === undefined ? (
          <ListSkeleton count={6} />
        ) : (
          <>
            {/* Folders — present, or a manager can add one */}
            {hasFolders || canCreateFolder ? (
              <View style={styles.section}>
                <View style={styles.sectionHeaderRow}>
                  <Text
                    style={[
                      iosSectionLabel,
                      styles.sectionLabel,
                      styles.sectionLabelFlush,
                      { color: palette.text.secondary },
                    ]}
                  >
                    Папки
                  </Text>
                  {canCreateFolder ? (
                    <Pressable
                      onPress={() => {
                        haptic('tap');
                        setCreateFolderOpen(true);
                      }}
                      hitSlop={8}
                      style={styles.addFolderBtn}
                    >
                      <Ionicons name="folder-open-outline" size={15} color={palette.accent.primary} />
                      <Text variant="footnote" style={{ color: palette.accent.primary, fontWeight: '600' }}>
                        {folderAddLabel}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
                {hasFolders ? (
                  <View style={styles.rowList}>
                    {folders.map((cat) => (
                      <CategoryRow
                        key={cat.id}
                        category={cat}
                        subtitle={folderSubtitle(cat)}
                        onPress={openFolder}
                        onMore={folderMore}
                      />
                    ))}
                  </View>
                ) : (
                  <Text variant="footnote" style={{ color: palette.text.tertiary, marginLeft: spacing[1] }}>
                    Папок пока нет. Создайте первую, чтобы разложить статьи по разделам.
                  </Text>
                )}
              </View>
            ) : null}

            {/* Articles */}
            {hasArticles ? (
              <View style={styles.section}>
                {hasFolders ? (
                  <Text style={[iosSectionLabel, styles.sectionLabel, { color: palette.text.secondary }]}>
                    {isRegulationArea ? 'Регламенты' : 'Статьи'}
                  </Text>
                ) : null}
                <View style={styles.rowList}>
                  {articles.map((a) => (
                    <ArticleRow key={a.id} article={a} onPress={openArticle} onMore={articleMore} />
                  ))}
                </View>
              </View>
            ) : null}

            {/* Truly empty */}
            {!hasFolders && !hasArticles ? (
              <EmptyState
                icon={isRegulationArea ? 'shield-check' : 'journal'}
                title="Здесь пока пусто"
                description={
                  isManager
                    ? isRegulationArea
                      ? 'Добавьте первый регламент — нажмите «+» в правом верхнем углу.'
                      : 'Добавьте статью или создайте папку, чтобы наполнить раздел.'
                    : isRegulationArea
                      ? 'Регламентов пока нет.'
                      : 'Здесь появятся статьи автосервиса.'
                }
                action={
                  isManager
                    ? { label: isRegulationArea ? 'Новый регламент' : 'Новая статья', onPress: openNewArticle }
                    : undefined
                }
              />
            ) : null}
          </>
        )}
      </ScrollView>

      {/* Manager: create folder / subfolder */}
      {canCreateFolder ? (
        <FolderManagerModal
          visible={createFolderOpen}
          presetParentId={categoryId ?? null}
          categories={categories ?? []}
          onClose={() => setCreateFolderOpen(false)}
          onCreated={(cat) => openFolder(cat)}
        />
      ) : null}

      {/* Manager: edit / move / delete a folder */}
      {isManager ? (
        <FolderManagerModal
          visible={!!editFolder}
          editCategory={editFolder}
          categories={categories ?? []}
          onClose={() => setEditFolder(null)}
          onUpdated={() => setEditFolder(null)}
          onDeleted={() => setEditFolder(null)}
        />
      ) : null}

      {/* Manager: article «…» actions */}
      {isManager ? (
        <ArticleActionsSheet
          article={actionArticle}
          onClose={() => setActionArticle(null)}
          onEdit={onEditArticle}
          onMove={onMoveArticle}
          onToggleHide={onToggleHide}
          onDelete={onDeleteArticle}
        />
      ) : null}

      {/* Manager: move article into a folder */}
      {isManager ? (
        <MoveToFolderModal
          visible={!!moveArticle}
          title="Переместить статью"
          itemLabel={moveArticle?.title}
          categories={categories ?? []}
          currentId={moveArticle?.categoryId ?? null}
          busy={moveMutation.isPending}
          onClose={() => setMoveArticle(null)}
          onConfirm={(targetId) => {
            if (moveArticle) moveMutation.mutate({ article: moveArticle, targetId });
          }}
        />
      ) : null}
    </View>
  );
}

function Crumb({ label, bold, palette }: { label: string; bold?: boolean; palette: ReturnType<typeof useColors> }) {
  return (
    <View style={styles.crumbItem}>
      <Ionicons name="chevron-forward" size={11} color={palette.text.tertiary} style={styles.crumbSep} />
      <Text
        variant="caption"
        numberOfLines={1}
        style={{ color: bold ? palette.text.secondary : palette.text.tertiary, fontWeight: bold ? '700' : '400' }}
      >
        {label}
      </Text>
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
  breadcrumb: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    marginBottom: spacing[3.5],
    paddingHorizontal: spacing[1],
    paddingVertical: spacing[0.5],
  },
  crumbBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  crumbItem: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 180 },
  crumbSep: { marginHorizontal: 1 },
  section: { marginBottom: spacing[5] },
  sectionLabel: { marginLeft: spacing[1], marginBottom: spacing[2] },
  sectionLabelFlush: { marginBottom: 0 },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[2],
  },
  addFolderBtn: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  rowList: { gap: spacing[2] },
  results: { gap: spacing[5] },
});
