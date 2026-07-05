import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Linking,
  AccessibilityInfo,
  Platform,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  cancelAnimation,
  FadeIn,
  type SharedValue,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import Modal from './Modal';
import { Text } from '../platform/Typography';
import { PressableScale } from '../platform/PressableScale';
import { haptic } from '../platform/haptics';
import { useColors } from '../contexts/ThemeContext';
import { colors, fontSize, fontWeight, borderRadius, spacing, softTint } from '../theme';
import { voiceApi } from '../api/services';
import { useVoiceRecorder, mapVoiceError, VoicePermissionError, VOICE_MAX_DURATION_SEC } from '../utils/voiceRecorder';

interface VoiceCommentSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Called with recognised text — parent appends it to the comment field. */
  onInsert: (text: string) => void;
  /** Remaining voice seconds for the subtle "осталось N мин" hint. */
  remainingSeconds?: number;
}

type Phase = 'idle' | 'recording' | 'processing' | 'error' | 'denied';

// Symmetric equaliser profile — a soft "wave" shape peaking in the middle.
const BAR_WEIGHTS = [0.34, 0.52, 0.72, 0.9, 1, 0.9, 0.72, 0.52, 0.34];

// Voice identity — violet → blue accent gradient (the app's фиолет/синий brand).
const VOICE_GRADIENT = [colors.purple[600], colors.blue[500]] as const;

function formatTimer(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatRemaining(seconds?: number): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null;
  const mins = Math.floor(seconds / 60);
  if (seconds <= 0) return 'минуты голосового ввода закончились';
  if (mins <= 0) return 'осталось меньше минуты';
  return `осталось ~${mins} мин`;
}

/**
 * Bottom-sheet voice recorder for the order-narjad comment. Records LPCM
 * (see utils/voiceRecorder.ts), uploads to /voice/transcribe and returns the
 * recognised text to the caller. The comment field is always editable by hand —
 * voice is only an accelerator, so every failure path falls back to typing.
 */
export default function VoiceCommentSheet({ visible, onClose, onInsert, remainingSeconds }: VoiceCommentSheetProps) {
  const palette = useColors();
  const isDark = palette.mode === 'dark';
  const queryClient = useQueryClient();
  const rec = useVoiceRecorder();

  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [deniedCanAskAgain, setDeniedCanAskAgain] = useState(true);
  const [reduceMotion, setReduceMotion] = useState(false);

  const phaseRef = useRef<Phase>('idle');
  phaseRef.current = phase;

  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => mounted && setReduceMotion(v));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  // ── Breathing halo while recording ───────────────────────────────────────
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (phase === 'recording' && !reduceMotion) {
      // reverse=true → a calm inhale/exhale, not a one-shot ping.
      pulse.value = withRepeat(withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.ease) }), -1, true);
    } else {
      cancelAnimation(pulse);
      pulse.value = 0;
    }
  }, [phase, reduceMotion, pulse]);

  // pulse=0 → a soft resting glow (also the Reduce-Motion static state);
  // pulse=1 → wider + fainter. Oscillating between the two reads as breathing.
  const haloStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1.1 + pulse.value * 0.4 }],
    opacity: 0.26 - pulse.value * 0.16,
  }));

  // ── Live equaliser: mirror the JS audio level into a smoothed UI-thread SV ─
  const level = useSharedValue(0);
  useEffect(() => {
    const v = Math.max(0, Math.min(1, rec.level));
    if (reduceMotion) {
      level.value = v; // no easing — respect Reduce Motion
    } else {
      level.value = withTiming(v, { duration: 130, easing: Easing.out(Easing.ease) });
    }
  }, [rec.level, reduceMotion, level]);

  // A slow shared clock drives a gentle per-bar phase offset so the wave feels
  // alive even at a steady level (amplitude still comes only from `level`).
  const wave = useSharedValue(0);
  useEffect(() => {
    if (phase === 'recording' && !reduceMotion) {
      wave.value = withRepeat(withTiming(1, { duration: 950, easing: Easing.inOut(Easing.ease) }), -1, true);
    } else {
      cancelAnimation(wave);
      wave.value = 0;
    }
  }, [phase, reduceMotion, wave]);

  // ── Processing: a rotating accent arc (not a bare ActivityIndicator) ──────
  const spin = useSharedValue(0);
  useEffect(() => {
    if (phase === 'processing' && !reduceMotion) {
      spin.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.linear }), -1, false);
    } else {
      cancelAnimation(spin);
      spin.value = 0;
    }
  }, [phase, reduceMotion, spin]);
  const spinStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.value * 360}deg` }] }));

  // ── Actions ──────────────────────────────────────────────────────────────
  // Отмена сессии распознавания (находка ревью 05.07): закрытие шита во время
  // «Распознаю…» раньше НЕ отменяло полёт transcribe — текст вставлялся в поле
  // спустя секунды «сам», при повторной записи задваивался. Флаг помечает
  // сессию брошенной; долетевший ответ тогда молча выбрасывается (квота уже
  // списана — честно, Яндекс работу выполнил).
  const cancelledRef = useRef(false);

  const handleStart = useCallback(async () => {
    try {
      haptic('tap');
      setErrorMsg('');
      cancelledRef.current = false;
      await rec.start();
      setPhase('recording');
    } catch (err) {
      if (err instanceof VoicePermissionError) {
        setDeniedCanAskAgain(err.canAskAgain);
        setPhase('denied');
      } else {
        // Находка ревью 05.07: interop-фейл нативного рекордера (Android New
        // Arch) раньше маскировался под «нет доступа к микрофону» и нигде не
        // логировался — диагностика врала. Честное сообщение + след в Sentry.
        console.warn('[voice] start failed (не permission):', err);
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const Sentry = require('@sentry/react-native');
          Sentry.captureException?.(err);
        } catch {
          /* Sentry недоступен — не мешаем работе */
        }
        setErrorMsg('Голосовой ввод недоступен на этом устройстве. Введите комментарий вручную.');
        setPhase('error');
      }
    }
  }, [rec]);

  const handleStop = useCallback(async () => {
    if (phaseRef.current !== 'recording') return;
    setPhase('processing');
    haptic('select');

    let pcm: Awaited<ReturnType<typeof rec.stop>> = null;
    try {
      pcm = await rec.stop();
    } catch {
      setErrorMsg('Не удалось распознать, попробуйте ещё раз или введите вручную.');
      setPhase('error');
      return;
    }
    if (!pcm) {
      setErrorMsg('Слишком короткая запись. Нажмите и говорите чуть дольше.');
      setPhase('error');
      return;
    }

    try {
      const fd = new FormData();
      fd.append('audio', { uri: pcm.uri, name: pcm.name, type: pcm.type } as unknown as Blob);
      fd.append('durationSeconds', pcm.durationSeconds.toFixed(2));
      fd.append('format', 'lpcm');
      fd.append('sampleRateHertz', String(pcm.sampleRate));

      const res = await voiceApi.transcribe(fd);
      queryClient.invalidateQueries({ queryKey: ['voice', 'usage'] });

      // Сессию бросили (закрыли шит во время «Распознаю…») — долетевший ответ
      // не вставляем: неожиданный текст «сам по себе» хуже потерянного.
      if (cancelledRef.current) return;

      const text = (res.data?.text ?? '').trim();
      if (!text) {
        setErrorMsg('Речь не распознана. Попробуйте ещё раз или введите вручную.');
        setPhase('error');
        return;
      }
      haptic('success');
      onInsert(text);
      onClose();
    } catch (err) {
      if (cancelledRef.current) return;
      haptic('error');
      console.warn('[voice] transcribe failed:', err);
      setErrorMsg(mapVoiceError(err).message);
      setPhase('error');
    } finally {
      pcm.cleanup();
    }
  }, [rec, onInsert, onClose, queryClient]);

  // Soft auto-stop at the record cap.
  useEffect(() => {
    if (phase === 'recording' && rec.durationMs >= VOICE_MAX_DURATION_SEC * 1000) {
      handleStop();
    }
  }, [phase, rec.durationMs, handleStop]);

  const handleClose = useCallback(() => {
    cancelledRef.current = true; // бросаем возможный полёт «Распознаю…»
    if (rec.isRecording) rec.cancel();
    onClose();
  }, [rec, onClose]);

  const openSettings = useCallback(() => {
    haptic('tap');
    Linking.openSettings().catch(() => {});
  }, []);

  const remainingHint = formatRemaining(remainingSeconds);

  // Theme-aware red tint for the permission / error rings (dark-safe).
  const errTint = softTint(colors.red[500], palette.mode);
  const errIcon = isDark ? colors.red[400] : colors.red[500];
  const waveColor = isDark ? colors.violet[500] : colors.violet[600];
  const haloColor = isDark ? colors.violet[500] : colors.violet[600];
  const arcColor = isDark ? colors.purple[300] : colors.violet[600];

  // ── Render per phase ──────────────────────────────────────────────────────
  const renderBody = () => {
    if (phase === 'processing') {
      return (
        <View style={styles.centerBlock}>
          <View style={styles.processWrap}>
            <View style={[styles.processTrack, { borderColor: palette.border.subtle }]} />
            {reduceMotion ? (
              <ActivityIndicator size="large" color={arcColor} />
            ) : (
              <Animated.View style={[styles.processArc, { borderTopColor: arcColor }, spinStyle]} />
            )}
            <LinearGradient
              colors={VOICE_GRADIENT}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.processCore}
            >
              <Ionicons name="sparkles" size={20} color={colors.white} />
            </LinearGradient>
          </View>
          <Text style={[styles.statusText, { color: palette.text.primary }]}>Распознаю…</Text>
          <Text style={[styles.hintText, { color: palette.text.tertiary }]}>Секунду — превращаю речь в текст</Text>
        </View>
      );
    }

    if (phase === 'denied') {
      return (
        <View style={styles.centerBlock}>
          <View style={[styles.iconRing, { backgroundColor: errTint }]}>
            <Ionicons name="mic-off-outline" size={30} color={errIcon} />
          </View>
          <Text style={[styles.statusText, { color: palette.text.primary }]}>Нужен доступ к микрофону</Text>
          <Text style={[styles.hintText, { color: palette.text.tertiary }]}>
            Разрешите доступ к микрофону, чтобы надиктовать комментарий.
          </Text>
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.secondaryBtn, { borderColor: palette.border.strong }]}
              onPress={handleClose}
            >
              <Text style={[styles.secondaryBtnText, { color: palette.text.secondary }]}>Ввести вручную</Text>
            </TouchableOpacity>
            {deniedCanAskAgain ? (
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: palette.accent.primary }]}
                onPress={handleStart}
              >
                <Text style={styles.primaryBtnText}>Разрешить</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: palette.accent.primary }]}
                onPress={openSettings}
              >
                <Text style={styles.primaryBtnText}>Открыть настройки</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      );
    }

    if (phase === 'error') {
      return (
        <View style={styles.centerBlock}>
          <View style={[styles.iconRing, { backgroundColor: errTint }]}>
            <Ionicons name="alert-circle-outline" size={30} color={errIcon} />
          </View>
          <Text style={[styles.hintText, { color: palette.text.secondary }]}>{errorMsg}</Text>
          <View style={styles.actionsRow}>
            <TouchableOpacity
              style={[styles.secondaryBtn, { borderColor: palette.border.strong }]}
              onPress={handleClose}
            >
              <Text style={[styles.secondaryBtnText, { color: palette.text.secondary }]}>Закрыть</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: palette.accent.primary }]}
              onPress={handleStart}
            >
              <Ionicons name="refresh" size={16} color={colors.white} />
              <Text style={styles.primaryBtnText}>Ещё раз</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    // idle | recording
    const isRecording = phase === 'recording';
    return (
      <View style={styles.centerBlock}>
        <View style={styles.micWrap}>
          {isRecording && (
            <Animated.View style={[styles.halo, { backgroundColor: haloColor }, haloStyle]} pointerEvents="none" />
          )}
          <PressableScale
            onPress={isRecording ? handleStop : handleStart}
            hapticIntent={null}
            scaleTo={0.93}
            style={styles.micTouch}
            accessibilityRole="button"
            accessibilityLabel={isRecording ? 'Остановить запись' : 'Начать запись'}
          >
            <LinearGradient
              colors={VOICE_GRADIENT}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.micGradient}
            >
              {isRecording ? (
                <View style={styles.stopSquare} />
              ) : (
                <Ionicons name="mic" size={38} color={colors.white} />
              )}
            </LinearGradient>
          </PressableScale>
        </View>

        {isRecording ? (
          <>
            <Text style={[styles.timer, { color: palette.text.primary }]}>{formatTimer(rec.durationMs)}</Text>
            <View style={styles.bars}>
              {BAR_WEIGHTS.map((w, i) => (
                <WaveBar
                  key={i}
                  weight={w}
                  phase={i / BAR_WEIGHTS.length}
                  color={waveColor}
                  level={level}
                  wave={wave}
                  reduceMotion={reduceMotion}
                />
              ))}
            </View>
            <Text style={[styles.hintText, { color: palette.text.tertiary }]}>
              Нажмите, чтобы остановить · до {VOICE_MAX_DURATION_SEC} сек
            </Text>
          </>
        ) : (
          <>
            <Text style={[styles.statusText, { color: palette.text.primary }]}>Нажмите и продиктуйте</Text>
            <Text style={[styles.hintText, { color: palette.text.tertiary }]}>
              Голосом — быстрее, чем печатать. Текст можно поправить.
            </Text>
          </>
        )}

        {remainingHint && phase === 'idle' && (
          <Text style={[styles.remaining, { color: palette.text.tertiary }]}>{remainingHint}</Text>
        )}
      </View>
    );
  };

  return (
    <Modal visible={visible} onClose={handleClose} title="Голосовой комментарий">
      <Animated.View key={phase} entering={reduceMotion ? undefined : FadeIn.duration(200)}>
        {renderBody()}
      </Animated.View>
    </Modal>
  );
}

/**
 * One equaliser bar. Height amplitude comes ONLY from the shared `level`
 * (the real mic RMS); `wave` adds a decorative, level-scaled phase wobble so
 * the bank shimmers like a live waveform. Reduce Motion → amplitude only.
 */
function WaveBar({
  weight,
  phase,
  color,
  level,
  wave,
  reduceMotion,
}: {
  weight: number;
  phase: number;
  color: string;
  level: SharedValue<number>;
  wave: SharedValue<number>;
  reduceMotion: boolean;
}) {
  const style = useAnimatedStyle(() => {
    const wobble = reduceMotion ? 1 : 0.72 + 0.28 * Math.sin((wave.value + phase) * Math.PI * 2);
    return { height: 8 + level.value * 40 * weight * wobble };
  });
  return <Animated.View style={[styles.bar, { backgroundColor: color }, style]} />;
}

const styles = StyleSheet.create({
  centerBlock: { alignItems: 'center', paddingVertical: spacing[3], gap: spacing[4] },
  micWrap: { width: 132, height: 132, alignItems: 'center', justifyContent: 'center' },
  halo: {
    position: 'absolute',
    width: 108,
    height: 108,
    borderRadius: 54,
  },
  micTouch: { borderRadius: 52 },
  micGradient: {
    width: 104,
    height: 104,
    borderRadius: 52,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      ios: {
        shadowColor: colors.violet[600],
        shadowOpacity: 0.4,
        shadowRadius: 18,
        shadowOffset: { width: 0, height: 10 },
      },
      android: { elevation: 8 },
    }),
  },
  timer: {
    fontSize: 36,
    // Явная высота строки: без неё глиф-бокс 36pt обрезался сверху на части
    // устройств (скрин владельца 05.07 — «0:01» без верхней половины).
    lineHeight: 44,
    includeFontPadding: false,
    fontWeight: '700',
    letterSpacing: 1,
    fontVariant: ['tabular-nums'],
  },
  // Однозначная иконка «стоп» — белый скруглённый квадрат (глиф 'stop' на
  // градиенте читался как «ноль», скрин владельца 05.07).
  stopSquare: { width: 30, height: 30, borderRadius: 8, backgroundColor: colors.white },
  bars: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5], height: 56 },
  bar: { width: 5, borderRadius: 3, minHeight: 8 },
  statusText: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, textAlign: 'center' },
  hintText: { fontSize: fontSize.sm, textAlign: 'center', lineHeight: 20, paddingHorizontal: spacing[4] },
  remaining: { fontSize: 12, marginTop: spacing[1] },
  iconRing: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  // Processing spinner — rotating accent arc around a gradient core.
  processWrap: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center' },
  processTrack: {
    position: 'absolute',
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 4,
  },
  processArc: {
    position: 'absolute',
    width: 96,
    height: 96,
    borderRadius: 48,
    borderWidth: 4,
    borderColor: 'transparent',
  },
  processCore: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionsRow: { flexDirection: 'row', gap: spacing[2.5], marginTop: spacing[1], alignSelf: 'stretch' },
  primaryBtn: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing[1.5],
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[3],
    borderRadius: borderRadius.xl,
  },
  primaryBtnText: { color: colors.white, fontSize: fontSize.base, fontWeight: fontWeight.bold },
  secondaryBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
  },
  secondaryBtnText: { fontSize: fontSize.base, fontWeight: fontWeight.semibold },
});
