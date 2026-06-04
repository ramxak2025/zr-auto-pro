/**
 * BroadcastModal — the center-screen card that pops when a superadmin sends
 * a platform-wide announcement («объявление от поддержки»).
 *
 * Visual recipe is cloned from SalaryReceivedModal:
 *   • centered card with a Reanimated scale + opacity spring-in,
 *   • reduce-motion → simple fade (no scale bounce),
 *   • statusBarTranslucent RNModal so it overlays the whole screen.
 *
 * The ONE deliberate departure: the backdrop is <ModalBlurBackdrop> — a
 * frosted blur-behind layer (iOS BlurView / Android light frost) — NOT a
 * dark scrim. Owner explicitly asked for BLUR behind, not a black tint.
 * Only one BlurView is ever on screen because the modal is mounted solely
 * while a broadcast is showing (expo-blur restraint: never stack BlurViews).
 *
 * Card content:
 *   [optional rounded image]  → title (bold) → body → stacked CTA buttons.
 *   Button.action 'dismiss' → onDismiss(); 'link' → Linking.openURL → dismiss.
 *   If a broadcast carries no buttons, a default «Понятно» CTA is shown so
 *   the user always has a way to close.
 */
import React, { useEffect } from 'react';
import { Modal as RNModal, StyleSheet, View, ScrollView, Pressable, Linking, AccessibilityInfo } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import CachedImage from './CachedImage';
import ModalBlurBackdrop from './ModalBlurBackdrop';
import { Text } from '../platform/Typography';
import { useColors } from '../contexts/ThemeContext';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { haptic } from '../platform/haptics';
import type { Broadcast, BroadcastButton } from '../../../shared/types';

interface BroadcastModalProps {
  broadcast: Broadcast | null;
  onDismiss: () => void;
}

export default function BroadcastModal({ broadcast, onDismiss }: BroadcastModalProps) {
  const palette = useColors();
  const visible = !!broadcast;

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
      if (reduceMotion) {
        cardScale.value = 1;
        cardOpacity.value = withTiming(1, { duration: 220 });
      } else {
        cardScale.value = withSpring(1, { damping: 14, stiffness: 160 });
        cardOpacity.value = withTiming(1, { duration: 220 });
      }
      // Success haptic on mount — the user feels the announcement land.
      haptic('success');
    } else {
      cardScale.value = withTiming(0.9, { duration: 180 });
      cardOpacity.value = withTiming(0, { duration: 180 });
    }
  }, [visible, reduceMotion, cardScale, cardOpacity]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: cardOpacity.value,
    transform: [{ scale: cardScale.value }],
  }));

  const handleButton = React.useCallback(
    (btn: BroadcastButton) => {
      if (btn.action === 'link' && btn.url) {
        Linking.openURL(btn.url).catch(() => {});
      }
      // Every button — including 'link' — closes the modal afterwards.
      onDismiss();
    },
    [onDismiss],
  );

  if (!broadcast) return null;

  // Always guarantee a way to close: fall back to a default «Понятно» CTA.
  const buttons: BroadcastButton[] =
    broadcast.buttons && broadcast.buttons.length > 0 ? broadcast.buttons : [{ label: 'Понятно', action: 'dismiss' }];

  return (
    <RNModal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={onDismiss}>
      <View style={styles.host}>
        {/* Blur-behind layer (owner ask), NOT a dark scrim. Tapping it closes. */}
        <ModalBlurBackdrop intensity={40} onPress={onDismiss} />

        <Animated.View style={[styles.cardWrap, cardStyle]} pointerEvents="box-none">
          <View style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
            <ScrollView
              bounces={false}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.cardScrollContent}
            >
              {broadcast.imageUrl ? (
                <CachedImage
                  source={{ uri: broadcast.imageUrl }}
                  style={styles.image}
                  resizeMode="cover"
                  accessibilityIgnoresInvertColors
                />
              ) : (
                <LinearGradient
                  colors={[palette.accent.primary, colors.primary[700]] as [string, string]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.iconRing}
                >
                  <Ionicons name="megaphone" size={40} color={colors.white} />
                </LinearGradient>
              )}

              <Text style={[styles.title, { color: palette.text.primary }]}>{broadcast.title}</Text>
              {broadcast.body ? (
                <Text style={[styles.body, { color: palette.text.secondary }]}>{broadcast.body}</Text>
              ) : null}
            </ScrollView>

            <View style={styles.ctaStack}>
              {buttons.map((btn, idx) => (
                <CTAButton
                  key={`${btn.label}-${idx}`}
                  label={btn.label}
                  primary={idx === 0}
                  onPress={() => handleButton(btn)}
                  palette={palette}
                />
              ))}
            </View>
          </View>
        </Animated.View>
      </View>
    </RNModal>
  );
}

interface CTAButtonProps {
  label: string;
  /** First button gets the filled gradient; the rest are quiet outlines. */
  primary: boolean;
  onPress: () => void;
  palette: ReturnType<typeof useColors>;
}

const CTAButton = React.memo(function CTAButton({ label, primary, onPress, palette }: CTAButtonProps) {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPressIn={() => {
          scale.value = withTiming(0.97, { duration: 120 });
        }}
        onPressOut={() => {
          scale.value = withSpring(1, { damping: 10, stiffness: 200 });
        }}
        onPress={() => {
          haptic('impact');
          onPress();
        }}
        style={styles.ctaPressable}
      >
        {primary ? (
          <LinearGradient
            colors={[palette.accent.primary, colors.primary[700]] as [string, string]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.ctaGradient}
          >
            <Text style={styles.ctaTextPrimary}>{label}</Text>
          </LinearGradient>
        ) : (
          <View style={[styles.ctaOutline, { borderColor: palette.border.subtle, backgroundColor: palette.bg.muted }]}>
            <Text style={[styles.ctaTextSecondary, { color: palette.text.primary }]}>{label}</Text>
          </View>
        )}
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
  cardWrap: {
    width: '100%',
    maxWidth: 360,
  },
  card: {
    width: '100%',
    borderRadius: borderRadius['3xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[6],
    maxHeight: '82%',
    shadowColor: colors.black,
    shadowOpacity: 0.25,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 10 },
    elevation: 22,
  },
  cardScrollContent: {
    alignItems: 'center',
  },
  image: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: borderRadius['2xl'],
    marginBottom: spacing[4],
    backgroundColor: colors.gray[100],
  },
  iconRing: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[4],
    shadowColor: colors.primary[600],
    shadowOpacity: 0.4,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    textAlign: 'center',
    letterSpacing: -0.4,
  },
  body: {
    marginTop: spacing[2],
    fontSize: fontSize.base,
    lineHeight: 22,
    textAlign: 'center',
  },
  ctaStack: {
    width: '100%',
    marginTop: spacing[5],
    gap: spacing[2.5],
  },
  ctaPressable: {
    borderRadius: borderRadius['2xl'],
    overflow: 'hidden',
  },
  ctaGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[5],
    minHeight: 54,
  },
  ctaOutline: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[4],
    paddingHorizontal: spacing[5],
    minHeight: 54,
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
  },
  ctaTextPrimary: {
    color: colors.white,
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
    letterSpacing: -0.2,
  },
  ctaTextSecondary: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    letterSpacing: -0.2,
  },
});
