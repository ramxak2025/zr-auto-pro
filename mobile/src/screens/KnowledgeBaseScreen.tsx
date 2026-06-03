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
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
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
import type { KnowledgeArticle, KnowledgeCategory } from '../../../shared/types';

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

  // ── Recent (all, slim) ──────────────────────────────────────────────────
  const { data: recent, isLoading: recentLoading } = useQuery<KnowledgeArticle[]>({
    queryKey: ['knowledge-articles', 'recent'],
    queryFn: async () => (await knowledgeApi.listArticles({})).data,
    staleTime: STALE,
  });

  // ── Search results ──────────────────────────────────────────────────────
  const { data: results, isFetching: searchFetching } = useQuery<KnowledgeArticle[]>({
    queryKey: ['knowledge-articles', 'search', debouncedSearch],
    queryFn: async () => (await knowledgeApi.listArticles({ search: debouncedSearch })).data,
    enabled: isSearching,
    staleTime: 30_000,
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
      >
        <SearchInput value={search} onChange={setSearch} placeholder="Поиск по базе знаний" />

        {isSearching ? (
          // ── SEARCH RESULTS ──────────────────────────────────────────────
          <View style={styles.section}>
            {searchFetching && !results ? (
              <ListSkeleton count={5} />
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
