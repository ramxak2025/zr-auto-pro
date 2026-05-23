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
  ScrollView,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { LinearGradient } from 'expo-linear-gradient';
import { Swipeable } from 'react-native-gesture-handler';
import IosScreenHeader from '../components/IosScreenHeader';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { clientsApi, carsApi } from '../api/services';
import { formatPhone } from '../../../shared/validation/phone';
import { processPlateMainInput } from '../utils/plateMask';
import { normalizePlateQuery, looksLikePlateQuery, plateMatches } from '../utils/plateNormalize';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import { UserRole } from '../../../shared/types';
import SearchInput from '../components/SearchInput';
import { ListSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import DuplicateWarningDialog from '../components/DuplicateWarningDialog';
import FreshnessBadge from '../components/FreshnessBadge';
import SourcePickerSheet from '../components/SourcePickerSheet';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { haptic } from '../platform/haptics';
import type { Client, Car, PaginatedResponse } from '../../../shared/types';

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

type ClientFilter = 'all' | 'regular' | 'new' | 'source';

// Top-level tab inside the unified Clients screen — owner asked to
// merge "Клиенты" and "Авто" into a single section, so the screen now
// hosts a segmented switcher right under the header. Persist nothing —
// the user almost always re-enters from /Ещё/Клиенты and wants the
// people view first.
type ClientsView = 'clients' | 'cars';

// "Постоянные" / "Новые" thresholds — derived from createdAt only.
// "Новые" = created within the last 30 days. "Постоянные" = client
// where the local cars[] array reports any car at all (proxy for
// activity, since a returning client almost always has a car
// attached). Backend doesn't yet expose check-count per client on
// the list endpoint, so we keep the heuristic conservative.
const NEW_THRESHOLD_DAYS = 30;

export default function ClientsScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const { hasPermission, isRole } = useAuth();
  const palette = useColors();
  const canDelete = isRole(UserRole.SUPERADMIN, UserRole.DIRECTOR) || hasPermission('clients_edit');
  const tabBarHeight = useTabBarHeight();

  // Tab switcher state — see ClientsView. Default: people.
  const [view, setView] = useState<ClientsView>('clients');

  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<ClientFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  // Picker visibility — both the "filter by source" picker and the
  // create-modal's source picker reuse the same sheet component.
  const [sourceFilterOpen, setSourceFilterOpen] = useState(false);
  const [formSourceOpen, setFormSourceOpen] = useState(false);

  // Авто-tab keeps its own search query so switching tabs doesn't lose
  // either context. It also has a smaller page-size to match the
  // previous standalone CarsScreen behaviour.
  const [carSearch, setCarSearch] = useState('');
  const [carPage, setCarPage] = useState(1);
  const carLimit = 30;

  const limit = 20;
  const [refreshing, setRefreshing] = useState(false);

  // Modal state — single "Новый клиент" form
  const [modalOpen, setModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [comment, setComment] = useState('');
  const [formSource, setFormSource] = useState<string | null>(null);
  // Inline car block — shown only when creating, never when editing.
  const [carPlate, setCarPlate] = useState('');
  const [carMakeModel, setCarMakeModel] = useState('');

  // Delete confirm
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { data, isLoading, isFetching, dataUpdatedAt } = useQuery<PaginatedResponse<Client>>({
    queryKey: ['clients', { search, page, limit }],
    queryFn: async () => {
      const res = await clientsApi.getAll({ search, page, limit });
      return res.data;
    },
    placeholderData: (prev) => prev,
  });

  // Авто-tab data. Only fires when the user actually switches to that
  // view — keeps the people-tab cold-start free of an extra request.
  // The shape used to be either `Car[]` or `{ data, total }` depending
  // on the backend pagination path; preserve that flexibility.
  const carsQuery = useQuery<{ data: Car[]; total: number } | Car[]>({
    queryKey: ['cars', { search: carSearch, page: carPage, limit: carLimit }],
    queryFn: async () => {
      const res = await carsApi.getAll({ search: carSearch, page: carPage, limit: carLimit });
      return res.data;
    },
    placeholderData: (prev) => prev,
    enabled: view === 'cars',
  });

  // Client+optional-car create. Mirror the previous behaviour but with
  // `source` baked into the create payload. The inline car still flows
  // through `carsApi.create` only after the client succeeds.
  const createMutation = useMutation({
    mutationFn: async (d: {
      fullName: string;
      phone: string;
      comment?: string;
      source?: string | null;
      car?: { plateNumber: string; makeModel: string };
    }) => {
      const clientRes = await clientsApi.create({
        fullName: d.fullName,
        phone: d.phone,
        comment: d.comment,
        source: d.source ?? null,
      });
      if (d.car && d.car.plateNumber) {
        await carsApi.create({
          plateNumber: d.car.plateNumber,
          makeModel: d.car.makeModel || '',
          clientId: clientRes.data.id,
        });
      }
      return clientRes.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['cars'] });
      haptic('success');
      closeModal();
    },
    onError: () => Alert.alert('Ошибка', 'Ошибка при создании клиента'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { fullName: string; phone: string; comment?: string; source?: string | null } }) =>
      clientsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      closeModal();
    },
    onError: () => Alert.alert('Ошибка', 'Ошибка при обновлении клиента'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => clientsApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      haptic('success');
    },
    onError: () => Alert.alert('Ошибка', 'Ошибка при удалении клиента'),
  });

  const openCreateModal = () => {
    setEditingClient(null);
    setFullName('');
    setPhone('');
    setComment('');
    setFormSource(null);
    setCarPlate('');
    setCarMakeModel('');
    setModalOpen(true);
  };

  const openEditModal = (client: Client) => {
    setEditingClient(client);
    setFullName(client.fullName);
    setPhone(client.phone);
    setComment(client.comment || '');
    setFormSource(client.source ?? null);
    // Edit modal never shows the inline-car block — that's only for
    // creation. Clear so reopen on a different client doesn't leak.
    setCarPlate('');
    setCarMakeModel('');
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingClient(null);
  };

  // Duplicate-by-phone / by-plate flow (same as before).
  const [duplicateClient, setDuplicateClient] = useState<{
    id: string;
    fullName: string;
    phone: string;
    cars?: Array<{ plateNumber: string; makeModel: string }>;
  } | null>(null);
  const [duplicateCar, setDuplicateCar] = useState<{
    id: string;
    plateNumber: string;
    makeModel: string;
    clientId: string | null;
    client: { id: string; fullName: string; phone: string } | null;
  } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const normalizedCarPlate = processPlateMainInput(carPlate.replace(/\s/g, ''));
  const hasInlineCar = !editingClient && normalizedCarPlate.length > 0;

  const submitFlow = async (opts?: { forceCar?: boolean }) => {
    if (hasInlineCar && !opts?.forceCar) {
      try {
        const res = await carsApi.lookupByPlate(normalizedCarPlate);
        if (res.data) {
          setDuplicateCar(res.data);
          return;
        }
      } catch {
        // best-effort; on failure, proceed to create.
      }
    }
    createMutation.mutate({
      fullName,
      phone,
      comment: comment || undefined,
      source: formSource,
      car: hasInlineCar ? { plateNumber: normalizedCarPlate, makeModel: carMakeModel } : undefined,
    });
  };

  const handleSubmit = async () => {
    if (editingClient) {
      updateMutation.mutate({
        id: editingClient.id,
        data: { fullName, phone, comment: comment || undefined, source: formSource },
      });
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
      await submitFlow();
    } catch {
      await submitFlow();
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateAnyway = () => {
    setDuplicateClient(null);
    void submitFlow();
  };

  const handleOpenExistingClient = () => {
    if (!duplicateClient) return;
    const id = duplicateClient.id;
    setDuplicateClient(null);
    setModalOpen(false);
    (navigation as any).navigate('ClientDetail', { id });
  };

  const handleCreateCarAnyway = () => {
    setDuplicateCar(null);
    void submitFlow({ forceCar: true });
  };

  const handleOpenCarOwner = () => {
    if (!duplicateCar) return;
    const ownerId = duplicateCar.clientId;
    setDuplicateCar(null);
    setModalOpen(false);
    if (ownerId) (navigation as any).navigate('ClientDetail', { id: ownerId });
  };

  const onRefresh = async () => {
    setRefreshing(true);
    if (view === 'cars') {
      await queryClient.invalidateQueries({ queryKey: ['cars'] });
    } else {
      await queryClient.invalidateQueries({ queryKey: ['clients'] });
    }
    setRefreshing(false);
  };

  // Tab switch — fire a soft selection haptic, mirroring the iOS
  // UISegmentedControl feel. Resets neither search nor pagination so
  // the user keeps their state per tab.
  const switchView = (next: ClientsView) => {
    if (next === view) return;
    haptic('select');
    setView(next);
  };

  const rawClients = data?.data || [];
  const total = data?.total || 0;
  const hasMore = page * limit < total;

  // The list backend already returns retail buyer first when not
  // searching (server sorts by `is_retail DESC NULLS LAST`). When the
  // user searches we drop the retail row from the visual list — it
  // isn't a real searchable record. When applying a client-side filter
  // chip we keep the retail row pinned at the top regardless of the chip,
  // because "Розничные продажи" sits outside the regular/new taxonomy.

  // ── Client-side filtering layer ────────────────────────────────────
  // Two independent layers on top of the server result:
  //  1) plate-priority search (when query looks like a plate, prefer
  //     matches on cars[*].plateNumber);
  //  2) filter chip (Все / Постоянные / Новые / по источнику).
  const filteredClients = useMemo(() => {
    let base = rawClients.filter((c) => !c.isRetail);

    // Pre-trim by plate when user is typing what looks like a plate.
    if (search && looksLikePlateQuery(search)) {
      const q = normalizePlateQuery(search);
      const byPlate = base.filter((c) => (c.cars || []).some((car) => plateMatches(car.plateNumber, q)));
      const byOther = base.filter((c) => !byPlate.includes(c));
      base = [...byPlate, ...byOther];
    }

    if (filter === 'regular') {
      base = base.filter((c) => (c.cars && c.cars.length > 0) || (c.checks && c.checks.length > 0));
    } else if (filter === 'new') {
      const cutoff = Date.now() - NEW_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
      base = base.filter((c) => {
        const t = c.createdAt ? new Date(c.createdAt).getTime() : 0;
        return t > cutoff;
      });
    } else if (filter === 'source' && sourceFilter) {
      base = base.filter((c) => (c.source || '').toLowerCase() === sourceFilter.toLowerCase());
    }
    return base;
  }, [rawClients, search, filter, sourceFilter]);

  // Retail buyer pin — server returns the actual row, we pluck it out
  // so we can render it as the gradient hero card above the filtered
  // regular list (without duplicating the row).
  const retailFromServer = useMemo(
    () => rawClients.find((c) => c.isRetail) || null,
    [rawClients],
  );

  // Retail pin visibility — owner asked for the retail-buyer hero to
  // appear in BOTH tabs, since it's the gateway to retail-check
  // history regardless of which lens (people / cars) you're using.
  // On the people tab we suppress it during search / non-"Все" filter
  // so the pin doesn't compete with active filtering. On the cars
  // tab we only suppress it during plate search — otherwise the pin
  // sits permanently at the top.
  const showRetailPin =
    view === 'clients'
      ? !search && filter === 'all'
      : !carSearch;

  // FlashList data — without the retail row (it lives outside the
  // virtual list as a sticky hero). Keep memoised so the virtualiser
  // doesn't see a new reference on every parent re-render.
  const displayClients = useMemo<Client[]>(() => filteredClients, [filteredClients]);

  // ── Авто-tab derivations ──────────────────────────────────────────
  // Pagination response is either an array (legacy) or a `{data,total}`
  // envelope; normalise into `rawCars` so the list renderer doesn't
  // care. Plate-priority sort mirrors the standalone CarsScreen so a
  // partial plate query like "Х80" surfaces matching cars first even if
  // the backend ranking would put a makeModel substring above them.
  const carsData = carsQuery.data;
  const rawCars = useMemo<Car[]>(
    () => (Array.isArray(carsData) ? (carsData as Car[]) : ((carsData as any)?.data ?? [])),
    [carsData],
  );
  const carsTotal = Array.isArray(carsData) ? rawCars.length : ((carsData as any)?.total ?? rawCars.length);
  const carsHasMore = carPage * carLimit < carsTotal;

  const sortedCars = useMemo<Car[]>(() => {
    if (!carSearch || !looksLikePlateQuery(carSearch)) return rawCars;
    const q = normalizePlateQuery(carSearch);
    const hits: Car[] = [];
    const misses: Car[] = [];
    for (const car of rawCars) {
      (plateMatches(car.plateNumber, q) ? hits : misses).push(car);
    }
    return [...hits, ...misses];
  }, [rawCars, carSearch]);

  // Prefetch-on-tap — same idea as before.
  const prefetchClientDetail = useCallback(
    (clientId: string) => {
      if (clientId === '__retail__') return;
      queryClient.prefetchQuery({
        queryKey: ['client', clientId],
        queryFn: async () => (await clientsApi.getById(clientId)).data,
        staleTime: 60_000,
      });
    },
    [queryClient],
  );

  const renderClient = useCallback(
    ({ item }: { item: Client; index: number }) => {
      const initials = getInitials(item.fullName);
      const avatarBg = getAvatarColor(item.fullName);
      const carsCount = item.cars?.length || 0;
      const primaryPlate = item.cars?.[0]?.plateNumber;

      const card = (
        <TouchableOpacity
          style={[styles.row, { backgroundColor: palette.bg.card, borderBottomColor: palette.border.subtle }]}
          activeOpacity={0.6}
          onPress={() => navigation.navigate('ClientDetail', { id: item.id })}
          onPressIn={() => prefetchClientDetail(item.id)}
        >
          <View style={[styles.avatar, { backgroundColor: avatarBg }]}>
            <Text style={styles.avatarInitials}>{initials}</Text>
          </View>
          <View style={styles.info}>
            <Text style={[styles.cardName, { color: palette.text.primary }]} numberOfLines={1}>
              {item.fullName}
            </Text>
            <View style={styles.subLine}>
              <Text style={[styles.cardSub, { color: palette.text.secondary }]} numberOfLines={1}>
                {formatPhone(item.phone || '') || 'Без телефона'}
              </Text>
              {primaryPlate ? (
                <View style={[styles.platePill, { backgroundColor: palette.bg.muted }]}>
                  <Text style={[styles.platePillText, { color: palette.text.primary }]} numberOfLines={1}>
                    {primaryPlate}
                  </Text>
                </View>
              ) : carsCount > 0 ? (
                <Text style={[styles.cardSub, { color: palette.text.secondary }]} numberOfLines={1}>
                  · {carsCount} авто
                </Text>
              ) : null}
            </View>
          </View>
          {item.source ? (
            <View style={[styles.sourceTag, { backgroundColor: palette.bg.muted }]}>
              <Text style={[styles.sourceTagText, { color: palette.text.secondary }]} numberOfLines={1}>
                {item.source}
              </Text>
            </View>
          ) : null}
          <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} style={{ marginLeft: 4 }} />
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
      // openEditModal / setDeleteId identities are stable across the
      // component's lifetime; only depend on what actually flows into
      // the row visuals.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [canDelete, navigation, palette, prefetchClientDetail],
  );

  // Авто-tab row renderer. Plate is the visual anchor (a vehicle is
  // identified by its plate first, owner second). Tap navigates to the
  // owning ClientDetail and asks it to scroll-and-expand this car via
  // `focusCarId` so the flow "Авто → tap → see this car's checks" is
  // one tap end-to-end. Cars without an owner just fall back to a
  // muted state — they shouldn't be tappable.
  const renderCar = useCallback(
    ({ item }: { item: Car }) => {
      const ownerName = item.client?.fullName;
      const ownerId = item.clientId;
      const isOrphan = !ownerId;
      return (
        <TouchableOpacity
          style={[styles.carRow, { backgroundColor: palette.bg.card, borderBottomColor: palette.border.subtle }]}
          activeOpacity={isOrphan ? 1 : 0.6}
          disabled={isOrphan}
          onPress={() => {
            if (isOrphan) return;
            navigation.navigate('ClientDetail', { id: ownerId, focusCarId: item.id });
          }}
          onPressIn={() => {
            if (!isOrphan) prefetchClientDetail(ownerId);
          }}
        >
          <View style={styles.carPlateColumn}>
            {item.plateNumber ? (
              <View style={[styles.carPlateBadge, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
                <Text style={[styles.carPlateText, { color: palette.text.primary }]}>{item.plateNumber}</Text>
              </View>
            ) : (
              <View style={[styles.carIconBox, { backgroundColor: palette.accent.primarySoft }]}>
                <Ionicons name="car-sport-outline" size={20} color={palette.accent.primary} />
              </View>
            )}
          </View>
          <View style={styles.info}>
            <Text style={[styles.cardName, { color: palette.text.primary }]} numberOfLines={1}>
              {item.makeModel || 'Без модели'}
            </Text>
            <View style={styles.subLine}>
              {ownerName ? (
                <>
                  <Ionicons name="person-outline" size={11} color={palette.text.tertiary} />
                  <Text style={[styles.cardSub, { color: palette.text.secondary }]} numberOfLines={1}>
                    {ownerName}
                  </Text>
                </>
              ) : (
                <Text style={[styles.cardSub, { color: palette.text.tertiary }]} numberOfLines={1}>
                  Без владельца
                </Text>
              )}
            </View>
          </View>
          {isOrphan ? null : (
            <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} style={{ marginLeft: 4 }} />
          )}
        </TouchableOpacity>
      );
    },
    [navigation, palette, prefetchClientDetail],
  );

  // Retail-pin hero — gradient card pinned above the FlashList. The pin
  // is OUTSIDE the virtualised list so it never collides with row keys
  // and FlashList can stay homogenous.
  const RetailPin = () => {
    if (!showRetailPin) return null;
    const targetId = retailFromServer?.id || '__retail__';
    return (
      <TouchableOpacity
        activeOpacity={0.85}
        onPress={() => navigation.navigate('ClientDetail', { id: targetId })}
        style={styles.retailWrap}
      >
        <LinearGradient
          colors={[colors.primary[500], colors.primary[700]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.retailCard}
        >
          <View style={styles.retailIconWrap}>
            <Ionicons name="cart-outline" size={22} color={colors.white} />
          </View>
          <View style={styles.retailContent}>
            <Text style={styles.retailTitle}>Розничный покупатель</Text>
            <Text style={styles.retailSubtitle}>Быстрые продажи без клиента</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.white} />
        </LinearGradient>
      </TouchableOpacity>
    );
  };

  // Pick the freshness signal for the active tab so the badge doesn't
  // lie when the user is on Авто but the underlying clients query is
  // still loading.
  const activeFreshness =
    view === 'cars'
      ? {
          isFetching: carsQuery.isFetching,
          isLoading: carsQuery.isLoading,
          dataUpdatedAt: carsQuery.dataUpdatedAt,
        }
      : { isFetching, isLoading, dataUpdatedAt };

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title="Клиенты"
        onBack={() => navigation.goBack()}
        trailing={
          <TouchableOpacity
            style={[styles.addBtn, { backgroundColor: palette.accent.primary }]}
            onPress={openCreateModal}
            accessibilityRole="button"
            accessibilityLabel="Добавить клиента"
          >
            <Ionicons name="add" size={18} color={colors.white} />
          </TouchableOpacity>
        }
      />

      <View style={styles.freshnessRow}>
        <FreshnessBadge query={activeFreshness} />
      </View>

      {/* Segmented switcher — Клиенты / Авто. iOS-style pill with a
          single sliding selection. Owner asked to unify the two screens
          but keep both perspectives accessible without leaving Клиенты. */}
      <View style={styles.segmentedWrap}>
        <View style={[styles.segmented, { backgroundColor: palette.bg.muted }]}>
          <SegmentButton
            label="Клиенты"
            icon="people-outline"
            active={view === 'clients'}
            onPress={() => switchView('clients')}
            palette={palette}
          />
          <SegmentButton
            label="Авто"
            icon="car-sport-outline"
            active={view === 'cars'}
            onPress={() => switchView('cars')}
            palette={palette}
          />
        </View>
      </View>

      {view === 'clients' ? (
        <>
          <View style={styles.searchWrap}>
            <SearchInput
              value={search}
              onChange={(v) => {
                setSearch(v);
                setPage(1);
              }}
              placeholder="Госномер, имя или телефон"
            />
          </View>

          {/* Filter chips — Все / По источнику / Постоянные / Новые. */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipsRow}
          >
            <FilterChip
              active={filter === 'all'}
              label="Все"
              icon="apps-outline"
              onPress={() => {
                haptic('select');
                setFilter('all');
                setSourceFilter(null);
              }}
              palette={palette}
            />
            <FilterChip
              active={filter === 'source'}
              label={
                filter === 'source' && sourceFilter
                  ? `Источник: ${sourceFilter}`
                  : 'По источнику'
              }
              icon="pricetag-outline"
              onPress={() => {
                haptic('select');
                setSourceFilterOpen(true);
              }}
              palette={palette}
              dismissable={filter === 'source'}
              onDismiss={
                filter === 'source'
                  ? () => {
                      setFilter('all');
                      setSourceFilter(null);
                    }
                  : undefined
              }
            />
            <FilterChip
              active={filter === 'regular'}
              label="Постоянные"
              icon="repeat-outline"
              onPress={() => {
                haptic('select');
                setFilter('regular');
                setSourceFilter(null);
              }}
              palette={palette}
            />
            <FilterChip
              active={filter === 'new'}
              label="Новые"
              icon="sparkles-outline"
              onPress={() => {
                haptic('select');
                setFilter('new');
                setSourceFilter(null);
              }}
              palette={palette}
            />
          </ScrollView>

          {data === undefined ? (
            <ListSkeleton count={8} />
          ) : filteredClients.length === 0 && !search && !isLoading && filter === 'all' ? (
            <View style={{ flex: 1 }}>
              <View style={{ paddingHorizontal: spacing[4] }}>
                <RetailPin />
              </View>
              <EmptyState
                title="Нет клиентов"
                description="Добавьте первого клиента"
                action={{ label: 'Добавить клиента', onPress: openCreateModal }}
              />
            </View>
          ) : (
            <FlashList
              data={displayClients}
              keyExtractor={(item) => item.id}
              renderItem={renderClient}
              ListHeaderComponent={
                showRetailPin ? (
                  <View style={{ paddingHorizontal: spacing[4] }}>
                    <RetailPin />
                  </View>
                ) : null
              }
              ListEmptyComponent={
                !isLoading ? (
                  <EmptyState
                    title={filter === 'new' ? 'Нет новых клиентов' : filter === 'regular' ? 'Нет постоянных клиентов' : 'Ничего не найдено'}
                    description={search ? `Запрос: «${search}»` : undefined}
                  />
                ) : null
              }
              contentContainerStyle={{ ...styles.list, paddingBottom: tabBarHeight + spacing[4] }}
              removeClippedSubviews
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
              }
              onEndReached={() => {
                if (hasMore) setPage((p) => p + 1);
              }}
              onEndReachedThreshold={0.5}
            />
          )}
        </>
      ) : (
        // ── Авто view ────────────────────────────────────────────────
        // Same iosCard rhythm as the people view. Retail pin still
        // sits at the top — it's the gateway to retail-check history
        // regardless of which lens the owner is currently using.
        <>
          <View style={styles.searchWrap}>
            <SearchInput
              value={carSearch}
              onChange={(v) => {
                setCarSearch(v);
                setCarPage(1);
              }}
              placeholder="Госномер или марка"
            />
          </View>

          {carsData === undefined ? (
            <ListSkeleton count={8} />
          ) : sortedCars.length === 0 && !carsQuery.isLoading ? (
            <View style={{ flex: 1 }}>
              <View style={{ paddingHorizontal: spacing[4] }}>
                <RetailPin />
              </View>
              <EmptyState
                title={carSearch ? 'Ничего не найдено' : 'Нет автомобилей'}
                description={
                  carSearch
                    ? `Запрос: «${carSearch}»`
                    : 'Автомобили появятся после добавления к клиентам'
                }
              />
            </View>
          ) : (
            <FlashList
              data={sortedCars}
              keyExtractor={(item) => item.id}
              renderItem={renderCar}
              ListHeaderComponent={
                showRetailPin ? (
                  <View style={{ paddingHorizontal: spacing[4] }}>
                    <RetailPin />
                  </View>
                ) : null
              }
              contentContainerStyle={{ ...styles.list, paddingBottom: tabBarHeight + spacing[4] }}
              removeClippedSubviews
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
              }
              onEndReached={() => {
                if (carsHasMore) setCarPage((p) => p + 1);
              }}
              onEndReachedThreshold={0.5}
            />
          )}
        </>
      )}

      {/* Create/Edit Modal */}
      <Modal visible={modalOpen} onClose={closeModal} title={editingClient ? 'Редактировать' : 'Новый клиент'}>
        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>ФИО *</Text>
          <TextInput
            value={fullName}
            onChangeText={setFullName}
            style={[
              styles.formInput,
              { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
            ]}
            placeholder="Введите ФИО клиента"
            placeholderTextColor={palette.text.tertiary}
          />
        </View>
        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Телефон *</Text>
          <TextInput
            value={phone}
            onChangeText={(t) => setPhone(formatPhone(t.replace(/\D/g, '')))}
            style={[
              styles.formInput,
              { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
            ]}
            placeholder="+7 (___) ___-__-__"
            keyboardType="phone-pad"
            autoComplete="tel"
            placeholderTextColor={palette.text.tertiary}
          />
        </View>
        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Источник *</Text>
          <TouchableOpacity
            onPress={() => setFormSourceOpen(true)}
            activeOpacity={0.7}
            style={[
              styles.formInput,
              styles.formPicker,
              { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
            ]}
          >
            <Text
              style={[
                styles.formPickerText,
                { color: formSource ? palette.text.primary : palette.text.tertiary },
              ]}
            >
              {formSource ?? 'Выберите источник'}
            </Text>
            <Ionicons name="chevron-down" size={16} color={palette.text.tertiary} />
          </TouchableOpacity>
        </View>
        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Комментарий</Text>
          <TextInput
            value={comment}
            onChangeText={setComment}
            style={[
              styles.formInput,
              {
                height: 80,
                textAlignVertical: 'top',
                backgroundColor: palette.bg.muted,
                borderColor: palette.border.subtle,
                color: palette.text.primary,
              },
            ]}
            placeholder="Необязательно"
            multiline
            placeholderTextColor={palette.text.tertiary}
          />
        </View>

        {/* Inline car block — only when creating a new client. No VIN. */}
        {!editingClient && (
          <View style={[cnStyles.inlineCarBlock, { borderTopColor: palette.border.subtle }]}>
            <View style={cnStyles.inlineCarHeader}>
              <Ionicons name="car-sport-outline" size={14} color={colors.primary[600]} />
              <Text style={cnStyles.inlineCarHeaderText}>Автомобиль (необязательно)</Text>
            </View>
            <View style={styles.formField}>
              <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Марка и модель</Text>
              <TextInput
                value={carMakeModel}
                onChangeText={setCarMakeModel}
                style={[
                  styles.formInput,
                  {
                    backgroundColor: palette.bg.muted,
                    borderColor: palette.border.subtle,
                    color: palette.text.primary,
                  },
                ]}
                placeholder="Toyota Camry"
                placeholderTextColor={palette.text.tertiary}
              />
            </View>
            <View style={styles.formField}>
              <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Госномер</Text>
              <TextInput
                value={carPlate}
                onChangeText={(t) => setCarPlate(processPlateMainInput(t.replace(/\s/g, '')))}
                style={[
                  styles.formInput,
                  {
                    backgroundColor: palette.bg.muted,
                    borderColor: palette.border.subtle,
                    color: palette.text.primary,
                  },
                ]}
                placeholder="А000АА"
                autoCapitalize="characters"
                autoCorrect={false}
                placeholderTextColor={palette.text.tertiary}
              />
            </View>
          </View>
        )}

        <View style={[styles.formActions, { borderTopColor: palette.border.subtle }]}>
          <TouchableOpacity style={[styles.cancelBtn, { borderColor: palette.border.strong }]} onPress={closeModal}>
            <Text style={[styles.cancelBtnText, { color: palette.text.secondary }]}>Отмена</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.submitBtn, { backgroundColor: palette.accent.primary }]}
            onPress={handleSubmit}
            disabled={createMutation.isPending || updateMutation.isPending || submitting}
          >
            {createMutation.isPending || updateMutation.isPending || submitting ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={styles.submitBtnText}>{editingClient ? 'Сохранить' : 'Создать'}</Text>
            )}
          </TouchableOpacity>
        </View>
      </Modal>

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
        existingSubtitle={duplicateClient?.phone ? formatPhone(duplicateClient.phone) : undefined}
        existingCars={duplicateClient?.cars}
        openExistingLabel="Открыть карточку"
      />

      <DuplicateWarningDialog
        visible={!!duplicateCar}
        onClose={() => setDuplicateCar(null)}
        onCreateAnyway={handleCreateCarAnyway}
        onOpenExisting={handleOpenCarOwner}
        title="Такой автомобиль уже есть"
        description={
          duplicateCar?.client
            ? `Госномер ${duplicateCar.plateNumber} уже привязан к другому клиенту.`
            : `Госномер ${duplicateCar?.plateNumber || ''} уже существует.`
        }
        existingLabel={duplicateCar?.makeModel || duplicateCar?.plateNumber || ''}
        existingSubtitle={duplicateCar?.client ? `Клиент: ${duplicateCar.client.fullName}` : duplicateCar?.plateNumber}
        openExistingLabel={duplicateCar?.client ? 'Открыть владельца' : 'Закрыть'}
      />

      {/* Source picker — opens for filter chip (sets sourceFilter) */}
      <SourcePickerSheet
        visible={sourceFilterOpen}
        onClose={() => setSourceFilterOpen(false)}
        selected={sourceFilter}
        onPick={(value) => {
          if (value) {
            setFilter('source');
            setSourceFilter(value);
          } else {
            setFilter('all');
            setSourceFilter(null);
          }
        }}
        title="Фильтр по источнику"
      />

      {/* Source picker — opens for the create/edit form */}
      <SourcePickerSheet
        visible={formSourceOpen}
        onClose={() => setFormSourceOpen(false)}
        selected={formSource}
        onPick={(value) => setFormSource(value)}
        title="Источник клиента"
      />
    </View>
  );
}

interface SegmentButtonProps {
  active: boolean;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  palette: ReturnType<typeof useColors>;
}

// Segmented switcher button — visually mimics iOS UISegmentedControl
// "thumb": active pill rides on the muted track, casts a soft shadow,
// and lifts the text/icon into accent colour. Keep this internal —
// it's tightly coupled to the segmented track styles.
function SegmentButton({ active, label, icon, onPress, palette }: SegmentButtonProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.85}
      style={[
        cnStyles.segmentBtn,
        active && [cnStyles.segmentBtnActive, { backgroundColor: palette.bg.card }],
      ]}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
    >
      <Ionicons
        name={icon}
        size={14}
        color={active ? palette.accent.primary : palette.text.secondary}
      />
      <Text
        style={[
          cnStyles.segmentBtnText,
          { color: active ? palette.text.primary : palette.text.secondary },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

interface FilterChipProps {
  active: boolean;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  palette: ReturnType<typeof useColors>;
  dismissable?: boolean;
  onDismiss?: () => void;
}

function FilterChip({ active, label, icon, onPress, palette, dismissable, onDismiss }: FilterChipProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[
        cnStyles.chip,
        {
          backgroundColor: active ? palette.accent.primarySoft : palette.bg.muted,
          borderColor: active ? palette.accent.primary : palette.border.subtle,
        },
      ]}
    >
      <Ionicons name={icon} size={13} color={active ? palette.accent.primary : palette.text.secondary} />
      <Text
        style={[
          cnStyles.chipLabel,
          { color: active ? palette.accent.primaryText : palette.text.secondary },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {dismissable && active && onDismiss ? (
        <TouchableOpacity
          onPress={onDismiss}
          hitSlop={8}
          style={cnStyles.chipDismiss}
          accessibilityLabel="Сбросить фильтр"
        >
          <Ionicons name="close-circle" size={14} color={palette.accent.primary} />
        </TouchableOpacity>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary[600],
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchWrap: { paddingHorizontal: spacing[4] },
  freshnessRow: {
    paddingHorizontal: spacing[4],
    alignItems: 'flex-end',
    minHeight: 14,
  },
  // Segmented tab switcher container. Sits between the freshness row
  // and the per-tab search bar so the user can flip Клиенты ↔ Авто
  // without scrolling the list.
  segmentedWrap: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[1],
    paddingBottom: spacing[2.5],
  },
  segmented: {
    flexDirection: 'row',
    borderRadius: borderRadius.full,
    padding: 3,
    alignItems: 'stretch',
  },
  list: { paddingHorizontal: 0, paddingBottom: spacing[8] },

  // Retail buyer hero card — gradient pin above the list.
  retailWrap: {
    marginTop: spacing[1],
    marginBottom: spacing[3],
  },
  retailCard: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3.5],
    borderRadius: borderRadius['2xl'],
    gap: spacing[3],
    shadowColor: colors.primary[700],
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  retailIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  retailContent: { flex: 1, gap: 2 },
  retailTitle: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  retailSubtitle: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
  },

  // Row
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
  subLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  cardSub: { fontSize: 12, color: colors.gray[500] },
  platePill: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: colors.gray[100],
  },
  platePillText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, color: colors.gray[800] },
  sourceTag: {
    maxWidth: 90,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: colors.gray[100],
  },
  sourceTagText: { fontSize: 10, fontWeight: '600' },

  // Авто-tab row — same overall shape as the people row but the plate
  // sits in a dedicated column on the left as the visual anchor (cars
  // are identified by plate first, owner second), and there's no
  // source tag / swipe actions.
  carRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    backgroundColor: colors.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray[200],
  },
  carPlateColumn: { minWidth: 96, alignItems: 'flex-start' },
  carPlateBadge: {
    paddingHorizontal: spacing[2.5],
    paddingVertical: 6,
    borderRadius: borderRadius.md,
    borderWidth: 1,
  },
  carPlateText: { fontSize: 14, fontWeight: '700', letterSpacing: 0.7 },
  carIconBox: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Swipe
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
  swipeActionText: { color: colors.white, fontSize: 12, fontWeight: '600', letterSpacing: 0.2 },

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
  formPicker: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  formPickerText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },
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
  chipsRow: {
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
    gap: spacing[2],
    alignItems: 'center',
  },
});

const cnStyles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    maxWidth: 220,
  },
  chipLabel: { fontSize: 13, fontWeight: '600', letterSpacing: -0.1 },
  chipDismiss: { marginLeft: 2 },

  // Segment button — iOS-style "thumb" on a muted track. Active state
  // is supplied via inline backgroundColor (palette.bg.card) so the
  // pill picks up the screen's elevated surface in both light and
  // dark themes.
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
  },
  segmentBtnActive: {
    shadowColor: colors.black,
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  segmentBtnText: { fontSize: 13, fontWeight: '600', letterSpacing: -0.1 },

  inlineCarBlock: {
    marginTop: spacing[2],
    paddingTop: spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.gray[200],
  },
  inlineCarHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: spacing[2],
  },
  inlineCarHeaderText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.primary[700],
    letterSpacing: 0.2,
  },
});
