import React, { useState } from 'react';
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
import IosScreenHeader from '../components/IosScreenHeader';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { clientsApi, carsApi } from '../api/services';
import type { Car } from '../../../shared/types';
import { formatPhone } from '../../../shared/validation/phone';
import { useAuth } from '../contexts/AuthContext';
import SearchInput from '../components/SearchInput';
import LoadingSpinner from '../components/LoadingSpinner';
import { ListSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import AnimatedCard from '../components/AnimatedCard';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import DuplicateWarningDialog from '../components/DuplicateWarningDialog';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import type { Client, PaginatedResponse } from '../../../shared/types';

export default function ClientsScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const tabBarHeight = useTabBarHeight();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  // 'clients' = list of clients,  'cars' = same screen but car list below
  const [mode, setMode] = useState<'clients' | 'cars'>('clients');

  // Cars query — only fires while mode === 'cars' so we don't waste bandwidth
  const carsQuery = useQuery<{ data: Car[]; total: number } | Car[]>({
    queryKey: ['cars', { search, page, limit: 20 }],
    queryFn: async () => {
      const res = await carsApi.getAll({ search, page, limit: 20 });
      return res.data;
    },
    enabled: mode === 'cars',
    placeholderData: (prev) => prev as any,
  });
  const carsList: Car[] = Array.isArray(carsQuery.data) ? (carsQuery.data as Car[]) : (carsQuery.data?.data ?? []);
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
    queryFn: async () => {
      const res = await clientsApi.getAll({ search, page, limit });
      return res.data;
    },
    // Local re-assertion of the global SWR — keeps the previous page
    // visible while pagination/search keys mutate, eliminating the
    // skeleton-flash between filters.
    placeholderData: (prev) => prev,
  });

  const createMutation = useMutation({
    mutationFn: (d: { fullName: string; phone: string; comment?: string }) => clientsApi.create(d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      closeModal();
    },
    onError: () => Alert.alert('Ошибка', 'Ошибка при создании клиента'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => clientsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      closeModal();
    },
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

  const closeModal = () => {
    setModalOpen(false);
    setEditingClient(null);
  };

  // Duplicate-by-phone dialog state. Mirrors the web flow in ClientsPage:
  // before creating a new client, ping clientsApi.lookupByPhone — if the
  // tenant already has someone with that phone, show a warning popup with
  // an option to open the existing card or create a duplicate anyway.
  const [duplicateClient, setDuplicateClient] = useState<{
    id: string;
    fullName: string;
    phone: string;
    cars?: Array<{ plateNumber: string; makeModel: string }>;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    const payload = { fullName, phone, comment: comment || undefined };
    if (editingClient) {
      updateMutation.mutate({ id: editingClient.id, data: payload });
      return;
    }
    setSubmitting(true);
    try {
      const res = await clientsApi.lookupByPhone(phone);
      const existing = res.data;
      if (existing) {
        setDuplicateClient(existing);
        return;
      }
      createMutation.mutate(payload);
    } catch {
      // Fall back to creating if the lookup endpoint hiccups.
      createMutation.mutate(payload);
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateAnyway = () => {
    setDuplicateClient(null);
    createMutation.mutate({ fullName, phone, comment: comment || undefined });
  };

  const handleOpenExistingClient = () => {
    if (!duplicateClient) return;
    const id = duplicateClient.id;
    setDuplicateClient(null);
    setModalOpen(false);
    (navigation as any).navigate('ClientDetail', { id });
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
          <Text style={{ fontSize: fontSize.xs, color: colors.gray[400], marginTop: spacing[1] }}>{item.comment}</Text>
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
          <Text style={styles.clientName} numberOfLines={1}>
            {item.fullName}
          </Text>
          <View style={styles.clientActions}>
            <TouchableOpacity onPress={() => openEditModal(item)} style={styles.actionBtn}>
              <Ionicons name="create-outline" size={16} color={colors.gray[400]} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setDeleteId(item.id);
                setConfirmOpen(true);
              }}
              style={styles.actionBtn}
            >
              <Ionicons name="close" size={16} color={colors.red[400]} />
            </TouchableOpacity>
          </View>
        </View>
        <View style={styles.clientBottom}>
          <View style={styles.phoneRow}>
            <Ionicons name="call-outline" size={13} color={colors.gray[400]} />
            <Text style={styles.clientPhone}>{formatPhone(item.phone)}</Text>
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
    <View style={styles.safe}>
      <IosScreenHeader
        title="Клиенты"
        trailing={
          <TouchableOpacity style={styles.addBtn} onPress={openCreateModal}>
            <Text style={styles.addBtnText}>+ Новый</Text>
          </TouchableOpacity>
        }
      />

      {/* Clients ⇄ Cars — single screen with an in-place segmented control.
          Tapping a tab swaps which list is rendered below; no navigation,
          no full-screen transition, no animation. The search bar is shared
          (its placeholder updates per mode). */}
      <View style={cnStyles.segmentWrap}>
        <View style={cnStyles.segment}>
          <TouchableOpacity
            style={[cnStyles.segmentItem, mode === 'clients' && cnStyles.segmentActive]}
            onPress={() => {
              setMode('clients');
              setSearch('');
              setPage(1);
            }}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            <Ionicons name="people" size={14} color={mode === 'clients' ? colors.primary[700] : colors.gray[500]} />
            <Text style={mode === 'clients' ? cnStyles.segmentLabelActive : cnStyles.segmentLabelInactive}>
              Клиенты
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[cnStyles.segmentItem, mode === 'cars' && cnStyles.segmentActive]}
            onPress={() => {
              setMode('cars');
              setSearch('');
              setPage(1);
            }}
            hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
          >
            <Ionicons name="car-sport" size={14} color={mode === 'cars' ? colors.primary[700] : colors.gray[500]} />
            <Text style={mode === 'cars' ? cnStyles.segmentLabelActive : cnStyles.segmentLabelInactive}>Авто</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Search — placeholder switches with mode */}
      <View style={styles.searchWrap}>
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          placeholder={mode === 'clients' ? 'Поиск по имени или телефону...' : 'Поиск по госномеру или марке...'}
        />
      </View>

      {/* Content — single screen renders either clients or cars based on mode */}
      {mode === 'cars' ? (
        // Cold-start guard: only show skeleton while we genuinely have
        // no data yet (cache miss + no prefetch). Once data exists,
        // SWR keeps it visible across filter changes — no flash.
        carsQuery.data === undefined ? (
          <ListSkeleton count={8} />
        ) : carsList.length === 0 && !carsQuery.isLoading ? (
          <EmptyState
            title="Нет автомобилей"
            description={search ? 'Ничего не найдено' : 'Добавьте машину к клиенту'}
          />
        ) : (
          <FlashList
            data={carsList}
            keyExtractor={(item: Car) => item.id}
            renderItem={({ item }: { item: Car }) => (
              <View style={cnStyles.carRow}>
                <View style={cnStyles.carIconBox}>
                  <Ionicons name="car-sport-outline" size={18} color={colors.primary[600]} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={cnStyles.carName} numberOfLines={1}>
                    {item.makeModel || '—'}
                  </Text>
                  {item.plateNumber && (
                    <View style={cnStyles.platePill}>
                      <Text style={cnStyles.platePillText}>{item.plateNumber}</Text>
                    </View>
                  )}
                </View>
                {item.client?.fullName && (
                  <TouchableOpacity onPress={() => navigation.navigate('ClientDetail', { id: item.client!.id })}>
                    <Text style={cnStyles.carClient} numberOfLines={1}>
                      {item.client.fullName}
                    </Text>
                  </TouchableOpacity>
                )}
                <Ionicons name="chevron-forward" size={14} color={colors.gray[300]} />
              </View>
            )}
            contentContainerStyle={{ ...styles.list, paddingBottom: tabBarHeight + spacing[4] }}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
            }
          />
        )
      ) : data === undefined ? (
        // Cold-start: no cached value AND no prefetch hit yet — show
        // the skeleton instead of an EmptyState. EmptyState ("Нет
        // клиентов") on cold-start was the perceived "пусто" flash.
        <ListSkeleton count={8} />
      ) : clients.length === 0 && !search && !isLoading ? (
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
          contentContainerStyle={{ ...styles.list, paddingBottom: tabBarHeight + spacing[4] }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
          }
          onEndReached={() => {
            if (hasMore) setPage((p) => p + 1);
          }}
          onEndReachedThreshold={0.5}
        />
      )}

      {/* Create/Edit Modal */}
      <Modal visible={modalOpen} onClose={closeModal} title={editingClient ? 'Редактировать' : 'Новый клиент'}>
        <View style={styles.formField}>
          <Text style={styles.formLabel}>ФИО</Text>
          <TextInput
            value={fullName}
            onChangeText={setFullName}
            style={styles.formInput}
            placeholder="Введите ФИО клиента"
            placeholderTextColor={colors.gray[400]}
          />
        </View>
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Телефон</Text>
          <TextInput
            value={phone}
            onChangeText={setPhone}
            style={styles.formInput}
            placeholder="+7 (___) ___-__-__"
            keyboardType="phone-pad"
            placeholderTextColor={colors.gray[400]}
          />
        </View>
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Комментарий</Text>
          <TextInput
            value={comment}
            onChangeText={setComment}
            style={[styles.formInput, { height: 80, textAlignVertical: 'top' }]}
            placeholder="Необязательно"
            multiline
            placeholderTextColor={colors.gray[400]}
          />
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
            {createMutation.isPending || updateMutation.isPending ? (
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
        onConfirm={() => {
          if (deleteId) deleteMutation.mutate(deleteId);
          setDeleteId(null);
        }}
        title="Удалить клиента"
        message="Вы уверены? Это действие нельзя отменить."
        confirmText="Удалить"
        variant="danger"
      />

      <DuplicateWarningDialog
        visible={!!duplicateClient}
        onClose={() => setDuplicateClient(null)}
        onCreateAnyway={handleCreateAnyway}
        onOpenExisting={handleOpenExistingClient}
        title="Такой клиент уже есть"
        description={`Клиент с этим телефоном уже существует. Открыть существующего или всё равно создать?`}
        existingLabel={duplicateClient?.fullName || ''}
        existingSubtitle={duplicateClient?.phone}
        existingCars={duplicateClient?.cars}
        openExistingLabel="Открыть карточку"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  headerIcon: { width: 36, height: 36, borderRadius: borderRadius.xl, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.gray[900] },
  addBtn: {
    backgroundColor: colors.primary[600],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
  },
  addBtnText: { color: colors.white, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  searchWrap: { paddingHorizontal: spacing[4] },
  list: { paddingHorizontal: spacing[4], paddingBottom: spacing[8], gap: spacing[3] },
  clientCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.gray[100],
    padding: spacing[4],
    shadowColor: colors.black,
    shadowOpacity: 0.05,
    shadowRadius: 3,
    elevation: 2,
  },
  clientTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing[2] },
  clientName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900], flex: 1 },
  clientActions: { flexDirection: 'row', gap: spacing[1] },
  actionBtn: { padding: spacing[1.5] },
  actionIcon: { fontSize: 14, color: colors.gray[400] },
  clientBottom: { flexDirection: 'row', alignItems: 'center', gap: spacing[4] },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  clientPhone: { fontSize: fontSize.sm, color: colors.gray[500] },
  carsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.blue[50],
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  carsBadgeText: { fontSize: 11, color: colors.blue[700], fontWeight: fontWeight.medium },
  // Form
  formField: { marginBottom: spacing[4] },
  formLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.gray[700],
    marginBottom: spacing[1.5],
  },
  formInput: {
    backgroundColor: colors.gray[50],
    borderWidth: 1,
    borderColor: colors.gray[300],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[2.5],
    fontSize: fontSize.sm,
    color: colors.gray[900],
  },
  formActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[3],
    paddingTop: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colors.gray[200],
  },
  cancelBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.gray[300],
  },
  cancelBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
  submitBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primary[600],
  },
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

// Standalone styles for the Clients ⇄ Cars segmented control. Kept apart
// from `styles` so the same block can be reused verbatim in CarsScreen.
const cnStyles = StyleSheet.create({
  segmentWrap: { paddingHorizontal: spacing[4], paddingBottom: spacing[2] },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.gray[100],
    borderRadius: 12,
    padding: 3,
    gap: 2,
    alignSelf: 'flex-start',
  },
  segmentItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 9,
    minWidth: 96,
    justifyContent: 'center',
  },
  segmentActive: {
    backgroundColor: colors.white,
    shadowColor: colors.black,
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  segmentLabelActive: { fontSize: 13, fontWeight: '700', color: colors.primary[700] },
  segmentLabelInactive: { fontSize: 13, fontWeight: '500', color: colors.gray[600] },
  // Car list rows used inside ClientsScreen when mode === 'cars'
  carRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    backgroundColor: colors.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray[200],
  },
  carIconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  carName: { fontSize: 14, fontWeight: '600', color: colors.gray[900] },
  platePill: {
    alignSelf: 'flex-start',
    marginTop: 4,
    backgroundColor: colors.gray[100],
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
  },
  platePillText: { fontSize: 11, fontWeight: '700', color: colors.gray[800], letterSpacing: 0.5 },
  carClient: { fontSize: 11, color: colors.gray[500], maxWidth: 100, marginRight: 4 },
});
