/**
 * FolderPickerModal — «Перенести в папку».
 *
 * One-tap mover that walks the EXISTING warehouse category tree (the same tree
 * the warehouse navigation in ProductsScreen draws) and lets the owner drop a
 * product into a target folder — no manual category typing, no create-new
 * (folders are created elsewhere). Scoped to a SINGLE warehouse: it never lets
 * a product hop between warehouses.
 *
 * Data is CACHE-FIRST and reuses the EXACT query keys ProductsScreen / the
 * login prefetch already warm, so the picker opens populated with zero flicker:
 *   • ['warehouse-categories', { warehouseId }]  — explicit folder rows
 *   • ['products', { search:'', limit:500, warehouseId }] — folders derived
 *     from product category paths (covers folders that exist only because a
 *     product lives in them)
 * Both carry `placeholderData: prev => prev` (stale-while-revalidate).
 *
 * Search has a local 200 ms debounce; while searching it flattens the whole
 * tree to matching full paths so a deep folder is one tap away.
 *
 * Android-safe: RN + FlashList only; no iOS-only API.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Modal as RNModal } from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { FlashList } from '@shopify/flash-list';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import SearchInput from './SearchInput';
import KeyboardDoneToolbar from './KeyboardDoneToolbar';
import { productsApi, warehouseCategoriesApi } from '../api/services';
import { useColors } from '../contexts/ThemeContext';
import { haptic } from '../platform/haptics';
import { colors, borderRadius, spacing } from '../theme';
import { PRODUCT_LIST_FIELDS } from '../constants/productFields';
import type { Product, PaginatedResponse } from '../../../shared/types';

interface FolderPickerModalProps {
  visible: boolean;
  onClose: () => void;
  /** Warehouse the product lives in — folders are read ONLY from this one. */
  warehouseId: string | null;
  /** Product's current category path — highlighted + the «here already» guard. */
  currentCategory?: string;
  /** Selected target folder path. '' = warehouse root (no folder). */
  onConfirm: (categoryPath: string) => void;
  /** Disables the confirm button while the move mutation is in flight. */
  busy?: boolean;
  title?: string;
}

type FolderEntry = { name: string; fullPath: string; count: number };

export default function FolderPickerModal({
  visible,
  onClose,
  warehouseId,
  currentCategory,
  onConfirm,
  busy,
  title = 'Перенести в папку',
}: FolderPickerModalProps) {
  const palette = useColors();

  const [path, setPath] = useState<string[]>([]);
  const [searchRaw, setSearchRaw] = useState('');
  const [search, setSearch] = useState('');

  // Reset navigation + search every time the sheet opens.
  useEffect(() => {
    if (visible) {
      setPath([]);
      setSearchRaw('');
      setSearch('');
    }
  }, [visible]);

  // Local 200 ms debounce so folder filtering doesn't churn on every keystroke.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(searchRaw.trim()), 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchRaw]);

  // ── Cache-first data (SAME keys as ProductsScreen / login prefetch) ─────────
  const { data: extraFolders } = useQuery({
    queryKey: warehouseId ? ['warehouse-categories', { warehouseId }] : ['warehouse-categories'],
    queryFn: async () => (await warehouseCategoriesApi.getAll(warehouseId || undefined)).data,
    placeholderData: (prev) => prev,
    enabled: visible,
    staleTime: 60_000,
  });

  const { data: productsData, isLoading } = useQuery<PaginatedResponse<Product>>({
    queryKey: ['products', { search: '', limit: 500, warehouseId: warehouseId ?? null }],
    queryFn: async () => {
      const res = await productsApi.getAll({
        search: '',
        page: 1,
        limit: 500,
        fields: PRODUCT_LIST_FIELDS,
        ...(warehouseId ? { warehouseId } : {}),
      } as Parameters<typeof productsApi.getAll>[0] & { fields: string });
      return res.data;
    },
    placeholderData: (prev) => prev,
    enabled: visible,
  });

  const products = useMemo(() => (Array.isArray(productsData?.data) ? productsData.data : []), [productsData]);

  // Union of every known full category path (product-derived + explicit rows).
  const allPaths = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) {
      if (p.category) set.add(p.category);
    }
    if (Array.isArray(extraFolders)) {
      for (const ef of extraFolders as Array<{ path?: string }>) {
        if (ef.path) set.add(ef.path);
      }
    }
    return set;
  }, [products, extraFolders]);

  const countUnder = useCallback(
    (prefix: string) => {
      let n = 0;
      for (const p of products) {
        const c = p.category || '';
        if (c === prefix || c.startsWith(prefix + '/')) n++;
      }
      return n;
    },
    [products],
  );

  // Child folders at the current navigation level.
  const childFolders = useMemo<FolderEntry[]>(() => {
    const names = new Set<string>();
    for (const full of allPaths) {
      const parts = full.split('/');
      let matches = true;
      for (let i = 0; i < path.length; i++) {
        if (parts[i] !== path[i]) {
          matches = false;
          break;
        }
      }
      if (!matches) continue;
      if (parts.length > path.length) names.add(parts[path.length]);
    }
    const prefix = path.join('/');
    return Array.from(names)
      .map((name) => {
        const fullPath = prefix ? `${prefix}/${name}` : name;
        return { name, fullPath, count: countUnder(fullPath) };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [allPaths, path, countUnder]);

  // While searching: flatten the whole tree to matching full paths (one-tap).
  const searchResults = useMemo<FolderEntry[]>(() => {
    if (!search) return [];
    const needle = search.toLowerCase();
    return Array.from(allPaths)
      .filter((full) => full.toLowerCase().includes(needle))
      .map((fullPath) => {
        const parts = fullPath.split('/');
        return { name: parts[parts.length - 1], fullPath, count: countUnder(fullPath) };
      })
      .sort((a, b) => a.fullPath.localeCompare(b.fullPath, 'ru'))
      .slice(0, 100);
  }, [search, allPaths, countUnder]);

  const targetPath = path.join('/');
  const isHereAlready = (currentCategory || '') === targetPath;

  const enterFolder = useCallback((name: string) => {
    haptic('tap');
    setPath((prev) => [...prev, name]);
  }, []);

  const handleConfirm = useCallback(() => {
    if (busy || isHereAlready) return;
    haptic('select');
    onConfirm(targetPath);
  }, [busy, isHereAlready, onConfirm, targetPath]);

  const renderFolder = useCallback(
    ({ item }: { item: FolderEntry }) => {
      const isCurrent =
        !!currentCategory && (currentCategory === item.fullPath || currentCategory.startsWith(item.fullPath + '/'));
      const handlePress = () => {
        if (search) {
          // One-tap select straight from a search hit.
          if (busy) return;
          haptic('select');
          onConfirm(item.fullPath);
        } else {
          enterFolder(item.name);
        }
      };
      return (
        <TouchableOpacity
          onPress={handlePress}
          activeOpacity={0.6}
          style={[styles.folderRow, { backgroundColor: palette.bg.card, borderBottomColor: palette.border.subtle }]}
        >
          <View style={[styles.folderIconBox, { backgroundColor: palette.accent.primarySoft }]}>
            <Ionicons name="folder-open-outline" size={18} color={colors.primary[500]} />
          </View>
          <View style={styles.folderInfo}>
            <Text style={[styles.folderName, { color: palette.text.primary }]} numberOfLines={1}>
              {search ? item.fullPath : item.name}
            </Text>
            <Text style={[styles.folderCount, { color: palette.text.tertiary }]}>
              {item.count} шт{isCurrent ? ' · текущая' : ''}
            </Text>
          </View>
          {isCurrent ? <Ionicons name="checkmark-circle" size={16} color={colors.green[500]} /> : null}
          <Ionicons name={search ? 'arrow-forward' : 'chevron-forward'} size={16} color={palette.text.tertiary} />
        </TouchableOpacity>
      );
    },
    [search, busy, onConfirm, enterFolder, palette, currentCategory],
  );

  const listData = search ? searchResults : childFolders;

  return (
    // Клавиатура (Round 11 D). RN <Modal> — отдельное нативное окно, поэтому
    // вложенный KeyboardProvider + «Готово»: поле поиска живёт сверху и не
    // прячется, но без тулбара клавиатуру нечем свернуть на multiline/крупных
    // клавиатурах. Тулбар даёт единый способ сворачивания.
    <RNModal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardProvider>
        <SafeAreaView style={[styles.safe, { backgroundColor: palette.bg.canvas }]} edges={['top', 'bottom']}>
          {/* Header */}
          <View style={[styles.header, { borderBottomColor: palette.border.subtle }]}>
            <TouchableOpacity onPress={onClose} style={[styles.headerBtn, { backgroundColor: palette.bg.muted }]}>
              <Ionicons name="close" size={20} color={palette.text.primary} />
            </TouchableOpacity>
            <Text style={[styles.headerTitle, { color: palette.text.primary }]} numberOfLines={1}>
              {title}
            </Text>
            <View style={styles.headerBtn} />
          </View>

          {/* Search */}
          <View style={styles.searchWrap}>
            <SearchInput value={searchRaw} onChange={setSearchRaw} placeholder="Поиск папки..." />
          </View>

          {/* Breadcrumb (browse mode only) */}
          {!search && path.length > 0 ? (
            <View style={styles.breadcrumb}>
              <TouchableOpacity onPress={() => setPath([])} style={styles.crumbItem}>
                <Ionicons name="home-outline" size={14} color={palette.accent.primary} />
                <Text style={[styles.crumbText, { color: palette.accent.primary }]}>Все</Text>
              </TouchableOpacity>
              {path.map((seg, i) => (
                <React.Fragment key={`${seg}-${i}`}>
                  <Ionicons name="chevron-forward" size={12} color={palette.text.tertiary} />
                  <TouchableOpacity onPress={() => setPath((prev) => prev.slice(0, i + 1))} style={styles.crumbItem}>
                    <Text
                      style={[
                        styles.crumbText,
                        { color: i === path.length - 1 ? palette.text.primary : palette.accent.primary },
                      ]}
                      numberOfLines={1}
                    >
                      {seg}
                    </Text>
                  </TouchableOpacity>
                </React.Fragment>
              ))}
            </View>
          ) : null}

          {/* Folder list */}
          {isLoading && products.length === 0 ? (
            <ActivityIndicator color={colors.primary[600]} style={{ marginTop: spacing[8] }} />
          ) : listData.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name={search ? 'search-outline' : 'folder-outline'} size={40} color={palette.text.tertiary} />
              <Text style={[styles.emptyText, { color: palette.text.tertiary }]}>
                {search ? 'Папки не найдены' : 'Здесь нет вложенных папок'}
              </Text>
            </View>
          ) : (
            <FlashList
              data={listData}
              keyExtractor={(item) => item.fullPath}
              renderItem={renderFolder}
              contentContainerStyle={styles.list}
              keyboardShouldPersistTaps="handled"
            />
          )}

          {/* Confirm bar (browse mode) — drop the product into the current folder. */}
          {!search ? (
            <View style={[styles.footer, { backgroundColor: palette.bg.card, borderTopColor: palette.border.subtle }]}>
              <Text style={[styles.footerTarget, { color: palette.text.tertiary }]} numberOfLines={1}>
                {path.length === 0 ? 'В корень склада (без папки)' : `Папка: ${targetPath}`}
              </Text>
              <TouchableOpacity
                style={[
                  styles.confirmBtn,
                  { backgroundColor: isHereAlready || busy ? palette.bg.muted : colors.primary[600] },
                ]}
                onPress={handleConfirm}
                disabled={isHereAlready || busy}
                activeOpacity={0.85}
              >
                {busy ? (
                  <ActivityIndicator color={colors.white} size="small" />
                ) : (
                  <>
                    <Ionicons
                      name="arrow-redo-outline"
                      size={18}
                      color={isHereAlready ? palette.text.tertiary : colors.white}
                    />
                    <Text
                      style={[styles.confirmBtnText, { color: isHereAlready ? palette.text.tertiary : colors.white }]}
                    >
                      {isHereAlready ? 'Товар уже здесь' : 'Перенести сюда'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          ) : null}
        </SafeAreaView>
        <KeyboardDoneToolbar />
      </KeyboardProvider>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '700', letterSpacing: -0.3 },

  searchWrap: { paddingHorizontal: spacing[4], paddingTop: spacing[3], paddingBottom: spacing[1] },

  breadcrumb: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
  },
  crumbItem: { flexDirection: 'row', alignItems: 'center', gap: 3, maxWidth: 160 },
  crumbText: { fontSize: 13, fontWeight: '600' },

  list: { paddingHorizontal: spacing[4], paddingBottom: spacing[4] },
  folderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  folderIconBox: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  folderInfo: { flex: 1, minWidth: 0, gap: 2 },
  folderName: { fontSize: 15, fontWeight: '600', letterSpacing: -0.1 },
  folderCount: { fontSize: 12 },

  empty: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing[10], gap: spacing[3] },
  emptyText: { fontSize: 14, fontWeight: '500' },

  footer: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: Platform.OS === 'android' ? spacing[3] : spacing[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing[2.5],
  },
  footerTarget: { fontSize: 13, fontWeight: '500' },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3.5],
    borderRadius: borderRadius.xl,
  },
  confirmBtnText: { fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
});
