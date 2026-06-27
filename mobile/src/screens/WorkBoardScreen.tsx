/**
 * WorkBoardScreen — «Доска заказ-нарядов» (kanban board 082 + 091).
 *
 * Колонки ДИНАМИЧЕСКИЕ (owner-configurable, миграция 091): рендерятся из
 * `checksApi.board().columns` (активные, по sortOrder), каждая колонка
 * наполняется из `board().groups[column.key]` (newest-first, ≤100 на бэке,
 * учитывает право checks_view_all). Тап по карточке → action sheet
 * (cross-platform Modal) со списком активных колонок → `setWorkStatus(id,
 * column.key)` с оптимистичным апдейтом кеша ['checks','board'] + инвалидация.
 * Haptic на успех. Pull-to-refresh на любой колонке обновляет всю доску.
 *
 * Шестерёнка в шапке (owner-class: director/admin/superadmin) открывает
 * «Настройку колонок» (WorkBoardSettings) внутри того же стека.
 *
 * work-status ОРТОГОНАЛЕН оплате/отложенности — это отдельный board-флаг,
 * он не смешивается с бейджами «оплачено / отложен».
 *
 * Перемещение гейтится правом `checks_edit` (director/admin/master/
 * superadmin). Без права доска только для чтения: карточку можно открыть, но
 * не переместить.
 *
 * Android-совместимо: только кросс-платформенные RN-примитивы (ScrollView,
 * RefreshControl, общий Modal) — никаких iOS-only API.
 */
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { checksApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { usePosSettings } from '../hooks/usePosSettings';
import { useColors } from '../contexts/ThemeContext';
import type { SemanticPalette } from '../theme/palette';
import IosScreenHeader from '../components/IosScreenHeader';
import LoadingSpinner from '../components/LoadingSpinner';
import QueryErrorState from '../components/QueryErrorState';
import Modal from '../components/Modal';
import FreshnessBadge from '../components/FreshnessBadge';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { haptic } from '../platform/haptics';
import { buildShadow } from '../platform/iosSurface';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { columnVisual } from '../constants/workStatus';
import type { Check, ChecksBoard } from '../../../shared/types';

const BOARD_KEY = ['checks', 'board'] as const;

function formatMoney(v: number) {
  return (
    Math.round(v ?? 0)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
  );
}

// ── BoardCard ───────────────────────────────────────────────────────────
// Memoised card. Module-scope so React.memo recycles it without prop
// identity churn between board refetches. Shows client / car / plate +
// total + number — payment/deferred badges intentionally absent (work-status
// is orthogonal to payment).
interface BoardCardProps {
  check: Check;
  palette: SemanticPalette;
  onPress: (check: Check) => void;
}
const BoardCard = React.memo(function BoardCard({ check, palette, onPress }: BoardCardProps) {
  return (
    <TouchableOpacity
      style={[
        styles.card,
        buildShadow(palette),
        { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
      ]}
      activeOpacity={0.7}
      onPress={() => onPress(check)}
      accessibilityRole="button"
      accessibilityLabel={`Заказ-наряд №${check.number}`}
    >
      <View style={styles.cardHeader}>
        <Text style={[styles.cardNumber, { color: palette.text.primary }]}>#{check.number}</Text>
        <Text style={[styles.cardTotal, { color: palette.text.primary }]}>{formatMoney(check.totalRevenue)}</Text>
      </View>
      <View style={styles.cardRow}>
        <Ionicons name="person-outline" size={12} color={palette.text.tertiary} />
        <Text style={[styles.cardRowText, { color: palette.text.secondary }]} numberOfLines={1}>
          {check.client?.fullName ?? 'Розничный покупатель'}
        </Text>
      </View>
      {check.car ? (
        <View style={styles.cardRow}>
          <Ionicons name="car-outline" size={12} color={palette.text.tertiary} />
          <Text style={[styles.cardRowText, { color: palette.text.secondary }]} numberOfLines={1}>
            {check.car.makeModel}
          </Text>
          {check.car.plateNumber ? (
            <View style={styles.plateTag}>
              <Text style={styles.plateTagText}>{check.car.plateNumber}</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </TouchableOpacity>
  );
});

export default function WorkBoardScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const { width } = useWindowDimensions();
  const { user, hasPermission } = useAuth();
  // Перемещение разрешено тем, кто редактирует чеки (director/admin/master/
  // superadmin — director/superadmin всегда true, остальным по матрице прав).
  const canMove = hasPermission('checks_edit');
  // Настраивать колонки может только owner-class (director/admin/superadmin) —
  // бэкенд гейтит create/update/remove, UI прячет шестерёнку для остальных.
  const canConfigure = user?.role === 'director' || user?.role === 'admin' || user?.role === 'superadmin';
  // Cash-shift-mode (092): мастеру без права оплаты центральная кнопка таб-бара
  // открывает эту доску, поэтому здесь же даём ему «+» для создания нового
  // заказ-наряда (order-режим CheckCreate). orderMode=false → кнопки нет, доска
  // байт-в-байт как сейчас для кассиров/владельцев.
  const { orderMode } = usePosSettings();

  // Колонка занимает ~84% ширины, чтобы соседняя «выглядывала» справа —
  // явный сигнал, что доску можно листать вбок. Кап 360pt на планшетах.
  const COLUMN_WIDTH = Math.min(Math.round(width * 0.84), 360);

  const [refreshing, setRefreshing] = useState(false);
  // Карточка, по которой открыт action sheet выбора статуса.
  const [picker, setPicker] = useState<Check | null>(null);

  const {
    data: board,
    isLoading,
    isError,
    isFetching,
    dataUpdatedAt,
    refetch,
  } = useQuery<ChecksBoard>({
    queryKey: BOARD_KEY,
    queryFn: async () => (await checksApi.board()).data,
    staleTime: 30_000,
    // SWR: возврат на доску показывает прошлый снимок мгновенно, фон тянет свежий.
    placeholderData: (prev) => prev,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: BOARD_KEY });
    setRefreshing(false);
  }, [queryClient]);

  // ── Перемещение по доске (оптимистично) ──────────────────────────────
  // Снимаем карточку из текущей группы, добавляем в целевую В НАЧАЛО
  // (newest-first), обновляем workStatus. Откат — восстановление снимка.
  const moveMutation = useMutation({
    mutationFn: ({ id, target }: { id: string; target: string }) => checksApi.setWorkStatus(id, target),
    onMutate: async ({ id, target }) => {
      await queryClient.cancelQueries({ queryKey: BOARD_KEY });
      const prev = queryClient.getQueryData<ChecksBoard>(BOARD_KEY);
      if (prev) {
        const groups: Record<string, Check[]> = {};
        for (const k of Object.keys(prev.groups)) groups[k] = [...prev.groups[k]];
        let moved: Check | undefined;
        for (const k of Object.keys(groups)) {
          const idx = groups[k].findIndex((c) => c.id === id);
          if (idx >= 0) {
            moved = groups[k][idx];
            groups[k].splice(idx, 1);
            break;
          }
        }
        if (moved) {
          groups[target] = [{ ...moved, workStatus: target }, ...(groups[target] ?? [])];
          queryClient.setQueryData<ChecksBoard>(BOARD_KEY, { columns: prev.columns, groups });
        }
      }
      return { prev };
    },
    onError: (err: any, _vars, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(BOARD_KEY, ctx.prev);
      haptic('error');
      Alert.alert('Ошибка', err?.response?.data?.message || 'Не удалось переместить заказ-наряд');
    },
    onSuccess: () => {
      haptic('success');
    },
    onSettled: () => {
      // Сервер — источник истины. Доска + журнал + деталь конкретного чека.
      queryClient.invalidateQueries({ queryKey: BOARD_KEY });
      queryClient.invalidateQueries({ queryKey: ['checks-infinite'] });
    },
  });

  const handlePickStatus = useCallback(
    (target: string) => {
      const current = picker;
      setPicker(null);
      if (!current || current.workStatus === target) return;
      moveMutation.mutate({ id: current.id, target });
    },
    [picker, moveMutation],
  );

  const handleOpenCheck = useCallback(() => {
    const current = picker;
    setPicker(null);
    if (current) navigation.navigate('CheckDetail', { id: current.id });
  }, [picker, navigation]);

  const columns = board?.columns ?? [];
  const totalActive = board ? columns.reduce((sum, col) => sum + (board.groups[col.key]?.length ?? 0), 0) : 0;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.bg.canvas }]} edges={['top']}>
      <IosScreenHeader
        title="Доска заказ-нарядов"
        subtitle={board ? `${totalActive} активных` : undefined}
        onBack={() => navigation.goBack()}
        trailing={
          <View style={styles.headerTrailing}>
            <FreshnessBadge query={{ isFetching, isLoading, dataUpdatedAt }} />
            {orderMode ? (
              <TouchableOpacity
                style={[styles.addBtn, { backgroundColor: colors.primary[600] }]}
                onPress={() => {
                  haptic('select');
                  // Root-stack 'CheckCreate' (накрывает таб-бар, slide-up). Order-
                  // режим определяется внутри CheckCreate по posSettings — параметры
                  // не нужны. На сохранении заказ паркуется в первую колонку доски.
                  navigation.navigate('CheckCreate');
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Создать заказ-наряд"
              >
                <Ionicons name="add" size={22} color={colors.white} />
              </TouchableOpacity>
            ) : null}
            {canConfigure ? (
              <TouchableOpacity
                style={[styles.gearBtn, { backgroundColor: palette.bg.muted }]}
                onPress={() => {
                  haptic('select');
                  navigation.navigate('WorkBoardSettings');
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Настройка колонок доски"
              >
                <Ionicons name="settings-outline" size={18} color={palette.text.primary} />
              </TouchableOpacity>
            ) : null}
          </View>
        }
      />

      {board === undefined && isLoading ? (
        <View style={styles.centerFill}>
          <LoadingSpinner />
        </View>
      ) : isError && board === undefined ? (
        <View style={styles.centerFill}>
          <QueryErrorState description="Не удалось загрузить доску. Проверьте соединение." onRetry={() => refetch()} />
        </View>
      ) : board && columns.length === 0 ? (
        <View style={styles.centerFill}>
          <View style={styles.emptyBoard}>
            <Ionicons name="albums-outline" size={40} color={palette.text.tertiary} />
            <Text style={[styles.emptyBoardTitle, { color: palette.text.secondary }]}>Нет колонок</Text>
            {canConfigure ? (
              <TouchableOpacity
                style={[styles.emptyBoardCta, { borderColor: palette.border.subtle }]}
                activeOpacity={0.7}
                onPress={() => navigation.navigate('WorkBoardSettings')}
              >
                <Ionicons name="add-circle-outline" size={17} color={colors.primary[600]} />
                <Text style={styles.emptyBoardCtaText}>Настроить колонки</Text>
              </TouchableOpacity>
            ) : (
              <Text style={[styles.emptyBoardHint, { color: palette.text.tertiary }]}>
                Колонки доски ещё не настроены
              </Text>
            )}
          </View>
        </View>
      ) : board ? (
        <ScrollView
          horizontal
          style={styles.boardScroll}
          contentContainerStyle={styles.boardContent}
          showsHorizontalScrollIndicator={false}
          snapToInterval={COLUMN_WIDTH + spacing[3]}
          decelerationRate="fast"
          snapToAlignment="start"
        >
          {columns.map((column) => {
            const vis = columnVisual(column);
            const items = board.groups[column.key] ?? [];
            return (
              <View key={column.id} style={[styles.column, { width: COLUMN_WIDTH }]}>
                <View style={[styles.columnHeader, { backgroundColor: vis.bg }]}>
                  <View style={[styles.columnDot, { backgroundColor: vis.color }]} />
                  <Text style={[styles.columnTitle, { color: vis.color }]} numberOfLines={1}>
                    {vis.label}
                  </Text>
                  <View style={[styles.columnCount, { backgroundColor: vis.color }]}>
                    <Text style={styles.columnCountText}>{items.length}</Text>
                  </View>
                </View>
                <ScrollView
                  style={styles.columnScroll}
                  contentContainerStyle={[styles.columnScrollContent, { paddingBottom: tabBarHeight + spacing[4] }]}
                  showsVerticalScrollIndicator={false}
                  refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
                  }
                >
                  {items.length === 0 ? (
                    <View style={styles.columnEmpty}>
                      <Ionicons name="file-tray-outline" size={26} color={palette.text.tertiary} />
                      <Text style={[styles.columnEmptyText, { color: palette.text.tertiary }]}>Нет заказ-нарядов</Text>
                    </View>
                  ) : (
                    items.map((c) => <BoardCard key={c.id} check={c} palette={palette} onPress={setPicker} />)
                  )}
                </ScrollView>
              </View>
            );
          })}
        </ScrollView>
      ) : null}

      {/* Action sheet выбора целевого статуса. Cross-platform Modal —
          одинаково на iOS / Android. Текущий статус помечен и не нажимается;
          без права checks_edit статусы только для чтения. Список — активные
          колонки доски (board.columns). */}
      <Modal visible={!!picker} onClose={() => setPicker(null)} title={picker ? `Заказ-наряд #${picker.number}` : ''}>
        {picker ? (
          <View style={{ gap: spacing[2] }}>
            <Text style={[styles.sheetHint, { color: palette.text.tertiary }]}>
              {canMove ? 'Переместить в колонку' : 'Текущая колонка'}
            </Text>
            {columns.map((column) => {
              const vis = columnVisual(column);
              const isCurrent = picker.workStatus === column.key;
              const disabled = isCurrent || !canMove;
              return (
                <TouchableOpacity
                  key={column.id}
                  style={[
                    styles.sheetRow,
                    { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
                    isCurrent && { borderColor: vis.color, backgroundColor: vis.bg },
                  ]}
                  activeOpacity={disabled ? 1 : 0.7}
                  disabled={disabled}
                  onPress={() => handlePickStatus(column.key)}
                >
                  <View style={[styles.sheetIconWrap, { backgroundColor: vis.bg }]}>
                    <View style={[styles.sheetDot, { backgroundColor: vis.color }]} />
                  </View>
                  <Text style={[styles.sheetRowLabel, { color: palette.text.primary }]} numberOfLines={1}>
                    {vis.label}
                  </Text>
                  {isCurrent ? (
                    <View style={[styles.sheetCurrentTag, { backgroundColor: vis.color }]}>
                      <Text style={styles.sheetCurrentTagText}>Текущий</Text>
                    </View>
                  ) : canMove ? (
                    <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
                  ) : null}
                </TouchableOpacity>
              );
            })}

            <TouchableOpacity
              style={[styles.sheetOpenBtn, { borderColor: palette.border.subtle }]}
              activeOpacity={0.7}
              onPress={handleOpenCheck}
            >
              <Ionicons name="open-outline" size={17} color={colors.primary[600]} />
              <Text style={styles.sheetOpenBtnText}>Открыть заказ-наряд</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  centerFill: { flex: 1, justifyContent: 'center' },

  // ── Header trailing ────────────────────────────────────────────────
  headerTrailing: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  gearBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  addBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },

  // ── Empty board (нет колонок) ──────────────────────────────────────
  emptyBoard: { alignItems: 'center', gap: spacing[3], paddingHorizontal: spacing[6] },
  emptyBoardTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  emptyBoardHint: { fontSize: fontSize.sm, textAlign: 'center' },
  emptyBoardCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
  },
  emptyBoardCtaText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.primary[600] },

  // ── Board ──────────────────────────────────────────────────────────
  boardScroll: { flex: 1 },
  boardContent: {
    paddingHorizontal: spacing[4],
    columnGap: spacing[3],
    paddingTop: spacing[1],
  },
  column: { flex: 1 },
  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.xl,
    marginBottom: spacing[2.5],
  },
  columnDot: { width: 10, height: 10, borderRadius: 5 },
  columnTitle: { flex: 1, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  columnCount: {
    minWidth: 22,
    height: 20,
    paddingHorizontal: spacing[1.5],
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  columnCountText: { color: colors.white, fontSize: 11, fontWeight: fontWeight.bold },
  columnScroll: { flex: 1 },
  columnScrollContent: { gap: spacing[2] },
  columnEmpty: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing[12], gap: spacing[2] },
  columnEmptyText: { fontSize: fontSize.xs, fontWeight: fontWeight.medium },

  // ── Card ───────────────────────────────────────────────────────────
  card: {
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing[3],
    gap: spacing[1.5],
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardNumber: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  cardTotal: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5] },
  cardRowText: { flexShrink: 1, fontSize: fontSize.xs, fontWeight: fontWeight.medium },
  plateTag: {
    backgroundColor: colors.primary[50],
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing[1.5],
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: colors.primary[200],
  },
  plateTagText: { fontSize: 10, fontWeight: fontWeight.bold, color: colors.primary[700], letterSpacing: 0.5 },

  // ── Action sheet ───────────────────────────────────────────────────
  sheetHint: {
    fontSize: 11,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: spacing[1],
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
  },
  sheetIconWrap: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  sheetDot: { width: 14, height: 14, borderRadius: 7 },
  sheetRowLabel: { flex: 1, fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  sheetCurrentTag: { paddingHorizontal: spacing[2], paddingVertical: 3, borderRadius: borderRadius.full },
  sheetCurrentTagText: { color: colors.white, fontSize: 10, fontWeight: fontWeight.bold },
  sheetOpenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    marginTop: spacing[2],
  },
  sheetOpenBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.primary[600] },
});
