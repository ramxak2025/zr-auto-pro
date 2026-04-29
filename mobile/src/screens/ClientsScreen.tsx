import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, TextInput, StyleSheet,
  RefreshControl, Alert, ActivityIndicator,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { clientsApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import SearchInput from '../components/SearchInput';
import LoadingSpinner from '../components/LoadingSpinner';
import { ListSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import AnimatedCard from '../components/AnimatedCard';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import type { Client, PaginatedResponse } from '../../../shared/types';

export default function ClientsScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const limit = 20;
  const [refreshing, setRefreshing] = useState(false);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [comment, setComment] = useState('');

  // Delete confirm
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data, isLoading } = useQuery<PaginatedResponse<Client>>({
    queryKey: ['clients', { search, page, limit }],
    queryFn: async () => { const res = await clientsApi.getAll({ search, page, limit }); return res.data; },
  });

  const createMutation = useMutation({
    mutationFn: (d: { fullName: string; phone: string; comment?: string }) => clientsApi.create(d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['clients'] }); closeModal(); },
    onError: () => Alert.alert('Ошибка', 'Ошибка при создании клиента'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => clientsApi.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['clients'] }); closeModal(); },
    onError: () => Alert.alert('Ошибка', 'Ошибка при обновлении клиента'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => clientsApi.remove(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['clients'] }),
    onError: () => Alert.alert('Ошибка', 'Ошибка при удалении клиента'),
  });

  const openCreateModal = () => {
    setEditingClient(null);
    setFullName('');
    setPhone('');
    setComment('');
    setModalOpen(true);
  };

  const openEditModal = (client: Client) => {
    setEditingClient(client);
    setFullName(client.fullName);
    setPhone(client.phone);
    setComment(client.comment || '');
    setModalOpen(true);
  };

  const closeModal = () => { setModalOpen(false); setEditingClient(null); };

  const handleSubmit = () => {
    const payload = { fullName, phone, comment: comment || undefined };
    if (editingClient) {
      updateMutation.mutate({ id: editingClient.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['clients'] });
    setRefreshing(false);
  };

  const clients = data?.data || [];
  const total = data?.total || 0;
  const hasMore = page * limit < total;

  const retailBuyer: Client = {
    id: '__retail__',
    fullName: 'Розничный покупатель',
    phone: '',
    comment: 'Все чеки без клиента — автоматически розничный покупатель',
    tenantId: '',
    createdAt: '',
  } as Client;

  // Pin "Розничный покупатель" at top when not searching
  const displayClients = !search ? [retailBuyer, ...clients] : clients;

  const renderClient = ({ item, index }: { item: Client; index: number }) => {
    // Special render for pinned retail buyer
    if (item.id === '__retail__') {
      return (
        <View style={[styles.clientCard, styles.retailCard]}>
          <View style={styles.clientTop}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2], flex: 1 }}>
              <View style={styles.retailIcon}>
                <Ionicons name="storefront-outline" size={16} color={colors.primary[600]} />
              </View>
              <Text style={[styles.clientName, { color: colors.primary[700] }]}>{item.fullName}</Text>
            </View>
            <View style={styles.retailBadge}>
              <Text style={styles.retailBadgeText}>По умолчанию</Text>
            </View>
          </View>
          <Text style={{ fontSize: fontSize.xs, color: colors.gray[400], marginTop: spacing[1] }}>
            {item.comment}
          </Text>
        </View>
      );
    }

    return (
    <AnimatedCard
      style={styles.clientCard}
      index={index}
      onPress={() => navigation.navigate('ClientDetail', { id: item.id })}
    >
      <View style={styles.clientTop}>
        <Text style={styles.clientName} numberOfLines={1}>{item.fullName}</Text>
        <View style={styles.clientActions}>
          <TouchableOpacity onPress={() => openEditModal(item)} style={styles.actionBtn}>
            <Ionicons name="create-outline" size={16} color={colors.gray[400]} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => { setDeleteId(item.id); setConfirmOpen(true); }}
            style={styles.actionBtn}
          >
            <Ionicons name="close" size={16} color={colors.red[400]} />
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.clientBottom}>
        <View style={styles.phoneRow}>
          <Ionicons name="call-outline" size={13} color={colors.gray[400]} />
          <Text style={styles.clientPhone}>{item.phone}</Text>
        </View>
        <View style={styles.carsBadge}>
          <Ionicons name="car-outline" size={12} color={colors.blue[700]} />
          <Text style={styles.carsBadgeText}>{item.cars?.length || 0} авто</Text>
        </View>
      </View>
    </AnimatedCard>
  );
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerCenter}>
          <LinearGradient
            colors={[colors.blue[500], colors.blue[700]] as [string, string]}
            style={styles.headerIcon}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          >
            <Ionicons name="people-outline" size={18} color={colors.white} />
          </LinearGradient>
          <Text style={styles.title}>Клиенты</Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={openCreateModal}>
          <Text style={styles.addBtnText}>+ Новый</Text>
        </TouchableOpacity>
      </View>

      {/* Search */}
      <View style={styles.searchWrap}>
        <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Поиск по имени или телефону..." />
      </View>

      {/* Content */}
      {isLoading ? (
        <ListSkeleton count={8} />
      ) : clients.length === 0 && !search ? (
        <EmptyState
          title="Нет клиентов"
          description="Добавьте первого клиента"
          action={{ label: 'Добавить клиента', onPress: openCreateModal }}
        />
      ) : (
        <FlashList
          data={displayClients}
          keyExtractor={(item) => item.id}
          renderItem={renderClient}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />}
          onEndReached={() => { if (hasMore) setPage(p => p + 1); }}
          onEndReachedThreshold={0.5}
        />
      )}

      {/* Create/Edit Modal */}
      <Modal visible={modalOpen} onClose={closeModal} title={editingClient ? 'Редактировать' : 'Новый клиент'}>
        <View style={styles.formField}>
          <Text style={styles.formLabel}>ФИО</Text>
          <TextInput value={fullName} onChangeText={setFullName} style={styles.formInput} placeholder="Введите ФИО клиента" placeholderTextColor={colors.gray[400]} />
        </View>
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Телефон</Text>
          <TextInput value={phone} onChangeText={setPhone} style={styles.formInput} placeholder="+7 (___) ___-__-__" keyboardType="phone-pad" placeholderTextColor={colors.gray[400]} />
        </View>
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Комментарий</Text>
          <TextInput value={comment} onChangeText={setComment} style={[styles.formInput, { height: 80, textAlignVertical: 'top' }]} placeholder="Необязательно" multiline placeholderTextColor={colors.gray[400]} />
        </View>
        <View style={styles.formActions}>
          <TouchableOpacity style={styles.cancelBtn} onPress={closeModal}>
            <Text style={styles.cancelBtnText}>Отмена</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.submitBtn}
            onPress={handleSubmit}
            disabled={createMutation.isPending || updateMutation.isPending}
          >
            {(createMutation.isPending || updateMutation.isPending) ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={styles.submitBtnText}>{editingClient ? 'Сохранить' : 'Создать'}</Text>
            )}
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Delete Confirm */}
      <ConfirmDialog
        visible={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => { if (deleteId) deleteMutation.mutate(deleteId); setDeleteId(null); }}
        title="Удалить клиента"
        message="Вы уверены? Это действие нельзя отменить."
        confirmText="Удалить"
        variant="danger"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing[4], paddingVertical: spacing[3] },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  headerIcon: { width: 36, height: 36, borderRadius: borderRadius.xl, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.gray[900] },
  addBtn: { backgroundColor: colors.primary[600], paddingHorizontal: spacing[4], paddingVertical: spacing[2.5], borderRadius: borderRadius.lg },
  addBtnText: { color: colors.white, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  searchWrap: { paddingHorizontal: spacing[4] },
  list: { paddingHorizontal: spacing[4], paddingBottom: spacing[8], gap: spacing[3] },
  clientCard: {
    backgroundColor: colors.white, borderRadius: borderRadius.xl, borderWidth: 1, borderColor: colors.gray[100],
    padding: spacing[4], shadowColor: colors.black, shadowOpacity: 0.05, shadowRadius: 3, elevation: 2,
  },
  clientTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[2] },
  clientName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900], flex: 1 },
  clientActions: { flexDirection: 'row', gap: spacing[1] },
  actionBtn: { padding: spacing[1.5] },
  actionIcon: { fontSize: 14, color: colors.gray[400] },
  clientBottom: { flexDirection: 'row', alignItems: 'center', gap: spacing[4] },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  clientPhone: { fontSize: fontSize.sm, color: colors.gray[500] },
  carsBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.blue[50], paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: borderRadius.sm },
  carsBadgeText: { fontSize: 11, color: colors.blue[700], fontWeight: fontWeight.medium },
  // Form
  formField: { marginBottom: spacing[4] },
  formLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700], marginBottom: spacing[1.5] },
  formInput: { backgroundColor: colors.gray[50], borderWidth: 1, borderColor: colors.gray[300], borderRadius: borderRadius.lg, paddingHorizontal: spacing[3.5], paddingVertical: spacing[2.5], fontSize: fontSize.sm, color: colors.gray[900] },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing[3], paddingTop: spacing[4], borderTopWidth: 1, borderTopColor: colors.gray[200] },
  cancelBtn: { paddingHorizontal: spacing[4], paddingVertical: spacing[2.5], borderRadius: borderRadius.lg, borderWidth: 1, borderColor: colors.gray[300] },
  cancelBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
  submitBtn: { paddingHorizontal: spacing[4], paddingVertical: spacing[2.5], borderRadius: borderRadius.lg, backgroundColor: colors.primary[600] },
  submitBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.white },
  // Retail buyer card
  retailCard: {
    borderColor: colors.primary[200],
    borderWidth: 1.5,
    backgroundColor: colors.primary[50],
    borderStyle: 'dashed' as any,
  },
  retailIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.primary[100],
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  retailBadge: {
    backgroundColor: colors.primary[100],
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
    borderRadius: borderRadius.sm,
  },
  retailBadgeText: {
    fontSize: 10,
    fontWeight: fontWeight.semibold,
    color: colors.primary[600],
  },
});
