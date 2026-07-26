import React, { useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { checksApi } from '../api/services';
import Modal from './Modal';
import { useColors } from '../contexts/ThemeContext';
import { colors, fontSize, fontWeight, borderRadius, spacing, softTint } from '../theme';
import { haptic } from '../platform/haptics';
import type { CheckTag } from '../../../shared/types';

/**
 * CheckTagSheet — пикер меток чека (Round 12 #9).
 *
 * Открывается ТОЛЬКО по тапу на ghost-строку «Метка» в Кассе: обычный чек
 * не встречает этот слой вовсе. Внутри — чипы живых меток тенанта
 * (мультивыбор), инлайн-создание новой (создалась → сразу выбрана) и, для
 * держателя settings_manage (owner-class), долгий тап по чипу →
 * переименовать / архивировать. Архив не трогает старые чеки — метка лишь
 * исчезает из этого пикера.
 *
 * Выбор живёт у родителя (selected/onChange) как CheckTag[] — Касса рендерит
 * выбранные чипы в своей строке и кладёт tagIds в payload; сам справочник
 * грузится только когда шторка видима.
 */

/** Авто-палитра новой метки: стабильные 600-акценты, циклом по количеству. */
const TAG_COLOR_POOL: string[] = [
  colors.blue[600],
  colors.green[600],
  colors.amber[600],
  colors.purple[600],
  colors.teal[600],
  colors.rose[600],
  colors.indigo[600],
  colors.orange[600],
];

/** Нейтральный акцент чипа без цвета (архивные/старые метки). */
const FALLBACK_ACCENT = colors.slate[500];

interface CheckTagSheetProps {
  visible: boolean;
  onClose: () => void;
  selected: CheckTag[];
  onChange: (tags: CheckTag[]) => void;
  /** settings_manage / owner-class: длинный тап — переименовать/архивировать. */
  canManage: boolean;
}

export default function CheckTagSheet({ visible, onClose, selected, onChange, canManage }: CheckTagSheetProps) {
  const palette = useColors();
  const queryClient = useQueryClient();
  const [draftName, setDraftName] = useState('');
  // Метка в режиме переименования (canManage): имя редактируется в том же
  // поле ввода, кнопка становится «Сохранить». Кросс-платформенно (Alert.prompt
  // iOS-only — не используем).
  const [editingTag, setEditingTag] = useState<CheckTag | null>(null);
  const [saving, setSaving] = useState(false);

  const { data: tags, isLoading } = useQuery<CheckTag[]>({
    queryKey: ['check-tags'],
    queryFn: async () => (await checksApi.tags.list()).data,
    enabled: visible,
    staleTime: 60_000,
    placeholderData: (prev) => prev,
  });

  const selectedIds = useMemo(() => new Set(selected.map((t) => t.id)), [selected]);

  const toggle = (tag: CheckTag) => {
    haptic('select');
    if (selectedIds.has(tag.id)) {
      onChange(selected.filter((t) => t.id !== tag.id));
    } else {
      onChange([...selected, tag]);
    }
  };

  const resetDraft = () => {
    setDraftName('');
    setEditingTag(null);
  };

  /** Создать новую метку (или сохранить переименование в edit-режиме). */
  const submitDraft = async () => {
    const name = draftName.trim();
    if (name.length === 0 || saving) return;
    if (name.length > 30) {
      Alert.alert('Слишком длинно', 'Название метки — максимум 30 символов.');
      return;
    }
    setSaving(true);
    try {
      if (editingTag) {
        const res = await checksApi.tags.update(editingTag.id, { name });
        const updated: CheckTag = { id: res.data.id, name: res.data.name, color: res.data.color };
        // Если переименованная метка выбрана — обновляем её имя в выборе.
        onChange(selected.map((t) => (t.id === updated.id ? updated : t)));
        haptic('success');
      } else {
        const color = TAG_COLOR_POOL[(tags?.length ?? 0) % TAG_COLOR_POOL.length];
        const res = await checksApi.tags.create({ name, color });
        const created: CheckTag = { id: res.data.id, name: res.data.name, color: res.data.color };
        if (!selectedIds.has(created.id)) onChange([...selected, created]);
        haptic('success');
      }
      resetDraft();
      queryClient.invalidateQueries({ queryKey: ['check-tags'] });
    } catch (err: unknown) {
      // 409 = такая метка уже есть: сервер вернул её в body.tag — просто
      // выбираем существующую вместо ошибки (ноль трения для мастера).
      const resp = (err as { response?: { status?: number; data?: { tag?: CheckTag; message?: string } } })?.response;
      if (resp?.status === 409 && resp.data?.tag && !editingTag) {
        const existing = resp.data.tag;
        if (!selectedIds.has(existing.id)) onChange([...selected, existing]);
        haptic('select');
        resetDraft();
      } else {
        Alert.alert('Ошибка', resp?.data?.message || 'Не удалось сохранить метку');
      }
    } finally {
      setSaving(false);
    }
  };

  /** Длинный тап по чипу (canManage): переименовать / архивировать. */
  const onLongPressTag = (tag: CheckTag) => {
    if (!canManage) return;
    haptic('tap');
    Alert.alert(tag.name, undefined, [
      {
        text: 'Переименовать',
        onPress: () => {
          setEditingTag(tag);
          setDraftName(tag.name);
        },
      },
      {
        text: 'Архивировать',
        style: 'destructive',
        onPress: () => {
          Alert.alert('Архивировать метку?', 'Старые чеки сохранят её, но в Кассе она больше не будет предлагаться.', [
            { text: 'Отмена', style: 'cancel' },
            {
              text: 'Архивировать',
              style: 'destructive',
              onPress: async () => {
                try {
                  await checksApi.tags.update(tag.id, { archived: true });
                  // Архивную метку сервер молча отбросит при сохранении чека —
                  // убираем её из текущего выбора, чтобы не терять молча.
                  onChange(selected.filter((t) => t.id !== tag.id));
                  queryClient.invalidateQueries({ queryKey: ['check-tags'] });
                  haptic('success');
                } catch {
                  Alert.alert('Ошибка', 'Не удалось архивировать метку');
                }
              },
            },
          ]);
        },
      },
      { text: 'Отмена', style: 'cancel' },
    ]);
  };

  const isDark = palette.mode === 'dark';
  const list = tags ?? [];

  return (
    <Modal
      visible={visible}
      onClose={() => {
        resetDraft();
        onClose();
      }}
      title="Метки"
    >
      {isLoading && list.length === 0 ? (
        <ActivityIndicator style={{ marginVertical: spacing[6] }} color={colors.primary[600]} />
      ) : (
        <>
          {list.length === 0 && (
            <Text style={[styles.emptyText, { color: palette.text.tertiary }]}>
              Меток пока нет. Создайте первую — и в отчётах появится прибыль по ней.
            </Text>
          )}
          <View style={styles.chipWrap}>
            {list.map((tag) => {
              const accent = tag.color || FALLBACK_ACCENT;
              const active = selectedIds.has(tag.id);
              return (
                <TouchableOpacity
                  key={tag.id}
                  onPress={() => toggle(tag)}
                  onLongPress={() => onLongPressTag(tag)}
                  delayLongPress={350}
                  activeOpacity={0.7}
                  style={[
                    styles.chip,
                    active
                      ? { backgroundColor: softTint(accent, palette.mode), borderColor: accent }
                      : { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`Метка ${tag.name}`}
                >
                  <View style={[styles.chipDot, { backgroundColor: accent, opacity: active ? 1 : 0.55 }]} />
                  <Text
                    style={[
                      styles.chipText,
                      { color: active ? (isDark ? palette.text.primary : accent) : palette.text.secondary },
                      active && { fontWeight: fontWeight.semibold },
                    ]}
                    numberOfLines={1}
                  >
                    {tag.name}
                  </Text>
                  {active && <Ionicons name="checkmark" size={13} color={isDark ? palette.text.primary : accent} />}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Инлайн-создание / переименование */}
          {editingTag && (
            <View style={styles.editHintRow}>
              <Ionicons name="pencil-outline" size={12} color={palette.text.tertiary} />
              <Text style={[styles.editHintText, { color: palette.text.tertiary }]} numberOfLines={1}>
                Переименование «{editingTag.name}»
              </Text>
              <TouchableOpacity onPress={resetDraft} hitSlop={8}>
                <Text style={[styles.editHintCancel, { color: colors.primary[600] }]}>Отмена</Text>
              </TouchableOpacity>
            </View>
          )}
          <View style={[styles.newRow, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
            <Ionicons name={editingTag ? 'pencil-outline' : 'add'} size={16} color={palette.text.tertiary} />
            <TextInput
              value={draftName}
              onChangeText={setDraftName}
              placeholder={editingTag ? 'Новое название' : 'Новая метка'}
              placeholderTextColor={palette.text.tertiary}
              style={[styles.newInput, { color: palette.text.primary }]}
              maxLength={30}
              returnKeyType="done"
              onSubmitEditing={submitDraft}
            />
            {draftName.trim().length > 0 && (
              <TouchableOpacity
                onPress={submitDraft}
                disabled={saving}
                style={[styles.newBtn, { backgroundColor: colors.primary[600], opacity: saving ? 0.5 : 1 }]}
                accessibilityRole="button"
                accessibilityLabel={editingTag ? 'Сохранить название' : 'Создать метку'}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <Text style={styles.newBtnText}>{editingTag ? 'Сохранить' : 'Создать'}</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
          {canManage && list.length > 0 && (
            <Text style={[styles.manageHint, { color: palette.text.tertiary }]}>
              Долгое нажатие на метку — переименовать или архивировать
            </Text>
          )}

          {/* Готово — закрыть шторку (выбор применяется мгновенно) */}
          <TouchableOpacity
            onPress={() => {
              resetDraft();
              onClose();
            }}
            style={[styles.doneBtn, { backgroundColor: colors.primary[600] }]}
            accessibilityRole="button"
            accessibilityLabel="Готово"
          >
            <Text style={styles.doneBtnText}>Готово</Text>
          </TouchableOpacity>
        </>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  emptyText: {
    fontSize: fontSize.sm,
    lineHeight: 19,
    marginBottom: spacing[3],
  },
  chipWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
    borderWidth: 1,
    maxWidth: '100%',
  },
  chipDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  chipText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    flexShrink: 1,
  },
  editHintRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    marginTop: spacing[4],
    marginBottom: -spacing[1],
  },
  editHintText: {
    fontSize: fontSize.xs,
    flex: 1,
  },
  editHintCancel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
  newRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    borderWidth: 1,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
    marginTop: spacing[4],
  },
  newInput: {
    flex: 1,
    fontSize: fontSize.sm,
    paddingVertical: spacing[1.5],
  },
  newBtn: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
    borderRadius: borderRadius.lg,
    minWidth: 72,
    alignItems: 'center',
  },
  newBtnText: {
    color: colors.white,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
  },
  manageHint: {
    fontSize: fontSize.xs,
    marginTop: spacing[2],
  },
  doneBtn: {
    marginTop: spacing[5],
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[3],
    alignItems: 'center',
  },
  doneBtnText: {
    color: colors.white,
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
  },
});
