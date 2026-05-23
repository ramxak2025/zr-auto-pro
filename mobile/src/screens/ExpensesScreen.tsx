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
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import IosScreenHeader from '../components/IosScreenHeader';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { expensesApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import LoadingSpinner from '../components/LoadingSpinner';
import { ListSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import AnimatedCard from '../components/AnimatedCard';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { iosCard, iosSectionLabel } from '../platform/iosSurface';
import { useTabBarHeight } from '../hooks/useTabBarHeight';

function formatMoney(v: number) {
  return (
    Math.round(v)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
  );
}
function formatDate(d: string) {
  return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function toDateStr(d: Date) {
  return d.toISOString().slice(0, 10);
}

const PERIODS = [
  { key: 'today', label: 'Сегодня' },
  { key: 'week', label: 'Неделя' },
  { key: 'month', label: 'Месяц' },
] as const;

const CATEGORY_COLORS = [
  { bg: colors.rose[500], light: colors.rose[50], text: colors.rose[600] },
  { bg: colors.amber[600], light: colors.amber[50], text: colors.amber[600] },
  { bg: colors.blue[500], light: colors.blue[50], text: colors.blue[700] },
  { bg: colors.purple[700], light: colors.purple[50], text: colors.purple[700] },
  { bg: colors.green[500], light: colors.green[50], text: colors.green[700] },
  { bg: colors.orange[500], light: colors.orange[50], text: colors.orange[600] },
];

function getCategoryColor(index: number) {
  return CATEGORY_COLORS[index % CATEGORY_COLORS.length];
}

// ── ExpenseRow ────────────────────────────────────────────────────────
// Module-scope memo'd row — keeps identity stable across the period
// switcher, refresh-toggle, and category-modal opens. Without it the
// inline factory rebuilt every closure on each render and the FlashList
// re-rendered every visible row.
interface ExpenseRowProps {
  item: {
    id: string;
    amount: number;
    description?: string;
    categoryName?: string;
    date: string;
    userName?: string;
  };
  index: number;
  catColor: { bg: string; light: string; text: string };
  isDirector: boolean;
  onDelete: (id: string) => void;
  palette: ReturnType<typeof useColors>;
}
const ExpenseRow = React.memo(function ExpenseRow({
  item,
  index,
  catColor,
  isDirector,
  onDelete,
  palette,
}: ExpenseRowProps) {
  return (
    <AnimatedCard
      style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
      index={index}
    >
      <View style={styles.cardInner}>
        {/* Left accent bar */}
        <View style={[styles.accentBar, { backgroundColor: catColor.bg }]} />

        <View style={styles.cardContent}>
          {/* Top row: amount + category badge */}
          <View style={styles.cardTopRow}>
            <Text style={[styles.cardAmount, { color: palette.text.primary }]}>{formatMoney(item.amount)}</Text>
            {item.categoryName && (
              <View style={[styles.catBadge, { backgroundColor: catColor.light }]}>
                <Text style={[styles.catBadgeText, { color: catColor.text }]}>{item.categoryName}</Text>
              </View>
            )}
          </View>

          {/* Description */}
          {item.description && (
            <Text style={[styles.cardDesc, { color: palette.text.secondary }]}>{item.description}</Text>
          )}

          {/* Bottom row: date, user, trash icon */}
          <View style={[styles.cardBottomRow, { borderTopColor: palette.border.subtle }]}>
            <View style={styles.cardMeta}>
              <Ionicons name="calendar-outline" size={11} color={palette.text.tertiary} />
              <Text style={[styles.cardDate, { color: palette.text.tertiary }]}>{formatDate(item.date)}</Text>
              {item.userName && (
                <>
                  <Ionicons name="person-outline" size={11} color={palette.text.tertiary} style={{ marginLeft: 8 }} />
                  <Text style={[styles.cardUser, { color: palette.text.tertiary }]}>{item.userName}</Text>
                </>
              )}
            </View>
            {isDirector && (
              <TouchableOpacity
                onPress={() => onDelete(item.id)}
                style={styles.deleteBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="trash-outline" size={15} color={palette.text.tertiary} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </AnimatedCard>
  );
});

function getDateRange(period: string) {
  const now = new Date();
  const today = toDateStr(now);
  if (period === 'today') return { from: today, to: today };
  if (period === 'week') {
    const day = now.getDay();
    const diff = day === 0 ? 6 : day - 1;
    const monday = new Date(now);
    monday.setDate(now.getDate() - diff);
    return { from: toDateStr(monday), to: today };
  }
  return { from: toDateStr(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
}

export default function ExpensesScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const palette = useColors();
  const isDirector = user?.role === 'director' || user?.role === 'superadmin';
  const tabBarHeight = useTabBarHeight();

  const [refreshing, setRefreshing] = useState(false);
  const [period, setPeriod] = useState<string>('month');
  const [dateFrom, setDateFrom] = useState(getDateRange('month').from);
  const [dateTo, setDateTo] = useState(getDateRange('month').to);

  // Modals
  const [modalOpen, setModalOpen] = useState(false);
  const [catModalOpen, setCatModalOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [newCatName, setNewCatName] = useState('');

  // Form
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [expenseDate, setExpenseDate] = useState(toDateStr(new Date()));

  const { data: categories = [] } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: async () => {
      const res = await expensesApi.getCategories();
      return res.data;
    },
  });

  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ['expenses', dateFrom, dateTo],
    queryFn: async () => {
      const res = await expensesApi.getAll({ dateFrom, dateTo });
      return res.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: (d: any) => expensesApi.create(d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      setModalOpen(false);
      resetForm();
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

  const resetForm = () => {
    setAmount('');
    setDescription('');
    setSelectedCategoryId('');
    setExpenseDate(toDateStr(new Date()));
  };

  const handlePeriodChange = (p: string) => {
    setPeriod(p);
    const range = getDateRange(p);
    setDateFrom(range.from);
    setDateTo(range.to);
  };

  const handleSubmit = () => {
    if (!amount || parseFloat(amount) <= 0) {
      Alert.alert('Ошибка', 'Укажите сумму');
      return;
    }
    createMutation.mutate({
      categoryId: selectedCategoryId || undefined,
      amount: parseFloat(amount),
      description: description || undefined,
      date: expenseDate,
    });
  };

  // Derived totals + category breakdown — wrapped in useMemo so a
  // category-modal open / period flip doesn't recompute the O(n) walk
  // through the expense list on every render. The expense FlashList row
  // also reads `allCategoryNames` to compute its accent colour; keeping
  // that array reference stable means ExpenseRow's React.memo holds.
  const { totalExpenses, categoryBreakdown, allCategoryNames, colorByName } = useMemo(() => {
    const total = expenses.reduce((s: number, e: any) => s + e.amount, 0);
    const byCategory: Record<string, { name: string; total: number }> = {};
    for (const exp of expenses) {
      const cat = exp.categoryName || 'Без категории';
      if (!byCategory[cat]) byCategory[cat] = { name: cat, total: 0 };
      byCategory[cat].total += exp.amount;
    }
    const breakdown = Object.values(byCategory).sort((a, b) => b.total - a.total);
    const names = breakdown.map((c) => c.name);
    // Pre-compute name → colour once instead of doing indexOf() per row,
    // so render is O(rows) instead of O(rows × categories).
    const cmap = new Map<string, { bg: string; light: string; text: string }>();
    names.forEach((n, i) => cmap.set(n, getCategoryColor(i)));
    return {
      totalExpenses: total,
      categoryBreakdown: breakdown,
      allCategoryNames: names,
      colorByName: cmap,
    };
  }, [expenses]);

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['expenses'] });
    setRefreshing(false);
  };

  // Stable delete handler so memoised ExpenseRow doesn't bust on parent renders.
  const handleDeleteExpense = useCallback((id: string) => setDeleteId(id), []);

  const renderExpense = useCallback(
    ({ item, index }: { item: any; index: number }) => {
      const catName = item.categoryName || 'Без категории';
      const catColor = colorByName.get(catName) || getCategoryColor(0);
      return (
        <ExpenseRow
          item={item}
          index={index}
          catColor={catColor}
          isDirector={isDirector}
          onDelete={handleDeleteExpense}
          palette={palette}
        />
      );
    },
    [colorByName, isDirector, handleDeleteExpense, palette],
  );

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      {/* Унифицированная iOS-шапка — единый стиль с Расписанием/Журналом. */}
      <IosScreenHeader
        title="Расходы"
        subtitle={expenses.length > 0 ? `Всего: ${expenses.length}` : undefined}
        onBack={() => navigation.goBack()}
        trailing={
          isDirector ? (
            <TouchableOpacity
              style={styles.addBtn}
              onPress={() => {
                resetForm();
                setModalOpen(true);
              }}
            >
              <Text style={styles.addBtnText}>+ Новый</Text>
            </TouchableOpacity>
          ) : undefined
        }
      />

      {/* Period selector */}
      <View style={styles.periodWrapper}>
        <View style={[styles.periodContainer, { backgroundColor: palette.bg.muted }]}>
          {PERIODS.map((p) => (
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
        {isDirector && (
          <TouchableOpacity
            style={[styles.catBtn, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
            onPress={() => setCatModalOpen(true)}
          >
            <Ionicons name="pricetag-outline" size={16} color={colors.primary[600]} />
          </TouchableOpacity>
        )}
      </View>

      {/* Total — clean iosCard hero (32pt 800-weight number on white).
          Dropped the loud red LinearGradient banner — expenses are an
          everyday number, not a warning. The trending-down icon + rose
          accent on the label communicates the negative direction
          without flooding the screen with red. */}
      <View style={styles.totalCardWrapper}>
        <View style={[styles.totalCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
          <View style={styles.totalLabelRow}>
            <Ionicons name="trending-down-outline" size={14} color={colors.rose[500]} />
            <Text style={[iosSectionLabel, { marginBottom: 0, color: colors.rose[500] }]}>Итого расходов</Text>
          </View>
          <Text style={[styles.totalValue, { color: palette.text.primary }]}>{formatMoney(totalExpenses)}</Text>
        </View>
      </View>

      {/* Category breakdown with progress bars */}
      {categoryBreakdown.length > 0 && (
        <View style={[styles.breakdownCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
          <Text style={[iosSectionLabel, styles.breakdownTitle, { color: palette.text.tertiary }]}>По категориям</Text>
          {categoryBreakdown.map((cat, idx) => {
            const percentage = totalExpenses > 0 ? (cat.total / totalExpenses) * 100 : 0;
            const catColor = getCategoryColor(idx);
            return (
              <View key={cat.name} style={styles.breakdownRow}>
                <View style={styles.breakdownRowTop}>
                  <View style={styles.breakdownNameRow}>
                    <View style={[styles.breakdownDot, { backgroundColor: catColor.bg }]} />
                    <Text style={[styles.breakdownName, { color: palette.text.primary }]}>{cat.name}</Text>
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
              </View>
            );
          })}
        </View>
      )}

      {isLoading ? (
        <ListSkeleton count={6} />
      ) : !expenses?.length ? (
        <EmptyState
          title="Нет расходов"
          description="Добавьте расходы за выбранный период"
          action={isDirector ? { label: 'Добавить', onPress: () => setModalOpen(true) } : undefined}
        />
      ) : (
        <FlashList
          data={expenses}
          keyExtractor={(i) => i.id}
          renderItem={renderExpense}
          contentContainerStyle={{ ...styles.list, paddingBottom: tabBarHeight + spacing[4] }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
          }
        />
      )}

      {/* Add expense modal */}
      <Modal visible={modalOpen} onClose={() => setModalOpen(false)} title="Новый расход">
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
            {categories.map((c: any) => (
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
            placeholder="Например: Аренда офиса за январь"
            placeholderTextColor={palette.text.tertiary}
          />
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
            activeOpacity={0.8}
          >
            {createMutation.isPending ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={styles.submitBtnText}>Добавить</Text>
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
          categories.map((c: any) => (
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

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.gray[50],
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[100],
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.red[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  headerIcon: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
  },
  countBadge: {
    backgroundColor: colors.red[100],
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: borderRadius.full,
    marginLeft: spacing[1],
  },
  countBadgeText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.bold,
    color: colors.red[600],
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primary[600],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.full,
    shadowColor: colors.primary[600],
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 3,
  },
  addBtnText: {
    color: colors.white,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
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
    backgroundColor: colors.gray[100],
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
    backgroundColor: colors.white,
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  periodText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.gray[500],
  },
  periodTextActive: {
    color: colors.gray[900],
  },
  catBtn: {
    width: 38,
    height: 38,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.gray[200],
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },

  // Total card — clean iosCard hero, no LinearGradient.
  totalCardWrapper: {
    paddingHorizontal: spacing[4],
    marginBottom: spacing[3],
  },
  totalCard: {
    ...iosCard,
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[4],
  },
  totalLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    marginBottom: spacing[1],
  },
  totalValue: {
    fontSize: 32,
    fontWeight: '800',
    color: colors.gray[900],
    letterSpacing: -0.6,
    marginTop: 2,
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
  },
  breakdownDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  breakdownName: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.gray[800],
  },
  breakdownAmount: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
  },
  progressBarBg: {
    height: 6,
    backgroundColor: colors.gray[100],
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
    color: colors.gray[400],
    textAlign: 'right',
  },

  // List
  list: {
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[8],
    gap: spacing[2],
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.gray[100],
    overflow: 'hidden',
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
  cardAmount: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
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
    color: colors.gray[500],
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
    borderTopColor: colors.gray[50],
  },
  cardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  cardDate: {
    fontSize: fontSize.xs,
    color: colors.gray[400],
  },
  cardUser: {
    fontSize: fontSize.xs,
    color: colors.gray[400],
  },
  deleteBtn: {
    padding: spacing[1],
    borderRadius: borderRadius.full,
  },

  // Form
  formField: {
    marginBottom: spacing[4],
  },
  formLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.gray[700],
    marginBottom: spacing[2],
  },
  formInput: {
    backgroundColor: colors.gray[50],
    borderWidth: 1,
    borderColor: colors.gray[200],
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
    fontSize: fontSize.sm,
    color: colors.gray[900],
  },
  formTextarea: {
    height: 70,
    textAlignVertical: 'top',
    paddingTop: spacing[3],
  },
  amountInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.gray[50],
    borderWidth: 1.5,
    borderColor: colors.gray[200],
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[1],
  },
  amountCurrency: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.gray[400],
    marginRight: spacing[2],
  },
  amountInput: {
    flex: 1,
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
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
    borderColor: colors.gray[200],
    backgroundColor: colors.white,
  },
  catPickerItemActive: {
    borderColor: colors.primary[500],
    backgroundColor: colors.primary[50],
  },
  catPickerText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    color: colors.gray[500],
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
    borderTopColor: colors.gray[100],
  },
  cancelBtn: {
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.gray[200],
    backgroundColor: colors.white,
  },
  cancelBtnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.gray[700],
  },
  submitBtn: {
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.full,
    backgroundColor: colors.primary[600],
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
    color: colors.gray[400],
  },
  catListRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[50],
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
    color: colors.gray[800],
  },
  catListDeleteBtn: {
    padding: spacing[1],
  },
});
