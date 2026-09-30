/**
 * StorageCellChip — код ячейки хранения в строке товара (2026-09-30).
 *
 * Одно место для склада, подбора в Кассе и инвентаризации: моноширинный код мелким
 * шрифтом на приглушённой плашке. Без ячейки компонент ничего не рисует, поэтому
 * строка товара без адреса выглядит ровно как раньше.
 *
 * Плашка ужимается ПЕРВОЙ (`flexShrink` + `maxWidth`): цена и остаток соседних
 * блоков она не сдвигает, длинный код обрезается многоточием. Высота ≤ 16 pt —
 * влезает в строку цены (18 pt) карточки склада, её высота 76 pt не меняется.
 *
 * Цвета — токены темы (`bg.muted`, `text.secondary`), не константы. Android-совместимо:
 * моноширинный шрифт через Platform.select.
 */
import React from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useColors } from '../contexts/ThemeContext';
import { borderRadius } from '../theme';
import { VIN_MONO_FONT } from './VinText';

/** Моноширинный шрифт кода ячейки — тот же, что у VIN: выравнивает «A-1-2» и «A-1-10» в столбик. */
export const CELL_CODE_FONT = VIN_MONO_FONT;

interface StorageCellChipProps {
  /** Код ячейки; пусто / `null` — плашки нет. */
  code: string | null | undefined;
  style?: StyleProp<ViewStyle>;
}

function StorageCellChip({ code, style }: StorageCellChipProps) {
  const palette = useColors();
  if (!code) return null;
  return (
    <View
      style={[styles.chip, { backgroundColor: palette.bg.muted }, style]}
      accessible
      accessibilityLabel={`Ячейка ${code}`}
    >
      <Text style={[styles.text, { color: palette.text.secondary }]} numberOfLines={1} ellipsizeMode="tail">
        {code}
      </Text>
    </View>
  );
}

export default React.memo(StorageCellChip);

const styles = StyleSheet.create({
  chip: {
    flexShrink: 1,
    minWidth: 0,
    maxWidth: 104,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: borderRadius.md,
  },
  text: {
    fontFamily: CELL_CODE_FONT,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    letterSpacing: 0.3,
    fontVariant: ['tabular-nums'],
  },
});
