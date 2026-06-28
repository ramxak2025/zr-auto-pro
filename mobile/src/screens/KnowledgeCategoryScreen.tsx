/**
 * KnowledgeCategoryScreen — a navigable Knowledge Base FOLDER.
 *
 * Apple Files / Notes feel: a category screen shows its SUBFOLDERS first, then
 * the articles that live directly in it. Tapping a subfolder drills one level
 * deeper (pushes another instance of this screen); the header back chevron pops
 * out, and a breadcrumb trail under the header gives orientation.
 *
 * The folder tree is built entirely client-side by grouping the flat
 * `listCategories` array on `parentId` (079 contract) — no extra endpoint.
 *
 * Route params (one of):
 *   • { categoryId, name }          — a folder: subfolders + its articles
 *   • { type: 'regulation', name }  — the regulations collection (no folders)
 */
import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import IosScreenHeader from '../components/IosScreenHeader';
import EmptyState from '../components/EmptyState';
import QueryErrorState from '../components/QueryErrorState';
import { ListSkeleton } from '../components/Skeleton';
import ArticleRow from '../components/knowledge/ArticleRow';
import CategoryRow from '../components/knowledge/CategoryRow';
import FolderManagerModal from '../components/knowledge/FolderManagerModal';
import { Text } from '../platform/Typography';
import { iosSectionLabel } from '../platform/iosSurface';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { useColors } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { knowledgeApi } from '../api/services';
import { spacing } from '../theme';
import { haptic } from '../platform/haptics';
import { childCategories, categoryAncestors } from '../utils/knowledgeTree';
import { UserRole } from '../../../shared/types';
import type { KnowledgeArticle, KnowledgeArticleType, KnowledgeCategory } from '../../../shared/types';

type ParamList = {
  KnowledgeCategory: { categoryId?: string; type?: KnowledgeArticleType; name?: string };
};

/** Russian plural for «папка» (1 папка / 2 папки / 5 папок). */
function foldersLabel(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} папка`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} папки`;
  return `${n} папок`;
}

export default function KnowledgeCategoryScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<ParamList, 'KnowledgeCategory'>>();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const { isRole } = useAuth();
  const isManager = isRole(UserRole.DIRECTOR, UserRole.ADMIN, UserRole.SUPERADMIN);

  const categoryId = route.params?.categoryId;
  const type = route.params?.type;
  const title = route.params?.name ?? (type === 'regulation' ? 'Регламенты' : 'Категория');
  const isRegulationCollection = type === 'regulation';

  const [folderModalOpen, setFolderModalOpen] = React.useState(false);

  // ── Articles in this folder (the primary content) ───────────────────────
  const { data, isLoading, isError, isFetching, refetch, isRefetching } = useQuery<KnowledgeArticle[]>({
    queryKey: ['knowledge-articles', 'category', categoryId ?? null, type ?? null],
    queryFn: async () => (await knowledgeApi.listArticles({ categoryId, type })).data,
    staleTime: 60_000,
    // Surface a failed load quickly instead of retrying with long backoff.
    retry: 1,
  });

  // ── Categories (cached app-wide) — used to derive subfolders + breadcrumb ─
  const { data: categories } = useQuery<KnowledgeCategory[]>({
    queryKey: ['knowledge-categories'],
    queryFn: async () => (await knowledgeApi.listCategories()).data,
    staleTime: 5 * 60_000,
    // Folders are a nice-to-have layer; never block the article list on this.
    enabled: !isRegulationCollection,
  });

  const subfolders = React.useMemo(
    () => (categoryId && categories ? childCategories(categories, categoryId) : []),
    [categories, categoryId],
  );
  const ancestors = React.useMemo(
    () => (categoryId && categories ? categoryAncestors(categories, categoryId) : []),
    [categories, categoryId],
  );

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

  // Breadcrumb «База знаний» root tap → back to the KB home. `navigate` to a
  // route already in the MoreStack pops back to it (no duplicate push), so a
  // deep folder collapses straight to the home in one tap.
  const goHome = React.useCallback(() => {
    haptic('tap');
    navigation.navigate('KnowledgeBase');
  }, [navigation]);

  // Manager: create an article that lands directly in this folder/collection.
  const openNewArticle = React.useCallback(() => {
    haptic('tap');
    navigation.navigate('KnowledgeEditor', { categoryId, type });
  }, [navigation, categoryId, type]);

  const openNewSubfolder = React.useCallback(() => {
    haptic('tap');
    setFolderModalOpen(true);
  }, []);

  const subfolderSubtitle = React.useCallback(
    (cat: KnowledgeCategory) => {
      if (!categories) return undefined;
      const n = childCategories(categories, cat.id).length;
      return n > 0 ? foldersLabel(n) : undefined;
    },
    [categories],
  );

  const articles = data ?? [];
  const hasArticles = articles.length > 0;
  const hasFolders = subfolders.length > 0;
  // Subfolders only make sense inside a real folder (a categoryId). The
  // regulations collection is a type-filtered view, not a tree node.
  const canCreateSubfolder = isManager && !!categoryId;

  const headerTrailing = isManager ? (
    <Pressable
      onPress={openNewArticle}
      hitSlop={10}
      style={[styles.headerBtn, { backgroundColor: palette.accent.primarySoft }]}
      accessibilityRole="button"
      accessibilityLabel={isRegulationCollection ? 'Новый регламент' : 'Новая статья'}
    >
      <Ionicons name="add" size={22} color={palette.accent.primary} />
    </Pressable>
  ) : undefined;

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title={title} onBack={() => navigation.goBack()} trailing={headerTrailing} />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + spacing[4] }]}
        contentInset={{ bottom: tabBarHeight }}
        scrollIndicatorInsets={{ bottom: tabBarHeight }}
        automaticallyAdjustContentInsets={false}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching && !isLoading}
            onRefresh={refetch}
            tintColor={palette.text.tertiary}
          />
        }
      >
        {/* Breadcrumb — a scrollable «База знаний › … › эта папка» trail. The
            home crumb taps back to the KB home; the current folder is bold.
            Always shown for orientation (Files-app style). */}
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
          {ancestors.map((a) => (
            <View key={a.id} style={styles.crumbItem}>
              <Ionicons name="chevron-forward" size={11} color={palette.text.tertiary} style={styles.crumbSep} />
              <Text variant="caption" numberOfLines={1} style={{ color: palette.text.tertiary }}>
                {a.name}
              </Text>
            </View>
          ))}
          <View style={styles.crumbItem}>
            <Ionicons name="chevron-forward" size={11} color={palette.text.tertiary} style={styles.crumbSep} />
            <Text variant="caption" numberOfLines={1} style={{ color: palette.text.secondary, fontWeight: '700' }}>
              {title}
            </Text>
          </View>
        </ScrollView>

        {data === undefined && isFetching ? (
          <ListSkeleton count={6} />
        ) : isError && data === undefined ? (
          // Ошибка без кэша → честный error-state, НЕ «здесь пока пусто».
          <QueryErrorState description="Проверьте соединение и попробуйте снова." onRetry={() => refetch()} />
        ) : data === undefined ? (
          <ListSkeleton count={6} />
        ) : (
          <>
            {/* Subfolders — visible when present OR when a manager can add one. */}
            {hasFolders || canCreateSubfolder ? (
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
                  {canCreateSubfolder ? (
                    <Pressable onPress={openNewSubfolder} hitSlop={8} style={styles.addFolderBtn}>
                      <Ionicons name="folder-open-outline" size={15} color={palette.accent.primary} />
                      <Text variant="footnote" style={{ color: palette.accent.primary, fontWeight: '600' }}>
                        Подпапка
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
                {hasFolders ? (
                  <View style={styles.rowList}>
                    {subfolders.map((cat) => (
                      <CategoryRow key={cat.id} category={cat} subtitle={subfolderSubtitle(cat)} onPress={openFolder} />
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* Articles directly in this folder */}
            {hasArticles ? (
              <View style={styles.section}>
                {hasFolders ? (
                  <Text style={[iosSectionLabel, styles.sectionLabel, { color: palette.text.secondary }]}>Статьи</Text>
                ) : null}
                <View style={styles.rowList}>
                  {articles.map((a) => (
                    <ArticleRow key={a.id} article={a} onPress={openArticle} />
                  ))}
                </View>
              </View>
            ) : null}

            {/* Truly empty — honest state; managers get a create CTA. */}
            {!hasFolders && !hasArticles ? (
              <EmptyState
                icon={isRegulationCollection ? 'shield-check' : 'journal'}
                title="Здесь пока пусто"
                description={
                  isManager
                    ? isRegulationCollection
                      ? 'Добавьте первый регламент в эту категорию.'
                      : 'Добавьте статью или создайте подпапку, чтобы наполнить раздел.'
                    : isRegulationCollection
                      ? 'В этой категории ещё нет регламентов.'
                      : 'В этой папке ещё нет статей и подпапок.'
                }
                action={
                  isManager
                    ? { label: isRegulationCollection ? 'Новый регламент' : 'Новая статья', onPress: openNewArticle }
                    : undefined
                }
              />
            ) : null}
          </>
        )}
      </ScrollView>

      {/* Manager: create a subfolder of THIS folder; drill in on success. */}
      {canCreateSubfolder ? (
        <FolderManagerModal
          visible={folderModalOpen}
          presetParentId={categoryId}
          categories={categories ?? []}
          onClose={() => setFolderModalOpen(false)}
          onCreated={(cat) => openFolder(cat)}
        />
      ) : null}
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
});
