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
import { Swipeable } from 'react-native-gesture-handler';
import { LinearGradient } from 'expo-linear-gradient';
import IosScreenHeader from '../components/IosScreenHeader';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { suppliersApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import SearchInput from '../components/SearchInput';
import { ListSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import AnimatedCard from '../components/AnimatedCard';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import FreshnessBadge from '../components/FreshnessBadge';
import PurchaseOrdersScreen from './PurchaseOrdersScreen';
import { haptic } from '../platform/haptics';
import { colors, fontSize, fontWeight, borderRadius, spacing, softTint } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { UserRole, type Supplier } from '../../../shared/types';
import { formatPhone } from '../../../shared/validation/phone';

// Top-level segment: the «Поставщики» section now hosts BOTH the supplier
// list and «Заказы поставщикам» (purchase orders) under one segmented control,
// so there's no separate «Заказы» menu entry duplicating the entry point.
type SuppliersView = 'suppliers' | 'orders';

function formatMoney(v: number) {
  return (
    Math.round(v)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
  );
}

// ── SupplierRow ────────────────────────────────────────────────────────
// Module-scope React.memo'd row + Swipeable wrapper. Identity is stable
// across parent re-renders, so each keystroke in the search box (which
// rebuilds the SuppliersScreen) doesn't tear down + rebuild every row.
//
// Memo works because the props are primitive + stable callbacks via
// useCallback in the parent (onPress / onEdit / onDelete). Swipeable
// retains its native handler across renders thanks to that stability.
//
// NOTE: this row only renders REGULAR (non-system) suppliers. The
// pinned `kind === 'used_purchase'` system supplier is rendered above
// the FlashList by `SystemSupplierCard` so we can give it a fully
// distinct visual treatment (accent gradient, no swipe affordance,
// dedicated subtitle).
interface SupplierRowProps {
  item: Supplier;
  index: number;
  canDelete: boolean;
  onPress: (id: string) => void;
  /**
   * Fires on `onPressIn` so the detail prefetch lands BEFORE the
   * navigation push. Stable identity from useCallback in the parent.
   */
  onPressInRow: (id: string) => void;
  onEdit: (s: Supplier) => void;
  onDelete: (s: Supplier) => void;
  /** Theme palette tokens — passed in so memoised row reads dark/light
   *  surface without subscribing to the theme context itself. */
  cardBg: string;
  separatorColor: string;
  textPrimary: string;
  textTertiary: string;
  iconCircleCleanBg: string;
  iconCircleCleanColor: string;
  /** Debt icon-circle fill — resolved in the parent (where the theme
   *  palette lives) so the memoised row stays subscription-free. */
  iconCircleDebtBg: string;
}
const SupplierRow = React.memo(function SupplierRow({
  item,
  index,
  canDelete,
  onPress,
  onPressInRow,
  onEdit,
  onDelete,
  cardBg,
  separatorColor,
  textPrimary,
  textTertiary,
  iconCircleCleanBg,
  iconCircleCleanColor,
  iconCircleDebtBg,
}: SupplierRowProps) {
  const hasDebt = item.currentDebt > 0;

  const card = (
    <AnimatedCard
      style={[styles.card, { backgroundColor: cardBg, borderBottomColor: separatorColor }]}
      index={index}
      onPress={() => onPress(item.id)}
      onPressIn={() => onPressInRow(item.id)}
    >
      <View style={styles.row}>
        <View
          style={[
            styles.iconCircle,
            hasDebt
              ? [styles.iconCircleDebt, { backgroundColor: iconCircleDebtBg }]
              : [styles.iconCircleClean, { backgroundColor: iconCircleCleanBg }],
          ]}
        >
          <Ionicons
            name={hasDebt ? 'wallet-outline' : 'business-outline'}
            size={18}
            color={hasDebt ? colors.orange[600] : iconCircleCleanColor}
          />
        </View>
        <View style={styles.info}>
          <View style={styles.nameRow}>
            <Text style={[styles.cardName, { color: textPrimary }]} numberOfLines={1}>
              {item.name}
            </Text>
          </View>
          <Text style={[styles.cardSub, { color: textTertiary }]} numberOfLines={1}>
            {[item.contactPerson, item.phone ? formatPhone(item.phone) : null].filter(Boolean).join(' · ') ||
              'Без контактов'}
          </Text>
        </View>
        <View style={styles.amountWrap}>
          {hasDebt ? (
            <>
              <Text style={styles.debtAmount}>{formatMoney(item.currentDebt)}</Text>
              <Text style={[styles.debtLabel, { color: textTertiary }]}>долг</Text>
            </>
          ) : (
            /* «Без долга» badge — a single crisp green disc with a plain
               white checkmark glyph. The previous `checkmark-circle`
               drew a green glyph (which itself contains a ring) inside
               the lighter row, reading as a circle-in-a-circle with poor
               contrast. A filled disc + white tick reads as one clean
               badge. */
            <View style={styles.cleanBadge}>
              <Ionicons name="checkmark" size={13} color={colors.white} />
            </View>
          )}
        </View>
        <Ionicons name="chevron-forward" size={16} color={textTertiary} style={{ marginLeft: 6 }} />
      </View>
    </AnimatedCard>
  );

  if (!canDelete) return card;

  return (
    <Swipeable
      renderRightActions={() => (
        /* Two trailing actions, iOS-style: Edit (primary blue, pencil)
           then Delete (destructive red, trash). Tap on Edit opens
           the same edit modal as a regular row tap; tap on Delete
           goes through ConfirmDialog → optimistic delete. */
        <View style={styles.swipeActionsRow}>
          <TouchableOpacity style={styles.swipeEditAction} onPress={() => onEdit(item)} activeOpacity={0.85}>
            <Ionicons name="pencil" size={20} color={colors.white} />
            <Text style={styles.swipeEditText}>Изменить</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.swipeDeleteAction} onPress={() => onDelete(item)} activeOpacity={0.85}>
            <Ionicons name="trash-outline" size={20} color={colors.white} />
            <Text style={styles.swipeDeleteText}>Удалить</Text>
          </TouchableOpacity>
        </View>
      )}
      overshootRight={false}
    >
      {card}
    </Swipeable>
  );
});

// ── SystemSupplierCard ─────────────────────────────────────────────────
// Distinct visual treatment for the pinned «Покупка б/у товара»
// system supplier. Per UX spec:
//   • not the regular gray card — uses a primary-tinted gradient
//     surface that visually separates it from contractor suppliers,
//   • no phone / contact info (it's a system channel, not a person),
//   • dedicated icon row (package + arrow-down) reinforcing the
//     "inbound used goods purchase" semantics,
//   • subtitle "Покупка б/у товаров от клиентов и третьих лиц",
//   • no swipe-to-delete (the backend would 403 anyway),
//   • renders above the FlashList with a section header / separator
//     below to break the visual rhythm before the regular list begins.
interface SystemSupplierCardProps {
  item: Supplier;
  onPress: (id: string) => void;
  onPressIn: (id: string) => void;
}
const SystemSupplierCard = React.memo(function SystemSupplierCard({
  item,
  onPress,
  onPressIn,
}: SystemSupplierCardProps) {
  const palette = useColors();
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={() => onPress(item.id)}
      onPressIn={() => onPressIn(item.id)}
      style={styles.systemCardWrap}
    >
      <LinearGradient
        colors={[colors.primary[50], colors.primary[100]]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.systemCardSurface}
      >
        <View style={styles.systemIconCircle}>
          <Ionicons name="cube-outline" size={20} color={colors.primary[700]} />
          <View style={styles.systemIconBadge}>
            <Ionicons name="arrow-down" size={10} color={colors.white} />
          </View>
        </View>
        <View style={styles.systemInfo}>
          <View style={styles.systemNameRow}>
            <Text style={styles.systemName} numberOfLines={1}>
              {item.name}
            </Text>
            <View
              style={[
                styles.systemChip,
                palette.mode === 'dark' && { backgroundColor: softTint(colors.primary[600], 'dark') },
              ]}
            >
              <Text style={styles.systemChipText}>СИСТЕМНЫЙ</Text>
            </View>
          </View>
          <Text style={styles.systemSubtitle} numberOfLines={2}>
            Приём б/у запчастей от клиентов: долг поставщику растёт
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={colors.primary[600]} />
      </LinearGradient>
    </TouchableOpacity>
  );
});

export default function SuppliersScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const { hasPermission, isRole } = useAuth();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // Segmented switch between the supplier list and «Заказы поставщикам».
  // Orders live INSIDE this section now (owner: «лучше встроить заказы в
  // действующий раздел Поставщики»), so the embedded PurchaseOrdersScreen
  // renders here instead of behind a standalone menu entry.
  const [view, setView] = useState<SuppliersView>('suppliers');

  // Permission gate for the destructive swipe-delete. Owner-class roles
  // see it unconditionally; otherwise we require `suppliers_access`
  // (the only suppliers-related permission key in UserPermissions).
  const canDelete = isRole(UserRole.SUPERADMIN, UserRole.DIRECTOR) || hasPermission('suppliers_access');
  // Write gate for placing purchase orders — matches PurchaseOrdersScreen
  // (director / admin / superadmin); the server re-checks on every mutation.
  const canWriteOrders = isRole(UserRole.DIRECTOR, UserRole.ADMIN, UserRole.SUPERADMIN);

  // Confirm dialog state — driven by row swipe.
  const [pendingDelete, setPendingDelete] = useState<Supplier | null>(null);

  // Header CTA «Возврат брака» — opens a supplier picker sheet. After
  // the owner taps a contractor we navigate to its detail screen with
  // `openDefectReturn: true`, which auto-opens the existing defect
  // return modal there. We don't host the defect-return flow at the
  // list level because the modal needs supplier-scoped data (defect
  // warehouse contents filtered by purchase history, etc.) that the
  // detail screen already loads.
  const [defectPickerOpen, setDefectPickerOpen] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [comment, setComment] = useState('');

  const {
    data: suppliersRaw,
    isLoading,
    isFetching,
    dataUpdatedAt,
  } = useQuery<Supplier[] | { data: Supplier[] }>({
    queryKey: ['suppliers', search],
    queryFn: async () => {
      const res = await suppliersApi.getAll({ search });
      // Backend's PaginatedResponse<Supplier> shape is `{ data, total, page, limit }`.
      // Always unwrap to a flat array — keeps `suppliers` typed as `Supplier[]`
      // for the FlashList renderer below.
      const body = res.data as any;
      return Array.isArray(body) ? body : (body?.data ?? []);
    },
    // SWR: when `search` mutates the key, keep the previous results
    // visible until the new ones arrive. No empty flash mid-typing.
    placeholderData: (prev) => prev,
  });

  // Defensive coercion: older app versions persisted the raw paginated
  // wrapper into AsyncStorage. On cold-start that hydrated value lands
  // here before the new queryFn runs. Pass non-array data to FlashList
  // and iOS hangs/crashes (it walks `.length` then indexes). Normalise
  // here so the renderer always sees `Supplier[]`.
  const suppliers: Supplier[] | undefined = Array.isArray(suppliersRaw)
    ? suppliersRaw
    : suppliersRaw && typeof suppliersRaw === 'object' && 'data' in suppliersRaw
      ? (suppliersRaw as { data: Supplier[] }).data
      : suppliersRaw === undefined
        ? undefined
        : [];

  // Split system vs. regular suppliers. The system row (pinned
  // "Покупка б/у товара") is rendered above the FlashList with a
  // distinct visual treatment; the FlashList itself only paints
  // contractor suppliers. We don't filter out from a separate list —
  // useMemo keeps the partition stable across keystrokes so FlashList
  // doesn't tear down rows when search debounces.
  const { systemSupplier, regularSuppliers } = useMemo(() => {
    const list = suppliers ?? [];
    let system: Supplier | null = null;
    const regular: Supplier[] = [];
    for (const s of list) {
      if (s.isSystem || s.kind === 'used_purchase') {
        // Backend may return multiple system rows in theory; keep the
        // first and let the rest fall through as "regular" so the
        // owner can still see them rather than silently dropping data.
        if (!system) {
          system = s;
          continue;
        }
      }
      regular.push(s);
    }
    return { systemSupplier: system, regularSuppliers: regular };
  }, [suppliers]);

  // Sheet picker list — only real contractors. The system row is
  // excluded because the defect-return flow doesn't apply to it (it
  // has no standard deliveries / purchase records to return against).
  const defectPickerSuppliers = useMemo(
    () => regularSuppliers.filter((s) => !s.isSystem && s.kind !== 'used_purchase'),
    [regularSuppliers],
  );

  const createMutation = useMutation({
    mutationFn: (d: any) => suppliersApi.create(d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      closeModal();
    },
    onError: () => Alert.alert('Ошибка', 'Ошибка при создании'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => suppliersApi.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      closeModal();
    },
    onError: () => Alert.alert('Ошибка', 'Ошибка при обновлении'),
  });

  // Optimistic delete — cache snapshot, eager local removal, rollback on
  // error. The backend already exposes DELETE /suppliers/:id; we never
  // touch the API contract, only the JS-side cache shape.
  const deleteMutation = useMutation({
    mutationFn: (id: string) => suppliersApi.remove(id),
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: ['suppliers'] });
      const prev = queryClient.getQueriesData<Supplier[]>({ queryKey: ['suppliers'] });
      queryClient.setQueriesData<Supplier[] | undefined>({ queryKey: ['suppliers'] }, (old) =>
        old ? old.filter((s) => s.id !== id) : old,
      );
      return { prev };
    },
    onError: (_err, _id, ctx) => {
      ctx?.prev.forEach(([key, val]) => queryClient.setQueryData(key, val));
      Alert.alert('Не удалось удалить', 'Поставщик может быть связан с поставками или долгами.');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    },
  });

  const openCreate = useCallback(() => {
    setEditingSupplier(null);
    setName('');
    setPhone('');
    setContactPerson('');
    setComment('');
    setModalOpen(true);
  }, []);

  const openEdit = useCallback((s: Supplier) => {
    setEditingSupplier(s);
    setName(s.name);
    setPhone(s.phone ? formatPhone(s.phone) : '');
    setContactPerson(s.contactPerson || '');
    setComment(s.comment || '');
    setModalOpen(true);
  }, []);

  const closeModal = () => {
    setModalOpen(false);
    setEditingSupplier(null);
  };

  const handleSubmit = () => {
    const payload = {
      name,
      phone: phone || undefined,
      contactPerson: contactPerson || undefined,
      comment: comment || undefined,
    };
    if (editingSupplier) {
      updateMutation.mutate({ id: editingSupplier.id, data: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['suppliers'] });
    setRefreshing(false);
  };

  // Stable handlers passed to memoised SupplierRow — without useCallback
  // every search-input keystroke would change the function identity and
  // bust React.memo's shallow prop comparison for every row in the list.
  const handlePressSupplier = useCallback((id: string) => navigation.navigate('SupplierDetail', { id }), [navigation]);
  const handleDeleteSupplier = useCallback((s: Supplier) => setPendingDelete(s), []);

  // Defect-return picker → SupplierDetail with auto-open flag. Closes
  // the sheet first so the next-screen mount doesn't fight a backdrop
  // dismiss animation.
  const handlePickDefectSupplier = useCallback(
    (id: string) => {
      setDefectPickerOpen(false);
      // Tiny delay matches the Modal close animation; without it the
      // detail screen mounts before the sheet has fully dismissed,
      // which produces a visible flicker on iOS.
      setTimeout(() => navigation.navigate('SupplierDetail', { id, openDefectReturn: true }), 250);
    },
    [navigation],
  );

  // Prefetch-on-tap — by the time SupplierDetailScreen mounts, the
  // canonical query is already in flight (often resolved). Fires from
  // the row's `onPressIn`, BEFORE the navigation push.
  const handlePressInSupplier = useCallback(
    (id: string) => {
      queryClient.prefetchQuery({
        queryKey: ['supplier', id],
        queryFn: async () => (await suppliersApi.getById(id)).data,
        staleTime: 60_000,
      });
    },
    [queryClient],
  );

  const renderSupplier = useCallback(
    ({ item, index }: { item: Supplier; index: number }) => (
      <SupplierRow
        item={item}
        index={index}
        canDelete={canDelete}
        onPress={handlePressSupplier}
        onPressInRow={handlePressInSupplier}
        onEdit={openEdit}
        onDelete={handleDeleteSupplier}
        cardBg={palette.bg.card}
        separatorColor={palette.border.subtle}
        textPrimary={palette.text.primary}
        textTertiary={palette.text.tertiary}
        iconCircleCleanBg={palette.bg.muted}
        iconCircleCleanColor={palette.text.tertiary}
        iconCircleDebtBg={palette.mode === 'dark' ? softTint(colors.orange[600], 'dark') : colors.orange[50]}
      />
    ),
    [
      canDelete,
      handlePressSupplier,
      handlePressInSupplier,
      openEdit,
      handleDeleteSupplier,
      palette.mode,
      palette.bg.card,
      palette.bg.muted,
      palette.border.subtle,
      palette.text.primary,
      palette.text.tertiary,
    ],
  );

  // Pinned system row — rendered as the FlashList's ListHeaderComponent
  // so it shares the same scroll surface as the regular rows. Falsy
  // when the backend hasn't sent a system supplier (e.g. very old
  // tenants pre-migration).
  const listHeader = systemSupplier ? (
    <View>
      <SystemSupplierCard item={systemSupplier} onPress={handlePressSupplier} onPressIn={handlePressInSupplier} />
      {/* Section separator — small label + hairline divider so the
          regular contractor list visually starts as its own block. */}
      <View style={styles.sectionSeparator}>
        <View style={[styles.sectionDivider, { backgroundColor: palette.border.subtle }]} />
        <Text style={[styles.sectionLabel, { color: palette.text.tertiary }]}>ПОСТАВЩИКИ</Text>
        <View style={[styles.sectionDivider, { backgroundColor: palette.border.subtle }]} />
      </View>
    </View>
  ) : null;

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title="Поставщики"
        onBack={() => navigation.goBack()}
        trailing={
          view === 'suppliers' ? (
            /* Suppliers segment — TWO actions:
               1) «Возврат брака» — secondary, opens a supplier picker
                  sheet that forwards to SupplierDetail with the
                  auto-open flag.
               2) «+ Новый» — primary, opens the create-supplier modal. */
            <View style={styles.headerTrailing}>
              <TouchableOpacity
                onPress={() => setDefectPickerOpen(true)}
                style={[
                  styles.headerSecondaryBtn,
                  { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
                ]}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Возврат брака"
              >
                <Ionicons name="return-down-back-outline" size={16} color={colors.orange[600]} />
                <Text style={[styles.headerSecondaryText, { color: palette.text.primary }]} numberOfLines={1}>
                  Возврат брака
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.addBtn}
                onPress={openCreate}
                hitSlop={8}
                accessibilityLabel="Новый поставщик"
              >
                <Ionicons name="add" size={18} color={colors.white} />
              </TouchableOpacity>
            </View>
          ) : canWriteOrders ? (
            /* Orders segment — single «+» that opens order creation. The
               embedded PurchaseOrdersScreen drops its own header, so this
               is the create entry-point (mirrors the standalone screen). */
            <TouchableOpacity
              style={styles.addBtn}
              onPress={() => {
                haptic('tap');
                navigation.navigate('PurchaseOrderCreate');
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Новый заказ поставщику"
            >
              <Ionicons name="add" size={18} color={colors.white} />
            </TouchableOpacity>
          ) : undefined
        }
      />

      {/* Segmented control — «Поставщики | Заказы». Compact iOS-style track
          with a sliding active pill; switches the section body below. */}
      <View style={styles.segmentWrap}>
        <View style={[styles.segment, { backgroundColor: palette.bg.muted }]}>
          {(['suppliers', 'orders'] as SuppliersView[]).map((key) => {
            const active = view === key;
            return (
              <TouchableOpacity
                key={key}
                style={[styles.segmentItem, active && [styles.segmentItemActive, { backgroundColor: palette.bg.card }]]}
                onPress={() => {
                  if (active) return;
                  haptic('select');
                  setView(key);
                }}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
              >
                <Ionicons
                  name={key === 'suppliers' ? 'business-outline' : 'clipboard-outline'}
                  size={15}
                  color={active ? palette.text.primary : palette.text.tertiary}
                />
                <Text
                  style={[styles.segmentText, { color: active ? palette.text.primary : palette.text.secondary }]}
                  numberOfLines={1}
                >
                  {key === 'suppliers' ? 'Поставщики' : 'Заказы'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {view === 'orders' ? (
        // «Заказы поставщикам» rendered inline (embedded). Same navigator
        // context (MoreStack), so PurchaseOrderCreate / Detail still resolve.
        <View style={{ flex: 1 }}>
          <PurchaseOrdersScreen embedded />
        </View>
      ) : (
        <>
          {/* FreshnessBadge — HYBRID-perf plan. Tiny pulsing label that
              reassures the owner this list rendered from cache and is being
              revalidated, not "stuck". */}
          <View style={styles.freshnessRow}>
            <FreshnessBadge query={{ isFetching, isLoading, dataUpdatedAt }} />
          </View>

          <View style={styles.searchWrap}>
            <SearchInput value={search} onChange={setSearch} placeholder="Поиск поставщика..." />
          </View>

          {suppliers === undefined ? (
            // Cold-start guard — show skeleton, never EmptyState while
            // data is genuinely unknown. Once any response (even cached)
            // lands, EmptyState becomes legitimate again.
            <ListSkeleton count={6} />
          ) : !suppliers.length && !isLoading ? (
            <EmptyState
              title="Нет поставщиков"
              description="Добавьте первого поставщика"
              action={{ label: 'Добавить', onPress: openCreate }}
            />
          ) : (
            <FlashList
              data={regularSuppliers}
              keyExtractor={(i) => i.id}
              renderItem={renderSupplier}
              ListHeaderComponent={listHeader}
              ListEmptyComponent={
                // When ONLY the system supplier exists (no contractors yet)
                // we still want to render a friendly nudge below it.
                systemSupplier && regularSuppliers.length === 0 ? (
                  <View style={styles.listEmptyHint}>
                    <Text style={[styles.listEmptyHintText, { color: palette.text.tertiary }]}>
                      Контрагентов пока нет. Добавьте первого поставщика.
                    </Text>
                  </View>
                ) : null
              }
              contentContainerStyle={styles.list}
              contentInset={{ bottom: tabBarHeight }}
              scrollIndicatorInsets={{ bottom: tabBarHeight }}
              removeClippedSubviews
              refreshControl={
                <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
              }
            />
          )}
        </>
      )}

      {/* Возврат брака picker — appears when the owner taps the header
          CTA. Lists only real contractors (system row excluded by
          definition — defect returns don't apply to it). Selecting a
          row navigates to SupplierDetail with openDefectReturn:true. */}
      <Modal visible={defectPickerOpen} onClose={() => setDefectPickerOpen(false)} title="Возврат брака">
        <Text style={[styles.pickerHint, { color: palette.text.secondary }]}>
          Выберите поставщика, которому нужно вернуть бракованный товар. После выбора откроется форма возврата.
        </Text>
        {defectPickerSuppliers.length === 0 ? (
          <View style={styles.pickerEmpty}>
            <Ionicons name="business-outline" size={32} color={palette.text.tertiary} />
            <Text style={[styles.pickerEmptyText, { color: palette.text.tertiary }]}>Контрагенты не найдены</Text>
          </View>
        ) : (
          <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
            {defectPickerSuppliers.map((s) => {
              const hasDebt = s.currentDebt > 0;
              return (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.pickerRow, { borderBottomColor: palette.border.subtle }]}
                  onPress={() => handlePickDefectSupplier(s.id)}
                  activeOpacity={0.7}
                >
                  <View
                    style={[
                      styles.iconCircle,
                      hasDebt
                        ? [
                            styles.iconCircleDebt,
                            {
                              backgroundColor:
                                palette.mode === 'dark' ? softTint(colors.orange[600], 'dark') : colors.orange[50],
                            },
                          ]
                        : [styles.iconCircleClean, { backgroundColor: palette.bg.muted }],
                    ]}
                  >
                    <Ionicons
                      name={hasDebt ? 'wallet-outline' : 'business-outline'}
                      size={16}
                      color={hasDebt ? colors.orange[600] : palette.text.tertiary}
                    />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.pickerName, { color: palette.text.primary }]} numberOfLines={1}>
                      {s.name}
                    </Text>
                    {hasDebt ? (
                      <Text style={styles.pickerDebt} numberOfLines={1}>
                        Долг {formatMoney(s.currentDebt)}
                      </Text>
                    ) : (
                      <Text style={[styles.pickerSub, { color: palette.text.tertiary }]} numberOfLines={1}>
                        Без долга
                      </Text>
                    )}
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
      </Modal>

      <Modal visible={modalOpen} onClose={closeModal} title={editingSupplier ? 'Редактировать' : 'Новый поставщик'}>
        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Название</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            style={[
              styles.formInput,
              { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
            ]}
            placeholder="ООО Запчасти"
            placeholderTextColor={palette.text.tertiary}
          />
        </View>
        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Телефон</Text>
          {/* Phone mask shared with LoginScreen / ClientsScreen — user types
              digits, formatPhone re-formats to +7 (XXX) XXX-XX-XX live. */}
          <TextInput
            value={phone}
            onChangeText={(t) => setPhone(formatPhone(t.replace(/\D/g, '')))}
            style={[
              styles.formInput,
              { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
            ]}
            keyboardType="phone-pad"
            autoComplete="tel"
            placeholder="+7 (___) ___-__-__"
            placeholderTextColor={palette.text.tertiary}
          />
        </View>
        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Контактное лицо</Text>
          <TextInput
            value={contactPerson}
            onChangeText={setContactPerson}
            style={[
              styles.formInput,
              { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
            ]}
            placeholder="Имя"
            placeholderTextColor={palette.text.tertiary}
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
                height: 60,
                textAlignVertical: 'top',
                backgroundColor: palette.bg.muted,
                borderColor: palette.border.subtle,
                color: palette.text.primary,
              },
            ]}
            multiline
            placeholder="Необязательно"
            placeholderTextColor={palette.text.tertiary}
          />
        </View>
        <View style={[styles.formActions, { borderTopColor: palette.border.subtle }]}>
          <TouchableOpacity style={[styles.cancelBtn, { borderColor: palette.border.strong }]} onPress={closeModal}>
            <Text style={[styles.cancelBtnText, { color: palette.text.secondary }]}>Отмена</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit}>
            {createMutation.isPending || updateMutation.isPending ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={styles.submitBtnText}>{editingSupplier ? 'Сохранить' : 'Создать'}</Text>
            )}
          </TouchableOpacity>
        </View>
      </Modal>

      <ConfirmDialog
        visible={!!pendingDelete}
        title="Удалить поставщика?"
        message={pendingDelete ? `«${pendingDelete.name}» будет удалён. Это действие нельзя отменить.` : ''}
        confirmText="Удалить"
        variant="danger"
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) deleteMutation.mutate(pendingDelete.id);
          setPendingDelete(null);
        }}
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
  backText: { fontSize: fontSize.sm, color: colors.primary[600], fontWeight: fontWeight.medium },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.gray[900] },
  // ── Header trailing slot ────────────────────────────────────────
  // Two compact actions live in the 36pt trailing zone. The defect
  // return CTA is a pill (icon + label) so the label is discoverable
  // for first-time users; «+ Новый» is a squircle icon-only button —
  // it's the screen's primary mutation and the icon alone is
  // unambiguous in iOS UX (this is exactly the pattern Mail / Notes
  // use for "compose").
  headerTrailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  headerSecondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing[2.5],
    height: 32,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  headerSecondaryText: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: -0.1,
    maxWidth: 110,
  },
  addBtn: {
    backgroundColor: colors.primary[600],
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addBtnText: { color: colors.white, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  // Segmented control «Поставщики | Заказы» — compact iOS track.
  segmentWrap: { paddingHorizontal: spacing[4], paddingTop: spacing[1], paddingBottom: spacing[2] },
  segment: {
    flexDirection: 'row',
    borderRadius: borderRadius.lg,
    padding: 3,
  },
  segmentItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: spacing[2],
    borderRadius: borderRadius.md,
  },
  segmentItemActive: {
    shadowColor: colors.black,
    shadowOpacity: 0.08,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  segmentText: { fontSize: 14, fontWeight: '600', letterSpacing: -0.2 },
  searchWrap: { paddingHorizontal: spacing[4] },
  // FreshnessBadge slot — sits below the header, right-aligned.
  freshnessRow: {
    paddingHorizontal: spacing[4],
    alignItems: 'flex-end',
    minHeight: 14,
  },
  // iOS-grouped plain list — same look as warehouse rows.
  list: { paddingHorizontal: 0, paddingBottom: 120, paddingTop: 0 },
  card: {
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray[200],
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  iconCircle: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  iconCircleClean: { backgroundColor: colors.gray[100] },
  iconCircleDebt: { backgroundColor: colors.orange[50] },
  iconCircleSystem: { backgroundColor: colors.primary[50] },
  // ── Pinned system supplier card ─────────────────────────────────
  // Distinct surface vs. the regular gray row: subtle primary-tinted
  // gradient, larger padding, dedicated icon treatment. Stands apart
  // from the contractor list so the owner reads it as "this is the
  // built-in б/у purchase channel, not a vendor".
  systemCardWrap: {
    marginHorizontal: spacing[3],
    marginTop: spacing[2],
    marginBottom: spacing[2],
    borderRadius: borderRadius['2xl'],
    overflow: 'hidden',
  },
  systemCardSurface: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3.5],
    borderWidth: 1,
    borderColor: colors.primary[200],
    borderRadius: borderRadius['2xl'],
  },
  systemIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary[900],
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  // Tiny inset arrow-down chip on the icon — reinforces the
  // "inbound goods" semantics without crowding the label.
  systemIconBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.primary[600],
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.white,
  },
  systemInfo: { flex: 1, minWidth: 0 },
  systemNameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5] },
  systemName: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.primary[900],
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  systemSubtitle: {
    fontSize: 12,
    color: colors.primary[700],
    marginTop: 2,
    lineHeight: 16,
  },
  // Section separator between the pinned system row and the regular
  // contractor list. Hairline + small label, iOS-grouped style.
  sectionSeparator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[2],
  },
  sectionDivider: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  listEmptyHint: {
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[6],
    alignItems: 'center',
  },
  listEmptyHintText: {
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 18,
  },
  // Defect-return picker sheet rows. Lightweight — same iconography
  // as the main list but tighter padding so the sheet stays compact.
  pickerHint: {
    fontSize: fontSize.sm,
    lineHeight: 18,
    marginBottom: spacing[3],
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pickerName: { fontSize: 14, fontWeight: '600', letterSpacing: -0.1 },
  pickerSub: { fontSize: 11, marginTop: 1 },
  pickerDebt: { fontSize: 11, color: colors.orange[600], fontWeight: '600', marginTop: 1 },
  pickerEmpty: {
    alignItems: 'center',
    paddingVertical: spacing[6],
    gap: spacing[2],
  },
  pickerEmptyText: {
    fontSize: 13,
  },
  info: { flex: 1, minWidth: 0 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5] },
  // System chip — subtle pill next to the supplier name on the pinned
  // "Покупка б/у товара" row. Owners read it as "row is protected,
  // don't try to delete it".
  systemChip: {
    backgroundColor: colors.primary[50],
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
  },
  systemChipText: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.primary[700],
    letterSpacing: 0.4,
  },
  swipeActionsRow: {
    flexDirection: 'row',
  },
  swipeEditAction: {
    backgroundColor: colors.primary[600],
    width: 84,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  swipeEditText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  swipeDeleteAction: {
    backgroundColor: colors.red[500],
    width: 84,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  swipeDeleteText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  cardName: { fontSize: 15, fontWeight: '600', color: colors.gray[900], letterSpacing: -0.1 },
  cardSub: { fontSize: 11, color: colors.gray[400], marginTop: 1 },
  amountWrap: { alignItems: 'flex-end', justifyContent: 'center', minWidth: 70 },
  debtAmount: { fontSize: 15, fontWeight: '700', color: colors.orange[700], letterSpacing: -0.3 },
  debtLabel: { fontSize: 10, color: colors.gray[400], marginTop: -1 },
  // «Без долга» badge — solid green disc + white checkmark. One crisp
  // shape, high contrast on both light and dark rows.
  cleanBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.green[500],
    alignItems: 'center',
    justifyContent: 'center',
  },
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
