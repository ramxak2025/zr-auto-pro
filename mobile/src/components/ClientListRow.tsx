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
import React, { useCallback, useLayoutEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { Ionicons } from '@expo/vector-icons';
import { formatPhone } from '../../../shared/validation/phone';
import { colors, spacing } from '../theme';
import type { SemanticPalette } from '../theme/palette';
import type { Client } from '../../../shared/types';

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
        <TouchableOpacity style={styles.swipeEditAction} onPress={() => onEdit(item)} activeOpacity={0.85}>
          <Ionicons name="pencil" size={20} color={colors.white} />
          <Text style={styles.swipeActionText}>Изменить</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.swipeDeleteAction}
          onPress={() => onDeleteRequest(item.id)}
          activeOpacity={0.85}
        >
          <Ionicons name="trash-outline" size={20} color={colors.white} />
          <Text style={styles.swipeActionText}>Удалить</Text>
        </TouchableOpacity>
      </View>
    ),
    [item, onEdit, onDeleteRequest],
  );

  const initials = getInitials(item.fullName);
  const avatarBg = getAvatarColor(item.fullName);
  const carsCount = item.cars?.length || 0;
  const primaryPlate = item.cars?.[0]?.plateNumber;

  const card = (
    <TouchableOpacity
      style={[styles.row, { backgroundColor: palette.bg.card, borderBottomColor: palette.border.subtle }]}
      activeOpacity={0.6}
      onPress={() => onPress(item.id)}
      onPressIn={() => onPressInRow(item.id)}
    >
      <View style={[styles.avatar, { backgroundColor: avatarBg }]}>
        <Text style={styles.avatarInitials}>{initials}</Text>
      </View>
      <View style={styles.info}>
        <Text style={[styles.cardName, { color: palette.text.primary }]} numberOfLines={1}>
          {item.fullName}
        </Text>
        <View style={styles.subLine}>
          <Text style={[styles.cardSub, { color: palette.text.secondary }]} numberOfLines={1}>
            {formatPhone(item.phone || '') || 'Без телефона'}
          </Text>
          {primaryPlate ? (
            <View style={[styles.platePill, { backgroundColor: palette.bg.muted }]}>
              <Text style={[styles.platePillText, { color: palette.text.primary }]} numberOfLines={1}>
                {primaryPlate}
              </Text>
            </View>
          ) : carsCount > 0 ? (
            <Text style={[styles.cardSub, { color: palette.text.secondary }]} numberOfLines={1}>
              · {carsCount} авто
            </Text>
          ) : null}
        </View>
      </View>
      {item.source ? (
        <View style={[styles.sourceTag, { backgroundColor: palette.bg.muted }]}>
          <Text style={[styles.sourceTagText, { color: palette.text.secondary }]} numberOfLines={1}>
            {item.source}
          </Text>
        </View>
      ) : null}
      <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} style={{ marginLeft: 4 }} />
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    backgroundColor: colors.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray[200],
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitials: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  info: { flex: 1, minWidth: 0 },
  cardName: { fontSize: 15, fontWeight: '600', color: colors.gray[900], letterSpacing: -0.1 },
  subLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  cardSub: { fontSize: 12, color: colors.gray[500] },
  platePill: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
    backgroundColor: colors.gray[100],
  },
  platePillText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, color: colors.gray[800] },
  sourceTag: {
    maxWidth: 90,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: colors.gray[100],
  },
  sourceTagText: { fontSize: 10, fontWeight: '600' },
  swipeActionsRow: { flexDirection: 'row' },
  swipeEditAction: {
    backgroundColor: colors.primary[600],
    width: 84,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  swipeDeleteAction: {
    backgroundColor: colors.red[500],
    width: 84,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  swipeActionText: { color: colors.white, fontSize: 12, fontWeight: '600', letterSpacing: 0.2 },
});
