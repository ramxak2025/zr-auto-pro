import { colors } from '../theme';
import React, { useEffect, useRef, useState } from 'react';
import { View, TextInput } from 'react-native';
import AsyncStorage from '../utils/environmentStorage';
import { randomUUID } from 'expo-crypto';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import type { Product } from '../../../shared/types';
import { productKitsApi } from '../api/services';
import { useColors } from '../contexts/ThemeContext';
import { captureDataSession } from '../contexts/dataSession';
import { formatMoney } from '../../../shared/utils/formatters';
import { extractApiErrorMessage } from '../utils/apiError';
import { Button } from './Button';
import Modal from './Modal';
import { Text } from '../platform/Typography';

export default function ProductKitPanel({ product, canManage }: { product: Product; canManage: boolean }) {
  const palette = useColors(),
    queryClient = useQueryClient(),
    navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const query = useQuery({
    queryKey: ['product-kit', product.id],
    queryFn: async () => (await productKitsApi.get(product.id)).data,
  });
  const [open, setOpen] = useState(false),
    [quantity, setQuantity] = useState('1'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const request = useRef<{ requestId: string; expectedRevision: number; quantity: number } | null>(null);
  const owner = captureDataSession();
  const key = `autexa.kit-disassembly.v1:${owner.key}:${product.id}`;
  useEffect(() => {
    const lease = owner;
    if (!lease.key || !lease.isCurrent()) return;
    void AsyncStorage.getItem(key)
      .then((raw) => {
        if (lease.isCurrent() && raw) {
          request.current = JSON.parse(raw);
          setQuantity(String(request.current?.quantity ?? 1));
        }
      })
      .catch(() => {
        if (lease.isCurrent()) setError('Не удалось восстановить запрос разборки.');
      });
  }, [key]);
  const disassemble = async () => {
    if (busy || !query.data || !owner.key || !owner.isCurrent()) return;
    if (!request.current) {
      const number = Number(quantity);
      if (!/^\d+$/.test(quantity) || number < 1 || number > query.data.quantity) {
        setError('Укажите целое количество в пределах остатка.');
        return;
      }
      request.current = { requestId: randomUUID(), expectedRevision: query.data.revision, quantity: number };
    }
    const lease = captureDataSession();
    setBusy(true);
    setError('');
    try {
      await AsyncStorage.setItem(key, JSON.stringify(request.current));
      if (!lease.isCurrent()) return;
      await productKitsApi.disassemble(product.id, request.current);
      if (!lease.isCurrent()) return;
      await AsyncStorage.removeItem(key);
      for (const prefix of ['products', 'all-products-check', 'product-kit', 'product', 'stock-movements'])
        void queryClient.invalidateQueries({ queryKey: [prefix] });
      request.current = null;
      setOpen(false);
    } catch (cause) {
      if (lease.isCurrent()) {
        setError(extractApiErrorMessage(cause, 'Результат не подтверждён. Повторите тот же запрос.'));
        const response = (cause as { response?: { status?: number; data?: { code?: string } } }).response;
        if (response?.status === 400 || (response?.status === 409 && response.data?.code !== 'KIT_REQUEST_CONFLICT')) {
          request.current = null;
          await AsyncStorage.removeItem(key);
          void query.refetch();
        }
      }
    } finally {
      if (lease.isCurrent()) setBusy(false);
    }
  };
  return (
    <View
      style={{
        gap: 10,
        padding: 14,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: palette.border.subtle,
        backgroundColor: palette.bg.card,
      }}
    >
      <Text color={palette.accent.primaryText} style={{ fontWeight: '600' }}>
        Собранный комплект
      </Text>
      {query.isPending ? (
        <Text color={palette.text.secondary}>Загрузка состава…</Text>
      ) : query.isError ? (
        <Button
          title="Не удалось загрузить состав · Повторить"
          variant="secondary"
          onPress={() => void query.refetch()}
        />
      ) : (
        <>
          {query.data.components.map((component) => (
            <View key={component.productId} style={{ flexDirection: 'row', gap: 8, justifyContent: 'space-between' }}>
              <Text color={palette.text.primary} style={{ flex: 1 }}>
                {component.name} × {component.quantity}
              </Text>
              {canManage && component.costPrice !== undefined ? (
                <Text color={palette.text.secondary}>{formatMoney(component.costPrice, 2)}</Text>
              ) : null}
            </View>
          ))}
          {canManage ? (
            <>
              <Button
                title="Изменить состав"
                variant="secondary"
                onPress={() =>
                  navigation.navigate('ProductKitComposer', {
                    warehouseId: product.warehouseId ?? '',
                    productId: product.id,
                  })
                }
              />
              <Button
                title={request.current ? 'Повторить разборку' : 'Разобрать комплект'}
                variant="secondary"
                disabled={query.data.quantity < 1 && !request.current}
                onPress={() => setOpen(true)}
              />
            </>
          ) : null}
        </>
      )}
      <Modal
        visible={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title="Разобрать комплект?"
      >
        <View style={{ gap: 12 }}>
          <Text color={palette.text.secondary}>
            Компоненты выбранного количества вернутся в исходные места хранения. Общая стоимость сохранится.
          </Text>
          <TextInput
            accessibilityLabel="Количество комплектов к разборке"
            keyboardType="number-pad"
            value={quantity}
            editable={!request.current && !busy}
            onChangeText={setQuantity}
            style={{
              minHeight: 46,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: palette.border.subtle,
              color: palette.text.primary,
              paddingHorizontal: 12,
            }}
          />
          {error ? (
            <Text accessibilityRole="alert" color={palette.mode === 'dark' ? colors.red[400] : colors.red[700]}>
              {error}
            </Text>
          ) : null}
          <Button title="Подтвердить разборку" loading={busy} onPress={() => void disassemble()} />
          <Button title="Закрыть" variant="secondary" disabled={busy} onPress={() => setOpen(false)} />
        </View>
      </Modal>
    </View>
  );
}
