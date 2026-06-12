/**
 * ClientListRow — one row of the «Клиенты» people-list (client-search mode).
 *
 * Lives at module scope behind React.memo because FlashList v2 RECYCLES
 * cells: when a row scrolls off and a different client scrolls in, the SAME
 * mounted subtree receives the new item as props — a cheap re-render. The
 * previous inline row keyed its Swipeable wrapper by `item.id`, which forced
 * React to unmount + remount the entire row subtree (gesture handler,
 * avatar, texts — all fresh native views) on EVERY recycle. Creating native
 * views mid-scroll leaves the recycled cell blank for a frame, which the
 * owner saw as «мерцают, исчезают-появляются» while scrolling (bug report,
 * 2026-06-12). Plate mode renders PlateResultCard without a keyed wrapper —
 * which is exactly why it never blinked.
 *
 * The stale-swipe-state leak that `key` was originally guarding against (a
 * recycled holder showing the PREVIOUS client's open swipe actions) is
 * solved the UITableView way instead: snap the swipe position back to
 * closed — `reset()`, instant, no animation — whenever the bound client id
 * changes. Zero remounts, zero leaked state.
 */
import React, { useLayoutEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
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
  const swipeRef = useRef<Swipeable>(null);
  const boundIdRef = useRef(item.id);
  // FlashList recycle: same mounted instance, different client. Reset the
  // swipe position synchronously (before the next paint — useLayoutEffect)
  // so an open action panel can never leak from the previous client into
  // the recycled cell. `reset()` is a no-op for a closed row.
  useLayoutEffect(() => {
    if (boundIdRef.current !== item.id) {
      boundIdRef.current = item.id;
      swipeRef.current?.reset();
    }
  }, [item.id]);

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

  if (!canDelete) return card;

  return (
    <Swipeable
      ref={swipeRef}
      renderRightActions={() => (
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
      )}
      overshootRight={false}
    >
      {card}
    </Swipeable>
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
