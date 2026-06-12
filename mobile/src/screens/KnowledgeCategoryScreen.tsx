/**
 * KnowledgeCategoryScreen — articles within a single category, OR the
 * «Регламенты» collection (type='regulation').
 *
 * Route params (one of):
 *   • { categoryId, name }       — all articles in that category
 *   • { type: 'regulation', name } — regulation collection (from the home banner)
 *
 * Slim rows (title + «Регламент» chip + excerpt + pinned star). Tap → reader.
 */
import React from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import IosScreenHeader from '../components/IosScreenHeader';
import EmptyState from '../components/EmptyState';
import QueryErrorState from '../components/QueryErrorState';
import { ListSkeleton } from '../components/Skeleton';
import ArticleRow from '../components/knowledge/ArticleRow';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { useColors } from '../contexts/ThemeContext';
import { knowledgeApi } from '../api/services';
import { spacing } from '../theme';
import type { KnowledgeArticle, KnowledgeArticleType } from '../../../shared/types';

type ParamList = {
  KnowledgeCategory: { categoryId?: string; type?: KnowledgeArticleType; name?: string };
};

export default function KnowledgeCategoryScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<ParamList, 'KnowledgeCategory'>>();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();

  const categoryId = route.params?.categoryId;
  const type = route.params?.type;
  const title = route.params?.name ?? (type === 'regulation' ? 'Регламенты' : 'Категория');

  const { data, isLoading, isError, isFetching, refetch, isRefetching } = useQuery<KnowledgeArticle[]>({
    queryKey: ['knowledge-articles', 'category', categoryId ?? null, type ?? null],
    queryFn: async () => (await knowledgeApi.listArticles({ categoryId, type })).data,
    staleTime: 60_000,
    // Surface a failed load quickly instead of retrying with long backoff.
    retry: 1,
  });

  const openArticle = React.useCallback(
    (article: KnowledgeArticle) => {
      navigation.navigate('KnowledgeArticle', { id: article.id, title: article.title });
    },
    [navigation],
  );

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
        {data === undefined && isFetching ? (
          <ListSkeleton count={6} />
        ) : isError && data === undefined ? (
          // Ошибка без кэша → честный error-state, НЕ «здесь пока пусто».
          <QueryErrorState description="Проверьте соединение и попробуйте снова." onRetry={() => refetch()} />
        ) : data === undefined ? (
          <ListSkeleton count={6} />
        ) : data.length > 0 ? (
          <View style={styles.rowList}>
            {data.map((a) => (
              <ArticleRow key={a.id} article={a} onPress={openArticle} />
            ))}
          </View>
        ) : (
          <EmptyState
            icon={type === 'regulation' ? 'shield-check' : 'journal'}
            title="Здесь пока пусто"
            description={
              type === 'regulation' ? 'В этой категории ещё нет регламентов.' : 'В этой категории ещё нет статей.'
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
  rowList: { gap: spacing[2] },
});
