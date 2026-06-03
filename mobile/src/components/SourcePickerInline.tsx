/**
 * SourcePickerInline — the SAME source picker as SourcePickerSheet, but
 * rendered IN-FLOW (a collapsible panel) instead of a second RN `<Modal>`.
 *
 * Why: the create-client form is itself an RN `<Modal>`, and iOS will not
 * reliably present a Modal over an already-open Modal — the nested source
 * sheet silently never appeared (queue #19.3 bug: «источник не выбирается»).
 * Rendering the list inline, inside the SAME modal's scroll body, makes it
 * always show. No nested Modal, no overlay positioning hazards.
 *
 * Pick / Edit logic mirrors SourcePickerSheet exactly: «Без источника»
 * clears (null) and stays non-blocking; owner/director can edit the list.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Text } from '../platform/Typography';
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

interface Props {
  /** When false the panel is collapsed (renders nothing). */
  visible: boolean;
  onClose: () => void;
  selected?: string | null;
  onPick: (source: string | null) => void;
  /** Unused title prop kept for call-site parity with SourcePickerSheet. */
  title?: string;
}

export default function SourcePickerInline({ visible, onClose, selected, onPick }: Props) {
  const palette = useColors();
  const queryClient = useQueryClient();
  const { isRole } = useAuth();
  const canEditList = isRole(UserRole.SUPERADMIN, UserRole.DIRECTOR);

  const [mode, setMode] = useState<'pick' | 'edit'>('pick');
  const [draft, setDraft] = useState<string[]>([]);
  const [newSource, setNewSource] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['client-sources'],
    queryFn: async () => {
      const res = await clientSourcesApi.get();
      return res.data;
    },
    enabled: visible,
    staleTime: 5 * 60_000,
  });

  const sources = useMemo(
    () => (data?.sources && data.sources.length > 0 ? data.sources : DEFAULT_SOURCES),
    [data],
  );

  useEffect(() => {
    if (mode === 'edit') setDraft(sources);
  }, [mode, sources]);

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

  const removeDraft = (i: number) => setDraft((d) => d.filter((_, idx) => idx !== i));
  const renameDraft = (i: number, value: string) =>
    setDraft((d) => d.map((s, idx) => (idx === i ? value : s)));

  if (!visible) return null;

  return (
    <View style={[styles.panel, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
      <View style={[styles.panelHeader, { borderBottomColor: palette.border.subtle }]}>
        <Text variant="footnote" color={palette.text.secondary} style={styles.panelTitle}>
          {mode === 'pick' ? 'Выберите источник' : 'Изменить список'}
        </Text>
        <TouchableOpacity onPress={onClose} hitSlop={8}>
          <Ionicons name="chevron-up" size={18} color={palette.text.tertiary} />
        </TouchableOpacity>
      </View>

      {mode === 'pick' ? (
        isLoading ? (
          <View style={styles.loader}>
            <ActivityIndicator color={palette.accent.primary} />
          </View>
        ) : (
          <View>
            <TouchableOpacity
              style={[
                styles.row,
                selected == null && { backgroundColor: palette.accent.primarySoft },
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
                variant="body"
                color={selected == null ? palette.accent.primaryText : palette.text.primary}
                style={styles.rowLabel}
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
                    active && { backgroundColor: palette.accent.primarySoft },
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
                    variant="body"
                    color={active ? palette.accent.primaryText : palette.text.primary}
                    style={styles.rowLabel}
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
                <Text variant="caption" color={palette.text.secondary} style={styles.editBtnText}>
                  Изменить список
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )
      ) : (
        <View>
          {draft.map((s, i) => (
            <View key={`edit-${i}`} style={[styles.editRow, { borderColor: palette.border.subtle }]}>
              <Ionicons name="pricetag-outline" size={14} color={palette.text.tertiary} />
              <TextInput
                value={s}
                onChangeText={(t) => renameDraft(i, t)}
                style={[
                  styles.editInput,
                  { color: palette.text.primary, backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
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
                { color: palette.text.primary, backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
              ]}
              placeholderTextColor={palette.text.tertiary}
            />
            <TouchableOpacity onPress={addDraft} hitSlop={8} style={styles.addBtn}>
              <Text variant="caption" color={palette.accent.primary} style={styles.addBtnText}>
                Добавить
              </Text>
            </TouchableOpacity>
          </View>

          <View style={[styles.actions, { borderTopColor: palette.border.subtle }]}>
            <TouchableOpacity
              onPress={() => setMode('pick')}
              style={[styles.cancelBtn, { borderColor: palette.border.strong }]}
              disabled={saveMutation.isPending}
            >
              <Text variant="body" color={palette.text.secondary}>
                Отмена
              </Text>
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
                <Text variant="body" color={colors.white}>
                  Сохранить
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    marginTop: spacing[2],
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3],
    paddingBottom: spacing[2],
    overflow: 'hidden',
  },
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[2.5],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  panelTitle: { fontWeight: fontWeight.semibold, letterSpacing: 0.2 },
  loader: { paddingVertical: spacing[6], alignItems: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2.5],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.md,
  },
  rowLabel: { flex: 1, fontWeight: fontWeight.medium },
  editBtn: {
    marginTop: spacing[2.5],
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  editBtnText: { fontWeight: fontWeight.semibold },
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
  addBtnText: { fontWeight: fontWeight.semibold },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[3],
    paddingTop: spacing[3],
    marginTop: spacing[2],
    borderTopWidth: 1,
  },
  cancelBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },
  saveBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.lg,
  },
});
