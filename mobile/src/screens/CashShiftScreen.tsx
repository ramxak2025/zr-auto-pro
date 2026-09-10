/**
 * CashShiftScreen — Кассовая смена / Z-отчёт / Инкассация.
 *
 * Контракт (backend cash-shifts/, migration 080):
 *   • cashShiftsApi.current() → CashShiftReport | null — текущая открытая
 *     смена с живым Z-отчётом, или null если смена закрыта.
 *   • open / close / collect возвращают пересчитанный Z-отчёт целиком,
 *     поэтому экран обновляется мгновенно после действия.
 *   • open / close / collect — owner-class: роль ∈ {director, admin,
 *     superadmin}. Сервер тоже это закрывает — здесь мы просто прячем
 *     кнопки для остальных. Просмотр current / report / list открыт всем.
 *
 * Состояния экрана:
 *   1. Загрузка        — скелетон.
 *   2. Смена закрыта   — спокойная карточка + «Открыть смену» (owner).
 *   3. Смена открыта   — живой Z-отчёт (плитки) + «Инкассация» /
 *      «Закрыть смену» (owner), список инкассаций смены.
 *   4. История         — прошлые (закрытые) смены, новые сверху; тап по
 *      строке открывает printable-подобный Z-отчёт в модалке.
 *
 *   expectedAmount = openingAmount + cashSales − cashExpenses − collectionsTotal
 *   difference     = factualAmount − expectedAmount  (>0 излишек, <0 недостача)
 *
 * Android-совместимо: ввод сумм идёт через собственную Modal + TextInput
 * (Alert.prompt — iOS-only), все API platform-agnostic.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  RefreshControl,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import IosScreenHeader from '../components/IosScreenHeader';
import PointSwitcher, { type PointSwitcherHandle } from '../components/PointSwitcher';
import Modal from '../components/Modal';
import EmptyState from '../components/EmptyState';
import { ListSkeleton } from '../components/Skeleton';
import { useAuth } from '../contexts/AuthContext';
import { useTenantTimezone } from '../contexts/TenantTimezoneContext';
import { useColors } from '../contexts/ThemeContext';
import type { SemanticPalette } from '../theme/palette';
import { cashShiftsApi } from '../api/services';
import { colors, borderRadius, spacing, getBadgeColors } from '../theme';
import { iosCard, iosSectionLabel } from '../platform/iosSurface';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { haptic } from '../platform/haptics';
import { startTrackedActivity, endTrackedActivity, CASH_SHIFT_ACTIVITY_SLOT } from '../utils/liveActivityStore';
import type {
  CashShift,
  CashShiftReport,
  CashShiftAcceptorTotal,
  CashCollection,
  SafeState,
  SafeTransaction,
} from '../../../shared/types';
import { choosePointMessage } from '../../../shared/utils/apiError';

// ────────────────────────────────────────────────────────────────────────
//  Formatting helpers
// ────────────────────────────────────────────────────────────────────────

function formatMoney(v: number): string {
  const sign = v < 0 ? '−' : '';
  return (
    sign +
    Math.abs(Math.round(v))
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') +
    ' ₽'
  );
}

/**
 * Дата+время кассовой смены — в поясе АВТОСЕРВИСА (tenants.timezone, 157).
 * Смена открывается и закрывается по местным суткам (shifts.service считает
 * бизнес-дату тем же поясом), поэтому «Открыта 09:05» обязано быть местным
 * временем, а не временем телефона кассира. Сбой Intl → время устройства.
 */
function formatDateTime(iso: string | null | undefined, tz: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const opts: Intl.DateTimeFormatOptions = {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  };
  try {
    return d.toLocaleString('ru-RU', { ...opts, timeZone: tz });
  } catch {
    return d.toLocaleString('ru-RU', opts);
  }
}

/** Парсит пользовательский ввод суммы: пробелы как разделители тысяч,
 *  запятая как десятичная точка. Возвращает null если не число. */
function parseAmount(input: string): number | null {
  const cleaned = input.replace(/\s/g, '').replace(',', '.');
  if (cleaned === '') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

type InputModal = 'open' | 'collect' | 'close' | 'safeCollect' | null;

/** Ключ строки сдачи: userId либо маркер «Не распределено» (userId === null). */
function acceptorKey(userId: string | null): string {
  return userId ?? '__unattributed__';
}

/** Достаёт текст ошибки бэка (400/409) — показываем владельцу дословно. */
function serverMessage(err: unknown): string | null {
  const body = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data;
  const msg = body?.message;
  if (typeof msg === 'string' && msg.trim()) return msg;
  if (Array.isArray(msg) && msg.length > 0) return msg.join('\n');
  return null;
}

// ────────────────────────────────────────────────────────────────────────
//  Tile — одна метрика Z-отчёта
// ────────────────────────────────────────────────────────────────────────

interface TileProps {
  label: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
  tint: string;
  tintBg: string;
  palette: SemanticPalette;
}

const Tile = React.memo(function Tile({ label, value, icon, tint, tintBg, palette }: TileProps) {
  return (
    <View style={[styles.tile, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
      <View style={styles.tileHeader}>
        <View style={[styles.tileIcon, { backgroundColor: palette.mode === 'dark' ? palette.bg.muted : tintBg }]}>
          <Ionicons name={icon} size={14} color={tint} />
        </View>
        <Text style={[styles.tileLabel, { color: palette.text.secondary }]} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text style={[styles.tileValue, { color: palette.text.primary }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
});

// ────────────────────────────────────────────────────────────────────────
//  Screen
// ────────────────────────────────────────────────────────────────────────

export default function CashShiftScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  // Round 14, режим «Кассир»: этот же экран — корень таба «Смены»
  // (CashShiftsTab). У корня таба back-стрелке некуда вести — прячем её;
  // вход из MoreStack (роут 'CashShift') остаётся с back как раньше.
  const isTabRoot = route.name === 'CashShiftsTab';

  // Открытие/закрытие/инкассация кассовой смены — ключ cash_shifts_manage
  // (сервер: POST /cash-shifts open/close/collect → тот же ключ; «права как в
  // Битрикс24», 2026-07: admin живёт по матрице из /auth/me). Просмотр
  // Z-отчёта остаётся открытым любому сотруднику.
  const isOwner = hasPermission('cash_shifts_manage');

  // ── State ──────────────────────────────────────────────────────────────
  const [refreshing, setRefreshing] = useState(false);
  const [inputModal, setInputModal] = useState<InputModal>(null);
  const [amountInput, setAmountInput] = useState('');
  const [noteInput, setNoteInput] = useState('');
  // 155 — закрытие смены: фактическая сдача по каждому принимавшему оплату
  // (ключ = acceptorKey(userId)) + сколько наличных перевести в сейф.
  const [settlementInputs, setSettlementInputs] = useState<Record<string, string>>({});
  const [toSafeInput, setToSafeInput] = useState('');
  // Z-отчёт в модалке — из истории (report(id)) или результат закрытия смены.
  const [detailReport, setDetailReport] = useState<CashShiftReport | null>(null);
  // 155 — модал истории операций сейфа (SafeState.transactions).
  const [safeDetail, setSafeDetail] = useState<SafeState | null>(null);

  // ── Queries ────────────────────────────────────────────────────────────
  const currentQuery = useQuery<CashShiftReport | null>({
    queryKey: ['cash-shift', 'current'],
    queryFn: async () => (await cashShiftsApi.current()).data,
    placeholderData: (prev) => prev,
  });
  // Бэкенд при отсутствии открытой смены отдаёт null, но пустое тело может прийти
  // как "" (axios) → "" ?? null === "" (не nullish). Считаем валидной открытой
  // сменой ТОЛЬКО объект с полем shift — иначе это «смена закрыта», без краша.
  const current = currentQuery.data && currentQuery.data.shift ? currentQuery.data : null;
  const openShiftId = current?.shift?.id ?? null;

  const listQuery = useQuery({
    queryKey: ['cash-shift', 'list'],
    queryFn: async () => (await cashShiftsApi.list({ page: 1, limit: 20 })).data,
    placeholderData: (prev) => prev,
  });
  // История — только закрытые смены (открытая уже показана сверху).
  const history: CashShift[] = useMemo(
    () => (listQuery.data?.data ?? []).filter((s) => s.status === 'closed'),
    [listQuery.data],
  );

  // 155 — размен последней закрытой смены (сервер подставляет его дефолтом,
  // если open() отправлен без openingAmount). История — новые сверху.
  const lastCarryover = useMemo(() => {
    const v = history[0]?.carryoverAmount;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }, [history]);

  // 155 — строки «Сдача по сотрудникам» при закрытии: каждый, кто принял нал
  // (плюс «Не распределено» — чеки без accepted_by), сдаёт свою сумму отдельно.
  const closeSettlementRows: CashShiftAcceptorTotal[] = useMemo(
    () => (current?.perAcceptor ?? []).filter((r) => r.cashSales > 0 || r.userId === null),
    [current?.perAcceptor],
  );

  // 155 — СЕЙФ. Пока смена открыта, баланс приходит в её Z-отчёте; без
  // открытой смены (и только под cash_shifts_manage — эндпоинт гейтится)
  // спрашиваем /cash-shifts/safe отдельно.
  const safeQuery = useQuery<SafeState>({
    queryKey: ['cash-safe'],
    queryFn: async () => (await cashShiftsApi.safe()).data,
    enabled: isOwner && !current,
    placeholderData: (prev) => prev,
  });
  const safeBalance: number | null =
    current && typeof current.safeBalance === 'number'
      ? current.safeBalance
      : typeof safeQuery.data?.balance === 'number'
        ? safeQuery.data.balance
        : null;

  // ── Mutations ──────────────────────────────────────────────────────────
  const invalidateShift = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['cash-shift', 'current'] });
    queryClient.invalidateQueries({ queryKey: ['cash-shift', 'list'] });
  }, [queryClient]);

  const closeInputModal = useCallback(() => {
    setInputModal(null);
    setAmountInput('');
    setNoteInput('');
    setSettlementInputs({});
    setToSafeInput('');
  }, []);

  // Ссылка на шторку выбора филиала: сервер отказывает открыть смену в режиме
  // «Все точки», и правильный ответ на этот отказ — сразу предложить выбор.
  const pointSwitcherRef = useRef<PointSwitcherHandle>(null);

  const openMutation = useMutation({
    // 155 — openingAmount опционален: без него сервер сам подставляет размен
    // прошлой смены (carryoverAmount последней закрытой).
    mutationFn: (d: { openingAmount?: number; note?: string }) =>
      cashShiftsApi.open(d as Parameters<typeof cashShiftsApi.open>[0]),
    onSuccess: (res, vars) => {
      invalidateShift();
      closeInputModal();
      haptic('success');
      // Live Activity (iOS 16.1+): касса открыта → на Lock Screen / Dynamic
      // Island. Fire-and-forget; no-op на Android / iOS < 16.1. Сумму берём
      // из ответа (сервер мог подставить размен сам), fallback — введённая.
      void startTrackedActivity(
        CASH_SHIFT_ACTIVITY_SLOT,
        { kind: 'shift' },
        {
          title: 'Кассовая смена',
          status: 'Касса открыта',
          amount: res.data?.openingAmount ?? vars.openingAmount ?? 0,
        },
      );
    },
    onError: (err) => {
      haptic('error');
      // 160/161: у тенанта с филиалами смену нельзя открыть «на всю сеть» —
      // деньги смены должны принадлежать конкретной точке. Сервер отвечает
      // человеческим текстом; мы не пересказываем его, а даём кнопку, которая
      // решает проблему на месте. Распознаём отказ ОБЩИМ хелпером
      // (shared/utils/apiError), а не «есть ли в тексте слово филиал»: под
      // ту проверку попал бы любой другой отказ, где это слово встретилось.
      const pointMessage = choosePointMessage(err);
      if (pointMessage) {
        // Форма ввода размена — RN `<Modal>`, шторка выбора филиала тоже.
        // Презентация одной в тот же кадр, когда другая ещё уходит, на iOS
        // съедает верхнюю, поэтому сначала закрываем форму, потом (через
        // анимацию) спрашиваем: смена всё равно не откроется без филиала.
        closeInputModal();
        setTimeout(() => {
          Alert.alert('Выберите филиал', pointMessage, [
            { text: 'Отмена', style: 'cancel' },
            { text: 'Выбрать филиал', onPress: () => pointSwitcherRef.current?.open() },
          ]);
        }, 250);
        return;
      }
      Alert.alert('Ошибка', serverMessage(err) ?? 'Не удалось открыть смену. Возможно, смена уже открыта.');
    },
  });

  const collectMutation = useMutation({
    mutationFn: ({ id, amount, note }: { id: string; amount: number; note?: string }) =>
      cashShiftsApi.collect(id, { amount, note }),
    onSuccess: () => {
      invalidateShift();
      closeInputModal();
      haptic('success');
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось записать инкассацию');
    },
  });

  const closeMutation = useMutation({
    // 155: + toSafeAmount (перевод наличных в сейф при закрытии) и settlements
    // (фактическая сдача по сотрудникам; Σ actualAmount = closingAmount).
    mutationFn: ({
      id,
      closingAmount,
      note,
      toSafeAmount,
      settlements,
    }: {
      id: string;
      closingAmount: number;
      note?: string;
      toSafeAmount?: number;
      settlements?: Array<{ userId: string | null; actualAmount: number }>;
    }) => cashShiftsApi.close(id, { closingAmount, note, toSafeAmount, settlements }),
    onSuccess: (res) => {
      invalidateShift();
      // Сейф пополнился переводом при закрытии — перечитываем его баланс.
      queryClient.invalidateQueries({ queryKey: ['cash-safe'] });
      closeInputModal();
      haptic('success');
      // Показываем итоговый Z-отчёт с расхождением сразу после закрытия.
      setDetailReport(res.data);
      // Live Activity: смена закрыта → завершаем активность. Fire-and-forget.
      void endTrackedActivity(CASH_SHIFT_ACTIVITY_SLOT, { title: 'Кассовая смена', status: 'Касса закрыта' });
    },
    onError: (err) => {
      haptic('error');
      // 400 бэка (например, Σ сдачи ≠ сумме закрытия) — показываем дословно.
      Alert.alert('Ошибка', serverMessage(err) ?? 'Не удалось закрыть смену');
    },
  });

  // 155 — инкассация владельцем ИЗ СЕЙФА (без открытой смены). Ответ — свежий
  // SafeState: кладём его в кэш сразу и инвалидируем сейф + текущий отчёт.
  const safeCollectMutation = useMutation({
    mutationFn: (d: { amount: number; note?: string }) => cashShiftsApi.safeCollect(d),
    onSuccess: (res) => {
      queryClient.setQueryData(['cash-safe'], res.data);
      queryClient.invalidateQueries({ queryKey: ['cash-safe'] });
      queryClient.invalidateQueries({ queryKey: ['cash-shift', 'current'] });
      closeInputModal();
      haptic('success');
    },
    onError: (err) => {
      haptic('error');
      Alert.alert('Ошибка', serverMessage(err) ?? 'Не удалось выполнить инкассацию из сейфа');
    },
  });

  const anyMutating =
    openMutation.isPending || collectMutation.isPending || closeMutation.isPending || safeCollectMutation.isPending;

  // ── Handlers ───────────────────────────────────────────────────────────
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['cash-shift', 'current'] }),
      queryClient.invalidateQueries({ queryKey: ['cash-shift', 'list'] }),
    ]);
    setRefreshing(false);
  }, [queryClient]);

  const openModal = useCallback(
    (kind: Exclude<InputModal, null>) => {
      haptic('tap');
      // 155 — открытие: предзаполняем разменом прошлой смены (сервер сделает
      // так же, если поле оставить пустым и отправить без openingAmount).
      setAmountInput(kind === 'open' && lastCarryover !== null ? String(Math.round(lastCarryover)) : '');
      setNoteInput('');
      // 155 — закрытие: дефолт сдачи каждого сотрудника = его расчётный нал.
      if (kind === 'close') {
        const defaults: Record<string, string> = {};
        for (const r of closeSettlementRows) defaults[acceptorKey(r.userId)] = String(Math.round(r.cashSales));
        setSettlementInputs(defaults);
      } else {
        setSettlementInputs({});
      }
      setToSafeInput('');
      setInputModal(kind);
    },
    [lastCarryover, closeSettlementRows],
  );

  // 155 — «Итого сдано» (Σ инпутов по сотрудникам) = closingAmount смены.
  // null, если хоть одна строка не парсится в неотрицательное число.
  const settlementsTotal = useMemo(() => {
    if (closeSettlementRows.length === 0) return null;
    let sum = 0;
    for (const r of closeSettlementRows) {
      const v = parseAmount(settlementInputs[acceptorKey(r.userId)] ?? '');
      if (v === null || v < 0) return null;
      sum += v;
    }
    return sum;
  }, [closeSettlementRows, settlementInputs]);

  const handleSubmit = useCallback(() => {
    const amount = parseAmount(amountInput);
    const note = noteInput.trim() || undefined;

    if (inputModal === 'open') {
      // Пустой инпут = размен подставит сервер (отправляем БЕЗ openingAmount).
      if (amountInput.trim() === '') {
        openMutation.mutate({ note });
        return;
      }
      if (amount === null || amount < 0) {
        Alert.alert('Ошибка', 'Укажите сумму наличных в кассе на начало смены');
        return;
      }
      openMutation.mutate({ openingAmount: amount, note });
      return;
    }
    if (inputModal === 'collect') {
      if (!openShiftId) return;
      if (amount === null || amount <= 0) {
        Alert.alert('Ошибка', 'Укажите сумму инкассации');
        return;
      }
      collectMutation.mutate({ id: openShiftId, amount, note });
      return;
    }
    if (inputModal === 'safeCollect') {
      if (amount === null || amount <= 0) {
        Alert.alert('Ошибка', 'Укажите сумму инкассации из сейфа');
        return;
      }
      safeCollectMutation.mutate({ amount, note });
      return;
    }
    if (inputModal === 'close') {
      if (!openShiftId) return;
      // 155 — сдача по сотрудникам: closingAmount = Σ фактических сумм.
      // Fallback на общий инпут, когда perAcceptor пуст (старый бэкенд).
      let closingAmount: number;
      let settlements: Array<{ userId: string | null; actualAmount: number }> | undefined;
      if (closeSettlementRows.length > 0) {
        if (settlementsTotal === null) {
          Alert.alert('Ошибка', 'Укажите фактически сданную сумму по каждому сотруднику');
          return;
        }
        closingAmount = settlementsTotal;
        settlements = closeSettlementRows.map((r) => ({
          userId: r.userId,
          actualAmount: parseAmount(settlementInputs[acceptorKey(r.userId)] ?? '') ?? 0,
        }));
      } else {
        if (amount === null || amount < 0) {
          Alert.alert('Ошибка', 'Укажите фактическую сумму наличных в кассе');
          return;
        }
        closingAmount = amount;
      }
      // 155 — перевод в сейф: 0..closingAmount; пустое поле = всё остаётся
      // на размен в кассе.
      const toSafe = toSafeInput.trim() === '' ? 0 : parseAmount(toSafeInput);
      if (toSafe === null || toSafe < 0 || toSafe > closingAmount) {
        Alert.alert('Ошибка', `Сумма «В сейф» должна быть от 0 до ${formatMoney(closingAmount)}`);
        return;
      }
      closeMutation.mutate({
        id: openShiftId,
        closingAmount,
        note,
        ...(toSafe > 0 ? { toSafeAmount: toSafe } : null),
        ...(settlements ? { settlements } : null),
      });
    }
  }, [
    amountInput,
    noteInput,
    inputModal,
    openShiftId,
    openMutation,
    collectMutation,
    closeMutation,
    safeCollectMutation,
    closeSettlementRows,
    settlementInputs,
    settlementsTotal,
    toSafeInput,
  ]);

  const openHistoryDetail = useCallback(
    async (shiftId: string) => {
      haptic('tap');
      try {
        const report = await queryClient.fetchQuery({
          queryKey: ['cash-shift', 'report', shiftId],
          queryFn: async () => (await cashShiftsApi.report(shiftId)).data,
        });
        setDetailReport(report);
      } catch {
        Alert.alert('Ошибка', 'Не удалось загрузить Z-отчёт');
      }
    },
    [queryClient],
  );

  // 155 — тап по карточке сейфа: подтягиваем свежий SafeState (баланс +
  // история операций) и открываем модал. Эндпоинт гейтится cash_shifts_manage.
  const openSafeHistory = useCallback(async () => {
    haptic('tap');
    try {
      const state = await queryClient.fetchQuery({
        queryKey: ['cash-safe'],
        queryFn: async () => (await cashShiftsApi.safe()).data,
        staleTime: 0,
      });
      setSafeDetail(state);
    } catch {
      Alert.alert('Ошибка', 'Не удалось загрузить историю сейфа');
    }
  }, [queryClient]);

  // ── Render ─────────────────────────────────────────────────────────────
  const loadingFirst = currentQuery.isLoading && !currentQuery.data && listQuery.isLoading;

  const modalConfig = useMemo(() => {
    switch (inputModal) {
      case 'open':
        return {
          title: 'Открыть смену',
          amountLabel: 'Наличные в кассе на начало',
          amountPlaceholder: lastCarryover !== null ? String(Math.round(lastCarryover)) : '0',
          submitLabel: 'Открыть смену',
          hint:
            lastCarryover !== null
              ? `Размен с прошлой смены: ${formatMoney(lastCarryover)}. Оставьте поле пустым — смена откроется с этой суммой автоматически.`
              : 'Разменная касса — сколько наличных лежит в кассе перед началом работы.',
        };
      case 'collect':
        return {
          title: 'Инкассация',
          amountLabel: 'Сумма изъятия из кассы',
          amountPlaceholder: '0',
          submitLabel: 'Записать инкассацию',
          hint: 'Сумма наличных, которую вы забираете из кассы. Уменьшает ожидаемый остаток.',
        };
      case 'safeCollect':
        return {
          title: 'Инкассация из сейфа',
          amountLabel: 'Сумма изъятия из сейфа',
          amountPlaceholder: safeBalance !== null ? String(Math.round(safeBalance)) : '0',
          submitLabel: 'Забрать из сейфа',
          hint:
            safeBalance !== null
              ? `В сейфе сейчас: ${formatMoney(safeBalance)}. Кассиру придёт уведомление об инкассации.`
              : 'Кассиру придёт уведомление об инкассации.',
        };
      case 'close':
        return {
          title: 'Закрыть смену',
          amountLabel: 'Фактические наличные в кассе',
          amountPlaceholder: current ? String(Math.round(current.expectedAmount)) : '0',
          submitLabel: 'Закрыть смену',
          hint: current
            ? `Ожидается в кассе: ${formatMoney(current.expectedAmount)}. Введите, сколько денег фактически в кассе сейчас.`
            : '',
        };
      default:
        return null;
    }
  }, [inputModal, current, lastCarryover, safeBalance]);

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title="Кассовая смена"
        subtitle="Z-отчёт и инкассация"
        onBack={isTabRoot ? undefined : () => navigation.goBack()}
      />

      {/* Филиал смены (156/161): GET /cash-shifts/current отдаёт смену ТЕКУЩЕГО
          филиала, а открыть смену в режиме «Все точки» сервер не даёт вовсе —
          деньги смены обязаны принадлежать конкретной точке. Отдельной строкой,
          а не в trailing шапки: длинное название филиала обрезало бы заголовок.
          Чип скрывает себя сам, когда доступен один филиал. */}
      <PointSwitcher ref={pointSwitcherRef} variant="chip" style={styles.pointChipRow} />

      {loadingFirst ? (
        <View style={styles.loadingWrap}>
          <ListSkeleton count={5} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Platform.OS === 'ios' ? spacing[6] : tabBarHeight + spacing[6] },
          ]}
          contentInset={{ bottom: tabBarHeight }}
          scrollIndicatorInsets={{ bottom: tabBarHeight }}
          automaticallyAdjustContentInsets={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
          }
        >
          {current ? (
            <OpenShiftView
              report={current}
              isOwner={isOwner}
              palette={palette}
              onCollect={() => openModal('collect')}
              onClose={() => openModal('close')}
            />
          ) : (
            <ClosedShiftView isOwner={isOwner} palette={palette} onOpen={() => openModal('open')} />
          )}

          {/* 155 — Сейф: отдельный «кошелёк» тенанта. Баланс — из Z-отчёта
              открытой смены либо из /cash-shifts/safe. Тап — история операций;
              «Инкассация из сейфа» — только под cash_shifts_manage. */}
          {safeBalance !== null && (
            <SafeCard
              balance={safeBalance}
              isOwner={isOwner}
              palette={palette}
              onPress={isOwner ? openSafeHistory : undefined}
              onCollect={isOwner ? () => openModal('safeCollect') : undefined}
            />
          )}

          {/* История смен */}
          <Text style={[iosSectionLabel, styles.historyLabel, { color: palette.text.tertiary }]}>История смен</Text>
          {history.length === 0 ? (
            <View
              style={[styles.emptyHistory, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
            >
              <Text style={[styles.emptyHistoryText, { color: palette.text.tertiary }]}>Закрытых смен пока нет</Text>
            </View>
          ) : (
            <View
              style={[styles.historyCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
            >
              {history.map((shift, idx) => (
                <HistoryRow
                  key={shift.id}
                  shift={shift}
                  showDivider={idx < history.length - 1}
                  palette={palette}
                  onPress={() => openHistoryDetail(shift.id)}
                />
              ))}
            </View>
          )}
        </ScrollView>
      )}

      {/* Ввод суммы (открыть / инкассация / закрыть) */}
      <Modal visible={inputModal !== null} onClose={closeInputModal} title={modalConfig?.title ?? ''}>
        {modalConfig && (
          <View>
            {/* 155 — закрытие с разбивкой: каждый принимавший оплату сдаёт
                свою сумму; «Итого сдано» и становится closingAmount. Общий
                инпут остаётся fallback'ом, когда perAcceptor пуст. */}
            {inputModal === 'close' && closeSettlementRows.length > 0 ? (
              <View>
                <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Сдача по сотрудникам</Text>
                <View
                  style={[
                    styles.settlementCard,
                    { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
                  ]}
                >
                  {closeSettlementRows.map((row, i) => (
                    <View
                      key={acceptorKey(row.userId)}
                      style={[
                        styles.settlementRow,
                        i < closeSettlementRows.length - 1 && {
                          borderBottomWidth: StyleSheet.hairlineWidth,
                          borderBottomColor: palette.border.subtle,
                        },
                      ]}
                    >
                      <View style={styles.settlementLeft}>
                        <Text style={[styles.settlementName, { color: palette.text.primary }]} numberOfLines={1}>
                          {row.name ?? (row.userId === null ? 'Не распределено' : 'Сотрудник')}
                        </Text>
                        <Text style={[styles.settlementExpected, { color: palette.text.tertiary }]}>
                          расчётно: {formatMoney(row.cashSales)} нал
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.settlementInputWrap,
                          { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
                        ]}
                      >
                        <TextInput
                          value={settlementInputs[acceptorKey(row.userId)] ?? ''}
                          onChangeText={(v) =>
                            setSettlementInputs((prev) => ({ ...prev, [acceptorKey(row.userId)]: v }))
                          }
                          style={[styles.settlementInput, { color: palette.text.primary }]}
                          keyboardType="numeric"
                          placeholder={String(Math.round(row.cashSales))}
                          placeholderTextColor={palette.text.tertiary}
                        />
                        <Text style={[styles.settlementCurrency, { color: palette.text.tertiary }]}>₽</Text>
                      </View>
                    </View>
                  ))}
                </View>
                <View style={styles.settlementTotalRow}>
                  <Text style={[styles.settlementTotalLabel, { color: palette.text.secondary }]}>Итого сдано</Text>
                  <Text style={[styles.settlementTotalValue, { color: palette.text.primary }]}>
                    {settlementsTotal !== null ? formatMoney(settlementsTotal) : '—'}
                  </Text>
                </View>
              </View>
            ) : (
              <View>
                <Text style={[styles.formLabel, { color: palette.text.secondary }]}>{modalConfig.amountLabel}</Text>
                <View
                  style={[styles.amountWrap, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
                >
                  <Text style={[styles.amountCurrency, { color: palette.text.tertiary }]}>₽</Text>
                  <TextInput
                    value={amountInput}
                    onChangeText={setAmountInput}
                    style={[styles.amountInput, { color: palette.text.primary }]}
                    keyboardType="numeric"
                    placeholder={modalConfig.amountPlaceholder}
                    placeholderTextColor={palette.text.tertiary}
                    autoFocus
                  />
                </View>
              </View>
            )}

            {/* 155 — перевод наличных в сейф при закрытии; остаток становится
                разменом, с которого стартует следующая смена. */}
            {inputModal === 'close' && (
              <View>
                <View style={styles.toSafeLabelRow}>
                  <Text style={[styles.formLabel, { color: palette.text.secondary, marginBottom: 0 }]}>
                    Перевести в сейф
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      haptic('select');
                      const closing = closeSettlementRows.length > 0 ? settlementsTotal : parseAmount(amountInput);
                      if (closing !== null && closing >= 0) setToSafeInput(String(Math.round(closing)));
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel="Перевести всё в сейф"
                  >
                    <Text style={[styles.toSafeAllBtn, { color: colors.primary[600] }]}>Всё в сейф</Text>
                  </TouchableOpacity>
                </View>
                <View
                  style={[styles.amountWrap, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
                >
                  <Text style={[styles.amountCurrency, { color: palette.text.tertiary }]}>₽</Text>
                  <TextInput
                    value={toSafeInput}
                    onChangeText={setToSafeInput}
                    style={[styles.amountInput, { color: palette.text.primary }]}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={palette.text.tertiary}
                  />
                </View>
                {(() => {
                  const closing = closeSettlementRows.length > 0 ? settlementsTotal : parseAmount(amountInput);
                  const toSafe = toSafeInput.trim() === '' ? 0 : parseAmount(toSafeInput);
                  if (closing === null || toSafe === null || toSafe < 0 || toSafe > closing) return null;
                  return (
                    <Text style={[styles.hint, { color: palette.text.tertiary, marginTop: spacing[2] }]}>
                      Останется на размен: {formatMoney(closing - toSafe)} — с этой суммы начнётся следующая смена.
                    </Text>
                  );
                })()}
              </View>
            )}

            <Text style={[styles.formLabel, { color: palette.text.secondary, marginTop: spacing[4] }]}>
              Комментарий (необязательно)
            </Text>
            <TextInput
              value={noteInput}
              onChangeText={setNoteInput}
              style={[
                styles.noteInput,
                { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
              ]}
              placeholder="Например: причина расхождения"
              placeholderTextColor={palette.text.tertiary}
              multiline
            />

            {modalConfig.hint ? (
              <Text style={[styles.hint, { color: palette.text.tertiary }]}>{modalConfig.hint}</Text>
            ) : null}

            <TouchableOpacity
              style={[
                styles.submitBtn,
                { backgroundColor: inputModal === 'close' ? colors.rose[600] : colors.primary[600] },
                anyMutating && { opacity: 0.6 },
              ]}
              onPress={handleSubmit}
              disabled={anyMutating}
              activeOpacity={0.85}
            >
              {anyMutating ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : (
                <Text style={styles.submitBtnText}>{modalConfig.submitLabel}</Text>
              )}
            </TouchableOpacity>
          </View>
        )}
      </Modal>

      {/* Z-отчёт по смене — printable-подобная сводка */}
      <Modal visible={detailReport !== null} onClose={() => setDetailReport(null)} title="Z-отчёт">
        {detailReport && <ReportDetail report={detailReport} palette={palette} />}
      </Modal>

      {/* 155 — история операций сейфа */}
      <Modal visible={safeDetail !== null} onClose={() => setSafeDetail(null)} title="Сейф">
        {safeDetail && <SafeHistoryDetail state={safeDetail} palette={palette} />}
      </Modal>
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────────
//  SafeCard — «Сейф: N ₽» (155). Тап — история операций, кнопка —
//  инкассация из сейфа (обе — только под cash_shifts_manage).
// ────────────────────────────────────────────────────────────────────────

interface SafeCardProps {
  balance: number;
  isOwner: boolean;
  palette: SemanticPalette;
  onPress?: () => void;
  onCollect?: () => void;
}

function SafeCard({ balance, isOwner, palette, onPress, onCollect }: SafeCardProps) {
  return (
    <View style={[styles.safeCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
      <TouchableOpacity
        style={styles.safeCardRow}
        onPress={onPress}
        disabled={!onPress}
        activeOpacity={0.6}
        accessibilityRole="button"
        accessibilityLabel="История операций сейфа"
      >
        <View
          style={[styles.safeIcon, { backgroundColor: palette.mode === 'dark' ? palette.bg.muted : colors.amber[50] }]}
        >
          <Ionicons name="archive-outline" size={18} color={colors.amber[600]} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.safeLabel, { color: palette.text.secondary }]}>Сейф</Text>
          <Text style={[styles.safeValue, { color: palette.text.primary }]}>{formatMoney(balance)}</Text>
        </View>
        {onPress ? <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} /> : null}
      </TouchableOpacity>
      {isOwner && onCollect && (
        <TouchableOpacity
          style={[styles.safeCollectBtn, { borderColor: colors.amber[600] }]}
          onPress={onCollect}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Инкассация из сейфа"
        >
          <Ionicons name="briefcase-outline" size={16} color={colors.amber[600]} />
          <Text style={[styles.safeCollectBtnText, { color: colors.amber[600] }]}>Инкассация из сейфа</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────────
//  SafeHistoryDetail — операции сейфа в модалке (155)
// ────────────────────────────────────────────────────────────────────────

const SAFE_TX_LABELS: Record<SafeTransaction['type'], string> = {
  deposit: 'Из кассы',
  collection: 'Инкассация',
  adjustment: 'Корректировка',
};

function safeTxAmountLabel(tx: SafeTransaction): string {
  // deposit — приход (+), collection — расход (−), adjustment — знак уже
  // в amount (формат formatMoney сам ставит минус отрицательным).
  if (tx.type === 'deposit') return `+${formatMoney(tx.amount)}`;
  if (tx.type === 'collection') return `−${formatMoney(Math.abs(tx.amount))}`;
  return tx.amount > 0 ? `+${formatMoney(tx.amount)}` : formatMoney(tx.amount);
}

function safeTxTint(tx: SafeTransaction, palette: SemanticPalette): string {
  if (tx.type === 'deposit') return colors.green[600];
  if (tx.type === 'collection') return colors.rose[600];
  return tx.amount >= 0 ? palette.text.primary : colors.rose[600];
}

function SafeHistoryDetail({ state, palette }: { state: SafeState; palette: SemanticPalette }) {
  // Время смены/операций — в поясе автосервиса (см. formatDateTime).
  const tenantTz = useTenantTimezone();
  return (
    <View>
      <View style={styles.reportHeader}>
        <Text style={[styles.reportTitle, { color: palette.text.primary }]}>{formatMoney(state.balance)}</Text>
        <Text style={[styles.reportPeriod, { color: palette.text.tertiary }]}>Текущий баланс сейфа</Text>
      </View>
      {state.transactions.length === 0 ? (
        <Text style={[styles.safeEmptyText, { color: palette.text.tertiary }]}>Операций по сейфу пока нет</Text>
      ) : (
        state.transactions.map((tx, i) => (
          <View
            key={tx.id}
            style={[
              styles.safeTxRow,
              i < state.transactions.length - 1 && {
                borderBottomWidth: StyleSheet.hairlineWidth,
                borderBottomColor: palette.border.subtle,
              },
            ]}
          >
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text style={[styles.safeTxType, { color: palette.text.primary }]}>{SAFE_TX_LABELS[tx.type]}</Text>
              <Text style={[styles.safeTxMeta, { color: palette.text.tertiary }]} numberOfLines={2}>
                {formatDateTime(tx.createdAt, tenantTz)}
                {tx.actorName ? ` · ${tx.actorName}` : ''}
                {tx.note ? ` · ${tx.note}` : ''}
              </Text>
            </View>
            <Text style={[styles.safeTxAmount, { color: safeTxTint(tx, palette) }]}>{safeTxAmountLabel(tx)}</Text>
          </View>
        ))
      )}
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────────
//  OpenShiftView — живой Z-отчёт открытой смены
// ────────────────────────────────────────────────────────────────────────

interface OpenShiftViewProps {
  report: CashShiftReport;
  isOwner: boolean;
  palette: SemanticPalette;
  onCollect: () => void;
  onClose: () => void;
}

function OpenShiftView({ report, isOwner, palette, onCollect, onClose }: OpenShiftViewProps) {
  // Время смены/операций — в поясе автосервиса (см. formatDateTime).
  const tenantTz = useTenantTimezone();
  return (
    <View>
      {/* Статус */}
      <View style={[styles.statusCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
        <View style={styles.statusTopRow}>
          <View style={[styles.statusBadge, { backgroundColor: getBadgeColors(palette.mode).green.bg }]}>
            <View style={[styles.statusDot, { backgroundColor: colors.green[500] }]} />
            <Text style={[styles.statusBadgeText, { color: getBadgeColors(palette.mode).green.text }]}>
              Смена открыта
            </Text>
          </View>
        </View>
        <Text style={[styles.statusMeta, { color: palette.text.secondary }]}>
          Открыта {formatDateTime(report.shift.openedAt, tenantTz)}
          {report.shift.openedByName ? ` · ${report.shift.openedByName}` : ''}
        </Text>
      </View>

      {/* Hero — ожидается в кассе */}
      <View style={[styles.heroCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
        <View style={styles.heroLabelRow}>
          <Ionicons name="cash-outline" size={14} color={colors.primary[600]} />
          <Text style={[iosSectionLabel, { marginBottom: 0, color: colors.primary[600] }]}>Ожидается в кассе</Text>
        </View>
        <Text style={[styles.heroValue, { color: palette.text.primary }]}>{formatMoney(report.expectedAmount)}</Text>
        <Text style={[styles.heroSub, { color: palette.text.tertiary }]}>
          Разменная касса {formatMoney(report.openingAmount)} · выручка {formatMoney(report.totalRevenue)}
        </Text>
      </View>

      {/* Плитки Z-отчёта */}
      <View style={styles.tilesGrid}>
        <Tile
          label="Наличными"
          value={formatMoney(report.cashSales)}
          icon="cash-outline"
          tint={colors.green[600]}
          tintBg={colors.green[50]}
          palette={palette}
        />
        <Tile
          label="Картой"
          value={formatMoney(report.cardSales)}
          icon="card-outline"
          tint={colors.blue[600]}
          tintBg={colors.blue[50]}
          palette={palette}
        />
        <Tile
          label="Расходы нал"
          value={formatMoney(report.cashExpenses)}
          icon="trending-down-outline"
          tint={colors.rose[600]}
          tintBg={colors.rose[50]}
          palette={palette}
        />
        <Tile
          label="Инкассация"
          value={formatMoney(report.collectionsTotal)}
          icon="briefcase-outline"
          tint={colors.amber[600]}
          tintBg={colors.amber[50]}
          palette={palette}
        />
        <Tile
          label="Разменная касса"
          value={formatMoney(report.openingAmount)}
          icon="wallet-outline"
          tint={colors.teal[600]}
          tintBg={colors.teal[50]}
          palette={palette}
        />
        <Tile
          label="Чеков"
          value={String(report.checksCount)}
          icon="receipt-outline"
          tint={colors.slate[600]}
          tintBg={colors.slate[100]}
          palette={palette}
        />
      </View>

      {/* Инкассации этой смены */}
      {report.collections.length > 0 && (
        <View
          style={[styles.collectionsCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
        >
          <Text style={[iosSectionLabel, styles.collectionsTitle, { color: palette.text.tertiary }]}>
            Инкассации смены
          </Text>
          {report.collections.map((c: CashCollection, i) => (
            <View
              key={c.id}
              style={[
                styles.collectionRow,
                i < report.collections.length - 1 && {
                  borderBottomWidth: StyleSheet.hairlineWidth,
                  borderBottomColor: palette.border.subtle,
                },
              ]}
            >
              <View style={styles.collectionLeft}>
                <Text style={[styles.collectionAmount, { color: palette.text.primary }]}>{formatMoney(c.amount)}</Text>
                <Text style={[styles.collectionMeta, { color: palette.text.tertiary }]} numberOfLines={1}>
                  {formatDateTime(c.collectedAt, tenantTz)}
                  {c.collectedByName ? ` · ${c.collectedByName}` : ''}
                  {c.note ? ` · ${c.note}` : ''}
                </Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Действия — owner-only */}
      {isOwner && (
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.actionBtn, { backgroundColor: palette.bg.card, borderColor: colors.amber[600] }]}
            onPress={onCollect}
            activeOpacity={0.85}
          >
            <Ionicons name="briefcase-outline" size={18} color={colors.amber[600]} />
            <Text style={[styles.actionBtnText, { color: colors.amber[600] }]}>Инкассация</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnPrimary, { backgroundColor: colors.rose[600] }]}
            onPress={onClose}
            activeOpacity={0.85}
          >
            <Ionicons name="lock-closed-outline" size={18} color={colors.white} />
            <Text style={[styles.actionBtnText, { color: colors.white }]}>Закрыть смену</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────────
//  ClosedShiftView — спокойное состояние «Смена закрыта»
// ────────────────────────────────────────────────────────────────────────

interface ClosedShiftViewProps {
  isOwner: boolean;
  palette: SemanticPalette;
  onOpen: () => void;
}

function ClosedShiftView({ isOwner, palette, onOpen }: ClosedShiftViewProps) {
  return (
    <View style={[styles.closedCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
      <View style={[styles.closedIcon, { backgroundColor: palette.bg.muted }]}>
        <Ionicons name="moon-outline" size={28} color={palette.text.tertiary} />
      </View>
      <Text style={[styles.closedTitle, { color: palette.text.primary }]}>Смена закрыта</Text>
      <Text style={[styles.closedDesc, { color: palette.text.secondary }]}>
        Откройте смену, чтобы вести Z-отчёт, фиксировать инкассации и сверять кассу в конце дня.
      </Text>
      {isOwner && (
        <TouchableOpacity
          style={[styles.openBtn, { backgroundColor: colors.green[600] }]}
          onPress={onOpen}
          activeOpacity={0.85}
        >
          <Ionicons name="play-circle-outline" size={18} color={colors.white} />
          <Text style={styles.openBtnText}>Открыть смену</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────────
//  HistoryRow — закрытая смена в списке истории
// ────────────────────────────────────────────────────────────────────────

interface HistoryRowProps {
  shift: CashShift;
  showDivider: boolean;
  palette: SemanticPalette;
  onPress: () => void;
}

const HistoryRow = React.memo(function HistoryRow({ shift, showDivider, palette, onPress }: HistoryRowProps) {
  // Время смены/операций — в поясе автосервиса (см. formatDateTime).
  const tenantTz = useTenantTimezone();
  const diff = shift.difference ?? 0;
  const diffTint = diff > 0 ? colors.green[600] : diff < 0 ? colors.rose[600] : palette.text.tertiary;
  const diffLabel = diff > 0 ? 'Излишек' : diff < 0 ? 'Недостача' : 'Сходится';

  return (
    <>
      <TouchableOpacity style={styles.historyRow} onPress={onPress} activeOpacity={0.6}>
        <View style={styles.historyLeft}>
          <Text style={[styles.historyDate, { color: palette.text.primary }]}>
            {formatDateTime(shift.closedAt, tenantTz)}
          </Text>
          <Text style={[styles.historyMeta, { color: palette.text.tertiary }]} numberOfLines={1}>
            Открыта {formatDateTime(shift.openedAt, tenantTz)}
            {shift.closedByName ? ` · ${shift.closedByName}` : ''}
          </Text>
        </View>
        <View style={styles.historyRight}>
          <Text style={[styles.historyDiff, { color: diffTint }]}>
            {diff > 0 ? '+' : ''}
            {formatMoney(diff)}
          </Text>
          <Text style={[styles.historyDiffLabel, { color: palette.text.tertiary }]}>{diffLabel}</Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} style={{ marginLeft: spacing[1] }} />
      </TouchableOpacity>
      {showDivider && <View style={[styles.historyDivider, { backgroundColor: palette.border.subtle }]} />}
    </>
  );
});

// ────────────────────────────────────────────────────────────────────────
//  ReportDetail — printable-подобный Z-отчёт в модалке
// ────────────────────────────────────────────────────────────────────────

interface ReportDetailProps {
  report: CashShiftReport;
  palette: SemanticPalette;
}

function ReportDetail({ report, palette }: ReportDetailProps) {
  // Время смены/операций — в поясе автосервиса (см. formatDateTime).
  const tenantTz = useTenantTimezone();
  const closed = report.shift.status === 'closed';
  const diff = report.difference ?? 0;
  const diffTint = diff > 0 ? colors.green[600] : diff < 0 ? colors.rose[600] : palette.text.secondary;
  const diffLabel = diff > 0 ? 'Излишек' : diff < 0 ? 'Недостача' : 'Касса сходится';

  const Row = ({ label, value, tint, strong }: { label: string; value: string; tint?: string; strong?: boolean }) => (
    <View style={[styles.reportRow, { borderBottomColor: palette.border.subtle }]}>
      <Text style={[styles.reportLabel, { color: palette.text.secondary }]}>{label}</Text>
      <Text style={[styles.reportValue, { color: tint ?? palette.text.primary }, strong && styles.reportValueStrong]}>
        {value}
      </Text>
    </View>
  );

  // 155 — сейф и размен закрытой смены (null на сменах до миграции).
  const toSafe = typeof report.shift.toSafeAmount === 'number' ? report.shift.toSafeAmount : null;
  const carryover = typeof report.shift.carryoverAmount === 'number' ? report.shift.carryoverAmount : null;
  const safeParts: string[] = [];
  if (toSafe !== null) safeParts.push(`В сейф: ${formatMoney(toSafe)}`);
  if (carryover !== null) safeParts.push(`Размен: ${formatMoney(carryover)}`);

  const perAcceptor = report.perAcceptor ?? [];
  const settlements = report.settlements ?? [];

  return (
    <View>
      {/* Шапка отчёта */}
      <View style={styles.reportHeader}>
        <Text style={[styles.reportTitle, { color: palette.text.primary }]}>
          {closed ? 'Z-отчёт по смене' : 'Текущий Z-отчёт'}
        </Text>
        <Text style={[styles.reportPeriod, { color: palette.text.tertiary }]}>
          {formatDateTime(report.shift.openedAt, tenantTz)} →{' '}
          {formatDateTime(report.shift.closedAt ?? report.windowEnd, tenantTz)}
        </Text>
        {safeParts.length > 0 && (
          <Text style={[styles.reportSafeLine, { color: palette.text.secondary }]}>{safeParts.join(' · ')}</Text>
        )}
      </View>

      <Row label="Разменная касса" value={formatMoney(report.openingAmount)} />
      <Row label="Наличными (продажи)" value={formatMoney(report.cashSales)} tint={colors.green[600]} />
      <Row label="Картой (продажи)" value={formatMoney(report.cardSales)} tint={colors.blue[600]} />
      <Row label="Выручка всего" value={formatMoney(report.totalRevenue)} />
      <Row label="Расходы наличными" value={formatMoney(report.cashExpenses)} tint={colors.rose[600]} />
      <Row label="Инкассация" value={formatMoney(report.collectionsTotal)} tint={colors.amber[600]} />
      <Row label="Чеков за смену" value={String(report.checksCount)} />
      <Row label="Ожидается в кассе" value={formatMoney(report.expectedAmount)} strong />
      {closed && report.factualAmount !== null && (
        <Row label="Фактически в кассе" value={formatMoney(report.factualAmount)} strong />
      )}

      {/* 155 — разбивка выручки по принявшим оплату */}
      {perAcceptor.length > 0 && (
        <View>
          <Text style={[iosSectionLabel, styles.reportSectionLabel, { color: palette.text.tertiary }]}>
            По сотрудникам
          </Text>
          {perAcceptor.map((a) => (
            <Row
              key={acceptorKey(a.userId)}
              label={a.name ?? (a.userId === null ? 'Не распределено' : 'Сотрудник')}
              value={`нал ${formatMoney(a.cashSales)} · карта ${formatMoney(a.cardSales)} · чеков ${a.checksCount}`}
            />
          ))}
        </View>
      )}

      {/* 155 — фактическая сдача по сотрудникам при закрытии */}
      {settlements.length > 0 && (
        <View>
          <Text style={[iosSectionLabel, styles.reportSectionLabel, { color: palette.text.tertiary }]}>Сдано</Text>
          {settlements.map((s) => {
            const d = s.actualAmount - s.expectedAmount;
            const dText = d === 0 ? 'сходится' : `${d > 0 ? '+' : ''}${formatMoney(d)}`;
            return (
              <Row
                key={acceptorKey(s.userId)}
                label={s.name ?? (s.userId === null ? 'Не распределено' : 'Сотрудник')}
                value={`расчётно ${formatMoney(s.expectedAmount)} · сдано ${formatMoney(s.actualAmount)} · ${dText}`}
                tint={d === 0 ? undefined : d > 0 ? colors.green[600] : colors.rose[600]}
              />
            );
          })}
        </View>
      )}

      {/* Расхождение */}
      {closed && report.difference !== null ? (
        <View
          style={[
            styles.diffBanner,
            {
              backgroundColor:
                diff === 0
                  ? palette.bg.muted
                  : diff > 0
                    ? getBadgeColors(palette.mode).green.bg
                    : getBadgeColors(palette.mode).red.bg,
            },
          ]}
        >
          <Text style={[styles.diffBannerLabel, { color: diffTint }]}>{diffLabel}</Text>
          <Text style={[styles.diffBannerValue, { color: diffTint }]}>
            {diff > 0 ? '+' : ''}
            {formatMoney(diff)}
          </Text>
        </View>
      ) : (
        <View style={[styles.diffBanner, { backgroundColor: palette.bg.muted }]}>
          <Text style={[styles.diffBannerLabel, { color: palette.text.secondary }]}>Смена ещё открыта</Text>
          <Text style={[styles.diffBannerValue, { color: palette.text.tertiary }]}>расхождение при закрытии</Text>
        </View>
      )}

      {report.shift.note ? (
        <Text style={[styles.reportNote, { color: palette.text.tertiary }]}>Комментарий: {report.shift.note}</Text>
      ) : null}
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────────
//  Styles
// ────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1 },
  loadingWrap: { paddingHorizontal: spacing[4], paddingTop: spacing[2] },
  pointChipRow: { marginHorizontal: spacing[4], marginBottom: spacing[2], alignSelf: 'flex-start' },
  scrollContent: { paddingHorizontal: spacing[4], paddingTop: spacing[2], gap: spacing[3] },

  // Status
  statusCard: { ...iosCard },
  statusTopRow: { flexDirection: 'row', alignItems: 'center' },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing[2.5],
    paddingVertical: 4,
    borderRadius: borderRadius.full,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusBadgeText: { fontSize: 12, fontWeight: '700' },
  statusMeta: { fontSize: 12, marginTop: spacing[2] },

  // Hero
  heroCard: { ...iosCard },
  heroLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing[1] },
  heroValue: { fontSize: 32, fontWeight: '800', letterSpacing: -0.6 },
  heroSub: { fontSize: 12, marginTop: spacing[1] },

  // Tiles
  tilesGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2.5] },
  tile: {
    flexGrow: 1,
    flexBasis: '47%',
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
  },
  tileHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing[2] },
  tileIcon: { width: 24, height: 24, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { fontSize: 12, fontWeight: '500', flexShrink: 1 },
  tileValue: { fontSize: 18, fontWeight: '700', letterSpacing: -0.3 },

  // Collections
  collectionsCard: { ...iosCard, paddingVertical: spacing[2] },
  collectionsTitle: { marginTop: spacing[1], marginBottom: spacing[1] },
  collectionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing[2.5] },
  collectionLeft: { flex: 1, gap: 2 },
  collectionAmount: { fontSize: 15, fontWeight: '700' },
  collectionMeta: { fontSize: 11 },

  // Actions
  actionsRow: { flexDirection: 'row', gap: spacing[2.5], marginTop: spacing[1] },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.xl,
    borderWidth: 1.5,
    paddingVertical: spacing[3.5],
    minHeight: 52,
  },
  actionBtnPrimary: { borderWidth: 0 },
  actionBtnText: { fontSize: 15, fontWeight: '700' },

  // Closed state
  closedCard: { ...iosCard, alignItems: 'center', paddingVertical: spacing[6] },
  closedIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[3],
  },
  closedTitle: { fontSize: 18, fontWeight: '700', letterSpacing: -0.3 },
  closedDesc: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: spacing[2],
    lineHeight: 19,
    paddingHorizontal: spacing[2],
  },
  openBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[3.5],
    paddingHorizontal: spacing[6],
    marginTop: spacing[4],
    minHeight: 52,
  },
  openBtnText: { fontSize: 15, fontWeight: '700', color: colors.white },

  // History
  historyLabel: { marginLeft: spacing[1], marginTop: spacing[2] },
  emptyHistory: {
    ...iosCard,
    alignItems: 'center',
    paddingVertical: spacing[5],
  },
  emptyHistoryText: { fontSize: 13 },
  historyCard: {
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    ...(Platform.OS === 'android' ? { elevation: 1 } : null),
  },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    minHeight: 60,
  },
  historyLeft: { flex: 1, gap: 2 },
  historyDate: { fontSize: 14, fontWeight: '600' },
  historyMeta: { fontSize: 11 },
  historyRight: { alignItems: 'flex-end', gap: 1 },
  historyDiff: { fontSize: 14, fontWeight: '700' },
  historyDiffLabel: { fontSize: 10 },
  historyDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: spacing[4],
  },

  // Input modal
  formLabel: { fontSize: 13, fontWeight: '600', marginBottom: spacing[2] },
  amountWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3],
  },
  amountCurrency: { fontSize: 18, fontWeight: '600', marginRight: spacing[2] },
  amountInput: { flex: 1, fontSize: 22, fontWeight: '700', paddingVertical: spacing[3] },
  noteInput: {
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    fontSize: 14,
    minHeight: 64,
    textAlignVertical: 'top',
  },
  hint: { fontSize: 12, lineHeight: 17, marginTop: spacing[3] },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[3.5],
    marginTop: spacing[5],
    minHeight: 52,
  },
  submitBtnText: { fontSize: 16, fontWeight: '700', color: colors.white },

  // Report detail
  reportHeader: { marginBottom: spacing[3] },
  reportTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  reportPeriod: { fontSize: 12, marginTop: 2 },
  reportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[2.5],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  reportLabel: { fontSize: 14 },
  reportValue: { fontSize: 14, fontWeight: '600', flexShrink: 1, textAlign: 'right', marginLeft: spacing[2] },
  reportValueStrong: { fontSize: 16, fontWeight: '800' },
  diffBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3.5],
    marginTop: spacing[4],
  },
  diffBannerLabel: { fontSize: 14, fontWeight: '700' },
  diffBannerValue: { fontSize: 18, fontWeight: '800' },
  reportNote: { fontSize: 12, marginTop: spacing[3], lineHeight: 17 },
  reportSafeLine: { fontSize: 12, fontWeight: '600', marginTop: 4 },
  reportSectionLabel: { marginTop: spacing[4], marginBottom: spacing[1] },

  // 155 — сдача по сотрудникам в модале закрытия
  settlementCard: {
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3],
  },
  settlementRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    paddingVertical: spacing[2.5],
  },
  settlementLeft: { flex: 1, minWidth: 0, gap: 2 },
  settlementName: { fontSize: 14, fontWeight: '600' },
  settlementExpected: { fontSize: 11 },
  settlementInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[2.5],
    minWidth: 104,
  },
  settlementInput: { flex: 1, fontSize: 16, fontWeight: '700', paddingVertical: spacing[2], textAlign: 'right' },
  settlementCurrency: { fontSize: 14, fontWeight: '600', marginLeft: spacing[1] },
  settlementTotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[2.5],
    paddingHorizontal: spacing[1],
  },
  settlementTotalLabel: { fontSize: 14, fontWeight: '700' },
  settlementTotalValue: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },

  // 155 — «Перевести в сейф» в модале закрытия
  toSafeLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing[4],
    marginBottom: spacing[2],
  },
  toSafeAllBtn: { fontSize: 13, fontWeight: '700' },

  // 155 — карточка сейфа
  safeCard: { ...iosCard, paddingVertical: spacing[3] },
  safeCardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  safeIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  safeLabel: { fontSize: 12, fontWeight: '500' },
  safeValue: { fontSize: 20, fontWeight: '800', letterSpacing: -0.4 },
  safeCollectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.xl,
    borderWidth: 1.5,
    paddingVertical: spacing[2.5],
    marginTop: spacing[3],
    minHeight: 44,
  },
  safeCollectBtnText: { fontSize: 14, fontWeight: '700' },

  // 155 — история операций сейфа
  safeEmptyText: { fontSize: 13, textAlign: 'center', paddingVertical: spacing[4] },
  safeTxRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2.5], paddingVertical: spacing[2.5] },
  safeTxType: { fontSize: 14, fontWeight: '600' },
  safeTxMeta: { fontSize: 11 },
  safeTxAmount: { fontSize: 15, fontWeight: '700' },
});
