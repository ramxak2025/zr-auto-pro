/**
 * WorkBoardScreen — «Доска заказ-нарядов» (kanban board 082 + 091).
 *
 * Колонки ДИНАМИЧЕСКИЕ (owner-configurable, миграция 091): рендерятся из
 * `checksApi.board().columns` (активные, по sortOrder), каждая колонка
 * наполняется из `board().groups[column.key]` (newest-first, ≤100 на бэке,
 * учитывает право checks_view_all). ТАП по карточке → сразу деталь заказ-
 * наряда; ЛОНГ-ПРЕСС (~350 мс) → action sheet (cross-platform Modal) со
 * списком активных колонок → `setWorkStatus(id, column.key)` с оптимистичным
 * апдейтом кеша ['checks','board'] + инвалидация. В шите также «Изменить
 * комментарий» (PATCH /checks/:id/comment) и дубль «Открыть заказ-наряд».
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
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
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
import { useUsers } from '../hooks/useUsers';
import { haptic } from '../platform/haptics';
import { buildShadow } from '../platform/iosSurface';
import { colors, fontSize, fontWeight, borderRadius, spacing, softTint } from '../theme';
import { columnVisual } from '../constants/workStatus';
import { liveActivitiesAvailable, type LiveActivityState } from '../utils/liveActivity';
import {
  startTrackedActivity,
  updateTrackedActivity,
  endTrackedActivity,
  orderActivitySlot,
} from '../utils/liveActivityStore';
import type { Check, ChecksBoard } from '../../../shared/types';

const BOARD_KEY = ['checks', 'board'] as const;

/** «Иванов И.» → «ИИ» — инициалы для мини-аватарок исполнителей. */
function initials(fullName: string | null): string {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  return parts
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

function formatMoney(v: number) {
  return (
    Math.round(v ?? 0)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
  );
}

// ── Live Activity (iOS 16.1+) ────────────────────────────────────────────
// Заказ-наряд «в работе» (in_progress) → Live Activity на Lock Screen /
// Dynamic Island; любая следующая смена статуса её обновляет, «Выдан»
// (delivered) — завершает. Ключи — дефолтные колонки доски: backend (082/091)
// всегда отдаёт accepted/in_progress/ready/delivered, даже при кастомных
// колонках. На полностью переименованной доске LA просто не стартует — это
// некритичное улучшение. Всё fire-and-forget и no-op вне iOS / iOS < 16.1.
const WORK_STATUS_IN_PROGRESS = 'in_progress';
const WORK_STATUS_DELIVERED = 'delivered';

type MoveVars = { id: string; target: string; check?: Check; targetLabel?: string };

function syncOrderLiveActivity(vars: MoveVars): void {
  const { target, check, targetLabel } = vars;
  if (!check || !liveActivitiesAvailable()) return;
  const slot = orderActivitySlot(check.id);
  const state: LiveActivityState = {
    title: check.car?.plateNumber || `Заказ-наряд №${check.number}`,
    status: targetLabel || target,
    subtitle: check.master?.fullName || check.client?.fullName || undefined,
    amount: check.totalRevenue,
  };
  const itemsCount = (check.services?.length ?? 0) + (check.products?.length ?? 0);
  if (itemsCount > 0) state.itemsCount = itemsCount;

  if (target === WORK_STATUS_IN_PROGRESS) {
    void startTrackedActivity(slot, { kind: 'order', orderId: check.id }, state);
  } else if (target === WORK_STATUS_DELIVERED) {
    void endTrackedActivity(slot, state);
  } else {
    void updateTrackedActivity(slot, state);
  }
}

// ── BoardCard ───────────────────────────────────────────────────────────
// Memoised card. Module-scope so React.memo recycles it without prop
// identity churn between board refetches. Shows client / car / plate +
// total + number — payment/deferred badges intentionally absent (work-status
// is orthogonal to payment).
interface BoardCardProps {
  check: Check;
  palette: SemanticPalette;
  /** Тап — сразу деталь заказ-наряда (как кнопка «Открыть» из шита). */
  onPress: (check: Check) => void;
  /** Лонг-пресс (~350 мс) — шит выбора этапа. */
  onLongPress: (check: Check) => void;
  /**
   * Режим кассовой смены тенанта. Бейдж «ОПЛАЧЕНО — выдать» имеет смысл ТОЛЬКО
   * при включённом режиме (веха «Выдана» — кассирская механика): на легаси-
   * доске (режим ВЫКЛ) delivered_at пуст у ВСЕХ исторических оплаченных чеков
   * и колонки «Выдана» может не быть вовсе — бейдж висел бы вечным
   * невыполнимым «действием» на каждой карточке (adversarial-находка).
   */
  shiftModeEnabled: boolean;
}
const BoardCard = React.memo(function BoardCard({
  check,
  palette,
  onPress,
  onLongPress,
  shiftModeEnabled,
}: BoardCardProps) {
  // Round 14: исполнители (check_assignees) и место (tenant_locations) на
  // карточке; «ОПЛАЧЕНО — выдать» — заметный бейдж оплаченного-но-не-выданного
  // конвейерного заказа (единственное место, где оплата видна на доске:
  // work-status в остальном ортогонален оплате). Только при режиме ВКЛ.
  const assignees = check.assignees ?? [];
  const paidAwaitingDelivery = shiftModeEnabled && !check.isDeferred && !check.deliveredAt;
  const isDark = palette.mode === 'dark';
  return (
    <TouchableOpacity
      style={[
        styles.card,
        buildShadow(palette),
        { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
      ]}
      activeOpacity={0.7}
      onPress={() => onPress(check)}
      onLongPress={() => onLongPress(check)}
      delayLongPress={350}
      accessibilityRole="button"
      accessibilityLabel={`Заказ-наряд №${check.number}`}
      accessibilityHint="Нажмите, чтобы открыть; удерживайте, чтобы сменить этап"
    >
      <View style={styles.cardHeader}>
        <Text style={[styles.cardNumber, { color: palette.text.primary }]}>#{check.number}</Text>
        <Text style={[styles.cardTotal, { color: palette.text.primary }]}>{formatMoney(check.totalRevenue)}</Text>
      </View>
      {paidAwaitingDelivery && (
        <View
          style={[
            styles.paidBadge,
            { backgroundColor: isDark ? softTint(colors.green[500], 'dark') : colors.green[50] },
          ]}
        >
          <Ionicons name="checkmark-circle" size={13} color={isDark ? colors.green[300] : colors.green[600]} />
          <Text style={[styles.paidBadgeText, { color: isDark ? colors.green[200] : colors.green[700] }]}>
            ОПЛАЧЕНО — выдать
          </Text>
        </View>
      )}
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
            <View
              style={[
                styles.plateTag,
                palette.mode === 'dark' && {
                  backgroundColor: softTint(colors.primary[600], 'dark'),
                  borderColor: palette.border.strong,
                },
              ]}
            >
              <Text style={[styles.plateTagText, palette.mode === 'dark' && { color: palette.accent.primaryText }]}>
                {check.car.plateNumber}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}
      {/* Комментарий заказа — справка под клиентом/авто (155). */}
      {check.comment ? (
        <View style={styles.cardCommentRow}>
          <Ionicons name="chatbubble-outline" size={12} color={palette.text.tertiary} />
          <Text style={[styles.cardCommentText, { color: palette.text.tertiary }]} numberOfLines={2}>
            {check.comment}
          </Text>
        </View>
      ) : null}
      {(assignees.length > 0 || check.location?.name) && (
        <View style={styles.cardFooterRow}>
          {assignees.length > 0 && (
            <View style={styles.assigneeRow}>
              {/* 155: кружки 32pt с ФОТО сотрудника (users.avatar — URL/data-URI),
                  фолбэк — прежние инициалы. До 4 штук, дальше «+N». */}
              {assignees.slice(0, 4).map((a) => (
                <View
                  key={a.id}
                  style={[
                    styles.assigneeCircle,
                    {
                      backgroundColor: softTint(colors.primary[600], palette.mode),
                      borderColor: palette.bg.card,
                    },
                  ]}
                >
                  {a.avatar ? (
                    <Image source={{ uri: a.avatar }} style={styles.assigneeAvatar} contentFit="cover" />
                  ) : (
                    <Text
                      style={[styles.assigneeInitials, { color: isDark ? colors.primary[300] : colors.primary[700] }]}
                    >
                      {initials(a.fullName)}
                    </Text>
                  )}
                </View>
              ))}
              {assignees.length > 4 && (
                <Text style={[styles.assigneeMore, { color: palette.text.tertiary }]}>+{assignees.length - 4}</Text>
              )}
            </View>
          )}
          {check.location?.name ? (
            <View style={[styles.locationChip, { backgroundColor: palette.bg.muted }]}>
              <Ionicons name="location-outline" size={11} color={palette.text.tertiary} />
              <Text style={[styles.locationChipText, { color: palette.text.secondary }]} numberOfLines={1}>
                {check.location.name}
              </Text>
            </View>
          ) : null}
        </View>
      )}
    </TouchableOpacity>
  );
});

export default function WorkBoardScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const { width } = useWindowDimensions();
  const { hasPermission, user } = useAuth();
  // Перемещение разрешено тем, кто редактирует чеки (director/admin/master/
  // superadmin — director/superadmin всегда true, остальным по матрице прав).
  const canMove = hasPermission('checks_edit');
  // Настраивать колонки может держатель checks_board_manage — бэкенд гейтит
  // create/update/remove тем же ключом («права как в Битрикс24», 2026-07:
  // admin живёт по матрице из /auth/me), UI прячет шестерёнку для остальных.
  const canConfigure = hasPermission('checks_board_manage');
  // Cash-shift-mode (092): мастеру без права оплаты центральная кнопка таб-бара
  // открывает эту доску, поэтому здесь же даём ему «+» для создания нового
  // заказ-наряда (order-режим CheckCreate). orderMode=false → кнопки нет, доска
  // байт-в-байт как сейчас для кассиров/владельцев. shiftModeEnabled гейтит
  // бейдж «ОПЛАЧЕНО — выдать» на карточках (легаси-доска без режима — без него).
  const { orderMode, shiftModeEnabled } = usePosSettings();

  // Колонка занимает ~84% ширины, чтобы соседняя «выглядывала» справа —
  // явный сигнал, что доску можно листать вбок. Кап 360pt на планшетах.
  const COLUMN_WIDTH = Math.min(Math.round(width * 0.84), 360);

  const [refreshing, setRefreshing] = useState(false);
  // Карточка, по которой открыт action sheet выбора статуса (лонг-пресс).
  const [picker, setPicker] = useState<Check | null>(null);
  // 155: редактор комментария (пункт шита «Изменить комментарий»).
  const [commentEditor, setCommentEditor] = useState<Check | null>(null);
  const [commentText, setCommentText] = useState('');

  // ── Фильтр по исполнителю (Round 14, ?assigneeId=) ───────────────────
  // Владелец/админ с видимостью «все» — чипы мастеров («Все» + сотрудники);
  // мастер с видимостью «все» — переключатель «Мои / Все» (мои = self);
  // мастер со scope 'own' фильтра не видит — сервер и так отдаёт только его.
  const canSeeAll = hasPermission('checks_view_all');
  const isMasterRole = user?.role === 'master';
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null);
  const { data: allUsers } = useUsers();
  const filterMasters = React.useMemo(() => {
    const list = Array.isArray(allUsers) ? allUsers : [];
    const masters = list.filter((u) => u.isActive && !u.hiddenEverywhere && u.role === 'master');
    // Если мастеров-ролей нет (кастомные роли) — предлагаем всех активных.
    return masters.length > 0 ? masters : list.filter((u) => u.isActive && !u.hiddenEverywhere);
  }, [allUsers]);

  // Нефильтрованная доска живёт на ЛЕГАСИ-ключе (общий SWR-кеш с Кассой и
  // экраном «Оплата»); фильтр — отдельная кеш-ячейка с assigneeId в ключе.
  const boardKey = React.useMemo(
    () => (assigneeFilter ? ([...BOARD_KEY, assigneeFilter] as const) : BOARD_KEY),
    [assigneeFilter],
  );

  const {
    data: board,
    isLoading,
    isError,
    isFetching,
    dataUpdatedAt,
    refetch,
  } = useQuery<ChecksBoard>({
    queryKey: boardKey,
    queryFn: async () => (await checksApi.board(assigneeFilter ? { assigneeId: assigneeFilter } : undefined)).data,
    staleTime: 30_000,
    // SWR: возврат на доску показывает прошлый снимок мгновенно, фон тянет свежий.
    placeholderData: (prev) => prev,
  });

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: boardKey });
    setRefreshing(false);
  }, [queryClient, boardKey]);

  // ── Перемещение по доске (оптимистично) ──────────────────────────────
  // Снимаем карточку из текущей группы, добавляем в целевую В НАЧАЛО
  // (newest-first), обновляем workStatus. Откат — восстановление снимка.
  const moveMutation = useMutation({
    mutationFn: ({ id, target }: MoveVars) => checksApi.setWorkStatus(id, target),
    onMutate: async ({ id, target }) => {
      await queryClient.cancelQueries({ queryKey: boardKey });
      const prev = queryClient.getQueryData<ChecksBoard>(boardKey);
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
          queryClient.setQueryData<ChecksBoard>(boardKey, { columns: prev.columns, groups });
        }
      }
      return { prev, boardKey };
    },
    onError: (err: any, _vars, ctx) => {
      // Откат optimistic-перемещения — карточка возвращается на место.
      if (ctx?.prev) queryClient.setQueryData(ctx.boardKey, ctx.prev);
      haptic('error');
      const msg: string = err?.response?.data?.message || '';
      // Гард выдачи (Round 14): «Выдана» до оплаты невозможна — сервер отвечает
      // 400 «Заказ не оплачен». Человеческий алерт вместо генерик-«Ошибки».
      if (err?.response?.status === 400 && /не оплачен/i.test(msg)) {
        Alert.alert('Заказ не оплачен', 'Выдать машину можно только после приёма оплаты кассиром.');
        return;
      }
      Alert.alert('Ошибка', msg || 'Не удалось переместить заказ-наряд');
    },
    onSuccess: (_data, vars) => {
      haptic('success');
      // Live Activity lifecycle (iOS 16.1+; no-op on Android / iOS < 16.1).
      // Fire-and-forget — the user's move never waits on ActivityKit.
      syncOrderLiveActivity(vars);
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
      // Resolve the target column label now (fresh `board`) so the Live Activity
      // can show «В работе»/«Выдан» without re-reading state in the callback.
      const targetLabel = board?.columns.find((c) => c.key === target)?.label ?? target;
      moveMutation.mutate({ id: current.id, target, check: current, targetLabel });
    },
    [picker, moveMutation, board],
  );

  const handleOpenCheck = useCallback(() => {
    const current = picker;
    setPicker(null);
    if (current) navigation.navigate('CheckDetail', { id: current.id });
  }, [picker, navigation]);

  // 155: ТАП по карточке — сразу деталь (как «Открыть заказ-наряд» из шита);
  // шит выбора этапа переехал на лонг-пресс.
  const handleCardPress = useCallback(
    (check: Check) => {
      navigation.navigate('CheckDetail', { id: check.id });
    },
    [navigation],
  );

  const handleCardLongPress = useCallback((check: Check) => {
    haptic('select');
    setPicker(check);
  }, []);

  // ── Комментарий с доски (155) ────────────────────────────────────────
  // PATCH /checks/:id/comment (бэкенд гейтит эффективным checks_edit) →
  // инвалидация доски (BOARD_KEY — префикс, накрывает и варианты с
  // assigneeId), журнала и детали чека.
  const commentMutation = useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) => checksApi.updateComment(id, text),
    onSuccess: (_data, vars) => {
      haptic('success');
      setCommentEditor(null);
      queryClient.invalidateQueries({ queryKey: BOARD_KEY });
      queryClient.invalidateQueries({ queryKey: ['checks-infinite'] });
      queryClient.invalidateQueries({ queryKey: ['check', vars.id] });
    },
    onError: (err: any) => {
      haptic('error');
      Alert.alert(
        'Не удалось сохранить комментарий',
        err?.response?.data?.message || 'Проверьте соединение и попробуйте ещё раз.',
      );
    },
  });

  const handleEditComment = useCallback(() => {
    const current = picker;
    setPicker(null);
    if (!current) return;
    setCommentText(current.comment ?? '');
    setCommentEditor(current);
  }, [picker]);

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

      {/* ── Фильтр по исполнителю (Round 14) ────────────────────────────
          Владелец/админ: чипы «Все» + мастера (?assigneeId=). Мастер с
          видимостью «все»: переключатель «Мои / Все». Scope 'own' — без UI. */}
      {canSeeAll &&
        (isMasterRole ? (
          <View style={styles.filterRowWrap}>
            {(
              [
                { key: user?.id ?? null, label: 'Мои' },
                { key: null, label: 'Все' },
              ] as Array<{ key: string | null; label: string }>
            ).map((opt) => {
              const active = assigneeFilter === opt.key;
              return (
                <TouchableOpacity
                  key={opt.label}
                  style={[
                    styles.filterChip,
                    { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
                    active && { backgroundColor: colors.primary[600], borderColor: colors.primary[600] },
                  ]}
                  onPress={() => {
                    haptic('select');
                    setAssigneeFilter(opt.key);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.filterChipText, { color: active ? colors.white : palette.text.secondary }]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        ) : filterMasters.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.filterScroll}
            contentContainerStyle={styles.filterRowWrap}
          >
            {[{ id: null as string | null, fullName: 'Все' }, ...filterMasters].map((m) => {
              const active = assigneeFilter === m.id;
              return (
                <TouchableOpacity
                  key={m.id ?? 'all'}
                  style={[
                    styles.filterChip,
                    { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
                    active && { backgroundColor: colors.primary[600], borderColor: colors.primary[600] },
                  ]}
                  onPress={() => {
                    haptic('select');
                    setAssigneeFilter(m.id);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text
                    style={[styles.filterChipText, { color: active ? colors.white : palette.text.secondary }]}
                    numberOfLines={1}
                  >
                    {m.id ? (m.fullName ?? '').split(' ')[0] || '—' : 'Все'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        ) : null)}

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
                    items.map((c) => (
                      <BoardCard
                        key={c.id}
                        check={c}
                        palette={palette}
                        onPress={handleCardPress}
                        onLongPress={handleCardLongPress}
                        shiftModeEnabled={shiftModeEnabled}
                      />
                    ))
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
              // 155: «Выдана» для неоплаченного заказа задизейблена ЗАРАНЕЕ с
              // подписью «Сначала оплата у кассира» — вместо пост-фактум 400
              // (сам алерт-обработчик 400 в moveMutation.onError оставлен как
              // страховка от гонки «оплатили с другого телефона»).
              const deliveredLocked = column.key === WORK_STATUS_DELIVERED && picker.isDeferred === true;
              const disabled = isCurrent || !canMove || deliveredLocked;
              return (
                <TouchableOpacity
                  key={column.id}
                  style={[
                    styles.sheetRow,
                    { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
                    isCurrent && { borderColor: vis.color, backgroundColor: vis.bg },
                    deliveredLocked && !isCurrent && { opacity: 0.55 },
                  ]}
                  activeOpacity={disabled ? 1 : 0.7}
                  disabled={disabled}
                  onPress={() => handlePickStatus(column.key)}
                >
                  <View style={[styles.sheetIconWrap, { backgroundColor: vis.bg }]}>
                    <View style={[styles.sheetDot, { backgroundColor: vis.color }]} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.sheetRowLabel, { color: palette.text.primary }]} numberOfLines={1}>
                      {vis.label}
                    </Text>
                    {deliveredLocked && !isCurrent && (
                      <Text style={[styles.sheetRowSub, { color: palette.text.tertiary }]} numberOfLines={1}>
                        Сначала оплата у кассира
                      </Text>
                    )}
                  </View>
                  {isCurrent ? (
                    <View style={[styles.sheetCurrentTag, { backgroundColor: vis.color }]}>
                      <Text style={styles.sheetCurrentTagText}>Текущий</Text>
                    </View>
                  ) : deliveredLocked ? (
                    <Ionicons name="lock-closed-outline" size={16} color={palette.text.tertiary} />
                  ) : canMove ? (
                    <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
                  ) : null}
                </TouchableOpacity>
              );
            })}

            {/* 155: комментарий правится прямо с доски (гейт checks_edit —
                тот же, что и перемещение). */}
            {canMove && (
              <TouchableOpacity
                style={[styles.sheetOpenBtn, { borderColor: palette.border.subtle }]}
                activeOpacity={0.7}
                onPress={handleEditComment}
              >
                <Ionicons name="chatbubble-outline" size={17} color={colors.primary[600]} />
                <Text style={styles.sheetOpenBtnText}>Изменить комментарий</Text>
              </TouchableOpacity>
            )}

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

      {/* Модал редактирования комментария (155): multiline, ≤2000 симв. */}
      <Modal
        visible={!!commentEditor}
        onClose={() => setCommentEditor(null)}
        title={commentEditor ? `Комментарий — #${commentEditor.number}` : ''}
      >
        {commentEditor ? (
          <View style={{ gap: spacing[3] }}>
            <TextInput
              value={commentText}
              onChangeText={setCommentText}
              style={[
                styles.commentInput,
                {
                  backgroundColor: palette.bg.muted,
                  borderColor: palette.border.subtle,
                  color: palette.text.primary,
                },
              ]}
              multiline
              maxLength={2000}
              placeholder="Комментарий к заказ-наряду"
              placeholderTextColor={palette.text.tertiary}
              autoFocus
            />
            <TouchableOpacity
              style={[styles.commentSaveBtn, { backgroundColor: colors.primary[600] }]}
              activeOpacity={0.85}
              disabled={commentMutation.isPending}
              onPress={() => {
                if (!commentEditor) return;
                commentMutation.mutate({ id: commentEditor.id, text: commentText.trim() });
              }}
              accessibilityRole="button"
              accessibilityLabel="Сохранить комментарий"
            >
              {commentMutation.isPending ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.commentSaveBtnText}>Сохранить</Text>
              )}
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

  // ── Фильтр по исполнителю (Round 14) ───────────────────────────────
  filterScroll: { flexGrow: 0 },
  filterRowWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[2.5],
  },
  filterChip: {
    borderRadius: borderRadius.full,
    borderWidth: 1,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
    maxWidth: 140,
  },
  filterChipText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold },

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
  // Round 14: бейдж «ОПЛАЧЕНО — выдать» + исполнители + место на карточке.
  paidBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    alignSelf: 'flex-start',
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
  },
  paidBadgeText: { fontSize: 10, fontWeight: fontWeight.bold, letterSpacing: 0.4 },
  cardFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[2],
    marginTop: spacing[0.5],
  },
  assigneeRow: { flexDirection: 'row', alignItems: 'center' },
  // 155: 32pt — под фото сотрудника (avatar); overflow hidden обрезает
  // картинку по кругу, фолбэк-инициалы центрируются как раньше.
  assigneeCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -8,
    overflow: 'hidden',
  },
  assigneeAvatar: { width: '100%', height: '100%' },
  assigneeInitials: { fontSize: 11, fontWeight: fontWeight.bold },
  assigneeMore: { fontSize: 10, fontWeight: fontWeight.semibold, marginLeft: 12 },
  // Комментарий на карточке — вторичная справка, tertiary-цвет.
  cardCommentRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[1.5] },
  cardCommentText: { flex: 1, fontSize: fontSize.xs, lineHeight: 15 },
  locationChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    maxWidth: 150,
  },
  locationChipText: { fontSize: 10, fontWeight: fontWeight.semibold, flexShrink: 1 },

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
  sheetRowLabel: { fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  sheetRowSub: { fontSize: 11, fontWeight: fontWeight.medium, marginTop: 1 },
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

  // ── Комментарий с доски (155) ──────────────────────────────────────
  commentInput: {
    minHeight: 96,
    maxHeight: 200,
    borderWidth: 1,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    fontSize: fontSize.sm,
    textAlignVertical: 'top',
  },
  commentSaveBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[3],
  },
  commentSaveBtnText: { color: colors.white, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
});
