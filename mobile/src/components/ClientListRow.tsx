/**
 * ClientListRow — one row of the «Клиенты» people-list (client-search mode).
 *
 * ── Why a FIXED row height ──────────────────────────────────────────────────
 * The owner kept seeing rows flicker / disappear on scroll even after the
 * FlashList hardening. FlashList RECYCLES cells, and on Fabric a recycled cell
 * can paint a stale/blank frame for a beat. We removed that whole failure mode
 * by rendering the people-list with a plain RN `FlatList` (no recycling — each
 * client keeps its own mounted row) plus `getItemLayout`, which needs every row
 * to be exactly `CLIENT_ROW_HEIGHT` tall. So the row container is a fixed
 * height, the avatar centres, and the inset hairline divider sits flush at the
 * bottom edge — a calm, fixed-rhythm Apple Contacts list that can never blank.
 *
 * Lives at module scope behind React.memo so a parent re-render is a cheap
 * props compare, not a remount.
 *
 * ── Why ReanimatedSwipeable and not the legacy RNGH Swipeable ──────────────
 * The first flicker fix removed `key={item.id}` from the legacy Swipeable
 * and reset it via ref on recycle — and the owner STILL saw «дёргаются и
 * пропадают» on device. The legacy `Swipeable` is a class component that is
 * structurally hostile to a recycling list:
 *   • `reset()` calls `this.setState({ rowState: 0 })` → our per-recycle
 *     reset forced an EXTRA synchronous JS re-render of every recycled row
 *     mid-fling (rngh/src/components/Swipeable.tsx:500-504);
 *   • `onLayout` of the row/actions ALSO setState (`rowWidth`, `leftWidth`,
 *     `rightOffset` — ibid:466,529,544) → recycled cells with different
 *     heights trigger yet more renders per recycle;
 *   • its translateX is an RN `Animated.event`/`Animated.Value` with
 *     useNativeDriver (ibid:254-256): under Fabric + cell reuse the
 *     native-driven transform node holds the STALE value until the JS-side
 *     `setValue(0)` round-trips, so a recycled row can paint translated
 *     off-screen for a few frames — exactly «пропадают».
 * `ReanimatedSwipeable` (RNGH 2.28) keeps ALL of that state in reanimated
 * shared values on the UI thread: `reset()` is a plain shared-value write
 * with NO setState (rngh ReanimatedSwipeable.tsx:329-335), widths are
 * measured in worklets, the translation is a `useAnimatedStyle` transform,
 * and the action panel is opacity-gated to invisible while closed
 * (ibid:389-393). A recycle is therefore exactly ONE React render (the new
 * props) and zero animation-state bridge traffic — the same cost as the
 * wrapper-less Журнал rows that scroll perfectly.
 *
 * Closed-by-default on recycle: same UITableView-style contract as before —
 * when the bound client id changes we snap the swipe position back to closed
 * (`reset()`, instant, no animation, no re-render). No `key` on the wrapper,
 * no entering animations — nothing changes element identity during scroll.
 */
import React, { useCallback, useLayoutEffect, useMemo, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { Ionicons } from '@expo/vector-icons';
import { formatPhone } from '../../../shared/validation/phone';
import { colors, spacing } from '../theme';
import { SQUIRCLE_RADIUS, PILL_RADIUS } from '../platform/iosSurface';
import type { SemanticPalette } from '../theme/palette';
import type { Client } from '../../../shared/types';

// iOS-canonical destructive colour. The SemanticPalette has no `danger`
// token, so the destructive swipe action uses the project's standard red
// (same red ConfirmDialog `variant="danger"` and every other delete
// affordance use). The constructive «Изменить» action uses the semantic
// `accent.primary` so it tracks brand + dark-mode automatically.
const DESTRUCTIVE = colors.red[500];

// Outer radius of the inset group — continuous-corner feel (matches the
// app's squircle language). Applied to the first row's top + last row's
// bottom so the whole group reads as one rounded card.
const GROUP_RADIUS = 16;

// Fixed row height — the single source of truth FlatList.getItemLayout reads on
// ClientsScreen, so the virtualiser never measures a row (measurement passes are
// what re-anchor the list and make rows appear to jump / vanish). Every row is
// exactly this tall; first/last only change corner radius, never height.
export const CLIENT_ROW_HEIGHT = 64;

// ─── Avatar helpers (mirror ClientDetailScreen so initials/colour match) ───
export function getInitials(name: string): string {
  const parts = (name || '').trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0]?.[0] || '?').toUpperCase();
}

const AVATAR_PALETTE = [
  colors.primary[500],
  colors.green[600],
  colors.orange[500],
  colors.purple[700],
  colors.teal[600],
  colors.rose[500],
  colors.indigo[600],
  colors.yellow[600],
];

export function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < (name || '').length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

interface ClientListRowProps {
  item: Client;
  canDelete: boolean;
  /** Semantic palette — stable identity per theme mode (memoised inside
   *  ThemeContext), so passing the whole object keeps React.memo effective. */
  palette: SemanticPalette;
  /** First row of the group — rounds the TOP corners (Apple inset-grouped). */
  isFirst?: boolean;
  /** Last row of the group — rounds the BOTTOM corners and drops the
   *  trailing hairline (the rounded edge IS the visual terminator). */
  isLast?: boolean;
  onPress: (id: string) => void;
  /** Fires on `onPressIn` so the detail prefetch lands BEFORE the push. */
  onPressInRow: (id: string) => void;
  onEdit: (client: Client) => void;
  onDeleteRequest: (id: string) => void;
}

function ClientListRowBase({
  item,
  canDelete,
  palette,
  isFirst,
  isLast,
  onPress,
  onPressInRow,
  onEdit,
  onDeleteRequest,
}: ClientListRowProps) {
  const swipeRef = useRef<SwipeableMethods>(null);
  const boundIdRef = useRef(item.id);

  // Semantic surface, derived from the (stable-identity) palette prop and
  // memoised on it. Building it from the passed palette — instead of calling
  // useIosSurface()/useColors() here — keeps the row a pure props→render
  // function: React.memo stays effective and FlashList recycling never
  // resubscribes a context inside a recycled cell mid-fling.
  const surface = useMemo(
    () => ({
      // Card cell: continuous (squircle) leading edge feel, crisp surface,
      // hairline divider in the semantic subtle-border tone.
      rowBg: palette.bg.card,
      divider: palette.border.subtle,
      // Faint fill for the plate / source chips (Apple Settings secondary fill).
      chipBg: palette.bg.muted,
    }),
    [palette],
  );
  // FlashList recycle: same mounted instance, different client. Snap the
  // swipe position back to closed before the next paint (useLayoutEffect)
  // so an open action panel can never leak from the previous client into
  // the recycled cell. ReanimatedSwipeable's `reset()` only writes shared
  // values on the UI thread — no setState, no extra render, no animation.
  useLayoutEffect(() => {
    if (boundIdRef.current !== item.id) {
      boundIdRef.current = item.id;
      swipeRef.current?.reset();
    }
  }, [item.id]);

  // Trailing actions — «Изменить» / «Удалить». Memoised so the swipeable's
  // internal action subtree only re-renders when the bound client changes
  // (i.e. on recycle), not on every incidental parent render. The renderer
  // intentionally ignores the (progress, translation, methods) args — the
  // static two-button panel needs no per-frame styling.
  const renderRightActions = useCallback(
    () => (
      <View style={styles.swipeActionsRow}>
        <TouchableOpacity
          style={[styles.swipeAction, { backgroundColor: palette.accent.primary }]}
          onPress={() => onEdit(item)}
          activeOpacity={0.85}
        >
          <Ionicons name="pencil" size={19} color={palette.text.inverse} />
          <Text style={[styles.swipeActionText, { color: palette.text.inverse }]}>Изменить</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.swipeAction, { backgroundColor: DESTRUCTIVE }]}
          onPress={() => onDeleteRequest(item.id)}
          activeOpacity={0.85}
        >
          <Ionicons name="trash-outline" size={19} color={colors.white} />
          <Text style={[styles.swipeActionText, { color: colors.white }]}>Удалить</Text>
        </TouchableOpacity>
      </View>
    ),
    [item, palette, onEdit, onDeleteRequest],
  );

  const initials = getInitials(item.fullName);
  const avatarBg = getAvatarColor(item.fullName);
  const carsCount = item.cars?.length || 0;
  const primaryPlate = item.cars?.[0]?.plateNumber;

  const card = (
    <TouchableOpacity
      style={[styles.row, { backgroundColor: surface.rowBg }]}
      activeOpacity={0.6}
      onPress={() => onPress(item.id)}
      onPressIn={() => onPressInRow(item.id)}
    >
      {/* Avatar — squircle (continuous-corner) instead of a circle, so it
          reads as part of the card, like an iOS app icon rather than a
          floating bubble. */}
      <View style={[styles.avatar, { backgroundColor: avatarBg }]}>
        <Text style={styles.avatarInitials}>{initials}</Text>
      </View>

      {/* Text column + hairline divider live in one block so the divider
          starts AFTER the avatar (Apple Mail / Settings inset separators),
          never edge-to-edge under the avatar. */}
      <View style={[styles.body, { borderBottomColor: surface.divider }, isLast && styles.bodyLast]}>
        <View style={styles.info}>
          <Text style={[styles.cardName, { color: palette.text.primary }]} numberOfLines={1}>
            {item.fullName}
          </Text>
          <View style={styles.subLine}>
            <Text style={[styles.cardSub, { color: palette.text.secondary }]} numberOfLines={1}>
              {formatPhone(item.phone || '') || 'Без телефона'}
            </Text>
            {primaryPlate ? (
              <View style={[styles.platePill, { backgroundColor: surface.chipBg }]}>
                <Text style={[styles.platePillText, { color: palette.text.secondary }]} numberOfLines={1}>
                  {primaryPlate}
                </Text>
              </View>
            ) : carsCount > 0 ? (
              <Text style={[styles.cardSub, { color: palette.text.tertiary }]} numberOfLines={1}>
                · {carsCount} авто
              </Text>
            ) : null}
          </View>
        </View>

        {item.source ? (
          <View style={[styles.sourceTag, { backgroundColor: surface.chipBg }]}>
            <Text style={[styles.sourceTagText, { color: palette.text.tertiary }]} numberOfLines={1}>
              {item.source}
            </Text>
          </View>
        ) : null}

        <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} style={styles.chevron} />
      </View>
    </TouchableOpacity>
  );

  // ── Inset-grouped container ───────────────────────────────────────────
  // Every row is a cell of ONE continuous rounded group (Apple Settings /
  // Contacts inset-grouped table), NOT a free-floating card. The white
  // surface + inset hairline separators read as a single smooth list; the
  // group's rounded corners live ONLY on the first/last cell, drawn here as
  // a cheap per-recycle style change (no element-identity churn, so the
  // FlashList hardening that stopped rows «пропадают» stays intact). No
  // per-row shadow — separators carry the structure, so nothing re-clips an
  // elevation as cells recycle.
  const groupStyle = [
    styles.group,
    { backgroundColor: surface.rowBg },
    isFirst && styles.groupFirst,
    isLast && styles.groupLast,
  ];

  // Permission gate — `canDelete` is constant for the session (role +
  // permissions don't change while the list scrolls), so this conditional
  // never flips element identity mid-scroll.
  if (!canDelete) return <View style={groupStyle}>{card}</View>;

  return (
    <View style={groupStyle}>
      <ReanimatedSwipeable ref={swipeRef} renderRightActions={renderRightActions} overshootRight={false}>
        {card}
      </ReanimatedSwipeable>
    </View>
  );
}

const ClientListRow = React.memo(ClientListRowBase);
export default ClientListRow;

const styles = StyleSheet.create({
  // Inset-grouped wrapper — horizontal gutters lift the white group off the
  // gray canvas; rows stack with NO vertical margin so the surface stays
  // continuous. overflow:hidden only matters on the rounded first/last cells
  // (it clips the corner + the swipe reveal to the inset width).
  group: {
    marginHorizontal: spacing[4],
  },
  groupFirst: {
    borderTopLeftRadius: GROUP_RADIUS,
    borderTopRightRadius: GROUP_RADIUS,
    overflow: 'hidden',
  },
  groupLast: {
    borderBottomLeftRadius: GROUP_RADIUS,
    borderBottomRightRadius: GROUP_RADIUS,
    overflow: 'hidden',
  },
  // The whole row is the tap surface, locked to CLIENT_ROW_HEIGHT so
  // getItemLayout stays exact. `alignItems: stretch` lets `body` fill the full
  // height, putting its bottom hairline flush at the row's bottom edge (the
  // avatar centres itself). The divider sits on `body` so it stays inset past
  // the avatar — the Apple Mail / Settings separator convention.
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
    height: CLIENT_ROW_HEIGHT,
    gap: spacing[3],
    paddingLeft: spacing[4],
  },
  // Squircle avatar — continuous-corner, app-icon feel. Integrated into the
  // card rather than a free-floating circle. Self-centres in the fixed row.
  avatar: {
    width: 42,
    height: 42,
    borderRadius: SQUIRCLE_RADIUS,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  // Text + trailing accessories, plus the inset hairline divider. Stretches to
  // the full fixed row height (row uses alignItems: stretch) so the bottom
  // hairline lands flush at the row edge; inner content stays vertically
  // centred via alignItems: center.
  body: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingRight: spacing[4],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  // Last cell of the group: the rounded bottom edge terminates the list, so
  // the trailing separator would read as a stray line just inside the curve.
  bodyLast: { borderBottomWidth: 0 },
  info: { flex: 1, minWidth: 0 },
  cardName: { fontSize: 16, fontWeight: '600', letterSpacing: -0.2 },
  subLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  cardSub: { fontSize: 13, letterSpacing: -0.1 },
  // Plate chip — tight rounded-rect (a plate reads better than a full pill),
  // faint semantic fill, wide tracking so the госномер stays legible.
  platePill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  platePillText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  sourceTag: {
    maxWidth: 96,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: PILL_RADIUS,
  },
  sourceTagText: { fontSize: 10, fontWeight: '600', letterSpacing: 0.1 },
  chevron: { marginLeft: 2, opacity: 0.9 },

  // Swipe actions — semantic accent (Изменить) + canonical destructive
  // (Удалить). Equal squares, icon-over-label, iOS swipe convention.
  swipeActionsRow: { flexDirection: 'row', alignItems: 'stretch' },
  swipeAction: {
    width: 84,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  swipeActionText: { fontSize: 12, fontWeight: '600', letterSpacing: 0.2 },
});
