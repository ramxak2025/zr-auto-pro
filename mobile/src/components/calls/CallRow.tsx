/**
 * CallRow + ExpandedRecordingPlayer — одна строка журнала звонков с раскрывным
 * встроенным плеером записи. Извлечено из CallsScreen (Round 13 #8) один-в-один,
 * чтобы деталка рассрочки показывала звонки клиента тем же компонентом;
 * CallsScreen импортирует обратно — ноль визуальных изменений там.
 *
 * ВАЖНО (perf-паттерны, сохранены при извлечении — см. историю CallsScreen):
 *  • CallRow обёрнут в React.memo — скролл-ререндер родительского ScrollView
 *    не каскадится во все строки; строка ререндерится только когда меняется
 *    её совпадение с `playingId` или мутирует `call`.
 *  • ExpandedRecordingPlayer пинит player в ref: эффекты зависят ТОЛЬКО от
 *    `src`, не от player-инстанса — expo-audio реэмитит новый ref на каждом
 *    статус-тике, и зависимость от него дёргала бы .play() посреди
 *    воспроизведения (runaway re-renders на iPhone).
 *  • Аудио-сессия (playsInSilentMode и т.п.) настраивается НЕ здесь, а на
 *    корне экрана-хозяина через setAudioModeAsync — см. CallsScreen /
 *    InstallmentDetailScreen.
 */
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, fontSize, fontWeight, softTint } from '../../theme';
import { callsApi } from '../../api/services';
import type { useColors } from '../../contexts/ThemeContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Call {
  id: string;
  date: string;
  direction: 'incoming' | 'outgoing';
  from: string;
  to: string;
  duration: number;
  status: 'answered' | 'missed';
  recordingUrl: string | null;
  calledBack?: boolean;
  client: {
    id: string;
    fullName: string;
    cars: { plateNumber: string; makeModel: string }[];
  } | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '0:00';
  // Important: round down to integer seconds — expo-audio's currentTime
  // returns floats like 83.500141776 which would otherwise render as
  // "1:23.500141776" instead of "1:23".
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatPhone(phone: string): string {
  if (!phone) return '';
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 11 && cleaned[0] === '8') cleaned = '7' + cleaned.slice(1);
  if (cleaned.length === 11) {
    return `+${cleaned[0]} (${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7, 9)}-${cleaned.slice(9, 11)}`;
  }
  return phone;
}

// ---------------------------------------------------------------------------
// Call Row
// ---------------------------------------------------------------------------

// One global "currently playing" id so only one recording sounds at once.
// Lives at the host-screen root and is passed down via props (no Context to
// keep this file self-contained). React.memo wraps the function so a
// scroll-only re-render of the parent ScrollView doesn't cascade into all
// rows — the row only re-renders when `playingId` changes its match against
// this row, or when `call` mutates. setPlayingId is stable (React's useState
// setter).
export const CallRow = React.memo(function CallRow({
  call,
  navigation,
  playingId,
  setPlayingId,
  canListen,
  palette,
}: {
  call: Call;
  navigation: any;
  playingId: string | null;
  setPlayingId: (id: string | null) => void;
  /** ROLE-ONLY: прослушивание записей — только с calls_listen (список гейтится calls_view в меню). */
  canListen: boolean;
  palette: ReturnType<typeof useColors>;
}) {
  const isMissed = call.direction === 'incoming' && (call.status === 'missed' || call.duration === 0);
  const isIncoming = call.direction === 'incoming';
  const displayPhone = isIncoming ? call.from : call.to;
  const callTime = call.date
    ? new Date(call.date).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
    : '';

  const iconName =
    isMissed && call.calledBack
      ? 'call-outline'
      : isMissed
        ? 'close-circle-outline'
        : isIncoming
          ? 'arrow-down-outline'
          : 'arrow-up-outline';

  const iconColor =
    isMissed && call.calledBack
      ? colors.green[600]
      : isMissed
        ? colors.red[500]
        : isIncoming
          ? colors.green[600]
          : colors.blue[600];

  const iconBg =
    isMissed && call.calledBack
      ? colors.green[50]
      : isMissed
        ? colors.red[50]
        : isIncoming
          ? colors.green[50]
          : colors.blue[50];

  const isThisPlaying = playingId === call.id;

  return (
    <View style={[styles.callItemWrap, { backgroundColor: palette.bg.card }]}>
      <View style={[styles.callRow, { borderBottomColor: palette.border.subtle }]}>
        <View
          style={[styles.callIcon, { backgroundColor: palette.mode === 'dark' ? softTint(iconColor, 'dark') : iconBg }]}
        >
          <Ionicons name={iconName as any} size={18} color={iconColor} />
        </View>

        <View style={styles.callInfo}>
          <Text
            style={[
              styles.callPhone,
              { color: palette.text.primary },
              isMissed && !call.calledBack && { color: colors.red[600] },
            ]}
          >
            {formatPhone(displayPhone)}
          </Text>
          {call.client ? (
            <TouchableOpacity onPress={() => navigation.navigate('ClientDetail', { id: call.client!.id })}>
              <Text style={styles.callClient} numberOfLines={1}>
                {call.client.fullName}
                {call.client.cars?.[0] && ` • ${call.client.cars[0].makeModel || call.client.cars[0].plateNumber}`}
              </Text>
            </TouchableOpacity>
          ) : (
            <Text style={[styles.callUnknown, { color: palette.text.tertiary }]}>Неизвестный номер</Text>
          )}
        </View>

        <View style={styles.callRight}>
          <Text style={[styles.callTime, { color: palette.text.secondary }]}>{callTime}</Text>
          {call.duration > 0 && (
            <Text style={[styles.callDuration, { color: palette.text.tertiary }]}>{formatDuration(call.duration)}</Text>
          )}
          {isMissed && call.calledBack && (
            <Text style={[styles.callStatus, { color: colors.green[600] }]}>Перезвонили</Text>
          )}
          {isMissed && !call.calledBack && (
            <Text style={[styles.callStatus, { color: colors.red[500] }]}>Пропущен</Text>
          )}
        </View>

        {call.recordingUrl && canListen && (
          <TouchableOpacity
            style={[
              styles.playBtn,
              palette.mode === 'dark' && { backgroundColor: palette.accent.primarySoft },
              isThisPlaying && { backgroundColor: colors.primary[600] },
            ]}
            onPress={() => setPlayingId(isThisPlaying ? null : call.id)}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons
              name={isThisPlaying ? 'chevron-up' : 'play'}
              size={16}
              color={isThisPlaying ? colors.white : colors.primary[600]}
            />
          </TouchableOpacity>
        )}
      </View>
      {isThisPlaying && call.recordingUrl && canListen && (
        <ExpandedRecordingPlayer
          recordingUrl={call.recordingUrl}
          onClose={() => setPlayingId(null)}
          palette={palette}
        />
      )}
    </View>
  );
});

/**
 * ExpandedRecordingPlayer — full-fidelity in-app player that slides open
 * under the active call row.
 *
 *  • Lazy-loads the signed recording URL via callsApi.getRecordingUrl.
 *  • Uses expo-audio (`useAudioPlayer` + `useAudioPlayerStatus`).
 *  • Auto-starts playback once URL is fetched.
 *  • Big play/pause button, ±15s skip buttons, current/total time labels.
 *  • Tappable seek bar — tap anywhere on the track to jump to that
 *    position. Width measured via onLayout, ratio → seekTo().
 *  • Audio mode is configured at the host-screen root so playback also works
 *    when the iPhone ringer switch is set to silent.
 */
function ExpandedRecordingPlayer({
  recordingUrl,
  onClose,
  palette,
}: {
  recordingUrl: string;
  onClose: () => void;
  palette: ReturnType<typeof useColors>;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [trackWidth, setTrackWidth] = useState(0);

  const player = useAudioPlayer(src ? { uri: src } : null);
  const status = useAudioPlayerStatus(player);
  const playing = !!status?.playing;
  const durationSec = status?.duration ?? 0;
  const positionSec = status?.currentTime ?? 0;
  const progress = durationSec > 0 ? Math.min(1, positionSec / durationSec) : 0;

  // Lazy-fetch the URL on mount, then auto-play when it resolves.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const res: any = await callsApi.getRecordingUrl(recordingUrl);
        const url: string | undefined = res?.data?.url;
        if (!cancelled && url) setSrc(url);
      } catch {
        // swallow — keep the loading spinner; the user can re-tap
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recordingUrl]);

  // Auto-play once when the source URL resolves. Depend ONLY on `src` —
  // including `player` in deps caused the effect to re-fire whenever
  // expo-audio re-emitted a new player instance (each status tick can
  // produce a new ref), which then re-called `.play()` mid-playback and
  // racked up update churn. Reading `player` via a ref-pin keeps the
  // call without making the effect dependent on the player reference.
  const playerRef = useRef(player);
  useEffect(() => {
    playerRef.current = player;
  }, [player]);

  useEffect(() => {
    if (!src) return;
    try {
      playerRef.current?.play();
    } catch {
      /* ignore */
    }
  }, [src]);

  // Stop sound on unmount (row collapsed or another row picked). Cleanup
  // pins to the latest player via ref — depending on `player` directly
  // would re-run the cleanup on every status tick that produces a new
  // player ref, which on iPhone surfaced as runaway re-renders inside
  // the call list.
  useEffect(
    () => () => {
      try {
        playerRef.current?.pause();
      } catch {
        /* ignore */
      }
    },
    [],
  );

  const togglePlay = () => {
    if (!src) return;
    if (playing) player.pause();
    else player.play();
  };

  const seekDelta = (delta: number) => {
    if (!src || durationSec <= 0) return;
    const next = Math.max(0, Math.min(durationSec, positionSec + delta));
    try {
      player.seekTo(next);
    } catch {
      /* ignore */
    }
  };

  const seekToRatio = (ratio: number) => {
    if (!src || durationSec <= 0) return;
    const next = Math.max(0, Math.min(durationSec, durationSec * ratio));
    try {
      player.seekTo(next);
    } catch {
      /* ignore */
    }
  };

  return (
    <View
      style={[styles.expandedPlayer, { backgroundColor: palette.bg.muted, borderBottomColor: palette.border.subtle }]}
    >
      {/* Time labels */}
      <View style={styles.expandedTimeRow}>
        <Text style={[styles.expandedTime, { color: palette.text.secondary }]}>{formatDuration(positionSec)}</Text>
        <Text style={[styles.expandedTime, { color: palette.text.secondary }]}>
          {formatDuration(Math.max(0, durationSec - positionSec))}
        </Text>
      </View>

      {/* Tappable progress bar */}
      <Pressable
        onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
        onPress={(e) => {
          if (trackWidth <= 0) return;
          seekToRatio(e.nativeEvent.locationX / trackWidth);
        }}
        style={styles.expandedTrackHit}
      >
        <View style={[styles.expandedTrack, { backgroundColor: palette.border.subtle }]}>
          <View style={[styles.expandedTrackFill, { width: `${progress * 100}%` }]} />
          <View style={[styles.expandedThumb, { left: `${progress * 100}%`, backgroundColor: palette.bg.card }]} />
        </View>
      </Pressable>

      {/* Transport controls */}
      <View style={styles.expandedControls}>
        <TouchableOpacity
          onPress={() => seekDelta(-15)}
          style={[styles.expandedSkip, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
        >
          <Ionicons name="play-back" size={20} color={palette.text.secondary} />
          <Text style={[styles.expandedSkipLabel, { color: palette.text.secondary }]}>15</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={togglePlay} style={styles.expandedPlayBig}>
          {loading ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Ionicons name={playing ? 'pause' : 'play'} size={26} color={colors.white} />
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => seekDelta(15)}
          style={[styles.expandedSkip, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
        >
          <Ionicons name="play-forward" size={20} color={palette.text.secondary} />
          <Text style={[styles.expandedSkipLabel, { color: palette.text.secondary }]}>15</Text>
        </TouchableOpacity>

        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="close" size={22} color={palette.text.tertiary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles — moved verbatim from CallsScreen (visual parity is the contract).
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  callRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[50],
  },
  callIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing[3],
  },
  callInfo: { flex: 1, marginRight: spacing[2] },
  callPhone: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  callClient: { fontSize: fontSize.xs, color: colors.primary[600], marginTop: 2 },
  callUnknown: { fontSize: fontSize.xs, color: colors.gray[400], marginTop: 2 },
  callRight: { alignItems: 'flex-end', marginRight: spacing[2] },
  callTime: { fontSize: fontSize.xs, color: colors.gray[500] },
  callDuration: { fontSize: 10, color: colors.gray[400] },
  callStatus: { fontSize: 10, fontWeight: fontWeight.medium },

  playBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing[1],
  },

  // Item wrapper so the expanded player can sit beneath the row.
  callItemWrap: {
    backgroundColor: colors.white,
  },

  // Expanded player styles
  expandedPlayer: {
    backgroundColor: colors.gray[50],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray[200],
  },
  expandedTimeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: spacing[2],
  },
  expandedTime: {
    fontSize: 12,
    color: colors.gray[500],
    fontVariant: ['tabular-nums'],
  },
  expandedTrackHit: {
    paddingVertical: 10,
    marginVertical: -8, // bigger touch target without changing layout
  },
  expandedTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.gray[200],
    overflow: 'visible',
  },
  expandedTrackFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: colors.primary[600],
  },
  expandedThumb: {
    position: 'absolute',
    top: -6,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.white,
    borderWidth: 2,
    borderColor: colors.primary[600],
    marginLeft: -8,
    shadowColor: colors.black,
    shadowOpacity: 0.15,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
  expandedControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginTop: spacing[3],
  },
  expandedSkip: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray[200],
    alignItems: 'center',
    justifyContent: 'center',
  },
  expandedSkipLabel: {
    position: 'absolute',
    bottom: 4,
    fontSize: 8,
    fontWeight: '700',
    color: colors.gray[600],
  },
  expandedPlayBig: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary[600],
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary[700],
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
});

export default CallRow;
