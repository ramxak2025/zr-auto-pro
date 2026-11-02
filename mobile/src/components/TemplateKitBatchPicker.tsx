import React, { useEffect, useRef, useState } from 'react';
import { View, TextInput } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/AppNavigator';
import { Text } from '../platform/Typography';
import Modal from './Modal';
import { Button } from './Button';
import { useColors } from '../contexts/ThemeContext';
import {
  claimProductPickerSession,
  notifyProductPickerSession,
  releaseProductPickerSession,
  type ProductPickerBridge,
} from '../utils/productPickerSession';
import type { KitBatchChoice, TemplateKitChoiceRequest } from '../../../shared/utils/templateKitApplication';
import { validateKitAllocation } from '../../../shared/utils/templateKitApplication';

export default function TemplateKitBatchPicker({
  request,
  onResolve,
  onRebuild,
}: {
  request: TemplateKitChoiceRequest;
  onResolve: (choice: KitBatchChoice[] | null) => void;
  onRebuild?: () => void;
}) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const palette = useColors();
  const focused = useIsFocused();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const available = request.candidates.reduce((sum, product) => sum + product.stock, 0);
  const shortage = available < request.line.quantity;
  const bridge = useRef<ProductPickerBridge>({
    productLines: [],
    addProduct: () => {},
    decrementProduct: () => {},
    showCostPrice: false,
    warrantyNames: new Set(),
    warehouseId: null,
    setWarehouseId: () => {},
    warehouses: [],
  });
  bridge.current = {
    ...bridge.current,
    title: 'Партии комплекта',
    showTotal: false,
    closeOnSelect: true,
    productLines: request.candidates
      .filter((product) => quantities[product.id])
      .map((product) => ({
        productId: product.id,
        quantity: Number(quantities[product.id]) || 0,
        sellPrice: product.sellPrice,
      })),
    filterProduct: (product) => request.candidates.some((candidate) => candidate.id === product.id),
    addProduct: (product) => setQuantities((previous) => ({ ...previous, [product.id]: previous[product.id] ?? '1' })),
  };
  useEffect(() => {
    notifyProductPickerSession(bridge);
  }, [quantities]);
  useEffect(() => () => releaseProductPickerSession(bridge), []);
  return (
    <Modal
      visible={focused}
      onClose={() => onResolve(null)}
      title={shortage ? 'Не хватает комплектов' : 'Выберите партии комплекта'}
    >
      <View style={{ gap: 12, padding: 16 }}>
        <Text>
          {request.line.name} · состав версии {request.line.kitRecipeVersion}
        </Text>
        <Text color={palette.text.secondary}>
          Нужно {request.line.quantity}, доступно {available}. Цены — из выбранных партий. Корзина изменится после
          выбора всего шаблона.
        </Text>
        {!!error && <Text accessibilityRole="alert">{error}</Text>}
        {shortage ? (
          onRebuild ? (
            <Button title="Собрать ещё по этому составу" variant="secondary" onPress={onRebuild} />
          ) : (
            <Text color={palette.text.secondary}>
              Попросите сотрудника с правом управления складом собрать нужное количество.
            </Text>
          )
        ) : (
          <>
            <Button
              title="Выбрать через каталог кассы"
              variant="secondary"
              onPress={() => {
                claimProductPickerSession(bridge);
                navigation.navigate('ProductPicker', {});
              }}
            />
            {request.candidates
              .filter((product) => quantities[product.id] !== undefined)
              .map((product) => (
                <View key={product.id} style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text>{product.name}</Text>
                    <Text color={palette.text.secondary}>
                      {product.sellPrice} ₽ · остаток {product.stock}
                    </Text>
                  </View>
                  <TextInput
                    accessibilityLabel={`Количество партии — ${product.id}`}
                    value={quantities[product.id]}
                    keyboardType="number-pad"
                    onChangeText={(value) => setQuantities((previous) => ({ ...previous, [product.id]: value }))}
                    style={{
                      width: 72,
                      minHeight: 44,
                      padding: 8,
                      borderWidth: 1,
                      borderColor: palette.border.subtle,
                      borderRadius: 10,
                      color: palette.text.primary,
                    }}
                  />
                </View>
              ))}
            <Button
              title="Применить весь шаблон"
              onPress={() => {
                try {
                  const choices = Object.entries(quantities)
                    .filter(([, value]) => value !== '' && Number(value) !== 0)
                    .map(([productId, value]) => ({ productId, quantity: Number(value) }));
                  validateKitAllocation(request.line, request.candidates, choices);
                  onResolve(choices);
                } catch (cause) {
                  setError((cause as Error).message);
                }
              }}
            />
          </>
        )}
        <Button title="Отмена" variant="secondary" onPress={() => onResolve(null)} />
      </View>
    </Modal>
  );
}
