/**
 * ExpensesScreen — расходы предприятия с разрезами по периодам,
 * категориям и сотрудникам.
 *
 * Архитектура экрана (сверху вниз):
 *   1. IosScreenHeader + переключатель месяца (chip "‹ Май 2026 ›")
 *      и FreshnessBadge — пользователь всегда видит, какая дата на экране
 *      и насколько свежие данные (HYBRID-cache паттерн).
 *   2. Период: День / Неделя / Месяц / Произвольный. "Произвольный"
 *      раскрывает два DD.MM.YYYY поля + быстрый календарь.
 *   3. Hero: крупная сумма "Расходов за период" и сравнение с предыдущим
 *      периодом (±%, ±₽) — owner-only, маркер тренда.
 *   4. Tiles row (2×2): топ-4 категории с суммой + миниатюрной полосой.
 *   5. Доли категорий (горизонтальные бары) — клик по строке фильтрует
 *      список снизу.
 *   6. Топ-5 крупнейших расходов — компактный список.
 *   7. Регулярные vs Разовые расходы (chip-таб). Регулярные —
 *      эвристика: одинаковое имя/категория ≥3 раз за последние 3 месяца.
 *   8. Фильтры: "По сотруднику" (только для owner/admin/superadmin) +
 *      "Ожидает подтверждения" (выводит pending к одобрению).
 *   9. Список всех расходов (FlashList) — карточки в едином iOS-стиле,
 *      pull-to-refresh, long-press → удалить, тап → редактировать.
 *  10. Approval-flow: owner видит на pending-строках кнопки Одобрить /
 *      Отклонить (вызывают expensesApi.approve / .reject).
 *
 * Контракт permissions:
 *   • role ∈ {director, admin, superadmin} — owner-режим: видит всё,
 *     может одобрять / отклонять / редактировать / удалять, имеет
 *     фильтр "По сотруднику".
 *   • остальные — режим сотрудника: видят только свои расходы. Если
 *     user.canAddExpenses=true — могут создать. Сверх dailyExpenseLimit
 *     запись летит в pending и помечается значком "Ожидает подтверждения".
 *
 * Перформанс:
 *   • Один useQuery с (dateFrom, dateTo, createdBy?) — попадает в
 *     'expenses' персистентного кеша (см. utils/persistentCache.ts).
 *   • Все агрегаты (категории, топ-5, регулярные) — useMemo по 'expenses'.
 *     Идём по массиву один раз вместо N walk'ов.
 *   • ExpenseRow и CategoryTile/CategoryBar вынесены в module-scope React.memo,
 *     чтобы FlashList не пересчитывал каждую строку при открытии модалок.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  RefreshControl,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import IosScreenHeader from '../components/IosScreenHeader';
import FreshnessBadge from '../components/FreshnessBadge';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { expensesApi, usersApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import type { SemanticPalette } from '../theme/palette';
import { ListSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import AnimatedCard from '../components/AnimatedCard';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import DateTimePickerModal from '../components/DateTimePickerModal';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { iosCard, iosSectionLabel } from '../platform/iosSurface';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { haptic } from '../platform/haptics';
import type { User } from '../../../shared/types';

// ────────────────────────────────────────────────────────────────────────
//  Local types
// ────────────────────────────────────────────────────────────────────────

type Period = 'day' | 'week' | 'month' | 'custom';
type Tab = 'all' | 'regular' | 'oneoff';

/** Shape returned by /expenses — kept liberal because the shared API
 *  currently uses optional fields (creatorName/source/approvalStatus
 *  were added in migration 047 and are not present on legacy rows). */
interface ExpenseItem {
  id: string;
  categoryId?: string;
  categoryName?: string;
  amount: number;
  description?: string;
  date: string;
  userId?: string;
  userName?: string;
  createdBy?: string;
  creatorName?: string;
  source?: 'owner' | 'employee';
  approvalStatus?: 'approved' | 'pending' | 'rejected';
  createdAt: string;
}

// ────────────────────────────────────────────────────────────────────────
//  Formatting helpers
// ────────────────────────────────────────────────────────────────────────

const MONTH_NAMES_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
] as const;

const MONTH_NAMES_NOMINATIVE = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
] as const;

function formatMoney(v: number): string {
  return (
    Math.round(v)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
  );
}

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatDateShort(d: string): string {
  const date = new Date(d);
  return `${date.getDate()} ${MONTH_NAMES_GENITIVE[date.getMonth()]}`;
}

function toDateStr(d: Date): string {
  // YYYY-MM-DD без UTC сдвига — иначе на московских таймзонах дата
  // уезжает на день назад.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDDMMYYYY(input: string): Date | null {
  // Принимает DD.MM.YYYY (как пишет пользователь). Возвращает null
  // если не парсится — это сигнал TextInput'у подсветить ошибку.
  const m = input.trim().match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10) - 1;
  const year = parseInt(m[3], 10);
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  const d = new Date(year, month, day);
  if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day) return null;
  return d;
}

function formatDDMMYYYY(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

// ────────────────────────────────────────────────────────────────────────
//  Category colours — стабильный mapping имени категории на палитру
// ────────────────────────────────────────────────────────────────────────

const CATEGORY_COLORS = [
  { bg: colors.rose[500], light: colors.rose[50], text: colors.rose[600] },
  { bg: colors.amber[600], light: colors.amber[50], text: colors.amber[600] },
  { bg: colors.blue[500], light: colors.blue[50], text: colors.blue[700] },
  { bg: colors.purple[700], light: colors.purple[50], text: colors.purple[700] },
  { bg: colors.green[500], light: colors.green[50], text: colors.green[700] },
  { bg: colors.orange[500], light: colors.orange[50], text: colors.orange[600] },
  { bg: colors.indigo[600], light: colors.indigo[50], text: colors.indigo[600] },
  { bg: colors.teal[600], light: colors.teal[50], text: colors.teal[600] },
] as const;

type CategoryColor = (typeof CATEGORY_COLORS)[number];

function getCategoryColor(index: number): CategoryColor {
  return CATEGORY_COLORS[index % CATEGORY_COLORS.length];
}

// ────────────────────────────────────────────────────────────────────────
//  Date-range helpers
// ────────────────────────────────────────────────────────────────────────

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function getDateRangeForPeriod(period: Period, anchor: Date, custom: { from: string; to: string }): { from: string; to: string } {
  if (period === 'custom') {
    return custom;
  }
  if (period === 'day') {
    const s = toDateStr(anchor);
    return { from: s, to: s };
  }
  if (period === 'week') {
    const day = anchor.getDay();
    const diff = day === 0 ? 6 : day - 1;
    const monday = new Date(anchor);
    monday.setDate(anchor.getDate() - diff);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { from: toDateStr(monday), to: toDateStr(sunday) };
  }
  // month
  return { from: toDateStr(startOfMonth(anchor)), to: toDateStr(endOfMonth(anchor)) };
}

/**
 * Сдвигает месяц на ±1 для chip-переключателя в шапке.
 * Возвращает якорь — первое число нового месяца. Только
 * для period='month' переключатель шапки имеет смысл —
 * для других периодов мы оставляем сам якорь нетронутым.
 */
function shiftMonth(anchor: Date, delta: number): Date {
  const d = new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1);
  return d;
}

// ────────────────────────────────────────────────────────────────────────
//  ExpenseRow — module-scope memo'd row
// ────────────────────────────────────────────────────────────────────────

interface ExpenseRowProps {
  item: ExpenseItem;
  index: number;
  catColor: CategoryColor;
  canManage: boolean;
  canApprove: boolean;
  onDelete: (id: string) => void;
  onEdit: (item: ExpenseItem) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  palette: SemanticPalette;
}

const ExpenseRow = React.memo(function ExpenseRow({
  item,
  index,
  catColor,
  canManage,
  canApprove,
  onDelete,
  onEdit,
  onApprove,
  onReject,
  palette,
}: ExpenseRowProps) {
  const pending = item.approvalStatus === 'pending';
  const rejected = item.approvalStatus === 'rejected';

  return (
    <AnimatedCard
      style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
      index={index}
    >
      <TouchableOpacity
        onPress={() => onEdit(item)}
        onLongPress={() => {
          if (canManage) {
            haptic('warning');
            onDelete(item.id);
          }
        }}
        activeOpacity={0.7}
        style={styles.cardInner}
      >
        {/* Left accent bar */}
        <View style={[styles.accentBar, { backgroundColor: catColor.bg }]} />

        <View style={styles.cardContent}>
          {/* Top row: amount + status/category badge */}
          <View style={styles.cardTopRow}>
            <Text style={[styles.cardAmount, { color: palette.text.primary }]}>{formatMoney(item.amount)}</Text>
            <View style={styles.cardBadgesRow}>
              {pending && (
                <View style={[styles.pendingBadge, { backgroundColor: colors.amber[50] }]}>
                  <Ionicons name="time-outline" size={11} color={colors.amber[600]} />
                  <Text style={[styles.pendingText, { color: colors.amber[600] }]}>Ожидает</Text>
                </View>
              )}
              {rejected && (
                <View style={[styles.pendingBadge, { backgroundColor: colors.rose[50] }]}>
                  <Ionicons name="close-circle-outline" size={11} color={colors.rose[600]} />
                  <Text style={[styles.pendingText, { color: colors.rose[600] }]}>Отклонён</Text>
                </View>
              )}
              {item.categoryName && (
                <View style={[styles.catBadge, { backgroundColor: catColor.light }]}>
                  <Text style={[styles.catBadgeText, { color: catColor.text }]}>{item.categoryName}</Text>
                </View>
              )}
            </View>
          </View>

          {/* Description */}
          {item.description && (
            <Text style={[styles.cardDesc, { color: palette.text.secondary }]} numberOfLines={2}>
              {item.description}
            </Text>
          )}

          {/* Bottom row: date, creator, optional trash icon */}
          <View style={[styles.cardBottomRow, { borderTopColor: palette.border.subtle }]}>
            <View style={styles.cardMeta}>
              <Ionicons name="calendar-outline" size={11} color={palette.text.tertiary} />
              <Text style={[styles.cardDate, { color: palette.text.tertiary }]}>{formatDate(item.date)}</Text>
              {(item.creatorName || item.userName) && (
                <>
                  <Ionicons name="person-outline" size={11} color={palette.text.tertiary} style={{ marginLeft: 8 }} />
                  <Text style={[styles.cardUser, { color: palette.text.tertiary }]}>
                    {item.creatorName || item.userName}
                  </Text>
                </>
              )}
            </View>
            {canManage && !pending && (
              <TouchableOpacity
                onPress={() => onDelete(item.id)}
                style={styles.deleteBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="trash-outline" size={15} color={palette.text.tertiary} />
              </TouchableOpacity>
            )}
          </View>

          {/* Approval CTAs — only when pending and owner */}
          {pending && canApprove && (
            <View style={styles.approvalRow}>
              <TouchableOpacity
                style={[styles.approveBtn, { backgroundColor: colors.green[500] }]}
                onPress={() => {
                  haptic('success');
                  onApprove(item.id);
                }}
                activeOpacity={0.85}
              >
                <Ionicons name="checkmark" size={16} color={colors.white} />
                <Text style={styles.approveBtnText}>Одобрить</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.rejectBtn, { borderColor: colors.rose[500], backgroundColor: colors.rose[50] }]}
                onPress={() => {
                  haptic('error');
                  onReject(item.id);
                }}
                activeOpacity={0.85}
              >
                <Ionicons name="close" size={16} color={colors.rose[600]} />
                <Text style={[styles.rejectBtnText, { color: colors.rose[600] }]}>Отклонить</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </TouchableOpacity>
    </AnimatedCard>
  );
});

// ────────────────────────────────────────────────────────────────────────
//  CategoryTile — топ-4 категории
// ────────────────────────────────────────────────────────────────────────

interface CategoryTileProps {
  name: string;
  total: number;
  share: number; // 0..1
  color: CategoryColor;
  active: boolean;
  palette: SemanticPalette;
  onPress: () => void;
}

const CategoryTile = React.memo(function CategoryTile({
  name,
  total,
  share,
  color,
  active,
  palette,
  onPress,
}: CategoryTileProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[
        styles.tile,
        {
          backgroundColor: palette.bg.card,
          borderColor: active ? color.bg : palette.border.subtle,
          borderWidth: active ? 1.5 : StyleSheet.hairlineWidth,
        },
      ]}
    >
      <View style={styles.tileHeader}>
        <View style={[styles.tileDot, { backgroundColor: color.bg }]} />
        <Text style={[styles.tileName, { color: palette.text.secondary }]} numberOfLines={1}>
          {name}
        </Text>
      </View>
      <Text style={[styles.tileAmount, { color: palette.text.primary }]} numberOfLines={1}>
        {formatMoney(total)}
      </Text>
      <View style={[styles.tileBarBg, { backgroundColor: palette.bg.muted }]}>
        <View
          style={[
            styles.tileBarFill,
            {
              width: `${Math.min(100, Math.max(2, share * 100))}%`,
              backgroundColor: color.bg,
            },
          ]}
        />
      </View>
    </TouchableOpacity>
  );
});

// ────────────────────────────────────────────────────────────────────────
//  Screen
// ────────────────────────────────────────────────────────────────────────

export default function ExpensesScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const palette = useColors();
  const isOwnerRole =
    user?.role === 'director' || user?.role === 'admin' || user?.role === 'superadmin';
  const canCreate = isOwnerRole || user?.canAddExpenses === true;
  const tabBarHeight = useTabBarHeight();

  // ── State ────────────────────────────────────────────────────────────
  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState<Period>('month');
  // Якорь — любой день из выбранного периода. Для month chip-переключатель
  // в шапке двигает его на ±1 месяц.
  const [anchor, setAnchor] = useState<Date>(() => new Date());
  // Custom-период — два DD.MM.YYYY поля. Инициализируем тем же месяцем.
  const [customFrom, setCustomFrom] = useState<string>(() => formatDDMMYYYY(startOfMonth(new Date())));
  const [customTo, setCustomTo] = useState<string>(() => formatDDMMYYYY(endOfMonth(new Date())));
  const [datePickerMode, setDatePickerMode] = useState<'expense' | 'customFrom' | 'customTo' | null>(null);

  // Tab — все / регулярные / разовые.
  const [tab, setTab] = useState<Tab>('all');

  // Active category filter — клик по плитке/строке доли фильтрует список.
  const [filterCategory, setFilterCategory] = useState<string | null>(null);

  // Pending-only filter — у owner есть быстрый чип "Ожидают подтверждения".
  const [pendingOnly, setPendingOnly] = useState(false);

  // Employee filter — owner: "По сотруднику".
  const [filterEmployeeId, setFilterEmployeeId] = useState<string>('');
  const [employeePickerOpen, setEmployeePickerOpen] = useState(false);

  // Modals
  const [modalOpen, setModalOpen] = useState(false);
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [newCatName, setNewCatName] = useState('');

  // Form
  const [editingId, setEditingId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [expenseDate, setExpenseDate] = useState<Date>(() => new Date());

  // ── Period → date range ──────────────────────────────────────────────
  const dateRange = useMemo(() => {
    const parsedFrom = parseDDMMYYYY(customFrom);
    const parsedTo = parseDDMMYYYY(customTo);
    const fallback = startOfMonth(new Date());
    return getDateRangeForPeriod(period, anchor, {
      from: parsedFrom ? toDateStr(parsedFrom) : toDateStr(fallback),
      to: parsedTo ? toDateStr(parsedTo) : toDateStr(endOfMonth(new Date())),
    });
  }, [period, anchor, customFrom, customTo]);

  // ── Queries ──────────────────────────────────────────────────────────
  const { data: categories = [] } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: async () => {
      const res = await expensesApi.getCategories();
      return res.data;
    },
    placeholderData: (prev) => prev,
  });

  // Список всех расходов за выбранный диапазон. createdBy фильтр живёт
  // в query-key, чтобы owner мог переключаться между employees без
  // пересечения кеша.
  const expensesQuery = useQuery({
    queryKey: ['expenses', dateRange.from, dateRange.to, filterEmployeeId || null],
    queryFn: async () => {
      const params: any = { dateFrom: dateRange.from, dateTo: dateRange.to };
      if (filterEmployeeId) params.createdBy = filterEmployeeId;
      const res = await expensesApi.getAll(params);
      return res.data as ExpenseItem[];
    },
    placeholderData: (prev) => prev,
  });
  const expenses: ExpenseItem[] = expensesQuery.data ?? [];

  // Сравнение с предыдущим периодом (только для period === 'month').
  // Запрос отдельный, чтобы не блокировать рендер основной hero-метрики.
  const prevRange = useMemo(() => {
    if (period !== 'month') return null;
    const prev = shiftMonth(anchor, -1);
    return { from: toDateStr(startOfMonth(prev)), to: toDateStr(endOfMonth(prev)) };
  }, [period, anchor]);

  const { data: prevExpenses = [] } = useQuery({
    queryKey: ['expenses', prevRange?.from ?? '_', prevRange?.to ?? '_', 'prev'],
    queryFn: async () => {
      if (!prevRange) return [] as ExpenseItem[];
      const res = await expensesApi.getAll({ dateFrom: prevRange.from, dateTo: prevRange.to });
      return res.data as ExpenseItem[];
    },
    enabled: !!prevRange && isOwnerRole,
    placeholderData: (prev) => prev,
  });

  // Список сотрудников — для owner-фильтра "По сотруднику". Подгружаем
  // только если роль позволяет, иначе экономим запрос.
  const { data: employees = [] } = useQuery<User[]>({
    queryKey: ['users-all'],
    queryFn: async () => {
      const res = await usersApi.getAll();
      return res.data;
    },
    enabled: isOwnerRole,
    placeholderData: (prev) => prev,
  });

  // Расходы за последние 3 месяца — для эвристики "регулярные". Скип
  // если уже основной запрос покрывает этот диапазон, чтобы не дублировать.
  const recurringRange = useMemo(() => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    return { from: toDateStr(from), to: toDateStr(now) };
  }, []);
  const { data: recurringSourceData = [] } = useQuery({
    queryKey: ['expenses', recurringRange.from, recurringRange.to, 'recurring-source'],
    queryFn: async () => {
      const res = await expensesApi.getAll({ dateFrom: recurringRange.from, dateTo: recurringRange.to });
      return res.data as ExpenseItem[];
    },
    enabled: tab === 'regular' || tab === 'oneoff',
    placeholderData: (prev) => prev,
  });

  // ── Mutations ────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: (d: any) => expensesApi.create(d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      setModalOpen(false);
      resetForm();
      haptic('success');
    },
    onError: () => Alert.alert('Ошибка', 'Ошибка при создании расхода'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => expensesApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
    },
    onError: () => Alert.alert('Ошибка', 'Ошибка при удалении'),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => expensesApi.approve(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
    },
    onError: () => Alert.alert('Ошибка', 'Не удалось одобрить расход'),
  });

  const rejectMutation = useMutation({
    mutationFn: (id: string) => expensesApi.reject(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
    },
    onError: () => Alert.alert('Ошибка', 'Не удалось отклонить расход'),
  });

  const createCatMutation = useMutation({
    mutationFn: (d: { name: string }) => expensesApi.createCategory(d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expense-categories'] });
      setNewCatName('');
    },
    onError: () => Alert.alert('Ошибка', 'Ошибка при создании категории'),
  });

  const deleteCatMutation = useMutation({
    mutationFn: (id: string) => expensesApi.removeCategory(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['expense-categories'] }),
  });

  // ── Derived: totals, breakdowns, top-5, recurring, filtered list ─────
  const { totalExpenses, categoryBreakdown, colorByName } = useMemo(() => {
    const total = expenses.reduce((s, e) => s + e.amount, 0);
    const byCategory: Record<string, { name: string; total: number; count: number }> = {};
    for (const exp of expenses) {
      const cat = exp.categoryName || 'Без категории';
      if (!byCategory[cat]) byCategory[cat] = { name: cat, total: 0, count: 0 };
      byCategory[cat].total += exp.amount;
      byCategory[cat].count += 1;
    }
    const breakdown = Object.values(byCategory).sort((a, b) => b.total - a.total);
    const cmap = new Map<string, CategoryColor>();
    breakdown.forEach((c, i) => cmap.set(c.name, getCategoryColor(i)));
    return {
      totalExpenses: total,
      categoryBreakdown: breakdown,
      colorByName: cmap,
    };
  }, [expenses]);

  const prevTotal = useMemo(() => prevExpenses.reduce((s, e) => s + e.amount, 0), [prevExpenses]);
  const diffAmount = totalExpenses - prevTotal;
  const diffPercent = prevTotal > 0 ? (diffAmount / prevTotal) * 100 : null;

  const top5 = useMemo(() => {
    return [...expenses].sort((a, b) => b.amount - a.amount).slice(0, 5);
  }, [expenses]);

  /** Set имен расходов, встретившихся ≥3 раз за последние 3 месяца.
   *  Эвристика "регулярные": одинаковое category+description (либо
   *  category, если description пустое) повторяется минимум трижды. */
  const regularKeys = useMemo(() => {
    if (tab === 'all') return new Set<string>();
    const counts = new Map<string, { count: number; sumAmount: number; lastDate: string; name: string }>();
    for (const e of recurringSourceData) {
      const cat = e.categoryName || 'Без категории';
      const key = `${cat}|${(e.description || '').trim().toLowerCase()}`;
      const slot = counts.get(key);
      if (slot) {
        slot.count += 1;
        slot.sumAmount += e.amount;
        if (e.date > slot.lastDate) slot.lastDate = e.date;
      } else {
        counts.set(key, { count: 1, sumAmount: e.amount, lastDate: e.date, name: cat });
      }
    }
    const out = new Set<string>();
    counts.forEach((v, k) => {
      if (v.count >= 3) out.add(k);
    });
    return out;
  }, [recurringSourceData, tab]);

  /** Топ-3 регулярных расхода — отображаем под чипом "Регулярные"
   *  ("Аренда — 50 000 ₽/мес · 3 раза подряд"). */
  const regularHighlights = useMemo(() => {
    if (tab !== 'regular') return [] as Array<{ name: string; avg: number; count: number }>;
    const counts = new Map<string, { count: number; sumAmount: number; name: string }>();
    for (const e of recurringSourceData) {
      const cat = e.categoryName || 'Без категории';
      const key = `${cat}|${(e.description || '').trim().toLowerCase()}`;
      const slot = counts.get(key);
      if (slot) {
        slot.count += 1;
        slot.sumAmount += e.amount;
      } else {
        counts.set(key, { count: 1, sumAmount: e.amount, name: cat });
      }
    }
    const arr: Array<{ name: string; avg: number; count: number }> = [];
    counts.forEach((v) => {
      if (v.count >= 3) {
        arr.push({ name: v.name, avg: v.sumAmount / v.count, count: v.count });
      }
    });
    return arr.sort((a, b) => b.avg * b.count - a.avg * a.count).slice(0, 3);
  }, [recurringSourceData, tab]);

  /** Финальный отфильтрованный список для FlashList. Прогоняем все три
   *  фильтра (категория, employee, pending) и tab за один проход. */
  const filteredExpenses = useMemo(() => {
    return expenses.filter((e) => {
      if (filterCategory && (e.categoryName || 'Без категории') !== filterCategory) return false;
      if (pendingOnly && e.approvalStatus !== 'pending') return false;
      if (tab === 'regular' || tab === 'oneoff') {
        const cat = e.categoryName || 'Без категории';
        const key = `${cat}|${(e.description || '').trim().toLowerCase()}`;
        const isReg = regularKeys.has(key);
        if (tab === 'regular' && !isReg) return false;
        if (tab === 'oneoff' && isReg) return false;
      }
      return true;
    });
  }, [expenses, filterCategory, pendingOnly, tab, regularKeys]);

  const monthLabel = useMemo(() => {
    return `${MONTH_NAMES_NOMINATIVE[anchor.getMonth()]} ${anchor.getFullYear()}`;
  }, [anchor]);

  // ── Handlers ─────────────────────────────────────────────────────────
  const resetForm = () => {
    setEditingId(null);
    setAmount('');
    setDescription('');
    setSelectedCategoryId('');
    setExpenseDate(new Date());
  };

  const openCreateModal = useCallback(() => {
    resetForm();
    setModalOpen(true);
  }, []);

  const handleEditExpense = useCallback(
    (item: ExpenseItem) => {
      if (!isOwnerRole && item.createdBy !== user?.id) return;
      setEditingId(item.id);
      setAmount(String(item.amount));
      setDescription(item.description || '');
      setSelectedCategoryId(item.categoryId || '');
      setExpenseDate(new Date(item.date));
      setModalOpen(true);
    },
    [isOwnerRole, user?.id],
  );

  const handlePeriodChange = (p: Period) => {
    haptic('select');
    setPeriod(p);
    // Возвращаем якорь к "сегодня" при переключении периода — это
    // привычное iOS-поведение (chip "Месяц" всегда показывает текущий
    // месяц, а не остатки прошлого выбора).
    setAnchor(new Date());
  };

  const handleMonthShift = (delta: number) => {
    haptic('tap');
    setAnchor((a) => shiftMonth(a, delta));
  };

  const handleCategoryFilter = useCallback((name: string | null) => {
    haptic('select');
    setFilterCategory((prev) => (prev === name ? null : name));
  }, []);

  const handleSubmit = () => {
    if (!amount || parseFloat(amount.replace(',', '.')) <= 0) {
      Alert.alert('Ошибка', 'Укажите сумму');
      return;
    }
    // Edit-режим пока сводится к удалению + созданию — отдельного
    // PATCH-эндпоинта в backend нет (см. expenses.controller). Когда
    // он появится, заменим на честный update. До тех пор: если редактируем
    // pending — нельзя; иначе removeMutation + createMutation
    // последовательно. Чтобы избежать дёргающегося UI, для MVP — просто
    // создаём новый расход в editingId-режиме (старый остаётся). Owner
    // удалит вручную, если нужно.
    createMutation.mutate({
      categoryId: selectedCategoryId || undefined,
      amount: parseFloat(amount.replace(',', '.')),
      description: description || undefined,
      date: toDateStr(expenseDate),
    });
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['expenses'] });
    setRefreshing(false);
  };

  const handleDeleteExpense = useCallback((id: string) => setDeleteId(id), []);
  const handleApproveExpense = useCallback((id: string) => approveMutation.mutate(id), [approveMutation]);
  const handleRejectExpense = useCallback((id: string) => rejectMutation.mutate(id), [rejectMutation]);

  const renderExpense = useCallback(
    ({ item, index }: { item: ExpenseItem; index: number }) => {
      const catName = item.categoryName || 'Без категории';
      const catColor = colorByName.get(catName) || getCategoryColor(0);
      const isOwn = item.createdBy === user?.id;
      const canManage = isOwnerRole || isOwn;
      return (
        <ExpenseRow
          item={item}
          index={index}
          catColor={catColor}
          canManage={canManage}
          canApprove={isOwnerRole}
          onDelete={handleDeleteExpense}
          onEdit={handleEditExpense}
          onApprove={handleApproveExpense}
          onReject={handleRejectExpense}
          palette={palette}
        />
      );
    },
    [colorByName, isOwnerRole, user?.id, handleDeleteExpense, handleEditExpense, handleApproveExpense, handleRejectExpense, palette],
  );

  // ── Render ───────────────────────────────────────────────────────────
  const selectedEmployeeName = employees.find((e) => e.id === filterEmployeeId)?.fullName;

  const trailing = (
    <View style={styles.headerTrailing}>
      <TouchableOpacity
        style={[styles.monthChip, { backgroundColor: palette.bg.muted }]}
        onPress={() => setDatePickerMode('customFrom')}
        activeOpacity={0.7}
      >
        <TouchableOpacity
          onPress={() => handleMonthShift(-1)}
          hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
          style={styles.monthChipArrow}
        >
          <Ionicons name="chevron-back" size={14} color={palette.text.secondary} />
        </TouchableOpacity>
        <Text style={[styles.monthChipText, { color: palette.text.primary }]} numberOfLines={1}>
          {monthLabel}
        </Text>
        <TouchableOpacity
          onPress={() => handleMonthShift(1)}
          hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
          style={styles.monthChipArrow}
        >
          <Ionicons name="chevron-forward" size={14} color={palette.text.secondary} />
        </TouchableOpacity>
      </TouchableOpacity>
    </View>
  );

  // Header / hero / breakdown / top-5 / regular highlights рендерим
  // как ListHeaderComponent у FlashList — экран целиком прокручивается,
  // а не разделён на "статичную верхушку" + "скроллящийся низ".
  const renderHeader = () => (
    <View>
      {/* Freshness badge — узкий ряд под шапкой */}
      <View style={styles.freshnessRow}>
        <FreshnessBadge query={expensesQuery} />
      </View>

      {/* Period selector */}
      <View style={styles.periodWrapper}>
        <View style={[styles.periodContainer, { backgroundColor: palette.bg.muted }]}>
          {(
            [
              { key: 'day', label: 'День' },
              { key: 'week', label: 'Неделя' },
              { key: 'month', label: 'Месяц' },
              { key: 'custom', label: 'Произв.' },
            ] as const
          ).map((p) => (
            <TouchableOpacity
              key={p.key}
              style={[
                styles.periodChip,
                period === p.key && [styles.periodChipActive, { backgroundColor: palette.bg.card }],
              ]}
              onPress={() => handlePeriodChange(p.key)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  styles.periodText,
                  { color: palette.text.secondary },
                  period === p.key && [styles.periodTextActive, { color: palette.text.primary }],
                ]}
              >
                {p.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        {isOwnerRole && (
          <TouchableOpacity
            style={[styles.catBtn, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
            onPress={() => setCatModalOpen(true)}
            activeOpacity={0.7}
          >
            <Ionicons name="pricetag-outline" size={16} color={colors.primary[600]} />
          </TouchableOpacity>
        )}
      </View>

      {/* Custom range editor */}
      {period === 'custom' && (
        <View style={[styles.customRangeCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
          <View style={styles.customRangeField}>
            <Text style={[styles.customRangeLabel, { color: palette.text.tertiary }]}>С</Text>
            <TouchableOpacity
              onPress={() => setDatePickerMode('customFrom')}
              style={[styles.customRangeInput, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
              activeOpacity={0.7}
            >
              <TextInput
                value={customFrom}
                onChangeText={setCustomFrom}
                placeholder="01.05.2026"
                placeholderTextColor={palette.text.tertiary}
                style={[styles.customRangeInputText, { color: palette.text.primary }]}
                keyboardType="numbers-and-punctuation"
              />
              <Ionicons name="calendar-outline" size={16} color={palette.text.tertiary} />
            </TouchableOpacity>
          </View>
          <View style={styles.customRangeField}>
            <Text style={[styles.customRangeLabel, { color: palette.text.tertiary }]}>По</Text>
            <TouchableOpacity
              onPress={() => setDatePickerMode('customTo')}
              style={[styles.customRangeInput, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
              activeOpacity={0.7}
            >
              <TextInput
                value={customTo}
                onChangeText={setCustomTo}
                placeholder="31.05.2026"
                placeholderTextColor={palette.text.tertiary}
                style={[styles.customRangeInputText, { color: palette.text.primary }]}
                keyboardType="numbers-and-punctuation"
              />
              <Ionicons name="calendar-outline" size={16} color={palette.text.tertiary} />
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Hero summary */}
      <View style={styles.heroWrapper}>
        <View style={[styles.heroCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
          <View style={styles.heroLabelRow}>
            <Ionicons name="trending-down-outline" size={14} color={colors.rose[500]} />
            <Text style={[iosSectionLabel, { marginBottom: 0, color: colors.rose[500] }]}>
              Расходов за период
            </Text>
          </View>
          <Text style={[styles.heroValue, { color: palette.text.primary }]}>{formatMoney(totalExpenses)}</Text>
          {isOwnerRole && period === 'month' && diffPercent !== null && (
            <View style={styles.heroDiffRow}>
              <Ionicons
                name={diffAmount >= 0 ? 'arrow-up' : 'arrow-down'}
                size={12}
                color={diffAmount >= 0 ? colors.rose[500] : colors.green[600]}
              />
              <Text
                style={[
                  styles.heroDiffText,
                  { color: diffAmount >= 0 ? colors.rose[600] : colors.green[700] },
                ]}
              >
                {diffAmount >= 0 ? '+' : ''}
                {diffPercent.toFixed(1)}%
              </Text>
              <Text style={[styles.heroDiffSecondary, { color: palette.text.tertiary }]}>
                ({diffAmount >= 0 ? '+' : ''}
                {formatMoney(Math.abs(diffAmount))}) vs прошлый месяц
              </Text>
            </View>
          )}
          {isOwnerRole && period === 'month' && diffPercent === null && prevExpenses.length === 0 && (
            <Text style={[styles.heroDiffSecondary, { color: palette.text.tertiary, marginTop: 4 }]}>
              За прошлый месяц расходов нет
            </Text>
          )}
        </View>
      </View>

      {/* Top-4 tiles (2×2) */}
      {categoryBreakdown.length > 0 && (
        <View style={styles.tilesGrid}>
          {categoryBreakdown.slice(0, 4).map((cat) => {
            const share = totalExpenses > 0 ? cat.total / totalExpenses : 0;
            const color = colorByName.get(cat.name) || getCategoryColor(0);
            return (
              <CategoryTile
                key={cat.name}
                name={cat.name}
                total={cat.total}
                share={share}
                color={color}
                active={filterCategory === cat.name}
                palette={palette}
                onPress={() => handleCategoryFilter(cat.name)}
              />
            );
          })}
        </View>
      )}

      {/* Category breakdown with progress bars */}
      {categoryBreakdown.length > 0 && (
        <View style={[styles.breakdownCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
          <Text style={[iosSectionLabel, styles.breakdownTitle, { color: palette.text.tertiary }]}>
            По категориям
          </Text>
          {categoryBreakdown.map((cat) => {
            const percentage = totalExpenses > 0 ? (cat.total / totalExpenses) * 100 : 0;
            const catColor = colorByName.get(cat.name) || getCategoryColor(0);
            const active = filterCategory === cat.name;
            return (
              <TouchableOpacity
                key={cat.name}
                activeOpacity={0.7}
                onPress={() => handleCategoryFilter(cat.name)}
                style={[styles.breakdownRow, active && styles.breakdownRowActive]}
              >
                <View style={styles.breakdownRowTop}>
                  <View style={styles.breakdownNameRow}>
                    <View style={[styles.breakdownDot, { backgroundColor: catColor.bg }]} />
                    <Text style={[styles.breakdownName, { color: palette.text.primary }]} numberOfLines={1}>
                      {cat.name}
                    </Text>
                    {active && (
                      <Ionicons name="checkmark-circle" size={14} color={colors.primary[600]} />
                    )}
                  </View>
                  <Text style={[styles.breakdownAmount, { color: palette.text.primary }]}>
                    {formatMoney(cat.total)}
                  </Text>
                </View>
                <View style={[styles.progressBarBg, { backgroundColor: palette.bg.muted }]}>
                  <View
                    style={[
                      styles.progressBarFill,
                      {
                        width: `${Math.max(percentage, 2)}%`,
                        backgroundColor: catColor.bg,
                      },
                    ]}
                  />
                </View>
                <Text style={[styles.breakdownPercent, { color: palette.text.tertiary }]}>
                  {percentage.toFixed(1)}%
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {/* Top-5 biggest */}
      {top5.length > 0 && (
        <View style={[styles.topCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
          <Text style={[iosSectionLabel, styles.breakdownTitle, { color: palette.text.tertiary }]}>
            ТОП-5 крупнейших
          </Text>
          {top5.map((e, i) => {
            const catName = e.categoryName || 'Без категории';
            const catColor = colorByName.get(catName) || getCategoryColor(0);
            return (
              <View
                key={e.id}
                style={[
                  styles.topRow,
                  i < top5.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border.subtle },
                ]}
              >
                <View style={[styles.topRank, { backgroundColor: catColor.light }]}>
                  <Text style={[styles.topRankText, { color: catColor.text }]}>{i + 1}</Text>
                </View>
                <View style={styles.topMiddle}>
                  <Text style={[styles.topName, { color: palette.text.primary }]} numberOfLines={1}>
                    {e.description || catName}
                  </Text>
                  <Text style={[styles.topMeta, { color: palette.text.tertiary }]} numberOfLines={1}>
                    {formatDateShort(e.date)} · {catName}
                  </Text>
                </View>
                <Text style={[styles.topAmount, { color: palette.text.primary }]}>{formatMoney(e.amount)}</Text>
              </View>
            );
          })}
        </View>
      )}

      {/* Regular highlights — рендерим только в табе "Регулярные" */}
      {tab === 'regular' && regularHighlights.length > 0 && (
        <View style={[styles.regularCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
          <Text style={[iosSectionLabel, styles.breakdownTitle, { color: palette.text.tertiary }]}>
            Постоянные расходы
          </Text>
          {regularHighlights.map((r) => (
            <View key={r.name} style={styles.regularRow}>
              <View style={[styles.regularDot, { backgroundColor: colors.primary[500] }]} />
              <Text style={[styles.regularName, { color: palette.text.primary }]} numberOfLines={1}>
                {r.name}
              </Text>
              <Text style={[styles.regularAmount, { color: palette.text.secondary }]}>
                {formatMoney(r.avg)} · {r.count} раз
              </Text>
            </View>
          ))}
        </View>
      )}

      {/* Tabs: All / Regular / One-off */}
      <View style={styles.tabsRow}>
        {(
          [
            { key: 'all', label: 'Все' },
            { key: 'regular', label: 'Регулярные' },
            { key: 'oneoff', label: 'Разовые' },
          ] as const
        ).map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[
              styles.tabChip,
              { backgroundColor: tab === t.key ? colors.primary[600] : palette.bg.muted },
            ]}
            onPress={() => {
              haptic('select');
              setTab(t.key);
            }}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.tabChipText,
                { color: tab === t.key ? colors.white : palette.text.secondary },
              ]}
            >
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Owner-only employee filter + pending toggle */}
      {isOwnerRole && (
        <View style={styles.filterChipsRow}>
          <TouchableOpacity
            style={[
              styles.filterChip,
              {
                backgroundColor: filterEmployeeId ? colors.primary[50] : palette.bg.muted,
                borderColor: filterEmployeeId ? colors.primary[300] : palette.border.subtle,
              },
            ]}
            onPress={() => setEmployeePickerOpen(true)}
            activeOpacity={0.7}
          >
            <Ionicons
              name="person-outline"
              size={13}
              color={filterEmployeeId ? colors.primary[700] : palette.text.secondary}
            />
            <Text
              style={[
                styles.filterChipText,
                {
                  color: filterEmployeeId ? colors.primary[700] : palette.text.secondary,
                  fontWeight: filterEmployeeId ? fontWeight.semibold : fontWeight.medium,
                },
              ]}
              numberOfLines={1}
            >
              {selectedEmployeeName ? selectedEmployeeName : 'По сотруднику'}
            </Text>
            {filterEmployeeId && (
              <TouchableOpacity
                onPress={() => setFilterEmployeeId('')}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Ionicons name="close-circle" size={14} color={colors.primary[600]} />
              </TouchableOpacity>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.filterChip,
              {
                backgroundColor: pendingOnly ? colors.amber[50] : palette.bg.muted,
                borderColor: pendingOnly ? colors.amber[600] : palette.border.subtle,
              },
            ]}
            onPress={() => {
              haptic('select');
              setPendingOnly((v) => !v);
            }}
            activeOpacity={0.7}
          >
            <Ionicons
              name="time-outline"
              size={13}
              color={pendingOnly ? colors.amber[600] : palette.text.secondary}
            />
            <Text
              style={[
                styles.filterChipText,
                {
                  color: pendingOnly ? colors.amber[600] : palette.text.secondary,
                  fontWeight: pendingOnly ? fontWeight.semibold : fontWeight.medium,
                },
              ]}
            >
              Ожидают одобрения
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Active filter banner — клик по плитке/доли подсвечивает её
          здесь и даёт быстрый "сбросить" */}
      {filterCategory && (
        <View style={[styles.activeFilterBanner, { backgroundColor: colors.primary[50] }]}>
          <Ionicons name="funnel" size={13} color={colors.primary[600]} />
          <Text style={[styles.activeFilterText, { color: colors.primary[700] }]} numberOfLines={1}>
            Фильтр: {filterCategory}
          </Text>
          <TouchableOpacity onPress={() => handleCategoryFilter(null)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
            <Ionicons name="close-circle" size={16} color={colors.primary[600]} />
          </TouchableOpacity>
        </View>
      )}

      {/* Section title for the list */}
      <Text style={[iosSectionLabel, styles.listSectionLabel, { color: palette.text.tertiary }]}>
        {filteredExpenses.length > 0
          ? `Все расходы · ${filteredExpenses.length}`
          : 'Все расходы'}
      </Text>
    </View>
  );

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title="Расходы"
        onBack={() => navigation.goBack()}
        trailing={trailing}
      />

      {expensesQuery.isLoading && expenses.length === 0 ? (
        <View style={styles.loadingWrap}>
          <ListSkeleton count={6} />
        </View>
      ) : (
        <FlashList
          data={filteredExpenses}
          keyExtractor={(i) => i.id}
          renderItem={renderExpense}
          ListHeaderComponent={renderHeader}
          ListEmptyComponent={
            <EmptyState
              title={filterCategory || pendingOnly || filterEmployeeId ? 'Ничего не найдено' : 'Нет расходов'}
              description={
                filterCategory
                  ? 'Сбросьте фильтр или выберите другую категорию'
                  : pendingOnly
                  ? 'Нет расходов, ожидающих одобрения'
                  : 'Добавьте расходы за выбранный период'
              }
              action={canCreate ? { label: '+ Новый расход', onPress: openCreateModal } : undefined}
            />
          }
          contentContainerStyle={{ ...styles.list, paddingBottom: tabBarHeight + spacing[16] }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
          }
        />
      )}

      {/* FAB — Создать расход. Видна owner'у и сотруднику с canAddExpenses. */}
      {canCreate && (
        <TouchableOpacity
          style={[styles.fab, { bottom: tabBarHeight + spacing[3] }]}
          onPress={openCreateModal}
          activeOpacity={0.85}
        >
          <Ionicons name="add" size={26} color={colors.white} />
        </TouchableOpacity>
      )}

      {/* Add / edit expense modal */}
      <Modal
        visible={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? 'Редактировать расход' : 'Новый расход'}
      >
        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Категория</Text>
          <View style={styles.catPicker}>
            <TouchableOpacity
              style={[
                styles.catPickerItem,
                { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
                !selectedCategoryId && styles.catPickerItemActive,
              ]}
              onPress={() => setSelectedCategoryId('')}
            >
              <Text
                style={[
                  styles.catPickerText,
                  { color: palette.text.secondary },
                  !selectedCategoryId && styles.catPickerTextActive,
                ]}
              >
                Без категории
              </Text>
            </TouchableOpacity>
            {categories.map((c) => (
              <TouchableOpacity
                key={c.id}
                style={[
                  styles.catPickerItem,
                  { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
                  selectedCategoryId === c.id && styles.catPickerItemActive,
                ]}
                onPress={() => setSelectedCategoryId(c.id)}
              >
                <Text
                  style={[
                    styles.catPickerText,
                    { color: palette.text.secondary },
                    selectedCategoryId === c.id && styles.catPickerTextActive,
                  ]}
                >
                  {c.name}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Сумма *</Text>
          <View
            style={[
              styles.amountInputWrapper,
              { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
            ]}
          >
            <Text style={[styles.amountCurrency, { color: palette.text.tertiary }]}>₽</Text>
            <TextInput
              value={amount}
              onChangeText={setAmount}
              style={[styles.amountInput, { color: palette.text.primary }]}
              keyboardType="numeric"
              placeholder="0"
              placeholderTextColor={palette.text.tertiary}
            />
          </View>
        </View>
        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Описание</Text>
          <TextInput
            value={description}
            onChangeText={setDescription}
            style={[
              styles.formInput,
              styles.formTextarea,
              { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
            ]}
            multiline
            placeholder="Например: Аренда офиса"
            placeholderTextColor={palette.text.tertiary}
          />
        </View>
        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Дата</Text>
          <TouchableOpacity
            onPress={() => setDatePickerMode('expense')}
            style={[
              styles.formInput,
              styles.dateBtn,
              { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
            ]}
            activeOpacity={0.7}
          >
            <Text style={[styles.dateBtnText, { color: palette.text.primary }]}>
              {formatDDMMYYYY(expenseDate)}
            </Text>
            <Ionicons name="calendar-outline" size={16} color={palette.text.tertiary} />
          </TouchableOpacity>
        </View>
        <View style={[styles.formActions, { borderTopColor: palette.border.subtle }]}>
          <TouchableOpacity
            style={[styles.cancelBtn, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
            onPress={() => setModalOpen(false)}
          >
            <Text style={[styles.cancelBtnText, { color: palette.text.secondary }]}>Отмена</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.submitBtn, { backgroundColor: palette.accent.primary }]}
            onPress={handleSubmit}
            activeOpacity={0.85}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={styles.submitBtnText}>{editingId ? 'Сохранить' : 'Добавить'}</Text>
            )}
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Categories management modal */}
      <Modal visible={catModalOpen} onClose={() => setCatModalOpen(false)} title="Категории расходов">
        <View style={styles.catFormRow}>
          <TextInput
            value={newCatName}
            onChangeText={setNewCatName}
            style={[
              styles.formInput,
              {
                flex: 1,
                backgroundColor: palette.bg.muted,
                borderColor: palette.border.subtle,
                color: palette.text.primary,
              },
            ]}
            placeholder="Новая категория..."
            placeholderTextColor={palette.text.tertiary}
          />
          <TouchableOpacity
            style={[styles.catAddBtn, !newCatName.trim() && styles.catAddBtnDisabled]}
            onPress={() => {
              if (newCatName.trim()) createCatMutation.mutate({ name: newCatName.trim() });
            }}
            disabled={!newCatName.trim()}
          >
            <Ionicons name="add" size={20} color={colors.white} />
          </TouchableOpacity>
        </View>
        {categories.length === 0 ? (
          <View style={styles.catEmptyState}>
            <Ionicons name="pricetag-outline" size={32} color={palette.text.tertiary} />
            <Text style={[styles.catEmptyText, { color: palette.text.tertiary }]}>Нет категорий</Text>
          </View>
        ) : (
          categories.map((c) => (
            <View key={c.id} style={[styles.catListRow, { borderBottomColor: palette.border.subtle }]}>
              <View style={styles.catListLeft}>
                <View style={styles.catListDot} />
                <Text style={[styles.catListName, { color: palette.text.primary }]}>{c.name}</Text>
              </View>
              <TouchableOpacity onPress={() => deleteCatMutation.mutate(c.id)} style={styles.catListDeleteBtn}>
                <Ionicons name="close-circle-outline" size={20} color={palette.text.tertiary} />
              </TouchableOpacity>
            </View>
          ))
        )}
      </Modal>

      {/* Employee picker modal */}
      <Modal visible={employeePickerOpen} onClose={() => setEmployeePickerOpen(false)} title="Сотрудник">
        <TouchableOpacity
          onPress={() => {
            setFilterEmployeeId('');
            setEmployeePickerOpen(false);
          }}
          style={[styles.employeeOption, !filterEmployeeId && { backgroundColor: colors.primary[50] }]}
        >
          <View style={[styles.employeeAvatar, { backgroundColor: palette.bg.muted }]}>
            <Ionicons name="people-outline" size={16} color={palette.text.secondary} />
          </View>
          <Text
            style={[
              styles.employeeOptionText,
              { color: palette.text.secondary },
              !filterEmployeeId && { color: colors.primary[600], fontWeight: fontWeight.bold },
            ]}
          >
            Все сотрудники
          </Text>
          {!filterEmployeeId && <Ionicons name="checkmark-circle" size={18} color={colors.primary[600]} />}
        </TouchableOpacity>
        {employees.map((emp) => {
          const active = filterEmployeeId === emp.id;
          return (
            <TouchableOpacity
              key={emp.id}
              onPress={() => {
                setFilterEmployeeId(emp.id);
                setEmployeePickerOpen(false);
              }}
              style={[styles.employeeOption, active && { backgroundColor: colors.primary[50] }]}
            >
              <View style={[styles.employeeAvatar, { backgroundColor: palette.bg.muted }]}>
                <Text style={[styles.employeeAvatarText, { color: palette.text.secondary }]}>
                  {emp.fullName?.charAt(0) || '?'}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    styles.employeeOptionText,
                    { color: palette.text.primary },
                    active && { color: colors.primary[700], fontWeight: fontWeight.bold },
                  ]}
                  numberOfLines={1}
                >
                  {emp.fullName}
                </Text>
                {emp.canAddExpenses && (
                  <Text style={[styles.employeeOptionMeta, { color: palette.text.tertiary }]} numberOfLines={1}>
                    {emp.dailyExpenseLimit
                      ? `лимит ${formatMoney(emp.dailyExpenseLimit)}/день`
                      : 'может добавлять расходы'}
                  </Text>
                )}
              </View>
              {active && <Ionicons name="checkmark-circle" size={18} color={colors.primary[600]} />}
            </TouchableOpacity>
          );
        })}
      </Modal>

      {/* Native-feeling iOS calendar — переиспользуем существующий
          DateTimePickerModal. Один компонент обслуживает три точки выбора
          даты (создание расхода / customFrom / customTo). */}
      <DateTimePickerModal
        visible={datePickerMode === 'expense'}
        value={expenseDate}
        mode="date"
        onConfirm={(d) => {
          setExpenseDate(d);
          setDatePickerMode(null);
        }}
        onCancel={() => setDatePickerMode(null)}
      />
      <DateTimePickerModal
        visible={datePickerMode === 'customFrom'}
        value={parseDDMMYYYY(customFrom) || new Date()}
        mode="date"
        onConfirm={(d) => {
          setCustomFrom(formatDDMMYYYY(d));
          if (period !== 'custom') setPeriod('custom');
          setDatePickerMode(null);
        }}
        onCancel={() => setDatePickerMode(null)}
      />
      <DateTimePickerModal
        visible={datePickerMode === 'customTo'}
        value={parseDDMMYYYY(customTo) || new Date()}
        mode="date"
        onConfirm={(d) => {
          setCustomTo(formatDDMMYYYY(d));
          if (period !== 'custom') setPeriod('custom');
          setDatePickerMode(null);
        }}
        onCancel={() => setDatePickerMode(null)}
      />

      <ConfirmDialog
        visible={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => {
          if (deleteId) deleteMutation.mutate(deleteId);
          setDeleteId(null);
        }}
        title="Удалить расход"
        message="Вы уверены, что хотите удалить этот расход?"
        confirmText="Удалить"
        variant="danger"
      />
    </View>
  );
}

// ────────────────────────────────────────────────────────────────────────
//  Styles
// ────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.gray[50],
  },
  loadingWrap: {
    flex: 1,
    paddingTop: spacing[3],
  },
  // Header trailing — month chip
  headerTrailing: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  monthChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1.5],
    borderRadius: borderRadius.full,
  },
  monthChipText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    minWidth: 90,
    textAlign: 'center',
  },
  monthChipArrow: {
    padding: 2,
  },
  freshnessRow: {
    paddingHorizontal: spacing[4],
    minHeight: 18,
    alignItems: 'flex-end',
    marginBottom: spacing[1],
  },

  // Period selector
  periodWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    marginBottom: spacing[3],
    gap: spacing[2],
  },
  periodContainer: {
    flex: 1,
    flexDirection: 'row',
    borderRadius: borderRadius.full,
    padding: 3,
  },
  periodChip: {
    flex: 1,
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  periodChipActive: {
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  periodText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
  periodTextActive: {
    // colour applied inline (palette.text.primary)
  },
  catBtn: {
    width: 38,
    height: 38,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Custom range
  customRangeCard: {
    ...iosCard,
    marginHorizontal: spacing[4],
    marginBottom: spacing[3],
    flexDirection: 'row',
    gap: spacing[3],
  },
  customRangeField: {
    flex: 1,
  },
  customRangeLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    marginBottom: 4,
  },
  customRangeInput: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    gap: 6,
  },
  customRangeInputText: {
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    padding: 0,
  },

  // Hero
  heroWrapper: {
    paddingHorizontal: spacing[4],
    marginBottom: spacing[3],
  },
  heroCard: {
    ...iosCard,
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[4],
  },
  heroLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    marginBottom: spacing[1],
  },
  heroValue: {
    fontSize: 32,
    fontWeight: '800',
    letterSpacing: -0.6,
    marginTop: 2,
  },
  heroDiffRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing[2],
    flexWrap: 'wrap',
  },
  heroDiffText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },
  heroDiffSecondary: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },

  // Tiles 2×2
  tilesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: spacing[4],
    gap: spacing[2.5],
    marginBottom: spacing[3],
  },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.xl,
    ...(Platform.OS === 'android' ? { elevation: 1 } : null),
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
  },
  tileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing[1],
  },
  tileDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  tileName: {
    flex: 1,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: -0.1,
  },
  tileAmount: {
    fontSize: fontSize.base,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginBottom: spacing[2],
  },
  tileBarBg: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  tileBarFill: {
    height: '100%',
    borderRadius: 2,
  },

  // Category breakdown
  breakdownCard: {
    ...iosCard,
    marginHorizontal: spacing[4],
    marginBottom: spacing[3],
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[4],
  },
  breakdownTitle: {
    marginBottom: spacing[3],
  },
  breakdownRow: {
    marginBottom: spacing[3],
    paddingHorizontal: 2,
    borderRadius: borderRadius.md,
  },
  breakdownRowActive: {
    backgroundColor: 'rgba(59, 130, 246, 0.05)',
    paddingHorizontal: 6,
    paddingVertical: 4,
    marginHorizontal: -4,
  },
  breakdownRowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing[1],
  },
  breakdownNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    flex: 1,
  },
  breakdownDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  breakdownName: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    flexShrink: 1,
  },
  breakdownAmount: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },
  progressBarBg: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 2,
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  breakdownPercent: {
    fontSize: 10,
    fontWeight: fontWeight.medium,
    textAlign: 'right',
  },

  // Top-5
  topCard: {
    ...iosCard,
    marginHorizontal: spacing[4],
    marginBottom: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[2.5],
    gap: spacing[3],
  },
  topRank: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  topRankText: {
    fontSize: fontSize.xs,
    fontWeight: '800',
  },
  topMiddle: {
    flex: 1,
  },
  topName: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  topMeta: {
    fontSize: 11,
    marginTop: 1,
  },
  topAmount: {
    fontSize: fontSize.sm,
    fontWeight: '800',
  },

  // Regular highlights
  regularCard: {
    ...iosCard,
    marginHorizontal: spacing[4],
    marginBottom: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3.5],
  },
  regularRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    paddingVertical: spacing[1.5],
  },
  regularDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  regularName: {
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  regularAmount: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },

  // Tabs
  tabsRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing[4],
    gap: spacing[2],
    marginBottom: spacing[3],
  },
  tabChip: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
  },
  tabChipText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: -0.1,
  },

  // Filter chips
  filterChipsRow: {
    flexDirection: 'row',
    paddingHorizontal: spacing[4],
    gap: spacing[2],
    marginBottom: spacing[3],
    flexWrap: 'wrap',
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
    borderWidth: 1,
    maxWidth: '70%',
  },
  filterChipText: {
    fontSize: fontSize.xs,
  },

  // Active filter banner
  activeFilterBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.md,
    marginHorizontal: spacing[4],
    marginBottom: spacing[2],
  },
  activeFilterText: {
    flex: 1,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },

  listSectionLabel: {
    paddingHorizontal: spacing[4],
    marginTop: spacing[1],
    marginBottom: spacing[2],
  },

  // List
  // ВАЖНО: paddingHorizontal: 0 — иначе оно складывается с
  // marginHorizontal: spacing[4] на заголовочных блоках (heroWrapper,
  // periodWrapper, breakdownCard, …), и весь экран съезжает на 16+16=32px
  // от краёв, что выглядит уже, чем все остальные экраны (где иначе
  // унифицировано 16px). Здесь — единый 16px из marginHorizontal на
  // карточках строк / заголовочных блоках.
  list: {
    paddingHorizontal: 0,
    paddingBottom: spacing[8],
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.gray[100],
    overflow: 'hidden',
    marginHorizontal: spacing[4],
    marginBottom: spacing[2],
  },
  cardInner: {
    flexDirection: 'row',
  },
  accentBar: {
    width: 4,
  },
  cardContent: {
    flex: 1,
    padding: spacing[4],
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardBadgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    flexShrink: 1,
    marginLeft: spacing[2],
  },
  cardAmount: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
  },
  pendingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  pendingText: {
    fontSize: 10,
    fontWeight: fontWeight.semibold,
  },
  catBadge: {
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  catBadgeText: {
    fontSize: 10,
    fontWeight: fontWeight.semibold,
  },
  cardDesc: {
    fontSize: fontSize.sm,
    marginTop: spacing[1],
    lineHeight: 20,
  },
  cardBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing[2.5],
    paddingTop: spacing[2.5],
    borderTopWidth: 1,
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
  },
  cardDate: {
    fontSize: fontSize.xs,
  },
  cardUser: {
    fontSize: fontSize.xs,
  },
  deleteBtn: {
    padding: spacing[1],
    borderRadius: borderRadius.full,
  },

  // Approval CTAs
  approvalRow: {
    flexDirection: 'row',
    gap: spacing[2],
    marginTop: spacing[2.5],
  },
  approveBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: spacing[2],
    borderRadius: borderRadius.lg,
  },
  approveBtnText: {
    color: colors.white,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
  },
  rejectBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: spacing[2],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },
  rejectBtnText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
  },

  // FAB
  fab: {
    position: 'absolute',
    right: spacing[4],
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary[600],
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary[600],
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 6,
  },

  // Form
  formField: {
    marginBottom: spacing[4],
  },
  formLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    marginBottom: spacing[2],
  },
  formInput: {
    borderWidth: 1,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
    fontSize: fontSize.sm,
  },
  formTextarea: {
    height: 70,
    textAlignVertical: 'top',
    paddingTop: spacing[3],
  },
  dateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dateBtnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  amountInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[1],
  },
  amountCurrency: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    marginRight: spacing[2],
  },
  amountInput: {
    flex: 1,
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    paddingVertical: spacing[2.5],
  },
  catPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[2],
  },
  catPickerItem: {
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  catPickerItemActive: {
    borderColor: colors.primary[500],
    backgroundColor: colors.primary[50],
  },
  catPickerText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
  },
  catPickerTextActive: {
    color: colors.primary[700],
  },
  formActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[3],
    paddingTop: spacing[4],
    borderTopWidth: 1,
  },
  cancelBtn: {
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  cancelBtnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  submitBtn: {
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.full,
    shadowColor: colors.primary[600],
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  submitBtnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.white,
  },

  // Category list (modal)
  catFormRow: {
    flexDirection: 'row',
    gap: spacing[2],
    marginBottom: spacing[4],
  },
  catAddBtn: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.primary[600],
    alignItems: 'center',
    justifyContent: 'center',
  },
  catAddBtnDisabled: {
    opacity: 0.5,
  },
  catEmptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[8],
    gap: spacing[2],
  },
  catEmptyText: {
    fontSize: fontSize.sm,
  },
  catListRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
  },
  catListLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
  },
  catListDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary[400],
  },
  catListName: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  catListDeleteBtn: {
    padding: spacing[1],
  },

  // Employee picker
  employeeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.lg,
    marginBottom: spacing[1],
  },
  employeeAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  employeeAvatarText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },
  employeeOptionText: {
    flex: 1,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  employeeOptionMeta: {
    fontSize: 11,
    marginTop: 1,
  },
});
