import { colors } from '../theme';
import React, { useEffect, useRef, useState } from 'react';
import { View, TextInput, Pressable, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { randomUUID } from 'expo-crypto';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { RootStackParamList } from '../navigation/AppNavigator';
import type { AssembleKitRequest } from '../../../shared/api/productKits';
import { kitDraftPayload, type KitDraftLine } from '../../../shared/utils/productKitDraft';
import { parsePurchaseOrderQuantity } from '../../../shared/utils/purchaseOrderInput';
import { productKitsApi, warehousesApi } from '../api/services';
import { captureDataSession } from '../contexts/dataSession';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import { extractApiErrorMessage } from '../utils/apiError';
import {
  claimProductPickerSession,
  notifyProductPickerSession,
  releaseProductPickerSession,
  type ProductPickerBridge,
} from '../utils/productPickerSession';
import IosScreenHeader from '../components/IosScreenHeader';
import { KeyboardAwareScroll } from '../components/KeyboardAware';
import ConfirmDialog from '../components/ConfirmDialog';
import { Button } from '../components/Button';
import { Text } from '../platform/Typography';

export default function ProductKitComposerScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'ProductKitComposer'>>();
  const { warehouseId, productId } = route.params;
  const palette = useColors(),
    queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const owner = captureDataSession();
  const storageKey = `autexa.kit-draft.v1:${owner.key}:${productId ?? warehouseId}`;
  const [name, setName] = useState(''),
    [quantity, setQuantity] = useState('1'),
    [sellPrice, setSellPrice] = useState('');
  const [lines, setLines] = useState<KitDraftLine[]>([]),
    [sourceWarehouse, setSourceWarehouse] = useState<string | null>(warehouseId || null);
  const [requestId, setRequestId] = useState(() => randomUUID()),
    [pending, setPending] = useState<(AssembleKitRequest & { expectedRevision?: number }) | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [confirmOpen, setConfirmOpen] = useState(false),
    [restoredKey, setRestoredKey] = useState('');
  const draftRef = useRef({ name, quantity, sellPrice, lines });
  draftRef.current = { name, quantity, sellPrice, lines };
  const writeLines = (change: KitDraftLine[] | ((previous: KitDraftLine[]) => KitDraftLine[])) => {
    const next = typeof change === 'function' ? change(draftRef.current.lines) : change;
    draftRef.current.lines = next;
    setLines(next);
  };
  const seeded = useRef(false),
    submitted = useRef(false),
    mounted = useRef(true),
    busyRef = useRef(false);
  const {
    data: kit,
    isPending: kitLoading,
    isError: kitError,
    refetch: refetchKit,
  } = useQuery({
    queryKey: ['product-kit', productId],
    queryFn: async () => (await productKitsApi.get(productId!)).data,
    enabled: !!productId,
  });
  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn: async () => (await warehousesApi.list()).data,
  });
  useEffect(() => {
    const lease = captureDataSession();
    if (!owner.key || !owner.isCurrent()) return;
    mounted.current = true;
    void AsyncStorage.getItem(storageKey)
      .then((raw) => {
        if (!lease.isCurrent() || !mounted.current) return;
        const saved = raw
          ? (JSON.parse(raw) as {
              name?: string;
              quantity?: string;
              sellPrice?: string;
              lines?: KitDraftLine[];
              requestId?: string;
              pending?: typeof pending;
              submitted?: boolean;
            })
          : {};
        if (saved.name !== undefined) {
          setName(saved.name);
          setQuantity(saved.quantity ?? '1');
          setSellPrice(saved.sellPrice ?? '');
          writeLines(saved.lines ?? []);
          if (saved.requestId) setRequestId(saved.requestId);
          if (saved.pending) setPending(saved.pending);
          submitted.current = !!saved.submitted;
          seeded.current = true;
        }
        setRestoredKey(storageKey);
      })
      .catch(() => {
        if (lease.isCurrent() && mounted.current) {
          setError('Не удалось восстановить черновик комплекта.');
          setRestoredKey(storageKey);
        }
      });
    return () => {
      mounted.current = false;
      releaseProductPickerSession(bridgeRef);
    };
  }, [storageKey]);
  useEffect(() => {
    if (kit && restoredKey === storageKey && !seeded.current) {
      setName(kit.name);
      setQuantity(String(kit.quantity));
      setSellPrice(String(kit.sellPrice));
      writeLines(
        kit.components.map((component) => ({
          productId: component.productId,
          name: component.name,
          quantity: String(component.quantity),
        })),
      );
      seeded.current = true;
    }
  }, [kit, restoredKey, storageKey]);
  useEffect(() => {
    const lease = captureDataSession();
    if (!lease.key || restoredKey !== storageKey || (!name && !lines.length)) return;
    void AsyncStorage.setItem(
      storageKey,
      JSON.stringify({ name, quantity, sellPrice, lines, requestId, pending, submitted: submitted.current }),
    ).catch(() => {
      if (lease.isCurrent()) setError('Черновик не сохранён. Не закрывайте экран до подтверждения результата.');
    });
  }, [storageKey, restoredKey, name, quantity, sellPrice, lines, requestId, pending]);
  const bridge: ProductPickerBridge = {
    productLines: lines.map((line) => ({
      productId: line.productId,
      quantity: parsePurchaseOrderQuantity(line.quantity) ?? 0,
      sellPrice: 0,
    })),
    title: 'Компоненты комплекта',
    totalLabel: 'В составе',
    showTotal: false,
    addProduct: (product) => {
      if (busyRef.current || pending) return;
      writeLines((previous) => {
        const existing = previous.find((line) => line.productId === product.id);
        if (!existing) return [...previous, { productId: product.id, name: product.name, quantity: '1' }];
        const number = parsePurchaseOrderQuantity(existing.quantity);
        return number === null
          ? previous
          : previous.map((line) => (line.productId === product.id ? { ...line, quantity: String(number + 1) } : line));
      });
    },
    decrementProduct: (id) => {
      if (busyRef.current || pending) return;
      writeLines((previous) =>
        previous.flatMap((line) => {
          if (line.productId !== id) return [line];
          const number = parsePurchaseOrderQuantity(line.quantity);
          return number === null ? [line] : number > 1 ? [{ ...line, quantity: String(number - 1) }] : [];
        }),
      );
    },
    filterProduct: (product) => !product.assemblyId,
    showCostPrice: hasPermission('warehouse_manage'),
    priceKind: hasPermission('warehouse_manage') ? 'cost' : 'sell',
    warrantyNames: new Set(),
    warehouseId: sourceWarehouse,
    setWarehouseId: setSourceWarehouse,
    warehouses,
  };
  const bridgeRef = useRef(bridge);
  bridgeRef.current = bridge;
  useEffect(() => {
    notifyProductPickerSession(bridgeRef);
  }, [lines, sourceWarehouse, warehouses, pending]);
  const prepare = () => {
    try {
      if (productId && !kit) throw new Error('Дождитесь загрузки актуального состава.');
      const body = pending ?? {
        ...kitDraftPayload({ ...draftRef.current, warehouseId }, requestId),
        ...(kit ? { expectedRevision: kit.revision } : {}),
      };
      setPending(body);
      setConfirmOpen(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Проверьте комплект.');
    }
  };
  const confirm = () => {
    if (!owner.key || !owner.isCurrent() || !mounted.current) return;
    submitted.current = true;
    void (async () => {
      if (busyRef.current || !pending || (productId && pending.expectedRevision === undefined)) return;
      const lease = owner;
      busyRef.current = true;
      setBusy(true);
      setError('');
      try {
        await AsyncStorage.setItem(
          storageKey,
          JSON.stringify({ name, quantity, sellPrice, lines, requestId, pending, submitted: true }),
        );
        if (!lease.isCurrent() || !mounted.current) return;
        const result =
          productId && pending.expectedRevision !== undefined
            ? await productKitsApi.recompose(productId, { ...pending, expectedRevision: pending.expectedRevision })
            : await productKitsApi.assemble(pending);
        if (!lease.isCurrent() || !mounted.current) return;
        await AsyncStorage.removeItem(storageKey);
        for (const prefix of [
          'products',
          'all-products-check',
          'stock-movements',
          'product-kit',
          'product',
          'warehouse-stats',
        ])
          void queryClient.invalidateQueries({ queryKey: [prefix] });
        navigation.replace('ProductDetail', { productId: result.data.productId });
      } catch (cause) {
        if (lease.isCurrent() && mounted.current) {
          setError(extractApiErrorMessage(cause, 'Результат не подтверждён. Повторите тот же запрос.'));
          const response = (cause as { response?: { status?: number; data?: { code?: string } } }).response;
          if (
            response?.status === 400 ||
            (response?.status === 409 && response.data?.code !== 'KIT_REQUEST_CONFLICT')
          ) {
            submitted.current = false;
            setPending(null);
            setConfirmOpen(false);
            setRequestId(randomUUID());
            if (productId) void refetchKit();
          }
        }
      } finally {
        if (lease.isCurrent() && mounted.current) {
          busyRef.current = false;
          setBusy(false);
        }
      }
    })();
  };
  const frozen = busy || !!pending;
  const inputStyle = [
    styles.input,
    { color: palette.text.primary, borderColor: palette.border.subtle, backgroundColor: palette.bg.card },
  ];
  return (
    <View style={[styles.screen, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title={productId ? 'Новый состав комплекта' : 'Собрать комплект'}
        onBack={() => navigation.goBack()}
      />
      {!owner.key && (
        <Text style={{ padding: 16 }} color={palette.text.secondary}>
          Подготавливаем аккаунт…
        </Text>
      )}
      {restoredKey === storageKey && (
        <KeyboardAwareScroll contentContainerStyle={styles.content}>
          <Text color={palette.text.secondary}>
            {productId
              ? 'Выбранное количество старой партии будет разобрано и собрано новой партией.'
              : 'Компоненты спишутся только после подтверждения сборки.'}
          </Text>
          {error ? (
            <Text accessibilityRole="alert" color={palette.mode === 'dark' ? colors.red[400] : colors.red[700]}>
              {error}
            </Text>
          ) : null}
          {productId && kitLoading ? <Text color={palette.text.secondary}>Загрузка состава…</Text> : null}
          {kitError ? (
            <Button
              title="Не удалось загрузить состав · Повторить"
              variant="secondary"
              onPress={() => void refetchKit()}
            />
          ) : null}
          <Text color={palette.text.secondary}>Название комплекта</Text>
          <TextInput
            accessibilityLabel="Название комплекта"
            value={name}
            editable={!frozen}
            onChangeText={(value) => {
              draftRef.current.name = value;
              setName(value);
            }}
            style={inputStyle}
          />
          <Text color={palette.text.secondary}>Количество комплектов</Text>
          <TextInput
            accessibilityLabel="Количество комплектов"
            value={quantity}
            keyboardType="number-pad"
            editable={!frozen}
            onChangeText={(value) => {
              draftRef.current.quantity = value;
              setQuantity(value);
            }}
            style={inputStyle}
          />
          <Text color={palette.text.secondary}>Продажная цена за комплект, ₽</Text>
          <TextInput
            accessibilityLabel="Цена комплекта"
            value={sellPrice}
            keyboardType="decimal-pad"
            editable={!frozen}
            onChangeText={(value) => {
              draftRef.current.sellPrice = value;
              setSellPrice(value);
            }}
            style={inputStyle}
          />
          <Text color={palette.text.primary} style={{ fontWeight: '600' }}>
            Состав на один комплект
          </Text>
          <Button
            title="Добавить компонент"
            variant="secondary"
            disabled={frozen}
            onPress={() => {
              claimProductPickerSession(bridgeRef);
              navigation.navigate('ProductPicker', {});
            }}
          />
          {!lines.length ? (
            <Text color={palette.text.secondary}>Выберите существующие товары через каталог кассы.</Text>
          ) : null}
          {lines.map((line) => (
            <View key={line.productId} style={[styles.component, { borderBottomColor: palette.border.subtle }]}>
              <Text color={palette.text.primary} style={{ flex: 1 }}>
                {line.name}
              </Text>
              <TextInput
                accessibilityLabel={`Количество компонента — ${line.name}`}
                keyboardType="decimal-pad"
                value={line.quantity}
                editable={!frozen}
                onChangeText={(value) =>
                  writeLines((previous) =>
                    previous.map((item) => (item.productId === line.productId ? { ...item, quantity: value } : item)),
                  )
                }
                style={[...inputStyle, { width: 88 }]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Убрать ${line.name}`}
                disabled={frozen}
                onPress={() => writeLines((previous) => previous.filter((item) => item.productId !== line.productId))}
                style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
              >
                <Text color={palette.accent.primaryText}>Убрать</Text>
              </Pressable>
            </View>
          ))}
          <Button
            title={pending ? 'Повторить сборку' : productId ? 'Проверить новый состав' : 'Проверить сборку'}
            disabled={busy || !hasPermission('warehouse_manage') || (!!productId && !kit)}
            loading={busy}
            onPress={prepare}
          />
        </KeyboardAwareScroll>
      )}
      <ConfirmDialog
        visible={restoredKey === storageKey && confirmOpen}
        title={productId ? 'Собрать новую партию?' : 'Собрать комплект?'}
        message={`${pending?.quantity} комплектов «${pending?.name}». Компоненты спишутся со складов, собранный товар появится отдельной позицией. Себестоимость рассчитается по компонентам.`}
        confirmText="Подтвердить сборку"
        onClose={() => {
          setConfirmOpen(false);
          if (!submitted.current) setPending(null);
        }}
        onConfirm={confirm}
      />
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 16, gap: 12, paddingBottom: 40 },
  input: { minHeight: 46, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, fontSize: 16 },
  component: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: 8,
  },
});
