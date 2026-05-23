/**
 * ProgressLoader — full-screen premium loading UI for heavy operations.
 *
 * Use when the user kicks off something that may take more than ~500ms and
 * we want to (a) make it feel premium rather than "frozen", (b) give the
 * user a sense of progress when we know it, (c) offer a cancel option for
 * truly long ops.
 *
 * Design notes:
 *   • Modal transparent overlay → content underneath stays visible but
 *     non-interactive (we own the touch surface).
 *   • Center card: AUTEXA logo (gentle pulse), large rotating phrase, then
 *     a thin animated progress bar (Reanimated, UI-thread). When `progress`
 *     is unknown we run an indeterminate marquee instead.
 *   • Phrases rotate every ~2s, randomized so consecutive shows don't pick
 *     the same line.
 *   • Theme-aware (uses `useColors` from ThemeContext) — both light and
 *     dark variants are first-class.
 *
 * Integration: import + render at the screen level (e.g. ReportsScreen)
 * and gate via local `visible` state. Don't put it inside conditional list
 * items — the Modal must mount once per heavy op, not per row.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, View, StyleSheet, Image, TouchableOpacity, Platform } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';
import { Text } from '../platform/Typography';
import { useColors } from '../contexts/ThemeContext';
import { colors, spacing, borderRadius } from '../theme';

const PHRASES = [
  'Считаем рубли...',
  'Раскладываем по полочкам...',
  'Поднимаем складские документы...',
  'Просим бухгалтера не подсматривать...',
  'Подметаем стружку с цифр...',
  'Берём кофе с собой...',
  'Готовим премиальный отчёт...',
  'Включаем 3D-режим...',
  'Распаковываем данные...',
  'Прогреваем калькулятор...',
  'Чешем затылок и думаем...',
  'Запускаем волшебство...',
  'Чай уже остыл, кстати...',
  'Превращаем числа в смысл...',
  'Скоро будет очень красиво...',
];

const PHRASE_INTERVAL_MS = 2000;
const BAR_WIDTH_PCT = 0.7; // 70% of the screen

export interface ProgressLoaderProps {
  visible: boolean;
  /** 0..1 — when omitted, the bar runs indeterminate. */
  progress?: number;
  /** Pin the title text (skips the rotating phrases). */
  title?: string;
  /** Optional cancel handler. When provided, a small cancel pill appears. */
  onCancel?: () => void;
}

export default function ProgressLoader({ visible, progress, title, onCancel }: ProgressLoaderProps) {
  const palette = useColors();

  // ─── Rotating phrase ─────────────────────────────────────────────────────
  const [phraseIdx, setPhraseIdx] = useState(() => Math.floor(Math.random() * PHRASES.length));
  const phraseFade = useSharedValue(1);

  useEffect(() => {
    if (!visible || title) return;
    const handle = setInterval(() => {
      // Fade out, swap, fade in.
      phraseFade.value = withSequence(
        withTiming(0, { duration: 220, easing: Easing.in(Easing.cubic) }),
        withTiming(1, { duration: 280, easing: Easing.out(Easing.cubic) }),
      );
      // Trigger the swap once the fade-out completes. We use a separate
      // setTimeout so React state updates aren't tangled in worklet
      // callbacks.
      setTimeout(() => {
        setPhraseIdx((prev) => {
          let next = Math.floor(Math.random() * PHRASES.length);
          // Avoid showing the same phrase twice in a row.
          if (next === prev && PHRASES.length > 1) {
            next = (prev + 1) % PHRASES.length;
          }
          return next;
        });
      }, 220);
    }, PHRASE_INTERVAL_MS);
    return () => clearInterval(handle);
  }, [visible, title, phraseFade]);

  const phraseStyle = useAnimatedStyle(() => ({ opacity: phraseFade.value }));
  const displayTitle = title ?? PHRASES[phraseIdx];

  // ─── Logo pulse ──────────────────────────────────────────────────────────
  const logoScale = useSharedValue(1);
  useEffect(() => {
    if (!visible) {
      cancelAnimation(logoScale);
      logoScale.value = 1;
      return;
    }
    logoScale.value = withRepeat(
      withSequence(
        withTiming(1.06, { duration: 850, easing: Easing.inOut(Easing.cubic) }),
        withTiming(1, { duration: 850, easing: Easing.inOut(Easing.cubic) }),
      ),
      -1,
      false,
    );
    return () => cancelAnimation(logoScale);
  }, [visible, logoScale]);
  const logoStyle = useAnimatedStyle(() => ({ transform: [{ scale: logoScale.value }] }));

  // ─── Progress bar ────────────────────────────────────────────────────────
  // Determinate progress: width tweens between 0 and 1.
  const determinateFill = useSharedValue(0);
  useEffect(() => {
    if (typeof progress !== 'number') return;
    const clamped = Math.max(0, Math.min(1, progress));
    determinateFill.value = withTiming(clamped, { duration: 320, easing: Easing.out(Easing.cubic) });
  }, [progress, determinateFill]);

  // Indeterminate progress: a 30%-wide bar shuttles left↔right.
  const indeterminateX = useSharedValue(-0.3);
  useEffect(() => {
    if (!visible || typeof progress === 'number') {
      cancelAnimation(indeterminateX);
      indeterminateX.value = -0.3;
      return;
    }
    indeterminateX.value = -0.3;
    indeterminateX.value = withRepeat(
      withTiming(1, { duration: 1400, easing: Easing.inOut(Easing.cubic) }),
      -1,
      false,
    );
    return () => cancelAnimation(indeterminateX);
  }, [visible, progress, indeterminateX]);

  const determinateStyle = useAnimatedStyle(() => ({
    width: `${determinateFill.value * 100}%`,
  }));
  const indeterminateStyle = useAnimatedStyle(() => ({
    left: `${indeterminateX.value * 100}%`,
  }));

  // ─── Footer caption ─────────────────────────────────────────────────────
  const footerText =
    typeof progress === 'number' ? `${Math.max(0, Math.min(100, Math.round(progress * 100)))}%` : 'Пожалуйста, подождите';

  // ─── Mount guard ────────────────────────────────────────────────────────
  // React Native Modal needs the prop transitions to be stable; we keep the
  // visible flag honest so we don't leak the timer or animations.
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;

  const overlayBg = useMemo(
    () => (palette.bg.canvas === '#000000' ? 'rgba(0,0,0,0.55)' : 'rgba(15,23,42,0.45)'),
    [palette.bg.canvas],
  );

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent>
      <Animated.View
        entering={FadeIn.duration(220)}
        exiting={FadeOut.duration(180)}
        style={[styles.overlay, { backgroundColor: overlayBg }]}
        accessibilityViewIsModal
        accessibilityLabel={displayTitle}
      >
        <View style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
          <Animated.View style={[styles.logoBox, logoStyle]}>
            <Image
              source={require('../../assets/logo.png')}
              style={styles.logoImg}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
            />
          </Animated.View>

          <Animated.View style={[phraseStyle, styles.titleWrap]}>
            <Text variant="title3" color={palette.text.primary} style={styles.title}>
              {displayTitle}
            </Text>
          </Animated.View>

          <View style={[styles.barTrack, { backgroundColor: palette.bg.muted }]}>
            {typeof progress === 'number' ? (
              <Animated.View style={[styles.barFill, determinateStyle]} />
            ) : (
              <Animated.View style={[styles.barIndeterminate, indeterminateStyle]} />
            )}
          </View>

          <Text variant="caption" color={palette.text.tertiary} style={styles.footer}>
            {footerText}
          </Text>

          {onCancel && (
            <TouchableOpacity
              onPress={() => cancelRef.current?.()}
              style={[styles.cancelBtn, { backgroundColor: palette.bg.muted }]}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Отмена"
            >
              <Text variant="footnote" color={palette.text.secondary} style={styles.cancelText}>
                Отмена
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[6],
  },
  card: {
    width: '100%',
    maxWidth: 360,
    borderRadius: borderRadius['2xl'],
    paddingVertical: spacing[6],
    paddingHorizontal: spacing[5],
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    ...Platform.select({
      ios: {
        shadowColor: '#0F172A',
        shadowOpacity: 0.18,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: 12 },
      },
      android: { elevation: 8 },
    }),
  },
  logoBox: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[3],
  },
  logoImg: { width: 56, height: 56 },
  titleWrap: { minHeight: 28, alignItems: 'center', justifyContent: 'center', marginBottom: spacing[4] },
  title: { textAlign: 'center', fontWeight: '700', letterSpacing: -0.2 },
  barTrack: {
    width: `${BAR_WIDTH_PCT * 100}%`,
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    position: 'relative',
  },
  barFill: {
    height: '100%',
    backgroundColor: colors.primary[500],
    borderRadius: 3,
  },
  barIndeterminate: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '30%',
    backgroundColor: colors.primary[500],
    borderRadius: 3,
  },
  footer: { marginTop: spacing[3], textAlign: 'center', fontVariant: ['tabular-nums'] },
  cancelBtn: {
    marginTop: spacing[4],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
  },
  cancelText: { fontWeight: '600', letterSpacing: -0.1 },
});
