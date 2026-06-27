/**
 * PurchaseOrderCreateScreen — создание (и редактирование черновика) заказа
 * поставщику.
 *
 * Поток:
 *   1. Поставщик — inline-пикер из suppliersApi.getAll (системный Б/У-канал
 *      исключён). Обязателен.
 *   2. Позиции — добавляются через ТОТ ЖЕ ProductPickerModal, что и в Кассе
 *      (кэш-первый, мгновенный). У каждой строки: количество (степпер) и
 *      закупочная цена (по умолчанию — текущая себестоимость товара).
 *   3. «Дозаказ» — префилл строк из purchaseOrdersApi.suggestions()
 *      (низкие остатки, сгруппированы по предпочтительному поставщику).
 *   4. Живой итог Σ(кол-во × цена). Сохранить → create (draft) → открываем
 *      детальную, чтобы сразу «Оформить заказ».
 *
 * editId в route.params → режим редактирования черновика: предзаполняем
 * поставщика/строки/заметку и Save вызывает update(id, …).
 *
 * Write-роль (director/admin/superadmin) гейтит весь экран на стороне списка
 * (кнопка «+» скрыта для остальных); сервер дублирует проверку.
 *
 * Android-safe: ProductPickerModal + inline-пикеры кроссплатформенны.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import IosScreenHeader from '../components/IosScreenHeader';
import ProductPickerModal from '../components/ProductPickerModal';
import SupplierRequestSheet from './purchaseOrders/SupplierRequestSheet';
import { useColors } from '../contexts/ThemeContext';
import { purchaseOrdersApi, suppliersApi } from '../api/services';
import { haptic } from '../platform/haptics';
import { iosSectionLabel } from '../platform/iosSurface';
import { colors, borderRadius, spacing } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import {
  type Product,
  type PurchaseOrder,
  type PurchaseOrderSuggestionGroup,
  type Supplier,
} from '../../../shared/types';
import { formatMoney } from './purchaseOrders/purchaseOrderHelpers';

interface DraftLine {
  productId: string;
  name: string;
  quantity: number;
  /** Free-text cost so decimals (12.5) type cleanly; parsed to a number on save. */
  costText: string;
}

function parseCost(costText: string): number {
  const n = parseFloat(costText.replace(',', '.'));
  return Number.isNaN(n) ? 0 : n;
}

export default function PurchaseOrderCreateScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const queryClient = useQueryClient();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();

  const editId: string | undefined = route.params?.editId;
  const seedPo: PurchaseOrder | undefined = route.params?.po;
  const isEdit = !!editId;

  // `supplierId` route-param — set when «Новый заказ» is opened from a
  // supplier's detail screen, so the supplier is preselected. Falls back to
  // the seed draft's supplier (edit mode), then empty (manual pick).
  const [supplierId, setSupplierId] = useState<string>(route.params?.supplierId ?? seedPo?.supplierId ?? '');
  const [showSupplierPicker, setShowSupplierPicker] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>(() =>
    (seedPo?.items ?? []).map((it) => ({
      productId: it.productId,
      name: it.name,
      quantity: it.quantity,
      costText: it.costPrice ? String(it.costPrice) : '',
    })),
  );
  const [note, setNote] = useState(seedPo?.note ?? '');
  const [showPicker, setShowPicker] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showRequest, setShowRequest] = useState(false);

  // ── Suppliers ──────────────────────────────────────────────────────────
  const { data: suppliersRaw } = useQuery<Supplier[]>({
    queryKey: ['suppliers'],
    queryFn: async () => (await suppliersApi.getAll()).data.data,
    staleTime: 5 * 60 * 1000,
  });
  const suppliers = useMemo(
    () => (suppliersRaw || []).filter((s) => !s.isSystem && s.kind !== 'used_purchase'),
    [suppliersRaw],
  );
  const selectedSupplier = suppliers.find((s) => s.id === supplierId);
  const selectedSupplierName = selectedSupplier?.name ?? (supplierId ? (seedPo?.supplierName ?? 'Поставщик') : '');

  // ── Дозаказ (suggestions) ────────────────────────────────────────────────
  const { data: suggestions } = useQuery<PurchaseOrderSuggestionGroup[]>({
    queryKey: ['purchase-order-suggestions'],
    queryFn: async () => (await purchaseOrdersApi.suggestions()).data,
    enabled: showSuggestions,
    staleTime: 60 * 1000,
  });

  // ── Lines ──────────────────────────────────────────────────────────────
  const getCartQty = useCallback(
    (productId: string) => lines.find((l) => l.productId === productId)?.quantity ?? 0,
    [lines],
  );

  const handleSelectProduct = useCallback((product: Product) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === product.id);
      if (existing) {
        return prev.map((l) => (l.productId === product.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          quantity: 1,
          costText: product.costPrice ? String(product.costPrice) : '',
        },
      ];
    });
  }, []);

  const changeQty = useCallback((productId: string, delta: number) => {
    haptic('tap');
    setLines((prev) =>
      prev.map((l) => (l.productId === productId ? { ...l, quantity: Math.max(1, l.quantity + delta) } : l)),
    );
  }, []);

  const changeCost = useCallback((productId: string, costText: string) => {
    // Разрешаем только цифры, точку и запятую.
    const cleaned = costText.replace(/[^0-9.,]/g, '');
    setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, costText: cleaned } : l)));
  }, []);

  const removeLine = useCallback((productId: string) => {
    haptic('tap');
    setLines((prev) => prev.filter((l) => l.productId !== productId));
  }, []);

  const total = useMemo(() => lines.reduce((s, l) => s + l.quantity * parseCost(l.costText), 0), [lines]);

  const applySuggestionGroup = useCallback((group: PurchaseOrderSuggestionGroup) => {
    haptic('select');
    if (group.supplierId) setSupplierId(group.supplierId);
    setLines(
      group.items.map((it) => ({
        productId: it.productId,
        name: it.name,
        quantity: Math.max(1, it.suggestedQuantity),
        costText: it.costPrice ? String(it.costPrice) : '',
      })),
    );
    setShowSuggestions(false);
  }, []);

  // ── Save (create / update) ───────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: () => {
      const items = lines.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        costPrice: parseCost(l.costText),
      }));
      const payload = { supplierId, note: note.trim() || undefined, items };
      return isEdit ? purchaseOrdersApi.update(editId as string, payload) : purchaseOrdersApi.create(payload);
    },
    onSuccess: async (res) => {
      haptic('success');
      await queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      const po = res.data;
      queryClient.setQueryData(['purchase-order', po.id], po);
      if (isEdit) {
        navigation.goBack();
      } else {
        // Открываем созданный черновик — сразу можно «Оформить заказ».
        navigation.replace('PurchaseOrderDetail', { id: po.id, po });
      }
    },
    onError: () => {
      haptic('error');
      Alert.alert(
        isEdit ? 'Не удалось сохранить' : 'Не удалось создать заказ',
        'Проверьте подключение к интернету и попробуйте ещё раз.',
      );
    },
  });

  const canSave = !!supplierId && lines.length > 0 && !saveMutation.isPending;

  const handleSave = () => {
    if (!supplierId) {
      haptic('warning');
      Alert.alert('Выберите поставщика', 'Заказ нельзя сохранить без поставщика.');
      return;
    }
    if (lines.length === 0) {
      haptic('warning');
      Alert.alert('Добавьте позиции', 'Добавьте хотя бы один товар в заказ.');
      return;
    }
    haptic('tap');
    saveMutation.mutate();
  };

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title={isEdit ? 'Изменить заказ' : 'Новый заказ'}
        onBack={() => navigation.goBack()}
        trailing={
          !isEdit ? (
            <TouchableOpacity
              style={[styles.suggestBtn, { backgroundColor: colors.amber[50], borderColor: colors.amber[200] }]}
              onPress={() => {
                haptic('tap');
                setShowSuggestions((v) => !v);
              }}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Дозаказ по остаткам"
            >
              <Ionicons name="sparkles-outline" size={14} color={colors.amber[700]} />
              <Text style={styles.suggestBtnText}>Дозаказ</Text>
            </TouchableOpacity>
          ) : undefined
        }
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingBottom: tabBarHeight + spacing[8] }]}
          keyboardShouldPersistTaps="handled"
          contentInset={{ bottom: tabBarHeight }}
          scrollIndicatorInsets={{ bottom: tabBarHeight }}
        >
          {/* ── Дозаказ panel ── */}
          {showSuggestions ? (
            <View style={[styles.suggestPanel, { backgroundColor: palette.bg.card, borderColor: colors.amber[200] }]}>
              <Text style={[styles.suggestTitle, { color: palette.text.primary }]}>Дозаказ по низким остаткам</Text>
              {suggestions === undefined ? (
                <ActivityIndicator color={colors.primary[600]} style={{ paddingVertical: spacing[3] }} />
              ) : suggestions.length === 0 ? (
                <Text style={[styles.suggestEmpty, { color: palette.text.tertiary }]}>
                  Нет товаров с низким остатком
                </Text>
              ) : (
                suggestions.map((group) => (
                  <TouchableOpacity
                    key={group.supplierId ?? 'none'}
                    style={[styles.suggestGroup, { borderColor: palette.border.subtle }]}
                    onPress={() => applySuggestionGroup(group)}
                    activeOpacity={0.7}
                  >
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.suggestGroupName, { color: palette.text.primary }]} numberOfLines={1}>
                        {group.supplierName || 'Без поставщика'}
                      </Text>
                      <Text style={[styles.suggestGroupSub, { color: palette.text.tertiary }]} numberOfLines={1}>
                        {group.items.length} {'поз. к дозаказу'}
                      </Text>
                    </View>
                    <Ionicons name="download-outline" size={18} color={colors.primary[600]} />
                  </TouchableOpacity>
                ))
              )}
            </View>
          ) : null}

          {/* ═══ ПОСТАВЩИК ═══ */}
          <Text style={[iosSectionLabel, styles.sectionLabel, { color: palette.text.secondary }]}>ПОСТАВЩИК</Text>
          <TouchableOpacity
            style={[styles.fieldRow, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
            onPress={() => {
              haptic('tap');
              setShowSupplierPicker((v) => !v);
            }}
            activeOpacity={0.7}
          >
            <Ionicons name="business-outline" size={20} color={palette.text.secondary} />
            <Text
              style={[styles.fieldValue, { color: supplierId ? palette.text.primary : palette.text.tertiary }]}
              numberOfLines={1}
            >
              {selectedSupplierName || 'Выберите поставщика'}
            </Text>
            <Ionicons
              name={showSupplierPicker ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={palette.text.tertiary}
            />
          </TouchableOpacity>

          {showSupplierPicker ? (
            <View style={[styles.picker, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
              {suppliers.map((s) => (
                <TouchableOpacity
                  key={s.id}
                  style={[styles.pickerRow, { borderBottomColor: palette.border.subtle }]}
                  onPress={() => {
                    haptic('select');
                    setSupplierId(s.id);
                    setShowSupplierPicker(false);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.pickerRowText, { color: palette.text.primary }]} numberOfLines={1}>
                    {s.name}
                  </Text>
                  {supplierId === s.id ? (
                    <Ionicons name="checkmark-circle" size={20} color={colors.primary[600]} />
                  ) : null}
                </TouchableOpacity>
              ))}
              {suppliers.length === 0 ? (
                <Text style={[styles.pickerEmpty, { color: palette.text.tertiary }]}>
                  Нет поставщиков. Сначала добавьте поставщика.
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* ═══ ПОЗИЦИИ ═══ */}
          <View style={styles.linesHeader}>
            <Text style={[iosSectionLabel, styles.sectionLabel, { color: palette.text.secondary }]}>ПОЗИЦИИ</Text>
            <TouchableOpacity
              style={styles.addLineBtn}
              onPress={() => {
                haptic('tap');
                setShowPicker(true);
              }}
              activeOpacity={0.7}
            >
              <Ionicons name="add-circle" size={18} color={colors.primary[600]} />
              <Text style={styles.addLineBtnText}>Добавить товар</Text>
            </TouchableOpacity>
          </View>

          {lines.length === 0 ? (
            <TouchableOpacity
              style={[styles.emptyLines, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
              onPress={() => {
                haptic('tap');
                setShowPicker(true);
              }}
              activeOpacity={0.7}
            >
              <Ionicons name="cube-outline" size={22} color={palette.text.tertiary} />
              <Text style={[styles.emptyLinesText, { color: palette.text.tertiary }]}>
                Добавьте товары со склада в заказ
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={[styles.linesCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
              {lines.map((l, idx) => {
                const lineTotal = l.quantity * parseCost(l.costText);
                return (
                  <View
                    key={l.productId}
                    style={[
                      styles.lineRow,
                      idx < lines.length - 1 && {
                        borderBottomColor: palette.border.subtle,
                        borderBottomWidth: StyleSheet.hairlineWidth,
                      },
                    ]}
                  >
                    <View style={styles.lineTop}>
                      <Text style={[styles.lineName, { color: palette.text.primary }]} numberOfLines={2}>
                        {l.name}
                      </Text>
                      <TouchableOpacity onPress={() => removeLine(l.productId)} hitSlop={8} style={styles.lineRemove}>
                        <Ionicons name="trash-outline" size={17} color={colors.red[500]} />
                      </TouchableOpacity>
                    </View>
                    <View style={styles.lineControls}>
                      {/* Qty stepper */}
                      <View style={[styles.stepper, { borderColor: palette.border.subtle }]}>
                        <TouchableOpacity onPress={() => changeQty(l.productId, -1)} style={styles.stepBtn} hitSlop={6}>
                          <Ionicons name="remove" size={18} color={palette.text.secondary} />
                        </TouchableOpacity>
                        <Text style={[styles.stepValue, { color: palette.text.primary }]}>{l.quantity}</Text>
                        <TouchableOpacity onPress={() => changeQty(l.productId, 1)} style={styles.stepBtn} hitSlop={6}>
                          <Ionicons name="add" size={18} color={palette.text.secondary} />
                        </TouchableOpacity>
                      </View>
                      {/* Cost input */}
                      <View style={[styles.costWrap, { borderColor: palette.border.subtle }]}>
                        <TextInput
                          value={l.costText}
                          onChangeText={(t) => changeCost(l.productId, t)}
                          style={[styles.costInput, { color: palette.text.primary }]}
                          placeholder="Цена"
                          placeholderTextColor={palette.text.tertiary}
                          keyboardType="decimal-pad"
                        />
                        <Text style={[styles.costCurrency, { color: palette.text.tertiary }]}>₽</Text>
                      </View>
                    </View>
                    <Text style={[styles.lineTotal, { color: palette.text.secondary }]}>
                      {l.quantity} × {formatMoney(parseCost(l.costText))} = {formatMoney(lineTotal)}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}

          {/* «Сформировать запрос» — текстовый запрос поставщику по позициям
              (без цен) для отправки в WhatsApp / копирования. */}
          {lines.length > 0 ? (
            <TouchableOpacity
              style={[styles.requestBtn, { borderColor: palette.border.strong, backgroundColor: palette.bg.card }]}
              onPress={() => {
                haptic('tap');
                setShowRequest(true);
              }}
              activeOpacity={0.8}
            >
              <Ionicons name="chatbubbles-outline" size={18} color={colors.primary[600]} />
              <Text style={[styles.requestBtnText, { color: palette.text.primary }]}>Сформировать запрос</Text>
            </TouchableOpacity>
          ) : null}

          {/* ═══ КОММЕНТАРИЙ ═══ */}
          <Text style={[iosSectionLabel, styles.sectionLabel, { color: palette.text.secondary }]}>КОММЕНТАРИЙ</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            style={[
              styles.noteInput,
              { backgroundColor: palette.bg.card, borderColor: palette.border.subtle, color: palette.text.primary },
            ]}
            placeholder="Например: оплата по факту, доставка до склада…"
            placeholderTextColor={palette.text.tertiary}
            multiline
          />
        </ScrollView>

        {/* ── Sticky save bar ── */}
        <View
          style={[
            styles.saveBar,
            { backgroundColor: palette.bg.card, borderTopColor: palette.border.subtle, marginBottom: tabBarHeight },
          ]}
        >
          <View style={styles.totalRow}>
            <Text style={[styles.totalLabel, { color: palette.text.tertiary }]}>Итого</Text>
            <Text style={[styles.totalValue, { color: palette.text.primary }]}>{formatMoney(total)}</Text>
          </View>
          <TouchableOpacity
            style={[styles.saveBtn, { backgroundColor: canSave ? colors.primary[600] : palette.bg.muted }]}
            onPress={handleSave}
            disabled={!canSave}
            activeOpacity={0.85}
          >
            {saveMutation.isPending ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <>
                <Ionicons name="checkmark" size={18} color={canSave ? colors.white : palette.text.tertiary} />
                <Text style={[styles.saveBtnText, { color: canSave ? colors.white : palette.text.tertiary }]}>
                  {isEdit ? 'Сохранить' : 'Создать заказ'}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {/* ── Product picker (тот же, что в Кассе) ── */}
      <ProductPickerModal
        visible={showPicker}
        onClose={() => setShowPicker(false)}
        onSelectProduct={handleSelectProduct}
        getCartQty={getCartQty}
        title="Товары в заказ"
        showCostPrice
      />

      {/* ── Запрос поставщику (текст без цен → копировать / WhatsApp) ── */}
      <SupplierRequestSheet
        visible={showRequest}
        onClose={() => setShowRequest(false)}
        supplierName={selectedSupplierName || undefined}
        supplierPhone={selectedSupplier?.phone}
        lines={lines.map((l) => ({ name: l.name, quantity: l.quantity }))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: spacing[4], paddingTop: spacing[1] },
  sectionLabel: { marginLeft: spacing[1], marginTop: spacing[4], marginBottom: spacing[2] },

  // Suggest (Дозаказ)
  suggestBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing[2.5],
    paddingVertical: 6,
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  suggestBtnText: { fontSize: 12, fontWeight: '700', color: colors.amber[700] },
  suggestPanel: {
    marginTop: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    padding: spacing[3.5],
    gap: spacing[2],
  },
  suggestTitle: { fontSize: 14, fontWeight: '700', letterSpacing: -0.2 },
  suggestEmpty: { fontSize: 13, paddingVertical: spacing[2] },
  suggestGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  suggestGroupName: { fontSize: 14, fontWeight: '600' },
  suggestGroupSub: { fontSize: 12, marginTop: 1 },

  // Field row + picker
  fieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  fieldValue: { flex: 1, fontSize: 15, fontWeight: '600' },
  picker: {
    marginTop: spacing[2],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[2],
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pickerRowText: { flex: 1, fontSize: 15, fontWeight: '500' },
  pickerEmpty: { fontSize: 13, padding: spacing[3.5], textAlign: 'center' },

  // Lines
  linesHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  addLineBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing[4], marginBottom: spacing[2] },
  addLineBtnText: { fontSize: 13, fontWeight: '700', color: colors.primary[600] },
  emptyLines: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[5],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
  emptyLinesText: { fontSize: 13, fontWeight: '500' },
  requestBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    marginTop: spacing[3],
    paddingVertical: spacing[3.5],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  requestBtnText: { fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
  linesCard: { borderRadius: borderRadius.xl, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  lineRow: { paddingHorizontal: spacing[3.5], paddingVertical: spacing[3], gap: spacing[2] },
  lineTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] },
  lineName: { flex: 1, fontSize: 15, fontWeight: '600', letterSpacing: -0.1 },
  lineRemove: { padding: 2 },
  lineControls: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  stepBtn: { paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
  stepValue: { minWidth: 28, textAlign: 'center', fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  costWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
  },
  costInput: { flex: 1, fontSize: 15, fontWeight: '600', paddingVertical: spacing[2] },
  costCurrency: { fontSize: 14, fontWeight: '600' },
  lineTotal: { fontSize: 12, fontWeight: '500', fontVariant: ['tabular-nums'] },

  // Note
  noteInput: {
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing[3.5],
    minHeight: 80,
    fontSize: 15,
    textAlignVertical: 'top',
  },

  // Save bar
  saveBar: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing[2.5],
  },
  totalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  totalLabel: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  totalValue: { fontSize: 20, fontWeight: '800', letterSpacing: -0.4, fontVariant: ['tabular-nums'] },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3.5],
    borderRadius: borderRadius.xl,
  },
  saveBtnText: { fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
});
