/**
 * WorkBoardScreen — «Доска заказ-нарядов» (kanban board 082).
 *
 * Четыре колонки: Приёмка → В работе → Готов → Выдан. Данные из
 * `checksApi.board()` (ChecksBoard, каждая колонка newest-first, ≤100,
 * учитывает право checks_view_all на бэке). Тап по карточке → action sheet
 * (cross-platform Modal) с выбором целевого статуса → `setWorkStatus` с
 * оптимистичным апдейтом кеша ['checks','board'] + инвалидация. Haptic на
 * успех. Pull-to-refresh на любой колонке обновляет всю доску.
 *
 * work-status ОРТОГОНАЛЕН оплате/отложенности — это отдельный board-флаг,
 * он не смешивается с бейджами «оплачено / отложен».
 *
 * Перемещение гейтится правом `checks_edit` (director/admin/master/
 * superadmin — те же роли, что и редактирование чека). Без права доска
 * только для чтения: карточку можно открыть, но не переместить.
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
import { WORK_STATUS_ORDER, WORK_STATUS_META } from '../constants/workStatus';
import type { Check, ChecksBoard, CheckWorkStatus } from '../../../shared/types';

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
  const { hasPermission } = useAuth();
  // Перемещение разрешено тем, кто редактирует чеки (director/admin/master/
  // superadmin — director/superadmin всегда true, остальным по матрице прав).
  const canMove = hasPermission('checks_edit');

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
  // Снимаем карточку из текущей колонки, добавляем в целевую В НАЧАЛО
  // (newest-first), обновляем workStatus. Откат — восстановление снимка.
  const moveMutation = useMutation({
    mutationFn: ({ id, target }: { id: string; target: CheckWorkStatus }) => checksApi.setWorkStatus(id, target),
    onMutate: async ({ id, target }) => {
      await queryClient.cancelQueries({ queryKey: BOARD_KEY });
      const prev = queryClient.getQueryData<ChecksBoard>(BOARD_KEY);
      if (prev) {
        const next: ChecksBoard = {
          accepted: [...prev.accepted],
          in_progress: [...prev.in_progress],
          ready: [...prev.ready],
          delivered: [...prev.delivered],
        };
        let moved: Check | undefined;
        for (const col of WORK_STATUS_ORDER) {
          const idx = next[col].findIndex((c) => c.id === id);
          if (idx >= 0) {
            moved = next[col][idx];
            next[col].splice(idx, 1);
            break;
          }
        }
        if (moved) {
          next[target] = [{ ...moved, workStatus: target }, ...next[target]];
          queryClient.setQueryData<ChecksBoard>(BOARD_KEY, next);
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
    (target: CheckWorkStatus) => {
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

  const totalActive = board
    ? board.accepted.length + board.in_progress.length + board.ready.length + board.delivered.length
    : 0;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.bg.canvas }]} edges={['top']}>
      <IosScreenHeader
        title="Доска заказ-нарядов"
        subtitle={board ? `${totalActive} активных` : undefined}
        onBack={() => navigation.goBack()}
        trailing={<FreshnessBadge query={{ isFetching, isLoading, dataUpdatedAt }} />}
      />

      {board === undefined && isLoading ? (
        <View style={styles.centerFill}>
          <LoadingSpinner />
        </View>
      ) : isError && board === undefined ? (
        <View style={styles.centerFill}>
          <QueryErrorState description="Не удалось загрузить доску. Проверьте соединение." onRetry={() => refetch()} />
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
          {WORK_STATUS_ORDER.map((status) => {
            const meta = WORK_STATUS_META[status];
            const items = board[status];
            return (
              <View key={status} style={[styles.column, { width: COLUMN_WIDTH }]}>
                <View style={[styles.columnHeader, { backgroundColor: meta.bg }]}>
                  <Ionicons name={meta.icon} size={15} color={meta.color} />
                  <Text style={[styles.columnTitle, { color: meta.color }]}>{meta.label}</Text>
                  <View style={[styles.columnCount, { backgroundColor: meta.color }]}>
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
                      <Ionicons name={meta.icon} size={26} color={palette.text.tertiary} />
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
          без права checks_edit статусы только для чтения. */}
      <Modal visible={!!picker} onClose={() => setPicker(null)} title={picker ? `Заказ-наряд #${picker.number}` : ''}>
        {picker ? (
          <View style={{ gap: spacing[2] }}>
            <Text style={[styles.sheetHint, { color: palette.text.tertiary }]}>
              {canMove ? 'Переместить в статус' : 'Текущий статус'}
            </Text>
            {WORK_STATUS_ORDER.map((status) => {
              const meta = WORK_STATUS_META[status];
              const isCurrent = picker.workStatus === status;
              const disabled = isCurrent || !canMove;
              return (
                <TouchableOpacity
                  key={status}
                  style={[
                    styles.sheetRow,
                    { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
                    isCurrent && { borderColor: meta.color, backgroundColor: meta.bg },
                  ]}
                  activeOpacity={disabled ? 1 : 0.7}
                  disabled={disabled}
                  onPress={() => handlePickStatus(status)}
                >
                  <View style={[styles.sheetIconWrap, { backgroundColor: meta.bg }]}>
                    <Ionicons name={meta.icon} size={18} color={meta.color} />
                  </View>
                  <Text style={[styles.sheetRowLabel, { color: palette.text.primary }]}>{meta.label}</Text>
                  {isCurrent ? (
                    <View style={[styles.sheetCurrentTag, { backgroundColor: meta.color }]}>
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
