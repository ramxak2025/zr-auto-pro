import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Keyboard,
  InputAccessoryView,
  Platform,
} from 'react-native';
import { useColors } from '../contexts/ThemeContext';
import { colors, spacing, borderRadius } from '../theme';
import { unitLabel } from '../utils/units';
import {
  formatPurchaseOrderMoney,
  MIN_PURCHASE_ORDER_QUANTITY,
  parsePurchaseOrderQuantity,
  purchaseOrderLineValue,
  type PurchaseOrderLineValue,
} from '../../../shared/utils/purchaseOrderInput';

export interface PurchaseOrderLineEditorProps {
  name: string;
  unit?: string;
  quantityText: string;
  costPriceText: string;
  receivedQuantity?: number;
  existing?: boolean;
  context?: 'order' | 'delivery';
  accessoryIdPrefix?: string;
  onDraftChange?: (draft: { quantityText: string; costPriceText: string }) => void;
  onConfirm: (value: PurchaseOrderLineValue) => void;
  onCancel: () => void;
}

/** Local draft only: cancelling never changes the order or the catalogue. */
export default function PurchaseOrderLineEditor(props: PurchaseOrderLineEditorProps) {
  const palette = useColors();
  const [quantityText, setQuantityText] = useState(props.quantityText);
  const [costPriceText, setCostPriceText] = useState(props.costPriceText);
  const latest = useRef({ quantityText: props.quantityText, costPriceText: props.costPriceText });
  const [error, setError] = useState('');
  const saving = useRef(false);
  const minimum = Math.max(MIN_PURCHASE_ORDER_QUANTITY, props.receivedQuantity ?? 0);
  const value = purchaseOrderLineValue(quantityText, costPriceText, minimum);
  const confirm = () => {
    if (saving.current) return;
    const input = purchaseOrderLineValue(latest.current.quantityText, latest.current.costPriceText, minimum);
    if (!input) {
      setError(
        parsePurchaseOrderQuantity(latest.current.quantityText) === null
          ? 'Количество должно быть больше нуля, до 3 знаков после запятой.'
          : Number(latest.current.quantityText.replace(',', '.')) < minimum
            ? `Уже принято ${minimum}. Уменьшить количество ниже нельзя.`
            : 'Укажите закупочную цену от 0, до 2 знаков после запятой.',
      );
      Keyboard.dismiss();
      return;
    }
    saving.current = true;
    try {
      props.onConfirm(input);
      Keyboard.dismiss();
    } catch (cause) {
      saving.current = false;
      setError(cause instanceof Error ? cause.message : 'Не удалось изменить позицию. Повторите.');
      Keyboard.dismiss();
    }
  };
  const accessoryPrefix = props.accessoryIdPrefix ?? 'purchase-order';
  return (
    <View
      style={[styles.editor, { backgroundColor: palette.bg.muted }]}
      accessibilityLabel={`Параметры товара: ${props.name}`}
    >
      <View style={styles.fields}>
        <View style={styles.field}>
          <Text style={[styles.label, { color: palette.text.secondary }]}>Количество, {unitLabel(props.unit)}</Text>
          <TextInput
            accessibilityLabel="Количество товара"
            value={quantityText}
            onChangeText={(text) => {
              latest.current.quantityText = text;
              setQuantityText(text);
              props.onDraftChange?.({ ...latest.current });
              setError('');
            }}
            keyboardType="decimal-pad"
            inputAccessoryViewID={Platform.OS === 'ios' ? `${accessoryPrefix}-quantity-confirm` : undefined}
            returnKeyType="done"
            onSubmitEditing={confirm}
            selectTextOnFocus
            style={[
              styles.input,
              { backgroundColor: palette.bg.muted, color: palette.text.primary, borderColor: palette.border.subtle },
            ]}
          />
        </View>
        <View style={styles.field}>
          <Text style={[styles.label, { color: palette.text.secondary }]}>Цена закупки, ₽</Text>
          <TextInput
            accessibilityLabel="Закупочная цена за единицу"
            value={costPriceText}
            onChangeText={(text) => {
              latest.current.costPriceText = text;
              setCostPriceText(text);
              props.onDraftChange?.({ ...latest.current });
              setError('');
            }}
            keyboardType="decimal-pad"
            inputAccessoryViewID={Platform.OS === 'ios' ? `${accessoryPrefix}-unit-cost-confirm` : undefined}
            returnKeyType="done"
            onSubmitEditing={confirm}
            selectTextOnFocus
            style={[
              styles.input,
              { backgroundColor: palette.bg.muted, color: palette.text.primary, borderColor: palette.border.subtle },
            ]}
          />
        </View>
      </View>
      {(props.receivedQuantity ?? 0) > 0 && (
        <Text style={[styles.hint, { color: palette.text.secondary }]}>
          Уже принято: {props.receivedQuantity}. Это минимальное количество.
        </Text>
      )}
      <View style={styles.total}>
        <Text style={[styles.label, { color: palette.text.secondary }]}>Итого за позицию</Text>
        <Text accessibilityLiveRegion="polite" style={[styles.amount, { color: palette.text.primary }]}>
          {value ? formatPurchaseOrderMoney(value.quantity * value.costPrice) : '—'}
        </Text>
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: colors.red[600], marginTop: spacing[3] }}>
          {error}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <TouchableOpacity
          onPress={props.onCancel}
          accessibilityRole="button"
          style={[styles.cancel, { borderColor: palette.border.subtle }]}
        >
          <Text style={[styles.buttonText, { color: palette.text.primary }]}>Отмена</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={confirm} accessibilityRole="button" style={styles.save}>
          <Text style={[styles.buttonText, { color: colors.white }]}>{props.existing ? 'Сохранить' : 'Добавить'}</Text>
        </TouchableOpacity>
      </View>
      {Platform.OS === 'ios'
        ? [`${accessoryPrefix}-quantity-confirm`, `${accessoryPrefix}-unit-cost-confirm`].map((nativeID) => (
            <InputAccessoryView key={nativeID} nativeID={nativeID} backgroundColor={palette.bg.card}>
              <View style={styles.keyboardAccessory}>
                <TouchableOpacity
                  onPress={props.onCancel}
                  style={styles.keyboardAction}
                  accessibilityRole="button"
                  accessibilityLabel="Отменить изменение позиции"
                >
                  <Text style={[styles.buttonText, { color: palette.text.secondary }]}>Отмена</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={confirm}
                  style={styles.keyboardAction}
                  accessibilityRole="button"
                  accessibilityLabel={props.existing ? 'Сохранить позицию' : 'Добавить позицию'}
                >
                  <Text style={[styles.buttonText, { color: colors.primary[600] }]}>
                    {props.existing ? 'Сохранить' : 'Добавить'}
                  </Text>
                </TouchableOpacity>
              </View>
            </InputAccessoryView>
          ))
        : null}
    </View>
  );
}
const styles = StyleSheet.create({
  keyboardAccessory: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing[3] },
  keyboardAction: {
    minHeight: 44,
    minWidth: 80,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing[2],
  },
  editor: {
    padding: spacing[3],
    marginHorizontal: spacing[3],
    marginBottom: spacing[3],
    borderRadius: borderRadius.lg,
  },
  hint: { fontSize: 13, lineHeight: 19, marginBottom: spacing[3] },
  fields: { flexDirection: 'row', gap: spacing[3] },
  field: { flex: 1, minWidth: 0, gap: spacing[2] },
  label: { fontSize: 13, fontWeight: '500' },
  input: {
    minHeight: 46,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    fontSize: 18,
    fontVariant: ['tabular-nums'],
  },
  total: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
    marginTop: spacing[3],
  },
  amount: { fontSize: 17, fontWeight: '600', fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', gap: spacing[3], marginTop: spacing[3] },
  cancel: {
    flex: 1,
    minHeight: 46,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  save: {
    flex: 1.5,
    minHeight: 46,
    backgroundColor: colors.primary[600],
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { fontSize: 15, fontWeight: '600' },
});
