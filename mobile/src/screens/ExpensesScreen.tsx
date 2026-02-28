import React, { useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet,
  RefreshControl, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { expensesApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import AnimatedCard from '../components/AnimatedCard';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';

function formatMoney(v: number) { return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; }
function formatDate(d: string) { return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
function toDateStr(d: Date) { return d.toISOString().slice(0, 10); }

const PERIODS = [
  { key: 'today', label: 'Сегодня' },
  { key: 'week', label: 'Неделя' },
  { key: 'month', label: 'Месяц' },
] as const;

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
  const isDirector = user?.role === 'director' || user?.role === 'superadmin';

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
    queryFn: async () => { const res = await expensesApi.getCategories(); return res.data; },
  });

  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ['expenses', dateFrom, dateTo],
    queryFn: async () => { const res = await expensesApi.getAll({ dateFrom, dateTo }); return res.data; },
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
    setAmount(''); setDescription(''); setSelectedCategoryId(''); setExpenseDate(toDateStr(new Date()));
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

  const totalExpenses = expenses.reduce((s: number, e: any) => s + e.amount, 0);

  // Group by category
  const byCategory: Record<string, { name: string; total: number }> = {};
  for (const exp of expenses) {
    const cat = exp.categoryName || 'Без категории';
    if (!byCategory[cat]) byCategory[cat] = { name: cat, total: 0 };
    byCategory[cat].total += exp.amount;
  }
  const categoryBreakdown = Object.values(byCategory).sort((a, b) => b.total - a.total);

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['expenses'] });
    setRefreshing(false);
  };

  const renderExpense = ({ item, index }: { item: any; index: number }) => (
    <AnimatedCard style={styles.card} index={index}>
      <View style={styles.cardTop}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
            <Text style={styles.cardAmount}>{formatMoney(item.amount)}</Text>
            {item.categoryName && (
              <View style={styles.catBadge}>
                <Text style={styles.catBadgeText}>{item.categoryName}</Text>
              </View>
            )}
          </View>
          {item.description && <Text style={styles.cardDesc}>{item.description}</Text>}
        </View>
        {isDirector && (
          <TouchableOpacity onPress={() => setDeleteId(item.id)} style={styles.deleteBtn}>
            <Ionicons name="trash-outline" size={16} color={colors.gray[300]} />
          </TouchableOpacity>
        )}
      </View>
      <View style={styles.cardBottom}>
        <Text style={styles.cardDate}>{formatDate(item.date)}</Text>
        {item.userName && <Text style={styles.cardUser}>{item.userName}</Text>}
      </View>
    </AnimatedCard>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={colors.gray[700]} />
        </TouchableOpacity>
        <Text style={styles.title}>Расходы</Text>
        {isDirector && (
          <TouchableOpacity style={styles.addBtn} onPress={() => { resetForm(); setModalOpen(true); }}>
            <Text style={styles.addBtnText}>+ Новый</Text>
          </TouchableOpacity>
        )}
        {!isDirector && <View style={{ width: 60 }} />}
      </View>

      {/* Period selector */}
      <View style={styles.periodRow}>
        {PERIODS.map(p => (
          <TouchableOpacity
            key={p.key}
            style={[styles.periodChip, period === p.key && styles.periodChipActive]}
            onPress={() => handlePeriodChange(p.key)}
          >
            <Text style={[styles.periodText, period === p.key && styles.periodTextActive]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
        {isDirector && (
          <TouchableOpacity style={styles.catBtn} onPress={() => setCatModalOpen(true)}>
            <Ionicons name="pricetag-outline" size={16} color={colors.primary[600]} />
          </TouchableOpacity>
        )}
      </View>

      {/* Total */}
      <View style={styles.totalCard}>
        <Text style={styles.totalLabel}>Итого расходов</Text>
        <Text style={styles.totalValue}>{formatMoney(totalExpenses)}</Text>
      </View>

      {/* Category breakdown */}
      {categoryBreakdown.length > 0 && (
        <View style={styles.breakdownCard}>
          <Text style={styles.breakdownTitle}>По категориям</Text>
          {categoryBreakdown.map((cat) => (
            <View key={cat.name} style={styles.breakdownRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                <View style={styles.breakdownDot} />
                <Text style={styles.breakdownName}>{cat.name}</Text>
              </View>
              <Text style={styles.breakdownAmount}>{formatMoney(cat.total)}</Text>
            </View>
          ))}
        </View>
      )}

      {isLoading ? <LoadingSpinner /> : !expenses?.length ? (
        <EmptyState title="Нет расходов" description="Добавьте расходы за выбранный период" action={isDirector ? { label: 'Добавить', onPress: () => setModalOpen(true) } : undefined} />
      ) : (
        <FlatList data={expenses} keyExtractor={i => i.id} renderItem={renderExpense} contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />} />
      )}

      {/* Add expense modal */}
      <Modal visible={modalOpen} onClose={() => setModalOpen(false)} title="Новый расход">
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Категория</Text>
          <View style={styles.catPicker}>
            <TouchableOpacity
              style={[styles.catPickerItem, !selectedCategoryId && styles.catPickerItemActive]}
              onPress={() => setSelectedCategoryId('')}
            >
              <Text style={[styles.catPickerText, !selectedCategoryId && styles.catPickerTextActive]}>Без категории</Text>
            </TouchableOpacity>
            {categories.map((c: any) => (
              <TouchableOpacity
                key={c.id}
                style={[styles.catPickerItem, selectedCategoryId === c.id && styles.catPickerItemActive]}
                onPress={() => setSelectedCategoryId(c.id)}
              >
                <Text style={[styles.catPickerText, selectedCategoryId === c.id && styles.catPickerTextActive]}>{c.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Сумма *</Text>
          <TextInput value={amount} onChangeText={setAmount} style={styles.formInput} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.gray[400]} />
        </View>
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Описание</Text>
          <TextInput value={description} onChangeText={setDescription} style={[styles.formInput, { height: 60, textAlignVertical: 'top' }]} multiline placeholder="Например: Аренда офиса за январь" placeholderTextColor={colors.gray[400]} />
        </View>
        <View style={styles.formActions}>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalOpen(false)}>
            <Text style={styles.cancelBtnText}>Отмена</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit}>
            {createMutation.isPending ? <ActivityIndicator color={colors.white} size="small" /> : <Text style={styles.submitBtnText}>Добавить</Text>}
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Categories management modal */}
      <Modal visible={catModalOpen} onClose={() => setCatModalOpen(false)} title="Категории расходов">
        <View style={{ flexDirection: 'row', gap: spacing[2], marginBottom: spacing[4] }}>
          <TextInput
            value={newCatName}
            onChangeText={setNewCatName}
            style={[styles.formInput, { flex: 1 }]}
            placeholder="Новая категория..."
            placeholderTextColor={colors.gray[400]}
          />
          <TouchableOpacity
            style={[styles.submitBtn, { paddingHorizontal: spacing[3] }]}
            onPress={() => { if (newCatName.trim()) createCatMutation.mutate({ name: newCatName.trim() }); }}
            disabled={!newCatName.trim()}
          >
            <Ionicons name="add" size={20} color={colors.white} />
          </TouchableOpacity>
        </View>
        {categories.length === 0 ? (
          <Text style={{ textAlign: 'center', color: colors.gray[400], paddingVertical: spacing[6] }}>Нет категорий</Text>
        ) : (
          categories.map((c: any) => (
            <View key={c.id} style={styles.catListRow}>
              <Text style={styles.catListName}>{c.name}</Text>
              <TouchableOpacity onPress={() => deleteCatMutation.mutate(c.id)}>
                <Ionicons name="close" size={18} color={colors.gray[400]} />
              </TouchableOpacity>
            </View>
          ))
        )}
      </Modal>

      <ConfirmDialog
        visible={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => { if (deleteId) deleteMutation.mutate(deleteId); setDeleteId(null); }}
        title="Удалить расход"
        message="Вы уверены, что хотите удалить этот расход?"
        confirmText="Удалить"
        variant="danger"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing[4], paddingVertical: spacing[3] },
  backText: { fontSize: fontSize.sm, color: colors.primary[600], fontWeight: fontWeight.medium },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.gray[900] },
  addBtn: { backgroundColor: colors.primary[600], paddingHorizontal: spacing[4], paddingVertical: spacing[2.5], borderRadius: borderRadius.lg },
  addBtnText: { color: colors.white, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  // Period selector
  periodRow: { flexDirection: 'row', paddingHorizontal: spacing[4], gap: spacing[2], marginBottom: spacing[3], alignItems: 'center' },
  periodChip: { paddingHorizontal: spacing[3], paddingVertical: spacing[2], borderRadius: borderRadius.lg, backgroundColor: colors.gray[100] },
  periodChipActive: { backgroundColor: colors.primary[600] },
  periodText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.gray[600] },
  periodTextActive: { color: colors.white },
  catBtn: { marginLeft: 'auto', width: 36, height: 36, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colors.gray[200], alignItems: 'center', justifyContent: 'center', backgroundColor: colors.white },
  // Total
  totalCard: { marginHorizontal: spacing[4], marginBottom: spacing[3], borderRadius: borderRadius['2xl'], padding: spacing[5], backgroundColor: colors.rose[600], overflow: 'hidden' },
  totalLabel: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: 'rgba(255,255,255,0.7)', textTransform: 'uppercase', letterSpacing: 1 },
  totalValue: { fontSize: 28, fontWeight: fontWeight.bold, color: colors.white, marginTop: 4 },
  // Category breakdown
  breakdownCard: { marginHorizontal: spacing[4], marginBottom: spacing[3], backgroundColor: colors.white, borderRadius: borderRadius['2xl'], borderWidth: 1, borderColor: colors.gray[100], padding: spacing[4] },
  breakdownTitle: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.gray[400], textTransform: 'uppercase', letterSpacing: 1, marginBottom: spacing[3] },
  breakdownRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing[2] },
  breakdownDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.rose[400] },
  breakdownName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[800] },
  breakdownAmount: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  // List
  list: { paddingHorizontal: spacing[4], paddingBottom: spacing[8], gap: spacing[2] },
  card: { backgroundColor: colors.white, borderRadius: borderRadius.xl, borderWidth: 1, borderColor: colors.gray[100], padding: spacing[4] },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardAmount: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  catBadge: { backgroundColor: colors.rose[50], paddingHorizontal: spacing[1.5], paddingVertical: 2, borderRadius: borderRadius.full },
  catBadgeText: { fontSize: 10, fontWeight: fontWeight.semibold, color: colors.rose[600] },
  cardDesc: { fontSize: fontSize.xs, color: colors.gray[500], marginTop: 2 },
  deleteBtn: { padding: spacing[1.5], borderRadius: borderRadius.lg },
  cardBottom: { flexDirection: 'row', gap: spacing[3], marginTop: spacing[2], paddingTop: spacing[2], borderTopWidth: 1, borderTopColor: colors.gray[50] },
  cardDate: { fontSize: fontSize.xs, color: colors.gray[400] },
  cardUser: { fontSize: fontSize.xs, color: colors.gray[400] },
  // Form
  formField: { marginBottom: spacing[4] },
  formLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700], marginBottom: spacing[1.5] },
  formInput: { backgroundColor: colors.gray[50], borderWidth: 1, borderColor: colors.gray[300], borderRadius: borderRadius.lg, paddingHorizontal: spacing[3.5], paddingVertical: spacing[2.5], fontSize: fontSize.sm, color: colors.gray[900] },
  catPicker: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  catPickerItem: { paddingHorizontal: spacing[3], paddingVertical: spacing[2], borderRadius: borderRadius.full, borderWidth: 1, borderColor: colors.gray[200], backgroundColor: colors.gray[50] },
  catPickerItemActive: { borderColor: colors.primary[500], backgroundColor: colors.primary[50] },
  catPickerText: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: colors.gray[500] },
  catPickerTextActive: { color: colors.primary[700] },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing[3], paddingTop: spacing[4], borderTopWidth: 1, borderTopColor: colors.gray[200] },
  cancelBtn: { paddingHorizontal: spacing[4], paddingVertical: spacing[2.5], borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colors.gray[300] },
  cancelBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
  submitBtn: { paddingHorizontal: spacing[4], paddingVertical: spacing[2.5], borderRadius: borderRadius.lg, backgroundColor: colors.primary[600] },
  submitBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.white },
  // Category list
  catListRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing[3], borderBottomWidth: 1, borderBottomColor: colors.gray[100] },
  catListName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[800] },
});
