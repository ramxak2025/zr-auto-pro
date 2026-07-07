import React, { useEffect, useRef, useState } from 'react';
import { StyleProp, TextInput, TextStyle } from 'react-native';
import { MIN_QTY, formatQty, parseQtyInput } from '../utils/units';

/**
 * QtyInput — редактируемое поле количества строки (дробные количества, 120).
 *
 * Контролируемый инпут (`value={String(qty)}` + пере-парс на каждом символе)
 * физически не даёт набрать дробь: «0.» парсится в 0 → мгновенно перерисовывается
 * как «0», точка съедается. Поэтому черновик текста живёт ЛОКАЛЬНО: наверх
 * коммитим каждое валидное значение в диапазоне [min; max], а на blur нормализуем
 * отображение («2,» → «2», пусто/мусор → последнее валидное). Запятая = точка
 * (RU decimal-pad), глубже 3 знаков не уходит (parseQtyInput округляет — ровно
 * NUMERIC(12,3)).
 *
 * Внешние ±-степперы продолжают работать: пока поле не в фокусе, изменения
 * `value` синхронизируются в черновик через эффект.
 *
 * Android-safe: чистый RN TextInput, никаких iOS-only API.
 */
interface QtyInputProps {
  value: number;
  onCommit: (n: number) => void;
  style?: StyleProp<TextStyle>;
  /** Нижняя граница (например, уже принятое количество). По умолчанию MIN_QTY (0.001). */
  min?: number;
  /** Верхняя граница (например, остаток к приёмке). По умолчанию без ограничения. */
  max?: number;
  placeholder?: string;
  placeholderTextColor?: string;
}

export default function QtyInput({
  value,
  onCommit,
  style,
  min = MIN_QTY,
  max = Infinity,
  placeholder,
  placeholderTextColor,
}: QtyInputProps) {
  const [text, setText] = useState(() => formatQty(value));
  const focusedRef = useRef(false);
  useEffect(() => {
    if (!focusedRef.current) setText(formatQty(value));
  }, [value]);
  return (
    <TextInput
      value={text}
      onChangeText={(v) => {
        setText(v);
        const n = parseQtyInput(v);
        if (n !== null && n >= min && n <= max) onCommit(n);
      }}
      onFocus={() => {
        focusedRef.current = true;
      }}
      onBlur={() => {
        focusedRef.current = false;
        const n = parseQtyInput(text);
        if (n === null || n < min) {
          setText(formatQty(value));
        } else {
          const clamped = Math.min(n, max);
          setText(formatQty(clamped));
          onCommit(clamped);
        }
      }}
      style={style}
      keyboardType="decimal-pad"
      selectTextOnFocus
      placeholder={placeholder}
      placeholderTextColor={placeholderTextColor}
    />
  );
}
