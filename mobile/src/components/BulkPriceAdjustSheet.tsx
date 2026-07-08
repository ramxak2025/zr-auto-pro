/**
 * BulkPriceAdjustSheet — «Массовая корректировка цен».
 *
 * Owner-class tool (director / admin / superadmin — same as the backend
 * endpoint) that raises or lowers the SELL price of a chosen scope by a
 * percent, with optional rounding. Money-sensitive: the owner MUST press
 * «Предпросмотр» (a dry-run) before «Применить» becomes available, and any
 * change to the parameters clears the last preview so a stale «было → стало»
 * can never be applied.
 *
 * Contract (committed, not touched here):
 *   productsApi.bulkAdjustPrice({ scope, categoryIds?, productIds?, direction,
 *     percent, rounding?, dryRun? }) → { affected, examples? }
 *   examples are returned ONLY on a dry-run.
 *
 * Design notes:
 *   • Fully self-contained BottomSheet — no nested RNModal for picking
 *     folders / products (an RNModal-over-RNModal froze iOS during the
 *     present transition, see ProductPickerModal). Both the folder and the
 *     product selectors are INLINE searchable check-lists inside the sheet's
 *     own scroll body, so the sheet never has to close-and-reopen.
 *   • Android-safe: plain Views / TextInput, no iOS-only APIs.
 *   • Follows the Autexa iOS visual system: segmented controls (ChecksScreen
 *     idiom), iosCard/surface tokens from the semantic palette, tabular-nums
 *     for every money figure.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BottomSheet } from './BottomSheet';
import { productsApi } from '../api/services';
import { useColors } from '../contexts/ThemeContext';
import type { SemanticPalette } from '../theme/palette';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { haptic } from '../platform/haptics';
import type { Product } from '../../../shared/types';
import type { BulkAdjustPriceRequest, BulkAdjustPriceResponse } from '../../../shared/api/types';

// Rounding step quick-presets. Custom values are entered in the input beside
// the chips (owner example: 156 → 200 with «Вверх» + step 50).
const ROUNDING_STEP_PRESETS = [10, 50, 100];
// How many product rows the inline «Позиции» selector renders at once. Real
// tenants have hundreds of products; capping the rendered rows keeps the
// non-virtualised inline list cheap. Beyond the cap the owner narrows with
// the search field.
const PRODUCT_RESULT_CAP = 60;
// Preview example that illustrates the rounding rule.
const ROUNDING_EXAMPLE_BASE = 156;

function formatMoney(v: number): string {
  return (
    Math.round(v)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
  );
}

/** Russian count-agreement pluraliser: [1, 2–4, 5+]. */
function plural(n: number, forms: [string, string, string]): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return forms[0];
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1];
  return forms[2];
}

interface WarehouseCategoryLite {
  id: string;
  path: string;
}

export interface BulkPriceAdjustSheetProps {
  visible: boolean;
  onClose: () => void;
  /** warehouse_categories of the active warehouse (id + full path). */
  categories?: WarehouseCategoryLite[];
  /** Products of the active warehouse — feed the «Позиции» inline selector. */
  products: Product[];
}

export default function BulkPriceAdjustSheet({ visible, onClose, categories, products }: BulkPriceAdjustSheetProps) {
  const palette = useColors();
  const queryClient = useQueryClient();

  const [scope, setScope] = useState<'all' | 'categories' | 'products'>('all');
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<Set<string>>(new Set());
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [productSearch, setProductSearch] = useState('');
  const [direction, setDirection] = useState<'increase' | 'decrease'>('increase');
  const [percent, setPercent] = useState('');
  const [roundingMode, setRoundingMode] = useState<'none' | 'up' | 'down'>('none');
  const [stepText, setStepText] = useState('50');
  const [preview, setPreview] = useState<BulkAdjustPriceResponse | null>(null);

  // Fresh open → reset everything so a previous session never leaks.
  useEffect(() => {
    if (!visible) return;
    setScope('all');
    setSelectedCategoryIds(new Set());
    setSelectedProductIds(new Set());
    setProductSearch('');
    setDirection('increase');
    setPercent('');
    setRoundingMode('none');
    setStepText('50');
    setPreview(null);
  }, [visible]);

  // Any parameter change invalidates the last preview — the owner must
  // re-preview before «Применить» re-enables. Prevents applying a stale
  // «было → стало» after nudging the percent / scope / rounding.
  useEffect(() => {
    setPreview(null);
  }, [scope, direction, percent, roundingMode, stepText, selectedCategoryIds, selectedProductIds]);

  const percentValue = useMemo(() => {
    const n = Number(percent.replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  }, [percent]);

  const stepValue = useMemo(() => {
    const n = parseInt(stepText, 10);
    return Number.isFinite(n) ? n : 0;
  }, [stepText]);

  const sortedCategories = useMemo(
    () => [...(categories ?? [])].sort((a, b) => a.path.localeCompare(b.path)),
    [categories],
  );

  const filteredProducts = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.category ? p.category.toLowerCase().includes(q) : false),
    );
  }, [products, productSearch]);
  const shownProducts = filteredProducts.slice(0, PRODUCT_RESULT_CAP);

  // ── Validation ────────────────────────────────────────────────────────
  const selectionValid =
    scope === 'all' ||
    (scope === 'categories' && selectedCategoryIds.size > 0) ||
    (scope === 'products' && selectedProductIds.size > 0);
  const percentValid = Number.isFinite(percentValue) && percentValue > 0 && percentValue <= 1000;
  const roundingValid = roundingMode === 'none' || stepValue > 0;
  const canPreview = selectionValid && percentValid && roundingValid;
  const canApply = canPreview && preview !== null && preview.affected > 0;

  const buildRequest = useCallback(
    (dryRun: boolean): BulkAdjustPriceRequest => ({
      scope,
      direction,
      percent: percentValue,
      dryRun,
      ...(scope === 'categories' ? { categoryIds: Array.from(selectedCategoryIds) } : {}),
      ...(scope === 'products' ? { productIds: Array.from(selectedProductIds) } : {}),
      ...(roundingMode !== 'none' ? { rounding: { mode: roundingMode, step: stepValue } } : {}),
    }),
    [scope, direction, percentValue, selectedCategoryIds, selectedProductIds, roundingMode, stepValue],
  );

  const previewMutation = useMutation({
    mutationFn: (data: BulkAdjustPriceRequest) => productsApi.bulkAdjustPrice(data).then((r) => r.data),
    onSuccess: (res) => {
      haptic(res.affected > 0 ? 'tap' : 'warning');
      setPreview(res);
    },
    onError: (err: unknown) => {
      haptic('error');
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Не удалось рассчитать предпросмотр';
      Alert.alert('Ошибка', msg);
    },
  });

  const applyMutation = useMutation({
    mutationFn: (data: BulkAdjustPriceRequest) => productsApi.bulkAdjustPrice(data).then((r) => r.data),
    onSuccess: (res) => {
      haptic('success');
      // Refresh every products cache slot + the in-cash picker so the new
      // prices show everywhere immediately.
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['all-products-check'] });
      Alert.alert(
        'Готово',
        `Цена изменена у ${res.affected} ${plural(res.affected, ['позиции', 'позиций', 'позиций'])}.`,
      );
      onClose();
    },
    onError: (err: unknown) => {
      haptic('error');
      const msg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Не удалось применить изменение';
      Alert.alert('Ошибка', msg);
    },
  });

  const handlePreview = () => {
    if (!percentValid) {
      Alert.alert('Проверьте данные', 'Процент должен быть больше 0.');
      return;
    }
    if (!selectionValid) {
      Alert.alert(
        'Проверьте данные',
        scope === 'categories' ? 'Выберите хотя бы одну папку.' : 'Выберите хотя бы одну позицию.',
      );
      return;
    }
    if (!roundingValid) {
      Alert.alert('Проверьте данные', 'Шаг округления должен быть больше 0.');
      return;
    }
    haptic('tap');
    previewMutation.mutate(buildRequest(true));
  };

  const handleApply = () => {
    if (!canApply || !preview) return;
    const sign = direction === 'increase' ? '+' : '−';
    Alert.alert(
      'Изменить цены',
      `Применить новую цену (${sign}${percentValue}%) у ${preview.affected} ${plural(preview.affected, [
        'позиции',
        'позиций',
        'позиций',
      ])}? Действие затронет только розничную цену.`,
      [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Изменить', style: 'default', onPress: () => applyMutation.mutate(buildRequest(false)) },
      ],
    );
  };

  const toggleCategory = useCallback((id: string) => {
    haptic('tap');
    setSelectedCategoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleProduct = useCallback((id: string) => {
    haptic('tap');
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const roundingExample = useMemo(() => {
    if (roundingMode === 'none' || stepValue <= 0) return null;
    const rounded =
      roundingMode === 'up'
        ? Math.ceil(ROUNDING_EXAMPLE_BASE / stepValue) * stepValue
        : Math.floor(ROUNDING_EXAMPLE_BASE / stepValue) * stepValue;
    return `Пример: ${ROUNDING_EXAMPLE_BASE} → ${rounded}`;
  }, [roundingMode, stepValue]);

  const previewing = previewMutation.isPending;
  const applying = applyMutation.isPending;

  return (
    <BottomSheet visible={visible} onClose={onClose} title={'Массовая корректировка цен'} heightRatio={0.92}>
      {/* ── Область ─────────────────────────────────────────────────── */}
      <Text style={[styles.sectionLabel, { color: palette.text.secondary }]}>Область</Text>
      <Segmented
        palette={palette}
        value={scope}
        onChange={(v) => setScope(v)}
        options={[
          { value: 'all', label: 'Весь ассортимент' },
          { value: 'categories', label: 'Папки' },
          { value: 'products', label: 'Позиции' },
        ]}
      />

      {scope === 'all' && (
        <View style={[styles.infoBox, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
          <Ionicons name="information-circle-outline" size={16} color={palette.text.secondary} />
          <Text style={[styles.infoBoxText, { color: palette.text.secondary }]}>
            Изменение затронет розничную цену всех товаров склада.
          </Text>
        </View>
      )}

      {scope === 'categories' && (
        <View style={styles.selectorWrap}>
          <View style={styles.selectorHeaderRow}>
            <Text style={[styles.selectorHint, { color: palette.text.tertiary }]}>
              {selectedCategoryIds.size > 0
                ? `Выбрано ${selectedCategoryIds.size} ${plural(selectedCategoryIds.size, ['папка', 'папки', 'папок'])}`
                : 'Выберите папки'}
            </Text>
            {selectedCategoryIds.size > 0 && (
              <TouchableOpacity onPress={() => setSelectedCategoryIds(new Set())} hitSlop={8}>
                <Text style={[styles.clearLink, { color: palette.accent.primary }]}>Очистить</Text>
              </TouchableOpacity>
            )}
          </View>
          {sortedCategories.length === 0 ? (
            <Text style={[styles.emptyHint, { color: palette.text.tertiary }]}>Нет папок на этом складе</Text>
          ) : (
            <View style={[styles.checkList, { borderColor: palette.border.subtle }]}>
              {sortedCategories.map((cat, i) => {
                const checked = selectedCategoryIds.has(cat.id);
                const parts = cat.path.split('/');
                const leaf = parts[parts.length - 1];
                const parentPath = parts.slice(0, -1).join(' / ');
                return (
                  <TouchableOpacity
                    key={cat.id}
                    activeOpacity={0.7}
                    onPress={() => toggleCategory(cat.id)}
                    style={[
                      styles.checkRow,
                      i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border.subtle },
                    ]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked }}
                  >
                    <Ionicons
                      name={checked ? 'checkbox' : 'square-outline'}
                      size={22}
                      color={checked ? palette.accent.primary : palette.text.tertiary}
                    />
                    <View style={styles.checkRowInfo}>
                      <Text style={[styles.checkRowTitle, { color: palette.text.primary }]} numberOfLines={1}>
                        {leaf}
                      </Text>
                      {parentPath ? (
                        <Text style={[styles.checkRowSub, { color: palette.text.tertiary }]} numberOfLines={1}>
                          {parentPath}
                        </Text>
                      ) : null}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>
      )}

      {scope === 'products' && (
        <View style={styles.selectorWrap}>
          <View style={styles.selectorHeaderRow}>
            <Text style={[styles.selectorHint, { color: palette.text.tertiary }]}>
              {selectedProductIds.size > 0
                ? `Выбрано ${selectedProductIds.size} ${plural(selectedProductIds.size, ['позиция', 'позиции', 'позиций'])}`
                : 'Выберите позиции'}
            </Text>
            {selectedProductIds.size > 0 && (
              <TouchableOpacity onPress={() => setSelectedProductIds(new Set())} hitSlop={8}>
                <Text style={[styles.clearLink, { color: palette.accent.primary }]}>Очистить</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={[styles.searchWrap, { backgroundColor: palette.bg.muted }]}>
            <Ionicons name="search-outline" size={16} color={palette.text.tertiary} />
            <TextInput
              value={productSearch}
              onChangeText={setProductSearch}
              style={[styles.searchInput, { color: palette.text.primary }]}
              placeholder={'Поиск товара...'}
              placeholderTextColor={palette.text.tertiary}
              autoCorrect={false}
            />
            {productSearch ? (
              <TouchableOpacity onPress={() => setProductSearch('')} hitSlop={8}>
                <Ionicons name="close-circle" size={18} color={palette.text.tertiary} />
              </TouchableOpacity>
            ) : null}
          </View>
          {shownProducts.length === 0 ? (
            <Text style={[styles.emptyHint, { color: palette.text.tertiary }]}>
              {productSearch ? 'Ничего не найдено' : 'Нет товаров'}
            </Text>
          ) : (
            <View style={[styles.checkList, { borderColor: palette.border.subtle }]}>
              {shownProducts.map((p, i) => {
                const checked = selectedProductIds.has(p.id);
                const leaf = p.category ? p.category.split('/').pop() : null;
                return (
                  <TouchableOpacity
                    key={p.id}
                    activeOpacity={0.7}
                    onPress={() => toggleProduct(p.id)}
                    style={[
                      styles.checkRow,
                      i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: palette.border.subtle },
                    ]}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked }}
                  >
                    <Ionicons
                      name={checked ? 'checkbox' : 'square-outline'}
                      size={22}
                      color={checked ? palette.accent.primary : palette.text.tertiary}
                    />
                    <View style={styles.checkRowInfo}>
                      <Text style={[styles.checkRowTitle, { color: palette.text.primary }]} numberOfLines={1}>
                        {p.name}
                      </Text>
                      {leaf ? (
                        <Text style={[styles.checkRowSub, { color: palette.text.tertiary }]} numberOfLines={1}>
                          {leaf}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={[styles.checkRowPrice, { color: palette.text.secondary }]}>
                      {formatMoney(p.sellPrice)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
              {filteredProducts.length > PRODUCT_RESULT_CAP && (
                <Text style={[styles.moreHint, { color: palette.text.tertiary }]}>
                  Показаны первые {PRODUCT_RESULT_CAP} — уточните поиск
                </Text>
              )}
            </View>
          )}
        </View>
      )}

      {/* ── Действие ────────────────────────────────────────────────── */}
      <Text style={[styles.sectionLabel, { color: palette.text.secondary, marginTop: spacing[4] }]}>Действие</Text>
      <Segmented
        palette={palette}
        value={direction}
        onChange={(v) => setDirection(v)}
        options={[
          { value: 'increase', label: 'Поднять', icon: 'arrow-up' },
          { value: 'decrease', label: 'Снизить', icon: 'arrow-down' },
        ]}
      />
      <View style={styles.percentRow}>
        <TextInput
          value={percent}
          onChangeText={setPercent}
          style={[
            styles.percentInput,
            { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
          ]}
          keyboardType="decimal-pad"
          placeholder="0"
          placeholderTextColor={palette.text.tertiary}
        />
        <Text style={[styles.percentSuffix, { color: palette.text.secondary }]}>%</Text>
      </View>

      {/* ── Округление ──────────────────────────────────────────────── */}
      <Text style={[styles.sectionLabel, { color: palette.text.secondary, marginTop: spacing[4] }]}>Округление</Text>
      <Segmented
        palette={palette}
        value={roundingMode}
        onChange={(v) => setRoundingMode(v)}
        options={[
          { value: 'none', label: 'Нет' },
          { value: 'up', label: 'Вверх' },
          { value: 'down', label: 'Вниз' },
        ]}
      />
      {roundingMode !== 'none' && (
        <View style={styles.stepWrap}>
          <View style={styles.stepChipsRow}>
            {ROUNDING_STEP_PRESETS.map((s) => {
              const active = stepValue === s;
              return (
                <TouchableOpacity
                  key={s}
                  onPress={() => {
                    haptic('select');
                    setStepText(String(s));
                  }}
                  style={[
                    styles.stepChip,
                    {
                      backgroundColor: active ? palette.accent.primary : palette.bg.muted,
                      borderColor: active ? palette.accent.primary : palette.border.subtle,
                    },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                >
                  <Text style={[styles.stepChipText, { color: active ? colors.white : palette.text.secondary }]}>
                    {s}
                  </Text>
                </TouchableOpacity>
              );
            })}
            <TextInput
              value={stepText}
              onChangeText={setStepText}
              style={[
                styles.stepInput,
                { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
              ]}
              keyboardType="number-pad"
              placeholder="шаг"
              placeholderTextColor={palette.text.tertiary}
            />
          </View>
          {roundingExample && (
            <Text style={[styles.stepExample, { color: palette.text.tertiary }]}>{roundingExample}</Text>
          )}
        </View>
      )}

      {/* ── Предпросмотр ────────────────────────────────────────────── */}
      {preview !== null && (
        <View style={[styles.previewCard, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
          <Text
            style={[
              styles.previewTitle,
              { color: preview.affected > 0 ? palette.text.primary : palette.text.tertiary },
            ]}
          >
            {preview.affected > 0
              ? `Затронуто ${preview.affected} ${plural(preview.affected, ['позиция', 'позиции', 'позиций'])}`
              : 'Ничего не найдено под эти условия'}
          </Text>
          {preview.examples && preview.examples.length > 0 && (
            <View style={styles.previewList}>
              {preview.examples.map((ex) => (
                <View key={ex.id} style={[styles.previewRow, { borderTopColor: palette.border.subtle }]}>
                  <Text style={[styles.previewName, { color: palette.text.secondary }]} numberOfLines={1}>
                    {ex.name}
                  </Text>
                  <View style={styles.previewPrices}>
                    <Text style={[styles.previewOld, { color: palette.text.tertiary }]}>
                      {formatMoney(ex.oldPrice)}
                    </Text>
                    <Ionicons name="arrow-forward" size={12} color={palette.text.tertiary} />
                    <Text style={[styles.previewNew, { color: palette.accent.primary }]}>
                      {formatMoney(ex.newPrice)}
                    </Text>
                  </View>
                </View>
              ))}
              {preview.affected > preview.examples.length && (
                <Text style={[styles.moreHint, { color: palette.text.tertiary }]}>
                  …и ещё {preview.affected - preview.examples.length}
                </Text>
              )}
            </View>
          )}
        </View>
      )}

      {/* ── Кнопки: Предпросмотр → Применить ────────────────────────── */}
      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={[styles.previewBtn, { borderColor: palette.accent.primary }, previewing && { opacity: 0.6 }]}
          onPress={handlePreview}
          disabled={previewing}
          activeOpacity={0.85}
        >
          {previewing ? (
            <ActivityIndicator color={palette.accent.primary} size="small" />
          ) : (
            <>
              <Ionicons name="eye-outline" size={18} color={palette.accent.primary} />
              <Text style={[styles.previewBtnText, { color: palette.accent.primary }]}>Предпросмотр</Text>
            </>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.applyBtn, { backgroundColor: canApply ? colors.primary[600] : palette.bg.muted }]}
          onPress={handleApply}
          disabled={!canApply || applying}
          activeOpacity={0.85}
        >
          {applying ? (
            <ActivityIndicator color={colors.white} size="small" />
          ) : (
            <Text style={[styles.applyBtnText, { color: canApply ? colors.white : palette.text.tertiary }]}>
              Применить
            </Text>
          )}
        </TouchableOpacity>
      </View>
      {preview === null && (
        <Text style={[styles.applyHint, { color: palette.text.tertiary }]}>
          Сначала нажмите «Предпросмотр» — так вы увидите, что изменится.
        </Text>
      )}
    </BottomSheet>
  );
}

// ── Segmented control — mirrors the ChecksScreen segmented idiom ──────────
interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
}
interface SegmentedProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  palette: SemanticPalette;
}
function Segmented<T extends string>({ options, value, onChange, palette }: SegmentedProps<T>) {
  return (
    <View style={[styles.segmentedControl, { backgroundColor: palette.bg.muted }]}>
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <TouchableOpacity
            key={opt.value}
            activeOpacity={0.7}
            onPress={() => {
              haptic('select');
              onChange(opt.value);
            }}
            style={[styles.segmentBtn, active && { backgroundColor: palette.bg.card }]}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
          >
            {opt.icon ? (
              <Ionicons name={opt.icon} size={15} color={active ? palette.accent.primary : palette.text.secondary} />
            ) : null}
            <Text
              style={[
                styles.segmentBtnText,
                { color: active ? palette.accent.primary : palette.text.secondary },
                active && styles.segmentBtnTextActive,
              ]}
              numberOfLines={1}
            >
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
    marginBottom: spacing[2],
  },
  // Segmented control
  segmentedControl: {
    flexDirection: 'row',
    borderRadius: borderRadius.xl,
    padding: 3,
  },
  segmentBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[1],
    borderRadius: borderRadius.lg,
  },
  segmentBtnText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  segmentBtnTextActive: {
    fontWeight: fontWeight.semibold,
  },
  // Info box (scope = all)
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[3],
    padding: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  infoBoxText: { flex: 1, fontSize: fontSize.xs, lineHeight: 17 },
  // Inline selectors (folders / products)
  selectorWrap: { marginTop: spacing[3] },
  selectorHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[2],
  },
  selectorHint: { fontSize: fontSize.xs, fontWeight: fontWeight.medium },
  clearLink: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  emptyHint: { fontSize: fontSize.sm, paddingVertical: spacing[3], textAlign: 'center' },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    marginBottom: spacing[2],
  },
  searchInput: { flex: 1, fontSize: fontSize.sm, paddingVertical: 0 },
  checkList: {
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
  },
  checkRowInfo: { flex: 1, minWidth: 0 },
  checkRowTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  checkRowSub: { fontSize: 11, marginTop: 1 },
  checkRowPrice: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, fontVariant: ['tabular-nums'] },
  moreHint: { fontSize: 11, textAlign: 'center', paddingVertical: spacing[2] },
  // Percent
  percentRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginTop: spacing[3] },
  percentInput: {
    flex: 1,
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    fontVariant: ['tabular-nums'],
  },
  percentSuffix: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  // Rounding step
  stepWrap: { marginTop: spacing[3] },
  stepChipsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  stepChip: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  stepChipText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, fontVariant: ['tabular-nums'] },
  stepInput: {
    flex: 1,
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    fontSize: fontSize.sm,
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
  },
  stepExample: { fontSize: 11, marginTop: spacing[2] },
  // Preview
  previewCard: {
    marginTop: spacing[4],
    padding: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  previewTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  previewList: { marginTop: spacing[2] },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[2],
    paddingVertical: spacing[2],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  previewName: { flex: 1, fontSize: fontSize.xs },
  previewPrices: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  previewOld: {
    fontSize: fontSize.xs,
    textDecorationLine: 'line-through',
    fontVariant: ['tabular-nums'],
  },
  previewNew: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, fontVariant: ['tabular-nums'] },
  // Actions
  actionsRow: { flexDirection: 'row', gap: spacing[3], marginTop: spacing[5] },
  previewBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3.5],
    borderRadius: borderRadius.xl,
    borderWidth: 1.5,
  },
  previewBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  applyBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[3.5],
    borderRadius: borderRadius.xl,
  },
  applyBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  applyHint: { fontSize: 11, textAlign: 'center', marginTop: spacing[2] },
});
