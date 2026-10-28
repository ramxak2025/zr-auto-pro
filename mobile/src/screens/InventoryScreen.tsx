import { headerTouchSize, HeaderIsland, HeaderAction } from '../components/ScreenHeaderControls';
import { ScreenSectionScrollView, ScreenSectionFlatList } from '../components/ScreenSectionScrollable';
import ScreenSectionHeader, { useScreenSectionScroll } from '../components/ScreenSectionHeader';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { type NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Ionicons } from '@expo/vector-icons';
import { randomUUID } from 'expo-crypto';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import PointIndicator from '../components/PointIndicator';
import EmptyState from '../components/EmptyState';
import { ListSkeleton } from '../components/Skeleton';
import BarcodeScanner from '../components/BarcodeScanner';
import CachedImage from '../components/CachedImage';
import StorageCellChip from '../components/StorageCellChip';
import { Text } from '../platform/Typography';
import { warehousesApi, warehouseCategoriesApi } from '../api/services';
import { getImageUrl } from '../api/axios';
import { useAuth } from '../contexts/AuthContext';
import { captureDataSession } from '../contexts/dataSession';
import { useColors } from '../contexts/ThemeContext';
import { haptic } from '../platform/haptics';
import { colors, spacing, fontWeight, borderRadius } from '../theme';
import { formatQty, unitLabel } from '../utils/units';
import { productsCountText } from '../utils/storageCellsUi';
import { productFolderParts } from '../../../shared/utils/productFolders';
import { type Product, type Warehouse } from '../../../shared/types';
import { TabBarFlatList } from '../components/TabBarScrollable';
import {
  inventoryError,
  inventoryRows,
  inventorySummary,
  reconcileInventoryDrafts,
  parseInventoryQuantity,
  type InventoryDrafts,
  type InventoryRow,
  type InventoryStockRequest,
} from './inventory/model';
import { captureInventorySession, type InventorySession } from './inventory/saveSession';

interface Entry {
  id: string;
  body: Readonly<InventoryStockRequest>;
}
interface Operation {
  session: InventorySession;
  warehouseId: string;
  isCurrent: () => boolean;
  ownsForm: () => boolean;
  started: boolean;
}
type InventoryRoute = { Inventory: { warehouseId?: string } | undefined };

/** A data-session epoch owns the complete form, including suspended confirmations. */
export default function InventoryScreen() {
  useAuth();
  return <InventoryWorkspace key={captureDataSession().generation} />;
}

function InventoryWorkspace() {
  const section = useScreenSectionScroll();
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, undefined>>>();
  const route = useRoute<RouteProp<InventoryRoute, 'Inventory'>>();
  const queryClient = useQueryClient();
  const palette = useColors();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('warehouse_manage');
  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string | null>(route.params?.warehouseId ?? null);
  const [folderPath, setFolderPath] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [warehouseMenu, setWarehouseMenu] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [scanFeedback, setScanFeedback] = useState<string | null>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [draftsByWarehouse, setDraftsByWarehouse] = useState<Record<string, InventoryDrafts>>({});
  const draftsRef = useRef(draftsByWarehouse);
  const mountedRef = useRef(true);
  const busyRef = useRef(false);
  const activeOperationRef = useRef<Operation | null>(null);
  const canWriteRef = useRef(canWrite);
  canWriteRef.current = canWrite;
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const listRef = useRef<TabBarFlatList<InventoryRow>>(null);
  const focusId = useRef<string | null>(null);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scannerScope = useRef<{ session: InventorySession; warehouseId: string } | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (scrollTimer.current) clearTimeout(scrollTimer.current);
    };
  }, []);

  const warehouseQuery = useQuery<Warehouse[]>({
    queryKey: ['warehouses'],
    queryFn: async () => {
      const result = await warehousesApi.list();
      return Array.isArray(result.data) ? result.data : [];
    },
    enabled: canWrite,
    staleTime: 10 * 60_000,
  });
  const warehouses = warehouseQuery.data ?? [];
  const activeWarehouse =
    warehouses.find((w) => w.id === selectedWarehouseId) ?? warehouses.find((w) => w.kind === 'main') ?? warehouses[0];
  const warehouseId = activeWarehouse?.id;
  const warehouseRef = useRef(warehouseId);
  warehouseRef.current = warehouseId;
  const catalogKey = useMemo(() => ['all-products-check', { warehouseId }], [warehouseId]);
  const catalog = useQuery<Product[]>({
    queryKey: catalogKey,
    queryFn: () => captureInventorySession().loadProducts(warehouseId!),
    enabled: canWrite && !!warehouseId,
    staleTime: 0,
    placeholderData: undefined,
  });
  const folders = useQuery({
    queryKey: ['warehouse-categories', { warehouseId }],
    queryFn: async () => (await warehouseCategoriesApi.getAll(warehouseId)).data,
    enabled: canWrite && !!warehouseId,
    placeholderData: undefined,
  });
  const allProducts = useMemo(() => catalog.data ?? [], [catalog.data]);
  const drafts = (warehouseId && draftsByWarehouse[warehouseId]) || {};
  const rows = useMemo(
    () => inventoryRows(allProducts, folderPath, search, folders.data ?? []),
    [allProducts, folderPath, search, folders.data],
  );
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const pendingCount = Object.values(drafts).filter((draft) => draft.pending).length;
  const missingDrafts = Object.entries(drafts).filter(
    ([id, draft]) =>
      (draft.raw || draft.pending || draft.needsReview) && !allProducts.some((product) => product.id === id),
  );
  const displayNotice =
    notice ??
    (pendingCount ? `Не подтверждено: ${pendingCount}. Повторите проведение, чтобы получить подтверждение.` : null);
  const summary = useMemo(() => inventorySummary(drafts, allProducts), [drafts, allProducts]);

  // Synchronous ref prevents stale increments when multiple scans/taps precede a render.
  const updateDrafts = useCallback((scope: string, update: (previous: InventoryDrafts) => InventoryDrafts) => {
    const next = { ...draftsRef.current, [scope]: update(draftsRef.current[scope] ?? {}) };
    draftsRef.current = next;
    setDraftsByWarehouse(next);
  }, []);
  const setCount = useCallback(
    (product: Product, raw: string) => {
      const scope = warehouseRef.current;
      if (!scope || busyRef.current || !canWriteRef.current || (product.warehouseId && product.warehouseId !== scope))
        return;
      setNotice(null);
      setScanFeedback(null);
      updateDrafts(scope, (previous) => {
        const old = previous[product.id];
        if (old?.pending || (old?.needsReview && !old.reviewReady)) return previous;
        return {
          ...previous,
          [product.id]: {
            raw,
            name: product.name,
            expectedStock: old?.expectedStock ?? product.stock,
            needsReview: old?.needsReview,
            reviewReady: old?.reviewReady,
          },
        };
      });
    },
    [updateDrafts],
  );

  const scrollToFocused = useCallback(() => {
    const index = rowsRef.current.findIndex((row) => row.type === 'product' && row.product.id === focusId.current);
    if (index >= 0) listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.25 });
  }, []);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', () => {
      setKeyboardVisible(true);
      scrollTimer.current = setTimeout(scrollToFocused, 100);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [scrollToFocused]);

  const chooseWarehouse = useCallback((id: string) => {
    if (busyRef.current) return;
    Keyboard.dismiss();
    warehouseRef.current = id;
    setSelectedWarehouseId(id);
    setFolderPath([]);
    setSearch('');
    setNotice(null);
    setScanFeedback(null);
    setWarehouseMenu(false);
  }, []);

  const handleScanned = useCallback(
    (code: string) => {
      const scope = scannerScope.current;
      scannerScope.current = null;
      if (
        !scope ||
        !scope.session.isCurrent() ||
        !mountedRef.current ||
        scope.warehouseId !== warehouseRef.current ||
        busyRef.current ||
        !canWriteRef.current
      )
        return;
      setShowScanner(false);
      const product = allProducts.find((p) => String(p.barcode ?? '').trim() === code.trim());
      if (!product) {
        haptic('warning');
        Alert.alert('Товар не найден', 'Штрих-код не привязан к товару выбранного склада.');
        return;
      }
      const old = draftsRef.current[scope.warehouseId]?.[product.id];
      if (old?.pending || old?.needsReview || (old?.raw && parseInventoryQuantity(old.raw) === null)) {
        Alert.alert('Проверьте факт', 'Сначала завершите проверку введённого количества этого товара.');
        return;
      }
      const next = (Math.round((parseInventoryQuantity(old?.raw ?? '') ?? 0) * 1000) + 1000) / 1000;
      setCount(product, String(next));
      setFolderPath(productFolderParts(product.category));
      setSearch('');
      focusId.current = product.id;
      setScanFeedback(`${product.name}: факт ${formatQty(next)} ${unitLabel(product.unit)}`);
      scrollTimer.current = setTimeout(scrollToFocused, 150);
      haptic('success');
    },
    [allProducts, scrollToFocused, setCount],
  );

  const finish = useCallback((operation: Operation) => {
    if (!operation.ownsForm()) return;
    activeOperationRef.current = null;
    busyRef.current = false;
    setBusy(false);
    setProgress(null);
  }, []);

  const commit = useCallback(
    async (entries: Entry[], operation: Operation) => {
      if (!operation.isCurrent()) {
        finish(operation);
        return;
      }
      setProgress({ done: 0, total: entries.length });
      let completed = 0;
      for (const entry of entries) {
        if (!operation.isCurrent()) {
          finish(operation);
          return;
        }
        updateDrafts(operation.warehouseId, (previous) => ({
          ...previous,
          [entry.id]: { ...previous[entry.id], pending: entry.body },
        }));
        try {
          const response = await operation.session.updateStock(entry.id, entry.body);
          if (!operation.isCurrent()) {
            finish(operation);
            return;
          }
          if (response.data.requestId !== entry.body.requestId || response.data.stock !== entry.body.quantity) {
            throw new Error('Нет подтверждения проведения');
          }
          updateDrafts(operation.warehouseId, (previous) => {
            const next = { ...previous };
            delete next[entry.id];
            return next;
          });
          completed++;
          setProgress({ done: completed, total: entries.length });
        } catch (error: unknown) {
          if (!operation.isCurrent()) {
            finish(operation);
            return;
          }
          const failure = inventoryError(error);
          if (failure.conflict) {
            updateDrafts(operation.warehouseId, (previous) => ({
              ...previous,
              [entry.id]: {
                ...previous[entry.id],
                pending: undefined,
                needsReview: true,
                reviewReady: false,
              },
            }));
            setNotice('Учёт изменился. Обновите список и сверьте факт перед проведением.');
            try {
              const fresh = await operation.session.loadProducts(operation.warehouseId);
              if (!operation.isCurrent()) {
                finish(operation);
                return;
              }
              queryClient.setQueryData(['all-products-check', { warehouseId: operation.warehouseId }], fresh);
              updateDrafts(operation.warehouseId, (previous) => reconcileInventoryDrafts(previous, fresh));
            } catch {
              if (!operation.isCurrent()) {
                finish(operation);
                return;
              }
              setNotice('Не удалось обновить учёт. Обновите список перед сверкой.');
            }
          } else {
            setNotice(
              `Проведено ${completed} из ${entries.length}. ${failure.message} Введённый факт сохранён; повтор использует тот же запрос.`,
            );
          }
          void queryClient.invalidateQueries({ queryKey: ['products'], refetchType: 'none' });
          void queryClient.invalidateQueries({ queryKey: ['inventory-movements'], refetchType: 'none' });
          finish(operation);
          return;
        }
      }
      if (!operation.isCurrent()) {
        finish(operation);
        return;
      }
      setNotice(`Инвентаризация проведена. Обновлено товаров: ${completed}.`);
      haptic('success');
      // A replay receipt describes the ORIGINAL result, possibly before later movements.
      // Refresh current truth; never overwrite the cache from the original receipt.
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory-movements'] });
      void queryClient.invalidateQueries({ queryKey: ['all-products-check'] });
      finish(operation);
    },
    [finish, queryClient, updateDrafts],
  );

  const handleApply = useCallback(() => {
    const scope = warehouseRef.current;
    if (
      !scope ||
      busyRef.current ||
      !canWriteRef.current ||
      catalog.isFetching ||
      catalog.isError ||
      warehouseQuery.isError ||
      allProducts.some((product) => product.warehouseId && product.warehouseId !== scope)
    )
      return;
    const current = draftsRef.current[scope] ?? {};
    const state = inventorySummary(current, allProducts);
    if (!state.counted || state.invalid || state.review) return;
    busyRef.current = true;
    setBusy(true);
    Keyboard.dismiss();
    const session = captureInventorySession();
    const operation: Operation = {
      session,
      warehouseId: scope,
      started: false,
      ownsForm: () =>
        mountedRef.current &&
        session.data.isCurrent() &&
        warehouseRef.current === scope &&
        activeOperationRef.current === operation,
      isCurrent: () => operation.ownsForm() && session.isCurrent() && canWriteRef.current,
    };
    activeOperationRef.current = operation;
    const entries: Entry[] = [];
    for (const [id, draft] of Object.entries(current)) {
      const actual = parseInventoryQuantity(draft.raw);
      if (actual === null) continue;
      entries.push({
        id,
        body:
          draft.pending ??
          Object.freeze({
            type: 'inventory',
            quantity: actual,
            reason: 'Инвентаризация',
            requestId: randomUUID(),
            expectedStock: draft.expectedStock,
            expectedWarehouseId: scope,
          }),
      });
    }
    Alert.alert(
      'Провести инвентаризацию?',
      `Будет пересчитано товаров: ${entries.length}. Остатки заменятся на введённый факт.`,
      [
        {
          text: 'Отмена',
          style: 'cancel',
          onPress: () => {
            if (!operation.started) finish(operation);
          },
        },
        {
          text: 'Провести',
          style: 'destructive',
          onPress: () => {
            if (!operation.isCurrent()) {
              finish(operation);
              return;
            }
            if (!operation.started) {
              operation.started = true;
              void commit(entries, operation);
            }
          },
        },
      ],
      {
        cancelable: true,
        onDismiss: () => {
          if (!operation.started) finish(operation);
        },
      },
    );
  }, [allProducts, catalog.isFetching, catalog.isError, warehouseQuery.isError, commit, finish]);

  const refresh = useCallback(async () => {
    const scope = warehouseRef.current;
    if (!scope || busyRef.current) return;
    const session = captureInventorySession();
    const current = () => mountedRef.current && session.isCurrent() && warehouseRef.current === scope;
    try {
      const fresh = await session.loadProducts(scope);
      if (!current()) return;
      queryClient.setQueryData(['all-products-check', { warehouseId: scope }], fresh);
      updateDrafts(scope, (previous) => reconcileInventoryDrafts(previous, fresh));
    } catch {
      if (current()) setNotice('Не удалось обновить список. Проверьте соединение и повторите.');
    }
  }, [queryClient, updateDrafts]);

  const renderItem = useCallback(
    ({ item }: { item: InventoryRow }) => {
      if (item.type === 'folder')
        return (
          <TouchableOpacity
            onPress={() => {
              Keyboard.dismiss();
              setFolderPath((path) => [...path, item.name]);
            }}
            style={[styles.folderRow, { backgroundColor: palette.bg.card, borderBottomColor: palette.border.subtle }]}
            accessibilityRole="button"
            accessibilityLabel={`Открыть папку ${item.name}`}
          >
            <View style={[styles.folderIcon, { backgroundColor: palette.accent.primarySoft }]}>
              <Ionicons name="folder-open-outline" size={21} color={palette.accent.primaryText} />
            </View>
            <View style={styles.rowInfo}>
              <Text variant="bodyEmph" numberOfLines={1} color={palette.text.primary}>
                {item.name}
              </Text>
              <Text variant="caption" color={palette.text.secondary}>
                {productsCountText(item.count)}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={palette.text.secondary} />
          </TouchableOpacity>
        );
      const product = item.product;
      const draft = drafts[product.id];
      const actual = parseInventoryQuantity(draft?.raw ?? '');
      const invalid = !!draft?.raw && actual === null;
      const baseline = draft?.expectedStock ?? product.stock;
      const diff = actual === null ? null : Math.round((actual - baseline) * 1000) / 1000;
      const photo = getImageUrl(product.photo);
      const locked = !!draft?.pending || !!(draft?.needsReview && !draft.reviewReady);
      return (
        <View
          style={[styles.productRow, { backgroundColor: palette.bg.card, borderBottomColor: palette.border.subtle }]}
        >
          <View style={styles.productTop}>
            {photo ? (
              <CachedImage
                source={{ uri: photo }}
                style={styles.photo}
                resizeMode="cover"
                variant="thumb"
                recyclingKey={product.id}
              />
            ) : null}
            <View style={styles.rowInfo}>
              <Text variant="callout" color={palette.text.primary} numberOfLines={2}>
                {product.name}
              </Text>
              <View style={styles.meta}>
                <Text variant="caption" color={palette.text.secondary}>
                  Учёт: {formatQty(baseline)} {unitLabel(product.unit)}
                </Text>
                <StorageCellChip code={product.storageCellCode} />
              </View>
              <Text
                variant="caption"
                color={
                  invalid || draft?.needsReview
                    ? palette.mode === 'dark'
                      ? colors.red[400]
                      : colors.red[700]
                    : palette.text.secondary
                }
              >
                {invalid
                  ? 'Число от 0, до 3 знаков после запятой'
                  : draft?.needsReview
                    ? 'Учёт изменился — сверьте факт'
                    : draft?.pending
                      ? 'Ожидает подтверждения · повторите'
                      : diff === null
                        ? 'Ещё не пересчитан'
                        : `Разница: ${diff > 0 ? '+' : ''}${formatQty(diff)} ${unitLabel(product.unit)}`}
              </Text>
            </View>
            <View style={styles.fact}>
              <Text variant="caption" color={palette.text.secondary}>
                Факт
              </Text>
              <TextInput
                value={draft?.raw ?? ''}
                onChangeText={(value) => setCount(product, value)}
                editable={!busy && !locked}
                placeholder="—"
                placeholderTextColor={palette.text.secondary}
                keyboardType="decimal-pad"
                returnKeyType="done"
                onSubmitEditing={Keyboard.dismiss}
                onFocus={() => {
                  focusId.current = product.id;
                  if (keyboardVisible) scrollToFocused();
                }}
                style={[
                  styles.input,
                  {
                    color: palette.text.primary,
                    backgroundColor: palette.bg.muted,
                    borderColor:
                      invalid || draft?.needsReview
                        ? palette.mode === 'dark'
                          ? colors.red[400]
                          : colors.red[700]
                        : palette.border.subtle,
                  },
                ]}
                accessibilityLabel={`Факт: ${product.name}, ${unitLabel(product.unit)}`}
              />
            </View>
          </View>
          {draft?.needsReview && draft.reviewReady && actual !== null ? (
            <TouchableOpacity
              style={styles.reviewButton}
              accessibilityRole="button"
              accessibilityLabel={`Подтвердить сверенный факт: ${product.name}`}
              onPress={() => {
                if (!warehouseId || busyRef.current) return;
                updateDrafts(warehouseId, (previous) => ({
                  ...previous,
                  [product.id]: { ...previous[product.id], needsReview: false },
                }));
              }}
            >
              <Text variant="callout" color={palette.accent.primaryText}>
                Факт сверен: {formatQty(actual)} {unitLabel(product.unit)}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      );
    },
    [busy, drafts, keyboardVisible, palette, scrollToFocused, setCount, updateDrafts, warehouseId],
  );

  const missingContent = (
    <View style={styles.notice}>
      {missingDrafts.map(([id, draft]) => (
        <View key={id}>
          <Text variant="caption" color={palette.text.secondary}>
            {draft.name ?? 'Товар'} ·{' '}
            {draft.pending ? 'Проведение не подтверждено' : 'Больше не доступен на этом складе'}
          </Text>
          {!draft.pending && (!draft.needsReview || draft.unavailable) ? (
            <TouchableOpacity
              style={styles.reviewButton}
              accessibilityRole="button"
              accessibilityLabel={`Убрать из пересчёта: ${draft.name ?? 'товар'}`}
              onPress={() => {
                if (!warehouseId || busyRef.current) return;
                updateDrafts(warehouseId, (previous) => {
                  const next = { ...previous };
                  delete next[id];
                  return next;
                });
                setNotice('Недоступный товар убран из пересчёта. Его остаток не изменён.');
              }}
            >
              <Text variant="callout" color={palette.accent.primaryText}>
                Убрать из пересчёта
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ))}
    </View>
  );

  const applyDisabled =
    busy ||
    !summary.counted ||
    !!summary.invalid ||
    !!summary.review ||
    catalog.isFetching ||
    catalog.isError ||
    warehouseQuery.isError;
  const loading = warehouseQuery.isLoading || (!!warehouseId && (catalog.isLoading || folders.isLoading));
  const loadError = warehouseQuery.isError || catalog.isError || folders.isError;
  const inventoryNotices = (
    <>
      {scanFeedback ? (
        <Text variant="caption" color={palette.accent.primaryText} numberOfLines={2} style={styles.notice}>
          {scanFeedback}
        </Text>
      ) : null}
      {displayNotice || summary.invalid || summary.review || missingDrafts.length ? (
        <View style={styles.notice}>
          <Text variant="caption" color={palette.text.secondary}>
            {displayNotice ??
              (summary.review ? 'Сверьте изменившийся учёт перед проведением.' : 'Исправьте неверные значения факта.')}
          </Text>
          {summary.review ? (
            <TouchableOpacity
              style={styles.reviewButton}
              onPress={() => void refresh()}
              accessibilityRole="button"
              accessibilityLabel="Обновить учёт"
            >
              <Text variant="callout" color={palette.accent.primaryText}>
                Обновить учёт
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </>
  );

  // Reset only when React replaces this screen's native root scroller.
  const sectionRootKind = !canWrite
    ? 'permission-scroll'
    : loading || loadError || !warehouseId
      ? 'workspace-state-scroll'
      : 'inventory-list';
  const previousSectionRootKind = React.useRef(sectionRootKind);
  React.useEffect(() => {
    if (previousSectionRootKind.current !== sectionRootKind) {
      previousSectionRootKind.current = sectionRootKind;
      section.reset();
    }
  }, [sectionRootKind, section.reset]);

  return (
    <KeyboardAvoidingView
      style={[styles.screen, { backgroundColor: palette.bg.canvas }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenSectionHeader
        scroll={section}
        title="Инвентаризация"
        context={
          canWrite ? (
            <>
              <PointIndicator style={styles.point} />
              <Text variant="caption" color={palette.text.secondary}>
                Посчитано {summary.counted} · Изменено {summary.changed}
              </Text>
            </>
          ) : null
        }
      >
        <HeaderIsland layout="column">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
            <HeaderAction label="Назад" icon="chevron-back" onPress={() => navigation.goBack()} />
            <View
              style={{
                flex: 1,
                flexDirection: 'row',
                flexWrap: 'wrap',
                justifyContent: 'flex-end',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {canWrite ? (
                <TouchableOpacity
                  onPress={handleApply}
                  disabled={applyDisabled}
                  accessibilityRole="button"
                  accessibilityLabel="Провести инвентаризацию"
                  accessibilityState={{ disabled: applyDisabled }}
                  style={[
                    [styles.apply, { opacity: applyDisabled ? 0.45 : 1 }],
                    { minWidth: headerTouchSize, minHeight: headerTouchSize },
                  ]}
                >
                  <Text variant="callout" color={palette.accent.primaryText} style={styles.semibold}>
                    {progress ? `${progress.done}/${progress.total}` : 'Провести'}
                  </Text>
                </TouchableOpacity>
              ) : undefined}
            </View>
          </View>
          {canWrite ? (
            <>
              <View style={styles.scope}>
                <TouchableOpacity
                  style={[styles.warehouseButton, { minWidth: headerTouchSize, minHeight: headerTouchSize }]}
                  disabled={busy || warehouses.length < 2}
                  onPress={() => {
                    Keyboard.dismiss();
                    setWarehouseMenu((open) => !open);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Склад: ${activeWarehouse?.name ?? 'Загрузка'}`}
                  accessibilityState={{ expanded: warehouseMenu, disabled: busy || warehouses.length < 2 }}
                >
                  <Ionicons name="cube-outline" size={18} color={palette.accent.primaryText} />
                  <Text variant="callout" color={palette.text.primary} numberOfLines={1} style={styles.warehouseName}>
                    {activeWarehouse?.name ?? 'Склад'}
                  </Text>
                  {warehouses.length > 1 ? (
                    <Ionicons
                      name={warehouseMenu ? 'chevron-up' : 'chevron-down'}
                      size={15}
                      color={palette.text.secondary}
                    />
                  ) : null}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.iconButton, { minWidth: headerTouchSize, minHeight: headerTouchSize }]}
                  disabled={busy || !warehouseId || loading}
                  accessibilityRole="button"
                  accessibilityLabel="Сканировать штрих-код"
                  onPress={() => {
                    if (!warehouseId || busyRef.current) return;
                    scannerScope.current = { session: captureInventorySession(), warehouseId };
                    setShowScanner(true);
                  }}
                >
                  <Ionicons name="barcode-outline" size={25} color={palette.accent.primaryText} />
                </TouchableOpacity>
              </View>
              {warehouseMenu ? (
                <View
                  style={[
                    styles.warehouseMenu,
                    { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
                  ]}
                >
                  {warehouses.map((warehouse) => (
                    <TouchableOpacity
                      key={warehouse.id}
                      style={[styles.menuRow, { minWidth: headerTouchSize, minHeight: headerTouchSize }]}
                      onPress={() => chooseWarehouse(warehouse.id)}
                      accessibilityRole="button"
                      accessibilityLabel={warehouse.name}
                    >
                      <Text variant="callout" color={palette.text.primary} style={styles.rowInfo}>
                        {warehouse.name}
                      </Text>
                      {warehouse.id === warehouseId ? (
                        <Ionicons name="checkmark" size={20} color={palette.accent.primaryText} />
                      ) : null}
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}
              <View style={[styles.search, { backgroundColor: palette.bg.muted }]}>
                <Ionicons name="search" size={18} color={palette.text.secondary} />
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  style={[styles.searchInput, { color: palette.text.primary }]}
                  placeholder="Название, штрих-код или ячейка"
                  placeholderTextColor={palette.text.secondary}
                  accessibilityLabel="Поиск по всем товарам склада"
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                />
                {search ? (
                  <TouchableOpacity
                    onPress={() => setSearch('')}
                    style={[styles.clearButton, { minWidth: headerTouchSize, minHeight: headerTouchSize }]}
                    accessibilityRole="button"
                    accessibilityLabel="Очистить поиск"
                  >
                    <Ionicons name="close-circle" size={20} color={palette.text.secondary} />
                  </TouchableOpacity>
                ) : null}
              </View>
              <View style={[styles.statusRow, { borderBottomColor: palette.border.subtle }]}>
                <TouchableOpacity
                  style={[styles.breadcrumb, { minWidth: headerTouchSize, minHeight: headerTouchSize }]}
                  disabled={!folderPath.length && !search.trim()}
                  onPress={() => {
                    setSearch('');
                    if (!search.trim()) setFolderPath((path) => path.slice(0, -1));
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Назад к папкам"
                >
                  {folderPath.length || search.trim() ? (
                    <Ionicons name="chevron-back" size={16} color={palette.accent.primaryText} />
                  ) : null}
                  <Text variant="caption" color={palette.accent.primaryText} numberOfLines={1}>
                    {search.trim() ? 'По всему складу' : (folderPath[folderPath.length - 1] ?? 'Все папки')}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          ) : null}
        </HeaderIsland>
      </ScreenSectionHeader>
      {!canWrite ? (
        <ScreenSectionScrollView
          onScroll={section.onScroll}
          scrollEventThrottle={16}
          contentInsetAdjustmentBehavior="never"
          contentContainerStyle={{ flexGrow: 1, paddingTop: section.contentTop }}
        >
          {canWrite ? inventoryNotices : null}
          <EmptyState icon="lock" title="Недостаточно прав" description="Нужно право управления складом." />
        </ScreenSectionScrollView>
      ) : (
        <>
          <View style={styles.viewport}>
            {loading ? (
              <ScreenSectionScrollView
                onScroll={section.onScroll}
                scrollEventThrottle={16}
                contentInsetAdjustmentBehavior="never"
                contentContainerStyle={{ flexGrow: 1, paddingTop: section.contentTop }}
              >
                {canWrite ? inventoryNotices : null}
                <ListSkeleton />
              </ScreenSectionScrollView>
            ) : loadError ? (
              <ScreenSectionScrollView
                onScroll={section.onScroll}
                scrollEventThrottle={16}
                contentInsetAdjustmentBehavior="never"
                contentContainerStyle={{ flexGrow: 1, paddingTop: section.contentTop }}
              >
                {canWrite ? inventoryNotices : null}
                <EmptyState
                  icon="warning"
                  title="Не удалось загрузить склад"
                  description="Обновите список, чтобы пересчитать все товары."
                  action={{
                    label: 'Повторить',
                    onPress: () => {
                      void warehouseQuery.refetch();
                      if (warehouseId) {
                        void catalog.refetch();
                        void folders.refetch();
                      }
                    },
                  }}
                />
              </ScreenSectionScrollView>
            ) : !warehouseId ? (
              <ScreenSectionScrollView
                onScroll={section.onScroll}
                scrollEventThrottle={16}
                contentInsetAdjustmentBehavior="never"
                contentContainerStyle={{ flexGrow: 1, paddingTop: section.contentTop }}
              >
                {canWrite ? inventoryNotices : null}
                <EmptyState icon="cube" title="Нет складов" description="Сначала создайте склад в разделе «Склад»." />
              </ScreenSectionScrollView>
            ) : (
              <ScreenSectionFlatList
                onScroll={section.onScroll}
                contentInsetAdjustmentBehavior="never"
                scrollEventThrottle={16}
                ref={listRef}
                data={rows}
                keyExtractor={(row) => row.key}
                renderItem={renderItem}
                extraData={drafts}
                style={styles.viewport}
                contentContainerStyle={[styles.listContent, { paddingTop: section.contentTop }]}
                reserveBottomNavigation={!keyboardVisible}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                onScrollToIndexFailed={({ index, averageItemLength }) => {
                  listRef.current?.scrollToOffset({ offset: averageItemLength * index, animated: true });
                  if (scrollTimer.current) clearTimeout(scrollTimer.current);
                  scrollTimer.current = setTimeout(scrollToFocused, 180);
                }}
                refreshing={catalog.isFetching && !catalog.isLoading}
                onRefresh={() => void refresh()}
                ListHeaderComponent={
                  <>
                    {inventoryNotices}
                    {missingDrafts.length ? missingContent : null}
                  </>
                }
                ListEmptyComponent={
                  <EmptyState
                    icon="cube"
                    title={search.trim() ? 'Товары не найдены' : 'Папка пуста'}
                    description={
                      search.trim()
                        ? 'Попробуйте другое название, штрих-код или ячейку.'
                        : 'В этой папке пока нет товаров.'
                    }
                  />
                }
              />
            )}
          </View>
          {keyboardVisible ? (
            <View
              style={[styles.keyboardBar, { backgroundColor: palette.bg.card, borderTopColor: palette.border.subtle }]}
            >
              <Text variant="caption" color={palette.text.secondary}>
                Пусто — не пересчитан · 0 — нет товара
              </Text>
              <TouchableOpacity
                onPress={Keyboard.dismiss}
                style={styles.doneButton}
                accessibilityRole="button"
                accessibilityLabel="Скрыть клавиатуру"
              >
                <Text variant="callout" color={palette.accent.primaryText} style={styles.semibold}>
                  Готово
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </>
      )}
      <BarcodeScanner
        visible={showScanner}
        onClose={() => {
          scannerScope.current = null;
          setShowScanner(false);
        }}
        onScanned={handleScanned}
        hint="Скан добавит одну единицу к факту товара"
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  viewport: { flex: 1 },
  apply: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing[1] },
  semibold: { fontWeight: fontWeight.semibold },
  scope: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingHorizontal: 0 },
  warehouseButton: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  warehouseName: { flexShrink: 1 },
  point: { maxWidth: 112, flexShrink: 1 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  warehouseMenu: { marginHorizontal: 0, borderRadius: borderRadius.lg, borderWidth: StyleSheet.hairlineWidth },
  menuRow: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginHorizontal: 0,
    borderRadius: borderRadius.lg,
    paddingLeft: spacing[3],
  },
  searchInput: { flex: 1, minWidth: 0, minHeight: headerTouchSize, fontSize: 15, paddingVertical: spacing[2] },
  clearButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: 0,
    borderBottomWidth: 0,
  },
  breadcrumb: { flex: 1, minWidth: 0, minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  notice: { marginHorizontal: spacing[4], paddingVertical: spacing[2] },
  listContent: { paddingBottom: spacing[4] },
  folderRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  folderIcon: { width: 38, height: 38, borderRadius: borderRadius.md, alignItems: 'center', justifyContent: 'center' },
  rowInfo: { flex: 1, minWidth: 0, gap: 3 },
  productRow: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  productTop: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  photo: { width: 40, height: 40, borderRadius: borderRadius.md },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[1] },
  fact: { width: 86, alignItems: 'center', gap: spacing[1] },
  input: {
    width: 86,
    minHeight: 48,
    paddingHorizontal: spacing[1],
    paddingVertical: spacing[2],
    borderWidth: 1,
    borderRadius: borderRadius.md,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: fontWeight.semibold,
  },
  reviewButton: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  keyboardBar: {
    paddingLeft: spacing[4],
    paddingRight: spacing[2],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  doneButton: { minHeight: 44, paddingHorizontal: spacing[2], justifyContent: 'center' },
});
