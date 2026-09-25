/**
 * VinText — VIN моноширинно с группировкой WMI VDS VIS (171, 2026-09-25).
 *
 * Одно место для отображения VIN в карточках и строках авто: гараж клиента,
 * список авто, пикер машины, выбранное авто в Кассе, деталка авто. Показывать
 * или нет — решает родитель: только при включённой опции (`useVinEnabled()`)
 * и когда VIN у машины есть; при выключенной опции ни один экран этот
 * компонент не монтирует.
 *
 * Android-совместимо: моноширинный шрифт через Platform.select.
 */
import React from 'react';
import { Platform, StyleProp, StyleSheet, Text, TextStyle } from 'react-native';
import { formatVin } from '../../../shared/utils/vin';

/** Моноширинный шрифт для VIN — один на все экраны (поле ввода, карточки, строки). */
export const VIN_MONO_FONT = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

interface VinTextProps {
  /** Канонический VIN (normalizeVin). */
  vin: string;
  size?: number;
  color?: string;
  /** Префикс «VIN » — для мест, где рядом нет подписи поля (hero деталки авто). */
  withLabel?: boolean;
  style?: StyleProp<TextStyle>;
}

export default function VinText({ vin, size = 12, color, withLabel = false, style }: VinTextProps) {
  return (
    <Text style={[styles.text, { fontSize: size, color }, style]} numberOfLines={1} accessibilityLabel={`VIN ${vin}`}>
      {withLabel ? 'VIN ' : ''}
      {formatVin(vin)}
    </Text>
  );
}

const styles = StyleSheet.create({
  text: { fontFamily: VIN_MONO_FONT, letterSpacing: 0.4, fontVariant: ['tabular-nums'] },
});
