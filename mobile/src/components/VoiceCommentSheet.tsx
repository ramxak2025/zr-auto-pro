import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator, Linking, AccessibilityInfo } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  Easing,
  cancelAnimation,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import Modal from './Modal';
import { Text } from '../platform/Typography';
import { haptic } from '../platform/haptics';
import { useColors } from '../contexts/ThemeContext';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
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

const BAR_WEIGHTS = [0.55, 0.85, 1, 0.85, 0.55];

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

  // ── Pulsing halo while recording ─────────────────────────────────────────
  const pulse = useSharedValue(0);
  useEffect(() => {
    if (phase === 'recording' && !reduceMotion) {
      pulse.value = withRepeat(withTiming(1, { duration: 1100, easing: Easing.out(Easing.ease) }), -1, false);
    } else {
      cancelAnimation(pulse);
      pulse.value = 0;
    }
  }, [phase, reduceMotion, pulse]);

  const haloStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + pulse.value * 0.6 }],
    opacity: 0.4 * (1 - pulse.value),
  }));

  // ── Actions ──────────────────────────────────────────────────────────────
  const handleStart = useCallback(async () => {
    try {
      haptic('tap');
      setErrorMsg('');
      await rec.start();
      setPhase('recording');
    } catch (err) {
      if (err instanceof VoicePermissionError) {
        setDeniedCanAskAgain(err.canAskAgain);
        setPhase('denied');
      } else {
        setErrorMsg('Не удалось получить доступ к микрофону.');
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
      haptic('error');
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
    if (rec.isRecording) rec.cancel();
    onClose();
  }, [rec, onClose]);

  const openSettings = useCallback(() => {
    haptic('tap');
    Linking.openSettings().catch(() => {});
  }, []);

  const remainingHint = formatRemaining(remainingSeconds);

  // ── Render per phase ──────────────────────────────────────────────────────
  const renderBody = () => {
    if (phase === 'processing') {
      return (
        <View style={styles.centerBlock}>
          <ActivityIndicator size="large" color={palette.accent.primary} />
          <Text style={[styles.statusText, { color: palette.text.secondary }]}>Распознаю…</Text>
        </View>
      );
    }

    if (phase === 'denied') {
      return (
        <View style={styles.centerBlock}>
          <View style={[styles.iconRing, { backgroundColor: softErr }]}>
            <Ionicons name="mic-off-outline" size={30} color={colors.red[500]} />
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
          <View style={[styles.iconRing, { backgroundColor: softErr }]}>
            <Ionicons name="alert-circle-outline" size={30} color={colors.red[500]} />
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
          {isRecording && <Animated.View style={[styles.halo, haloStyle]} pointerEvents="none" />}
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={isRecording ? handleStop : handleStart}
            style={[styles.micButton, { backgroundColor: isRecording ? colors.red[500] : palette.accent.primary }]}
          >
            <Ionicons name={isRecording ? 'stop' : 'mic'} size={34} color={colors.white} />
          </TouchableOpacity>
        </View>

        {isRecording ? (
          <>
            <Text style={[styles.timer, { color: palette.text.primary }]}>{formatTimer(rec.durationMs)}</Text>
            <View style={styles.bars}>
              {BAR_WEIGHTS.map((w, i) => (
                <View
                  key={i}
                  style={[
                    styles.bar,
                    {
                      backgroundColor: palette.accent.primary,
                      height: 6 + Math.min(1, rec.level) * 34 * w,
                    },
                  ]}
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
      {renderBody()}
    </Modal>
  );
}

const softErr = 'rgba(239,68,68,0.12)';

const styles = StyleSheet.create({
  centerBlock: { alignItems: 'center', paddingVertical: spacing[3], gap: spacing[3] },
  micWrap: { width: 128, height: 128, alignItems: 'center', justifyContent: 'center' },
  halo: {
    position: 'absolute',
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.red[500],
  },
  micButton: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.black,
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  timer: { fontSize: 30, fontWeight: '700', letterSpacing: 1, fontVariant: ['tabular-nums'] },
  bars: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5], height: 44 },
  bar: { width: 6, borderRadius: 3, minHeight: 6 },
  statusText: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, textAlign: 'center' },
  hintText: { fontSize: fontSize.sm, textAlign: 'center', lineHeight: 20, paddingHorizontal: spacing[4] },
  remaining: { fontSize: 12, marginTop: spacing[1] },
  iconRing: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
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
