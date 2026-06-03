/**
 * PlateResultCard — a result row for the Clients screen "поиск по госномеру"
 * mode. The госномер is the visual anchor (a compact ГОСТ-style plate badge
 * on the left), with the car make/model + owner stacked to its right — the
 * same hierarchy the owner sees when picking a car in the Касса screen.
 *
 * Self-contained: it renders its own compact plate badge (RU GOST plate or a
 * blue INT strip for foreign plates) so it doesn't depend on CheckCreateScreen
 * internals. No BlurView, no heavy work — safe inside a virtualised list row.
 */
import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../platform/Typography';
import { useColors } from '../contexts/ThemeContext';
import { spacing, borderRadius } from '../theme';
import { splitPlate, formatMain, isRussianInput } from '../utils/plateMask';

const PLATE_H = 40;

interface MiniPlateBadgeProps {
  plate: string;
}

/** Compact GOST plate replica calibrated to PLATE_H (40pt). */
function MiniPlateBadge({ plate }: MiniPlateBadgeProps) {
  const clean = (plate || '').replace(/\s/g, '').toUpperCase();
  if (!clean) {
    return (
      <View style={[badge.frame, badge.frameNoPlate]}>
        <Ionicons name="car-sport-outline" size={18} color="#9aa0aa" />
      </View>
    );
  }
  if (!isRussianInput(clean)) {
    return (
      <View style={[badge.frame, badge.frameForeign]}>
        <View style={badge.intStrip}>
          <Text style={badge.intStripText}>INT</Text>
        </View>
        <Text style={badge.foreignText} numberOfLines={1}>
          {plate}
        </Text>
      </View>
    );
  }
  const { main, region } = splitPlate(clean);
  return (
    <View style={badge.frame}>
      <View style={badge.cant} pointerEvents="none" />
      <View style={badge.mainBlock}>
        <Text style={badge.mainText} numberOfLines={1}>
          {formatMain(main) || clean}
        </Text>
      </View>
      <View style={badge.divider} />
      <View style={badge.regionBlock}>
        <Text style={badge.regionText} numberOfLines={1}>
          {region || '—'}
        </Text>
        <View style={badge.flagBox}>
          <View style={[badge.flagBand, { backgroundColor: '#FFFFFF' }]} />
          <View style={[badge.flagBand, { backgroundColor: '#0039A6' }]} />
          <View style={[badge.flagBand, { backgroundColor: '#D52B1E' }]} />
        </View>
        <Text style={badge.rusLabel}>RUS</Text>
      </View>
    </View>
  );
}

interface PlateResultCardProps {
  plate: string;
  makeModel: string;
  clientName: string;
  onPress: () => void;
  onPressIn?: () => void;
}

export default function PlateResultCard({
  plate,
  makeModel,
  clientName,
  onPress,
  onPressIn,
}: PlateResultCardProps) {
  const palette = useColors();
  return (
    <TouchableOpacity
      activeOpacity={0.6}
      onPress={onPress}
      onPressIn={onPressIn}
      style={[
        styles.card,
        { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
      ]}
    >
      <MiniPlateBadge plate={plate} />
      <View style={styles.info}>
        <Text variant="bodyEmph" color={palette.text.primary} numberOfLines={1} style={styles.make}>
          {makeModel || 'Без модели'}
        </Text>
        <View style={styles.ownerRow}>
          <Ionicons name="person-outline" size={12} color={palette.text.tertiary} />
          <Text variant="footnote" color={palette.text.secondary} numberOfLines={1}>
            {clientName || 'Без владельца'}
          </Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: spacing[2],
  },
  info: { flex: 1, minWidth: 0, gap: 2 },
  make: { fontSize: 15, letterSpacing: -0.1 },
  ownerRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});

// ── Plate badge proportions (calibrated to PLATE_H) ──────────────────────
const regionW = Math.round(PLATE_H * 1.05);
const width = Math.round(PLATE_H * 4.5);
const mainW = width - regionW - 2;
const mainFont = Math.round(PLATE_H * 0.46);
const regionFont = Math.round(PLATE_H * 0.3);
const flagW = Math.round(regionW * 0.34);
const flagBandH = Math.max(1.4, Math.round(PLATE_H * 0.045));
const rusFont = Math.max(7, Math.round(PLATE_H * 0.14));
const regionPadV = Math.max(4, Math.round(PLATE_H * 0.1));
const regionPadH = Math.max(5, Math.round(regionW * 0.14));
const cantInset = Math.max(2.5, Math.round(PLATE_H * 0.05));

const badge = StyleSheet.create({
  frame: {
    flexDirection: 'row',
    width,
    height: PLATE_H,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#0A0A0A',
    borderRadius: 6,
    overflow: 'hidden',
  },
  frameForeign: { borderColor: '#3b82f6' },
  frameNoPlate: {
    width: PLATE_H + 8,
    borderColor: '#d1d5db',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cant: {
    position: 'absolute',
    top: cantInset,
    left: cantInset,
    right: cantInset,
    bottom: cantInset,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#0A0A0A',
    borderRadius: 3,
  },
  mainBlock: {
    width: mainW,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  mainText: { fontSize: mainFont, fontWeight: '800', letterSpacing: 1.2, color: '#000000' },
  divider: { width: 2, backgroundColor: '#0A0A0A' },
  regionBlock: {
    width: regionW,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: regionPadV,
    paddingHorizontal: regionPadH,
  },
  regionText: {
    fontSize: regionFont,
    fontWeight: '800',
    letterSpacing: 0.4,
    color: '#000000',
    lineHeight: regionFont + 1,
  },
  rusLabel: { fontSize: rusFont, fontWeight: '900', color: '#000000', letterSpacing: 1 },
  flagBox: {
    flexDirection: 'column',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#0A0A0A',
    marginVertical: 1.5,
  },
  flagBand: { width: flagW, height: flagBandH },
  intStrip: {
    width: Math.round(width * 0.12),
    backgroundColor: '#3b82f6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  intStripText: { fontSize: rusFont - 1, fontWeight: '900', color: '#fff', letterSpacing: 0.5 },
  foreignText: {
    flex: 1,
    fontSize: Math.round(PLATE_H * 0.34),
    fontWeight: '700',
    color: '#000000',
    paddingHorizontal: 8,
    alignSelf: 'center',
    letterSpacing: 0.5,
  },
});
