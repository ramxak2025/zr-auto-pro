import { colors } from '../theme';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Image, Modal as NativeModal, Pressable, TextInput, View, StyleSheet } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TabBarScrollView as ScrollView } from '../components/TabBarScrollable';
import type { RootStackParamList } from '../navigation/AppNavigator';
import type { ConfirmSupplierInvoice, SupplierInvoiceDocument } from '../../../shared/api/supplierInvoices';
import type { Product, PurchaseOrder } from '../../../shared/types';
import { loadProductCatalog } from '../../../shared/api/productCatalog';
import {
  manualInvoicePayload,
  type ManualInvoiceDraft,
  invoiceReviewWarnings,
  invoiceReceiptPayload,
  invoiceRowDrafts,
  invoiceUnitMismatch,
  invoiceWarningLabel,
  isReceivableProduct,
  type InvoiceRowDrafts,
} from '../../../shared/utils/supplierInvoiceReview';
import { formatDayKey, formatMoney } from '../../../shared/utils/formatters';
import { supplierInvoicesApi, productsApi, warehousesApi, purchaseOrdersApi } from '../api/services';
import { captureAuthSession, getImageUrl } from '../api/axios';
import { captureDataSession } from '../contexts/dataSession';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import { useTenantTimezone } from '../contexts/TenantTimezoneContext';
import { unitLabel } from '../utils/units';
import { extractApiErrorMessage } from '../utils/apiError';
import { toSupplyDateStr } from './purchaseOrders/purchaseOrderHelpers';
import {
  claimProductPickerSession,
  releaseProductPickerSession,
  type ProductPickerBridge,
} from '../utils/productPickerSession';
import IosScreenHeader from '../components/IosScreenHeader';
import { KeyboardAwareScroll } from '../components/KeyboardAware';
import { BottomSheet } from '../components/BottomSheet';
import DateTimePickerModal from '../components/DateTimePickerModal';
import ConfirmDialog from '../components/ConfirmDialog';
import { Button } from '../components/Button';
import { Text } from '../platform/Typography';

export default function SupplierInvoiceScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'SupplierInvoiceReview'>>();
  const { supplierId, supplierName } = route.params;
  const { hasPermission } = useAuth();
  const palette = useColors(),
    timezone = useTenantTimezone();
  const today = formatDayKey(new Date(), timezone);
  const owner = captureDataSession();
  const storageKey = `autexa.invoice-review.v1:${owner.key}:${supplierId}`;
  const queryClient = useQueryClient();
  const [document, setDocument] = useState<SupplierInvoiceDocument | null>(null);
  const [rows, setRows] = useState<InvoiceRowDrafts>({});
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const [date, setDate] = useState(''),
    [receivedAt, setReceivedAt] = useState('');
  const [requestId, setRequestId] = useState(() => randomUUID());
  const [pending, setPending] = useState<ConfirmSupplierInvoice | null>(null);
  const [busy, setBusy] = useState(''),
    [error, setError] = useState('');
  const [restoredKey, setRestoredKey] = useState<string | null>(null),
    [confirmOpen, setConfirmOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false),
    [orderLine, setOrderLine] = useState<string | null>(null);
  const [datePicker, setDatePicker] = useState<'document' | 'receipt' | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [manual, setManual] = useState<ManualInvoiceDraft | null>(null),
    [excludedOpen, setExcludedOpen] = useState(false);
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const busyRef = useRef(false),
    sequence = useRef(0),
    mounted = useRef(true),
    dateTouched = useRef(false),
    submitted = useRef(false);
  const documentRef = useRef(document);
  documentRef.current = document;
  const mappingLine = useRef<{ lineId?: string; manual?: boolean } | null>(null);
  const { data: products = [], isPending: productsLoading } = useQuery({
    queryKey: ['products', 'invoice-review', supplierId],
    queryFn: () => loadProductCatalog(productsApi.getAll),
    staleTime: 0,
  });
  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => (await warehousesApi.list()).data,
  });
  const { data: orders = [] } = useQuery<PurchaseOrder[]>({
    queryKey: ['purchase-orders', 'invoice-review', supplierId],
    queryFn: async () => (await purchaseOrdersApi.list({ supplierId, status: 'ordered' })).data.data,
  });
  const apply = (next: SupplierInvoiceDocument) => {
    documentRef.current = next;
    setDocument(next);
    setManual((current) =>
      current?.pending && next.lines.some((line) => line.manualRequestId === current.requestId) ? null : current,
    );
    setRows((previous) => invoiceRowDrafts(next, previous));
    if (next.status === 'review' && !dateTouched.current) setDate(next.date?.slice(0, 10) ?? '');
  };
  const run = async (label: string, action: (current: () => boolean) => Promise<void>) => {
    if (busyRef.current || !owner.key || !owner.isCurrent() || !mounted.current) return;
    const lease = owner,
      attempt = ++sequence.current;
    const current = () => mounted.current && lease.isCurrent() && attempt === sequence.current;
    busyRef.current = true;
    setBusy(label);
    setError('');
    try {
      await action(current);
    } catch (cause) {
      if (current())
        setError(
          extractApiErrorMessage(
            cause,
            cause instanceof Error ? cause.message : 'Не удалось выполнить действие. Повторите попытку.',
          ),
        );
    } finally {
      if (mounted.current && attempt === sequence.current) {
        busyRef.current = false;
        setBusy('');
      }
    }
  };
  useEffect(() => {
    const lease = owner;
    if (!lease.key || !lease.isCurrent()) return;
    mounted.current = true;
    setDocument(null);
    setManual(null);
    setRows({});
    setPending(null);
    setDate('');
    setReceivedAt('');
    submitted.current = false;
    dateTouched.current = false;
    mappingLine.current = null;
    setPreview(null);
    void AsyncStorage.getItem(storageKey)
      .then(async (raw) => {
        if (!lease.isCurrent() || !mounted.current) return;
        const saved = raw
          ? (JSON.parse(raw) as {
              documentId?: string;
              rows?: InvoiceRowDrafts;
              date?: string;
              receivedAt?: string;
              requestId?: string;
              pending?: ConfirmSupplierInvoice;
              manual?: ManualInvoiceDraft;
              submitted?: boolean;
            })
          : {};
        if (saved.rows) setRows(saved.rows);
        if (saved.date) {
          dateTouched.current = true;
          setDate(saved.date);
        }
        if (saved.receivedAt) setReceivedAt(saved.receivedAt);
        if (saved.requestId) setRequestId(saved.requestId);
        if (saved.pending) setPending(saved.pending);
        if (saved.manual) setManual(saved.manual);
        submitted.current = !!saved.submitted;
        if (saved.documentId)
          await run('Восстанавливаем накладную…', async (current) => {
            const result = await supplierInvoicesApi.get(saved.documentId!);
            if (current()) apply(result.data);
          });
      })
      .catch(() => {
        if (lease.isCurrent() && mounted.current)
          setError('Не удалось восстановить черновик. Проверьте соединение и вернитесь к накладной.');
      })
      .finally(() => {
        if (lease.isCurrent() && mounted.current) setRestoredKey(storageKey);
      });
    return () => {
      mounted.current = false;
      sequence.current++;
      busyRef.current = false;
      releaseProductPickerSession(bridgeRef);
    };
  }, [storageKey]);
  useEffect(() => {
    const lease = captureDataSession();
    if (!document || restoredKey !== storageKey || !lease.key || !lease.isCurrent()) return;
    void AsyncStorage.setItem(
      storageKey,
      JSON.stringify({
        documentId: document.id,
        rows,
        date,
        receivedAt,
        requestId,
        pending,
        manual,
        submitted: submitted.current,
      }),
    ).catch(() => {
      if (lease.isCurrent()) setError('Черновик не сохранён на устройстве. Не закрывайте форму до завершения приёмки.');
    });
  }, [storageKey, document, rows, date, receivedAt, requestId, pending, restoredKey, manual]);
  useEffect(() => {
    if (document?.status !== 'processing') return;
    const timer = setInterval(() => {
      if (!busyRef.current)
        void run('Проверяем результат…', async (current) => {
          const result = await supplierInvoicesApi.get(document.id);
          if (current()) apply(result.data);
        });
    }, 2500);
    return () => clearInterval(timer);
  }, [document?.id, document?.status]);
  const map = (lineId: string, product: Product, remember: boolean) =>
    void run('Сопоставляем товар…', async (current) => {
      const doc = documentRef.current;
      if (!doc) return;
      if (!isReceivableProduct(product, warehouses)) throw new Error('Выберите обычный товар для приёмки.');
      const result = await supplierInvoicesApi.mapLine(doc.id, lineId, {
        expectedVersion: doc.version,
        productId: product.id,
        remember,
      });
      if (current()) {
        apply(result.data);
        setRows((previous) => ({ ...previous, [lineId]: { ...previous[lineId], unitAcknowledged: false } }));
        if (remember) Alert.alert('Соответствие сохранено', 'Название запомнено только для этого поставщика.');
      }
    });
  const bridge: ProductPickerBridge = {
    productLines: [],
    title: 'Товар в накладной',
    closeOnSelect: true,
    addProduct: (product) => {
      const target = mappingLine.current;
      if (!target || !owner.isCurrent()) return;
      mappingLine.current = null;
      if (target.manual)
        setManual({
          productId: product.id,
          name: product.name,
          unit: unitLabel(product.unit),
          quantity: '',
          price: '',
          requestId: randomUUID(),
        });
      else if (target.lineId) map(target.lineId, product, false);
    },
    decrementProduct: () => undefined,
    showCostPrice: hasPermission('warehouse_manage'),
    priceKind: 'cost',
    warrantyNames: new Set(),
    warehouseId,
    setWarehouseId,
    warehouses: warehouses.filter((warehouse) => warehouse.kind !== 'used'),
    filterProduct: (product) => isReceivableProduct(product, warehouses),
  };
  const bridgeRef = useRef(bridge);
  bridgeRef.current = bridge;
  const pickProduct = (lineId: string) => {
    if (busyRef.current || pending || !owner.isCurrent()) return;
    mappingLine.current = { lineId };
    claimProductPickerSession(bridgeRef);
    navigation.navigate('ProductPicker', {});
  };
  const pickPages = (source: 'camera' | 'gallery') =>
    void run('Добавляем страницы…', async (current) => {
      if ((document?.pages.length ?? 0) >= 8) throw new Error('В одной накладной может быть до 8 страниц.');
      if (source === 'camera') {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!current()) return;
        if (!permission.granted)
          throw new Error('Разрешите доступ к камере в настройках телефона или выберите фото из галереи.');
      }
      const result =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, allowsEditing: false })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ['images'],
              quality: 1,
              allowsMultipleSelection: true,
              selectionLimit: 8 - (document?.pages.length ?? 0),
            });
      if (!current() || result.canceled) return;
      if (
        result.assets.length + (document?.pages.length ?? 0) > 8 ||
        result.assets.some((asset) => (asset.fileSize ?? 0) > 10 * 1024 * 1024)
      )
        throw new Error('Добавьте до 8 страниц, каждая до 10 МБ.');
      let next = documentRef.current;
      if (!next) {
        next = (await supplierInvoicesApi.prepare(supplierId)).data;
        if (!current()) return;
        apply(next);
      }
      for (const asset of result.assets) {
        if (!current()) return;
        const body = new FormData();
        // React Native multipart uses URI descriptors; DOM FormData types expose Blob.
        body.append('file', {
          uri: asset.uri,
          name: asset.fileName || 'invoice.jpg',
          type: asset.mimeType || 'image/jpeg',
        } as unknown as Blob);
        next = (await supplierInvoicesApi.uploadPage(next.id, body)).data;
        if (current()) apply(next);
      }
    });
  const openConfirmation = () => {
    try {
      if (!document) return;
      if (manual) throw new Error('Завершите добавление товара или отмените новую строку.');
      const body =
        pending ??
        invoiceReceiptPayload(document, rowsRef.current, {
          date,
          receivedAt: receivedAt || undefined,
          today,
          requestId,
          products,
          warehouses,
          unitLabel,
        });
      setPending(body);
      setConfirmOpen(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Проверьте строки.');
    }
  };
  const received = async (id: string) => {
    await AsyncStorage.removeItem(storageKey);
    for (const prefix of [
      'supplier',
      'supplier-deliveries',
      'supplier-payments',
      'suppliers',
      'products',
      'all-products-check',
      'purchase-orders',
      'stock-movements',
    ])
      void queryClient.invalidateQueries({ queryKey: [prefix] });
    navigation.replace('SupplierDetail', { id: supplierId, openDeliveryId: id });
  };
  const confirm = () => {
    submitted.current = true;
    void run('Принимаем накладную…', async (current) => {
      if (!document || !pending) return;
      await AsyncStorage.setItem(
        storageKey,
        JSON.stringify({ documentId: document.id, rows, date, receivedAt, requestId, pending, submitted: true }),
      );
      if (!current()) return;
      try {
        const result = await supplierInvoicesApi.confirm(document.id, pending);
        if (current()) await received(result.data.id);
      } catch (cause) {
        if (!current()) return;
        const latest = await supplierInvoicesApi.get(document.id);
        if (!current()) return;
        apply(latest.data);
        if (latest.data.deliveryId) {
          await received(latest.data.deliveryId);
          return;
        }
        const status = (cause as { response?: { status?: number } })?.response?.status;
        if (status === 400 || status === 409) {
          submitted.current = false;
          setPending(null);
          setConfirmOpen(false);
          setRequestId(randomUUID());
        }
        throw cause;
      }
    });
  };
  const reviewLine = (lineId: string, excluded: boolean) =>
    void run('Обновляем строку…', async (current) => {
      if (!document) return;
      const result = await supplierInvoicesApi.reviewLine(document.id, lineId, {
        expectedVersion: document.version,
        excluded,
      });
      if (current()) apply(result.data);
    });
  const addManual = () =>
    void run('Добавляем товар…', async (current) => {
      if (!document || !manual) return;
      const body = manualInvoicePayload(document, manual),
        frozen = { ...manual, pending: body };
      setManual(frozen);
      await AsyncStorage.setItem(
        storageKey,
        JSON.stringify({
          documentId: document.id,
          rows,
          date,
          receivedAt,
          requestId,
          pending,
          submitted: submitted.current,
          manual: frozen,
        }),
      );
      if (!current()) return;
      try {
        const result = await supplierInvoicesApi.addManualLine(document.id, body);
        if (current()) {
          apply(result.data);
          setManual(null);
        }
      } catch (cause) {
        if (!current()) return;
        const response = (cause as { response?: { status?: number; data?: { code?: string } } }).response;
        if (
          response?.status === 400 ||
          (response?.status === 409 && response.data?.code !== 'INVOICE_MANUAL_REQUEST_CONFLICT')
        )
          setManual({ ...manual, pending: undefined, requestId: randomUUID() });
        throw cause;
      }
    });
  const editable = !busy && !pending && !manual?.pending && document?.status === 'review';
  const activeLines = document?.lines.filter((line) => !line.excluded) ?? [];
  const excludedLines = document?.lines.filter((line) => line.excluded) ?? [];
  const unitRows =
    activeLines.filter((line) => {
      const product = products.find((item) => item.id === line.productId && isReceivableProduct(item, warehouses));
      return product && invoiceUnitMismatch(line, product, unitLabel);
    }) ?? [];
  const acknowledgeUnits = () =>
    setRows((previous) => {
      const checked = !unitRows.every((line) => previous[line.id]?.unitAcknowledged);
      return Object.fromEntries(
        Object.entries(previous).map(([id, row]) => [
          id,
          unitRows.some((line) => line.id === id) ? { ...row, unitAcknowledged: checked } : row,
        ]),
      );
    });
  const update = (id: string, patch: Partial<InvoiceRowDrafts[string]>) => {
    const next = { ...rowsRef.current, [id]: { ...rowsRef.current[id], ...patch } };
    rowsRef.current = next;
    setRows(next);
  };
  const auth = captureAuthSession();
  const imageSource = (url: string) =>
    auth.token && /^\/api\/supplier-invoices\/[a-f0-9-]+\/pages\/[a-f0-9-]+$/i.test(url)
      ? { uri: getImageUrl(url), headers: { Authorization: `Bearer ${auth.token}` }, cache: 'reload' as const }
      : undefined;
  return (
    <View style={[styles.screen, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Проверка накладной" subtitle={supplierName} onBack={() => navigation.goBack()} />
      {!owner.key && (
        <Text style={{ padding: 16 }} color={palette.text.secondary}>
          Подготавливаем аккаунт…
        </Text>
      )}
      {restoredKey === storageKey && (
        <KeyboardAwareScroll contentContainerStyle={styles.content}>
          <Text color={palette.text.secondary}>
            Фото и строки — черновик. Остатки и долг изменятся только после подтверждения.
          </Text>
          {busy ? (
            <Text accessibilityRole="alert" color={palette.accent.primaryText}>
              {busy}
            </Text>
          ) : null}
          {error ? (
            <Text accessibilityRole="alert" color={palette.mode === 'dark' ? colors.red[400] : colors.red[700]}>
              {error}
            </Text>
          ) : null}
          <View style={styles.row}>
            <Button
              title="Сфотографировать"
              variant="secondary"
              fullWidth={false}
              disabled={!!busy || !!pending || !!manual?.pending || document?.status === 'processing'}
              onPress={() => pickPages('camera')}
            />
            <Button
              title="Из галереи"
              variant="secondary"
              fullWidth={false}
              disabled={!!busy || !!pending || !!manual?.pending || document?.status === 'processing'}
              onPress={() => pickPages('gallery')}
            />
          </View>
          <Text color={palette.text.secondary}>Страниц: {document?.pages.length ?? 0}/8</Text>
          <ScrollView horizontal reserveBottomNavigation={false} contentContainerStyle={{ gap: 8 }}>
            {document?.pages.map((page) => (
              <View key={page.id}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Открыть страницу ${page.index + 1}`}
                  onPress={() => setPreview(page.url)}
                >
                  <Image
                    source={imageSource(page.url)}
                    style={{ width: 90, height: 120, borderRadius: 10 }}
                    resizeMode="contain"
                  />
                </Pressable>
                {(document.status === 'draft' || document.status === 'error') && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Удалить страницу ${page.index + 1}`}
                    disabled={!!busy || !!pending || !!manual?.pending}
                    onPress={() =>
                      Alert.alert(
                        'Удалить страницу?',
                        'Остальные страницы сохранятся. Перед приёмкой потребуется проверить строки заново.',
                        [
                          { text: 'Отмена', style: 'cancel' },
                          {
                            text: 'Удалить',
                            style: 'destructive',
                            onPress: () =>
                              void run('Удаляем страницу…', async (current) => {
                                const result = await supplierInvoicesApi.deletePage(
                                  document.id,
                                  page.id,
                                  document.version,
                                );
                                if (current()) apply(result.data);
                              }),
                          },
                        ],
                      )
                    }
                    style={styles.row}
                  >
                    <Ionicons name="trash-outline" size={16} color={palette.text.secondary} />
                    <Text color={palette.text.secondary} style={styles.small}>
                      Удалить
                    </Text>
                  </Pressable>
                )}
              </View>
            ))}
          </ScrollView>
          {document?.pages.length ? (
            <Button
              title={document.status === 'error' ? 'Повторить распознавание' : 'Распознать накладную'}
              disabled={
                !!busy ||
                !!pending ||
                !!manual?.pending ||
                document.status === 'processing' ||
                document.status === 'confirmed'
              }
              onPress={() =>
                void run('Распознаём накладную…', async (current) => {
                  apply({ ...document, status: 'processing' });
                  const result = await supplierInvoicesApi.extract(document.id, document.version);
                  if (current()) apply(result.data);
                })
              }
            />
          ) : null}
          {document && (
            <Button
              title="Обновить статус"
              variant="ghost"
              disabled={!!busy}
              onPress={() =>
                void run('Проверяем результат…', async (current) => {
                  const result = await supplierInvoicesApi.get(document.id);
                  if (current()) apply(result.data);
                })
              }
            />
          )}
          {document?.status === 'processing' ? (
            <Text color={palette.text.secondary}>
              Обработка продолжается. Можно закрыть экран и вернуться к черновику.
            </Text>
          ) : null}
          {document?.status === 'error' ? (
            <Text accessibilityRole="alert" color={palette.text.secondary}>
              Не удалось распознать документ. Фото сохранены: повторите попытку или добавьте товары вручную ниже.
            </Text>
          ) : null}
          {document?.status === 'duplicate' ? (
            <>
              <Text color={palette.text.secondary}>Такая накладная уже загружена.</Text>
              {document.duplicateOf && (
                <Button
                  title="Открыть исходную"
                  variant="secondary"
                  onPress={() =>
                    void run('Открываем накладную…', async (current) => {
                      const result = await supplierInvoicesApi.get(document.duplicateOf!);
                      if (current()) apply(result.data);
                    })
                  }
                />
              )}
            </>
          ) : null}
          {document?.deliveryId ? (
            <Button title="Открыть поставку" onPress={() => void received(document.deliveryId!)} />
          ) : null}
          {document && !['processing', 'confirmed', 'duplicate'].includes(document.status) ? (
            <Button
              title="Добавить товар вручную"
              variant="secondary"
              disabled={!!busy || !!pending || !!manual?.pending || !!manual}
              onPress={() => {
                mappingLine.current = { manual: true };
                claimProductPickerSession(bridgeRef);
                navigation.navigate('ProductPicker', {});
              }}
            />
          ) : null}
          {manual ? (
            <View style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
              <Text color={palette.text.primary} style={styles.name}>
                Добавить вручную: {manual.name}
              </Text>
              <Text color={palette.text.secondary} style={styles.small}>
                Ручная строка без обучения названия поставщика.
              </Text>
              <Text color={palette.text.secondary}>Количество, {manual.unit}</Text>
              <TextInput
                accessibilityLabel="Количество добавляемого товара"
                keyboardType="decimal-pad"
                editable={!busy && !manual.pending}
                value={manual.quantity}
                onChangeText={(value) => setManual({ ...manual, quantity: value })}
                style={[styles.input, { color: palette.text.primary, borderColor: palette.border.subtle }]}
              />
              <Text color={palette.text.secondary}>Закупочная цена за единицу, ₽</Text>
              <TextInput
                accessibilityLabel="Цена добавляемого товара"
                keyboardType="decimal-pad"
                editable={!busy && !manual.pending}
                value={manual.price}
                onChangeText={(value) => setManual({ ...manual, price: value })}
                style={[styles.input, { color: palette.text.primary, borderColor: palette.border.subtle }]}
              />
              <Button
                title={manual.pending ? 'Повторить добавление' : 'Добавить строку'}
                disabled={!!busy}
                onPress={addManual}
              />
              {!manual.pending && (
                <Button title="Не добавлять" variant="ghost" disabled={!!busy} onPress={() => setManual(null)} />
              )}
            </View>
          ) : null}
          {document?.status === 'review' ? (
            <>
              <Button
                title={`Дата документа: ${date || 'указать'}`}
                variant="secondary"
                disabled={!editable}
                onPress={() => setDatePicker('document')}
              />
              <Button
                title={
                  document.orderId
                    ? `Заказ от ${orders.find((order) => order.id === document.orderId)?.createdAt.slice(0, 10) ?? '—'}`
                    : 'Без привязки к заказу'
                }
                variant="secondary"
                disabled={!editable}
                onPress={() => setOrderOpen(true)}
              />
              <Button
                title={`Приход на склад: ${receivedAt || 'сегодня'}`}
                variant="ghost"
                disabled={!editable}
                onPress={() => setDatePicker('receipt')}
              />
              {receivedAt && editable ? (
                <Button title="Принять сегодняшней датой" variant="ghost" onPress={() => setReceivedAt('')} />
              ) : null}
              <Text color={palette.text.secondary}>Дата документа сама не переносит остатки в прошлое.</Text>
              {document.comparison?.missingOrderItemIds.length ? (
                <Text color={palette.text.secondary}>
                  В накладной нет {document.comparison.missingOrderItemIds.length} позиций заказа. Они останутся
                  непринятыми.
                </Text>
              ) : null}
              {document.warnings.map((warning) => (
                <Text key={warning} color={palette.text.secondary} style={styles.small}>
                  {invoiceWarningLabel(warning)}
                </Text>
              ))}
              <Text color={palette.text.secondary} style={styles.small}>
                Новая розница: пусто — сохранить текущую, 0 — установить ноль.
              </Text>
              {!!unitRows.length && (
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityLabel="Количество и цены проверены в единицах склада"
                  accessibilityState={{ checked: unitRows.every((line) => rows[line.id]?.unitAcknowledged) }}
                  disabled={!editable}
                  onPress={acknowledgeUnits}
                  style={styles.row}
                >
                  <Ionicons
                    name={unitRows.every((line) => rows[line.id]?.unitAcknowledged) ? 'checkbox' : 'square-outline'}
                    size={22}
                    color={palette.accent.primaryText}
                  />
                  <Text style={{ flex: 1 }} color={palette.text.secondary}>
                    Количество и цены проверены в единицах склада
                  </Text>
                </Pressable>
              )}
              {!!excludedLines.length && (
                <>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Исключённые строки"
                    onPress={() => setExcludedOpen((value) => !value)}
                    style={styles.row}
                  >
                    <Ionicons
                      name={excludedOpen ? 'chevron-up' : 'chevron-down'}
                      size={18}
                      color={palette.text.secondary}
                    />
                    <Text color={palette.text.secondary}>Исключённые строки · {excludedLines.length}</Text>
                  </Pressable>
                  {excludedOpen &&
                    excludedLines.map((line) => (
                      <View key={line.id} style={styles.row}>
                        <Text style={{ flex: 1 }} color={palette.text.secondary}>
                          {line.name}
                        </Text>
                        <Button
                          title="Вернуть строку"
                          variant="ghost"
                          fullWidth={false}
                          disabled={!editable}
                          onPress={() => reviewLine(line.id, false)}
                        />
                      </View>
                    ))}
                </>
              )}
              {activeLines.map((line) => {
                const product = products.find(
                  (item) => item.id === line.productId && isReceivableProduct(item, warehouses),
                );
                const draft = rows[line.id];
                const mismatch = !!product && invoiceUnitMismatch(line, product, unitLabel);
                const warnings = invoiceReviewWarnings(document, line, draft);
                const paper =
                  line.origin !== 'manual' && typeof line.sourcePageIndex === 'number'
                    ? document.pages.find((page) => page.index === line.sourcePageIndex)
                    : undefined;
                return (
                  <View
                    key={line.id}
                    style={[
                      styles.card,
                      {
                        backgroundColor: palette.bg.card,
                        borderColor:
                          !product || warnings.length || mismatch
                            ? palette.mode === 'dark'
                              ? colors.amber[200]
                              : colors.amber[600]
                            : palette.border.subtle,
                      },
                    ]}
                  >
                    <Text color={palette.text.primary} style={styles.name}>
                      {line.name || 'Название не распознано'}
                    </Text>
                    <Text color={palette.text.secondary} style={styles.small}>
                      {line.origin === 'manual' ? 'Ручная строка:' : 'В накладной:'} {line.sku || 'без артикула'} ·{' '}
                      {line.unit || 'единица не распознана'}
                    </Text>
                    {!product || warnings.length || mismatch ? (
                      <View style={styles.row}>
                        <Ionicons
                          name="warning-outline"
                          size={18}
                          color={palette.mode === 'dark' ? colors.amber[200] : colors.amber[700]}
                        />
                        <Text color={palette.text.secondary}>Проверьте строку</Text>
                      </View>
                    ) : null}
                    <Button
                      title={product?.name || 'Выбрать товар из каталога'}
                      variant="secondary"
                      disabled={!editable || productsLoading}
                      onPress={() => pickProduct(line.id)}
                    />
                    {!product &&
                    line.suggestedProductId &&
                    products.find(
                      (item) => item.id === line.suggestedProductId && isReceivableProduct(item, warehouses),
                    ) ? (
                      <Button
                        title={`Подтвердить: ${products.find((item) => item.id === line.suggestedProductId)!.name}`}
                        variant="ghost"
                        disabled={!editable}
                        onPress={() =>
                          map(line.id, products.find((item) => item.id === line.suggestedProductId)!, false)
                        }
                      />
                    ) : null}
                    {product && line.origin !== 'manual' && (
                      <Button
                        title="Запомнить название у поставщика"
                        variant="ghost"
                        disabled={!editable}
                        onPress={() => map(line.id, product, true)}
                      />
                    )}
                    <Button
                      title="Исключить строку"
                      variant="ghost"
                      disabled={!editable}
                      onPress={() => reviewLine(line.id, true)}
                    />
                    {paper ? (
                      <Button
                        title={`Открыть страницу ${paper.index + 1}`}
                        variant="ghost"
                        onPress={() => setPreview(paper.url)}
                      />
                    ) : null}
                    {line.origin === 'manual' ? (
                      <Text color={palette.accent.primaryText} style={styles.small}>
                        Добавлено вручную
                      </Text>
                    ) : null}
                    <Text color={palette.text.secondary}>
                      Количество, {product ? unitLabel(line.productUnit ?? product.unit) : line.unit || 'ед.'}
                    </Text>
                    <TextInput
                      accessibilityLabel={`Количество — ${line.name}`}
                      keyboardType="decimal-pad"
                      value={draft?.quantity ?? ''}
                      editable={!!editable}
                      onChangeText={(value) => update(line.id, { quantity: value })}
                      style={[styles.input, { color: palette.text.primary, borderColor: palette.border.subtle }]}
                    />
                    <Text color={palette.text.secondary}>Закупочная цена за единицу, ₽</Text>
                    <TextInput
                      accessibilityLabel={`Закупочная цена — ${line.name}`}
                      keyboardType="decimal-pad"
                      value={draft?.price ?? ''}
                      editable={!!editable}
                      onChangeText={(value) => update(line.id, { price: value })}
                      style={[styles.input, { color: palette.text.primary, borderColor: palette.border.subtle }]}
                    />
                    <Text color={palette.text.secondary}>
                      Новая розница, ₽{product ? ` · текущая ${formatMoney(product.sellPrice, 2)}` : ''}
                    </Text>
                    <TextInput
                      accessibilityLabel={`Новая розничная цена — ${line.name}`}
                      keyboardType="decimal-pad"
                      value={draft?.sellPrice ?? ''}
                      editable={!!editable}
                      onChangeText={(value) => update(line.id, { sellPrice: value })}
                      style={[styles.input, { color: palette.text.primary, borderColor: palette.border.subtle }]}
                    />
                    {document.orderId && product && (
                      <Button
                        title={
                          document.comparison?.items.find((item) => item.orderItemId === draft?.orderItemId)?.name ||
                          'Позиция заказа · выбрать'
                        }
                        variant="ghost"
                        disabled={!editable}
                        onPress={() => setOrderLine(line.id)}
                      />
                    )}
                    {warnings.map((warning) => (
                      <Text key={warning} color={palette.text.secondary} style={styles.small}>
                        {invoiceWarningLabel(warning)}
                      </Text>
                    ))}
                    {mismatch && (
                      <Text color={palette.text.secondary}>
                        В накладной: {line.unit || '—'} · На складе: {unitLabel(line.productUnit ?? product?.unit)} —
                        проверьте количество
                      </Text>
                    )}
                  </View>
                );
              })}
              <Button
                title={pending ? 'Повторить приёмку' : 'Проверить и принять'}
                disabled={!!busy || !!manual || !hasPermission('suppliers_manage')}
                loading={busy === 'Принимаем накладную…'}
                onPress={openConfirmation}
              />
            </>
          ) : null}
        </KeyboardAwareScroll>
      )}
      <BottomSheet
        visible={restoredKey === storageKey && (orderOpen || !!orderLine)}
        onClose={() => {
          setOrderOpen(false);
          setOrderLine(null);
        }}
        title={orderLine ? 'Позиция заказа' : 'Заказ поставщику'}
      >
        <View style={styles.content}>
          {orderLine ? (
            document?.comparison?.items
              .filter((item) => item.productId === document.lines.find((line) => line.id === orderLine)?.productId)
              .map((item) => (
                <Button
                  key={item.orderItemId}
                  title={`${item.name} · остаток ${item.outstandingQuantity} · ${formatMoney(item.price, 2)}`}
                  variant="ghost"
                  onPress={() => {
                    update(orderLine, { orderItemId: item.orderItemId });
                    setOrderLine(null);
                  }}
                />
              ))
          ) : (
            <>
              <Button
                title="Без привязки к заказу"
                variant="ghost"
                onPress={() => {
                  setOrderOpen(false);
                  if (document)
                    void run('Сверяем заказ…', async (current) => {
                      const result = await supplierInvoicesApi.setOrder(document.id, document.version, null);
                      if (current()) apply(result.data);
                    });
                }}
              />
              {orders.map((order) => (
                <Button
                  key={order.id}
                  title={`Заказ от ${order.createdAt.slice(0, 10)}`}
                  variant="ghost"
                  onPress={() => {
                    setOrderOpen(false);
                    if (document)
                      void run('Сверяем заказ…', async (current) => {
                        const result = await supplierInvoicesApi.setOrder(document.id, document.version, order.id);
                        if (current()) {
                          apply(result.data);
                          setRows((previous) =>
                            Object.fromEntries(
                              Object.entries(previous).map(([id, row]) => [id, { ...row, orderItemId: '' }]),
                            ),
                          );
                        }
                      });
                  }}
                />
              ))}
            </>
          )}
        </View>
      </BottomSheet>
      <DateTimePickerModal
        visible={restoredKey === storageKey && !!datePicker}
        value={(() => {
          const [year, month, day] = (datePicker === 'receipt' ? receivedAt || today : date || today)
            .split('-')
            .map(Number);
          return new Date(year, month - 1, day);
        })()}
        mode="date"
        onConfirm={(value) => {
          const day = toSupplyDateStr(value);
          if (datePicker === 'receipt') {
            if (day > today) {
              Alert.alert('Проверьте дату', 'Приход на склад не может быть в будущем.');
              return;
            }
            setReceivedAt(day);
          } else {
            dateTouched.current = true;
            setDate(day);
          }
          setDatePicker(null);
        }}
        onCancel={() => setDatePicker(null)}
      />
      <ConfirmDialog
        visible={restoredKey === storageKey && confirmOpen}
        title="Принять накладную?"
        message={`Будет создана одна поставка. Остатки увеличатся, сумма добавится в долг поставщику. Дата документа: ${pending?.date}. Приход: ${pending?.receivedAt || 'сегодня'}.`}
        confirmText="Принять в долг"
        onClose={() => {
          setConfirmOpen(false);
          if (!submitted.current) setPending(null);
        }}
        onConfirm={confirm}
      />
      <NativeModal
        visible={restoredKey === storageKey && !!preview}
        animationType="fade"
        onRequestClose={() => setPreview(null)}
      >
        <SafeAreaView edges={['top', 'bottom']} style={[styles.screen, { backgroundColor: '#111' }]}>
          <Text
            color="#fff"
            style={{ padding: 12 }}
          >{`Страница ${(document?.pages.find((page) => page.url === preview)?.index ?? 0) + 1}`}</Text>
          <Button title="Закрыть страницу" variant="secondary" onPress={() => setPreview(null)} />
          {preview && <Image source={imageSource(preview)} style={{ flex: 1 }} resizeMode="contain" />}
        </SafeAreaView>
      </NativeModal>
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 36 },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, minHeight: 44 },
  card: { gap: 10, padding: 14, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  name: { fontSize: 16, fontWeight: '600' },
  small: { fontSize: 12, lineHeight: 18 },
  input: { minHeight: 46, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 16 },
});
