import React, { useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet,
  RefreshControl, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { expensesApi } from '../api/services';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import type { Expense } from '../../shared/types';

function formatMoney(v: number) { return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; }
function formatDate(d: string) { return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }); }

export default function ExpensesScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [categoryName, setCategoryName] = useState('');

  const now = new Date();
  const [dateFrom] = useState(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10));
  const [dateTo] = useState(now.toISOString().slice(0, 10));

  const { data: expenses, isLoading } = useQuery<Expense[]>({
    queryKey: ['expenses', dateFrom, dateTo],
    queryFn: async () => { const res = await expensesApi.getAll({ dateFrom, dateTo }); return res.data; },
  });

  const createMutation = useMutation({
    mutationFn: (d: any) => expensesApi.create(d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['expenses'] }); setModalOpen(false); },
    onError: () => Alert.alert('Ошибка', 'Ошибка при создании расхода'),
  });

  const totalExpenses = (expenses || []).reduce((s, e) => s + e.amount, 0);

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['expenses'] });
    setRefreshing(false);
  };

  const handleSubmit = () => {
    createMutation.mutate({ amount: Number(amount) || 0, description: description || undefined, categoryName: categoryName || undefined });
  };

  const renderExpense = ({ item }: { item: Expense }) => (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardCategory}>{item.categoryName || 'Без категории'}</Text>
          {item.description && <Text style={styles.cardDesc}>{item.description}</Text>}
        </View>
        <Text style={styles.cardAmount}>{formatMoney(item.amount)}</Text>
      </View>
      <View style={styles.cardBottom}>
        <Text style={styles.cardDate}>{formatDate(item.date)}</Text>
        {item.userName && <Text style={styles.cardUser}>{item.userName}</Text>}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← Назад</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Расходы</Text>
        <TouchableOpacity style={styles.addBtn} onPress={() => { setAmount(''); setDescription(''); setCategoryName(''); setModalOpen(true); }}>
          <Text style={styles.addBtnText}>+ Новый</Text>
        </TouchableOpacity>
      </View>

      {/* Total */}
      <View style={styles.totalCard}>
        <Text style={styles.totalLabel}>Итого за месяц</Text>
        <Text style={styles.totalValue}>{formatMoney(totalExpenses)}</Text>
      </View>

      {isLoading ? <LoadingSpinner /> : !expenses?.length ? (
        <EmptyState title="Нет расходов" description="Добавьте первый расход" action={{ label: 'Добавить', onPress: () => setModalOpen(true) }} />
      ) : (
        <FlatList data={expenses} keyExtractor={i => i.id} renderItem={renderExpense} contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />} />
      )}

      <Modal visible={modalOpen} onClose={() => setModalOpen(false)} title="Новый расход">
        <View style={styles.formField}><Text style={styles.formLabel}>Сумма</Text><TextInput value={amount} onChangeText={setAmount} style={styles.formInput} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.gray[400]} /></View>
        <View style={styles.formField}><Text style={styles.formLabel}>Категория</Text><TextInput value={categoryName} onChangeText={setCategoryName} style={styles.formInput} placeholder="Аренда, маркетинг..." placeholderTextColor={colors.gray[400]} /></View>
        <View style={styles.formField}><Text style={styles.formLabel}>Описание</Text><TextInput value={description} onChangeText={setDescription} style={[styles.formInput, { height: 60, textAlignVertical: 'top' }]} multiline placeholder="Необязательно" placeholderTextColor={colors.gray[400]} /></View>
        <View style={styles.formActions}>
          <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalOpen(false)}><Text style={styles.cancelBtnText}>Отмена</Text></TouchableOpacity>
          <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit}>
            {createMutation.isPending ? <ActivityIndicator color={colors.white} size="small" /> : <Text style={styles.submitBtnText}>Создать</Text>}
          </TouchableOpacity>
        </View>
      </Modal>
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
  totalCard: { backgroundColor: colors.white, marginHorizontal: spacing[4], marginBottom: spacing[3], borderRadius: borderRadius['2xl'], borderWidth: 1, borderColor: colors.gray[100], padding: spacing[4], flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  totalLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[700] },
  totalValue: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.red[600] },
  list: { paddingHorizontal: spacing[4], paddingBottom: spacing[8], gap: spacing[2] },
  card: { backgroundColor: colors.white, borderRadius: borderRadius.xl, borderWidth: 1, borderColor: colors.gray[100], padding: spacing[4] },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardCategory: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  cardDesc: { fontSize: fontSize.xs, color: colors.gray[500], marginTop: 2 },
  cardAmount: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.red[600] },
  cardBottom: { flexDirection: 'row', gap: spacing[3], marginTop: spacing[2], paddingTop: spacing[2], borderTopWidth: 1, borderTopColor: colors.gray[50] },
  cardDate: { fontSize: fontSize.xs, color: colors.gray[400] },
  cardUser: { fontSize: fontSize.xs, color: colors.gray[400] },
  formField: { marginBottom: spacing[4] },
  formLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700], marginBottom: spacing[1.5] },
  formInput: { backgroundColor: colors.gray[50], borderWidth: 1, borderColor: colors.gray[300], borderRadius: borderRadius.lg, paddingHorizontal: spacing[3.5], paddingVertical: spacing[2.5], fontSize: fontSize.sm, color: colors.gray[900] },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing[3], paddingTop: spacing[4], borderTopWidth: 1, borderTopColor: colors.gray[200] },
  cancelBtn: { paddingHorizontal: spacing[4], paddingVertical: spacing[2.5], borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colors.gray[300] },
  cancelBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
  submitBtn: { paddingHorizontal: spacing[4], paddingVertical: spacing[2.5], borderRadius: borderRadius.lg, backgroundColor: colors.primary[600] },
  submitBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.white },
});
