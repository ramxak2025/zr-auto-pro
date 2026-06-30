/**
 * ArticleActionsSheet — the manager context menu for a Knowledge Base article
 * (#54). A premium bottom-sheet (drag-to-dismiss) listing the content-manager
 * actions on a single article:
 *
 *   • Изменить        → open the editor
 *   • Переместить     → move into another folder / root
 *   • Скрыть / Показать → toggle `published` (hidden = invisible to employees,
 *                         manager keeps it with a «Скрыто» badge)
 *   • Удалить         → delete (the caller confirms natively first)
 *
 * Presentational only — every action calls back into the screen, which owns the
 * mutations and the follow-up modals. Reuses the shared <BottomSheet/> so it
 * matches the rest of the app and is Android-safe.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from '../BottomSheet';
import { Text } from '../../platform/Typography';
import { spacing, borderRadius, colors } from '../../theme';
import { useColors } from '../../contexts/ThemeContext';
import { haptic } from '../../platform/haptics';
import type { KnowledgeArticle } from '../../../../shared/types';

interface ArticleActionsSheetProps {
  article: KnowledgeArticle | null;
  onClose: () => void;
  onEdit: () => void;
  onMove: () => void;
  onToggleHide: () => void;
  onDelete: () => void;
}

export default function ArticleActionsSheet({
  article,
  onClose,
  onEdit,
  onMove,
  onToggleHide,
  onDelete,
}: ArticleActionsSheetProps) {
  const palette = useColors();
  const hidden = article?.published === false;

  return (
    <BottomSheet visible={!!article} onClose={onClose} title={article?.title} heightRatio={0.6}>
      <View style={styles.list}>
        <ActionRow
          icon="create-outline"
          label="Изменить"
          onPress={onEdit}
          tint={palette.accent.primary}
          palette={palette}
        />
        <ActionRow
          icon="folder-outline"
          label="Переместить в папку"
          onPress={onMove}
          tint={palette.accent.primary}
          palette={palette}
        />
        <ActionRow
          icon={hidden ? 'eye-outline' : 'eye-off-outline'}
          label={hidden ? 'Показать сотрудникам' : 'Скрыть от сотрудников'}
          hint={hidden ? 'Сейчас скрыта — видна только руководителю' : 'Останется видна только руководителю'}
          onPress={onToggleHide}
          tint={palette.text.primary}
          palette={palette}
        />
        <ActionRow
          icon="trash-outline"
          label="Удалить"
          onPress={onDelete}
          tint={colors.red[600]}
          danger
          palette={palette}
        />
      </View>
    </BottomSheet>
  );
}

function ActionRow({
  icon,
  label,
  hint,
  onPress,
  tint,
  danger,
  palette,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint?: string;
  onPress: () => void;
  tint: string;
  danger?: boolean;
  palette: ReturnType<typeof useColors>;
}) {
  return (
    <Pressable
      onPress={() => {
        haptic('tap');
        onPress();
      }}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: palette.bg.card, borderColor: palette.border.subtle, opacity: pressed ? 0.7 : 1 },
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={[styles.iconWrap, { backgroundColor: danger ? colors.red[50] : palette.bg.muted }]}>
        <Ionicons name={icon} size={19} color={tint} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text variant="bodyEmph" numberOfLines={1} style={{ color: danger ? colors.red[600] : palette.text.primary }}>
          {label}
        </Text>
        {hint ? (
          <Text variant="caption" numberOfLines={1} style={{ color: palette.text.tertiary }}>
            {hint}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing[2], paddingBottom: spacing[2] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
