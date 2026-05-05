import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Linking,
  Animated as RNAnimated,
  Pressable,
} from 'react-native';
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync, AudioModule } from 'expo-audio';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, fontSize, fontWeight, borderRadius } from '../theme';
import { callsApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useTabBarHeight } from '../hooks/useTabBarHeight';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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
  client: {
    id: string;
    fullName: string;
    cars: { plateNumber: string; makeModel: string }[];
  } | null;
}

interface CallsSummary {
  incoming: number;
  outgoing: number;
  missed: number;
  notCalledBack: number;
  total: number;
}

type FilterTab = 'all' | 'incoming' | 'outgoing' | 'missed';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
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

function formatMoney(v: number): string {
  return new Intl.NumberFormat('ru-RU').format(Math.round(v)) + ' \u20BD';
}

// ---------------------------------------------------------------------------
// Call Row
// ---------------------------------------------------------------------------

// One global "currently playing" id so only one recording sounds at once.
// Lives at the screen root and is passed down via props (no Context to keep
// this file self-contained).
function CallRow({
  call,
  navigation,
  playingId,
  setPlayingId,
}: {
  call: Call;
  navigation: any;
  playingId: string | null;
  setPlayingId: (id: string | null) => void;
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
    <View style={styles.callItemWrap}>
      <View style={styles.callRow}>
        <View style={[styles.callIcon, { backgroundColor: iconBg }]}>
          <Ionicons name={iconName as any} size={18} color={iconColor} />
        </View>

        <View style={styles.callInfo}>
          <Text style={[styles.callPhone, isMissed && !call.calledBack && { color: colors.red[600] }]}>
            {formatPhone(displayPhone)}
          </Text>
          {call.client ? (
            <TouchableOpacity onPress={() => navigation.navigate('ClientDetail', { id: call.client!.id })}>
              <Text style={styles.callClient} numberOfLines={1}>
                {call.client.fullName}
                {call.client.cars?.[0] && ` \u2022 ${call.client.cars[0].makeModel || call.client.cars[0].plateNumber}`}
              </Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.callUnknown}>Неизвестный номер</Text>
          )}
        </View>

        <View style={styles.callRight}>
          <Text style={styles.callTime}>{callTime}</Text>
          {call.duration > 0 && <Text style={styles.callDuration}>{formatDuration(call.duration)}</Text>}
          {isMissed && call.calledBack && (
            <Text style={[styles.callStatus, { color: colors.green[600] }]}>Перезвонили</Text>
          )}
          {isMissed && !call.calledBack && (
            <Text style={[styles.callStatus, { color: colors.red[500] }]}>Пропущен</Text>
          )}
        </View>

        {call.recordingUrl && (
          <TouchableOpacity
            style={[styles.playBtn, isThisPlaying && { backgroundColor: colors.primary[600] }]}
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
      {isThisPlaying && call.recordingUrl && (
        <ExpandedRecordingPlayer recordingUrl={call.recordingUrl} onClose={() => setPlayingId(null)} />
      )}
    </View>
  );
}

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
 *  • Audio mode is configured at the screen root so playback also works
 *    when the iPhone ringer switch is set to silent.
 */
function ExpandedRecordingPlayer({ recordingUrl, onClose }: { recordingUrl: string; onClose: () => void }) {
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

  useEffect(() => {
    if (src) {
      try {
        player.play();
      } catch {
        /* ignore */
      }
    }
  }, [src, player]);

  // Stop sound when this player unmounts (row collapsed or another row picked)
  useEffect(
    () => () => {
      try {
        player.pause();
      } catch {
        /* ignore */
      }
    },
    [player],
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
    <View style={styles.expandedPlayer}>
      {/* Time labels */}
      <View style={styles.expandedTimeRow}>
        <Text style={styles.expandedTime}>{formatDuration(positionSec)}</Text>
        <Text style={styles.expandedTime}>{formatDuration(Math.max(0, durationSec - positionSec))}</Text>
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
        <View style={styles.expandedTrack}>
          <View style={[styles.expandedTrackFill, { width: `${progress * 100}%` }]} />
          <View style={[styles.expandedThumb, { left: `${progress * 100}%` }]} />
        </View>
      </Pressable>

      {/* Transport controls */}
      <View style={styles.expandedControls}>
        <TouchableOpacity onPress={() => seekDelta(-15)} style={styles.expandedSkip}>
          <Ionicons name="play-back" size={20} color={colors.gray[700]} />
          <Text style={styles.expandedSkipLabel}>15</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={togglePlay} style={styles.expandedPlayBig}>
          {loading ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Ionicons name={playing ? 'pause' : 'play'} size={26} color={colors.white} />
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={() => seekDelta(15)} style={styles.expandedSkip}>
          <Ionicons name="play-forward" size={20} color={colors.gray[700]} />
          <Text style={styles.expandedSkipLabel}>15</Text>
        </TouchableOpacity>

        <View style={{ flex: 1 }} />
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Ionicons name="close" size={22} color={colors.gray[400]} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Filter tabs
// ---------------------------------------------------------------------------

const TABS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'incoming', label: 'Вх.' },
  { key: 'outgoing', label: 'Исх.' },
  { key: 'missed', label: 'Пропущ.' },
];

// ---------------------------------------------------------------------------
// Main Screen
// ---------------------------------------------------------------------------

export default function CallsScreen({ navigation }: { navigation: any }) {
  const { isRole } = useAuth();
  const tabBarHeight = useTabBarHeight();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [activeTab, setActiveTab] = useState<FilterTab>('all');
  // Single global "currently expanded player" — exactly one recording can
  // play at a time, tapping a different row swaps which one is open.
  const [playingId, setPlayingId] = useState<string | null>(null);

  // Configure audio session once when the screen mounts. Without this
  // call iOS silences playback if the ringer switch is set to silent —
  // which is the case for most autosalon owners during work hours.
  useEffect(() => {
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: 'mixWithOthers',
      allowsRecording: false,
    }).catch(() => {});
    return () => {
      // Stop any audio when leaving the screen
      setPlayingId(null);
    };
  }, []);

  const dateStr = useMemo(() => {
    const y = selectedDate.getFullYear();
    const m = String(selectedDate.getMonth() + 1).padStart(2, '0');
    const d = String(selectedDate.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }, [selectedDate]);

  const dateLabel = useMemo(() => {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
    if (dateStr === todayStr) return 'Сегодня';
    if (dateStr === yesterdayStr) return 'Вчера';
    return selectedDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }, [dateStr, selectedDate]);

  const { data, isLoading } = useQuery({
    queryKey: ['calls', dateStr],
    queryFn: async () => {
      const res = await callsApi.getCalls({ date: dateStr });
      return res.data;
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const calls: Call[] = data?.calls ?? [];
  const summary: CallsSummary | undefined = data?.summary;

  const filteredCalls = useMemo(() => {
    switch (activeTab) {
      case 'incoming':
        return calls.filter((c) => c.direction === 'incoming' && c.status === 'answered');
      case 'outgoing':
        return calls.filter((c) => c.direction === 'outgoing');
      case 'missed':
        return calls.filter((c) => c.direction === 'incoming' && (c.status === 'missed' || c.duration === 0));
      default:
        return calls;
    }
  }, [calls, activeTab]);

  const goToPrevDay = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() - 1);
    setSelectedDate(d);
  };
  const goToNextDay = () => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + 1);
    if (d <= new Date()) setSelectedDate(d);
  };
  const isToday =
    dateStr ===
    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;

  const summaryItems = [
    { label: 'Вх.', value: summary?.incoming ?? 0, color: colors.green[600], bg: colors.green[50] },
    { label: 'Исх.', value: summary?.outgoing ?? 0, color: colors.blue[600], bg: colors.blue[50] },
    { label: 'Пропущ.', value: summary?.missed ?? 0, color: colors.red[500], bg: colors.red[50] },
    { label: 'Без отв.', value: summary?.notCalledBack ?? 0, color: colors.orange[500], bg: colors.orange[50] },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header — native iOS-style with back button + title + date stepper */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={22} color={colors.primary[600]} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.title}>Звонки</Text>
          <Text style={styles.subtitle}>{dateLabel}</Text>
        </View>
        <View style={styles.dateNav}>
          <TouchableOpacity
            onPress={goToPrevDay}
            style={styles.dateBtn}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons name="chevron-back" size={18} color={colors.gray[500]} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={goToNextDay}
            disabled={isToday}
            style={[styles.dateBtn, isToday && { opacity: 0.25 }]}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons name="chevron-forward" size={18} color={colors.gray[500]} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Summary strip */}
      <View style={styles.summaryRow}>
        {summaryItems.map((s) => (
          <View key={s.label} style={[styles.summaryCard, { backgroundColor: s.bg }]}>
            <Text style={[styles.summaryValue, { color: s.color }]}>{isLoading ? '-' : s.value}</Text>
            <Text style={styles.summaryLabel}>{s.label}</Text>
          </View>
        ))}
      </View>

      {/* Warning */}
      {summary && summary.notCalledBack > 0 && (
        <View style={styles.warning}>
          <Ionicons name="alert-circle" size={16} color={colors.orange[500]} />
          <Text style={styles.warningText}>{summary.notCalledBack} без перезвона</Text>
        </View>
      )}

      {/* Filter tabs */}
      <View style={styles.tabs}>
        {TABS.map((tab) => {
          const count =
            tab.key === 'all'
              ? summary?.total
              : tab.key === 'incoming'
                ? summary?.incoming
                : tab.key === 'outgoing'
                  ? summary?.outgoing
                  : summary?.missed;
          const active = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>
                {tab.label} {count !== undefined ? count : ''}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Call list */}
      <ScrollView
        style={styles.list}
        contentContainerStyle={{ paddingBottom: tabBarHeight + spacing[4] }}
        showsVerticalScrollIndicator={false}
      >
        {isLoading ? (
          <ActivityIndicator size="small" color={colors.primary[500]} style={{ marginTop: spacing[10] }} />
        ) : filteredCalls.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="call-outline" size={32} color={colors.gray[200]} />
            <Text style={styles.emptyText}>{activeTab === 'missed' ? 'Пропущенных нет' : 'Нет звонков'}</Text>
          </View>
        ) : (
          filteredCalls.map((call, idx) => (
            <CallRow
              key={`${call.id}-${idx}`}
              call={call}
              navigation={navigation}
              playingId={playingId}
              setPlayingId={setPlayingId}
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.gray[50] },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingTop: spacing[2],
    paddingBottom: spacing[3],
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { flex: 1, alignItems: 'flex-start', justifyContent: 'center' },
  title: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.gray[900], letterSpacing: -0.3 },
  subtitle: { fontSize: fontSize.xs, color: colors.gray[400], marginTop: 1 },
  dateNav: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dateBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.gray[700],
    minWidth: 70,
    textAlign: 'center',
  },

  summaryRow: { flexDirection: 'row', gap: spacing[2], paddingHorizontal: spacing[4], marginBottom: spacing[3] },
  summaryCard: { flex: 1, borderRadius: borderRadius.xl, paddingVertical: spacing[2.5], alignItems: 'center' },
  summaryValue: { fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  summaryLabel: { fontSize: 10, color: colors.gray[500], marginTop: 2 },

  warning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginHorizontal: spacing[4],
    marginBottom: spacing[3],
    backgroundColor: colors.orange[50],
    borderWidth: 1,
    borderColor: colors.amber[200],
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[2.5],
  },
  warningText: { fontSize: fontSize.xs, color: colors.orange[600], fontWeight: fontWeight.medium },

  tabs: { flexDirection: 'row', marginHorizontal: spacing[4], marginBottom: spacing[3], gap: spacing[2] },
  tab: {
    flex: 1,
    paddingVertical: spacing[2],
    alignItems: 'center',
    borderRadius: borderRadius.lg,
    backgroundColor: colors.gray[50],
  },
  tabActive: { backgroundColor: colors.primary[50], borderWidth: 1, borderColor: colors.primary[200] },
  tabText: { fontSize: 11, fontWeight: fontWeight.semibold, color: colors.gray[400] },
  tabTextActive: { color: colors.primary[600] },

  list: {
    flex: 1,
    backgroundColor: colors.white,
    marginHorizontal: spacing[4],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.gray[100],
  },

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

  empty: { alignItems: 'center', paddingVertical: spacing[12] },
  emptyText: { fontSize: fontSize.sm, color: colors.gray[400], marginTop: spacing[2] },
});
