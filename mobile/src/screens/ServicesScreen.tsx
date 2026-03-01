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
import { servicesApi } from '../api/services';
import SearchInput from '../components/SearchInput';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import AnimatedCard from '../components/AnimatedCard';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import type { Service, PaginatedResponse } from '../../../shared/types';

function formatMoney(v: number) { return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'; }

export default function ServicesScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const limit = 30;
  const [refreshing, setRefreshing] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [defaultPrice, setDefaultPrice] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data, isLoading } = useQuery<PaginatedResponse<Service>>({
    queryKey: ['services', { search, page, limit }],
    queryFn: async () => { const res = await servicesApi.getAll({ search, page, limit }); return res.data; },
  });

  const createMutation = useMutation({
    mutationFn: (d: any) => servicesApi.create(d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['services'] }); closeModal(); },
    onError: () => Alert.alert('Ошибка', 'Ошибка при создании'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => servicesApi.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['services'] }); closeModal(); },
    onError: () => Alert.alert('Ошибка', 'Ошибка при обновлении'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => servicesApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['services'] }),
    onError: () => Alert.alert('Ошибка', 'Ошибка при удалении'),
  });

  const openCreate = () => {
    setEditingService(null);
    setName(''); setCategory(''); setDefaultPrice('');
    setModalOpen(true);
  };

  const openEdit = (s: Service) => {
    setEditingService(s);
    setName(s.name); setCategory(s.category || ''); setDefaultPrice(String(s.defaultPrice));
    setModalOpen(true);
  };

  const closeModal = () => { setModalOpen(false); setEditingService(null); };

  const handleSubmit = () => {
    const payload = { name, category: category || undefined, defaultPrice: Number(defaultPrice) || 0 };
    if (editingService) {
      updateMutation.mutate({ id: editingService.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['services'] });
    setRefreshing(false);
  };

  const services = data?.data || [];
  const total = data?.total || 0;
  const hasMore = page * limit < total;

  const renderService = ({ item, index }: { item: Service; index: number }) => (
    <AnimatedCard style={styles.serviceCard} index={index} onPress={() => openEdit(item)}>
      <View style={styles.serviceInfo}>
        <Text style={styles.serviceName} numberOfLines={1}>{item.name}</Text>
        {item.category && <Text style={styles.serviceCategory}>{item.category}</Text>}
      </View>
      <Text style={styles.servicePrice}>{formatMoney(item.defaultPrice)}</Text>
    </AnimatedCard>
  );

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <LinearGradient
        colors={[colors.white, colors.gray[50]] as [string, string]}
        style={styles.header}
      >
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={20} color={colors.primary[600]} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <LinearGradient
            colors={[colors.primary[400], colors.primary[600]] as [string, string]}
            style={styles.headerIcon}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <Ionicons name="construct-outline" size={16} color={colors.white} />
          </LinearGradient>
          <Text style={styles.title}>Услуги</Text>
          {total > 0 && (
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{total}</Text>
            </View>
          )}
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={openCreate}>
          <Text style={styles.addBtnText}>+ Новая</Text>
        </TouchableOpacity>
      </LinearGradient>

      <View style={styles.searchWrap}>
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Поиск услуги..." />
      </View>

      {isLoading ? (
        <LoadingSpinner />
      ) : services.length === 0 ? (
        <EmptyState title="Нет услуг" description={search ? 'Ничего не найдено' : 'Добавьте первую услугу'} action={!search ? { label: 'Добавить', onPress: openCreate } : undefined} />
      ) : (
        <FlatList
          data={services}
          keyExtractor={(item) => item.id}
          renderItem={renderService}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />}
          onEndReached={() => { if (hasMore) setPage(p => p + 1); }}
          onEndReachedThreshold={0.5}
        />
      )}

      <Modal visible={modalOpen} onClose={closeModal} title={editingService ? 'Редактировать услугу' : 'Новая услуга'}>
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Название</Text>
          <TextInput value={name} onChangeText={setName} style={styles.formInput} placeholder="Замена масла..." placeholderTextColor={colors.gray[400]} />
        </View>
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Категория</Text>
          <TextInput value={category} onChangeText={setCategory} style={styles.formInput} placeholder="ТО, кузов..." placeholderTextColor={colors.gray[400]} />
        </View>
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Цена по умолчанию</Text>
          <TextInput value={defaultPrice} onChangeText={setDefaultPrice} style={styles.formInput} keyboardType="numeric" placeholder="0" placeholderTextColor={colors.gray[400]} />
        </View>
        <View style={styles.formActions}>
          <TouchableOpacity style={styles.cancelBtn} onPress={closeModal}>
            <Text style={styles.cancelBtnText}>Отмена</Text>
          </TouchableOpacity>
          {editingService && (
            <TouchableOpacity style={styles.deleteFormBtn} onPress={() => { setDeleteId(editingService.id); closeModal(); }}>
              <Text style={styles.deleteFormBtnText}>Удалить</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit}>
            {(createMutation.isPending || updateMutation.isPending) ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={styles.submitBtnText}>{editingService ? 'Сохранить' : 'Создать'}</Text>
            )}
          </TouchableOpacity>
        </View>
      </Modal>

      <ConfirmDialog visible={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={() => { if (deleteId) deleteMutation.mutate(deleteId); setDeleteId(null); }} title="Удалить услугу" message="Вы уверены?" confirmText="Удалить" variant="danger" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing[4], paddingVertical: spacing[3], borderBottomWidth: 1, borderBottomColor: colors.gray[100] },
  backBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary[50], alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  headerIcon: { width: 30, height: 30, borderRadius: borderRadius.lg, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.gray[900], letterSpacing: -0.3 },
  countBadge: { backgroundColor: colors.primary[50], paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: borderRadius.full },
  countBadgeText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.primary[600] },
  addBtn: { backgroundColor: colors.primary[600], paddingHorizontal: spacing[4], paddingVertical: spacing[2.5], borderRadius: borderRadius.lg },
  addBtnText: { color: colors.white, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  searchWrap: { paddingHorizontal: spacing[4] },
  list: { paddingHorizontal: spacing[4], paddingBottom: spacing[8], gap: spacing[2] },
  serviceCard: { backgroundColor: colors.white, borderRadius: borderRadius.xl, borderWidth: 1, borderColor: colors.gray[100], padding: spacing[4], flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', shadowColor: colors.black, shadowOpacity: 0.05, shadowRadius: 2, elevation: 1 },
  serviceInfo: { flex: 1, minWidth: 0 },
  serviceName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  serviceCategory: { fontSize: fontSize.xs, color: colors.gray[400], marginTop: 2 },
  servicePrice: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.primary[600], marginLeft: spacing[3] },
  formField: { marginBottom: spacing[4] },
  formLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700], marginBottom: spacing[1.5] },
  formInput: { backgroundColor: colors.gray[50], borderWidth: 1, borderColor: colors.gray[300], borderRadius: borderRadius.lg, paddingHorizontal: spacing[3.5], paddingVertical: spacing[2.5], fontSize: fontSize.sm, color: colors.gray[900] },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing[3], paddingTop: spacing[4], borderTopWidth: 1, borderTopColor: colors.gray[200] },
  cancelBtn: { paddingHorizontal: spacing[4], paddingVertical: spacing[2.5], borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colors.gray[300] },
  cancelBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
  deleteFormBtn: { paddingHorizontal: spacing[4], paddingVertical: spacing[2.5], borderRadius: borderRadius.lg, backgroundColor: colors.red[50] },
  deleteFormBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.red[600] },
  submitBtn: { paddingHorizontal: spacing[4], paddingVertical: spacing[2.5], borderRadius: borderRadius.lg, backgroundColor: colors.primary[600] },
  submitBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.white },
});
