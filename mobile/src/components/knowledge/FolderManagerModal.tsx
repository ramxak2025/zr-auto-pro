/**
 * FolderManagerModal — create / edit a Knowledge Base folder from the phone.
 *
 * A lightweight bottom-sheet with two modes (079 + #54):
 *   • CREATE (default): name + an optional parent folder, so a manager can
 *     build the nested tree (root → subfolder → …).
 *   • EDIT (`editCategory` set): rename, MOVE (re-parent), or DELETE the folder.
 *     The folder's own subtree is excluded from the parent picker so it can't
 *     become its own descendant (the server also rejects cycles with a 400).
 *     Deleting a folder orphans its articles/subfolders to the root
 *     (ON DELETE SET NULL) — nothing is lost.
 *
 * Uses the existing `knowledgeApi.{createCategory,updateCategory,deleteCategory}`
 * (079 contract) — no native code, ships via OTA. Android-safe.
 */
import React from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '../../platform/Typography';
import { spacing, borderRadius, colors } from '../../theme';
import { useColors } from '../../contexts/ThemeContext';
import { knowledgeApi } from '../../api/services';
import { haptic } from '../../platform/haptics';
import { KeyboardAwareView } from '../KeyboardAware';
import KeyboardDoneToolbar from '../KeyboardDoneToolbar';
import { flattenWithDepth } from './folderTree';
import type { KnowledgeCategory } from '../../../../shared/types';

interface FolderManagerModalProps {
  visible: boolean;
  /** Pre-selected parent (the folder the manager is currently inside). Create-only. */
  presetParentId?: string | null;
  /** When set, the sheet edits this folder (rename / move / delete) instead of creating. */
  editCategory?: KnowledgeCategory | null;
  categories: KnowledgeCategory[];
  onClose: () => void;
  /** Called with the freshly-created category after the cache is invalidated. */
  onCreated?: (category: KnowledgeCategory) => void;
  /** Called after an edit (rename / move) succeeds. */
  onUpdated?: (category: KnowledgeCategory) => void;
  /** Called after the folder is deleted. */
  onDeleted?: () => void;
}

export default function FolderManagerModal({
  visible,
  presetParentId,
  editCategory,
  categories,
  onClose,
  onCreated,
  onUpdated,
  onDeleted,
}: FolderManagerModalProps) {
  const palette = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const isEdit = !!editCategory;

  const [name, setName] = React.useState('');
  const [parentId, setParentId] = React.useState<string | null>(presetParentId ?? null);

  // Reset the form each time the sheet opens (edit → prefill from the folder;
  // create → preset parent = current folder).
  React.useEffect(() => {
    if (visible) {
      setName(editCategory?.name ?? '');
      setParentId(editCategory ? (editCategory.parentId ?? null) : (presetParentId ?? null));
    }
  }, [visible, presetParentId, editCategory]);

  // In edit mode the folder can't be re-parented under itself or a descendant.
  const flat = React.useMemo(
    () => flattenWithDepth(categories, isEdit ? editCategory?.id : undefined),
    [categories, isEdit, editCategory?.id],
  );

  const invalidate = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['knowledge-categories'] });
    // Deleting / moving a folder can re-home articles → refresh every list.
    queryClient.invalidateQueries({ queryKey: ['knowledge-articles'] });
  }, [queryClient]);

  const createMutation = useMutation({
    mutationFn: async () =>
      (await knowledgeApi.createCategory({ name: name.trim(), parentId: parentId ?? undefined })).data,
    onSuccess: (cat) => {
      haptic('success');
      invalidate();
      onCreated?.(cat);
      onClose();
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось создать папку. Попробуйте ещё раз.');
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () =>
      (await knowledgeApi.updateCategory(editCategory!.id, { name: name.trim(), parentId: parentId ?? null })).data,
    onSuccess: (cat) => {
      haptic('success');
      invalidate();
      onUpdated?.(cat);
      onClose();
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось сохранить папку. Попробуйте ещё раз.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => (await knowledgeApi.deleteCategory(editCategory!.id)).data,
    onSuccess: () => {
      haptic('success');
      invalidate();
      onDeleted?.();
      onClose();
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось удалить папку. Попробуйте ещё раз.');
    },
  });

  const pending = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  const onSubmit = () => {
    if (!name.trim()) {
      Alert.alert('Название обязательно', 'Введите название папки.');
      return;
    }
    haptic('tap');
    if (isEdit) updateMutation.mutate();
    else createMutation.mutate();
  };

  const onDelete = () => {
    if (!editCategory) return;
    Alert.alert(
      'Удалить папку?',
      `«${editCategory.name}» будет удалена. Вложенные папки и статьи переедут в корень — они не пропадут.`,
      [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Удалить', style: 'destructive', onPress: () => deleteMutation.mutate() },
      ],
    );
  };

  return (
    // Клавиатура (Round 11 D). RN <Modal> — отдельное нативное окно, корневой
    // KeyboardProvider из App.tsx туда не дотягивается → вложенный провайдер.
    // Шит прижат к низу и имеет autoFocus-поле «Название» → без подъёма поле
    // и кнопка «Создать» уходили под клавиатуру. KeyboardAwareView поднимает
    // весь шит над клавиатурой (iOS+Android одинаково), а KeyboardDoneToolbar
    // даёт «Готово».
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardProvider>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <KeyboardAwareView extraOffset={0}>
            <Pressable
              style={[
                styles.sheet,
                { backgroundColor: palette.bg.elevated, paddingBottom: Math.max(insets.bottom, spacing[4]) },
              ]}
              onPress={(e) => e.stopPropagation()}
            >
              <View style={[styles.handle, { backgroundColor: palette.border.strong }]} />

              <Text variant="title3" color={palette.text.primary} style={{ marginBottom: spacing[3] }}>
                {isEdit ? 'Папка' : 'Новая папка'}
              </Text>

              <Text style={[styles.label, { color: palette.text.secondary }]}>Название</Text>
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder="Например: Приёмка автомобиля"
                placeholderTextColor={palette.text.tertiary}
                autoFocus={!isEdit}
                returnKeyType="done"
                onSubmitEditing={onSubmit}
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
                onPress={onSubmit}
                disabled={pending}
                style={({ pressed }) => [
                  styles.createBtn,
                  { backgroundColor: palette.accent.primary, opacity: pressed || pending ? 0.85 : 1 },
                ]}
                accessibilityRole="button"
                accessibilityLabel={isEdit ? 'Сохранить папку' : 'Создать папку'}
              >
                <Ionicons name={isEdit ? 'checkmark' : 'folder-open-outline'} size={18} color={colors.white} />
                <Text variant="callout" color={colors.white}>
                  {pending && !deleteMutation.isPending
                    ? isEdit
                      ? 'Сохраняем…'
                      : 'Создаём…'
                    : isEdit
                      ? 'Сохранить'
                      : 'Создать папку'}
                </Text>
              </Pressable>

              {isEdit ? (
                <Pressable
                  onPress={onDelete}
                  disabled={pending}
                  hitSlop={8}
                  style={styles.deleteBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Удалить папку"
                >
                  <Ionicons name="trash-outline" size={17} color={colors.red[600]} />
                  <Text variant="bodyEmph" style={{ color: colors.red[600] }}>
                    {deleteMutation.isPending ? 'Удаляем…' : 'Удалить папку'}
                  </Text>
                </Pressable>
              ) : null}
            </Pressable>
          </KeyboardAwareView>
        </Pressable>
        <KeyboardDoneToolbar />
      </KeyboardProvider>
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
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3],
    marginTop: spacing[2],
  },
});
