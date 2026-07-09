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
  FlatList,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import IosScreenHeader from '../components/IosScreenHeader';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { clientsApi, carsApi, checksApi } from '../api/services';
import { formatPhone } from '../../../shared/validation/phone';
import { normalizePlateQuery, looksLikePlateQuery, plateMatches } from '../utils/plateNormalize';
import { normalizePlateForSearch } from '../utils/plateMask';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import { UserRole } from '../../../shared/types';
import SearchInput from '../components/SearchInput';
import { ListSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import QueryErrorState from '../components/QueryErrorState';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import DuplicateWarningDialog from '../components/DuplicateWarningDialog';
import FreshnessBadge from '../components/FreshnessBadge';
import SourcePickerSheet from '../components/SourcePickerSheet';
import SourcePickerInline from '../components/SourcePickerInline';
import ClientListRow, { CLIENT_ROW_HEIGHT } from '../components/ClientListRow';
import CarPlateField from '../components/CarPlateField';
import PlateResultCard, { PLATE_ROW_HEIGHT } from '../components/PlateResultCard';
import RussianPlateInput, { type PlateMode } from '../components/RussianPlateInput';
import PlateModeSwitcher from '../components/PlateModeSwitcher';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { haptic } from '../platform/haptics';
import type { Client, Car, Check, PaginatedResponse } from '../../../shared/types';

// Avatar helpers (initials / colour) moved to components/ClientListRow.tsx —
// they belong to the row, and the row now lives at module scope behind
// React.memo so FlashList recycling stays a cheap prop update.

type ClientFilter = 'all' | 'regular' | 'new' | 'source' | 'noplate';

// Top-level mode of the Clients screen (queue #19.3). DEFAULT is the
// госномер (plate) search — the owner's primary entry point is "у меня
// машина с номером X, найди клиента". The mode toggle lives as an icon
// in the header trailing slot (left of the «+»):
//   'plate'  — поиск по госномеру (RU/INT), Касса-style plate input;
//   'client' — поиск клиентов по имени / авто / телефону + фильтры.
type ClientsMode = 'plate' | 'client';

// "Постоянные" / "Новые" thresholds — derived from createdAt only.
// "Новые" = created within the last 30 days. "Постоянные" = client
// where the local cars[] array reports any car at all (proxy for
// activity, since a returning client almost always has a car
// attached). Backend doesn't yet expose check-count per client on
// the list endpoint, so we keep the heuristic conservative.
const NEW_THRESHOLD_DAYS = 30;

// ── RetailPinCard ──────────────────────────────────────────────────────
// Retail-buyer hero — gradient card pinned OUTSIDE the virtualised list so
// it never collides with row keys and FlashList stays homogenous. Reachable
// in both modes so the __retail__ detail path is never lost. Module scope +
// React.memo: a stable component TYPE, so parent re-renders update it in
// place instead of remounting the gradient subtree (the old inline
// `RetailPin` closure made the header remount on every screen re-render).
const RetailPinCard = React.memo(function RetailPinCard({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={styles.retailWrap}>
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
});

export default function ClientsScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const { hasPermission, isRole } = useAuth();
  const palette = useColors();
  // Свайп-действия строки клиента — «Изменить» (правка существующего профиля) и
  // «Удалить». И то и другое — операции над СУЩЕСТВУЮЩИМ клиентом, поэтому гейт
  // единый: `clients_edit`, а owner-class (superadmin/director/admin) минует его,
  // как остальные per-screen гейты этого батча (зеркалит серверный
  // PermissionsGuard). Без права строка — статичная карточка без свайпа (см.
  // ClientListRow). Создание НОВОГО клиента (openCreateModal / FAB «+») и подбор
  // клиента в чек НЕ гейтятся — мастерам это нужно в Кассе.
  const isOwnerClass = isRole(UserRole.SUPERADMIN, UserRole.DIRECTOR, UserRole.ADMIN);
  const canDelete = isOwnerClass || hasPermission('clients_edit');
  const tabBarHeight = useTabBarHeight();

  // Mode — see ClientsMode. Default: plate (госномер) search.
  const [mode, setMode] = useState<ClientsMode>('plate');

  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ClientFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  // Picker visibility — the "filter by source" picker uses the RN-Modal
  // sheet; the create-modal's source picker uses the in-place inline
  // overlay (a Modal-over-Modal won't present reliably on iOS — #19.3).
  const [sourceFilterOpen, setSourceFilterOpen] = useState(false);
  const [formSourceOpen, setFormSourceOpen] = useState(false);

  // Plate-search state (Касса-style). `plateSearch` is the clean stored
  // string from RussianPlateInput, `plateMode` toggles RU / INT.
  const [plateSearch, setPlateSearch] = useState('');
  const [plateMode, setPlateMode] = useState<PlateMode>('ru');

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
  // Now routes through CarPlateField (RU/foreign + «без номеров») so a
  // foreign plate isn't mangled by the RU-only mask anymore.
  const [carPlate, setCarPlate] = useState('');
  const [carMakeModel, setCarMakeModel] = useState('');
  const [carMode, setCarMode] = useState<PlateMode>('ru');
  const [carNoPlate, setCarNoPlate] = useState(false);

  // Delete confirm
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // People-list — infinite scroll. The page number is intentionally OUT of
  // the queryKey so every loaded page shares one cache entry and rows
  // ACCUMULATE as the user scrolls (audit #8.6). The previous page-in-key
  // `useQuery` swapped page N for page N+1, dropping the earlier rows and
  // causing an extra refetch each time `onEndReached` fired. Mirrors the
  // Журнал (`ChecksScreen`) infinite-query pattern. The `filter`/`source`
  // bits are part of the key so a chip change resets paging to page 1
  // automatically (server search is unaffected by client-side chips, but
  // keeping them in the key keeps the cache entry semantically correct and
  // avoids stale page accumulation across filters).
  const {
    data,
    isLoading,
    isError,
    refetch,
    isFetching,
    isPlaceholderData,
    dataUpdatedAt,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<PaginatedResponse<Client>>({
    queryKey: ['clients-infinite', { search, filter, source: sourceFilter }],
    initialPageParam: 1,
    queryFn: async ({ pageParam = 1 }) => {
      const res = await clientsApi.getAll({ search, page: pageParam as number, limit });
      return res.data;
    },
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((acc, p) => acc + (p?.data?.length ?? 0), 0);
      return loaded < (lastPage?.total ?? 0) ? allPages.length + 1 : undefined;
    },
    placeholderData: (prev) => prev,
  });

  // ── Plate-search query (Касса-style, #19.3) ─────────────────────────
  // Mirrors CheckCreateScreen: search clients by the normalized plate so
  // a latin "P332PA05" finds the same client as Cyrillic "Р332РА05". The
  // server returns clients (with their cars[]), we flatten to {client,car}
  // rows below. Only fires when ≥2 chars are typed → no cold-start cost.
  const normalizedPlate = useMemo(() => normalizePlateForSearch(plateSearch, plateMode), [plateSearch, plateMode]);
  const plateQuery = useQuery<Client[]>({
    queryKey: ['clients-plate', normalizedPlate, plateMode],
    queryFn: async () => {
      const res = await clientsApi.getAll({ search: normalizedPlate, limit: 20 });
      return Array.isArray(res.data.data) ? res.data.data : [];
    },
    enabled: mode === 'plate' && normalizedPlate.length >= 2,
    placeholderData: (prev) => prev,
  });

  // ── Round 7 #8 TASK A (зеркально Кассе): совпадения с ПЕРВЫХ символов ──
  // /clients?search= для частичного номера («Х8») зашумляется телефонной
  // веткой бэкенда (`PHONE_KEY LIKE '%8%'` матчит почти всех), и страница
  // LIMIT 20 теряет реальный номер до почти полного ввода. /cars?search=
  // матчит только номер/марку и отдаёт клиента вложенным — дополняем его
  // результатами список (dedup в plateResults ниже). Ключ ['cars-plate']
  // совпадает с Кассой, так что кеш подсказок общий.
  const carsPlateQuery = useQuery<Car[]>({
    queryKey: ['cars-plate', normalizedPlate, plateMode],
    queryFn: async () => {
      const res = await carsApi.getAll({ search: normalizedPlate, limit: 20 });
      return Array.isArray(res.data.data) ? res.data.data : [];
    },
    enabled: mode === 'plate' && normalizedPlate.length >= 2,
    placeholderData: (prev) => prev,
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
      car?: { plateNumber: string; makeModel: string; noPlate: boolean };
    }) => {
      const clientRes = await clientsApi.create({
        fullName: d.fullName,
        phone: d.phone,
        comment: d.comment,
        source: d.source ?? null,
      });
      // Attach the inline car when the user either typed a plate OR ticked
      // «без номеров» (a plateless car is still a real car worth tracking).
      if (d.car && (d.car.plateNumber || d.car.noPlate)) {
        await carsApi.create({
          plateNumber: d.car.noPlate ? '' : d.car.plateNumber,
          makeModel: d.car.makeModel || '',
          clientId: clientRes.data.id,
          noPlate: d.car.noPlate,
        });
      }
      return clientRes.data;
    },
    onSuccess: () => {
      // Refresh the people-list infinite key (persisted as
      // 'clients-infinite' in persistentCache) plus the legacy
      // `['clients']` slot (defensive — no screen reads it anymore, but a
      // stale prefetched copy must not survive a create) so the freshly
      // created client shows up without a manual pull-to-refresh.
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['clients-infinite'] });
      queryClient.invalidateQueries({ queryKey: ['clients-plate'] });
      queryClient.invalidateQueries({ queryKey: ['cars-plate'] });
      queryClient.invalidateQueries({ queryKey: ['cars'] });
      haptic('success');
      closeModal();
    },
    onError: () => Alert.alert('Ошибка', 'Ошибка при создании клиента'),
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: { fullName: string; phone: string; comment?: string; source?: string | null };
    }) => clientsApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['clients-infinite'] });
      queryClient.invalidateQueries({ queryKey: ['clients-plate'] });
      closeModal();
    },
    onError: () => Alert.alert('Ошибка', 'Ошибка при обновлении клиента'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => clientsApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['clients-infinite'] });
      queryClient.invalidateQueries({ queryKey: ['clients-plate'] });
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
    setFormSourceOpen(false);
    setCarPlate('');
    setCarMakeModel('');
    setCarMode('ru');
    setCarNoPlate(false);
    setModalOpen(true);
  };

  // Stable identity (useCallback, setter-only body) — flows into the
  // memoised ClientListRow, so a parent re-render doesn't bust row memo.
  const openEditModal = useCallback((client: Client) => {
    setEditingClient(client);
    setFullName(client.fullName);
    setPhone(client.phone);
    setComment(client.comment || '');
    setFormSource(client.source ?? null);
    setFormSourceOpen(false);
    // Edit modal never shows the inline-car block — that's only for
    // creation. Clear so reopen on a different client doesn't leak.
    setCarPlate('');
    setCarMakeModel('');
    setCarMode('ru');
    setCarNoPlate(false);
    setModalOpen(true);
  }, []);

  // Swipe «Удалить» → ConfirmDialog. Stable for the memoised row.
  const requestDelete = useCallback((id: string) => {
    setDeleteId(id);
    setConfirmOpen(true);
  }, []);

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

  // CarPlateField already returns a clean stored plate (RU mask or foreign
  // normalisation applied), so we don't re-mask here — re-masking with the
  // RU-only processor was the original foreign-plate bug.
  const normalizedCarPlate = carPlate.trim();
  // An inline car is attached when the user typed a plate, OR ticked
  // «без номеров», OR just filled the make/model (a real car without a
  // known plate yet). Only a fully empty block is skipped.
  const hasInlineCar =
    !editingClient && (carNoPlate || normalizedCarPlate.length > 0 || carMakeModel.trim().length > 0);

  const submitFlow = async (opts?: { forceCar?: boolean }) => {
    // Duplicate check only matters when there's an actual plate to clash on.
    if (hasInlineCar && !carNoPlate && normalizedCarPlate.length > 0 && !opts?.forceCar) {
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
      car: hasInlineCar ? { plateNumber: normalizedCarPlate, makeModel: carMakeModel, noPlate: carNoPlate } : undefined,
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
    if (mode === 'plate') {
      await queryClient.invalidateQueries({ queryKey: ['clients-plate'] });
      await queryClient.invalidateQueries({ queryKey: ['cars-plate'] });
    } else {
      // People-list now lives under the infinite key — invalidate that so
      // pull-to-refresh actually refetches the loaded pages.
      await queryClient.invalidateQueries({ queryKey: ['clients-infinite'] });
    }
    setRefreshing(false);
  };

  // Mode toggle (header icon) — flip plate-search ⇄ client-search. Fires a
  // soft selection haptic, mirroring the iOS segmented-control feel.
  const toggleMode = () => {
    haptic('select');
    setMode((m) => (m === 'plate' ? 'client' : 'plate'));
  };

  // Flatten every loaded page into one accumulated array. page 1 is the
  // freshest server slice; page 2+ are appended below as the user scrolls.
  // Memoised on `data.pages` so a parent re-render doesn't churn a new array
  // (which would bust FlashList's row recycling).
  const rawClients = useMemo<Client[]>(
    () => (Array.isArray(data?.pages) ? data.pages : []).flatMap((p) => (Array.isArray(p?.data) ? p.data : [])),
    [data?.pages],
  );

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
      const byPlate = base.filter((c) =>
        (Array.isArray(c.cars) ? c.cars : []).some((car) => plateMatches(car.plateNumber, q)),
      );
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
    } else if (filter === 'noplate') {
      // Clients that have at least one car without a plate (or marked
      // «без номеров»), or no cars at all — i.e. nothing to identify by plate.
      base = base.filter((c) => {
        const cs = Array.isArray(c.cars) ? c.cars : [];
        if (cs.length === 0) return true;
        return cs.some((car) => car.noPlate || !car.plateNumber);
      });
    }
    return base;
  }, [rawClients, search, filter, sourceFilter]);

  // Retail buyer pin — server returns the actual row, we pluck it out
  // so we can render it as the gradient hero card above the filtered
  // regular list (without duplicating the row).
  const retailFromServer = useMemo(() => rawClients.find((c) => c.isRetail) || null, [rawClients]);

  // Retail pin visibility — the retail-buyer hero is the gateway to
  // retail-check history. We show it on the people (client) list when
  // it's unfiltered. Plate mode reaches retail via its own pinned row.
  const showRetailPin = !search && filter === 'all';

  // FlashList data — without the retail row (it lives outside the
  // virtual list as a sticky hero). Keep memoised so the virtualiser
  // doesn't see a new reference on every parent re-render.
  const displayClients = useMemo<Client[]>(() => filteredClients, [filteredClients]);

  // ── Plate-search derivations (#19.3) ───────────────────────────────
  // Flatten the server's clients[] into {client, car} rows, prioritising
  // cars whose normalized plate contains the query (Касса parity). Cars
  // without a plate are excluded — plate mode is about identifying a car
  // by its госномер; plateless cars are found via client mode.
  const plateResults = useMemo<{ client: Client; car: Car }[]>(() => {
    const list = Array.isArray(plateQuery.data) ? plateQuery.data : [];
    const q = normalizedPlate;
    const hits: { client: Client; car: Car }[] = [];
    const misses: { client: Client; car: Car }[] = [];
    for (const client of list) {
      for (const car of Array.isArray(client.cars) ? client.cars : []) {
        if (!car.plateNumber) continue;
        const matches = q.length > 0 && normalizePlateForSearch(car.plateNumber, plateMode).includes(q);
        (matches ? hits : misses).push({ client, car });
      }
    }
    // Round 7 #8 TASK A: префиксные совпадения из /cars — строки, которые
    // зашумлённая страница /clients теряет для короткого запроса. Dedup по
    // паре клиент+авто (plateKeyExtractor использует этот же ключ); машины
    // без владельца пропускаем — тап открывает карточку клиента. Добавка
    // сортируется по номеру, чтобы подсказки шли детерминированно, а не в
    // порядке created_at DESC бэкенда.
    const carsList = Array.isArray(carsPlateQuery.data) ? carsPlateQuery.data : [];
    if (q.length > 0 && carsList.length > 0) {
      const seen = new Set([...hits, ...misses].map((r) => `${r.client.id}-${r.car.id}`));
      const extras: { client: Client; car: Car }[] = [];
      for (const car of carsList) {
        const owner = car.client;
        if (!owner?.id || !car.plateNumber) continue;
        if (!normalizePlateForSearch(car.plateNumber, plateMode).includes(q)) continue;
        const key = `${owner.id}-${car.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        extras.push({ client: owner, car });
      }
      extras.sort((a, b) => (a.car.plateNumber || '').localeCompare(b.car.plateNumber || '', 'ru'));
      hits.push(...extras);
    }
    return [...hits, ...misses];
  }, [plateQuery.data, carsPlateQuery.data, normalizedPlate, plateMode]);

  const retailPinTargetId = retailFromServer?.id || '__retail__';

  // Prefetch-on-tap (audit P0). Fired on `onPressIn` — overlapping the
  // navigation push animation — so ClientDetailScreen opens straight from
  // cache. We warm TWO things:
  //   1) ['client', id]            — the client profile (hero / cars);
  //   2) ['client-checks', id]     — the SLIM recent-checks slice that
  //      drives the hero stats + last visit + first screenful of history.
  // The check key/limit/queryFn below mirror ClientDetailScreen's EAGER
  // query EXACTLY (limit 10) — diverge and the prefetch silently misses.
  const prefetchClientDetail = useCallback(
    (clientId: string) => {
      if (clientId === '__retail__') return;
      queryClient.prefetchQuery({
        queryKey: ['client', clientId],
        queryFn: async () => (await clientsApi.getById(clientId)).data,
        staleTime: 60_000,
      });
      queryClient.prefetchQuery({
        queryKey: ['client-checks', clientId],
        queryFn: async (): Promise<Check[]> => {
          const res = await checksApi.getAll({ clientId, limit: 10 });
          const raw = res.data as { data?: Check[] } | Check[];
          return Array.isArray(raw) ? raw : raw.data || [];
        },
        staleTime: 60_000,
      });
    },
    [queryClient],
  );

  // Row tap → ClientDetail. Stable for the memoised row.
  const openClientDetail = useCallback((id: string) => navigation.navigate('ClientDetail', { id }), [navigation]);

  // Stable keyExtractors — hoisted out of the FlashList JSX so they keep a
  // constant identity across re-renders. An inline `(item) => item.id` is a
  // NEW function on every render; while FlashList tolerates it, a stable ref
  // lets the recycler skip needless key-fn churn during pagination (when
  // `isFetchingNextPage` flips mid-scroll). Pure id maths → no deps.
  const clientKeyExtractor = useCallback((item: Client) => item.id, []);
  const plateKeyExtractor = useCallback((item: { client: Client; car: Car }) => `${item.client.id}-${item.car.id}`, []);

  // ── Row renderer (client mode) ──────────────────────────────────────
  // The row is a module-scope React.memo component (ClientListRow) with a
  // FIXED height, rendered inside a plain RN FlatList (no recycling). The
  // «дёргаются/пропадают» saga: v1 keyed a legacy Swipeable by id (full
  // remount per FlashList recycle → blank cells); v2 reset via ref but the
  // class Swipeable still setState'd on Fabric cell reuse; v3 hardened
  // FlashList and STILL flickered for the owner. v4 (this) drops recycling
  // entirely — FlatList mounts one durable row per client — so a cell can
  // never be reused into a stale/blank frame. See ClientListRow.tsx.
  const renderClient = useCallback(
    ({ item, index }: { item: Client; index: number }) => (
      <ClientListRow
        item={item}
        // First / last cell of the inset group → rounded top / bottom corners.
        // `displayClients.length` is in the deps so the bottom rounding tracks
        // the true tail; a page appending (length grows) just re-rounds the new
        // last row — a cheap style change, never an identity churn.
        isFirst={index === 0}
        isLast={index === displayClients.length - 1}
        canDelete={canDelete}
        palette={palette}
        onPress={openClientDetail}
        onPressInRow={prefetchClientDetail}
        onEdit={openEditModal}
        onDeleteRequest={requestDelete}
      />
    ),
    [displayClients.length, canDelete, palette, openClientDetail, prefetchClientDetail, openEditModal, requestDelete],
  );

  // Plate-result row renderer (#19.3). The госномер is the visual anchor
  // (PlateResultCard renders a ГОСТ plate badge), with авто + клиент to
  // its right — the same hierarchy the owner sees in the Касса. Tapping
  // opens the owning client's card (no per-car expansion).
  const renderPlateResult = useCallback(
    ({ item, index }: { item: { client: Client; car: Car }; index: number }) => (
      <PlateResultCard
        plate={item.car.plateNumber}
        makeModel={item.car.makeModel}
        clientName={item.client.fullName}
        // First / last row of the inset group → rounded top / bottom corners,
        // exactly like the people-list rows so both search modes look identical.
        isFirst={index === 0}
        isLast={index === plateResults.length - 1}
        onPress={() => openClientDetail(item.client.id)}
        onPressIn={() => prefetchClientDetail(item.client.id)}
      />
    ),
    [plateResults.length, openClientDetail, prefetchClientDetail],
  );

  // getItemLayout for BOTH lists — every row is a known fixed height, so the
  // plain RN FlatList never measures a cell. No measurement pass means no
  // re-anchoring and no blank/jumping rows mid-scroll (the owner's bug). The
  // header (retail hero) is measured separately by VirtualizedList and its
  // height is added to these offsets automatically.
  const getClientItemLayout = useCallback(
    (_: ArrayLike<Client> | null | undefined, index: number) => ({
      length: CLIENT_ROW_HEIGHT,
      offset: CLIENT_ROW_HEIGHT * index,
      index,
    }),
    [],
  );
  const getPlateItemLayout = useCallback(
    (_: ArrayLike<{ client: Client; car: Car }> | null | undefined, index: number) => ({
      length: PLATE_ROW_HEIGHT,
      offset: PLATE_ROW_HEIGHT * index,
      index,
    }),
    [],
  );

  // Retail-pin header — memoised ELEMENT around the module-scope
  // RetailPinCard. The previous version declared the pin component INSIDE
  // the render body, so every screen re-render (e.g. `isFetchingNextPage`
  // flipping during scroll-pagination) produced a new component TYPE and
  // React remounted the whole gradient header — a visible blink at the
  // top of the list. Now the type is stable and re-renders are no-ops.
  const openRetailDetail = useCallback(
    () => navigation.navigate('ClientDetail', { id: retailPinTargetId }),
    [navigation, retailPinTargetId],
  );
  const retailHeader = useMemo(
    () => (
      <View style={{ paddingHorizontal: spacing[4] }}>
        <RetailPinCard onPress={openRetailDetail} />
      </View>
    ),
    [openRetailDetail],
  );

  // Stable contentContainerStyle objects for both FlashLists. Inline
  // object literals here would get a NEW identity on every screen
  // re-render — and `isFetchingNextPage` flips exactly mid-scroll during
  // pagination, which would hand the virtualiser a "changed" style prop
  // in the middle of a fling. Memoised on the only real input
  // (tabBarHeight) they stay referentially constant across scrolling.
  const plateListContentStyle = useMemo(
    // No horizontal padding here — each PlateResultCard supplies its own inset
    // group margin (spacing[4]), exactly like the people-list rows, so both
    // search modes line up at the same 16pt gutter. paddingTop adds a little
    // air below the plate input.
    () => ({ paddingTop: spacing[2], paddingBottom: tabBarHeight + spacing[4] }),
    [tabBarHeight],
  );
  const clientListContentStyle = useMemo(
    // paddingTop gives the rounded first cell a little air below the search /
    // chips when the retail hero header isn't shown (search / filter active).
    () => ({ ...styles.list, paddingTop: spacing[2], paddingBottom: tabBarHeight + spacing[4] }),
    [tabBarHeight],
  );

  // Pick the freshness signal for the active mode so the badge doesn't
  // lie when the user is in plate mode but the underlying clients query
  // is still loading.
  const activeFreshness =
    mode === 'plate'
      ? {
          isFetching: plateQuery.isFetching,
          isLoading: plateQuery.isLoading,
          dataUpdatedAt: plateQuery.dataUpdatedAt,
        }
      : { isFetching, isLoading, dataUpdatedAt };

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title="Клиенты"
        onBack={() => navigation.goBack()}
        trailing={
          // trailing = [mode icon][+]. The mode icon flips plate-search ⇄
          // client-search (#19.3). Plate mode → show a "people" icon (tap to
          // search clients); client mode → show a "car" icon (tap to search
          // by госномер). The glyph names the DESTINATION mode.
          <View style={styles.trailingRow}>
            <TouchableOpacity
              style={[styles.modeBtn, { backgroundColor: palette.bg.muted }]}
              onPress={toggleMode}
              accessibilityRole="button"
              accessibilityLabel={mode === 'plate' ? 'Искать клиентов' : 'Искать по госномеру'}
            >
              <Ionicons
                name={mode === 'plate' ? 'people-outline' : 'car-sport-outline'}
                size={19}
                color={palette.text.primary}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.addBtn, { backgroundColor: palette.accent.primary }]}
              onPress={openCreateModal}
              accessibilityRole="button"
              accessibilityLabel="Добавить клиента"
            >
              <Ionicons name="add" size={18} color={colors.white} />
            </TouchableOpacity>
          </View>
        }
      />

      <View style={styles.freshnessRow}>
        <FreshnessBadge query={activeFreshness} />
      </View>

      {mode === 'plate' ? (
        // ── ПОИСК ПО ГОСНОМЕРУ (default) ────────────────────────────────
        // Касса-style plate input. Result cards anchor on the госномер.
        <>
          <View style={styles.plateSearchWrap}>
            <View style={styles.plateLabelRow}>
              <Text style={[styles.plateSearchLabel, { color: palette.text.secondary }]}>ПОИСК ПО ГОСНОМЕРУ</Text>
              <PlateModeSwitcher value={plateMode} onChange={setPlateMode} />
            </View>
            <RussianPlateInput value={plateSearch} onChangeText={setPlateSearch} mode={plateMode} autoFocus={false} />
          </View>

          <FlatList
            data={plateResults}
            keyExtractor={plateKeyExtractor}
            renderItem={renderPlateResult}
            getItemLayout={getPlateItemLayout}
            ListHeaderComponent={retailHeader}
            ListEmptyComponent={
              normalizedPlate.length >= 2 && !plateQuery.isFetching && !carsPlateQuery.isFetching ? (
                <EmptyState icon="car" title="Ничего не найдено" description={`Госномер «${plateSearch}» не найден`} />
              ) : normalizedPlate.length < 2 ? (
                <EmptyState
                  icon="search"
                  title="Введите госномер"
                  description="Найдите авто и клиента по номеру — RU или INT"
                />
              ) : null
            }
            contentContainerStyle={plateListContentStyle}
            keyboardShouldPersistTaps="handled"
            // Plain RN FlatList (NOT FlashList): no cell recycling means a row
            // can never paint a stale/blank frame on Fabric — the exact
            // «дёргаются и пропадают» the owner saw. removeClippedSubviews is
            // OFF so an off-screen row is never detached/re-attached (another
            // blank-frame source); getItemLayout keeps scrolling exact + cheap.
            removeClippedSubviews={false}
            initialNumToRender={12}
            windowSize={11}
            maxToRenderPerBatch={12}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
            }
          />
        </>
      ) : (
        // ── ПОИСК КЛИЕНТОВ (имя / авто / телефон) + фильтры ─────────────
        <>
          <View style={styles.searchWrap}>
            <SearchInput
              value={search}
              onChange={(v) => {
                // No manual page reset — `search` lives in the infinite-query
                // key, so a new query resets paging to page 1 automatically.
                setSearch(v);
              }}
              placeholder="Имя, авто или телефон"
            />
          </View>

          {/* Filter chips — Все / По источнику / Постоянные / Новые /
              Без номеров. Pinned row height so the chips hug the top
              instead of stretching+centering in the flex column (#19.1). */}
          <View style={styles.chipsBar}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
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
                label={filter === 'source' && sourceFilter ? `Источник: ${sourceFilter}` : 'По источнику'}
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
              <FilterChip
                active={filter === 'noplate'}
                label="Без номеров"
                icon="help-circle-outline"
                onPress={() => {
                  haptic('select');
                  setFilter((f) => (f === 'noplate' ? 'all' : 'noplate'));
                  setSourceFilter(null);
                }}
                palette={palette}
              />
            </ScrollView>
          </View>

          {data === undefined && isError ? (
            // Cold start with no cached pages AND the fetch failed (e.g. a
            // deploy 502 window): show a recoverable error with a real retry
            // instead of an eternal skeleton. With cached pages present,
            // global placeholderData keeps the list visible and this branch
            // never triggers (stale-while-revalidate). backendRecovery also
            // refetches this query automatically once /health returns.
            <QueryErrorState
              title="Не удалось загрузить клиентов"
              description="Проверьте соединение и попробуйте ещё раз."
              onRetry={() => refetch()}
            />
          ) : data === undefined ? (
            <ListSkeleton count={8} />
          ) : (
            <FlatList
              data={displayClients}
              keyExtractor={clientKeyExtractor}
              renderItem={renderClient}
              getItemLayout={getClientItemLayout}
              ListHeaderComponent={showRetailPin ? retailHeader : null}
              ListEmptyComponent={
                !isLoading ? (
                  filteredClients.length === 0 && !search && filter === 'all' ? (
                    <EmptyState
                      icon="people"
                      title="Нет клиентов"
                      description="Добавьте первого клиента"
                      action={{ label: 'Добавить клиента', onPress: openCreateModal }}
                    />
                  ) : (
                    <EmptyState
                      icon="search"
                      title={
                        filter === 'new'
                          ? 'Нет новых клиентов'
                          : filter === 'regular'
                            ? 'Нет постоянных клиентов'
                            : filter === 'noplate'
                              ? 'Нет клиентов без номеров'
                              : 'Ничего не найдено'
                      }
                      description={search ? `Запрос: «${search}»` : undefined}
                    />
                  )
                ) : null
              }
              contentContainerStyle={clientListContentStyle}
              // Plain RN FlatList — the whole point of the redesign. FlashList
              // RECYCLES cells; on Fabric a recycled cell could paint a stale or
              // blank frame for a beat, which is exactly the «строки исчезают при
              // скролле» the owner kept hitting. FlatList mounts one row per
              // client and never reuses it, so a row physically cannot blank.
              // Fixed-height rows + getItemLayout mean zero measurement passes
              // (no re-anchoring), and removeClippedSubviews OFF guarantees an
              // off-screen-then-back row is never detached/re-attached blank.
              // This list only ever appends pages at the BOTTOM, so nothing
              // re-anchors the top.
              removeClippedSubviews={false}
              initialNumToRender={12}
              windowSize={11}
              maxToRenderPerBatch={12}
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
              }
              onEndReached={() => {
                // Accumulate the next page instead of swapping the current
                // one (audit #8.6). Guarded so a fast fling doesn't fire
                // overlapping page fetches. `!isPlaceholderData` matters:
                // right after the search text changes, the list still shows
                // the PREVIOUS key's pages via global `placeholderData` —
                // paginating that borrowed snapshot would race the in-flight
                // page-1 fetch of the NEW key and replace the visible rows
                // with mismatched identities (visible as rows vanishing).
                if (hasNextPage && !isFetchingNextPage && !isPlaceholderData) fetchNextPage();
              }}
              onEndReachedThreshold={0.5}
              ListFooterComponent={
                isFetchingNextPage ? (
                  <View style={{ paddingVertical: spacing[4], alignItems: 'center' }}>
                    <ActivityIndicator size="small" color={colors.primary[500]} />
                  </View>
                ) : null
              }
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
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Источник</Text>
          <TouchableOpacity
            onPress={() => setFormSourceOpen((v) => !v)}
            activeOpacity={0.7}
            style={[
              styles.formInput,
              styles.formPicker,
              { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
            ]}
          >
            <Text style={[styles.formPickerText, { color: formSource ? palette.text.primary : palette.text.tertiary }]}>
              {formSource ?? 'Выберите источник'}
            </Text>
            <Ionicons name={formSourceOpen ? 'chevron-up' : 'chevron-down'} size={16} color={palette.text.tertiary} />
          </TouchableOpacity>
          {/* In-flow source picker — NOT a nested RN Modal (a Modal over the
              open create-Modal won't present on iOS → the list never opened,
              #19.3). Expands right under the field. */}
          <SourcePickerInline
            visible={formSourceOpen}
            onClose={() => setFormSourceOpen(false)}
            selected={formSource}
            onPick={(value) => setFormSource(value)}
          />
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
              <CarPlateField
                plate={carPlate}
                mode={carMode}
                noPlate={carNoPlate}
                onChangePlate={setCarPlate}
                onChangeMode={setCarMode}
                onChangeNoPlate={setCarNoPlate}
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
    </View>
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
        style={[cnStyles.chipLabel, { color: active ? palette.accent.primaryText : palette.text.secondary }]}
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
  // Header trailing slot: [mode icon][+]. Mode icon flips plate ⇄ client.
  trailingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  modeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  // Plate-search header (Касса-style). The label row hosts the RU/INT
  // switcher to the right of the section label.
  plateSearchWrap: {
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
  },
  plateLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing[2],
  },
  plateSearchLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  // Filter-chips row — PINNED height so it hugs the chips instead of
  // stretching+vertically-centering in the flex column (#19.1 root cause,
  // same bug fixed on the Schedule legend). flexGrow/flexShrink 0 + a
  // fixed height keep the layout compact.
  chipsBar: {
    height: 44,
    flexGrow: 0,
    flexShrink: 0,
    justifyContent: 'center',
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

  // Row + swipe styles moved to components/ClientListRow.tsx with the row.

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
