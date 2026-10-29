import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/AppNavigator';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import IosScreenHeader from '../components/IosScreenHeader';
import { KeyboardAwareScroll } from '../components/KeyboardAware';
import DateTimePickerModal from '../components/DateTimePickerModal';
import { ProcurementRecoveryPanel } from '../components/ProcurementRecoveryPanel';
import { useProcurementRecovery } from '../hooks/useProcurementRecovery';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import { useTenantTimezone } from '../contexts/TenantTimezoneContext';
import { suppliersApi, warehousesApi } from '../api/services';
import { todaySupplyDate, toSupplyDateStr, formatSupplyDate, isFutureDay } from './purchaseOrders/purchaseOrderHelpers';
import { sumReceiptLineCents } from '../../../shared/utils/procurementInput';
import {
  purchaseOrderLineValue,
  parsePurchaseOrderCost,
  formatPurchaseOrderMoney,
  type PurchaseOrderLineValue,
} from '../../../shared/utils/purchaseOrderInput';
import {
  claimProductPickerSession,
  notifyProductPickerSession,
  releaseProductPickerSession,
  type ProductPickerBridge,
  type ProcurementPickerDrafts,
} from '../utils/productPickerSession';
import type { Product, PurchaseReceiptContext } from '../../../shared/types';
import type { CreateDeliveryRequest } from '../../../shared/api/types';
import { spacing, colors, borderRadius } from '../theme';

interface Line {
  productId: string;
  name: string;
  unit?: string;
  quantityText: string;
  priceText: string;
  sellPriceText: string;
}
/** Direct receipt uses the existing durable financial request, never stock-only updates. */
export default function DirectSupplyCreateScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'DirectSupplyCreate'>>();
  const { supplierId, supplierName } = route.params;
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('suppliers_manage');
  const palette = useColors();
  const timezone = useTenantTimezone();
  const queryClient = useQueryClient();
  const recovery = useProcurementRecovery({
    operation: 'delivery-create',
    sourceId: supplierId,
    contextId: supplierId,
  });
  const [date, setDate] = useState(() => todaySupplyDate(timezone));
  const [dateTouched, setDateTouched] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [comment, setComment] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const latest = useRef({ date, comment, lines });
  useEffect(() => {
    if (!dateTouched) {
      const today = todaySupplyDate(timezone);
      latest.current.date = today;
      setDate(today);
    }
  }, [timezone, dateTouched]);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const blocked = submitting || recovery.busy || recovery.loading || !!recovery.error || recovery.pending.length > 0;
  const editable = useRef({ blocked, canWrite, isCurrent: recovery.isCurrent });
  editable.current = { blocked, canWrite, isCurrent: recovery.isCurrent };
  const writeLines = useCallback((change: Line[] | ((previous: Line[]) => Line[])) => {
    const next = typeof change === 'function' ? change(latest.current.lines) : change;
    latest.current.lines = next;
    setLines(next);
  }, []);
  const updateLine = useCallback(
    (product: Product, value: PurchaseOrderLineValue) => {
      if (editable.current.blocked || !editable.current.canWrite || !editable.current.isCurrent())
        throw new Error('Сначала восстановите отправленную поставку.');
      writeLines((old) => {
        const existing = old.find((line) => line.productId === product.id);
        const line: Line = {
          productId: product.id,
          name: product.name,
          unit: product.unit,
          quantityText: String(value.quantity),
          priceText: String(value.costPrice),
          sellPriceText: existing?.sellPriceText ?? '',
        };
        return existing ? old.map((item) => (item.productId === product.id ? line : item)) : [...old, line];
      });
    },
    [writeLines],
  );
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => (await warehousesApi.list()).data,
  });
  const drafts = useRef<ProcurementPickerDrafts>({ active: null, entries: {} });
  const bridge: ProductPickerBridge = {
    productLines: lines.map((line) => ({
      productId: line.productId,
      quantity: purchaseOrderLineValue(line.quantityText, line.priceText)?.quantity ?? 0,
      sellPrice: parsePurchaseOrderCost(line.priceText) ?? 0,
    })),
    purchaseOrder: {
      context: 'delivery',
      drafts: drafts.current,
      lines: lines.map((line) => ({
        productId: line.productId,
        quantityText: line.quantityText,
        costPriceText: line.priceText,
        receivedQuantity: 0,
      })),
      updateLine,
    },
    addProduct: (product) => {
      const line = latest.current.lines.find((line) => line.productId === product.id);
      const value = line
        ? purchaseOrderLineValue(line.quantityText, line.priceText)
        : { quantity: 0, costPrice: product.costPrice };
      if (value) updateLine(product, { ...value, quantity: value.quantity + 1 });
    },
    decrementProduct: (id) => {
      if (editable.current.blocked) return;
      writeLines((old) =>
        old.flatMap((line) => {
          if (line.productId !== id) return [line];
          const value = purchaseOrderLineValue(line.quantityText, line.priceText);
          return value && value.quantity > 1
            ? [{ ...line, quantityText: String(Math.round((value.quantity - 1) * 1000) / 1000) }]
            : [];
        }),
      );
    },
    showCostPrice: true,
    priceKind: 'cost',
    title: 'Товары в поставку',
    totalLabel: 'В поставке',
    warrantyNames: new Set(),
    warehouseId,
    setWarehouseId,
    warehouses,
  };
  const bridgeRef = useRef(bridge);
  bridgeRef.current = bridge;
  useEffect(() => {
    notifyProductPickerSession(bridgeRef);
  }, [lines, warehouseId, warehouses]);
  useEffect(() => () => releaseProductPickerSession(bridgeRef), []);
  const openPicker = () => {
    if (blocked || !canWrite) return;
    claimProductPickerSession(bridgeRef);
    navigation.navigate('ProductPicker', {});
  };
  const dateKey = toSupplyDateStr(date);
  const ids = lines
    .map((line) => line.productId)
    .sort()
    .join(',');
  const context = useQuery<PurchaseReceiptContext[]>({
    queryKey: ['supplier-purchase-context', ids, dateKey],
    enabled: !!ids,
    queryFn: async () => {
      const productIds = ids.split(',');
      const result: PurchaseReceiptContext[] = [];
      for (let i = 0; i < productIds.length; i += 200)
        result.push(...(await suppliersApi.purchaseContext(productIds.slice(i, i + 200), dateKey)).data);
      return result;
    },
    staleTime: 0,
  });
  const total = lines.some((line) => !purchaseOrderLineValue(line.quantityText, line.priceText))
    ? null
    : sumReceiptLineCents(
        lines.map((line) => {
          const value = purchaseOrderLineValue(line.quantityText, line.priceText)!;
          return { quantity: value.quantity, unitPrice: value.costPrice };
        }),
      ) / 100;
  const invalidate = () => {
    for (const key of [
      ['supplier', supplierId],
      ['supplier-deliveries', supplierId],
      ['supplier-payments', supplierId],
      ['suppliers'],
      ['products'],
      ['all-products-check'],
      ['stock-movements'],
      ['journal-warehouse-docs'],
      ['low-stock'],
      ['warehouse-analytics'],
    ])
      void queryClient.invalidateQueries({ queryKey: key });
  };
  const recovered = () => {
    if (!recovery.isCurrent()) return;
    invalidate();
    Alert.alert('Поставка принята', 'Поставка восстановлена. Сумма добавлена в долг поставщику.');
    navigation.goBack();
  };
  const submit = async () => {
    if (submittingRef.current || blocked || !canWrite || !recovery.isCurrent()) return;
    const source = latest.current;
    if (isFutureDay(source.date, timezone)) {
      setError('Дата поставки не может быть в будущем.');
      return;
    }
    const items: CreateDeliveryRequest['items'] = [];
    for (const line of source.lines) {
      const value = purchaseOrderLineValue(line.quantityText, line.priceText);
      const retail = line.sellPriceText.trim() === '' ? undefined : parsePurchaseOrderCost(line.sellPriceText);
      if (!value || retail === null) {
        setError('Проверьте все позиции: количество от 0,001, цена от 0, не более двух знаков после запятой.');
        return;
      }
      items.push({
        productId: line.productId,
        quantity: value.quantity,
        price: value.costPrice,
        ...(retail !== undefined ? { sellPrice: retail } : {}),
      });
    }
    if (!items.length) {
      setError('Добавьте товары в поставку.');
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    setError('');
    try {
      const result = await recovery.execute<{ id: string }>(
        { operation: 'delivery-create', sourceId: supplierId, contextId: supplierId },
        { supplierId, date: toSupplyDateStr(source.date), comment: source.comment, items },
      );
      if (!recovery.owns(result)) return;
      invalidate();
      Alert.alert('Поставка принята', 'Сумма добавлена в долг поставщику. Оплата оформляется отдельным платежом.');
      navigation.goBack();
    } catch (cause) {
      if (!recovery.owns(cause)) return;
      setError(
        cause instanceof Error ? cause.message : 'Не удалось подтвердить поставку. Восстановите сохранённую отправку.',
      );
    } finally {
      submittingRef.current = false;
      if (recovery.isCurrent()) setSubmitting(false);
    }
  };
  if (!canWrite)
    return (
      <View style={styles.screen}>
        <Text>Нет доступа к оформлению поставки.</Text>
      </View>
    );
  return (
    <View style={[styles.screen, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Поставка без заказа" subtitle={supplierName} onBack={() => navigation.goBack()} />
      <KeyboardAwareScroll contentContainerStyle={styles.content}>
        <ProcurementRecoveryPanel recovery={recovery} onRecovered={recovered} />
        <Text style={{ color: palette.text.secondary }}>
          Остатки увеличатся после приёмки. Сумма поставки добавится в долг поставщику.
        </Text>
        <TouchableOpacity accessibilityRole="button" disabled={blocked} onPress={() => setDateOpen(true)}>
          <Text style={styles.link}>Дата поставки: {formatSupplyDate(date)}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Добавить товар"
          disabled={blocked}
          onPress={openPicker}
        >
          <Text style={styles.link}>Добавить товар</Text>
        </TouchableOpacity>
        {lines.map((line) => (
          <View key={line.productId} style={[styles.card, { backgroundColor: palette.bg.card }]}>
            <TouchableOpacity disabled={blocked} onPress={openPicker}>
              <Text style={{ color: palette.text.primary, fontWeight: '600' }}>{line.name}</Text>
            </TouchableOpacity>
            <View style={styles.fields}>
              {(['quantityText', 'priceText'] as const).map((key) => (
                <View key={key} style={{ flex: 1 }}>
                  <Text style={{ color: palette.text.secondary }}>
                    {key === 'quantityText' ? 'Количество' : 'Цена закупки, ₽'}
                  </Text>
                  <TextInput
                    accessibilityLabel={`${key === 'quantityText' ? 'Количество' : 'Цена закупки'} — ${line.name}`}
                    editable={!blocked}
                    value={line[key]}
                    keyboardType="decimal-pad"
                    style={[styles.input, { color: palette.text.primary, borderColor: palette.border.subtle }]}
                    onChangeText={(text) =>
                      writeLines((old) =>
                        old.map((item) => (item.productId === line.productId ? { ...item, [key]: text } : item)),
                      )
                    }
                  />
                </View>
              ))}
            </View>
            <Text style={{ color: palette.text.secondary }}>Розничная цена: пусто — сохранить текущую</Text>
            <TextInput
              accessibilityLabel={`Розничная цена — ${line.name}`}
              editable={!blocked}
              value={line.sellPriceText}
              keyboardType="decimal-pad"
              style={[styles.input, { color: palette.text.primary, borderColor: palette.border.subtle }]}
              onChangeText={(text) =>
                writeLines((old) =>
                  old.map((item) => (item.productId === line.productId ? { ...item, sellPriceText: text } : item)),
                )
              }
            />
            <Text style={{ color: palette.text.secondary }}>
              {context.isError
                ? 'История закупок недоступна'
                : context.data?.find((item) => item.productId === line.productId)?.previousPurchase
                  ? `Предыдущая закупка: ${formatPurchaseOrderMoney(context.data.find((item) => item.productId === line.productId)!.previousPurchase!.price)}`
                  : 'До этой даты закупок нет'}
            </Text>
            <TouchableOpacity
              disabled={blocked}
              accessibilityLabel={`Убрать ${line.name}`}
              onPress={() => writeLines((old) => old.filter((item) => item.productId !== line.productId))}
            >
              <Text style={styles.link}>Убрать</Text>
            </TouchableOpacity>
          </View>
        ))}
        {context.isError && (
          <TouchableOpacity onPress={() => void context.refetch()}>
            <Text style={styles.link}>Повторить загрузку истории</Text>
          </TouchableOpacity>
        )}
        <Text style={{ color: palette.text.secondary }}>Комментарий</Text>
        <TextInput
          accessibilityLabel="Комментарий к поставке"
          editable={!blocked}
          value={comment}
          onChangeText={(text) => {
            latest.current.comment = text;
            setComment(text);
          }}
          style={[styles.input, { color: palette.text.primary, borderColor: palette.border.subtle }]}
        />
        <Text style={{ color: palette.text.primary, fontSize: 18, fontWeight: '600' }}>
          К оплате поставщику: {total === null ? '—' : formatPurchaseOrderMoney(total)}
        </Text>
        {!!error && (
          <Text accessibilityRole="alert" style={{ color: colors.red[600] }}>
            {error}
          </Text>
        )}
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel="Принять поставку без оплаты"
          disabled={blocked}
          onPress={() => void submit()}
          style={[styles.submit, blocked && { opacity: 0.5 }]}
        >
          <Text style={{ color: colors.white, fontWeight: '600' }}>
            {submitting ? 'Сохранение…' : 'Принять поставку без оплаты'}
          </Text>
        </TouchableOpacity>
      </KeyboardAwareScroll>
      <DateTimePickerModal
        visible={dateOpen}
        value={date}
        mode="date"
        onConfirm={(value) => {
          setDateTouched(true);
          latest.current.date = value;
          setDate(value);
          setDateOpen(false);
        }}
        onCancel={() => setDateOpen(false)}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[16] },
  card: { padding: spacing[3], gap: spacing[2], borderRadius: borderRadius.lg },
  fields: { flexDirection: 'row', gap: spacing[3] },
  input: {
    minHeight: 44,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing[2],
    fontSize: 16,
  },
  link: { color: colors.primary[600], paddingVertical: spacing[2], fontWeight: '600' },
  submit: {
    padding: spacing[4],
    alignItems: 'center',
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primary[600],
  },
});
