/**
 * KnowledgeBaseScreen — «База знаний» home.
 *
 * A CLEAN entry, not a jumble: exactly THREE big premium blocks, each leading
 * into its own area (which carries its OWN search):
 *   1. Регламенты    — правила и стандарты; «Ознакомлен»-долг подсвечивается
 *                      жёлтым (amber) с бейджем количества.
 *   2. Учебный центр — курсы, уроки и аттестация; показывает общий прогресс.
 *   3. Статьи        — папки + статьи базы знаний (полное управление внутри).
 *
 * The former «База знаний» inner block is renamed «Статьи»: the whole SECTION is
 * «База знаний», so the inner block can't share that name. «Справочник» был
 * удалён ранее по просьбе владельца — точки входа нет.
 *
 * No global search / lists here on purpose — search lives inside each area
 * (`KnowledgeCategoryScreen`). The screen stays cache-first via React Query
 * staleTime; pull-to-refresh revives every block's data at once.
 */
import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import IosScreenHeader from '../components/IosScreenHeader';
import { Text } from '../platform/Typography';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { useColors } from '../contexts/ThemeContext';
import { knowledgeApi } from '../api/services';
import { spacing, borderRadius, colors, softTint } from '../theme';
import { haptic } from '../platform/haptics';
import type { KnowledgeArticle, KnowledgeCategory, KnowledgeCourse } from '../../../shared/types';

const STALE = 60_000;

/** Russian plural picker: 1 → one, 2–4 → few, else many (10–20 → many). */
function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
const articlesLabel = (n: number) => `${n} ${plural(n, 'статья', 'статьи', 'статей')}`;
const foldersLabel = (n: number) => `${n} ${plural(n, 'папка', 'папки', 'папок')}`;
const docsLabel = (n: number) =>
  `${n} ${plural(n, 'документ требует', 'документа требуют', 'документов требуют')} «Ознакомлен»`;

export default function KnowledgeBaseScreen() {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();

  // ── Categories (for the «Статьи» block subtitle counts) ─────────────────
  const { data: categories, refetch: refetchCategories } = useQuery<KnowledgeCategory[]>({
    queryKey: ['knowledge-categories'],
    queryFn: async () => (await knowledgeApi.listCategories()).data,
    staleTime: 5 * 60_000,
  });

  // ── Courses (for «Учебный центр» overall progress) ──────────────────────
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

  // ── All articles (for the «Статьи» count + warms the Статьи area cache) ──
  const {
    data: articles,
    refetch: refetchArticles,
    isRefetching,
  } = useQuery<KnowledgeArticle[]>({
    queryKey: ['knowledge-articles', 'all'],
    queryFn: async () => (await knowledgeApi.listArticles({})).data,
    staleTime: STALE,
    retry: 1,
  });
  const articleCount = React.useMemo(
    () => (articles ? articles.filter((a) => a.type === 'article').length : 0),
    [articles],
  );
  const folderCount = categories?.length ?? 0;

  const onRefreshAll = React.useCallback(() => {
    refetchCategories();
    refetchCourses();
    refetchPending();
    refetchArticles();
  }, [refetchCategories, refetchCourses, refetchPending, refetchArticles]);

  const openRegulations = React.useCallback(() => {
    haptic('tap');
    navigation.navigate('KnowledgeCategory', { type: 'regulation', name: 'Регламенты' });
  }, [navigation]);

  const openCourses = React.useCallback(() => {
    haptic('tap');
    navigation.navigate('KnowledgeCourseList');
  }, [navigation]);

  const openArticles = React.useCallback(() => {
    haptic('tap');
    navigation.navigate('KnowledgeCategory', { articlesRoot: true, name: 'Статьи' });
  }, [navigation]);

  // ── «Статьи» subtitle: «12 статей · 4 папки» (omit empty parts) ─────────
  const articlesSubtitle = React.useMemo(() => {
    const parts: string[] = [];
    if (articleCount > 0) parts.push(articlesLabel(articleCount));
    if (folderCount > 0) parts.push(foldersLabel(folderCount));
    return parts.length > 0 ? parts.join('  ·  ') : 'Инструкции, гайды и материалы';
  }, [articleCount, folderCount]);

  // Pending-aware amber treatment for the «Регламенты» block.
  const regAmber = pendingCount > 0;

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title="База знаний"
        subtitle="Регламенты, учебный центр и статьи"
        onBack={() => navigation.goBack()}
      />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + spacing[4] }]}
        contentInset={{ bottom: tabBarHeight }}
        scrollIndicatorInsets={{ bottom: tabBarHeight }}
        automaticallyAdjustContentInsets={false}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={onRefreshAll} tintColor={palette.text.tertiary} />
        }
      >
        <View style={styles.blocks}>
          {/* ── 1. Регламенты ─────────────────────────────────────────── */}
          <Block
            title={regAmber ? 'Регламенты ждут вас' : 'Регламенты'}
            subtitle={
              regAmber
                ? pendingCount === 1
                  ? '1 документ требует «Ознакомлен»'
                  : docsLabel(pendingCount)
                : 'Правила и стандарты автосервиса'
            }
            icon="shield-checkmark"
            tone={regAmber ? 'amber' : 'amberSoft'}
            palette={palette}
            badge={regAmber ? pendingCount : undefined}
            onPress={openRegulations}
          />

          {/* ── 2. Учебный центр ──────────────────────────────────────── */}
          <Block
            title="Учебный центр"
            subtitle={courseProgress !== null ? `Курсы пройдены на ${courseProgress}%` : 'Курсы, уроки и аттестация'}
            subtitleAccent={courseProgress !== null}
            icon="school"
            tone="green"
            palette={palette}
            onPress={openCourses}
          />

          {/* ── 3. Статьи (бывш. «База знаний») ─────────────────────────── */}
          <Block
            title="Статьи"
            subtitle={articlesSubtitle}
            icon="document-text"
            tone="blue"
            palette={palette}
            onPress={openArticles}
          />
        </View>
      </ScrollView>
    </View>
  );
}

type Tone = 'amber' | 'amberSoft' | 'green' | 'blue';

function Block({
  title,
  subtitle,
  subtitleAccent,
  icon,
  tone,
  palette,
  badge,
  onPress,
}: {
  title: string;
  subtitle: string;
  subtitleAccent?: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  tone: Tone;
  palette: ReturnType<typeof useColors>;
  badge?: number;
  onPress: () => void;
}) {
  const dark = palette.mode === 'dark';

  // Card surface — amber-on-pending gets a faint amber wash, the rest stay on
  // the neutral card surface with a tinted icon tile for identity.
  const cardBg = tone === 'amber' ? (dark ? softTint(colors.amber[600], 'dark') : colors.amber[50]) : palette.bg.card;
  const cardBorder = tone === 'amber' ? (dark ? palette.border.subtle : colors.amber[200]) : palette.border.subtle;

  const tile: Record<Tone, { bg: string; fg: string }> = {
    amber: { bg: dark ? softTint(colors.amber[600], 'dark') : colors.amber[100], fg: colors.amber[600] },
    amberSoft: { bg: dark ? softTint(colors.amber[600], 'dark') : colors.amber[50], fg: colors.amber[600] },
    green: { bg: dark ? softTint(colors.green[600], 'dark') : colors.green[50], fg: colors.green[600] },
    blue: { bg: palette.accent.primarySoft, fg: palette.accent.primary },
  };
  const t = tile[tone];

  const titleColor = tone === 'amber' ? (dark ? colors.amber[200] : colors.amber[800]) : palette.text.primary;
  const subtitleColor = subtitleAccent
    ? palette.accent.primary
    : tone === 'amber'
      ? dark
        ? colors.amber[200]
        : colors.amber[700]
      : palette.text.tertiary;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.block,
        { backgroundColor: cardBg, borderColor: cardBorder, opacity: pressed ? 0.85 : 1 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={title}
    >
      <View style={[styles.blockIcon, { backgroundColor: t.bg }]}>
        <Ionicons name={icon} size={26} color={t.fg} />
      </View>
      <View style={styles.blockBody}>
        <Text variant="title3" numberOfLines={1} style={{ color: titleColor }}>
          {title}
        </Text>
        <Text
          variant="footnote"
          numberOfLines={1}
          style={{ color: subtitleColor, fontWeight: subtitleAccent ? '600' : '400' }}
        >
          {subtitle}
        </Text>
      </View>
      {badge ? (
        <View style={styles.badge}>
          <Text variant="caption" color={colors.white} style={styles.badgeText}>
            {badge > 99 ? '99+' : badge}
          </Text>
        </View>
      ) : null}
      <Ionicons name="chevron-forward" size={20} color={tone === 'amber' ? colors.amber[600] : palette.text.tertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: spacing[4], paddingTop: spacing[3] },
  blocks: { gap: spacing[3] },

  block: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3.5],
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
    minHeight: 88,
  },
  blockIcon: {
    width: 56,
    height: 56,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blockBody: { flex: 1, minWidth: 0, gap: 3 },
  badge: {
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 6,
    backgroundColor: colors.amber[600],
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontWeight: '800' },
});
