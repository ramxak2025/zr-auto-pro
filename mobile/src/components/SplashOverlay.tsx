/**
 * SplashOverlay — branded post-launch splash that bridges the OS-level
 * static splash (defined in `app.json` as `expo.splash`) and the first
 * usable RN screen (LoginScreen / DashboardScreen).
 *
 * Why we need this:
 *   The OS splash disappears the moment Hermes finishes booting. Without
 *   our own overlay, the user sees a black flash (App.tsx returns `null`
 *   during cache hydration) and then a tiny `<ActivityIndicator />` while
 *   /me revalidates. Both feel unbranded and rushed for a SaaS product.
 *
 * Design:
 *   • Soft near-white background (gray-50) so the AUTEXA logo (which
 *     contains a dark wordmark) reads cleanly. Bridges to LoginScreen's
 *     own gray-50 canvas — zero perceived "page swap".
 *   • Logo entrance: spring scale 0.92 → 1 with quick fade-in.
 *   • Tagline: "Система управления автосервисом" — slides up + fades
 *     200ms after logo (Apple Mail / Music style staggered intro).
 *   • Three pulsing dots act as a subtle loading hint without an
 *     ActivityIndicator's "spinning wheel" feel.
 *
 * Driven from `App.tsx`. Mounts while the app is not ready
 * (`!cacheReady || !authResolved`). Parent decides when to unmount —
 * we don't manage exit animations here; navigator's own scene transition
 * provides a soft fade.
 *
 * iOS notes:
 *   • Respects safe area implicitly (full-screen, content centered).
 *   • Uses Reanimated v4 worklets so the entrance is silky on the UI
 *     thread.
 *   • `accessibilityElementsHidden` so VoiceOver doesn't announce the
 *     placeholder while the real UI is loading underneath.
 */
import React, { useEffect } from 'react';
import { Image, StyleSheet } from 'react-native';
import Animated, {
  Easing,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { colors, spacing } from '../theme';
import { Text } from '../platform/Typography';

export default function SplashOverlay() {
  // Honor Reduce Motion (Settings → Accessibility → Motion). When on we
  // skip the spring/pulse entirely and just present the branded canvas
  // at rest — no scale, no pulsing dots, only a gentle opacity reveal.
  const reduceMotion = useReducedMotion();

  const logoScale = useSharedValue(reduceMotion ? 1 : 0.92);
  const logoOpacity = useSharedValue(0);
  const subtitleOpacity = useSharedValue(0);
  const subtitleY = useSharedValue(reduceMotion ? 0 : 8);
  const dotPulse = useSharedValue(reduceMotion ? 0.7 : 0);

  useEffect(() => {
    if (reduceMotion) {
      // Static reveal: a short cross-fade only, no motion.
      logoOpacity.value = withTiming(1, { duration: 200 });
      subtitleOpacity.value = withTiming(1, { duration: 200 });
      return;
    }
    logoOpacity.value = withTiming(1, {
      duration: 350,
      easing: Easing.out(Easing.cubic),
    });
    logoScale.value = withSpring(1, { damping: 18, stiffness: 110, mass: 0.8 });
    subtitleOpacity.value = withDelay(220, withTiming(1, { duration: 280 }));
    subtitleY.value = withDelay(220, withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) }));
    dotPulse.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 650, easing: Easing.inOut(Easing.ease) }),
        withTiming(0, { duration: 650, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      true,
    );
  }, [reduceMotion, logoOpacity, logoScale, subtitleOpacity, subtitleY, dotPulse]);

  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ scale: logoScale.value }],
  }));
  const subtitleStyle = useAnimatedStyle(() => ({
    opacity: subtitleOpacity.value,
    transform: [{ translateY: subtitleY.value }],
  }));
  const dot1Style = useAnimatedStyle(() => ({
    opacity: 0.25 + dotPulse.value * 0.75,
  }));
  const dot2Style = useAnimatedStyle(() => ({
    opacity: 0.25 + Math.max(0, dotPulse.value - 0.2) * 0.75 * 1.25,
  }));
  const dot3Style = useAnimatedStyle(() => ({
    opacity: 0.25 + Math.max(0, dotPulse.value - 0.4) * 0.75 * 1.66,
  }));

  return (
    <Animated.View
      style={styles.root}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      // Opacity-only handoff to Login/Dashboard — fine under Reduce
      // Motion too (no translation), just snappier.
      exiting={FadeOut.duration(reduceMotion ? 160 : 240)}
    >
      <Animated.View style={styles.center}>
        <Animated.View style={[styles.logoWrap, logoStyle]}>
          <Image source={require('../../assets/logo.png')} style={styles.logoImage} resizeMode="contain" />
        </Animated.View>

        <Animated.View style={subtitleStyle}>
          <Text style={styles.tagline}>Система управления автосервисом</Text>
        </Animated.View>

        <Animated.View style={styles.dotsRow}>
          <Animated.View style={[styles.dot, dot1Style]} />
          <Animated.View style={[styles.dot, dot2Style]} />
          <Animated.View style={[styles.dot, dot3Style]} />
        </Animated.View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.gray[50],
    alignItems: 'center',
    justifyContent: 'center',
    // Higher than the navigator scenes — the overlay must visually
    // cover whatever's underneath.
    zIndex: 9999,
    elevation: 9999,
  },
  center: {
    alignItems: 'center',
    paddingHorizontal: spacing[6],
  },
  logoWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[4],
  },
  logoImage: {
    // Sized to match the OS-level splash logo (logo.png at contain).
    // logo.png aspect is 752/196 ≈ 3.84 — keeping width × height in that
    // ratio avoids the "logo jumped" effect between OS splash and overlay.
    width: 280,
    height: 73,
  },
  tagline: {
    fontSize: 14,
    color: colors.gray[500],
    fontWeight: '500',
    letterSpacing: -0.1,
    textAlign: 'center',
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: spacing[6],
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primary[600],
  },
});
