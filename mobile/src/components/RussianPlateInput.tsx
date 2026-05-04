import React, { useCallback, useMemo, useRef } from 'react';
import { View, TextInput, Text, StyleSheet, Platform } from 'react-native';
import { colors, spacing } from '../theme';
import {
  processPlateInput,
  formatMain,
  splitPlate,
  isValidPlate,
  isRussianInput,
  normalizeForeignPlate,
} from '../utils/plateMask';

export type PlateMode = 'ru' | 'foreign';

interface Props {
  value: string;
  onChangeText: (cleanPlate: string) => void;
  onValidPlate?: (plate: string) => void;
  autoFocus?: boolean;
  placeholder?: string;
  /**
   * Explicit mode. When provided, the input is locked to this mode and
   * does NOT auto-switch based on value. Recommended — pair with
   * <PlateModeSwitcher /> from the parent.
   *
   * When undefined, falls back to legacy auto-detect via isRussianInput()
   * (kept for backwards compatibility).
   */
  mode?: PlateMode;
}

/**
 * Russian / foreign license plate input.
 *
 * - mode='ru' (or auto-detected) — Russian visual plate with main+region split.
 *   Latin chars auto-convert to Cyrillic. Region NEVER duplicates inside
 *   main: splitPlate() makes sure last 2-3 digits live in the right block
 *   only.
 * - mode='foreign' — free-text uppercase with INT marker on the left.
 *   No Cyrillic conversion.
 */
export default function RussianPlateInput({
  value,
  onChangeText,
  onValidPlate,
  autoFocus = false,
  placeholder = 'Введите госномер',
  mode,
}: Props) {
  const inputRef = useRef<TextInput>(null);

  // Resolve effective mode:
  //   - explicit prop wins
  //   - else: legacy auto-detect (kept for unmigrated screens)
  const effectiveMode: PlateMode = mode ?? (
    !value || isRussianInput(value) ? 'ru' : 'foreign'
  );
  const isRu = effectiveMode === 'ru';

  const { region } = useMemo(() => splitPlate(value), [value]);

  const handleChange = useCallback(
    (text: string) => {
      if (!isRu) {
        onChangeText(normalizeForeignPlate(text));
        return;
      }
      const raw = text.replace(/\s/g, '');
      const clean = processPlateInput(raw);
      onChangeText(clean);

      if (isValidPlate(clean) && onValidPlate) {
        onValidPlate(clean);
      }
    },
    [isRu, onChangeText, onValidPlate],
  );

  // Display value: Russian gets visual formatting, foreign = raw
  const displayValue = useMemo(() => {
    if (!value) return '';
    if (!isRu) return value;
    const { main: m, region: r } = splitPlate(value);
    return r ? `${formatMain(m)} ${r}` : formatMain(m);
  }, [value, isRu]);

  if (!isRu) {
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

  return (
    <View style={styles.plateContainer}>
      {/* Main section (А 123 АА) — region lives in the right block only */}
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
          maxLength={14} // "А 123 АА 177" buffer
          returnKeyType="search"
        />
      </View>

      <View style={styles.divider} />

      {/* Region section (77 + flag + RUS) */}
      <View style={styles.regionSection}>
        <Text style={[styles.regionText, !region && styles.regionPlaceholder]}>
          {region || '00'}
        </Text>
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
