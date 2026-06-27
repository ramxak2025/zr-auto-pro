/**
 * PlateResultCard — one result row of the Clients screen "поиск по госномеру"
 * mode. The госномер is the visual anchor (a ГОСТ plate badge on the left),
 * with the car make/model + owner stacked to its right — the same hierarchy
 * the owner sees when picking a car in the Касса screen.
 *
 * ── Why this is an inset-grouped ROW, not a floating card ───────────────────
 * The owner reported the plate-results list flickering / rows disappearing on
 * scroll. The fix on ClientsScreen is to render this list with a plain RN
 * `FlatList` (no cell recycling) + `getItemLayout` (fixed row height), so a row
 * can never blank out or re-anchor. For that to hold, every row MUST be exactly
 * `PLATE_ROW_HEIGHT` tall — hence the fixed-height container here and the
 * isFirst/isLast rounding (continuous Apple inset-grouped table) instead of a
 * per-row bordered card with a margin. Same visual language as ClientListRow so
 * both search modes read as one consistent list.
 */
import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../platform/Typography';
import { useColors } from '../contexts/ThemeContext';
import { spacing } from '../theme';
import GostPlateBadge from './GostPlateBadge';

// Fixed row height — the single source of truth FlatList.getItemLayout reads,
// so the virtualiser never has to measure a row (the cause of scroll jumps).
export const PLATE_ROW_HEIGHT = 64;
const PLATE_H = 40;
// Outer radius of the inset group (matches ClientListRow / the app squircle
// language). Drawn only on the first row's top + last row's bottom.
const GROUP_RADIUS = 16;

interface PlateResultCardProps {
  plate: string;
  makeModel: string;
  clientName: string;
  /** First row of the group → rounds the TOP corners. */
  isFirst?: boolean;
  /** Last row → rounds the BOTTOM corners and drops the trailing hairline. */
  isLast?: boolean;
  onPress: () => void;
  onPressIn?: () => void;
}

function PlateResultCardBase({
  plate,
  makeModel,
  clientName,
  isFirst,
  isLast,
  onPress,
  onPressIn,
}: PlateResultCardProps) {
  const palette = useColors();
  return (
    <View
      style={[
        styles.group,
        { backgroundColor: palette.bg.card },
        isFirst && styles.groupFirst,
        isLast && styles.groupLast,
      ]}
    >
      <TouchableOpacity activeOpacity={0.6} onPress={onPress} onPressIn={onPressIn} style={styles.row}>
        <GostPlateBadge plate={plate} height={PLATE_H} />
        <View style={[styles.body, { borderBottomColor: palette.border.subtle }, isLast && styles.bodyLast]}>
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
        </View>
      </TouchableOpacity>
    </View>
  );
}

const PlateResultCard = React.memo(PlateResultCardBase);
export default PlateResultCard;

const styles = StyleSheet.create({
  // Inset-grouped wrapper — horizontal gutters lift the card surface off the
  // canvas; rows stack with NO vertical margin so the surface stays continuous.
  group: { marginHorizontal: spacing[4] },
  groupFirst: { borderTopLeftRadius: GROUP_RADIUS, borderTopRightRadius: GROUP_RADIUS, overflow: 'hidden' },
  groupLast: { borderBottomLeftRadius: GROUP_RADIUS, borderBottomRightRadius: GROUP_RADIUS, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    height: PLATE_ROW_HEIGHT,
    gap: spacing[3],
    paddingLeft: spacing[3],
  },
  // Text column + trailing chevron, plus the inset hairline divider that
  // starts AFTER the plate badge (Apple Settings / Mail separator convention).
  body: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingRight: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  bodyLast: { borderBottomWidth: 0 },
  info: { flex: 1, minWidth: 0, gap: 2 },
  make: { fontSize: 15, letterSpacing: -0.1 },
  ownerRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
