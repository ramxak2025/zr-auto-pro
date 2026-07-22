/**
 * SupplyReceiveScreen — приёмка поставки ПО ЗАКАЗУ поставщику.
 *
 * Открывается из «Принять поставку» (PurchaseOrderDetailScreen, статус
 * `ordered`) или из «Новая поставка» (SupplierDetailScreen → выбор заказа).
 * Предзаполняет ожидаемые позиции заказа; по каждой строке владелец:
 *   • сверяет фактически принятое количество (степпер / ввод, не больше остатка);
 *   • вычёркивает позицию, которой не было в накладной (чек-бокс «включено»);
 *   • вводит ЗАКУПОЧНУЮ ЦЕНУ за единицу (по умолчанию — цена из заказа).
 * Внизу — «Стоимость накладной» = Σ(принято × цена) по включённым строкам и
 * ДВА способа приёмки:
 *   • «Принять без оплаты» (paymentMode:'debt')  → сумма падает в долг поставщику;
 *   • «Оплатить сразу»     (paymentMode:'paid')  → автоматически создаётся платёж.
 *
 * Контракт (миграция 098, backend готов): purchaseOrdersApi.receive(orderId,
 * { items:[{ itemId, receivedQuantity, purchasePrice }], paymentMode }) — атомарно
 * создаёт поставку, привязанную к заказу (Delivery.purchaseOrderId), обновляет
 * себестоимость + остаток, и поднимает долг ИЛИ создаёт платёж. Возвращает
 * обновлённый заказ → кладём в кэш ['purchase-order', id]; инвалидируем
 * остатки/движения и леджер поставщика, чтобы Поставки/Платежи/Долг освежились.
 *
 * Деньги/склад считает СЕРВЕР в транзакции — экран лишь шлёт корректный payload.
 *
 * Android-safe: ScrollView + степперы + TextInput, без iOS-only API.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import IosScreenHeader from '../components/IosScreenHeader';
import ConfirmDialog from '../components/ConfirmDialog';
import QtyInput from '../components/QtyInput';
import { ListSkeleton } from '../components/Skeleton';
import QueryErrorState from '../components/QueryErrorState';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import { purchaseOrdersApi } from '../api/services';
import { haptic } from '../platform/haptics';
import { iosSectionLabel } from '../platform/iosSurface';
import { colors, borderRadius, spacing, getBadgeColors } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import type { PurchaseOrder } from '../../../shared/types';
import { formatMoney, formatPoDate, outstandingQty } from './purchaseOrders/purchaseOrderHelpers';
import { roundQty } from '../utils/units';

type PayMode = 'debt' | 'paid';

interface LineState {
  /** «Принять сейчас» — дельта приёмки (в т.ч. дробная), не больше остатка. */
  qty: number;
  /** Закупочная цена за единицу (free-text, чтобы 12.5 печаталось чисто). */
  priceText: string;
  /** Включена ли строка в накладную (можно «вычеркнуть» лишнюю). */
  included: boolean;
}

function parsePrice(t: string): number {
  const n = parseFloat((t || '').replace(',', '.'));
  return Number.isNaN(n) || n < 0 ? 0 : n;
}

export default function SupplyReceiveScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const queryClient = useQueryClient();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  // Заказы поставщикам / приёмка — ключ suppliers_manage (сервер: мутации
  // purchase-orders → тот же ключ; admin живёт по матрице из /auth/me).
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('suppliers_manage');

  const dark = palette.mode === 'dark';
  const orderId: string = route.params?.orderId;
  const seedPo: PurchaseOrder | undefined = route.params?.po;

  const {
    data: po,
    isError,
    isFetching,
    refetch,
  } = useQuery<PurchaseOrder>({
    queryKey: ['purchase-order', orderId],
    queryFn: async () => (await purchaseOrdersApi.getById(orderId)).data,
    // Шапка из строки заказа — мгновенно; позиции дотянет getById.
    placeholderData: (prev) => prev ?? seedPo,
  });

  const items = useMemo(() => po?.items ?? [], [po]);

  // Per-line receiving state, seeded ONCE when items first arrive (a later
  // background refetch must not clobber the owner's in-progress edits).
  const [lineState, setLineState] = useState<Record<string, LineState>>({});
  const [seeded, setSeeded] = useState(false);
  const [pendingMode, setPendingMode] = useState<PayMode | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (seeded || items.length === 0) return;
    const init: Record<string, LineState> = {};
    for (const it of items) {
      const out = outstandingQty(it.quantity, it.receivedQuantity);
      init[it.id] = {
        qty: out,
        priceText: it.costPrice ? String(it.costPrice) : '',
        included: out > 0,
      };
    }
    setLineState(init);
    setSeeded(true);
  }, [items, seeded]);

  // Ручной ввод количества. QtyInput уже клампит к [0; max] и округляет до
  // 3 знаков (дробная приёмка «0.5 м»), здесь фиксируем валидное значение.
  const setQty = useCallback((id: string, n: number) => {
    setLineState((s) => {
      const cur = s[id] ?? { qty: 0, priceText: '', included: true };
      return { ...s, [id]: { ...cur, qty: n } };
    });
  }, []);

  const stepQty = useCallback((id: string, delta: number, max: number) => {
    haptic('tap');
    setLineState((s) => {
      const cur = s[id] ?? { qty: 0, priceText: '', included: true };
      const n = Math.max(0, Math.min(max, roundQty(cur.qty + delta)));
      return { ...s, [id]: { ...cur, qty: n } };
    });
  }, []);

  const setPrice = useCallback((id: string, value: string) => {
    const cleaned = value.replace(/[^0-9.,]/g, '');
    setLineState((s) => {
      const cur = s[id] ?? { qty: 0, priceText: '', included: true };
      return { ...s, [id]: { ...cur, priceText: cleaned } };
    });
  }, []);

  const toggleIncluded = useCallback((id: string) => {
    haptic('select');
    setLineState((s) => {
      const cur = s[id] ?? { qty: 0, priceText: '', included: false };
      return { ...s, [id]: { ...cur, included: !cur.included } };
    });
  }, []);

  // Σ(принято × цена) по включённым строкам — «стоимость накладной».
  const invoiceTotal = useMemo(
    () =>
      items.reduce((sum, it) => {
        const ls = lineState[it.id];
        if (!ls || !ls.included) return sum;
        return sum + ls.qty * parsePrice(ls.priceText);
      }, 0),
    [items, lineState],
  );

  // Payload — только включённые строки с положительным «принять сейчас».
  const payloadItems = useMemo(
    () =>
      items
        .map((it) => {
          const ls = lineState[it.id];
          if (!ls || !ls.included) return null;
          const max = outstandingQty(it.quantity, it.receivedQuantity);
          const qty = Math.min(max, ls.qty);
          if (qty <= 0) return null;
          return { itemId: it.id, receivedQuantity: qty, purchasePrice: parsePrice(ls.priceText) };
        })
        .filter((x): x is { itemId: string; receivedQuantity: number; purchasePrice: number } => x != null),
    [items, lineState],
  );

  const receiveMutation = useMutation({
    mutationFn: (vars: {
      mode: PayMode;
      items: Array<{ itemId: string; receivedQuantity: number; purchasePrice: number }>;
    }) => purchaseOrdersApi.receive(orderId, { items: vars.items, paymentMode: vars.mode }),
    onSuccess: (res, vars) => {
      haptic('success');
      const updated = res.data;
      // Мгновенно обновляем карточку заказа (новые «получено» + статус).
      queryClient.setQueryData(['purchase-order', orderId], updated);
      // Остатки/движения — приёмка кредитует склад.
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['all-products-check'] });
      queryClient.invalidateQueries({ queryKey: ['stock-movements'] });
      // Журнал → вкладка «Документы склада»: приёмка должна появиться там сразу.
      queryClient.invalidateQueries({ queryKey: ['journal-warehouse-docs'] });
      queryClient.invalidateQueries({ queryKey: ['low-stock'] });
      queryClient.invalidateQueries({ queryKey: ['warehouse-analytics'] });
      // Леджер поставщика — Поставки / Платежи / Долг.
      const supplierId = updated.supplierId;
      if (supplierId) {
        queryClient.invalidateQueries({ queryKey: ['supplier', supplierId] });
        queryClient.invalidateQueries({ queryKey: ['supplier-deliveries', supplierId] });
        queryClient.invalidateQueries({ queryKey: ['supplier-payments', supplierId] });
      }
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      const total = vars.items.reduce((s, l) => s + l.receivedQuantity * l.purchasePrice, 0);
      navigation.goBack();
      // Сообщение после возврата — глобальный Alert поверх предыдущего экрана.
      setTimeout(() => {
        Alert.alert(
          'Поставка принята',
          vars.mode === 'paid'
            ? `Накладная на ${formatMoney(total)} оплачена сразу — платёж добавлен в раздел «Платежи».`
            : `Накладная на ${formatMoney(total)} добавлена в долг поставщику.`,
        );
      }, 350);
    },
    onError: (err: any) => {
      haptic('error');
      const raw = err?.response?.data?.message;
      const msg = Array.isArray(raw) ? raw.join('\n') : raw || 'Не удалось принять поставку. Попробуйте ещё раз.';
      Alert.alert('Ошибка приёмки', String(msg));
    },
  });

  const canSubmit = payloadItems.length > 0 && !receiveMutation.isPending;

  const choosePayMode = (mode: PayMode) => {
    if (!canSubmit) {
      haptic('warning');
      return;
    }
    haptic('tap');
    setPendingMode(mode);
    setConfirmOpen(true);
  };

  const confirmReceive = () => {
    if (!pendingMode) return;
    receiveMutation.mutate({ mode: pendingMode, items: payloadItems });
  };

  // ── Loading / error (нет seed-данных) ─────────────────────────────────────
  if (!po) {
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Приёмка поставки" onBack={() => navigation.goBack()} />
        {isError ? (
          <QueryErrorState
            title="Не удалось загрузить заказ"
            description="Проверьте подключение к интернету и попробуйте ещё раз"
            onRetry={() => refetch()}
          />
        ) : (
          <ListSkeleton count={5} />
        )}
      </View>
    );
  }

  const totalOutstanding = items.reduce((s, it) => s + outstandingQty(it.quantity, it.receivedQuantity), 0);

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title={po.supplierName || 'Приёмка'}
        subtitle="Приёмка поставки по заказу"
        onBack={() => navigation.goBack()}
      />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: tabBarHeight + spacing[10] }]}
        contentInset={{ bottom: tabBarHeight }}
        scrollIndicatorInsets={{ bottom: tabBarHeight }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
      >
        {/* ── Подсказка ── */}
        <View style={[styles.hintCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
          <Ionicons name="cube-outline" size={16} color={colors.primary[600]} />
          <Text style={[styles.hintText, { color: palette.text.secondary }]}>
            Сверьте количество и впишите закупочную цену по каждой позиции. Лишнее можно вычеркнуть. Заказ от{' '}
            {formatPoDate(po.orderedAt || po.createdAt)}.
          </Text>
        </View>

        {/* ── Позиции ── */}
        <Text style={[iosSectionLabel, styles.sectionLabel, { color: palette.text.secondary }]}>
          ПОЗИЦИИ · {items.length}
        </Text>
        <View style={[styles.itemsCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
          {items.map((it, idx) => {
            const ls = lineState[it.id];
            const max = outstandingQty(it.quantity, it.receivedQuantity);
            const done = max === 0;
            const included = !done && (ls?.included ?? false);
            const qty = ls?.qty ?? 0;
            const price = parsePrice(ls?.priceText ?? '');
            const lineTotal = included ? qty * price : 0;
            const notLast = idx < items.length - 1;
            return (
              <View
                key={it.id}
                style={[
                  styles.itemRow,
                  notLast && {
                    borderBottomColor: palette.border.subtle,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <View style={styles.itemTop}>
                  {/* Чек-бокс «включить / вычеркнуть» */}
                  <TouchableOpacity
                    onPress={() => !done && toggleIncluded(it.id)}
                    hitSlop={8}
                    disabled={done}
                    style={styles.checkboxBtn}
                  >
                    <Ionicons
                      name={done ? 'checkmark-circle' : included ? 'checkbox' : 'square-outline'}
                      size={22}
                      color={done ? colors.green[500] : included ? colors.primary[600] : palette.text.tertiary}
                    />
                  </TouchableOpacity>
                  <Text
                    style={[
                      styles.itemName,
                      { color: palette.text.primary },
                      !included && !done && styles.itemNameExcluded,
                    ]}
                    numberOfLines={2}
                  >
                    {it.name}
                  </Text>
                  <Text style={[styles.itemLineTotal, { color: palette.text.secondary }]}>
                    {formatMoney(lineTotal)}
                  </Text>
                </View>

                <View style={styles.itemMetaRow}>
                  <View style={[styles.qtyBadge, { backgroundColor: palette.bg.muted }]}>
                    <Text style={[styles.qtyBadgeText, { color: palette.text.secondary }]}>Заказано {it.quantity}</Text>
                  </View>
                  {it.receivedQuantity > 0 ? (
                    <View style={[styles.qtyBadge, { backgroundColor: palette.bg.muted }]}>
                      <Text style={[styles.qtyBadgeText, { color: palette.text.secondary }]}>
                        Уже принято {it.receivedQuantity}
                      </Text>
                    </View>
                  ) : null}
                  <View
                    style={[
                      styles.qtyBadge,
                      {
                        backgroundColor: done
                          ? dark
                            ? getBadgeColors('dark').green.bg
                            : colors.green[50]
                          : palette.bg.muted,
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.qtyBadgeText,
                        {
                          color: done
                            ? dark
                              ? getBadgeColors('dark').green.text
                              : colors.green[700]
                            : palette.text.secondary,
                        },
                      ]}
                    >
                      {done ? 'Получено полностью' : `Остаток ${max}`}
                    </Text>
                  </View>
                </View>

                {/* Контролы приёмки — только для включённых незакрытых строк. */}
                {included ? (
                  <View style={styles.controls}>
                    <View style={[styles.stepper, { borderColor: palette.border.subtle }]}>
                      <TouchableOpacity onPress={() => stepQty(it.id, -1, max)} style={styles.stepBtn} hitSlop={6}>
                        <Ionicons name="remove" size={18} color={palette.text.secondary} />
                      </TouchableOpacity>
                      <QtyInput
                        value={qty}
                        min={0}
                        max={max}
                        onCommit={(n) => setQty(it.id, n)}
                        style={[styles.stepInput, { color: palette.text.primary }]}
                        placeholder="0"
                        placeholderTextColor={palette.text.tertiary}
                      />
                      <TouchableOpacity onPress={() => stepQty(it.id, 1, max)} style={styles.stepBtn} hitSlop={6}>
                        <Ionicons name="add" size={18} color={palette.text.secondary} />
                      </TouchableOpacity>
                    </View>
                    <View style={[styles.priceWrap, { borderColor: palette.border.subtle }]}>
                      <TextInput
                        value={ls?.priceText ?? ''}
                        onChangeText={(t) => setPrice(it.id, t)}
                        style={[styles.priceInput, { color: palette.text.primary }]}
                        keyboardType="decimal-pad"
                        placeholder="Цена"
                        placeholderTextColor={palette.text.tertiary}
                      />
                      <Text style={[styles.priceCurrency, { color: palette.text.tertiary }]}>₽/шт</Text>
                    </View>
                  </View>
                ) : !done ? (
                  <Text style={[styles.excludedHint, { color: palette.text.tertiary }]}>
                    Вычеркнута — не войдёт в накладную
                  </Text>
                ) : null}
              </View>
            );
          })}
          {items.length === 0 ? (
            isFetching ? (
              <ActivityIndicator color={colors.primary[600]} style={{ paddingVertical: spacing[4] }} />
            ) : (
              <Text style={[styles.itemsEmpty, { color: palette.text.tertiary }]}>Нет позиций для приёмки</Text>
            )
          ) : null}
        </View>

        {totalOutstanding === 0 && items.length > 0 ? (
          <View style={styles.terminalHint}>
            <Ionicons name="checkmark-done" size={16} color={colors.green[600]} />
            <Text style={[styles.terminalHintText, { color: palette.text.tertiary }]}>
              Весь заказ уже принят — принимать нечего
            </Text>
          </View>
        ) : null}
      </ScrollView>

      {/* ── Нижний бар: стоимость накладной + два способа приёмки ── */}
      {canWrite ? (
        <View
          style={[
            styles.bottomBar,
            { backgroundColor: palette.bg.card, borderTopColor: palette.border.subtle, marginBottom: tabBarHeight },
          ]}
        >
          <View style={styles.invoiceRow}>
            <Text style={[styles.invoiceLabel, { color: palette.text.tertiary }]}>Стоимость накладной</Text>
            <Text style={[styles.invoiceValue, { color: palette.text.primary }]}>{formatMoney(invoiceTotal)}</Text>
          </View>

          {receiveMutation.isPending ? (
            <ActivityIndicator color={colors.primary[600]} style={{ paddingVertical: spacing[3] }} />
          ) : (
            <>
              {/* «Принять без оплаты» — основной путь (сумма уходит в долг). */}
              <TouchableOpacity
                style={[styles.debtBtn, { backgroundColor: canSubmit ? colors.primary[600] : palette.bg.muted }]}
                onPress={() => choosePayMode('debt')}
                disabled={!canSubmit}
                activeOpacity={0.85}
              >
                <Ionicons name="time-outline" size={18} color={canSubmit ? colors.white : palette.text.tertiary} />
                <Text style={[styles.payBtnText, { color: canSubmit ? colors.white : palette.text.tertiary }]}>
                  Принять без оплаты
                </Text>
              </TouchableOpacity>
              {/* «Оплатить сразу» — авто-платёж на сумму накладной. */}
              <TouchableOpacity
                style={[
                  styles.payNowBtn,
                  canSubmit
                    ? { backgroundColor: colors.green[600], borderColor: colors.green[600] }
                    : { backgroundColor: 'transparent', borderColor: palette.border.subtle },
                ]}
                onPress={() => choosePayMode('paid')}
                disabled={!canSubmit}
                activeOpacity={0.85}
              >
                <Ionicons name="wallet-outline" size={18} color={canSubmit ? colors.white : palette.text.tertiary} />
                <Text style={[styles.payBtnText, { color: canSubmit ? colors.white : palette.text.tertiary }]}>
                  Оплатить сразу
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      ) : null}

      <ConfirmDialog
        visible={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={confirmReceive}
        title={pendingMode === 'paid' ? 'Оплатить и принять?' : 'Принять в долг?'}
        message={
          pendingMode === 'paid'
            ? `Поставка на ${formatMoney(invoiceTotal)} будет принята на склад, а платёж на эту сумму создастся автоматически.`
            : `Поставка на ${formatMoney(invoiceTotal)} будет принята на склад. Сумма добавится в долг поставщику.`
        }
        confirmText={pendingMode === 'paid' ? 'Оплатить сразу' : 'Принять в долг'}
        variant="primary"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: spacing[4], paddingTop: spacing[1] },
  sectionLabel: { marginLeft: spacing[1], marginTop: spacing[4], marginBottom: spacing[2] },

  // Hint
  hintCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    marginTop: spacing[2],
    padding: spacing[3.5],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  hintText: { flex: 1, fontSize: 13, lineHeight: 18 },

  // Items
  itemsCard: { borderRadius: borderRadius.xl, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  itemRow: { paddingHorizontal: spacing[3.5], paddingVertical: spacing[3], gap: spacing[2] },
  itemTop: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  checkboxBtn: { paddingVertical: 2 },
  itemName: { flex: 1, fontSize: 15, fontWeight: '600', letterSpacing: -0.1 },
  itemNameExcluded: { textDecorationLine: 'line-through', opacity: 0.5 },
  itemLineTotal: { fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] },
  itemMetaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5], flexWrap: 'wrap' },
  qtyBadge: { paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: borderRadius.sm },
  qtyBadgeText: { fontSize: 11, fontWeight: '600' },
  excludedHint: { fontSize: 12, fontStyle: 'italic' },
  itemsEmpty: { fontSize: 13, padding: spacing[4], textAlign: 'center' },

  controls: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
  },
  stepBtn: { paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
  stepInput: {
    minWidth: 44,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '700',
    paddingVertical: spacing[2],
    fontVariant: ['tabular-nums'],
  },
  priceWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
  },
  priceInput: { flex: 1, fontSize: 15, fontWeight: '600', paddingVertical: spacing[2] },
  priceCurrency: { fontSize: 13, fontWeight: '600' },

  terminalHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    marginTop: spacing[4],
  },
  terminalHintText: { fontSize: 13, fontWeight: '500' },

  // Bottom bar
  bottomBar: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing[2.5],
  },
  invoiceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  invoiceLabel: { fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  invoiceValue: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5, fontVariant: ['tabular-nums'] },
  debtBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3.5],
    borderRadius: borderRadius.xl,
  },
  payNowBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3.5],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  payBtnText: { fontSize: 16, fontWeight: '700', letterSpacing: -0.2 },
});
