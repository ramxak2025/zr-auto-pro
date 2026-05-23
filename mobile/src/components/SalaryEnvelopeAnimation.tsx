/**
 * SalaryEnvelopeAnimation — celebratory overlay shown to the OWNER right after
 * `salaryApi.createPayment` resolves successfully. Visual goal:
 *
 *   1. Envelope icon springs in to center (scale 0 → 1.5) with a glow.
 *   2. ~10 «₽» glyphs fly out radially and fade — money explosion.
 *   3. After ~650 ms the envelope translates to the top-right corner
 *      (where the recipient avatar / status pill conceptually lives) and
 *      shrinks to scale 0.6 with opacity 0 — "ушло мастеру".
 *   4. Total runtime ~1.8 s, then `onComplete` fires once.
 *
 * The whole thing runs on the UI thread via Reanimated 4 shared values, so
 * the animation stays smooth even while React Query is busy invalidating
 * `['salary']` in the background.
 *
 * No external image asset — uses Ionicons «mail» + a Reanimated.View glow,
 * so it works without any prebuild step.
 *
 * Caller contract:
 *   <SalaryEnvelopeAnimation
 *     visible={showAnim}
 *     amount={12500}
 *     employeeName="Алексей Иванов"
 *     onComplete={() => setShowAnim(false)}
 *   />
 *
 * Reduce-motion: when the OS reports reduce-motion-enabled we skip the
 * radial money + corner-fling and fade-show the caption for 900 ms so
 * the success cue is still present.
 */
import React, { useEffect, useMemo } from 'react';
import { Modal as RNModal, StyleSheet, View, Dimensions, AccessibilityInfo } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Text } from '../platform/Typography';
import { colors, fontSize, fontWeight } from '../theme';
import { haptic } from '../platform/haptics';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const RUBLE = '₽';

interface SalaryEnvelopeAnimationProps {
  visible: boolean;
  amount: number;
  employeeName: string;
  /** Fired once after the animation completes (or after the reduce-motion
   *  hold). The parent is expected to flip `visible` to false here. */
  onComplete: () => void;
}

// Radial money glyph positions. 10 around the envelope at radii 70–130 px.
const RUBLE_TRACKS = Array.from({ length: 10 }, (_, i) => {
  const angle = (i / 10) * Math.PI * 2;
  const radius = 70 + (i % 3) * 25; // staggered radii so they spread, not ring
  return {
    dx: Math.cos(angle) * radius,
    dy: Math.sin(angle) * radius * 0.85, // slight elliptical squish
    rotate: ((i * 36) % 90) - 45, // -45deg .. +45deg
  };
});

function formatMoney(v: number): string {
  return (
    Math.round(v)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ' + RUBLE
  );
}

interface FlyingRubleProps {
  index: number;
  reduceMotion: boolean;
}

function FlyingRuble({ index, reduceMotion }: FlyingRubleProps) {
  const track = RUBLE_TRACKS[index];
  const progress = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) {
      return;
    }
    // Stagger each glyph by 30 ms so they don't fire as a single burst.
    const delay = 180 + index * 30;
    opacity.value = withDelay(delay, withTiming(1, { duration: 90 }));
    progress.value = withDelay(
      delay,
      withTiming(1, { duration: 700, easing: Easing.out(Easing.cubic) }),
    );
    // Fade out near the end of the trajectory so glyphs disappear at the edge.
    opacity.value = withDelay(delay + 400, withTiming(0, { duration: 300 }));
    return () => {
      cancelAnimation(progress);
      cancelAnimation(opacity);
    };
  }, [index, reduceMotion, progress, opacity]);

  const style = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateX: progress.value * track.dx },
      { translateY: progress.value * track.dy },
      { scale: 0.6 + progress.value * 0.7 },
      { rotate: `${track.rotate}deg` },
    ],
  }));

  if (reduceMotion) return null;

  return (
    <Animated.View pointerEvents="none" style={[styles.rubleGlyph, style]}>
      <Text style={styles.rubleText}>{RUBLE}</Text>
    </Animated.View>
  );
}

export default function SalaryEnvelopeAnimation({
  visible,
  amount,
  employeeName,
  onComplete,
}: SalaryEnvelopeAnimationProps) {
  // Pull reduce-motion once per mount cycle. We can't await in an effect's
  // body cleanly without yielding a frame, so we cache it in a ref and
  // flip the local boolean once the promise resolves. The first ~50 ms
  // before resolution defaults to "motion enabled" — that's correct for
  // the overwhelming majority of users.
  const [reduceMotion, setReduceMotion] = React.useState(false);
  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v) => {
        if (!cancelled) setReduceMotion(!!v);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Shared values for the envelope itself.
  const scale = useSharedValue(0);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const opacity = useSharedValue(0);
  const captionOpacity = useSharedValue(0);

  // Target corner (top-right). Envelope start = center → end = top-right
  // minus a comfortable inset. Compute once per render.
  const TARGET_X = useMemo(() => SCREEN_W * 0.42, []);
  const TARGET_Y = useMemo(() => -SCREEN_H * 0.42, []);

  useEffect(() => {
    if (!visible) {
      // Reset for next show.
      scale.value = 0;
      opacity.value = 0;
      captionOpacity.value = 0;
      translateX.value = 0;
      translateY.value = 0;
      return;
    }

    // Success haptic right at start — gives the user feedback even before
    // the animation reaches its peak.
    haptic('success');

    if (reduceMotion) {
      // Soft fade-in only. Hold 900 ms, then onComplete.
      scale.value = 1;
      opacity.value = withTiming(1, { duration: 220 });
      captionOpacity.value = withTiming(1, { duration: 220 });
      const t = setTimeout(() => {
        opacity.value = withTiming(0, { duration: 200 });
        captionOpacity.value = withTiming(0, { duration: 200 });
        setTimeout(onComplete, 220);
      }, 900);
      return () => clearTimeout(t);
    }

    // FULL ANIMATION SEQUENCE
    //
    // Timeline (ms from t=0):
    //   0   — envelope spawns; opacity 0→1, caption fades in after 220 ms
    //   0–420  — scale 0 → 1.5 (overshoot via spring)
    //   420–640 — scale 1.5 → 1.0 (settle)
    //   640–900 — hover, money explosion runs (RUBLE_TRACKS fade-out at +180 ms each)
    //   900–1450 — fly to top-right corner, shrink 1.0 → 0.4
    //   1450–1700 — opacity fades to 0; onComplete called from the final step's callback
    opacity.value = withTiming(1, { duration: 120 });
    captionOpacity.value = withDelay(220, withTiming(1, { duration: 200 }));

    // Translation kicks in after the spring + hover phase (~900 ms).
    translateX.value = withDelay(
      900,
      withTiming(TARGET_X, { duration: 550, easing: Easing.in(Easing.cubic) }),
    );
    translateY.value = withDelay(
      900,
      withTiming(TARGET_Y, { duration: 550, easing: Easing.in(Easing.cubic) }),
    );
    // Fade out the caption shortly before the envelope leaves screen.
    captionOpacity.value = withDelay(900, withTiming(0, { duration: 300 }));

    // Single scale animation chain:
    //   spring overshoot → settle → flight shrink (which fires onComplete on finish).
    scale.value = withSequence(
      withSpring(1.5, { damping: 9, stiffness: 130, mass: 0.9 }),
      withTiming(1.0, { duration: 220, easing: Easing.out(Easing.cubic) }),
      withDelay(
        280,
        withTiming(0.4, { duration: 550, easing: Easing.in(Easing.cubic) }, (finished) => {
          if (finished) {
            runOnJS(onComplete)();
          }
        }),
      ),
    );
    // Opacity fade-out runs alongside the final shrink so the envelope
    // doesn't snap-disappear at scale 0.4.
    opacity.value = withDelay(1250, withTiming(0, { duration: 400 }));

    return () => {
      cancelAnimation(scale);
      cancelAnimation(opacity);
      cancelAnimation(translateX);
      cancelAnimation(translateY);
      cancelAnimation(captionOpacity);
    };
  }, [visible, reduceMotion, scale, opacity, translateX, translateY, captionOpacity, TARGET_X, TARGET_Y, onComplete]);

  const envelopeStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const captionStyle = useAnimatedStyle(() => ({
    opacity: captionOpacity.value,
  }));

  const backdropStyle = useAnimatedStyle(() => ({
    opacity: opacity.value * 0.55,
  }));

  return (
    <RNModal visible={visible} transparent animationType="none" statusBarTranslucent>
      <View style={styles.host} pointerEvents="none">
        <Animated.View style={[styles.backdrop, backdropStyle]} />

        {/* Flying rubles — render below the envelope so envelope sits on top. */}
        <View style={styles.center} pointerEvents="none">
          {RUBLE_TRACKS.map((_, i) => (
            <FlyingRuble key={i} index={i} reduceMotion={reduceMotion} />
          ))}
        </View>

        <Animated.View style={[styles.center, envelopeStyle]} pointerEvents="none">
          <View style={styles.envelopeGlow}>
            <Ionicons name="mail" size={84} color={colors.white} />
          </View>
        </Animated.View>

        <Animated.View style={[styles.caption, captionStyle]} pointerEvents="none">
          <Text style={styles.captionAmount}>{formatMoney(amount)}</Text>
          <Text style={styles.captionLabel}>{employeeName}</Text>
        </Animated.View>
      </View>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  host: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0a0d14',
  },
  center: {
    position: 'absolute',
    left: SCREEN_W / 2 - 60,
    top: SCREEN_H / 2 - 60,
    width: 120,
    height: 120,
    alignItems: 'center',
    justifyContent: 'center',
  },
  envelopeGlow: {
    width: 120,
    height: 120,
    borderRadius: 28,
    backgroundColor: colors.green[500],
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.green[400],
    shadowOpacity: 0.85,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 0 },
    elevation: 18,
  },
  rubleGlyph: {
    position: 'absolute',
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rubleText: {
    fontSize: 24,
    fontWeight: fontWeight.bold,
    color: '#facc15', // amber-400 — pops on the dark backdrop
    textShadowColor: 'rgba(0,0,0,0.4)',
    textShadowRadius: 4,
  },
  caption: {
    position: 'absolute',
    bottom: SCREEN_H * 0.28,
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  captionAmount: {
    fontSize: fontSize['3xl'],
    fontWeight: fontWeight.bold,
    color: colors.white,
    letterSpacing: -0.5,
  },
  captionLabel: {
    marginTop: 6,
    fontSize: fontSize.base,
    color: 'rgba(255,255,255,0.78)',
    fontWeight: fontWeight.medium,
  },
});
