/**
 * CategoryRow — a folder row for the Knowledge Base, Apple Files / Notes feel.
 *
 * Used for top-level folders (search results) and subfolders inside a category.
 * Shows the category's icon tile, name, an optional item-count subtitle and a
 * chevron. Tap → drill into that folder.
 *
 * Memoised — rendered in lists that re-render on search keystrokes.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../platform/Typography';
import { spacing, borderRadius, colors, softTint } from '../../theme';
import { useColors } from '../../contexts/ThemeContext';
import { haptic } from '../../platform/haptics';
import type { KnowledgeCategory } from '../../../../shared/types';

interface CategoryRowProps {
  category: KnowledgeCategory;
  /** Optional subtitle, e.g. «3 папки» or «12 статей». */
  subtitle?: string;
  onPress: (category: KnowledgeCategory) => void;
}

function CategoryRowInner({ category, subtitle, onPress }: CategoryRowProps) {
  const palette = useColors();
  // Folders carry an amber "Files-app" identity so they read as containers,
  // distinct from the accent-blue article rows. Light = pale amber fill;
  // dark = translucent amber glow.
  const folderTileBg = palette.mode === 'dark' ? softTint(colors.amber[600], 'dark') : colors.amber[50];

  return (
    <Pressable
      onPress={() => {
        haptic('tap');
        onPress(category);
      }}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: palette.bg.card, borderColor: palette.border.subtle, opacity: pressed ? 0.7 : 1 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Папка: ${category.name}`}
    >
      <View style={[styles.icon, { backgroundColor: folderTileBg }]}>
        <Ionicons
          name={(category.icon as keyof typeof Ionicons.glyphMap) || 'folder'}
          size={20}
          color={colors.amber[600]}
        />
      </View>
      <View style={styles.body}>
        <Text variant="bodyEmph" numberOfLines={1} style={{ color: palette.text.primary }}>
          {category.name}
        </Text>
        {subtitle ? (
          <Text variant="footnote" numberOfLines={1} style={{ color: palette.text.tertiary }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    minHeight: 60,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1, minWidth: 0, gap: 2 },
});

export const CategoryRow = React.memo(CategoryRowInner);
export default CategoryRow;
