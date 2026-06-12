/**
 * OfflineBanner — slim top strip «Нет соединения».
 *
 * Subscribes to TanStack Query's `onlineManager` (which App.tsx wires to
 * `@react-native-community/netinfo`), so the banner and the query/mutation
 * pause-resume logic always agree on a single source of connectivity truth.
 *
 * Renders nothing while online. When offline it overlays the very top of
 * the screen (above the status-bar area, safe-area aware) with a compact
 * red strip — visible on every screen without stealing layout space.
 * Theme-aware only in the sense that the alert red is identical in both
 * modes deliberately: connectivity loss must read as a warning, not blend
 * into the palette.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { onlineManager } from '@tanstack/react-query';
import { Text } from '../platform/Typography';
import { colors } from '../theme';

export default function OfflineBanner() {
  const insets = useSafeAreaInsets();
  const [online, setOnline] = useState(onlineManager.isOnline());

  useEffect(() => {
    // onlineManager.subscribe returns the unsubscribe fn — perfect cleanup.
    return onlineManager.subscribe((isOnline) => setOnline(isOnline));
  }, []);

  if (online) return null;

  return (
    <Animated.View
      entering={FadeInUp.duration(220)}
      exiting={FadeOutUp.duration(180)}
      style={[styles.wrap, { paddingTop: insets.top }]}
      pointerEvents="none"
      accessibilityRole="alert"
      accessibilityLabel="Нет соединения"
    >
      <View style={styles.row}>
        <Ionicons name="cloud-offline-outline" size={14} color={colors.white} />
        <Text style={styles.text}>Нет соединения</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    elevation: 1000,
    backgroundColor: colors.red[600],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  text: {
    color: colors.white,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
});
