/**
 * SourcePickerSheet — modal source-tag selector with built-in "edit list" mode.
 *
 * Surfaces the tenant's acquisition-source list (Яндекс / 2GIS / Авито …)
 * stored in `client_sources.sources` and edited via `clientSourcesApi`.
 *
 * Two modes (toggled inside the same sheet):
 *  • PICK — tap a chip to choose; "Нет источника" clears (passes null).
 *  • EDIT — owner/director adds, renames, removes sources; saves once.
 *
 * The caller controls visibility and gets the picked value via `onPick`.
 * Edits are persisted internally so the parent doesn't need to re-fetch.
 *
 * Used from:
 *  • ClientsScreen "Новый клиент" modal — source field;
 *  • ClientDetailScreen — quick-change source on existing client.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Modal from './Modal';
import { clientSourcesApi } from '../api/services';
import { useColors } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { UserRole } from '../../../shared/types';
import { colors, spacing, borderRadius, fontSize, fontWeight } from '../theme';
import { haptic } from '../platform/haptics';

const DEFAULT_SOURCES = [
  'Яндекс',
  '2GIS',
  'Google',
  'Авито',
  'ВКонтакте',
  'Instagram',
  'Мимо проезжал',
  'По рекомендации',
];

interface SourcePickerSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Currently selected source ('' / null = none). */
  selected?: string | null;
  /** Fired when the user picks a value (string) or clears (null). */
  onPick: (source: string | null) => void;
  title?: string;
}

export default function SourcePickerSheet({
  visible,
  onClose,
  selected,
  onPick,
  title = 'Источник клиента',
}: SourcePickerSheetProps) {
  const palette = useColors();
  const queryClient = useQueryClient();
  const { isRole } = useAuth();
  // Source-list editing — owner/director only. Masters et al see the
  // picker but can't reshape the company's source taxonomy.
  const canEditList = isRole(UserRole.SUPERADMIN, UserRole.DIRECTOR);

  const [mode, setMode] = useState<'pick' | 'edit'>('pick');
  // Local mutable copy of the source list while in edit mode. Committed
  // to the server on "Сохранить".
  const [draft, setDraft] = useState<string[]>([]);
  const [newSource, setNewSource] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['client-sources'],
    queryFn: async () => {
      const res = await clientSourcesApi.get();
      return res.data;
    },
    enabled: visible,
    // Reuse cache across opens — sources don't change often.
    staleTime: 5 * 60_000,
  });

  // Server can return [] for a never-configured tenant. Surface the
  // sensible defaults so the picker is usable on day one.
  const sources = useMemo(() => {
    const list = data?.sources && data.sources.length > 0 ? data.sources : DEFAULT_SOURCES;
    return list;
  }, [data]);

  // Reset draft when we enter edit mode, so we always start from the
  // currently-saved list (not a stale draft from a previous edit).
  useEffect(() => {
    if (mode === 'edit') setDraft(sources);
  }, [mode, sources]);

  // Snap back to pick mode every time the sheet is reopened so the
  // user doesn't land mid-edit by surprise.
  useEffect(() => {
    if (!visible) {
      setMode('pick');
      setNewSource('');
    }
  }, [visible]);

  const saveMutation = useMutation({
    mutationFn: (next: string[]) => clientSourcesApi.update(next),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client-sources'] });
      setMode('pick');
    },
    onError: () => Alert.alert('Ошибка', 'Не удалось сохранить список источников'),
  });

  const handlePick = (value: string | null) => {
    haptic('select');
    onPick(value);
    onClose();
  };

  const addDraft = () => {
    const trimmed = newSource.trim();
    if (!trimmed) return;
    if (draft.map((s) => s.toLowerCase()).includes(trimmed.toLowerCase())) {
      Alert.alert('Уже есть', `«${trimmed}» уже в списке`);
      return;
    }
    setDraft((d) => [...d, trimmed]);
    setNewSource('');
  };

  const removeDraft = (i: number) => {
    setDraft((d) => d.filter((_, idx) => idx !== i));
  };

  const renameDraft = (i: number, value: string) => {
    setDraft((d) => d.map((s, idx) => (idx === i ? value : s)));
  };

  return (
    <Modal visible={visible} onClose={onClose} title={mode === 'pick' ? title : 'Изменить список источников'}>
      {mode === 'pick' ? (
        <View>
          {isLoading ? (
            <View style={styles.loader}>
              <ActivityIndicator color={palette.accent.primary} />
            </View>
          ) : (
            <>
              <TouchableOpacity
                style={[
                  styles.row,
                  selected == null && [styles.rowActive, { backgroundColor: palette.accent.primarySoft }],
                  { borderColor: palette.border.subtle },
                ]}
                onPress={() => handlePick(null)}
                activeOpacity={0.7}
              >
                <Ionicons
                  name="remove-circle-outline"
                  size={18}
                  color={selected == null ? palette.accent.primary : palette.text.tertiary}
                />
                <Text
                  style={[
                    styles.rowLabel,
                    { color: selected == null ? palette.accent.primaryText : palette.text.primary },
                  ]}
                >
                  Без источника
                </Text>
                {selected == null && <Ionicons name="checkmark" size={18} color={palette.accent.primary} />}
              </TouchableOpacity>
              {sources.map((s) => {
                const active = (selected ?? '').toLowerCase() === s.toLowerCase();
                return (
                  <TouchableOpacity
                    key={s}
                    style={[
                      styles.row,
                      active && [styles.rowActive, { backgroundColor: palette.accent.primarySoft }],
                      { borderColor: palette.border.subtle },
                    ]}
                    onPress={() => handlePick(s)}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name="pricetag-outline"
                      size={16}
                      color={active ? palette.accent.primary : palette.text.tertiary}
                    />
                    <Text
                      style={[
                        styles.rowLabel,
                        { color: active ? palette.accent.primaryText : palette.text.primary },
                      ]}
                    >
                      {s}
                    </Text>
                    {active && <Ionicons name="checkmark" size={18} color={palette.accent.primary} />}
                  </TouchableOpacity>
                );
              })}

              {canEditList && (
                <TouchableOpacity
                  style={[styles.editBtn, { borderColor: palette.border.subtle }]}
                  onPress={() => setMode('edit')}
                  activeOpacity={0.8}
                >
                  <Ionicons name="create-outline" size={15} color={palette.text.secondary} />
                  <Text style={[styles.editBtnText, { color: palette.text.secondary }]}>Изменить список</Text>
                </TouchableOpacity>
              )}
              <Text style={[styles.note, { color: palette.text.tertiary }]}>
                Этот список используется при создании нового клиента
              </Text>
            </>
          )}
        </View>
      ) : (
        // EDIT MODE
        <View>
          {draft.map((s, i) => (
            <View key={`edit-${i}`} style={[styles.editRow, { borderColor: palette.border.subtle }]}>
              <Ionicons name="pricetag-outline" size={14} color={palette.text.tertiary} />
              <TextInput
                value={s}
                onChangeText={(t) => renameDraft(i, t)}
                style={[
                  styles.editInput,
                  { color: palette.text.primary, backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
                ]}
                placeholderTextColor={palette.text.tertiary}
              />
              <TouchableOpacity onPress={() => removeDraft(i)} hitSlop={8} style={styles.removeBtn}>
                <Ionicons name="trash-outline" size={16} color={colors.red[500]} />
              </TouchableOpacity>
            </View>
          ))}
          <View style={[styles.editRow, { borderColor: palette.border.subtle }]}>
            <Ionicons name="add-circle-outline" size={16} color={palette.accent.primary} />
            <TextInput
              value={newSource}
              onChangeText={setNewSource}
              placeholder="Новый источник"
              onSubmitEditing={addDraft}
              style={[
                styles.editInput,
                { color: palette.text.primary, backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
              ]}
              placeholderTextColor={palette.text.tertiary}
            />
            <TouchableOpacity onPress={addDraft} hitSlop={8} style={styles.addBtn}>
              <Text style={[styles.addBtnText, { color: palette.accent.primary }]}>Добавить</Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.actions, { borderTopColor: palette.border.subtle }]}>
            <TouchableOpacity
              onPress={() => setMode('pick')}
              style={[styles.cancelBtn, { borderColor: palette.border.strong }]}
              disabled={saveMutation.isPending}
            >
              <Text style={[styles.cancelText, { color: palette.text.secondary }]}>Отмена</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                const cleaned = draft.map((s) => s.trim()).filter(Boolean);
                saveMutation.mutate(cleaned);
              }}
              style={[styles.saveBtn, { backgroundColor: palette.accent.primary }]}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Text style={styles.saveText}>Сохранить</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  loader: { paddingVertical: spacing[8], alignItems: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.md,
  },
  rowActive: {
    backgroundColor: colors.primary[50],
  },
  rowLabel: { flex: 1, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  editBtn: {
    marginTop: spacing[3],
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  editBtnText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  note: {
    marginTop: spacing[3],
    fontSize: 11,
    lineHeight: 14,
  },

  // Edit mode rows
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  editInput: {
    flex: 1,
    height: 36,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing[2.5],
    borderWidth: 1,
    fontSize: fontSize.sm,
  },
  removeBtn: { padding: 4 },
  addBtn: { paddingHorizontal: 6 },
  addBtnText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[3],
    paddingTop: spacing[4],
    marginTop: spacing[3],
    borderTopWidth: 1,
  },
  cancelBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },
  cancelText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  saveBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
  },
  saveText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.white },
});
