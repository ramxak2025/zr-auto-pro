/**
 * GostPlateBadge — a self-contained ГОСТ-style Russian plate replica.
 *
 * One source of truth for the white-plate / black-glyph badge that shows up in
 * the госномер-search results (PlateResultCard) AND the car-detail hero, so the
 * plate looks identical wherever it appears. All proportions scale from the
 * single `height` prop, so the SAME component serves a 40pt list row and a
 * larger hero badge without a second hand-tuned stylesheet.
 *
 * Theme-independent ON PURPOSE: physical plates are white with black glyphs in
 * both light and dark UI, so the colours are hard-coded (same rationale as the
 * carPlateBadge that already lived inline on Client/Car detail). No BlurView, no
 * per-frame work — safe inside a virtualised list row.
 *
 *  • RU plate  → main block (1 letter + 3 digits + 2 letters) | region + flag;
 *  • foreign   → blue "INT" strip + raw text;
 *  • empty     → faint car-glyph placeholder frame.
 */
import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../platform/Typography';
import { splitPlate, formatMain, isRussianInput } from '../utils/plateMask';

interface GostPlateBadgeProps {
  plate: string;
  /** Outer plate height in pt. Width + every glyph scales from this. */
  height?: number;
}

function GostPlateBadgeBase({ plate, height = 40 }: GostPlateBadgeProps) {
  const H = height;
  // Proportions calibrated to H — identical formulas the old inline
  // MiniPlateBadge used at H=40, now parameterised so a hero can ask for more.
  const d = useMemo(() => {
    const regionW = Math.round(H * 1.05);
    const width = Math.round(H * 4.5);
    return {
      regionW,
      width,
      mainW: width - regionW - 2,
      mainFont: Math.round(H * 0.46),
      regionFont: Math.round(H * 0.3),
      flagW: Math.round(regionW * 0.34),
      flagBandH: Math.max(1.4, Math.round(H * 0.045)),
      rusFont: Math.max(7, Math.round(H * 0.14)),
      regionPadV: Math.max(4, Math.round(H * 0.1)),
      regionPadH: Math.max(5, Math.round(regionW * 0.14)),
      cantInset: Math.max(2.5, Math.round(H * 0.05)),
      foreignFont: Math.round(H * 0.34),
      intStripW: Math.round(width * 0.12),
      noPlateW: H + 8,
      noPlateGlyph: Math.round(H * 0.45),
    };
  }, [H]);

  const clean = (plate || '').replace(/\s/g, '').toUpperCase();

  if (!clean) {
    return (
      <View style={[badge.frame, badge.frameNoPlate, { width: d.noPlateW, height: H }]}>
        <Ionicons name="car-sport-outline" size={d.noPlateGlyph} color="#9aa0aa" />
      </View>
    );
  }

  if (!isRussianInput(clean)) {
    return (
      <View style={[badge.frame, badge.frameForeign, { width: d.width, height: H }]}>
        <View style={[badge.intStrip, { width: d.intStripW }]}>
          <Text style={[badge.intStripText, { fontSize: Math.max(6, d.rusFont - 1) }]}>INT</Text>
        </View>
        <Text style={[badge.foreignText, { fontSize: d.foreignFont }]} numberOfLines={1}>
          {plate}
        </Text>
      </View>
    );
  }

  const { main, region } = splitPlate(clean);
  return (
    <View style={[badge.frame, { width: d.width, height: H }]}>
      <View
        style={[badge.cant, { top: d.cantInset, left: d.cantInset, right: d.cantInset, bottom: d.cantInset }]}
        pointerEvents="none"
      />
      <View style={[badge.mainBlock, { width: d.mainW }]}>
        <Text style={[badge.mainText, { fontSize: d.mainFont }]} numberOfLines={1}>
          {formatMain(main) || clean}
        </Text>
      </View>
      <View style={badge.divider} />
      <View
        style={[
          badge.regionBlock,
          { width: d.regionW, paddingVertical: d.regionPadV, paddingHorizontal: d.regionPadH },
        ]}
      >
        <Text style={[badge.regionText, { fontSize: d.regionFont, lineHeight: d.regionFont + 1 }]} numberOfLines={1}>
          {region || '—'}
        </Text>
        <View style={badge.flagBox}>
          <View style={[badge.flagBand, { width: d.flagW, height: d.flagBandH, backgroundColor: '#FFFFFF' }]} />
          <View style={[badge.flagBand, { width: d.flagW, height: d.flagBandH, backgroundColor: '#0039A6' }]} />
          <View style={[badge.flagBand, { width: d.flagW, height: d.flagBandH, backgroundColor: '#D52B1E' }]} />
        </View>
        <Text style={[badge.rusLabel, { fontSize: d.rusFont }]}>RUS</Text>
      </View>
    </View>
  );
}

const GostPlateBadge = React.memo(GostPlateBadgeBase);
export default GostPlateBadge;

const badge = StyleSheet.create({
  frame: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#0A0A0A',
    borderRadius: 6,
    overflow: 'hidden',
  },
  frameForeign: { borderColor: '#3b82f6' },
  frameNoPlate: { borderColor: '#d1d5db', alignItems: 'center', justifyContent: 'center' },
  cant: {
    position: 'absolute',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#0A0A0A',
    borderRadius: 3,
  },
  mainBlock: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  mainText: { fontWeight: '800', letterSpacing: 1.2, color: '#000000' },
  divider: { width: 2, backgroundColor: '#0A0A0A' },
  regionBlock: { alignItems: 'center', justifyContent: 'space-between' },
  regionText: { fontWeight: '800', letterSpacing: 0.4, color: '#000000' },
  rusLabel: { fontWeight: '900', color: '#000000', letterSpacing: 1 },
  flagBox: {
    flexDirection: 'column',
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#0A0A0A',
    marginVertical: 1.5,
  },
  flagBand: {},
  intStrip: { backgroundColor: '#3b82f6', alignItems: 'center', justifyContent: 'center' },
  intStripText: { fontWeight: '900', color: '#fff', letterSpacing: 0.5 },
  foreignText: {
    flex: 1,
    fontWeight: '700',
    color: '#000000',
    paddingHorizontal: 8,
    alignSelf: 'center',
    letterSpacing: 0.5,
  },
});
