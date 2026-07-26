import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, TextInput, Text, StyleSheet, Platform } from 'react-native';
import { colors, spacing } from '../theme';
import {
  processPlateMainInput,
  processPlateRegionInput,
  processPlateInput,
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

  // ── Decoupled local buffer (fix C) ──
  // The MAIN/REGION text lives in local state, NOT read straight from the
  // `value` prop on every keystroke. Previously `value` round-tripped through
  // the heavy CheckCreateScreen (~4200 lines, async setState) and came back
  // late; on Fabric a controlled TextInput whose value lags desyncs
  // `mostRecentEventCount` and swaps a just-typed letter with its neighbour.
  // Now each keystroke updates local state synchronously (instant, local
  // re-render of this tiny component) and only THEN propagates the normalized
  // clean plate upward via onChangeText — the async round-trip window is gone.
  const [mainClean, setMainClean] = useState<string>(() => splitPlate(value).main);
  const [regionClean, setRegionClean] = useState<string>(() => splitPlate(value).region);
  // ── No controlled caret — deliberately. ──
  // A previous fix pinned the caret via a `selection` state prop updated on
  // every keystroke. On Fabric the React commit of that prop is ASYNC: the
  // {3,3} pinned for keystroke «8» landed on native AFTER «0» was typed
  // (native already at «Х 80», caret 4), rolled the caret back to 3, and the
  // next «7» inserted at the stale position → «Х 870» instead of «Х 807».
  // Native owns the caret now. iOS/Android both keep it correct for append
  // and backspace, and place it at the end when we rewrite `value` (space
  // insertion «Х8»→«Х 8», latin→cyrillic mapping) — which is exactly the
  // desired landing spot. If a caret correction is ever needed again, do it
  // IMPERATIVELY (ref.setSelection / dispatchCommand in the same tick),
  // never through a state-driven `selection` prop.
  // Ring of values WE emitted whose echo through the (pass-through) parent may
  // still be in flight. The parent (`setPlateSearch`) bounces every emitted
  // value straight back into `value`; during fast typing several emits are in
  // flight at once. A single-slot guard only remembers the LATEST emit, so the
  // echo of an EARLIER one looks external and resyncs the buffer to a stale
  // value — the intermittent «прыгающая буква». Recognising ANY recent
  // self-emit (and pruning it once its echo passes) closes that window, while
  // still resyncing on a genuinely external change (X clear, client/car
  // selected, editing an existing record).
  const emittedRef = useRef<string[]>([value]);
  const rememberEmit = useCallback((next: string) => {
    const ring = emittedRef.current;
    ring.push(next);
    // Cap: a full plate is at most ~9 emits from empty; 16 leaves generous head-
    // room for in-flight echoes without ever growing unbounded.
    if (ring.length > 16) ring.shift();
  }, []);

  useEffect(() => {
    const ring = emittedRef.current;
    const idx = ring.indexOf(value);
    if (idx !== -1) {
      // Echo of one of our own emits. Drop it and everything it superseded, but
      // keep newer still-in-flight emits so their echoes are recognised too.
      // Never resync from our own echo — the local buffer is already ahead.
      emittedRef.current = ring.slice(idx + 1);
      return;
    }
    // Genuinely external value.
    const { main: m, region: r } = splitPlate(value);
    setMainClean(m);
    setRegionClean(r);
    emittedRef.current = [];
  }, [value]);

  // On a RU↔INT mode flip, re-derive the RU buffers from the current `value`.
  // Foreign edits (handleForeignChange) intentionally never touch mainClean/
  // regionClean, so without this a plate typed in RU, then edited in INT, would
  // leave the RU buffers stale when the user switches back. Re-parsing through
  // the RU mask yields a consistent partial (or empty) buffer instead.
  useEffect(() => {
    const { main: m, region: r } = splitPlate(processPlateInput(value.replace(/\s/g, '')));
    setMainClean(m);
    setRegionClean(r);
    // Intentionally keyed on the mode only — `value` sync is owned by the effect
    // above; re-deriving here on every keystroke would fight the caret logic.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveMode]);

  const mainDisplay = useMemo(() => formatMain(mainClean), [mainClean]);

  const emit = useCallback(
    (nextMain: string, nextRegion: string) => {
      const next = combinePlate(nextMain, nextRegion);
      rememberEmit(next);
      onChangeText(next);
      if (isValidPlate(next) && onValidPlate) onValidPlate(next);
    },
    [onChangeText, onValidPlate, rememberEmit],
  );

  const handleMainChange = useCallback(
    (text: string) => {
      const raw = text.replace(/\s/g, '');
      const cleanMain = processPlateMainInput(raw);
      const wasComplete = mainClean.length >= 6;
      setMainClean(cleanMain);
      // Caret is native-owned (see comment at the top of the component).
      // When the formatted value differs from what native holds (space
      // insertion, latin→cyrillic), iOS/Android place the caret at the end
      // of the rewritten text — correct for append typing, backspace and
      // single-char substitution alike.
      emit(cleanMain, regionClean);
      // Auto-advance to region once main is complete
      if (cleanMain.length === 6 && !wasComplete) {
        setTimeout(() => regionRef.current?.focus(), 0);
      }
    },
    [mainClean.length, regionClean, emit],
  );

  const handleRegionChange = useCallback(
    (text: string) => {
      const cleanRegion = processPlateRegionInput(text);
      setRegionClean(cleanRegion);
      emit(mainClean, cleanRegion);
    },
    [mainClean, emit],
  );

  // Backspace on an empty region jumps focus back to main
  const handleRegionKeyPress = useCallback(
    (e: { nativeEvent: { key: string } }) => {
      if (e.nativeEvent.key === 'Backspace' && regionClean.length === 0) {
        mainRef.current?.focus();
      }
    },
    [regionClean.length],
  );

  const handleForeignChange = useCallback(
    (text: string) => {
      const next = normalizeForeignPlate(text);
      rememberEmit(next);
      onChangeText(next);
    },
    [onChangeText, rememberEmit],
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
          spellCheck={false}
          textContentType="none"
          autoComplete="off"
          importantForAutofill="no"
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
        // (fix D) Kill any IME / autofill / suggestion substitution — a stray
        // keyboard suggestion was another way a typed letter got replaced.
        spellCheck={false}
        textContentType="none"
        autoComplete="off"
        importantForAutofill="no"
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
          value={regionClean}
          onChangeText={handleRegionChange}
          onKeyPress={handleRegionKeyPress}
          style={styles.regionInput}
          placeholder="00"
          placeholderTextColor={colors.gray[300]}
          keyboardType="number-pad"
          autoComplete="off"
          importantForAutofill="no"
          textContentType="none"
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
