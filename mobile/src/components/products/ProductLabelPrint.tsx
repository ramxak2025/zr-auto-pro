import React, { useEffect, useMemo, useState, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, Switch, Alert, StyleSheet, ActivityIndicator } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from '../BottomSheet';
import { colors } from '../../theme';
import { useColors } from '../../contexts/ThemeContext';
import {
  defaultLabelSource,
  LABEL_PAPERS,
  MAX_LABEL_COPIES,
  MAX_LABELS,
  prepareProductLabels,
  type LabelProduct,
  type LabelSelection,
} from '../../../../shared/utils/productLabels';
import {
  encodeProductLabelCode,
  exportProductLabelsPdf,
  printProductLabelsNative,
} from '../../utils/productLabelPrint';

export interface ProductLabelPrintProps {
  visible: boolean;
  onClose: () => void;
  products: readonly LabelProduct[];
  onGenerateInternal?: (productIds: string[]) => Promise<Array<{ id: string; internalBarcode: string }>>;
}
export default function ProductLabelPrint({ visible, onClose, products, onGenerateInternal }: ProductLabelPrintProps) {
  const palette = useColors();
  const [items, setItems] = useState<LabelProduct[]>([]);
  const [choices, setChoices] = useState<Record<string, LabelSelection>>({});
  const [paper, setPaper] = useState('40');
  const [width, setWidth] = useState('40');
  const [height, setHeight] = useState('30');
  const [showPrice, setShowPrice] = useState(false);
  const [previewId, setPreviewId] = useState('');
  const [busy, setBusy] = useState(false);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (!visible) {
      wasOpen.current = false;
      return;
    }
    const preserveChoices = wasOpen.current;
    wasOpen.current = true;
    setItems(
      products.map(({ id, name, sellPrice, barcode, internalBarcode }) => ({
        id,
        name,
        sellPrice,
        barcode,
        internalBarcode,
      })),
    );
    setChoices((previous) =>
      Object.fromEntries(
        products.map((product) => [
          product.id,
          preserveChoices && previous[product.id]
            ? previous[product.id]
            : { copies: 1, source: defaultLabelSource(product) },
        ]),
      ),
    );
    setPreviewId(products[0]?.id ?? '');
  }, [visible, products]);
  const dimensions = useMemo(
    () =>
      paper === 'custom'
        ? { widthMm: Number(width.replace(',', '.')), heightMm: Number(height.replace(',', '.')) }
        : LABEL_PAPERS[paper === '58' ? 1 : 0],
    [paper, width, height],
  );
  const result = useMemo(() => {
    try {
      return {
        labels: prepareProductLabels(items, choices, { paper: dimensions, showPrice }, encodeProductLabelCode),
        error: '',
      };
    } catch (error) {
      return { labels: undefined, error: error instanceof Error ? error.message : 'Не удалось подготовить этикетки.' };
    }
  }, [items, choices, dimensions, showPrice]);
  const preview = result.labels?.previews.find((item) => item.productId === previewId) ?? result.labels?.previews[0];
  const setChoice = (id: string, patch: Partial<LabelSelection>) =>
    setChoices((previous) => ({ ...previous, [id]: { ...previous[id], ...patch } }));
  const generate = async (ids: string[]) => {
    if (!onGenerateInternal || busy) return;
    setBusy(true);
    try {
      if (ids.length > MAX_LABELS) throw new Error(`Выберите не больше ${MAX_LABELS} товаров.`);
      const codes = await onGenerateInternal(ids);
      setItems((previous) =>
        previous.map((item) => ({
          ...item,
          internalBarcode: codes.find((code) => code.id === item.id)?.internalBarcode ?? item.internalBarcode,
        })),
      );
      for (const id of ids) setChoice(id, { source: 'internal' });
    } catch (error) {
      Alert.alert('Штрихкод не создан', error instanceof Error ? error.message : 'Подключитесь к сети и повторите.');
    } finally {
      setBusy(false);
    }
  };
  const output = async (action: 'print' | 'pdf') => {
    if (!result.labels || busy) return;
    setBusy(true);
    try {
      if (action === 'print') await printProductLabelsNative(result.labels);
      else {
        const pdf = await exportProductLabelsPdf(result.labels);
        if (!pdf.shared) Alert.alert('PDF создан', 'Системная отправка файлов недоступна на этом устройстве.');
      }
    } catch (error) {
      Alert.alert('Печать / PDF', error instanceof Error ? error.message : 'Не удалось открыть системное окно.');
    } finally {
      setBusy(false);
    }
  };
  const input = [
    styles.input,
    { color: palette.text.primary, backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
  ];
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Этикетки" heightRatio={0.92}>
      <View style={{ gap: 16 }}>
        <Text style={{ color: palette.text.secondary }}>Название и штрихкод. Цена продажи — по желанию.</Text>
        <View accessibilityRole="radiogroup" style={styles.row}>
          {[
            ['40', '40 × 30'],
            ['58', '58 × 40'],
            ['custom', 'Свой размер'],
          ].map(([value, label]) => (
            <TouchableOpacity
              key={value}
              accessibilityRole="radio"
              accessibilityState={{ checked: paper === value }}
              onPress={() => setPaper(value)}
              style={[styles.chip, { backgroundColor: paper === value ? palette.accent.primary : palette.bg.muted }]}
            >
              <Text style={{ color: paper === value ? '#fff' : palette.text.primary }}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {paper === 'custom' && (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: palette.text.secondary }}>Ширина, мм</Text>
              <TextInput
                accessibilityLabel="Ширина этикетки, мм"
                keyboardType="decimal-pad"
                style={input}
                value={width}
                onChangeText={setWidth}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: palette.text.secondary }}>Высота, мм</Text>
              <TextInput
                accessibilityLabel="Высота этикетки, мм"
                keyboardType="decimal-pad"
                style={input}
                value={height}
                onChangeText={setHeight}
              />
            </View>
          </View>
        )}
        <View style={[styles.row, { justifyContent: 'space-between' }]}>
          <Text style={{ color: palette.text.primary }}>Печатать цену продажи</Text>
          <Switch accessibilityLabel="Печатать цену продажи" value={showPrice} onValueChange={setShowPrice} />
        </View>
        {onGenerateInternal && items.filter((item) => !item.internalBarcode).length > 1 && (
          <TouchableOpacity
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void generate(items.filter((item) => !item.internalBarcode).map((item) => item.id))}
            style={[styles.row, { paddingVertical: 10 }]}
          >
            <Ionicons name="barcode-outline" size={18} color={palette.accent.primary} />
            <Text style={{ color: palette.accent.primary, flex: 1 }}>Создать недостающие внутренние коды</Text>
          </TouchableOpacity>
        )}
        {items.map((item) => (
          <View key={item.id} style={[styles.item, { borderColor: palette.border.subtle }]}>
            <View style={styles.row}>
              <TouchableOpacity
                style={{ flex: 1 }}
                onPress={() => setPreviewId(item.id)}
                accessibilityLabel={`Предпросмотр: ${item.name}`}
              >
                <Text style={{ color: palette.text.primary, fontWeight: '600' }}>{item.name}</Text>
              </TouchableOpacity>
              <View>
                <Text style={{ color: palette.text.secondary, fontSize: 12 }}>Копий</Text>
                <TextInput
                  accessibilityLabel={`Копий: ${item.name}`}
                  style={[...input, { width: 64 }]}
                  keyboardType="number-pad"
                  value={String(choices[item.id]?.copies ?? 1)}
                  maxLength={4}
                  onChangeText={(value) => setChoice(item.id, { copies: Number(value) })}
                />
              </View>
            </View>
            {item.barcode && item.internalBarcode ? (
              <View style={{ gap: 4 }}>
                {(['factory', 'internal'] as const).map((source) => (
                  <TouchableOpacity
                    key={source}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: choices[item.id]?.source === source }}
                    onPress={() => setChoice(item.id, { source })}
                    style={[styles.row, { paddingVertical: 8 }]}
                  >
                    <Ionicons
                      name={choices[item.id]?.source === source ? 'radio-button-on' : 'radio-button-off'}
                      size={20}
                      color={palette.accent.primary}
                    />
                    <Text style={{ color: palette.text.secondary, flex: 1 }}>
                      {source === 'factory' ? `Заводской · ${item.barcode}` : `Внутренний · ${item.internalBarcode}`}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <Text style={{ color: palette.text.secondary }}>
                {item.barcode
                  ? `Заводской · ${item.barcode}`
                  : item.internalBarcode
                    ? `Внутренний · ${item.internalBarcode}`
                    : 'Штрихкод не создан'}
              </Text>
            )}
            {!item.internalBarcode && onGenerateInternal && (
              <TouchableOpacity
                disabled={busy}
                onPress={() => void generate([item.id])}
                style={[styles.row, { paddingVertical: 10 }]}
              >
                <Ionicons name="barcode-outline" size={18} color={palette.accent.primary} />
                <Text style={{ color: palette.accent.primary, flex: 1 }}>Создать внутренний штрихкод</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}
        {!!result.error && (
          <Text
            accessibilityRole="alert"
            style={{ color: palette.mode === 'dark' ? colors.red[400] : colors.red[600] }}
          >
            {result.error}
          </Text>
        )}
        {preview && (
          <View style={{ gap: 8 }}>
            <Text style={{ color: palette.text.primary, fontWeight: '600' }}>
              Предпросмотр · {dimensions.widthMm} × {dimensions.heightMm} мм
            </Text>
            <View style={styles.preview}>
              <SvgXml xml={preview.svg} width="100%" height={Math.min(240, dimensions.heightMm * 5)} />
            </View>
            <Text style={{ color: palette.text.secondary, fontSize: 12 }}>
              Нажмите название товара, чтобы посмотреть его этикетку.
            </Text>
          </View>
        )}
        {result.labels?.warnings.map((warning) => (
          <Text key={warning} style={{ color: palette.text.secondary, fontSize: 12 }}>
            {warning}
          </Text>
        ))}
        <Text style={{ color: palette.text.secondary, fontSize: 12 }}>
          До {MAX_LABEL_COPIES} копий одного товара, до 200 этикеток за раз. В системном окне выберите нужный принтер и
          размер бумаги, масштаб 100%. Подключение зависит от драйвера и службы печати устройства.
        </Text>
        <View style={styles.row}>
          <TouchableOpacity
            accessibilityRole="button"
            disabled={!result.labels || busy}
            style={[styles.button, { borderColor: palette.border.strong, opacity: result.labels && !busy ? 1 : 0.5 }]}
            onPress={() => void output('pdf')}
          >
            <Ionicons name="document-outline" size={18} color={palette.text.primary} />
            <Text style={{ color: palette.text.primary }}>PDF</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityRole="button"
            disabled={!result.labels || busy}
            style={[
              styles.button,
              {
                backgroundColor: palette.accent.primary,
                borderColor: palette.accent.primary,
                opacity: result.labels && !busy ? 1 : 0.5,
              },
            ]}
            onPress={() => void output('print')}
          >
            {busy ? <ActivityIndicator color="#fff" /> : <Ionicons name="print-outline" size={18} color="#fff" />}
            <Text style={{ color: '#fff', fontWeight: '600' }}>
              Печать{result.labels ? ` · ${result.labels.count}` : ''}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </BottomSheet>
  );
}
const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  chip: { paddingHorizontal: 12, paddingVertical: 12, borderRadius: 10 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginTop: 4,
    fontSize: 15,
  },
  item: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, gap: 8 },
  preview: { backgroundColor: '#fff', padding: 8, borderRadius: 8 },
  button: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
