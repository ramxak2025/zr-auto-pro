/**
 * ClientCallsSection — calls history for a single client inside the
 * client card (#15.2). Lists incoming / outgoing / missed calls and lets
 * the owner play the recording inline.
 *
 *  • Data: callsApi.getByClient(clientId) → { calls, total }. Each call
 *    carries `recordingUrl`; the signed URL is fetched lazily via
 *    callsApi.getRecordingUrl(url) the first time the user taps play.
 *  • Playback: expo-audio (`useAudioPlayer` + `useAudioPlayerStatus`),
 *    mirroring the standalone CallsScreen player. Exactly one recording
 *    plays at a time (single `playingId`).
 *  • Audio session is configured once on mount so playback works even
 *    with the iPhone ringer switch on silent.
 *
 * Android-safe: expo-audio is cross-platform; no iOS-only API is used.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';
import { Text } from '../platform/Typography';
import { callsApi } from '../api/services';
import { useColors } from '../contexts/ThemeContext';
import { useTenantTimezone } from '../contexts/TenantTimezoneContext';
import { colors, spacing, borderRadius, getBadgeColors } from '../theme';

interface Call {
  id: string;
  date: string;
  direction: 'incoming' | 'outgoing';
  from: string;
  to: string;
  duration: number;
  status: 'answered' | 'missed';
  recordingUrl: string | null;
  calledBack?: boolean;
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '0:00';
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Дата+время звонка в поясе АВТОСЕРВИСА (tenants.timezone, 157): лента звонков
 * на сервере режется по его суткам, и карточка клиента обязана показывать тот
 * же день. Intl с чужим поясом на урезанной сборке Hermes может бросить —
 * тогда падаем на время устройства (прежнее поведение).
 */
function formatCallDate(d: string, tz: string): string {
  const dt = new Date(d);
  try {
    const time = dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: tz });
    const day = dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', timeZone: tz });
    return `${day} · ${time}`;
  } catch {
    const time = dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    const day = dt.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
    return `${day} · ${time}`;
  }
}

export default function ClientCallsSection({
  clientId,
  cardStyle,
  sectionTitleStyle,
}: {
  clientId: string;
  cardStyle?: object;
  sectionTitleStyle?: object;
}) {
  const palette = useColors();
  const [playingId, setPlayingId] = useState<string | null>(null);
  // PERF: defer the calls fetch until the section has actually laid out.
  // This section sits at the bottom of the ClientDetail ScrollView and is
  // always mounted with the screen; gating the query on first layout keeps
  // the external MoiZvonki round-trip off the screen's critical mount path
  // (the rest of the card paints first, then this loads).
  const [visible, setVisible] = useState(false);

  // NOTE: the audio session is configured LAZILY — only the first time the
  // user taps play (see RecordingPlayer). Previously this ran on every mount,
  // touching the native audio session on every ClientDetail open even when no
  // recording was ever played.

  const { data, isLoading, isError } = useQuery<{ calls: Call[]; total: number }>({
    queryKey: ['client-calls', clientId],
    queryFn: async () => {
      const res = await callsApi.getByClient(clientId);
      return res.data as { calls: Call[]; total: number };
    },
    enabled: visible,
    staleTime: 60_000,
    // Calls come from an external provider (MoiZvonki); a slow/absent
    // integration must not block the rest of the card.
    retry: 1,
  });

  const calls = data?.calls ?? [];
  // Until the section has laid out (query disabled), show the spinner so the
  // card never flashes an empty/"no calls" state before the fetch begins.
  const showSpinner = !visible || isLoading;

  return (
    <View onLayout={() => setVisible(true)}>
      <View style={[styles.sectionHeader, sectionTitleStyle]}>
        <Text variant="title3" color={palette.text.primary} style={styles.sectionTitle}>
          Звонки {calls.length > 0 ? `(${calls.length})` : ''}
        </Text>
      </View>

      <View style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }, cardStyle]}>
        {showSpinner ? (
          <View style={styles.center}>
            <ActivityIndicator size="small" color={palette.accent.primary} />
          </View>
        ) : isError ? (
          <View style={styles.center}>
            <Ionicons name="cloud-offline-outline" size={20} color={palette.text.tertiary} />
            <Text variant="footnote" color={palette.text.tertiary} style={{ marginTop: 4 }}>
              Звонки недоступны
            </Text>
          </View>
        ) : calls.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="call-outline" size={20} color={palette.text.tertiary} />
            <Text variant="footnote" color={palette.text.tertiary} style={{ marginTop: 4 }}>
              Нет звонков с этим клиентом
            </Text>
          </View>
        ) : (
          calls
            .slice(0, 15)
            .map((call, i) => (
              <CallRow
                key={call.id || `${call.date}-${i}`}
                call={call}
                palette={palette}
                isLast={i === Math.min(calls.length, 15) - 1}
                playing={playingId === (call.id || `${call.date}-${i}`)}
                onTogglePlay={() =>
                  setPlayingId((prev) =>
                    prev === (call.id || `${call.date}-${i}`) ? null : call.id || `${call.date}-${i}`,
                  )
                }
              />
            ))
        )}
      </View>
    </View>
  );
}

function CallRow({
  call,
  palette,
  isLast,
  playing,
  onTogglePlay,
}: {
  call: Call;
  palette: ReturnType<typeof useColors>;
  isLast: boolean;
  playing: boolean;
  onTogglePlay: () => void;
}) {
  // Пояс автосервиса — только для подписи времени; строка, ререндеров не добавляет.
  const tenantTz = useTenantTimezone();
  const isMissed = call.direction === 'incoming' && (call.status === 'missed' || call.duration === 0);
  const isIncoming = call.direction === 'incoming';

  const iconName = isMissed ? 'close-circle-outline' : isIncoming ? 'arrow-down-outline' : 'arrow-up-outline';
  // Direction tints behave like status badges: keep the exact light values,
  // but in dark mode flip to the translucent badge fills so the pale [50]
  // tints don't glare on the dark card.
  const callKey = isMissed ? 'red' : isIncoming ? 'green' : 'blue';
  const badge = getBadgeColors(palette.mode)[callKey];
  const iconColor =
    palette.mode === 'dark'
      ? badge.text
      : isMissed
        ? colors.red[500]
        : isIncoming
          ? colors.green[600]
          : colors.blue[600];
  const iconBg =
    palette.mode === 'dark' ? badge.bg : isMissed ? colors.red[50] : isIncoming ? colors.green[50] : colors.blue[50];

  return (
    <View>
      <View
        style={[
          styles.row,
          !isLast && { borderBottomColor: palette.border.subtle, borderBottomWidth: StyleSheet.hairlineWidth },
        ]}
      >
        <View style={[styles.callIcon, { backgroundColor: iconBg }]}>
          <Ionicons name={iconName as any} size={16} color={iconColor} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            variant="body"
            color={isMissed ? (palette.mode === 'dark' ? colors.red[300] : colors.red[600]) : palette.text.primary}
            style={styles.callTitle}
          >
            {isIncoming ? 'Входящий' : 'Исходящий'}
            {isMissed ? ' · пропущен' : ''}
          </Text>
          <Text variant="caption" color={palette.text.tertiary}>
            {formatCallDate(call.date, tenantTz)}
            {call.duration > 0 ? ` · ${formatDuration(call.duration)}` : ''}
          </Text>
        </View>
        {call.recordingUrl ? (
          <TouchableOpacity
            style={[styles.playBtn, { backgroundColor: playing ? colors.primary[600] : palette.bg.muted }]}
            onPress={onTogglePlay}
            hitSlop={8}
          >
            <Ionicons
              name={playing ? 'chevron-up' : 'play'}
              size={15}
              color={playing ? colors.white : palette.accent.primary}
            />
          </TouchableOpacity>
        ) : null}
      </View>
      {playing && call.recordingUrl ? (
        <RecordingPlayer recordingUrl={call.recordingUrl} palette={palette} onClose={onTogglePlay} />
      ) : null}
    </View>
  );
}

/**
 * Inline recording player — lazy-fetches the signed URL, auto-plays, offers
 * a tappable seek bar + ±15s skip. Pinned-via-ref player so expo-audio's
 * per-tick player ref churn doesn't restart playback (same hardening as the
 * CallsScreen player).
 */
function RecordingPlayer({
  recordingUrl,
  palette,
  onClose,
}: {
  recordingUrl: string;
  palette: ReturnType<typeof useColors>;
  onClose: () => void;
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

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        // Configure the audio session lazily — only now that the user is
        // actually about to play a recording — so recordings sound even with
        // the ringer switch on silent. This used to run on every section
        // mount; deferring it here keeps ClientDetail opens cheap.
        await setAudioModeAsync({
          playsInSilentMode: true,
          shouldPlayInBackground: false,
          interruptionMode: 'mixWithOthers',
          allowsRecording: false,
        }).catch(() => {});
        const res: any = await callsApi.getRecordingUrl(recordingUrl);
        const url: string | undefined = res?.data?.url;
        if (!cancelled && url) setSrc(url);
      } catch {
        // swallow; spinner stays, user can re-open
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [recordingUrl]);

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
    <View style={[styles.player, { backgroundColor: palette.bg.muted }]}>
      <View style={styles.playerTimeRow}>
        <Text variant="caption" color={palette.text.secondary}>
          {formatDuration(positionSec)}
        </Text>
        <Text variant="caption" color={palette.text.secondary}>
          {formatDuration(Math.max(0, durationSec - positionSec))}
        </Text>
      </View>
      <Pressable
        onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
        onPress={(e) => {
          if (trackWidth <= 0) return;
          seekToRatio(e.nativeEvent.locationX / trackWidth);
        }}
        style={styles.trackHit}
      >
        <View style={[styles.track, { backgroundColor: palette.border.subtle }]}>
          <View style={[styles.trackFill, { width: `${progress * 100}%` }]} />
        </View>
      </Pressable>
      <View style={styles.playerControls}>
        <TouchableOpacity
          onPress={() => seekDelta(-15)}
          style={[styles.skipBtn, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
        >
          <Ionicons name="play-back" size={16} color={palette.text.secondary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={togglePlay} style={styles.playBig}>
          {loading ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Ionicons name={playing ? 'pause' : 'play'} size={22} color={colors.white} />
          )}
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => seekDelta(15)}
          style={[styles.skipBtn, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
        >
          <Ionicons name="play-forward" size={16} color={palette.text.secondary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={onClose} hitSlop={8}>
          <Ionicons name="close" size={20} color={palette.text.tertiary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing[2] },
  sectionTitle: { fontWeight: '700' },
  card: {
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    overflow: 'hidden',
    marginTop: spacing[2],
  },
  center: { alignItems: 'center', paddingVertical: spacing[5], gap: 2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
  },
  callIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  callTitle: { fontWeight: '600' },
  playBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Inline player
  player: {
    paddingHorizontal: spacing[3.5],
    paddingTop: spacing[2],
    paddingBottom: spacing[3],
    gap: spacing[2],
  },
  playerTimeRow: { flexDirection: 'row', justifyContent: 'space-between' },
  trackHit: { paddingVertical: 6 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  trackFill: { height: 4, borderRadius: 2, backgroundColor: colors.primary[600] },
  playerControls: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  skipBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBig: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary[600],
    alignItems: 'center',
    justifyContent: 'center',
  },
});
