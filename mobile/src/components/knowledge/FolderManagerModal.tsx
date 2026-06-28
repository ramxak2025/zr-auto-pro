/**
 * FolderManagerModal — create a Knowledge Base folder / subfolder from the phone.
 *
 * A lightweight bottom-sheet: name + an optional parent folder, so a manager can
 * build the nested tree (root → subfolder → …) the same way the web folder
 * manager does. Uses the existing `knowledgeApi.createCategory({ name, parentId })`
 * endpoint (079 contract) — no native code, ships via OTA. Android-safe.
 *
 * The server rejects cycles, but since we only CREATE here every existing
 * category is a valid parent — no descendant filtering needed.
 */
import React from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../platform/Typography';
import { spacing, borderRadius, colors } from '../../theme';
import { useColors } from '../../contexts/ThemeContext';
import { knowledgeApi } from '../../api/services';
import { haptic } from '../../platform/haptics';
import { rootCategories, childCategories } from '../../utils/knowledgeTree';
import type { KnowledgeCategory } from '../../../../shared/types';

interface FolderManagerModalProps {
  visible: boolean;
  /** Pre-selected parent (the folder the manager is currently inside). */
  presetParentId?: string | null;
  categories: KnowledgeCategory[];
  onClose: () => void;
  /** Called with the freshly-created category after the cache is invalidated. */
  onCreated?: (category: KnowledgeCategory) => void;
}

/** Flatten the tree depth-first so subfolders are pickable with indentation. */
function flattenWithDepth(categories: KnowledgeCategory[]): { cat: KnowledgeCategory; depth: number }[] {
  const out: { cat: KnowledgeCategory; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    if (depth > 64) return;
    const children = parentId === null ? rootCategories(categories) : childCategories(categories, parentId);
    for (const cat of children) {
      out.push({ cat, depth });
      walk(cat.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export default function FolderManagerModal({
  visible,
  presetParentId,
  categories,
  onClose,
  onCreated,
}: FolderManagerModalProps) {
  const palette = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [name, setName] = React.useState('');
  const [parentId, setParentId] = React.useState<string | null>(presetParentId ?? null);

  // Reset the form each time the sheet opens (preset parent = current folder).
  React.useEffect(() => {
    if (visible) {
      setName('');
      setParentId(presetParentId ?? null);
    }
  }, [visible, presetParentId]);

  const flat = React.useMemo(() => flattenWithDepth(categories), [categories]);

  const createMutation = useMutation({
    mutationFn: async () =>
      (await knowledgeApi.createCategory({ name: name.trim(), parentId: parentId ?? undefined })).data,
    onSuccess: (cat) => {
      haptic('success');
      queryClient.invalidateQueries({ queryKey: ['knowledge-categories'] });
      onCreated?.(cat);
      onClose();
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось создать папку. Попробуйте ещё раз.');
    },
  });

  const onCreate = () => {
    if (!name.trim()) {
      Alert.alert('Название обязательно', 'Введите название папки.');
      return;
    }
    haptic('tap');
    createMutation.mutate();
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

          <Text variant="title3" color={palette.text.primary} style={{ marginBottom: spacing[3] }}>
            Новая папка
          </Text>

          <Text style={[styles.label, { color: palette.text.secondary }]}>Название</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Например: Приёмка автомобиля"
            placeholderTextColor={palette.text.tertiary}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={onCreate}
            style={[
              styles.input,
              { backgroundColor: palette.bg.card, borderColor: palette.border.subtle, color: palette.text.primary },
            ]}
          />

          <Text style={[styles.label, { color: palette.text.secondary, marginTop: spacing[4] }]}>Расположение</Text>
          <ScrollView
            style={styles.parentList}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <ParentRow
              label="Корень — верхний уровень"
              icon="home-outline"
              depth={0}
              active={parentId === null}
              onPress={() => {
                haptic('select');
                setParentId(null);
              }}
              palette={palette}
            />
            {flat.map(({ cat, depth }) => (
              <ParentRow
                key={cat.id}
                label={cat.name}
                icon="folder-outline"
                depth={depth + 1}
                active={parentId === cat.id}
                onPress={() => {
                  haptic('select');
                  setParentId(cat.id);
                }}
                palette={palette}
              />
            ))}
          </ScrollView>

          <Pressable
            onPress={onCreate}
            disabled={createMutation.isPending}
            style={({ pressed }) => [
              styles.createBtn,
              { backgroundColor: palette.accent.primary, opacity: pressed || createMutation.isPending ? 0.85 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Создать папку"
          >
            <Ionicons name="folder-open-outline" size={18} color={colors.white} />
            <Text variant="callout" color={colors.white}>
              {createMutation.isPending ? 'Создаём…' : 'Создать папку'}
            </Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ParentRow({
  label,
  icon,
  depth,
  active,
  onPress,
  palette,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  depth: number;
  active: boolean;
  onPress: () => void;
  palette: ReturnType<typeof useColors>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.parentRow,
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
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
    fontSize: 15,
  },

  parentList: { maxHeight: 220 },
  parentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    paddingRight: spacing[3],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
  },

  createBtn: {
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
