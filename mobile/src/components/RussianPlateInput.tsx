import React, { useCallback, useMemo, useRef } from 'react';
import { View, TextInput, Text, StyleSheet, Platform } from 'react-native';
import { colors, spacing } from '../theme';
import {
  processPlateMainInput,
  processPlateRegionInput,
  combinePlate,
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
   * When undefined, falls back to legacy auto-detect via isRussianInput().
   */
  mode?: PlateMode;
}

/**
 * Russian / foreign license plate input.
 *
 * RU mode renders TWO independent <TextInput> blocks — main (А 123 АА) and
 * region (77) — visually divided by a 2px black line. The parent receives
 * a single clean string ('А123АА77') so backend search and storage stay
 * unchanged. The previous implementation kept everything in one TextInput
 * and ALSO rendered the region in a separate <Text>, which caused the
 * region to appear twice on screen ('Р 332 РА 05 | 05'). Splitting into
 * two separate fields makes the duplicate impossible by construction.
 *
 * Foreign mode is a simple uppercase free-text input with an INT marker.
 *
 * Region tip: when the user fills the main block (6 chars), focus is
 * automatically forwarded to the region. Backspace at the start of the
 * empty region returns focus to main.
 */
export default function RussianPlateInput({
  value,
  onChangeText,
  onValidPlate,
  autoFocus = false,
  placeholder = 'Введите госномер',
  mode,
}: Props) {
  const mainRef = useRef<TextInput>(null);
  const regionRef = useRef<TextInput>(null);

  const effectiveMode: PlateMode = mode ?? (!value || isRussianInput(value) ? 'ru' : 'foreign');
  const isRu = effectiveMode === 'ru';

  const { main, region } = useMemo(() => splitPlate(value), [value]);
  const mainDisplay = useMemo(() => formatMain(main), [main]);

  const handleMainChange = useCallback(
    (text: string) => {
      const raw = text.replace(/\s/g, '');
      const cleanMain = processPlateMainInput(raw);
      const next = combinePlate(cleanMain, region);
      onChangeText(next);
      // Auto-advance to region once main is complete
      if (cleanMain.length === 6 && main.length < 6) {
        setTimeout(() => regionRef.current?.focus(), 0);
      }
      if (isValidPlate(next) && onValidPlate) onValidPlate(next);
    },
    [region, main.length, onChangeText, onValidPlate],
  );

  const handleRegionChange = useCallback(
    (text: string) => {
      const cleanRegion = processPlateRegionInput(text);
      const next = combinePlate(main, cleanRegion);
      onChangeText(next);
      if (isValidPlate(next) && onValidPlate) onValidPlate(next);
    },
    [main, onChangeText, onValidPlate],
  );

  // Backspace on an empty region jumps focus back to main
  const handleRegionKeyPress = useCallback(
    (e: { nativeEvent: { key: string } }) => {
      if (e.nativeEvent.key === 'Backspace' && region.length === 0) {
        mainRef.current?.focus();
      }
    },
    [region.length],
  );

  const handleForeignChange = useCallback(
    (text: string) => {
      onChangeText(normalizeForeignPlate(text));
    },
    [onChangeText],
  );

  if (!isRu) {
    return (
      <View style={[styles.plateContainer, styles.plateForeign]}>
        <View style={styles.foreignStrip}>
          <Text style={styles.foreignStripText}>INT</Text>
        </View>
        <TextInput
          value={value}
          onChangeText={handleForeignChange}
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
      {/* MAIN block — 1 letter + 3 digits + 2 letters, never carries the region */}
      <TextInput
        ref={mainRef}
        value={mainDisplay}
        onChangeText={handleMainChange}
        style={styles.mainInput}
        placeholder="А 000 АА"
        placeholderTextColor={colors.gray[300]}
        autoCapitalize="characters"
        autoCorrect={false}
        autoFocus={autoFocus}
        maxLength={8} // "А 000 АА" = 8 visible chars
        returnKeyType="next"
        onSubmitEditing={() => regionRef.current?.focus()}
      />

      {/* Vertical divider */}
      <View style={styles.divider} />

      {/* REGION block — 2-3 digits only */}
      <View style={styles.regionSection}>
        <TextInput
          ref={regionRef}
          value={region}
          onChangeText={handleRegionChange}
          onKeyPress={handleRegionKeyPress}
          style={styles.regionInput}
          placeholder="00"
          placeholderTextColor={colors.gray[300]}
          keyboardType="number-pad"
          maxLength={3}
          returnKeyType="search"
        />
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

// Visual replica of a real Russian plate, calibrated against physical
// iPhone testing. ГОСТ Р 50577-93 sets the right-hand strip as a square
// (height = 1 × plate height) with three stacked elements: region digits
// (top), tricolor flag (middle), RUS legend (bottom). Earlier 56pt+64pt
// strip cramped them — bumped to 64pt plate + 76pt strip + space-between
// distribution so each element gets real breathing room.
const PLATE_HEIGHT = 64;
const PLATE_REGION_WIDTH = 76;

const styles = StyleSheet.create({
  plateContainer: {
    flexDirection: 'row',
    height: PLATE_HEIGHT,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#0A0A0A',
    borderRadius: 8,
    overflow: 'hidden',
  },
  plateForeign: {
    borderColor: colors.blue[500],
  },

  // ── Main input (А 123 АА) ──
  // Slightly smaller font + more H-padding gives the GOST letters
  // breathing room from the rim. The 1.6 letterSpacing matches the
  // tracking of the open-source RoadNumbers font used by Ministry of
  // Internal Affairs source plates.
  mainInput: {
    flex: 1,
    fontSize: 30,
    fontWeight: '800',
    color: '#000000',
    textAlign: 'center',
    letterSpacing: Platform.OS === 'ios' ? 1.6 : 1.2,
    paddingHorizontal: spacing[3],
    paddingVertical: 0,
    ...Platform.select({
      android: { paddingTop: 0, paddingBottom: 0, textAlignVertical: 'center' },
    }),
  },

  // ── Divider ──
  divider: {
    width: 2,
    backgroundColor: '#0A0A0A',
  },

  // ── Region (77 + flag + RUS) ──
  // Square strip per ГОСТ. justifyContent='space-between' distributes
  // the three elements top→middle→bottom, giving each its own band of
  // breathing room. Internal padding pulls them off the rim.
  regionSection: {
    width: PLATE_REGION_WIDTH,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
    paddingHorizontal: 5,
  },
  regionInput: {
    fontSize: 28,
    fontWeight: '800',
    color: '#000000',
    letterSpacing: 0.8,
    textAlign: 'center',
    paddingVertical: 0,
    paddingHorizontal: 0,
    width: '100%',
    lineHeight: 30,
    ...Platform.select({
      android: { paddingTop: 0, paddingBottom: 0, textAlignVertical: 'center' },
    }),
  },
  flagRow: {
    flexDirection: 'column',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#0A0A0A',
  },
  flagBand: {
    width: 28,
    height: 3.6,
  },
  rusLabel: {
    fontSize: 11,
    fontWeight: '900',
    color: '#000000',
    letterSpacing: 1.4,
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
