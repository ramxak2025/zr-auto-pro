/**
 * VinInput — поле VIN-кода автомобиля (171, 2026-09-25).
 *
 * Рендерится ТОЛЬКО при включённой опции тенанта (`useVinEnabled()`): родитель
 * сам не монтирует поле, когда опция выключена — так экраны остаются
 * байт-в-байт прежними.
 *
 * Что делает само:
 *   • нормализует ввод на лету: верхний регистр, кириллические двойники →
 *     латиница, I/O/Q → 1/0/0, всё вне алфавита VIN отбрасывается
 *     (`normalizeVin`), длина ≤ 17. Наверх (`onChangeText`) уходит уже
 *     канонический VIN — то, что хранит сервер;
 *   • показывает моноширинно с группировкой WMI VDS VIS (`formatVin`) — так
 *     номер читается с кузова и сверяется с ПТС;
 *   • счётчик «12/17», галочка при 17 валидных символах, мягкое
 *     предупреждение о контрольной цифре для североамериканских VIN;
 *   • при 17 валидных символах (debounce 400 мс) — `vinApi.decode`: поле
 *     «Марка и модель» пусто → подставляет `makeModel` молча (`onMakeModel`);
 *     заполнено — чип «По VIN: Kia Rio · Заменить». Подпись-источник под
 *     полем: «Определено по VIN» / «Марка по справочнику, модель допишите».
 *     Результаты кэшируются по VIN на время сессии (расшифровка неизменна).
 *
 * ЛОКАЛЬНЫЙ БУФЕР ТЕКСТА — тот же приём, что в RussianPlateInput: значение
 * контролируемого TextInput, делающее круг через тяжёлый родительский экран
 * (Касса ~6000 строк), на Fabric отстаёт и переставляет буквы. Буфер
 * обновляется синхронно, наверх уходит нормализованный VIN, а эхо своих же
 * значений распознаётся по кольцу `emittedRef` и НЕ ресинхронизирует буфер.
 * Ресинк — только на действительно внешнее изменение (очистка, открытие
 * формы с сохранённой машиной).
 *
 * Android-совместимо: моноширинный шрифт через Platform.select, клавиатура
 * `ascii-capable` (латиница без переключения раскладки) — только на iOS.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleProp,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
  ViewStyle,
  type ReturnKeyTypeOptions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../platform/Typography';
import { VIN_MONO_FONT } from './VinText';
import { vinApi } from '../api/services';
import { useColors } from '../contexts/ThemeContext';
import { haptic } from '../platform/haptics';
import { colors, spacing, borderRadius, fontSize, fontWeight } from '../theme';
import { VIN_LENGTH, formatVin, isValidVin, normalizeVin } from '../../../shared/utils/vin';
import {
  shouldAutofillMakeModel,
  vinCheckDigitWarning,
  vinCounter,
  vinDecodeCaption,
  vinSuggestion,
} from '../utils/vinUi';
import type { VinDecodeResult } from '../../../shared/types';

/** Расшифровка неизменна — один VIN не расшифровываем дважды за сессию. */
const decodeCache = new Map<string, VinDecodeResult>();

export interface VinInputProps {
  /** Канонический VIN (normalizeVin), ≤ 17 символов. */
  value: string;
  onChangeText: (vin: string) => void;
  /**
   * 'form' (по умолчанию) — поле формы авто под маркой/моделью;
   * 'search' — строка поиска Кассы: крупнее, с иконкой и кнопкой очистки,
   * без подписей (результат поиска показывает экран).
   */
  variant?: 'form' | 'search';
  /** Расшифровывать через vinApi.decode при 17 валидных символах. По умолчанию true. */
  decode?: boolean;
  /** Текущее значение «Марка и модель» — решает: подставить молча или предложить чип «Заменить». */
  makeModel?: string;
  /** Подставить марку/модель из расшифровки (молча в пустое поле или по чипу «Заменить»). */
  onMakeModel?: (makeModel: string) => void;
  /** Полный результат расшифровки — если экрану нужно больше (год, кузов). */
  onDecoded?: (result: VinDecodeResult) => void;
  /** Текст ошибки под полем — 409 VIN_DUPLICATE с именем клиента и т.п. */
  error?: string | null;
  autoFocus?: boolean;
  placeholder?: string;
  editable?: boolean;
  returnKeyType?: ReturnKeyTypeOptions;
  onSubmitEditing?: () => void;
  /** Доп. стиль контейнера поля (подстроить радиус/фон под соседние инпуты формы). */
  style?: StyleProp<ViewStyle>;
}

export default function VinInput({
  value,
  onChangeText,
  variant = 'form',
  decode = true,
  makeModel,
  onMakeModel,
  onDecoded,
  error,
  autoFocus = false,
  placeholder,
  editable = true,
  returnKeyType,
  onSubmitEditing,
  style,
}: VinInputProps) {
  const palette = useColors();
  const isSearch = variant === 'search';
  const inputRef = useRef<TextInput>(null);

  // ── Локальный буфер + кольцо своих эмитов (см. шапку файла) ────────────
  const [text, setText] = useState<string>(() => formatVin(value));
  const emittedRef = useRef<string[]>([value]);
  useEffect(() => {
    const ring = emittedRef.current;
    const idx = ring.indexOf(value);
    if (idx !== -1) {
      // Эхо одного из своих эмитов: сбрасываем его и всё, что он перекрыл,
      // более новые (ещё в полёте) оставляем. Буфер уже впереди — не трогаем.
      emittedRef.current = ring.slice(idx + 1);
      return;
    }
    // Действительно внешнее значение.
    setText(formatVin(value));
    emittedRef.current = [];
  }, [value]);

  const handleChange = useCallback(
    (raw: string) => {
      const next = normalizeVin(raw).slice(0, VIN_LENGTH);
      setText(formatVin(next));
      const ring = emittedRef.current;
      ring.push(next);
      // Полный VIN — не больше ~20 эмитов от пустого; запас на эхо в полёте.
      if (ring.length > 24) ring.shift();
      onChangeText(next);
    },
    [onChangeText],
  );

  const handleClear = useCallback(() => {
    haptic('tap');
    handleChange('');
    inputRef.current?.focus();
  }, [handleChange]);

  // ── Расшифровка ────────────────────────────────────────────────────────
  // Колбэки и текущую марку держим в ref'ах: эффект расшифровки зависит только
  // от VIN, а не от каждой перерисовки родителя.
  const makeModelRef = useRef(makeModel);
  makeModelRef.current = makeModel;
  const onMakeModelRef = useRef(onMakeModel);
  onMakeModelRef.current = onMakeModel;
  const onDecodedRef = useRef(onDecoded);
  onDecodedRef.current = onDecoded;

  const [decoding, setDecoding] = useState(false);
  const [decoded, setDecoded] = useState<VinDecodeResult | null>(null);
  const [decodeFailed, setDecodeFailed] = useState(false);
  // VIN, к которому относится `decoded` — чтобы не расшифровывать повторно и
  // не показывать подпись от предыдущего номера.
  const decodedVinRef = useRef<string | null>(null);

  useEffect(() => {
    if (!decode) return;
    if (!isValidVin(value)) {
      if (decodedVinRef.current !== null) {
        decodedVinRef.current = null;
        setDecoded(null);
      }
      setDecodeFailed(false);
      setDecoding(false);
      return;
    }
    if (decodedVinRef.current === value) return;
    // Другой валидный VIN — прежняя расшифровка больше не про это поле.
    if (decodedVinRef.current !== null) {
      decodedVinRef.current = null;
      setDecoded(null);
    }

    let cancelled = false;
    const apply = (res: VinDecodeResult) => {
      decodedVinRef.current = value;
      setDecoded(res);
      onDecodedRef.current?.(res);
      if (shouldAutofillMakeModel(makeModelRef.current, res) && res.makeModel) {
        onMakeModelRef.current?.(res.makeModel);
      }
    };

    const cached = decodeCache.get(value);
    if (cached) {
      apply(cached);
      return;
    }

    const timer = setTimeout(async () => {
      setDecoding(true);
      setDecodeFailed(false);
      try {
        const res = (await vinApi.decode(value)).data;
        if (cancelled) return;
        decodeCache.set(value, res);
        apply(res);
      } catch {
        // Сеть/сервер — марку и модель человек допишет руками; поле VIN
        // при этом сохраняется как есть.
        if (!cancelled) setDecodeFailed(true);
      } finally {
        if (!cancelled) setDecoding(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [value, decode]);

  // ── Что показать под полем ─────────────────────────────────────────────
  const valid = isValidVin(value);
  const partial = value.length > 0 && value.length < VIN_LENGTH;
  const suggestion = decode && onMakeModel ? vinSuggestion(makeModel, decoded) : null;
  const checkDigitWarning = valid ? vinCheckDigitWarning(value) : null;

  let caption: { text: string; tone: 'error' | 'warning' | 'success' | 'info' } | null = null;
  if (error) caption = { text: error, tone: 'error' };
  else if (isSearch) caption = null;
  else if (decodeFailed)
    caption = { text: 'Не удалось расшифровать VIN — марку и модель заполните вручную', tone: 'warning' };
  else if (checkDigitWarning) caption = { text: checkDigitWarning, tone: 'warning' };
  else if (decode && decoded) {
    const t = vinDecodeCaption(decoded);
    if (t) caption = { text: t, tone: decoded.make && decoded.model ? 'success' : 'info' };
  }

  const captionColor =
    caption?.tone === 'error'
      ? colors.red[500]
      : caption?.tone === 'warning'
        ? colors.orange[500]
        : caption?.tone === 'success'
          ? colors.green[600]
          : palette.text.tertiary;

  const accessory = decoding ? (
    <ActivityIndicator size="small" color={palette.accent.primary} />
  ) : partial ? (
    <Text style={[styles.counter, { color: palette.text.tertiary }]}>{vinCounter(value)}</Text>
  ) : valid ? (
    <Ionicons
      name={checkDigitWarning ? 'alert-circle' : 'checkmark-circle'}
      size={18}
      color={checkDigitWarning ? colors.orange[500] : colors.green[600]}
    />
  ) : null;

  return (
    <View style={styles.wrap}>
      <View
        style={[
          isSearch ? styles.fieldSearch : styles.fieldForm,
          isSearch
            ? { backgroundColor: palette.bg.elevated, borderColor: error ? colors.red[400] : palette.border.strong }
            : { backgroundColor: palette.bg.muted, borderColor: error ? colors.red[400] : palette.border.subtle },
          style,
        ]}
      >
        {isSearch && <Ionicons name="barcode-outline" size={20} color={colors.blue[500]} />}
        <TextInput
          ref={inputRef}
          value={text}
          onChangeText={handleChange}
          style={[isSearch ? styles.inputSearch : styles.inputForm, { color: palette.text.primary }]}
          placeholder={placeholder ?? (isSearch ? 'VIN автомобиля' : 'XTA 219010 K0123456')}
          placeholderTextColor={palette.text.tertiary}
          autoCapitalize="characters"
          autoCorrect={false}
          spellCheck={false}
          autoComplete="off"
          importantForAutofill="no"
          textContentType="none"
          // iOS: латинская клавиатура без переключения раскладки — VIN всегда
          // латиница. Android: обычная (кириллические двойники всё равно
          // конвертируются в normalizeVin).
          keyboardType={Platform.OS === 'ios' ? 'ascii-capable' : 'default'}
          autoFocus={autoFocus}
          editable={editable}
          returnKeyType={returnKeyType ?? (isSearch ? 'search' : 'done')}
          onSubmitEditing={onSubmitEditing}
          accessibilityLabel="VIN автомобиля"
        />
        {accessory}
        {isSearch && value.length > 0 && (
          <TouchableOpacity
            onPress={handleClear}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Очистить VIN"
          >
            <Ionicons name="close-circle" size={18} color={palette.text.tertiary} />
          </TouchableOpacity>
        )}
      </View>

      {caption && (
        <Text style={[styles.caption, { color: captionColor }]} numberOfLines={2}>
          {caption.text}
        </Text>
      )}

      {suggestion && onMakeModel && (
        <TouchableOpacity
          onPress={() => {
            haptic('select');
            onMakeModel(suggestion);
          }}
          activeOpacity={0.7}
          style={[styles.chip, { backgroundColor: palette.accent.primarySoft, borderColor: palette.accent.primary }]}
          accessibilityRole="button"
          accessibilityLabel={`Заменить марку и модель на ${suggestion}`}
        >
          <Ionicons name="sparkles-outline" size={13} color={palette.accent.primaryText} />
          <Text style={[styles.chipText, { color: palette.accent.primaryText }]} numberOfLines={1}>
            По VIN: {suggestion}
            <Text style={[styles.chipAction, { color: palette.accent.primaryText }]}> · Заменить</Text>
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing[1.5] },
  // Поле формы — геометрия соседних TextInput'ов форм авто (radius lg, muted).
  fieldForm: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    minHeight: 44,
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3.5],
  },
  // Строка поиска Кассы — та же «primary» роль, что у поля телефона
  // (phoneSearchRow): высота 56, рамка 1.5, radius xl.
  fieldSearch: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    height: 56,
    borderWidth: 1.5,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3.5],
  },
  inputForm: {
    flex: 1,
    minWidth: 0,
    fontFamily: VIN_MONO_FONT,
    fontSize: 16,
    letterSpacing: 0.5,
    paddingVertical: spacing[2.5],
    ...Platform.select({
      android: { paddingTop: spacing[2], paddingBottom: spacing[2], textAlignVertical: 'center' as const },
    }),
  },
  inputSearch: {
    flex: 1,
    minWidth: 0,
    fontFamily: VIN_MONO_FONT,
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: 0.3,
    paddingVertical: 0,
    ...Platform.select({
      android: { paddingTop: 0, paddingBottom: 0, textAlignVertical: 'center' as const },
    }),
  },
  counter: {
    fontSize: 12,
    fontWeight: fontWeight.semibold,
    fontVariant: ['tabular-nums'],
    letterSpacing: 0.2,
  },
  caption: { fontSize: fontSize.xs, lineHeight: 16 },
  chip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    maxWidth: '100%',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing[3],
    paddingVertical: 5,
  },
  chipText: { fontSize: 12, fontWeight: fontWeight.medium, flexShrink: 1 },
  chipAction: { fontWeight: fontWeight.bold },
});
