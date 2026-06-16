/**
 * ClientListRow — one row of the «Клиенты» people-list (client-search mode).
 *
 * Lives at module scope behind React.memo because FlashList v2 RECYCLES
 * cells: when a row scrolls off and a different client scrolls in, the SAME
 * mounted subtree receives the new item as props — a cheap re-render.
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
      <View style={[styles.body, { borderBottomColor: surface.divider }]}>
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

  // Permission gate — `canDelete` is constant for the session (role +
  // permissions don't change while the list scrolls), so this conditional
  // never flips element identity mid-scroll.
  if (!canDelete) return card;

  return (
    <ReanimatedSwipeable ref={swipeRef} renderRightActions={renderRightActions} overshootRight={false}>
      {card}
    </ReanimatedSwipeable>
  );
}

const ClientListRow = React.memo(ClientListRowBase);
export default ClientListRow;

const styles = StyleSheet.create({
  // The whole row is the tap surface. Padding sits on the row (leading +
  // vertical), the hairline divider sits on `body` so it stays inset past
  // the avatar — the Apple Mail / Settings separator convention.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingLeft: spacing[4],
  },
  // Squircle avatar — continuous-corner, app-icon feel. Integrated into the
  // card rather than a free-floating circle.
  avatar: {
    width: 42,
    height: 42,
    borderRadius: SQUIRCLE_RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  // Text + trailing accessories, plus the inset hairline divider.
  body: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingRight: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
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
