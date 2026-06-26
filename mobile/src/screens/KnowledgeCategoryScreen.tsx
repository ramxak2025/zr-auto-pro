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
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import IosScreenHeader from '../components/IosScreenHeader';
import EmptyState from '../components/EmptyState';
import QueryErrorState from '../components/QueryErrorState';
import { ListSkeleton } from '../components/Skeleton';
import ArticleRow from '../components/knowledge/ArticleRow';
import CategoryRow from '../components/knowledge/CategoryRow';
import { Text } from '../platform/Typography';
import { iosSectionLabel } from '../platform/iosSurface';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { useColors } from '../contexts/ThemeContext';
import { knowledgeApi } from '../api/services';
import { spacing } from '../theme';
import { childCategories, categoryAncestors } from '../utils/knowledgeTree';
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

  const categoryId = route.params?.categoryId;
  const type = route.params?.type;
  const title = route.params?.name ?? (type === 'regulation' ? 'Регламенты' : 'Категория');
  const isRegulationCollection = type === 'regulation';

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

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title={title} onBack={() => navigation.goBack()} />
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
        {/* Breadcrumb — orientation within the folder tree (Files-like). */}
        {ancestors.length > 0 ? (
          <View style={styles.breadcrumb}>
            <Ionicons name="folder-outline" size={13} color={palette.text.tertiary} />
            <Text variant="caption" numberOfLines={1} style={{ flex: 1, color: palette.text.tertiary }}>
              {ancestors.map((a) => a.name).join('  ›  ')}
            </Text>
          </View>
        ) : null}

        {data === undefined && isFetching ? (
          <ListSkeleton count={6} />
        ) : isError && data === undefined ? (
          // Ошибка без кэша → честный error-state, НЕ «здесь пока пусто».
          <QueryErrorState description="Проверьте соединение и попробуйте снова." onRetry={() => refetch()} />
        ) : data === undefined ? (
          <ListSkeleton count={6} />
        ) : hasFolders || hasArticles ? (
          <>
            {/* Subfolders */}
            {hasFolders ? (
              <View style={styles.section}>
                <Text style={[iosSectionLabel, styles.sectionLabel, { color: palette.text.secondary }]}>Папки</Text>
                <View style={styles.rowList}>
                  {subfolders.map((cat) => (
                    <CategoryRow key={cat.id} category={cat} subtitle={subfolderSubtitle(cat)} onPress={openFolder} />
                  ))}
                </View>
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
          </>
        ) : (
          <EmptyState
            icon={isRegulationCollection ? 'shield-check' : 'journal'}
            title="Здесь пока пусто"
            description={
              isRegulationCollection
                ? 'В этой категории ещё нет регламентов.'
                : 'В этой папке ещё нет статей и подпапок.'
            }
          />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: spacing[4], paddingTop: spacing[2] },
  breadcrumb: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    marginBottom: spacing[3],
    paddingHorizontal: spacing[1],
  },
  section: { marginBottom: spacing[5] },
  sectionLabel: { marginLeft: spacing[1], marginBottom: spacing[2] },
  rowList: { gap: spacing[2] },
});
