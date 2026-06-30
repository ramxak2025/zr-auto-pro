/**
 * ArticleRow — a slim, reusable list row for a Knowledge Base article.
 *
 * Used on the article areas (Статьи / Регламенты) and inside folders. Shows:
 *   • optional cover thumbnail (else a typed glyph tile)
 *   • title + a «Регламент» chip for regulations + a pinned star
 *   • a «Скрыто» badge when `published === false` (manager-only view; employees
 *     never receive hidden articles)
 *   • a one-line excerpt
 *
 * Manager affordance (#54): when `onMore` is provided the trailing chevron is
 * replaced by a «…» button that opens the article actions menu (edit / move /
 * hide / delete). The «…» button is a sibling of the open-Pressable — not
 * nested — so a tap never double-fires the row's open handler.
 *
 * Memoised — these rows render in lists where the parent re-renders on search.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import CachedImage from '../CachedImage';
import { Text } from '../../platform/Typography';
import { spacing, borderRadius, colors } from '../../theme';
import { useColors } from '../../contexts/ThemeContext';
import { getImageUrl } from '../../api/axios';
import { haptic } from '../../platform/haptics';
import type { KnowledgeArticle } from '../../../../shared/types';

interface ArticleRowProps {
  article: KnowledgeArticle;
  onPress: (article: KnowledgeArticle) => void;
  /** Manager: show a «…» menu button instead of the chevron. */
  onMore?: (article: KnowledgeArticle) => void;
}

function ArticleRowInner({ article, onPress, onMore }: ArticleRowProps) {
  const palette = useColors();
  const isRegulation = article.type === 'regulation';
  const hidden = article.published === false;
  const cover = getImageUrl(article.coverImage);

  return (
    <View
      style={[
        styles.row,
        { backgroundColor: palette.bg.card, borderColor: palette.border.subtle, opacity: hidden ? 0.6 : 1 },
      ]}
    >
      <Pressable
        onPress={() => {
          haptic('tap');
          onPress(article);
        }}
        style={({ pressed }) => [styles.main, { opacity: pressed ? 0.6 : 1 }]}
        accessibilityRole="button"
        accessibilityLabel={article.title}
      >
        {cover ? (
          <CachedImage source={{ uri: cover }} style={styles.thumb} resizeMode="cover" />
        ) : (
          <View
            style={[
              styles.thumb,
              styles.thumbFallback,
              { backgroundColor: isRegulation ? colors.amber[50] : palette.accent.primarySoft },
            ]}
          >
            <Ionicons
              name={isRegulation ? 'shield-checkmark-outline' : 'document-text-outline'}
              size={20}
              color={isRegulation ? colors.amber[600] : palette.accent.primary}
            />
          </View>
        )}

        <View style={styles.body}>
          <View style={styles.titleRow}>
            <Text variant="bodyEmph" numberOfLines={1} style={[styles.title, { color: palette.text.primary }]}>
              {article.title}
            </Text>
            {article.pinned ? <Ionicons name="star" size={13} color={colors.amber[600]} /> : null}
          </View>

          <View style={styles.metaRow}>
            {isRegulation ? (
              <View style={[styles.chip, { backgroundColor: colors.amber[50] }]}>
                <Text variant="caption" style={{ color: colors.amber[700], fontWeight: '700' }}>
                  Регламент
                </Text>
              </View>
            ) : null}
            {hidden ? (
              <View style={[styles.chip, styles.hiddenChip, { backgroundColor: palette.bg.muted }]}>
                <Ionicons name="eye-off-outline" size={11} color={palette.text.tertiary} />
                <Text variant="caption" style={{ color: palette.text.tertiary, fontWeight: '700' }}>
                  Скрыто
                </Text>
              </View>
            ) : null}
            {article.excerpt ? (
              <Text variant="footnote" numberOfLines={1} style={[styles.excerpt, { color: palette.text.secondary }]}>
                {article.excerpt}
              </Text>
            ) : null}
          </View>
        </View>

        {!onMore ? <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} /> : null}
      </Pressable>

      {onMore ? (
        <Pressable
          onPress={() => {
            haptic('tap');
            onMore(article);
          }}
          hitSlop={10}
          style={({ pressed }) => [styles.moreBtn, { backgroundColor: palette.bg.muted, opacity: pressed ? 0.6 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="Действия со статьёй"
        >
          <Ionicons name="ellipsis-horizontal" size={18} color={palette.text.secondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    minHeight: 64,
  },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing[3], minWidth: 0 },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.lg,
  },
  thumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, minWidth: 0, gap: 3 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5] },
  title: { flexShrink: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], minWidth: 0 },
  chip: {
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
  },
  hiddenChip: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  excerpt: { flexShrink: 1 },
  moreBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing[2],
  },
});

export const ArticleRow = React.memo(ArticleRowInner);
export default ArticleRow;
