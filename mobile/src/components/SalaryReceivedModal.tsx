/**
 * SalaryReceivedModal — celebratory overlay shown to the EMPLOYEE on any
 * screen when they have a still-unconfirmed payment from the owner.
 *
 * Mounted globally inside <App /> via <SalaryNotificationProvider>, so it
 * can appear over any tab / detail screen without each screen wiring it
 * up. Detection logic:
 *
 *   1. Right after login, AuthProvider triggers `refreshPendingPayments()`
 *      via the context.
 *   2. The provider calls `salaryApi.getAll(currentMonth)`, walks every
 *      master's `payments`, and picks the first one where
 *      `confirmedAt === null` AND `userId === currentUser.id`.
 *   3. That payment is dropped into context state — the modal mounts
 *      automatically.
 *
 * UX flow:
 *   • Confetti shower (Reanimated, ~50 small coloured rects falling +
 *     drifting laterally with gentle rotation).
 *   • Centered card: envelope icon, big title (Аванс / Зарплата / Премия),
 *     subtitle "От {ownerName}", primary CTA "Подтвердить получение".
 *   • Tap → `salaryApi.confirmPayment(id)` → success haptic + dismiss.
 *
 * Reduce-motion: confetti suppressed; the card still appears with a
 * simple fade-in. The CTA is identical in both modes.
 */
import React, { useEffect, useMemo } from 'react';
import {
  Modal as RNModal,
  StyleSheet,
  View,
  Dimensions,
  AccessibilityInfo,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Text } from '../platform/Typography';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { haptic } from '../platform/haptics';
import type { SalaryPayment } from '../../../shared/types';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');

const CONFETTI_COUNT = 50;
const CONFETTI_COLORS = [
  '#facc15', // amber-400
  '#34d399', // emerald-400
  '#60a5fa', // blue-400
  '#fb7185', // rose-400
  '#a78bfa', // violet-400
  '#fbbf24', // amber-400
  '#22c55e', // green-500
];

interface ConfettiPieceProps {
  index: number;
  reduceMotion: boolean;
}

// Pre-computed deterministic "random" tracks so each piece's behaviour is
// stable across renders (no useState/Math.random in the render path).
function trackFor(index: number) {
  // Use sine/cosine of the index to scatter pieces across the screen.
  const horizontalSpread = ((Math.sin(index * 17.31) + 1) / 2) * SCREEN_W;
  const startX = horizontalSpread - SCREEN_W / 2; // centered ±
  const drift = Math.cos(index * 7.13) * 60;
  const startY = -((index % 10) * 60 + 80);
  const endY = SCREEN_H + 80;
  const duration = 2400 + (index % 7) * 240; // 2.4–4 s
  const delay = (index % 12) * 90;
  const rotateStart = (index % 4) * 90;
  const rotateEnd = rotateStart + 540 + (index % 3) * 180;
  const color = CONFETTI_COLORS[index % CONFETTI_COLORS.length];
  const size = 6 + (index % 5);
  return { startX, drift, startY, endY, duration, delay, rotateStart, rotateEnd, color, size };
}

const ConfettiPiece = React.memo(function ConfettiPiece({ index, reduceMotion }: ConfettiPieceProps) {
  const track = useMemo(() => trackFor(index), [index]);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion) return;
    progress.value = withDelay(track.delay, withTiming(1, { duration: track.duration, easing: Easing.linear }));
    return () => {
      cancelAnimation(progress);
    };
  }, [reduceMotion, track.delay, track.duration, progress]);

  const style = useAnimatedStyle(() => {
    const p = progress.value;
    return {
      transform: [
        { translateX: track.startX + track.drift * Math.sin(p * Math.PI * 2) },
        { translateY: track.startY + (track.endY - track.startY) * p },
        { rotate: `${track.rotateStart + (track.rotateEnd - track.rotateStart) * p}deg` },
      ],
      opacity: p > 0.92 ? (1 - p) / 0.08 : 1,
    };
  });

  if (reduceMotion) return null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.confetti,
        {
          width: track.size,
          height: track.size * 1.6,
          backgroundColor: track.color,
        },
        style,
      ]}
    />
  );
});

interface SalaryReceivedModalProps {
  visible: boolean;
  payment: SalaryPayment | null;
  /** Called when the employee taps "Подтвердить получение". Parent is
   *  expected to call `salaryApi.confirmPayment(payment.id)` and dismiss. */
  onConfirm: () => void;
  /** Mutation pending flag — disables the CTA + shows spinner. */
  confirming: boolean;
}

function paymentTitle(type: SalaryPayment['type']): string {
  switch (type) {
    case 'advance':
      return 'Аванс';
    case 'premium':
      return 'Премия';
    case 'salary':
    default:
      return 'Зарплата';
  }
}

function formatMoney(v: number): string {
  return (
    Math.round(v)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
  );
}

export default function SalaryReceivedModal({
  visible,
  payment,
  onConfirm,
  confirming,
}: SalaryReceivedModalProps) {
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

  const cardScale = useSharedValue(0.85);
  const cardOpacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      cardScale.value = withSpring(1, { damping: 14, stiffness: 160 });
      cardOpacity.value = withTiming(1, { duration: 220 });
      // Subtle success haptic when the modal mounts — the employee can
      // feel the notification before reading it.
      haptic('success');
    } else {
      cardScale.value = withTiming(0.9, { duration: 180 });
      cardOpacity.value = withTiming(0, { duration: 180 });
    }
  }, [visible, cardScale, cardOpacity]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: cardOpacity.value,
    transform: [{ scale: cardScale.value }],
  }));

  if (!payment) return null;

  const title = paymentTitle(payment.type);
  const ownerName = payment.creatorName || 'Руководителя';

  return (
    <RNModal visible={visible} transparent animationType="none" statusBarTranslucent>
      <View style={styles.host}>
        <View style={styles.backdrop} />

        {/* Confetti shower */}
        <View style={styles.confettiHost} pointerEvents="none">
          {Array.from({ length: CONFETTI_COUNT }).map((_, i) => (
            <ConfettiPiece key={i} index={i} reduceMotion={reduceMotion} />
          ))}
        </View>

        <Animated.View style={[styles.cardWrap, cardStyle]} pointerEvents="box-none">
          <LinearGradient
            colors={[colors.green[500], colors.green[700]] as [string, string]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.iconRing}
          >
            <Ionicons name="mail" size={48} color={colors.white} />
          </LinearGradient>

          <Text style={styles.title}>{title}</Text>
          <Text style={styles.amount}>{formatMoney(payment.amount)}</Text>
          <Text style={styles.from}>От {ownerName}</Text>

          {payment.comment ? <Text style={styles.comment}>«{payment.comment}»</Text> : null}

          <View style={styles.ctaWrap}>
            <View style={styles.ctaShadowWrap}>
              <CTAButton confirming={confirming} onPress={onConfirm} />
            </View>
          </View>

          <Text style={styles.hint}>Подтвердите получение денег от руководителя</Text>
        </Animated.View>
      </View>
    </RNModal>
  );
}

interface CTAButtonProps {
  confirming: boolean;
  onPress: () => void;
}

const CTAButton = React.memo(function CTAButton({ confirming, onPress }: CTAButtonProps) {
  // Local press feedback via Reanimated — small scale on press-in.
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Подтвердить получение"
        disabled={confirming}
        onPressIn={() => {
          scale.value = withTiming(0.97, { duration: 120 });
        }}
        onPressOut={() => {
          scale.value = withSpring(1, { damping: 10, stiffness: 200 });
        }}
        onPress={() => {
          if (!confirming) {
            haptic('impact');
            onPress();
          }
        }}
        style={styles.cta}
      >
        <LinearGradient
          colors={[colors.green[500], colors.green[700]] as [string, string]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.ctaGradient}
        >
          {confirming ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={20} color={colors.white} />
              <Text style={styles.ctaText}>Подтвердить получение</Text>
            </>
          )}
        </LinearGradient>
      </Pressable>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  host: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[5],
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(10,13,20,0.74)',
  },
  confettiHost: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: SCREEN_W,
    height: SCREEN_H,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  confetti: {
    position: 'absolute',
    top: 0,
    left: SCREEN_W / 2,
    borderRadius: 2,
  },
  cardWrap: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.white,
    borderRadius: borderRadius['3xl'],
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[7],
    alignItems: 'center',
    shadowColor: colors.black,
    shadowOpacity: 0.25,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 10 },
    elevation: 22,
  },
  iconRing: {
    width: 88,
    height: 88,
    borderRadius: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[3],
    shadowColor: colors.green[600],
    shadowOpacity: 0.4,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  title: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.semibold,
    color: colors.gray[600],
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  amount: {
    fontSize: 40,
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
    letterSpacing: -1,
    marginTop: 4,
    marginBottom: 8,
  },
  from: {
    fontSize: fontSize.sm,
    color: colors.gray[500],
    marginBottom: spacing[1],
  },
  comment: {
    marginTop: spacing[2],
    fontSize: fontSize.sm,
    fontStyle: 'italic',
    color: colors.gray[500],
    textAlign: 'center',
  },
  ctaWrap: {
    width: '100%',
    marginTop: spacing[5],
  },
  ctaShadowWrap: {
    borderRadius: borderRadius['2xl'],
    shadowColor: colors.green[700],
    shadowOpacity: 0.35,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  cta: {
    borderRadius: borderRadius['2xl'],
    overflow: 'hidden',
  },
  ctaGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[5],
    gap: spacing[2],
    minHeight: 56,
  },
  ctaText: {
    color: colors.white,
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
    letterSpacing: -0.2,
  },
  hint: {
    marginTop: spacing[3],
    fontSize: fontSize.xs,
    color: colors.gray[400],
    textAlign: 'center',
  },
});
