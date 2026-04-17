import React, { useState, useCallback } from 'react';
import { View, TextInput, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';

// Valid Russian plate letters (Cyrillic that have Latin lookalikes)
const RU_LETTERS = 'АВЕКМНОРСТУХ';
// Latin → Cyrillic map for auto-conversion
const LAT_TO_CYR: Record<string, string> = {
  A: 'А', B: 'В', E: 'Е', K: 'К', M: 'М', H: 'Н',
  O: 'О', P: 'Р', C: 'С', T: 'Т', Y: 'У', X: 'Х',
};

function normalizePlate(raw: string): string {
  return raw
    .toUpperCase()
    .split('')
    .map((ch) => LAT_TO_CYR[ch] || ch)
    .join('');
}

/** Format plate into visual segments: А 123 ВС 77 */
function formatRussianPlate(plate: string): string {
  const clean = normalizePlate(plate.replace(/\s/g, ''));
  if (clean.length === 0) return '';

  // Standard Russian plate: X 000 XX 00(0)
  const match = clean.match(/^([АВЕКМНОРСТУХ])(\d{0,3})([АВЕКМНОРСТУХ]{0,2})(\d{0,3})$/);
  if (match) {
    const parts = [match[1], match[2], match[3], match[4]].filter(Boolean);
    return parts.join(' ');
  }

  return clean;
}

function isRussianPlateStart(text: string): boolean {
  const norm = normalizePlate(text.replace(/\s/g, ''));
  if (!norm) return false;
  return RU_LETTERS.includes(norm[0]);
}

interface Props {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}

export default function RussianPlateInput({ value, onChangeText, placeholder, autoFocus }: Props) {
  const [isForeign, setIsForeign] = useState(false);
  const isRussian = !isForeign && (value.length === 0 || isRussianPlateStart(value));

  const handleChange = useCallback(
    (text: string) => {
      if (isForeign) {
        onChangeText(text.toUpperCase());
        return;
      }
      // Normalize Latin → Cyrillic, strip spaces for internal value
      const norm = normalizePlate(text.replace(/\s/g, ''));
      // Limit to max plate length (9 chars: X000XX000)
      onChangeText(norm.slice(0, 9));
    },
    [isForeign, onChangeText],
  );

  const displayValue = isRussian ? formatRussianPlate(value) : value;

  return (
    <View>
      <View style={styles.plateContainer}>
        {/* Russian flag strip */}
        {isRussian && (
          <View style={styles.flagStrip}>
            <View style={[styles.flagBand, { backgroundColor: '#fff' }]} />
            <View style={[styles.flagBand, { backgroundColor: '#0039A6' }]} />
            <View style={[styles.flagBand, { backgroundColor: '#D52B1E' }]} />
            <Text style={styles.flagText}>RUS</Text>
          </View>
        )}

        <TextInput
          value={displayValue}
          onChangeText={handleChange}
          style={[styles.plateInput, isRussian && styles.plateInputRu]}
          placeholder={isRussian ? 'А 000 АА 00' : (placeholder || 'Номер')}
          placeholderTextColor={colors.gray[300]}
          autoCapitalize="characters"
          autoCorrect={false}
          autoFocus={autoFocus}
          maxLength={isForeign ? 20 : 12}
        />
      </View>

      {/* Toggle Russian / Foreign */}
      <TouchableOpacity
        style={styles.toggleRow}
        onPress={() => {
          setIsForeign(!isForeign);
          onChangeText('');
        }}
        activeOpacity={0.7}
      >
        <Ionicons
          name={isForeign ? 'flag-outline' : 'globe-outline'}
          size={14}
          color={colors.gray[500]}
        />
        <Text style={styles.toggleText}>
          {isForeign ? 'Российский номер' : 'Иностранный номер'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  plateContainer: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: colors.gray[900],
    borderRadius: borderRadius.lg,
    overflow: 'hidden',
    alignItems: 'center',
  },
  flagStrip: {
    width: 32,
    backgroundColor: colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[2],
    borderRightWidth: 1,
    borderRightColor: colors.gray[300],
  },
  flagBand: {
    width: 18,
    height: 4,
  },
  flagText: {
    fontSize: 7,
    fontWeight: '700',
    color: colors.gray[700],
    marginTop: 2,
    letterSpacing: 0.5,
  },
  plateInput: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: colors.gray[900],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    letterSpacing: 2,
    fontFamily: undefined, // system monospace-like via letterSpacing
  },
  plateInputRu: {
    textAlign: 'center',
    letterSpacing: 3,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    paddingTop: spacing[2],
    paddingLeft: spacing[1],
  },
  toggleText: {
    fontSize: fontSize.xs,
    color: colors.gray[500],
    fontWeight: fontWeight.medium,
  },
});
