/**
 * SalaryReceivedModal — recipient notification shared by payouts, advances,
 * legacy payments and fines. Fines use a separate subdued illustration;
 * they never get confetti, a spring entrance or a success haptic.
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
 *     subtitle "От {ownerName}", primary CTA.
 *   • Round 17 (158) — у ВЫПЛАТЫ (salary_payouts) решения больше нет: деньги
 *     зафиксированы в момент выдачи, поэтому кнопки «Принять / Отклонить»
 *     заменены одной «Понятно» → `salaryApi.markPayoutViewed(id)` («просмотрено»
 *     для владельца). ЛЕГАСИ salary_payments сохраняют «Подтвердить получение».
 *
 * Reduce-motion: confetti suppressed; the card still appears with a
 * simple fade-in. The CTA is identical in both modes.
 */
import React, { useEffect, useMemo } from 'react';
import {
  Modal as RNModal,
  StyleSheet,
  View,
  ActivityIndicator,
  Pressable,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { useColors } from '../contexts/ThemeContext';
import { haptic } from '../platform/haptics';
import { useReduceMotionPreference } from '../hooks/useReduceMotionPreference';
import { SalaryFineIllustration } from './SalaryFineIllustration';
import { formatSalaryNoticeAmount } from '../utils/salaryNotices';
import type { SalaryFine, SalaryPayment, SalaryPayout } from '../../../shared/types';

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
  width: number;
  height: number;
}

// Pre-computed deterministic "random" tracks so each piece's behaviour is
// stable across renders (no useState/Math.random in the render path).
function trackFor(index: number, width: number, height: number) {
  // Use sine/cosine of the index to scatter pieces across the screen.
  const horizontalSpread = ((Math.sin(index * 17.31) + 1) / 2) * width;
  const startX = horizontalSpread - width / 2; // centered ±
  const drift = Math.cos(index * 7.13) * 60;
  const startY = -((index % 10) * 60 + 80);
  const endY = height + 80;
  const duration = 2400 + (index % 7) * 240; // 2.4–4 s
  const delay = (index % 12) * 90;
  const rotateStart = (index % 4) * 90;
  const rotateEnd = rotateStart + 540 + (index % 3) * 180;
  const color = CONFETTI_COLORS[index % CONFETTI_COLORS.length];
  const size = 6 + (index % 5);
  return { startX, drift, startY, endY, duration, delay, rotateStart, rotateEnd, color, size };
}

const ConfettiPiece = React.memo(function ConfettiPiece({ index, reduceMotion, width, height }: ConfettiPieceProps) {
  const track = useMemo(() => trackFor(index, width, height), [index, width, height]);
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
  fine?: SalaryFine | null;
  visible: boolean;
  /** Legacy `salary_payments` flow — single «Подтвердить получение» CTA. */
  payment: SalaryPayment | null;
  /**
   * Выплата `salary_payouts` (createPayout). Round 17 (158): деньги уже
   * зафиксированы — карточка ИНФОРМИРУЕТ, единственное действие «Понятно».
   * Когда задана, имеет приоритет над `payment`.
   */
  payout?: SalaryPayout | null;
  /** Legacy: employee confirms receipt → `salaryApi.confirmPayment(payment.id)`. */
  onConfirm: () => void;
  /** Payout: сотрудник закрывает уведомление → `salaryApi.markPayoutViewed(id)`. */
  onAcknowledge?: () => void;
  /**
   * «Позже» — выход БЕЗ решения и БЕЗ сетевого запроса. Модалка глобальная и
   * перекрывает всё приложение, а её единственная кнопка ходит в сеть: без
   * этого выхода пропавший запрос запирал сотруднику телефон целиком.
   */
  onSnooze?: () => void;
  /** Mutation pending flag — disables the CTAs + shows a spinner. */
  confirming: boolean;
}

function paymentTitle(type: SalaryPayment['type'] | SalaryPayout['type']): string {
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

export default function SalaryReceivedModal({
  visible,
  fine = null,
  payment,
  payout = null,
  onConfirm,
  onAcknowledge,
  onSnooze,
  confirming,
}: SalaryReceivedModalProps) {
  const palette = useColors();
  // Живая высота окна (не module-level Dimensions): карточка никогда не выше
  // экрана — на маленьких iPhone/при крупном системном шрифте контент внутри
  // скроллится, а не сжимается и не обрезается (Round 16 #5).
  const { height: winH, width: winW } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const maxCardHeight = Math.max(1, winH - insets.top - insets.bottom - spacing[4] * 2);
  const reduceMotion = useReduceMotionPreference();
  const itemId = fine?.id ?? payout?.id ?? payment?.id;

  const cardScale = useSharedValue(0.85);
  const cardOpacity = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      cardScale.value = reduceMotion || fine ? 1 : withSpring(1, { damping: 14, stiffness: 160 });
      cardOpacity.value = withTiming(1, { duration: 220 });
      // Subtle success haptic when the modal mounts — the employee can
      // feel the notification before reading it.
    } else {
      cardScale.value = reduceMotion || fine ? 1 : withTiming(0.9, { duration: 180 });
      cardOpacity.value = withTiming(0, { duration: 180 });
    }
    return () => {
      cancelAnimation(cardScale);
      cancelAnimation(cardOpacity);
    };
  }, [visible, itemId, reduceMotion, !!fine, cardScale, cardOpacity]);

  useEffect(() => {
    if (visible) haptic(fine ? 'warning' : 'success');
  }, [visible, itemId, !!fine]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: cardOpacity.value,
    transform: [{ scale: cardScale.value }],
  }));

  // The new payout takes precedence over a legacy payment when both happen to
  // be present (the context surfaces one item at a time anyway).
  const item = fine ?? payout ?? payment;
  if (!item) return null;
  const isPayout = !!payout;

  const title = fine ? 'Начислен штраф' : paymentTitle((payout ?? payment)!.type);
  const ownerName = item.creatorName || 'Руководителя';

  return (
    // onRequestClose — аппаратная «назад» на Android. Без неё модалка не
    // закрывалась вообще ничем, кроме удачного сетевого запроса.
    <RNModal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={onSnooze}>
      <View style={[styles.host, { paddingTop: insets.top + spacing[4], paddingBottom: insets.bottom + spacing[4] }]}>
        <View style={styles.backdrop} />

        {/* Confetti shower */}
        {!fine && !reduceMotion && visible && (
          <View key={itemId} style={styles.confettiHost} pointerEvents="none">
            {Array.from({ length: CONFETTI_COUNT }).map((_, i) => (
              <ConfettiPiece key={i} index={i} reduceMotion={reduceMotion} width={winW} height={winH} />
            ))}
          </View>
        )}

        <Animated.View
          style={[styles.cardWrap, { backgroundColor: palette.bg.elevated, maxHeight: maxCardHeight }, cardStyle]}
          pointerEvents="box-none"
        >
          {/* Контент в ScrollView: пока помещается — ведёт себя как статичная
              карточка (bounces выключен), а на маленьких экранах / при крупном
              шрифте скроллится вместо обрезания сверху и снизу. */}
          <ScrollView
            style={styles.cardScroll}
            contentContainerStyle={styles.cardContent}
            bounces={false}
            showsVerticalScrollIndicator={false}
          >
            {fine ? (
              <SalaryFineIllustration key={itemId} reducedMotion={reduceMotion || !visible} />
            ) : (
              <LinearGradient
                colors={[colors.green[500], colors.green[700]] as [string, string]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.iconRing}
              >
                <Ionicons name="mail" size={48} color={colors.white} />
              </LinearGradient>
            )}

            <Text style={[styles.title, { color: palette.text.secondary }]}>{title}</Text>
            <Text
              style={[
                styles.amount,
                { color: fine ? (palette.mode === 'dark' ? '#fca5a5' : colors.red[600]) : palette.text.primary },
              ]}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.45}
              maxFontSizeMultiplier={1.3}
            >
              {fine ? '−' : ''}
              {formatSalaryNoticeAmount(item.amount)}
            </Text>
            <Text style={[styles.from, { color: palette.text.secondary }]}>От {ownerName}</Text>

            {item.comment ? (
              <Text style={[styles.comment, { color: palette.text.secondary }]}>«{item.comment}»</Text>
            ) : null}

            <View style={styles.ctaWrap}>
              <View style={[styles.ctaShadowWrap, fine && { shadowColor: '#334155', shadowOpacity: 0.15 }]}>
                <CTAButton
                  confirming={confirming}
                  label={isPayout || fine ? 'Понятно' : 'Подтвердить получение'}
                  onPress={isPayout || fine ? () => onAcknowledge?.() : onConfirm}
                  subdued={!!fine}
                  reducedMotion={reduceMotion}
                />
              </View>
            </View>

            <Text style={[styles.hint, { color: palette.text.tertiary }]}>
              {fine
                ? 'Сумма удержана из начисленной зарплаты. Если есть вопросы, обсудите их с руководителем.'
                : isPayout
                  ? 'Выплата зафиксирована руководителем'
                  : 'Подтвердите получение денег от руководителя'}
            </Text>

            {/* Выход без решения. Ничего не отправляет: выплата всплывёт снова
                при следующем запуске приложения. */}
            {onSnooze ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Позже"
                onPress={onSnooze}
                disabled={confirming}
                style={styles.snooze}
                hitSlop={8}
              >
                <Text style={[styles.snoozeText, { color: palette.text.tertiary }]}>Позже</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </Animated.View>
      </View>
    </RNModal>
  );
}

interface CTAButtonProps {
  subdued?: boolean;
  reducedMotion: boolean;
  confirming: boolean;
  /** «Подтвердить получение» (легаси-платёж) или «Понятно» (выплата, 158). */
  label: string;
  onPress: () => void;
}

const CTAButton = React.memo(function CTAButton({
  confirming,
  label,
  onPress,
  subdued,
  reducedMotion,
}: CTAButtonProps) {
  // Local press feedback via Reanimated — small scale on press-in.
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={style}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        disabled={confirming}
        onPressIn={() => {
          if (!reducedMotion) scale.value = withTiming(0.97, { duration: 120 });
        }}
        onPressOut={() => {
          scale.value = reducedMotion ? 1 : withSpring(1, { damping: 10, stiffness: 200 });
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
          colors={subdued ? ['#475569', '#334155'] : [colors.green[500], colors.green[700]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.ctaGradient}
        >
          {confirming ? (
            <ActivityIndicator color={colors.white} />
          ) : (
            <>
              {!subdued && <Ionicons name="checkmark" size={20} color={colors.white} />}
              <Text style={styles.ctaText}>{label}</Text>
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
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  confetti: {
    position: 'absolute',
    top: 0,
    left: '50%',
    borderRadius: 2,
  },
  cardWrap: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: colors.white,
    borderRadius: borderRadius['3xl'],
    shadowColor: colors.black,
    shadowOpacity: 0.25,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 10 },
    elevation: 22,
  },
  // Скролл-слой отдельно от тени: overflow:hidden на самом cardWrap срезал бы
  // iOS-тень, поэтому клип закруглений живёт на ScrollView.
  cardScroll: {
    width: '100%',
    flexGrow: 0,
    borderRadius: borderRadius['3xl'],
    overflow: 'hidden',
  },
  cardContent: {
    alignItems: 'center',
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[7],
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
    width: '100%',
    fontSize: 40,
    // Явная высота строки (Round 16 #5): без неё крупный глиф-бокс наследует
    // Typography `body` lineHeight:22 и цифры обрезаются сверху и снизу —
    // класс бага «631К ₽», эталон фикса MarketingReportsScreen.kpiValue /
    // InstallmentDetailScreen.summaryRemaining.
    lineHeight: 48,
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
    letterSpacing: -1,
    includeFontPadding: false,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 8,
  },
  from: {
    textAlign: 'center',
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
    flexShrink: 1,
    textAlign: 'center',
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
  // «Позже» — тихая текстовая кнопка под подсказкой: выход есть всегда, но он
  // не конкурирует вниманием с основным действием.
  snooze: {
    marginTop: spacing[3],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[4],
    alignSelf: 'center',
  },
  snoozeText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    textAlign: 'center',
  },
});
