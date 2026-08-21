/**
 * InventoryScreen — full-screen инвентаризация (пересчёт остатков) with optional
 * barcode scanning.
 *
 * Flow:
 *   1. Pick a scope — warehouse (main / defect / used) and, optionally, a
 *      top-level category folder.
 *   2. For each product enter the ACTUAL counted quantity, OR scan its barcode
 *      to focus + increment that product's count by one.
 *   3. The discrepancy (actual − system) is shown per row and summarised
 *      (недостача / излишки in ₽ at cost).
 *   4. «Провести» → confirm → for every changed product call the EXISTING
 *      stock endpoint `productsApi.updateStock(id, { type: 'inventory', … })`,
 *      which writes an 'inventory'-type stock movement (same primitive the
 *      warehouse quick-inventory modal and corrections already use — no new
 *      stock math is invented here).
 *
 * Pushed inside the Products (Склад) tab-stack, so the floating tab bar stays
 * visible and iOS edge-swipe pops back to the warehouse list.
 *
 * Role-gated: write actions require `warehouse_access` (also enforced
 * server-side). Android-compatible — expo-camera + RN primitives only.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import IosScreenHeader from '../components/IosScreenHeader';
import EmptyState from '../components/EmptyState';
import { ListSkeleton } from '../components/Skeleton';
import SearchInput from '../components/SearchInput';
import BarcodeScanner from '../components/BarcodeScanner';
import { Text } from '../platform/Typography';
import { productsApi, warehousesApi, warehouseCategoriesApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { haptic } from '../platform/haptics';
import { colors, spacing, fontSize, fontWeight, borderRadius, softTint } from '../theme';
import { PRODUCT_LIST_FIELDS } from '../constants/productFields';
import type { Product, PaginatedResponse, Warehouse } from '../../../shared/types';

const LIMIT = 500;

function formatMoney(v: number): string {
  return (
    Math.round(v)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
  );
}

const onlyDigits = (s: string) => s.replace(/[^0-9]/g, '');

export default function InventoryScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const { hasPermission } = useAuth();
  // Проведение инвентаризации пишет остатки (POST /products/:id/stock) —
  // сервер гейтит warehouse_manage; warehouse_access здесь недостаточно.
  const canWrite = hasPermission('warehouse_manage');

  const [selectedWarehouseId, setSelectedWarehouseId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  // productId -> actual counted quantity (as typed/scanned). Absent entries are
  // "not counted" and excluded from the commit. Keyed across the whole session
  // so switching category/warehouse view never loses an entered count.
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [showScanner, setShowScanner] = useState(false);
  const [lastScan, setLastScan] = useState<{ name: string; count: number } | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  // Non-null while the sequential per-item commit runs — drives «N из M…» and
  // blocks re-entry.
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const listRef = useRef<FlashListRef<Product>>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scanBannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Warehouses (cache hit with ProductsScreen) ──────────────────────────
  const { data: warehouses } = useQuery<Warehouse[]>({
    queryKey: ['warehouses'],
    queryFn: async () => {
      const res = await warehousesApi.list();
      return Array.isArray(res.data) ? res.data : [];
    },
    staleTime: 10 * 60_000,
  });

  const activeWarehouse = useMemo<Warehouse | null>(() => {
    if (!warehouses || warehouses.length === 0) return null;
    if (selectedWarehouseId) {
      const found = warehouses.find((w) => w.id === selectedWarehouseId);
      if (found) return found;
    }
    return warehouses.find((w) => w.kind === 'main') ?? warehouses[0];
  }, [warehouses, selectedWarehouseId]);
  const activeWarehouseId = activeWarehouse?.id;

  // ── Products — SAME key + fields projection as ProductsScreen, so this is a
  // cache HIT (instant) and carries `barcode` for scan-to-match. ────────────
  const { data, isLoading, isError, refetch } = useQuery<PaginatedResponse<Product>>({
    queryKey: ['products', { search: '', limit: LIMIT, warehouseId: activeWarehouseId ?? null }],
    queryFn: async () => {
      const res = await productsApi.getAll({
        search: '',
        page: 1,
        limit: LIMIT,
        fields: PRODUCT_LIST_FIELDS,
        ...(activeWarehouseId ? { warehouseId: activeWarehouseId } : {}),
      } as Parameters<typeof productsApi.getAll>[0] & { fields: string });
      return res.data;
    },
    placeholderData: (prev) => prev,
  });

  // ── Folders for the scope chips (cache hit with ProductsScreen) ──────────
  const { data: extraFolders } = useQuery({
    queryKey: activeWarehouseId
      ? ['warehouse-categories', { warehouseId: activeWarehouseId }]
      : ['warehouse-categories'],
    queryFn: async () => {
      const res = await warehouseCategoriesApi.getAll(activeWarehouseId || undefined);
      return res.data;
    },
    enabled: !!activeWarehouseId,
  });

  const allProducts = useMemo(() => (Array.isArray(data?.data) ? data.data : []), [data]);

  const productById = useMemo(() => {
    const map = new Map<string, Product>();
    for (const p of allProducts) map.set(p.id, p);
    return map;
  }, [allProducts]);

  // Top-level category folders (from products + API folder rows).
  const topFolders = useMemo(() => {
    const set = new Set<string>();
    for (const p of allProducts) {
      const top = (p.category || '').split('/')[0];
      if (top) set.add(top);
    }
    if (Array.isArray(extraFolders)) {
      for (const ef of extraFolders) {
        const top = ((ef.path || (ef as any).name || '') as string).split('/')[0];
        if (top) set.add(top);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allProducts, extraFolders]);

  // Products visible in the current scope (category folder + search filter).
  const scopedProducts = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allProducts.filter((p) => {
      if (categoryFilter) {
        const cat = p.category || '';
        if (cat !== categoryFilter && !cat.startsWith(categoryFilter + '/')) return false;
      }
      if (q && !p.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [allProducts, categoryFilter, search]);

  // Session-wide summary (every touched product, not just current scope).
  const summary = useMemo(() => {
    let countedCount = 0;
    let changedCount = 0;
    let shortage = 0;
    let excess = 0;
    for (const [id, raw] of Object.entries(counts)) {
      if (raw === '' || raw == null) continue;
      const product = productById.get(id);
      if (!product) continue;
      countedCount++;
      const actual = Number(raw) || 0;
      const diff = actual - product.stock;
      if (diff === 0) continue;
      changedCount++;
      const cost = product.costPrice || 0;
      if (diff < 0) shortage += Math.abs(diff) * cost;
      else excess += diff * cost;
    }
    return { countedCount, changedCount, shortage, excess };
  }, [counts, productById]);

  // ── Mutators ────────────────────────────────────────────────────────────
  const setCount = useCallback((id: string, value: string) => {
    setCounts((prev) => ({ ...prev, [id]: onlyDigits(value) }));
  }, []);

  const flashRow = useCallback(
    (id: string) => {
      setFlashId(id);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlashId(null), 1400);
      const idx = scopedProducts.findIndex((p) => p.id === id);
      if (idx >= 0) {
        try {
          listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.3 });
        } catch {
          // scrollToIndex can throw if the list isn't laid out yet — ignore.
        }
      }
    },
    [scopedProducts],
  );

  const handleScanned = useCallback(
    (code: string) => {
      setShowScanner(false);
      const needle = code.trim();
      const product = allProducts.find((p) => String(p.barcode || '').trim() === needle);
      if (!product) {
        haptic('warning');
        Alert.alert('Товар не найден', `Штрих-код ${needle} не привязан ни к одному товару этого склада.`);
        return;
      }
      // Count one physical unit. If a hidden category filter would hide the
      // matched product, drop the filter so the user sees it update.
      const cat = product.category || '';
      if (categoryFilter && cat !== categoryFilter && !cat.startsWith(categoryFilter + '/')) {
        setCategoryFilter(null);
      }
      const next = (Number(counts[product.id]) || 0) + 1;
      setCounts((prev) => ({ ...prev, [product.id]: String(next) }));
      setLastScan({ name: product.name, count: next });
      if (scanBannerTimer.current) clearTimeout(scanBannerTimer.current);
      scanBannerTimer.current = setTimeout(() => setLastScan(null), 2500);
      flashRow(product.id);
    },
    [allProducts, categoryFilter, counts, flashRow],
  );

  // ── Commit (sequential, resumable on partial failure) ───────────────────
  const commit = useCallback(
    async (entries: { id: string; name: string; actual: number }[], reason: string) => {
      setProgress({ done: 0, total: entries.length });
      const failed: typeof entries = [];
      let firstError = '';
      try {
        for (let i = 0; i < entries.length; i++) {
          const e = entries[i];
          try {
            await productsApi.updateStock(e.id, { type: 'inventory', quantity: e.actual, reason: reason || undefined });
            // Reflect the server truth so a retry pass won't re-send this row:
            // the count now equals system stock → no longer "changed".
            setCounts((prev) => ({ ...prev, [e.id]: String(e.actual) }));
          } catch (err: any) {
            failed.push(e);
            if (!firstError) firstError = err?.response?.data?.message || '';
          }
          setProgress({ done: i + 1, total: entries.length });
        }
      } finally {
        setProgress(null);
        queryClient.invalidateQueries({ queryKey: ['products'] });
        queryClient.invalidateQueries({ queryKey: ['inventory-movements'] });
        queryClient.invalidateQueries({ queryKey: ['all-products-check'] });
      }

      if (failed.length === 0) {
        haptic('success');
        Alert.alert('Готово', `Инвентаризация проведена. Обновлено товаров: ${entries.length}.`, [
          { text: 'OK', onPress: () => navigation.goBack() },
        ]);
        return;
      }
      haptic('error');
      Alert.alert(
        'Инвентаризация не завершена',
        `Проведено ${entries.length - failed.length} из ${entries.length}. Не удалось обновить:\n` +
          failed.map((f) => `• ${f.name}`).join('\n') +
          (firstError ? `\n\n${firstError}` : ''),
        [
          { text: 'Отмена', style: 'cancel' },
          { text: 'Повторить незавершённые', onPress: () => commit(failed, reason) },
        ],
      );
    },
    [navigation, queryClient],
  );

  const handleApply = useCallback(() => {
    if (progress) return;
    if (!canWrite) {
      Alert.alert('Недостаточно прав', 'Проведение инвентаризации доступно сотрудникам с правом управления складом.');
      return;
    }
    const entries: { id: string; name: string; actual: number }[] = [];
    let shortage = 0;
    let excess = 0;
    for (const [id, raw] of Object.entries(counts)) {
      if (raw === '' || raw == null) continue;
      const product = productById.get(id);
      if (!product) continue;
      const actual = Number(raw) || 0;
      const diff = actual - product.stock;
      if (diff === 0) continue;
      entries.push({ id, name: product.name, actual });
      const cost = product.costPrice || 0;
      if (diff < 0) shortage += Math.abs(diff) * cost;
      else excess += diff * cost;
    }
    if (entries.length === 0) {
      Alert.alert('Инвентаризация', 'Нет изменений в остатках — пересчитайте или отсканируйте товары.');
      return;
    }
    haptic('warning');
    Alert.alert(
      'Провести инвентаризацию?',
      `Будет обновлено товаров: ${entries.length}.\n` +
        (shortage > 0 ? `Недостача: ${formatMoney(shortage)}\n` : '') +
        (excess > 0 ? `Излишки: ${formatMoney(excess)}\n` : '') +
        'Остатки заменятся на введённые значения.',
      [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Провести', style: 'destructive', onPress: () => commit(entries, 'Инвентаризация') },
      ],
    );
  }, [progress, canWrite, counts, productById, commit]);

  // ── Render ──────────────────────────────────────────────────────────────
  const renderItem = useCallback(
    ({ item }: { item: Product }) => {
      const raw = counts[item.id];
      const touched = raw !== undefined && raw !== '';
      const actual = touched ? Number(raw) || 0 : item.stock;
      const diff = actual - item.stock;
      const isFlash = flashId === item.id;
      return (
        <View
          style={[
            styles.row,
            { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
            isFlash && { borderColor: colors.primary[400], backgroundColor: palette.accent.primarySoft },
          ]}
        >
          <View style={styles.rowInfo}>
            <Text variant="callout" color={palette.text.primary} numberOfLines={2}>
              {item.name}
            </Text>
            {item.category ? (
              <Text variant="caption" color={palette.text.tertiary} numberOfLines={1}>
                {item.category.split('/').pop()}
              </Text>
            ) : null}
          </View>
          <View style={styles.rowSystem}>
            <Text variant="caption" color={palette.text.tertiary}>
              Сист.
            </Text>
            <Text variant="bodyEmph" color={palette.text.secondary}>
              {item.stock}
            </Text>
          </View>
          <TextInput
            value={touched ? raw : ''}
            onChangeText={(v) => setCount(item.id, v)}
            placeholder={String(item.stock)}
            placeholderTextColor={palette.text.tertiary}
            keyboardType="number-pad"
            style={[
              styles.input,
              { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
              touched && diff > 0 && { borderColor: colors.green[400] },
              touched && diff < 0 && { borderColor: colors.red[400] },
            ]}
            accessibilityLabel={`Фактический остаток: ${item.name}`}
          />
          {touched && diff !== 0 ? (
            <View
              style={[
                styles.diffBadge,
                {
                  backgroundColor:
                    palette.mode === 'dark'
                      ? softTint(diff > 0 ? colors.green[600] : colors.red[600], 'dark')
                      : diff > 0
                        ? colors.green[50]
                        : colors.red[50],
                },
              ]}
            >
              <Text
                variant="caption"
                color={
                  palette.mode === 'dark'
                    ? diff > 0
                      ? colors.green[400]
                      : colors.red[400]
                    : diff > 0
                      ? colors.green[700]
                      : colors.red[700]
                }
                style={styles.diffText}
              >
                {diff > 0 ? '+' : ''}
                {diff}
              </Text>
            </View>
          ) : (
            <View style={styles.diffBadgePlaceholder} />
          )}
        </View>
      );
    },
    [counts, flashId, palette, setCount],
  );

  if (!canWrite) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: palette.bg.canvas }]} edges={['top']}>
        <IosScreenHeader title="Инвентаризация" onBack={() => navigation.goBack()} />
        <EmptyState
          icon="lock"
          title="Недостаточно прав"
          description="Инвентаризация доступна сотрудникам с доступом к складу."
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.bg.canvas }]} edges={['top']}>
      <IosScreenHeader
        title="Инвентаризация"
        subtitle={activeWarehouse?.name}
        onBack={() => navigation.goBack()}
        trailing={
          <TouchableOpacity
            onPress={handleApply}
            disabled={!!progress}
            style={[styles.applyBtn, progress ? { opacity: 0.6 } : null]}
            accessibilityLabel="Провести инвентаризацию"
          >
            <Text variant="callout" color={colors.white} style={styles.applyBtnText}>
              {progress ? `${progress.done} из ${progress.total}…` : 'Провести'}
            </Text>
          </TouchableOpacity>
        }
      />

      {/* Scope: warehouse chips + scan button */}
      <View style={styles.scopeRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsScroll}>
          {(warehouses ?? []).map((w) => {
            const active = w.id === activeWarehouseId;
            return (
              <TouchableOpacity
                key={w.id}
                onPress={() => {
                  setSelectedWarehouseId(w.id);
                  setCategoryFilter(null);
                }}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? colors.primary[600] : palette.bg.muted,
                    borderColor: palette.border.subtle,
                  },
                ]}
              >
                <Text variant="caption" color={active ? colors.white : palette.text.secondary} style={styles.chipText}>
                  {w.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <TouchableOpacity
          onPress={() => {
            haptic('tap');
            setShowScanner(true);
          }}
          style={styles.scanBtn}
          accessibilityLabel="Сканировать штрих-код"
        >
          <Ionicons name="barcode-outline" size={20} color={colors.white} />
          <Text variant="caption" color={colors.white} style={styles.scanBtnText}>
            Скан
          </Text>
        </TouchableOpacity>
      </View>

      {/* Category folder chips */}
      {topFolders.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.catScroll}
          contentContainerStyle={styles.chipsScroll}
        >
          <TouchableOpacity
            onPress={() => setCategoryFilter(null)}
            style={[
              styles.chip,
              {
                backgroundColor: !categoryFilter ? palette.accent.primarySoft : palette.bg.muted,
                borderColor: palette.border.subtle,
              },
            ]}
          >
            <Text
              variant="caption"
              color={!categoryFilter ? palette.accent.primaryText : palette.text.secondary}
              style={styles.chipText}
            >
              Все
            </Text>
          </TouchableOpacity>
          {topFolders.map((f) => {
            const active = categoryFilter === f;
            return (
              <TouchableOpacity
                key={f}
                onPress={() => setCategoryFilter(active ? null : f)}
                style={[
                  styles.chip,
                  {
                    backgroundColor: active ? palette.accent.primarySoft : palette.bg.muted,
                    borderColor: palette.border.subtle,
                  },
                ]}
              >
                <Text
                  variant="caption"
                  color={active ? palette.accent.primaryText : palette.text.secondary}
                  style={styles.chipText}
                >
                  {f}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* Search */}
      <View style={styles.searchWrap}>
        <SearchInput value={search} onChange={setSearch} placeholder="Поиск товара..." />
      </View>

      {/* Last-scan banner */}
      {lastScan && (
        <View style={[styles.scanBanner, { backgroundColor: colors.green[50], borderColor: colors.green[200] }]}>
          <Ionicons name="checkmark-circle" size={16} color={colors.green[600] as string} />
          <Text variant="caption" color={colors.green[800] as string} numberOfLines={1} style={{ flex: 1 }}>
            {lastScan.name} — учтено: {lastScan.count}
          </Text>
        </View>
      )}

      {/* Summary */}
      <View style={[styles.summaryBar, { borderColor: palette.border.subtle }]}>
        <View style={styles.summaryItem}>
          <Text variant="caption" color={palette.text.tertiary}>
            Посчитано
          </Text>
          <Text variant="bodyEmph" color={palette.text.primary}>
            {summary.countedCount}
          </Text>
        </View>
        <View style={styles.summaryItem}>
          <Text variant="caption" color={palette.text.tertiary}>
            Изменено
          </Text>
          <Text variant="bodyEmph" color={summary.changedCount > 0 ? colors.orange[600] : palette.text.primary}>
            {summary.changedCount}
          </Text>
        </View>
        {summary.shortage > 0 && (
          <View style={styles.summaryItem}>
            <Text variant="caption" color={palette.text.tertiary}>
              Недостача
            </Text>
            <Text variant="bodyEmph" color={colors.red[600]}>
              {formatMoney(summary.shortage)}
            </Text>
          </View>
        )}
        {summary.excess > 0 && (
          <View style={styles.summaryItem}>
            <Text variant="caption" color={palette.text.tertiary}>
              Излишки
            </Text>
            <Text variant="bodyEmph" color={colors.green[600]}>
              {formatMoney(summary.excess)}
            </Text>
          </View>
        )}
      </View>

      {/* List */}
      {isLoading && allProducts.length === 0 ? (
        <ListSkeleton />
      ) : isError && allProducts.length === 0 ? (
        <EmptyState
          icon="warning"
          title="Не удалось загрузить"
          description="Проверьте соединение и повторите."
          action={{ label: 'Повторить', onPress: () => refetch() }}
        />
      ) : scopedProducts.length === 0 ? (
        <EmptyState icon="cube" title="Нет товаров" description="В этой области склада нет товаров для пересчёта." />
      ) : (
        <FlashList
          ref={listRef}
          data={scopedProducts}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            paddingHorizontal: spacing[4],
            paddingTop: spacing[2],
            paddingBottom: tabBarHeight + spacing[4],
          }}
          ItemSeparatorComponent={() => <View style={{ height: spacing[2] }} />}
        />
      )}

      <BarcodeScanner
        visible={showScanner}
        onClose={() => setShowScanner(false)}
        onScanned={handleScanned}
        hint="Наведите камеру на штрих-код товара для пересчёта"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scopeRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing[4], gap: spacing[2] },
  chipsScroll: { gap: spacing[2], paddingVertical: spacing[1], paddingRight: spacing[2], alignItems: 'center' },
  catScroll: { flexGrow: 0, flexShrink: 0, marginTop: spacing[2], paddingHorizontal: spacing[4] },
  chip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipText: { fontWeight: fontWeight.medium },
  scanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    backgroundColor: colors.primary[600],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
  },
  scanBtnText: { fontWeight: fontWeight.semibold },
  searchWrap: { paddingHorizontal: spacing[4], paddingTop: spacing[2], paddingBottom: spacing[1] },
  scanBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginHorizontal: spacing[4],
    marginTop: spacing[1],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  summaryBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing[4],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  summaryItem: { gap: 1 },
  applyBtn: {
    backgroundColor: colors.primary[600],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
  },
  applyBtnText: { fontWeight: fontWeight.bold },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    padding: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rowInfo: { flex: 1, minWidth: 0 },
  rowSystem: { alignItems: 'center', minWidth: 44 },
  input: {
    width: 64,
    height: 40,
    borderWidth: 1,
    borderRadius: borderRadius.md,
    textAlign: 'center',
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    paddingVertical: 0,
  },
  diffBadge: {
    minWidth: 38,
    alignItems: 'center',
    paddingHorizontal: spacing[1.5],
    paddingVertical: 2,
    borderRadius: borderRadius.md,
  },
  diffText: { fontWeight: fontWeight.bold },
  diffBadgePlaceholder: { width: 38 },
});
