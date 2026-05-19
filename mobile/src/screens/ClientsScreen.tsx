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
import { Swipeable } from 'react-native-gesture-handler';
import IosScreenHeader from '../components/IosScreenHeader';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { clientsApi, carsApi } from '../api/services';
import type { Car } from '../../../shared/types';
import { formatPhone } from '../../../shared/validation/phone';
import { processPlateMainInput } from '../utils/plateMask';
import { useAuth } from '../contexts/AuthContext';
import { UserRole } from '../../../shared/types';
import SearchInput from '../components/SearchInput';
import { ListSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import DuplicateWarningDialog from '../components/DuplicateWarningDialog';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import type { Client, PaginatedResponse } from '../../../shared/types';

// ─── Avatar helpers (mirror ClientDetailScreen so initials/colour match) ───
function getInitials(name: string): string {
  const parts = (name || '').trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0]?.[0] || '?').toUpperCase();
}

const AVATAR_PALETTE = [
  colors.primary[500],
  colors.green[600],
  colors.orange[500],
  colors.purple[700],
  colors.teal[600],
  colors.rose[500],
  colors.indigo[600],
  colors.yellow[600],
];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

export default function ClientsScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const { hasPermission, isRole } = useAuth();
  const canDelete = isRole(UserRole.SUPERADMIN, UserRole.DIRECTOR) || hasPermission('clients_edit');
  const tabBarHeight = useTabBarHeight();

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  // 'clients' = list of clients, 'cars' = same screen but car list below.
  // Default = 'cars' per product owner: when this screen opens the user is
  // most often looking for a vehicle (e.g. госномер of a car about to be
  // serviced), not a person — surface cars first.
  const [mode, setMode] = useState<'cars' | 'clients'>('cars');

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

  const renderClient = ({ item }: { item: Client; index: number }) => {
    // Pinned retail buyer — same row geometry, branded icon instead of
    // initials so it reads as a "system" entry above the alphabet. Tap
    // opens the virtual retail-buyer view (ClientDetail with id
    // '__retail__') — list of all checks paid by walk-in retail.
    if (item.id === '__retail__') {
      return (
        <TouchableOpacity
          style={styles.row}
          activeOpacity={0.6}
          onPress={() => navigation.navigate('ClientDetail', { id: '__retail__' })}
        >
          <View style={[styles.avatar, { backgroundColor: colors.primary[50] }]}>
            <Ionicons name="storefront-outline" size={18} color={colors.primary[600]} />
          </View>
          <View style={styles.info}>
            <Text style={styles.cardName} numberOfLines={1}>
              {item.fullName}
            </Text>
            <Text style={styles.cardSub} numberOfLines={1}>
              Все чеки без клиента
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.gray[300]} style={{ marginLeft: 4 }} />
        </TouchableOpacity>
      );
    }

    const initials = getInitials(item.fullName);
    const avatarBg = getAvatarColor(item.fullName);
    const carsCount = item.cars?.length || 0;

    const card = (
      <TouchableOpacity
        style={styles.row}
        activeOpacity={0.6}
        onPress={() => navigation.navigate('ClientDetail', { id: item.id })}
      >
        <View style={[styles.avatar, { backgroundColor: avatarBg }]}>
          <Text style={styles.avatarInitials}>{initials}</Text>
        </View>
        <View style={styles.info}>
          <Text style={styles.cardName} numberOfLines={1}>
            {item.fullName}
          </Text>
          <Text style={styles.cardSub} numberOfLines={1}>
            {[formatPhone(item.phone) || 'Без телефона', carsCount > 0 ? `${carsCount} авто` : null]
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.gray[300]} style={{ marginLeft: 4 }} />
      </TouchableOpacity>
    );

    if (!canDelete) return card;

    return (
      <Swipeable
        renderRightActions={() => (
          <View style={styles.swipeActionsRow}>
            <TouchableOpacity style={styles.swipeEditAction} onPress={() => openEditModal(item)} activeOpacity={0.85}>
              <Ionicons name="pencil" size={20} color={colors.white} />
              <Text style={styles.swipeActionText}>Изменить</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.swipeDeleteAction}
              onPress={() => {
                setDeleteId(item.id);
                setConfirmOpen(true);
              }}
              activeOpacity={0.85}
            >
              <Ionicons name="trash-outline" size={20} color={colors.white} />
              <Text style={styles.swipeActionText}>Удалить</Text>
            </TouchableOpacity>
          </View>
        )}
        overshootRight={false}
      >
        {card}
      </Swipeable>
    );
  };

  return (
    <View style={styles.safe}>
      <IosScreenHeader
        title="Клиенты"
        onBack={() => navigation.goBack()}
        trailing={
          <TouchableOpacity style={styles.addBtn} onPress={openCreateModal}>
            <Text style={styles.addBtnText}>+ Новый</Text>
          </TouchableOpacity>
        }
      />

      {/* Авто ⇄ Клиенты — single screen with an in-place segmented control.
          Tapping a tab swaps which list is rendered below; no navigation,
          no full-screen transition, no animation. The search bar is shared
          (its placeholder updates per mode). Order: Авто first, Клиенты
          second — opening this screen, the user is usually scanning for a
          car (госномер) rather than a person. */}
      <View style={cnStyles.segmentWrap}>
        <View style={cnStyles.segment}>
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
        ) : carsList.length === 0 && !carsQuery.isLoading && !!search ? (
          <EmptyState title="Нет автомобилей" description="Ничего не найдено" />
        ) : (
          <FlashList
            // Pin "Розничный покупатель" at the top of the cars list when
            // not searching. It's the new default landing tab; the retail
            // buyer is the most common "client" by check volume in most
            // тенантах, so it should be one tap away. A sentinel object
            // with id === '__retail__' is rendered with a branded row
            // (storefront icon) and routes to ClientDetail/__retail__,
            // which the detail screen treats as a virtual retail buyer
            // entity (all checks paid by walk-in retail).
            data={
              !search
                ? ([{ id: '__retail__' } as unknown as Car, ...carsList])
                : carsList
            }
            keyExtractor={(item: Car) => item.id}
            renderItem={({ item }: { item: Car }) => {
              if (item.id === '__retail__') {
                return (
                  <TouchableOpacity
                    style={cnStyles.carRow}
                    activeOpacity={0.6}
                    onPress={() => navigation.navigate('ClientDetail', { id: '__retail__' })}
                  >
                    <View style={[cnStyles.carIconBox, { backgroundColor: colors.primary[50] }]}>
                      <Ionicons name="storefront-outline" size={18} color={colors.primary[600]} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={cnStyles.carName} numberOfLines={1}>
                        Розничный покупатель
                      </Text>
                      <Text style={cnStyles.carClient} numberOfLines={1}>
                        Все чеки без клиента
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={14} color={colors.gray[300]} />
                  </TouchableOpacity>
                );
              }
              return (
                <TouchableOpacity
                  style={cnStyles.carRow}
                  activeOpacity={0.6}
                  onPress={() => {
                    if (item.client?.id) {
                      navigation.navigate('ClientDetail', { id: item.client.id });
                    }
                  }}
                >
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
                    <Text style={cnStyles.carClient} numberOfLines={1}>
                      {item.client.fullName}
                    </Text>
                  )}
                  <Ionicons name="chevron-forward" size={14} color={colors.gray[300]} />
                </TouchableOpacity>
              );
            }}
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
  list: { paddingHorizontal: 0, paddingBottom: spacing[8] },

  // ── iOS Contacts-style dense row ──
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    backgroundColor: colors.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray[200],
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  info: { flex: 1, minWidth: 0 },
  cardName: { fontSize: 15, fontWeight: '600', color: colors.gray[900], letterSpacing: -0.1 },
  cardSub: { fontSize: 12, color: colors.gray[500], marginTop: 2 },

  // ── Swipe-to-delete actions (mirror SuppliersScreen) ──
  swipeActionsRow: { flexDirection: 'row' },
  swipeEditAction: {
    backgroundColor: colors.primary[600],
    width: 84,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  swipeDeleteAction: {
    backgroundColor: colors.red[500],
    width: 84,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  swipeActionText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
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
