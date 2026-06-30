/**
 * MoveToFolderModal — «Переместить в папку» for a Knowledge Base article or
 * folder (#54).
 *
 * A lightweight bottom-sheet that walks the category tree (079 `parentId`) and
 * lets a manager drop the item into any folder, or back to the root («Без
 * папки»). Select → «Переместить». The current location is highlighted and the
 * confirm button is disabled while it's selected (no-op guard).
 *
 * When moving a FOLDER, pass `excludeSubtreeId` = that folder's id so it and
 * its descendants are removed from the target list (a folder can't move under
 * itself). Uses the existing `knowledgeApi.updateArticle` / `updateCategory`
 * via the parent's `onConfirm` — no native code, OTA-shippable, Android-safe.
 */
import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../platform/Typography';
import { spacing, borderRadius, colors } from '../../theme';
import { useColors } from '../../contexts/ThemeContext';
import { haptic } from '../../platform/haptics';
import { flattenWithDepth } from './folderTree';
import type { KnowledgeCategory } from '../../../../shared/types';

interface MoveToFolderModalProps {
  visible: boolean;
  /** Sheet title — e.g. «Переместить статью» / «Переместить папку». */
  title?: string;
  /** Label shown above the list, e.g. the item being moved. */
  itemLabel?: string;
  categories: KnowledgeCategory[];
  /** Current parent/category id (null = root) — highlighted + no-op guard. */
  currentId?: string | null;
  /** When moving a FOLDER, exclude it + its descendants from the targets. */
  excludeSubtreeId?: string | null;
  busy?: boolean;
  onClose: () => void;
  /** Confirm with the chosen target (null = root / «Без папки»). */
  onConfirm: (targetId: string | null) => void;
}

export default function MoveToFolderModal({
  visible,
  title = 'Переместить',
  itemLabel,
  categories,
  currentId = null,
  excludeSubtreeId,
  busy,
  onClose,
  onConfirm,
}: MoveToFolderModalProps) {
  const palette = useColors();
  const insets = useSafeAreaInsets();

  const [target, setTarget] = React.useState<string | null>(currentId ?? null);

  // Re-seed the selection to the current location each time the sheet opens.
  React.useEffect(() => {
    if (visible) setTarget(currentId ?? null);
  }, [visible, currentId]);

  const flat = React.useMemo(
    () => flattenWithDepth(categories, excludeSubtreeId ?? undefined),
    [categories, excludeSubtreeId],
  );

  const isNoop = (target ?? null) === (currentId ?? null);

  const confirm = () => {
    if (busy || isNoop) return;
    haptic('select');
    onConfirm(target ?? null);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[
            styles.sheet,
            { backgroundColor: palette.bg.elevated, paddingBottom: Math.max(insets.bottom, spacing[4]) },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={[styles.handle, { backgroundColor: palette.border.strong }]} />

          <Text variant="title3" color={palette.text.primary} style={{ marginBottom: spacing[1] }}>
            {title}
          </Text>
          {itemLabel ? (
            <Text
              variant="footnote"
              numberOfLines={1}
              style={{ color: palette.text.tertiary, marginBottom: spacing[3] }}
            >
              {itemLabel}
            </Text>
          ) : (
            <View style={{ height: spacing[2] }} />
          )}

          <Text style={[styles.label, { color: palette.text.secondary }]}>Куда переместить</Text>
          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <TargetRow
              label="Без папки — корень"
              icon="home-outline"
              depth={0}
              active={(target ?? null) === null}
              isCurrent={(currentId ?? null) === null}
              onPress={() => {
                haptic('select');
                setTarget(null);
              }}
              palette={palette}
            />
            {flat.map(({ cat, depth }) => (
              <TargetRow
                key={cat.id}
                label={cat.name}
                icon="folder-outline"
                depth={depth + 1}
                active={target === cat.id}
                isCurrent={currentId === cat.id}
                onPress={() => {
                  haptic('select');
                  setTarget(cat.id);
                }}
                palette={palette}
              />
            ))}
          </ScrollView>

          <Pressable
            onPress={confirm}
            disabled={busy || isNoop}
            style={({ pressed }) => [
              styles.confirmBtn,
              {
                backgroundColor: isNoop ? palette.bg.muted : palette.accent.primary,
                opacity: pressed || busy ? 0.85 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Переместить"
          >
            <Ionicons name="arrow-redo-outline" size={18} color={isNoop ? palette.text.tertiary : colors.white} />
            <Text variant="callout" color={isNoop ? palette.text.tertiary : colors.white}>
              {busy ? 'Перемещаем…' : isNoop ? 'Уже здесь' : 'Переместить сюда'}
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function TargetRow({
  label,
  icon,
  depth,
  active,
  isCurrent,
  onPress,
  palette,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  depth: number;
  active: boolean;
  isCurrent: boolean;
  onPress: () => void;
  palette: ReturnType<typeof useColors>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.targetRow,
        {
          backgroundColor: active ? palette.accent.primarySoft : 'transparent',
          paddingLeft: spacing[3] + depth * spacing[3.5],
          opacity: pressed ? 0.7 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={18} color={active ? palette.accent.primary : palette.text.tertiary} />
      <Text
        variant="body"
        numberOfLines={1}
        style={{
          flex: 1,
          color: active ? palette.accent.primary : palette.text.primary,
          fontWeight: active ? '600' : '400',
        }}
      >
        {label}
      </Text>
      {isCurrent ? (
        <Text variant="caption" style={{ color: palette.text.tertiary }}>
          текущая
        </Text>
      ) : null}
      {active ? <Ionicons name="checkmark" size={18} color={palette.accent.primary} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
  },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: spacing[3] },

  label: { marginLeft: spacing[1], marginBottom: spacing[2], fontSize: 13, fontWeight: '600' },
  list: { maxHeight: 300 },
  targetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    paddingRight: spacing[3],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
  },

  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[3.5],
    minHeight: 52,
    marginTop: spacing[4],
  },
});
