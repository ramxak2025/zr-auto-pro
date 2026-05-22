/**
 * FreshnessBadge — unobtrusive pill that exposes the "is this data fresh?"
 * state to the user without ever blocking the UI.
 *
 * UX contract (the user's HYBRID-mode choice):
 *   • Critical screens (Касса / payment / cash position) wait for fresh data
 *     and don't need this badge.
 *   • Non-critical list screens (Журнал / Склад / Клиенты / Поставщики /
 *     Dashboard owner widgets) render persistent cache instantly and show
 *     this badge so the user can SEE whether the numbers are still being
 *     revalidated in the background.
 *
 * States rendered:
 *   • "Обновляется..." with a subtle 1.4s pulse — `isFetching && !isLoading`
 *     (background refetch while cached data is on screen).
 *   • "Обновлено только что" — last successful fetch < 5s ago.
 *   • "Обновлено N сек / мин / ч назад" — older fetch timestamp.
 *
 * Visual: 10pt label, secondary gray, no background by default. When
 * pulsing we add a transparent gray pill so the motion has a surface to
 * carry it — otherwise the pulse on transparent text is invisible.
 *
 * Performance: the relative-time label updates lazily — every 5s when
 * < 1 min old, every 30s when < 1 h old, every 5 min after that. We
 * never use setInterval(1000) here: that would re-render the badge once
 * per second on every screen that uses it, which is exactly the kind of
 * waste this refactor is trying to remove.
 */
import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View, ViewStyle, StyleProp } from 'react-native';
import Animated, { useSharedValue, useAnimatedStyle, withRepeat, withTiming, cancelAnimation, Easing } from 'react-native-reanimated';
import { Text } from '../platform/Typography';
import { useColors } from '../contexts/ThemeContext';

/**
 * Minimal slice of the TanStack `UseQueryResult` we need.
 * Lets callers pass any TanStack query result (useQuery / useInfiniteQuery)
 * without coupling us to the full generic.
 */
export interface FreshnessQueryLike {
  isFetching: boolean;
  isLoading: boolean;
  dataUpdatedAt: number;
}

export interface FreshnessBadgeProps {
  /** A single TanStack query result. */
  query?: FreshnessQueryLike;
  /**
   * Multiple queries — badge shows "Обновляется..." when ANY is fetching,
   * and the timestamp uses the OLDEST `dataUpdatedAt` (the freshness of
   * the slowest piece — pessimistic).
   */
  queries?: FreshnessQueryLike[];
  /** Optional wrapper style. */
  style?: StyleProp<ViewStyle>;
}

/**
 * Format milliseconds-ago as compact ru-RU label.
 *   < 5s    → "только что"
 *   < 60s   → "N сек назад"
 *   < 60 min → "N мин назад"
 *   < 24 h  → "N ч назад"
 *   else    → "вчера" / "давно"
 */
function formatAgo(ms: number): string {
  if (ms < 5_000) return 'только что';
  if (ms < 60_000) return `${Math.round(ms / 1000)} сек назад`;
  if (ms < 60 * 60_000) return `${Math.round(ms / 60_000)} мин назад`;
  if (ms < 24 * 60 * 60_000) return `${Math.round(ms / (60 * 60_000))} ч назад`;
  if (ms < 48 * 60 * 60_000) return 'вчера';
  return 'давно';
}

/**
 * How long to wait before the badge's relative-time label re-renders.
 * The closer to "now" we are, the more often we re-check.
 */
function nextTickMs(ms: number): number {
  if (ms < 60_000) return 5_000;
  if (ms < 60 * 60_000) return 30_000;
  return 5 * 60_000;
}

export default function FreshnessBadge({ query, queries, style }: FreshnessBadgeProps) {
  const palette = useColors();
  // Tick state — bumped by a self-scheduling timer to refresh the
  // relative-time label without re-rendering parent components.
  const [, setTick] = useState(0);

  // Pulse animation for the "Обновляется..." state. Driven by a shared
  // value so the JS thread doesn't run the loop; runs entirely on the UI
  // thread via reanimated worklets.
  const pulse = useSharedValue(0.55);
  const pulseStyle = useAnimatedStyle(() => ({
    opacity: pulse.value,
  }));

  // Resolve which queries we're watching — caller can pass either one
  // or an array, never both meaningfully.
  const all: FreshnessQueryLike[] = queries && queries.length > 0 ? queries : query ? [query] : [];

  const anyFetching = all.some((q) => q.isFetching && !q.isLoading);
  const lastUpdated = all.reduce<number>((min, q) => {
    if (!q.dataUpdatedAt) return min;
    return min === 0 ? q.dataUpdatedAt : Math.min(min, q.dataUpdatedAt);
  }, 0);

  // Start / stop the pulse based on fetching state.
  useEffect(() => {
    if (anyFetching) {
      pulse.value = withRepeat(
        withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) }),
        -1,
        true,
      );
    } else {
      cancelAnimation(pulse);
      pulse.value = 1;
    }
    return () => {
      cancelAnimation(pulse);
    };
  }, [anyFetching, pulse]);

  // Self-scheduling relative-time clock. Re-render at decreasing rate
  // as data ages, so we don't burn CPU on a 1Hz interval forever.
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (anyFetching || !lastUpdated) {
      // While fetching, the label says "Обновляется..." and doesn't
      // need a ticker. Same when we've never had data — there's
      // nothing to age.
      return;
    }
    const schedule = () => {
      const age = Date.now() - lastUpdated;
      const wait = nextTickMs(age);
      timerRef.current = setTimeout(() => {
        setTick((t) => t + 1);
        schedule();
      }, wait);
    };
    schedule();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [anyFetching, lastUpdated]);

  // Nothing to show — no query was passed in, or we've genuinely never
  // had data and aren't fetching. Render null so the slot collapses.
  if (all.length === 0) return null;
  if (!anyFetching && !lastUpdated) return null;

  const label = anyFetching ? 'Обновляется…' : `Обновлено ${formatAgo(Date.now() - lastUpdated)}`;

  // When pulsing we want the user to feel the breathing motion — paint
  // the badge with a transparent pill background so the opacity animation
  // has a surface to act on. Static (non-pulsing) state stays chromeless.
  return (
    <View style={[styles.wrap, anyFetching && { backgroundColor: palette.bg.muted }, style]}>
      <Animated.View style={anyFetching ? pulseStyle : undefined}>
        <Text variant="caption" style={[styles.text, { color: palette.text.tertiary }]} numberOfLines={1}>
          {label}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    alignSelf: 'flex-end',
  },
  text: {
    fontSize: 10,
    letterSpacing: -0.1,
  },
});
