/**
 * WorkBoardSettingsScreen — «Настройка колонок» доски заказ-нарядов (091).
 *
 * Owner-class экран (director / admin / superadmin — бэкенд гейтит
 * create/update/remove, UI прячет вход для остальных). Открывается шестерёнкой
 * из шапки `WorkBoardScreen` и живёт внутри ChecksStack, поэтому floating
 * tab bar остаётся виден.
 *
 * Возможности владельца:
 *   • Добавить колонку — подпись + цвет из ~8 пресетов + «Уведомлять клиента».
 *   • Изменить — подпись / цвет / уведомление / видимость (active toggle).
 *   • Переставить — стрелки ↑/↓ → пересчёт sortOrder (оптимистично).
 *   • Удалить — с подтверждением (бэкенд снимает затронутые чеки с доски).
 *
 * `notifyClient` помечает колонку, вход в которую шлёт клиенту «машина готова».
 *
 * Кеш: список колонок — ключ ['checks','board-columns'] (общий с
 * CheckDetailScreen). После любой мутации инвалидируем его + ['checks','board'],
 * а удаление дополнительно — журнал ['checks-infinite'] (затронутые чеки).
 *
 * Android-совместимо: только кросс-платформенные RN-примитивы (ScrollView,
 * Switch, TextInput, общий Modal).
 */
import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Switch,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { checksApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import IosScreenHeader from '../components/IosScreenHeader';
import LoadingSpinner from '../components/LoadingSpinner';
import QueryErrorState from '../components/QueryErrorState';
import Modal from '../components/Modal';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { haptic } from '../platform/haptics';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { WORK_COLUMN_PRESETS, columnVisual } from '../constants/workStatus';
import type { WorkBoardColumn } from '../../../shared/types';

const COLUMNS_KEY = ['checks', 'board-columns'] as const;
const BOARD_KEY = ['checks', 'board'] as const;

type Editing = { mode: 'new' } | { mode: 'edit'; column: WorkBoardColumn } | null;

export default function WorkBoardSettingsScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const { user } = useAuth();
  const canConfigure = user?.role === 'director' || user?.role === 'admin' || user?.role === 'superadmin';

  const {
    data: columns,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: COLUMNS_KEY,
    queryFn: async () => (await checksApi.boardColumns.list()).data,
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  });

  // Колонки в порядке доски (по sortOrder). Стрелки ↑/↓ двигают по этому списку.
  const sorted = useMemo(() => (columns ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder), [columns]);

  // Форма (общая для «новая» / «изменить»).
  const [editing, setEditing] = useState<Editing>(null);
  const [label, setLabel] = useState('');
  const [color, setColor] = useState<string>(WORK_COLUMN_PRESETS[0]);
  const [notifyClient, setNotifyClient] = useState(false);
  const [isActive, setIsActive] = useState(true);

  const openNew = () => {
    setLabel('');
    setColor(WORK_COLUMN_PRESETS[0]);
    setNotifyClient(false);
    setIsActive(true);
    setEditing({ mode: 'new' });
  };
  const openEdit = (column: WorkBoardColumn) => {
    setLabel(column.label);
    setColor(column.color || WORK_COLUMN_PRESETS[0]);
    setNotifyClient(column.notifyClient);
    setIsActive(column.isActive);
    setEditing({ mode: 'edit', column });
  };
  const closeForm = () => setEditing(null);

  const invalidateBoard = () => {
    queryClient.invalidateQueries({ queryKey: COLUMNS_KEY });
    queryClient.invalidateQueries({ queryKey: BOARD_KEY });
  };

  // ── Создание / изменение ─────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async () => {
      const trimmed = label.trim();
      if (editing?.mode === 'edit') {
        return checksApi.boardColumns.update(editing.column.id, {
          label: trimmed,
          color,
          notifyClient,
          isActive,
        });
      }
      return checksApi.boardColumns.create({ label: trimmed, color, notifyClient });
    },
    onSuccess: () => {
      haptic('success');
      closeForm();
      invalidateBoard();
    },
    onError: (err: any) => {
      haptic('error');
      Alert.alert('Ошибка', err?.response?.data?.message || 'Не удалось сохранить колонку');
    },
  });

  // ── Удаление (бэкенд снимает затронутые чеки с доски) ────────────────
  const removeMutation = useMutation({
    mutationFn: (id: string) => checksApi.boardColumns.remove(id),
    onSuccess: () => {
      haptic('success');
      closeForm();
      invalidateBoard();
      queryClient.invalidateQueries({ queryKey: ['checks-infinite'] });
    },
    onError: (err: any) => {
      haptic('error');
      Alert.alert('Ошибка', err?.response?.data?.message || 'Не удалось удалить колонку');
    },
  });

  const confirmDelete = (column: WorkBoardColumn) => {
    Alert.alert(
      'Удалить колонку?',
      `«${column.label}» будет удалена. Заказ-наряды из этой колонки снимутся с доски (статус сбросится).`,
      [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Удалить', style: 'destructive', onPress: () => removeMutation.mutate(column.id) },
      ],
    );
  };

  // ── Перестановка ↑/↓ (оптимистично, пересчёт sortOrder = индекс) ──────
  const reorderMutation = useMutation({
    mutationFn: async (ordered: WorkBoardColumn[]) => {
      const updates = ordered
        .map((col, i) => (col.sortOrder !== i ? checksApi.boardColumns.update(col.id, { sortOrder: i }) : null))
        .filter((p): p is ReturnType<typeof checksApi.boardColumns.update> => p !== null);
      await Promise.all(updates);
    },
    onMutate: async (ordered) => {
      await queryClient.cancelQueries({ queryKey: COLUMNS_KEY });
      const prev = queryClient.getQueryData<WorkBoardColumn[]>(COLUMNS_KEY);
      queryClient.setQueryData<WorkBoardColumn[]>(
        COLUMNS_KEY,
        ordered.map((c, i) => ({ ...c, sortOrder: i })),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(COLUMNS_KEY, ctx.prev);
      haptic('error');
    },
    onSuccess: () => haptic('select'),
    onSettled: invalidateBoard,
  });

  const move = (column: WorkBoardColumn, dir: -1 | 1) => {
    const idx = sorted.findIndex((c) => c.id === column.id);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= sorted.length) return;
    const next = sorted.slice();
    [next[idx], next[target]] = [next[target], next[idx]];
    reorderMutation.mutate(next);
  };

  const canSave = label.trim().length > 0 && !saveMutation.isPending;

  // Защита: вход гейтится шестерёнкой, но на всякий случай — read-only заглушка.
  if (!canConfigure) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: palette.bg.canvas }]} edges={['top']}>
        <IosScreenHeader title="Настройка колонок" onBack={() => navigation.goBack()} />
        <View style={styles.centerFill}>
          <Text style={[styles.guardText, { color: palette.text.secondary }]}>Недостаточно прав</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.bg.canvas }]} edges={['top']}>
      <IosScreenHeader
        title="Настройка колонок"
        subtitle="Доска заказ-нарядов"
        onBack={() => navigation.goBack()}
        trailing={
          <TouchableOpacity
            style={[styles.addBtn, { backgroundColor: colors.primary[600] }]}
            onPress={() => {
              haptic('select');
              openNew();
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Добавить колонку"
          >
            <Ionicons name="add" size={22} color={colors.white} />
          </TouchableOpacity>
        }
      />

      {columns === undefined && isLoading ? (
        <View style={styles.centerFill}>
          <LoadingSpinner />
        </View>
      ) : isError && columns === undefined ? (
        <View style={styles.centerFill}>
          <QueryErrorState description="Не удалось загрузить колонки." onRetry={() => refetch()} />
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + spacing[6] }]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={[styles.sectionHint, { color: palette.text.tertiary }]}>
            Колонки доски в порядке слева направо. Стрелками меняйте порядок, тапом — открывайте настройки.
          </Text>

          {sorted.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="albums-outline" size={36} color={palette.text.tertiary} />
              <Text style={[styles.emptyText, { color: palette.text.secondary }]}>Нет колонок</Text>
              <TouchableOpacity style={[styles.emptyCta, { borderColor: palette.border.subtle }]} onPress={openNew}>
                <Ionicons name="add-circle-outline" size={17} color={colors.primary[600]} />
                <Text style={styles.emptyCtaText}>Добавить колонку</Text>
              </TouchableOpacity>
            </View>
          ) : (
            sorted.map((column, index) => {
              const vis = columnVisual(column);
              const isFirst = index === 0;
              const isLast = index === sorted.length - 1;
              return (
                <View
                  key={column.id}
                  style={[styles.row, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
                >
                  <View style={styles.reorderCol}>
                    <TouchableOpacity
                      style={styles.reorderBtn}
                      disabled={isFirst || reorderMutation.isPending}
                      onPress={() => move(column, -1)}
                      hitSlop={6}
                      accessibilityLabel="Выше"
                    >
                      <Ionicons
                        name="chevron-up"
                        size={18}
                        color={isFirst ? palette.text.tertiary : palette.text.secondary}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.reorderBtn}
                      disabled={isLast || reorderMutation.isPending}
                      onPress={() => move(column, 1)}
                      hitSlop={6}
                      accessibilityLabel="Ниже"
                    >
                      <Ionicons
                        name="chevron-down"
                        size={18}
                        color={isLast ? palette.text.tertiary : palette.text.secondary}
                      />
                    </TouchableOpacity>
                  </View>

                  <TouchableOpacity
                    style={styles.rowMain}
                    activeOpacity={0.6}
                    onPress={() => openEdit(column)}
                    accessibilityRole="button"
                    accessibilityLabel={`Изменить колонку ${column.label}`}
                  >
                    <View style={[styles.rowDot, { backgroundColor: vis.color, opacity: column.isActive ? 1 : 0.4 }]} />
                    <View style={styles.rowTextCol}>
                      <Text
                        style={[
                          styles.rowLabel,
                          { color: column.isActive ? palette.text.primary : palette.text.tertiary },
                        ]}
                        numberOfLines={1}
                      >
                        {column.label}
                      </Text>
                      <View style={styles.rowMetaRow}>
                        {!column.isActive ? (
                          <View style={[styles.metaTag, { backgroundColor: palette.bg.muted }]}>
                            <Ionicons name="eye-off-outline" size={11} color={palette.text.tertiary} />
                            <Text style={[styles.metaTagText, { color: palette.text.tertiary }]}>Скрыта</Text>
                          </View>
                        ) : null}
                        {column.notifyClient ? (
                          <View style={[styles.metaTag, { backgroundColor: colors.green[50] }]}>
                            <Ionicons name="notifications-outline" size={11} color={colors.green[600]} />
                            <Text style={[styles.metaTagText, { color: colors.green[700] }]}>Уведомляет клиента</Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                    <Ionicons name="chevron-forward" size={17} color={palette.text.tertiary} />
                  </TouchableOpacity>
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      {/* Форма «новая / изменить колонку». */}
      <Modal visible={!!editing} onClose={closeForm} title={editing?.mode === 'edit' ? 'Колонка' : 'Новая колонка'}>
        <View style={{ gap: spacing[4] }}>
          <View style={{ gap: spacing[2] }}>
            <Text style={[styles.fieldLabel, { color: palette.text.tertiary }]}>Название</Text>
            <TextInput
              style={[
                styles.input,
                { backgroundColor: palette.bg.muted, color: palette.text.primary, borderColor: palette.border.subtle },
              ]}
              value={label}
              onChangeText={setLabel}
              placeholder="Например, «Диагностика»"
              placeholderTextColor={palette.text.tertiary}
              maxLength={40}
              returnKeyType="done"
            />
          </View>

          <View style={{ gap: spacing[2] }}>
            <Text style={[styles.fieldLabel, { color: palette.text.tertiary }]}>Цвет</Text>
            <View style={styles.swatchRow}>
              {WORK_COLUMN_PRESETS.map((preset) => {
                const selected = preset.toLowerCase() === color.toLowerCase();
                return (
                  <TouchableOpacity
                    key={preset}
                    style={[
                      styles.swatch,
                      { backgroundColor: preset, borderColor: selected ? palette.text.primary : 'transparent' },
                    ]}
                    onPress={() => {
                      haptic('select');
                      setColor(preset);
                    }}
                    accessibilityLabel={`Цвет ${preset}`}
                  >
                    {selected ? <Ionicons name="checkmark" size={16} color={colors.white} /> : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={[styles.toggleRow, { borderColor: palette.border.subtle }]}>
            <View style={styles.toggleTextCol}>
              <Text style={[styles.toggleTitle, { color: palette.text.primary }]}>Уведомлять клиента</Text>
              <Text style={[styles.toggleHint, { color: palette.text.tertiary }]}>
                Вход в эту колонку отправит клиенту «машина готова»
              </Text>
            </View>
            <Switch
              value={notifyClient}
              onValueChange={setNotifyClient}
              trackColor={{ true: colors.green[500], false: palette.border.strong }}
            />
          </View>

          {editing?.mode === 'edit' ? (
            <View style={[styles.toggleRow, { borderColor: palette.border.subtle }]}>
              <View style={styles.toggleTextCol}>
                <Text style={[styles.toggleTitle, { color: palette.text.primary }]}>Показывать на доске</Text>
                <Text style={[styles.toggleHint, { color: palette.text.tertiary }]}>
                  Скрытая колонка не отображается на доске
                </Text>
              </View>
              <Switch
                value={isActive}
                onValueChange={setIsActive}
                trackColor={{ true: colors.primary[500], false: palette.border.strong }}
              />
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.saveBtn, { backgroundColor: canSave ? colors.primary[600] : palette.bg.muted }]}
            disabled={!canSave}
            onPress={() => saveMutation.mutate()}
            activeOpacity={0.85}
          >
            {saveMutation.isPending ? (
              <ActivityIndicator color={colors.white} />
            ) : (
              <Text style={[styles.saveBtnText, { color: canSave ? colors.white : palette.text.tertiary }]}>
                {editing?.mode === 'edit' ? 'Сохранить' : 'Добавить колонку'}
              </Text>
            )}
          </TouchableOpacity>

          {editing?.mode === 'edit' ? (
            <TouchableOpacity
              style={styles.deleteBtn}
              disabled={removeMutation.isPending}
              onPress={() => confirmDelete(editing.column)}
              activeOpacity={0.7}
            >
              <Ionicons name="trash-outline" size={17} color={colors.rose[600]} />
              <Text style={styles.deleteBtnText}>Удалить колонку</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  centerFill: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  guardText: { fontSize: fontSize.base, fontWeight: fontWeight.medium },

  addBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing[4], paddingTop: spacing[2], gap: spacing[2.5] },
  sectionHint: { fontSize: fontSize.xs, lineHeight: 17, marginBottom: spacing[1] },

  empty: { alignItems: 'center', gap: spacing[3], paddingVertical: spacing[12] },
  emptyText: { fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  emptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
  },
  emptyCtaText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.primary[600] },

  // ── Row ────────────────────────────────────────────────────────────
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingRight: spacing[3],
  },
  reorderCol: { paddingLeft: spacing[2], paddingVertical: spacing[2], gap: 0 },
  reorderBtn: { width: 30, height: 26, alignItems: 'center', justifyContent: 'center' },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[3],
    paddingLeft: spacing[2],
  },
  rowDot: { width: 14, height: 14, borderRadius: 7 },
  rowTextCol: { flex: 1, gap: spacing[1] },
  rowLabel: { fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  rowMetaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[1.5] },
  metaTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing[1.5],
    paddingVertical: 2,
    borderRadius: borderRadius.md,
  },
  metaTagText: { fontSize: 10, fontWeight: fontWeight.semibold },

  // ── Form ───────────────────────────────────────────────────────────
  fieldLabel: {
    fontSize: 11,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  input: {
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    fontSize: fontSize.base,
  },
  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2.5] },
  swatch: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2.5,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
  },
  toggleTextCol: { flex: 1, gap: 2 },
  toggleTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  toggleHint: { fontSize: fontSize.xs, lineHeight: 16 },
  saveBtn: {
    height: 50,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: { fontSize: fontSize.base, fontWeight: fontWeight.bold },
  deleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[2],
  },
  deleteBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.rose[600] },
});
