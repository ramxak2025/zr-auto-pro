import React, { useMemo } from 'react';
import { View, TextInput, Text, StyleSheet } from 'react-native';
import { colors, spacing } from '../theme';

const CYR_PLATE = new Set('АВЕКМНОРСТУХ'.split(''));

function detectMode(text: string): 'ru' | 'foreign' | 'empty' {
  const clean = text.replace(/\s/g, '').toUpperCase();
  if (!clean) return 'empty';
  return CYR_PLATE.has(clean[0]) ? 'ru' : 'foreign';
}

/** Split Russian plate into main part + region: А123ВС → main, 77 → region */
function splitRuPlate(raw: string): { main: string; region: string } {
  const clean = raw.replace(/\s/g, '').toUpperCase();
  // Pattern: 1 letter + 3 digits + 2 letters + 2-3 digit region
  const m = clean.match(/^([АВЕКМНОРСТУХ]\d{0,3}[АВЕКМНОРСТУХ]{0,2})(\d{0,3})$/);
  if (m) return { main: m[1], region: m[2] };
  return { main: clean, region: '' };
}

/** Format main part with spaces: А123ВС → А 123 ВС */
function fmtMain(s: string): string {
  const m = s.match(/^([АВЕКМНОРСТУХ])(\d{0,3})([АВЕКМНОРСТУХ]{0,2})$/);
  if (m) return [m[1], m[2], m[3]].filter(Boolean).join(' ');
  return s;
}

interface Props {
  value: string;
  onChangeText: (text: string) => void;
  autoFocus?: boolean;
}

export default function RussianPlateInput({ value, onChangeText, autoFocus }: Props) {
  const mode = useMemo(() => detectMode(value), [value]);
  const isRu = mode === 'ru';
  const { main, region } = useMemo(() => (isRu ? splitRuPlate(value) : { main: value, region: '' }), [value, isRu]);

  const handleChange = (text: string) => {
    onChangeText(text.toUpperCase().slice(0, 20));
  };

  // For Russian: show formatted main + region separately
  // For foreign/empty: single input
  if (isRu) {
    return (
      <View style={styles.ruPlate}>
        {/* Main section: А 123 ВС */}
        <View style={styles.ruMain}>
          <TextInput
            value={fmtMain(main)}
            onChangeText={(t) => {
              const stripped = t.replace(/\s/g, '').toUpperCase();
              // Reconstruct full value: main + region
              onChangeText((stripped + region).slice(0, 9));
            }}
            style={styles.ruMainInput}
            placeholder="А 000 АА"
            placeholderTextColor={colors.gray[300]}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus={autoFocus}
            maxLength={10}
          />
        </View>

        {/* Divider */}
        <View style={styles.ruDivider} />

        {/* Region section: 77 + flag + RUS */}
        <View style={styles.ruRegion}>
          <TextInput
            value={region}
            onChangeText={(t) => {
              const digits = t.replace(/\D/g, '').slice(0, 3);
              onChangeText(main + digits);
            }}
            style={styles.ruRegionInput}
            placeholder="00"
            placeholderTextColor={colors.gray[300]}
            keyboardType="number-pad"
            maxLength={3}
          />
          {/* Russian flag */}
          <View style={styles.ruFlag}>
            <View style={[styles.ruFlagBand, { backgroundColor: '#fff' }]} />
            <View style={[styles.ruFlagBand, { backgroundColor: '#0039A6' }]} />
            <View style={[styles.ruFlagBand, { backgroundColor: '#D52B1E' }]} />
          </View>
          <Text style={styles.ruRusLabel}>RUS</Text>
        </View>
      </View>
    );
  }

  // Foreign or empty — simple styled input
  return (
    <View style={[styles.foreignPlate, mode === 'empty' && styles.emptyPlate]}>
      {!isRu && mode !== 'empty' && (
        <View style={styles.foreignStrip}>
          <Text style={styles.foreignStripText}>INT</Text>
        </View>
      )}
      <TextInput
        value={value}
        onChangeText={handleChange}
        style={styles.foreignInput}
        placeholder="Госномер, имя или телефон"
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

const PLATE_H = 52;

const styles = StyleSheet.create({
  // ═══ Russian plate ═══
  ruPlate: {
    flexDirection: 'row',
    height: PLATE_H,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#1a1a1a',
    borderRadius: 8,
    overflow: 'hidden',
  },
  ruMain: {
    flex: 1,
    justifyContent: 'center',
  },
  ruMainInput: {
    fontSize: 24,
    fontWeight: '800',
    color: '#1a1a1a',
    textAlign: 'center',
    letterSpacing: 4,
    paddingHorizontal: spacing[2],
  },
  ruDivider: {
    width: 2,
    backgroundColor: '#1a1a1a',
  },
  ruRegion: {
    width: 64,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 2,
  },
  ruRegionInput: {
    fontSize: 20,
    fontWeight: '800',
    color: '#1a1a1a',
    textAlign: 'center',
    letterSpacing: 2,
    paddingHorizontal: 4,
    paddingVertical: 0,
    minHeight: 24,
  },
  ruFlag: {
    flexDirection: 'row',
    gap: 0,
    marginTop: 1,
  },
  ruFlagBand: {
    width: 10,
    height: 3,
    borderRadius: 0.5,
  },
  ruRusLabel: {
    fontSize: 6,
    fontWeight: '900',
    color: '#1a1a1a',
    letterSpacing: 1,
    marginTop: 0.5,
  },

  // ═══ Foreign plate ═══
  foreignPlate: {
    flexDirection: 'row',
    height: PLATE_H,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: colors.blue[500],
    borderRadius: 8,
    overflow: 'hidden',
    alignItems: 'center',
  },
  emptyPlate: {
    borderColor: colors.gray[200],
  },
  foreignStrip: {
    width: 28,
    height: '100%',
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
