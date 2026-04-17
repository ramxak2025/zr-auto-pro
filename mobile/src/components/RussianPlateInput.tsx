import React, { useMemo } from 'react';
import { View, TextInput, Text, StyleSheet } from 'react-native';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';

const CYR_PLATE_LETTERS = new Set('АВЕКМНОРСТУХ'.split(''));

/** Auto-detect by first character: Cyrillic → Russian plate design, Latin → foreign */
function detectMode(text: string): 'ru' | 'foreign' | 'empty' {
  const clean = text.replace(/\s/g, '').toUpperCase();
  if (!clean) return 'empty';
  const first = clean[0];
  if (CYR_PLATE_LETTERS.has(first)) return 'ru';
  return 'foreign';
}

/** Format a Russian-style plate into visual segments: А 123 ВС 77 */
function formatRuPlate(raw: string): string {
  const clean = raw.replace(/\s/g, '').toUpperCase();
  if (!clean) return '';
  const m = clean.match(/^([АВЕКМНОРСТУХ])(\d{0,3})([АВЕКМНОРСТУХ]{0,2})(\d{0,3})(.*)$/);
  if (m) return [m[1], m[2], m[3], m[4], m[5]].filter(Boolean).join(' ');
  return clean;
}

interface Props {
  value: string;
  onChangeText: (text: string) => void;
  onSubmitSearch?: (query: string) => void;
  autoFocus?: boolean;
}

export default function RussianPlateInput({ value, onChangeText, onSubmitSearch, autoFocus }: Props) {
  const mode = useMemo(() => detectMode(value), [value]);
  const isRu = mode === 'ru';
  const isEmpty = mode === 'empty';

  const handleChange = (text: string) => {
    const upper = text.toUpperCase();
    // No conversion — store exactly what user typed
    onChangeText(upper);
  };

  // For display only: add visual spacing to Russian plates
  const displayValue = isRu ? formatRuPlate(value) : value;

  return (
    <View style={styles.wrapper}>
      <View style={[styles.plateContainer, isRu ? styles.plateRu : isEmpty ? styles.plateEmpty : styles.plateForeign]}>
        {/* Russian flag strip — shown when Cyrillic detected */}
        {isRu && (
          <View style={styles.flagStrip}>
            <View style={[styles.flagBand, { backgroundColor: '#fff' }]} />
            <View style={[styles.flagBand, { backgroundColor: '#0039A6' }]} />
            <View style={[styles.flagBand, { backgroundColor: '#D52B1E' }]} />
            <Text style={styles.flagText}>RUS</Text>
          </View>
        )}

        {/* Foreign plate icon */}
        {!isRu && !isEmpty && (
          <View style={styles.foreignStrip}>
            <Text style={styles.foreignStripText}>INT</Text>
          </View>
        )}

        <TextInput
          value={displayValue}
          onChangeText={handleChange}
          onSubmitEditing={() => onSubmitSearch?.(value)}
          style={[styles.plateInput, isRu && styles.plateInputRu, !isRu && !isEmpty && styles.plateInputForeign]}
          placeholder={'\u0413\u043E\u0441\u043D\u043E\u043C\u0435\u0440, \u0438\u043C\u044F \u0438\u043B\u0438 \u0442\u0435\u043B\u0435\u0444\u043E\u043D'}
          placeholderTextColor={colors.gray[300]}
          autoCapitalize="characters"
          autoCorrect={false}
          autoFocus={autoFocus}
          returnKeyType="search"
          maxLength={20}
        />
      </View>

      {/* Hint text */}
      <Text style={styles.hint}>
        {isEmpty
          ? 'Начните вводить кириллицей (РФ) или латиницей (иностранный)'
          : isRu
            ? '\u0420\u043E\u0441\u0441\u0438\u0439\u0441\u043A\u0438\u0439 \u043D\u043E\u043C\u0435\u0440'
            : '\u0418\u043D\u043E\u0441\u0442\u0440\u0430\u043D\u043D\u044B\u0439 \u043D\u043E\u043C\u0435\u0440'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {},
  plateContainer: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderWidth: 2,
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    alignItems: 'center',
  },
  plateRu: {
    borderColor: colors.gray[900],
  },
  plateForeign: {
    borderColor: colors.blue[500],
  },
  plateEmpty: {
    borderColor: colors.gray[200],
  },
  flagStrip: {
    width: 30,
    backgroundColor: colors.gray[50],
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[2],
    borderRightWidth: 1,
    borderRightColor: colors.gray[200],
  },
  flagBand: { width: 16, height: 3.5, borderRadius: 0.5 },
  flagText: { fontSize: 6.5, fontWeight: '800', color: colors.gray[700], marginTop: 1.5, letterSpacing: 0.5 },
  foreignStrip: {
    width: 30,
    backgroundColor: colors.blue[50],
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[2],
    borderRightWidth: 1,
    borderRightColor: colors.blue[200],
  },
  foreignStripText: { fontSize: 7, fontWeight: '800', color: colors.blue[600], letterSpacing: 0.5 },
  plateInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: colors.gray[900],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    letterSpacing: 1,
  },
  plateInputRu: {
    textAlign: 'center',
    fontSize: 20,
    letterSpacing: 3,
  },
  plateInputForeign: {
    letterSpacing: 1.5,
  },
  hint: {
    fontSize: 11,
    color: colors.gray[400],
    marginTop: spacing[1.5],
    marginLeft: spacing[1],
  },
});
