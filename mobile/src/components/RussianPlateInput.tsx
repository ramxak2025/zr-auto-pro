import React, { useCallback, useMemo, useRef } from 'react';
import { View, TextInput, Text, StyleSheet, Platform } from 'react-native';
import { colors, spacing } from '../theme';
import {
  processPlateInput,
  formatMain,
  splitPlate,
  isValidPlate,
  isRussianInput,
} from '../utils/plateMask';

interface Props {
  value: string;
  onChangeText: (cleanPlate: string) => void;
  onValidPlate?: (plate: string) => void;
  autoFocus?: boolean;
  placeholder?: string;
}

/**
 * Russian license plate input that looks like a real plate.
 *
 * One string under the hood (e.g. "А123АА77"), displayed as two visual
 * blocks: [А 123 АА] | [77 + 🇷🇺 RUS]. Backspace deletes one character
 * from the right, seamlessly crossing the region/main boundary.
 *
 * Latin input auto-converts to Cyrillic (A→А, B→В, etc.).
 * When input doesn't start with a valid plate letter → falls back to
 * plain text input (for foreign plates or free-text search).
 */
export default function RussianPlateInput({
  value,
  onChangeText,
  onValidPlate,
  autoFocus = false,
  placeholder = 'Введите госномер',
}: Props) {
  const inputRef = useRef<TextInput>(null);
  const isRu = useMemo(() => !value || isRussianInput(value), [value]);
  const { main, region } = useMemo(() => splitPlate(value), [value]);

  const handleChange = useCallback(
    (text: string) => {
      if (!isRu && value && !isRussianInput(value)) {
        // Foreign mode: free text
        onChangeText(text.toUpperCase());
        return;
      }

      // Russian mode: process through mask
      // Remove display spaces before processing
      const raw = text.replace(/\s/g, '');
      const clean = processPlateInput(raw);
      onChangeText(clean);

      if (isValidPlate(clean) && onValidPlate) {
        onValidPlate(clean);
      }
    },
    [isRu, value, onChangeText, onValidPlate],
  );

  // Display value: Russian plates get visual formatting, foreign = raw
  const displayValue = useMemo(() => {
    if (!value) return '';
    if (!isRu) return value;
    const { main: m, region: r } = splitPlate(value);
    return r ? `${formatMain(m)} ${r}` : formatMain(m);
  }, [value, isRu]);

  if (!isRu && value) {
    // Foreign plate — simple styled input
    return (
      <View style={[styles.plateContainer, styles.plateForeign]}>
        <View style={styles.foreignStrip}>
          <Text style={styles.foreignStripText}>INT</Text>
        </View>
        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={handleChange}
          style={styles.foreignInput}
          placeholder={placeholder}
          placeholderTextColor={colors.gray[300]}
          autoCapitalize="characters"
          autoCorrect={false}
          autoFocus={autoFocus}
          maxLength={20}
          returnKeyType="search"
        />
      </View>
    );
  }

  // Russian plate — visual plate design
  return (
    <View style={styles.plateContainer}>
      {/* Main section */}
      <View style={styles.mainSection}>
        <TextInput
          ref={inputRef}
          value={displayValue}
          onChangeText={handleChange}
          style={styles.mainInput}
          placeholder="А 000 АА"
          placeholderTextColor={colors.gray[300]}
          autoCapitalize="characters"
          autoCorrect={false}
          autoFocus={autoFocus}
          maxLength={14} // "А 123 АА 177" = 12 chars + buffer
          returnKeyType="search"
        />
      </View>

      {/* Divider */}
      <View style={styles.divider} />

      {/* Region section */}
      <View style={styles.regionSection}>
        <Text style={[styles.regionText, !region && styles.regionPlaceholder]}>
          {region || '00'}
        </Text>
        {/* Russian flag */}
        <View style={styles.flagRow}>
          <View style={[styles.flagBand, { backgroundColor: '#fff' }]} />
          <View style={[styles.flagBand, { backgroundColor: '#0039A6' }]} />
          <View style={[styles.flagBand, { backgroundColor: '#D52B1E' }]} />
        </View>
        <Text style={styles.rusLabel}>RUS</Text>
      </View>
    </View>
  );
}

const PLATE_HEIGHT = 56;

const styles = StyleSheet.create({
  plateContainer: {
    flexDirection: 'row',
    height: PLATE_HEIGHT,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#1a1a1a',
    borderRadius: 6,
    overflow: 'hidden',
  },
  plateForeign: {
    borderColor: colors.blue[500],
  },

  // ── Main section (А 123 АА) ──
  mainSection: {
    flex: 1,
    justifyContent: 'center',
  },
  mainInput: {
    fontSize: 22,
    fontWeight: '800',
    color: '#1a1a1a',
    textAlign: 'center',
    letterSpacing: Platform.OS === 'ios' ? 3 : 2,
    paddingHorizontal: spacing[2],
    paddingVertical: 0,
    ...Platform.select({
      android: { paddingTop: 0, paddingBottom: 0, textAlignVertical: 'center' },
    }),
  },

  // ── Divider ──
  divider: {
    width: 2,
    backgroundColor: '#1a1a1a',
  },

  // ── Region section (77 + flag + RUS) ──
  regionSection: {
    width: 58,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 3,
  },
  regionText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1a1a1a',
    letterSpacing: 2,
    textAlign: 'center',
  },
  regionPlaceholder: {
    color: colors.gray[300],
  },
  flagRow: {
    flexDirection: 'row',
    marginTop: 2,
  },
  flagBand: {
    width: 10,
    height: 3,
    borderRadius: 0.5,
  },
  rusLabel: {
    fontSize: 6,
    fontWeight: '900',
    color: '#1a1a1a',
    letterSpacing: 1,
    marginTop: 1,
  },

  // ── Foreign plate ──
  foreignStrip: {
    width: 28,
    backgroundColor: colors.blue[500],
    alignItems: 'center',
    justifyContent: 'center',
  },
  foreignStripText: {
    fontSize: 8,
    fontWeight: '900',
    color: '#fff',
    letterSpacing: 0.5,
  },
  foreignInput: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: '#1a1a1a',
    paddingHorizontal: spacing[3],
    letterSpacing: 2,
  },
});
