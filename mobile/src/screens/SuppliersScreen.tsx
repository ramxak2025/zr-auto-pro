import React, { useState } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput, StyleSheet,
  RefreshControl, Alert, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { suppliersApi } from '../api/services';
import SearchInput from '../components/SearchInput';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import AnimatedCard from '../components/AnimatedCard';
import Modal from '../components/Modal';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import type { Supplier } from '../../../shared/types';

function formatMoney(v: number) { return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; }

export default function SuppliersScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [comment, setComment] = useState('');

  const { data: suppliers, isLoading } = useQuery<Supplier[]>({
    queryKey: ['suppliers', search],
    queryFn: async () => { const res = await suppliersApi.getAll({ search }); return res.data?.data || res.data; },
  });

  const createMutation = useMutation({
    mutationFn: (d: any) => suppliersApi.create(d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['suppliers'] }); closeModal(); },
    onError: () => Alert.alert('Ошибка', 'Ошибка при создании'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => suppliersApi.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['suppliers'] }); closeModal(); },
    onError: () => Alert.alert('Ошибка', 'Ошибка при обновлении'),
  });

  const openCreate = () => {
    setEditingSupplier(null); setName(''); setPhone(''); setContactPerson(''); setComment('');
    setModalOpen(true);
  };

  const openEdit = (s: Supplier) => {
    setEditingSupplier(s); setName(s.name); setPhone(s.phone || ''); setContactPerson(s.contactPerson || ''); setComment(s.comment || '');
    setModalOpen(true);
  };

  const closeModal = () => { setModalOpen(false); setEditingSupplier(null); };

  const handleSubmit = () => {
    const payload = { name, phone: phone || undefined, contactPerson: contactPerson || undefined, comment: comment || undefined };
    if (editingSupplier) { updateMutation.mutate({ id: editingSupplier.id, data: payload }); }
    else { createMutation.mutate(payload); }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    setRefreshing(false);
  };

  const renderSupplier = ({ item, index }: { item: Supplier; index: number }) => (
    <AnimatedCard
      style={styles.card}
      index={index}
      onPress={() => navigation.navigate('SupplierDetail', { id: item.id })}
    >
      <View style={styles.cardTop}>
        <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
        {item.currentDebt > 0 && (
          <View style={styles.debtBadge}>
            <Text style={styles.debtBadgeText}>Долг: {formatMoney(item.currentDebt)}</Text>
          </View>
        )}
      </View>
      {item.contactPerson && (
        <View style={styles.contactRow}>
          <Ionicons name="person-outline" size={13} color={colors.gray[400]} />
          <Text style={styles.cardSub}>{item.contactPerson}</Text>
        </View>
      )}
      {item.phone && (
        <View style={styles.contactRow}>
          <Ionicons name="call-outline" size={13} color={colors.gray[400]} />
          <Text style={styles.cardSub}>{item.phone}</Text>
        </View>
      )}
      <View style={styles.cardStats}>
        <Text style={styles.cardStatLabel}>Покупки: {formatMoney(item.totalPurchases)}</Text>
        <Text style={styles.cardStatLabel}>Оплачено: {formatMoney(item.totalPaid)}</Text>
      </View>
    </AnimatedCard>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={22} color={colors.gray[700]} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <LinearGradient
            colors={[colors.orange[500], colors.orange[600]] as [string, string]}
            style={styles.headerIcon}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <Ionicons name="business-outline" size={18} color={colors.white} />
          </LinearGradient>
          <Text style={styles.title}>Поставщики</Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={openCreate}>
          <Text style={styles.addBtnText}>+ Новый</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.searchWrap}>
        <SearchInput value={search} onChange={setSearch} placeholder="Поиск поставщика..." />
      </View>

      {isLoading ? <LoadingSpinner /> : !suppliers?.length ? (
        <EmptyState title="Нет поставщиков" description="Добавьте первого поставщика" action={{ label: 'Добавить', onPress: openCreate }} />
      ) : (
        <FlatList data={suppliers} keyExtractor={i => i.id} renderItem={renderSupplier} contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />} />
      )}

      <Modal visible={modalOpen} onClose={closeModal} title={editingSupplier ? 'Редактировать' : 'Новый поставщик'}>
        <View style={styles.formField}><Text style={styles.formLabel}>Название</Text><TextInput value={name} onChangeText={setName} style={styles.formInput} placeholder="ООО Запчасти" placeholderTextColor={colors.gray[400]} /></View>
        <View style={styles.formField}><Text style={styles.formLabel}>Телефон</Text><TextInput value={phone} onChangeText={setPhone} style={styles.formInput} keyboardType="phone-pad" placeholder="+7..." placeholderTextColor={colors.gray[400]} /></View>
        <View style={styles.formField}><Text style={styles.formLabel}>Контактное лицо</Text><TextInput value={contactPerson} onChangeText={setContactPerson} style={styles.formInput} placeholder="Имя" placeholderTextColor={colors.gray[400]} /></View>
        <View style={styles.formField}><Text style={styles.formLabel}>Комментарий</Text><TextInput value={comment} onChangeText={setComment} style={[styles.formInput, { height: 60, textAlignVertical: 'top' }]} multiline placeholder="Необязательно" placeholderTextColor={colors.gray[400]} /></View>
        <View style={styles.formActions}>
          <TouchableOpacity style={styles.cancelBtn} onPress={closeModal}><Text style={styles.cancelBtnText}>Отмена</Text></TouchableOpacity>
          <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit}>
            {(createMutation.isPending || updateMutation.isPending) ? <ActivityIndicator color={colors.white} size="small" /> : <Text style={styles.submitBtnText}>{editingSupplier ? 'Сохранить' : 'Создать'}</Text>}
          </TouchableOpacity>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing[4], paddingVertical: spacing[3] },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  headerIcon: { width: 36, height: 36, borderRadius: borderRadius.xl, alignItems: 'center', justifyContent: 'center' },
  backText: { fontSize: fontSize.sm, color: colors.primary[600], fontWeight: fontWeight.medium },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.gray[900] },
  addBtn: { backgroundColor: colors.primary[600], paddingHorizontal: spacing[4], paddingVertical: spacing[2.5], borderRadius: borderRadius.lg },
  addBtnText: { color: colors.white, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  searchWrap: { paddingHorizontal: spacing[4] },
  list: { paddingHorizontal: spacing[4], paddingBottom: spacing[8], gap: spacing[3] },
  card: { backgroundColor: colors.white, borderRadius: borderRadius.xl, borderWidth: 1, borderColor: colors.gray[100], padding: spacing[4] },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[1] },
  cardName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900], flex: 1 },
  debtBadge: { backgroundColor: colors.red[50], paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: borderRadius.full },
  debtBadgeText: { fontSize: 11, color: colors.red[600], fontWeight: fontWeight.medium },
  contactRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  cardSub: { fontSize: fontSize.xs, color: colors.gray[500] },
  cardStats: { flexDirection: 'row', gap: spacing[4], marginTop: spacing[2], paddingTop: spacing[2], borderTopWidth: 1, borderTopColor: colors.gray[50] },
  cardStatLabel: { fontSize: fontSize.xs, color: colors.gray[400] },
  formField: { marginBottom: spacing[4] },
  formLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700], marginBottom: spacing[1.5] },
  formInput: { backgroundColor: colors.gray[50], borderWidth: 1, borderColor: colors.gray[300], borderRadius: borderRadius.lg, paddingHorizontal: spacing[3.5], paddingVertical: spacing[2.5], fontSize: fontSize.sm, color: colors.gray[900] },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing[3], paddingTop: spacing[4], borderTopWidth: 1, borderTopColor: colors.gray[200] },
  cancelBtn: { paddingHorizontal: spacing[4], paddingVertical: spacing[2.5], borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colors.gray[300] },
  cancelBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
  submitBtn: { paddingHorizontal: spacing[4], paddingVertical: spacing[2.5], borderRadius: borderRadius.lg, backgroundColor: colors.primary[600] },
  submitBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.white },
});
