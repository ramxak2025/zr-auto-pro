/**
 * NotificationSettingsScreen — per-user «Уведомления».
 *
 * THREE independent layers, deliberately kept separate (Round 14):
 *
 *  1. Категории — opt-out mute list (notification_mutes, 066). The server
 *     stores `muted` = the categories turned OFF; empty ⇒ everything ON. A
 *     row's Switch is ON when the category is NOT in `muted`.
 *  2. Глобальные настройки — notification_settings (151): мастер-тумблер «Все
 *     уведомления», тихие часы, звук. Sent WHOLE (replace-semantics).
 *  3. Диагностика — the answer to «почему не приходят». Permission state,
 *     whether the device is registered server-side, which APNs environment the
 *     build talks to, and a test push that reports Expo's RAW verdict
 *     (tickets + delivery receipts), not a meaningless "ok".
 *
 * Both preference writes are optimistic: rewrite the React-Query cache, fire
 * the request, roll back + toast on error. No save button — each toggle is its
 * own atomic write, the familiar iOS Settings behaviour.
 *
 * Broadcasts (важные объявления от поддержки) are intentionally NOT a row here
 * and ignore every switch above — they must always deliver.
 */
import React from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  Switch,
  ActivityIndicator,
  Platform,
  TouchableOpacity,
  AppState,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import * as Updates from 'expo-updates';
import Constants from 'expo-constants';
import IosScreenHeader from '../components/IosScreenHeader';
import DateTimePickerModal from '../components/DateTimePickerModal';
import { showMutationErrorToast } from '../components/Toast';
import { Text } from '../platform/Typography';
import { useColors } from '../contexts/ThemeContext';
import { registerPushToken, isAndroidPushConfigured } from '../contexts/AuthContext';
import { colors, fontSize, fontWeight, borderRadius, spacing, softTint } from '../theme';
import { iosSectionLabel, useShadow } from '../platform/iosSurface';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { haptic } from '../platform/haptics';
import { notificationsApi, pushApi } from '../api/services';
import type {
  NotificationCategory,
  NotificationPreferences,
  NotificationSettings,
  PushDiagnostics,
  PushTokenInfo,
} from '../../../shared/types';

const QK_PREFS = ['notification-preferences'] as const;
const QK_SETTINGS = ['notification-settings'] as const;
const QK_TOKENS = ['push-tokens'] as const;

/** Defaults offered the first time quiet hours are switched on. */
const DEFAULT_QUIET_FROM = '22:00';
const DEFAULT_QUIET_TO = '07:00';

interface CategoryRow {
  key: NotificationCategory;
  label: string;
  sublabel: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBg: string;
}

interface CategorySection {
  title: string;
  rows: CategoryRow[];
}

/**
 * Grouped by WHAT THE USER IS DOING when the notification matters, not by which
 * backend service emits it. Every category the server can gate appears here —
 * an ungated push with no switch is exactly the bug this round fixed.
 */
const SECTIONS: CategorySection[] = [
  {
    title: 'РАБОТА',
    rows: [
      {
        key: 'check_assigned',
        label: 'Новые заказ-наряды',
        sublabel: 'Когда на вас назначен заказ-наряд',
        icon: 'document-text-outline',
        iconColor: colors.blue[600],
        iconBg: colors.blue[50],
      },
      {
        key: 'order_ready',
        label: 'Машина готова',
        sublabel: 'Работы завершены, можно звать клиента',
        icon: 'car-sport-outline',
        iconColor: colors.teal[600],
        iconBg: colors.teal[50],
      },
      {
        key: 'order_paid',
        label: 'Оплачено — можно выдавать',
        sublabel: 'Клиент оплатил заказ-наряд',
        icon: 'card-outline',
        // emerald has no 600 shade in the theme catalogue — 700 is the closest.
        iconColor: colors.emerald[700],
        iconBg: colors.emerald[50],
      },
      {
        key: 'check_closed',
        label: 'Закрытые чеки',
        sublabel: 'Когда чек закрыт и оплачен',
        icon: 'checkmark-done-outline',
        iconColor: colors.cyan[600],
        iconBg: colors.cyan[50],
      },
      // Приход/уход сотрудников — владельцу и админам при само-открытии/закрытии
      // смены мастером (категория shift_attendance, см. ShiftsService).
      {
        key: 'shift_attendance',
        label: 'Приход и уход сотрудников',
        sublabel: 'Открытие и закрытие смены, опоздания',
        icon: 'walk-outline',
        iconColor: colors.indigo[600],
        iconBg: colors.indigo[50],
      },
    ],
  },
  {
    title: 'ДЕНЬГИ',
    rows: [
      {
        key: 'salary',
        label: 'Начисления зарплаты',
        sublabel: 'Зарплата, аванс, премия',
        icon: 'wallet-outline',
        iconColor: colors.green[600],
        iconBg: colors.green[50],
      },
      {
        key: 'penalty',
        label: 'Штрафы',
        sublabel: 'Когда вам начислен штраф',
        icon: 'alert-circle-outline',
        iconColor: colors.rose[600],
        iconBg: colors.rose[50],
      },
      // 155 — кассовая смена: владельцу приходит итог закрытой смены (суммы,
      // сейф, размен), кассиру — «инкассация N с кассы/сейфа, остаток M».
      {
        key: 'cash_shift_closed',
        label: 'Закрытие кассы',
        sublabel: 'Итоги смены: суммы, сейф, размен',
        icon: 'lock-closed-outline',
        iconColor: colors.purple[600],
        iconBg: colors.purple[50],
      },
      {
        key: 'cash_collection',
        label: 'Инкассация',
        sublabel: 'Изъятие наличных из кассы или сейфа',
        icon: 'briefcase-outline',
        iconColor: colors.orange[600],
        iconBg: colors.orange[50],
      },
    ],
  },
  {
    title: 'КЛИЕНТЫ',
    rows: [
      {
        key: 'booking_reminder',
        label: 'Напоминания о записях',
        sublabel: 'Клиент записан — напомнить о визите',
        icon: 'calendar-outline',
        iconColor: colors.amber[600],
        iconBg: colors.amber[50],
      },
      {
        key: 'call_incoming',
        label: 'Входящие звонки',
        sublabel: 'Кто звонит и по какой машине',
        icon: 'call-outline',
        iconColor: colors.indigo[600],
        iconBg: colors.indigo[50],
      },
    ],
  },
  {
    title: 'ПРОЧЕЕ',
    rows: [
      {
        key: 'knowledge',
        label: 'Обязательные регламенты',
        sublabel: 'Новые регламенты для ознакомления',
        icon: 'book-outline',
        iconColor: colors.violet[600],
        iconBg: colors.violet[50],
      },
      {
        key: 'profile_request',
        label: 'Запросы на изменение профиля',
        sublabel: 'Сотрудник просит изменить свои данные',
        icon: 'person-circle-outline',
        iconColor: colors.slate[600],
        iconBg: colors.slate[100],
      },
      {
        key: 'account',
        label: 'Аккаунт и подписка',
        sublabel: 'Важные события по вашему аккаунту',
        icon: 'shield-checkmark-outline',
        iconColor: colors.orange[600],
        iconBg: colors.orange[50],
      },
    ],
  },
];

// ─── Small presentational pieces ─────────────────────────────────────────────

interface ToggleRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  iconColor: string;
  iconBg: string;
  label: string;
  sublabel?: string;
  value: boolean;
  disabled?: boolean;
  onToggle: (next: boolean) => void;
  showDivider: boolean;
  palette: ReturnType<typeof useColors>;
}

const ToggleRow = React.memo(function ToggleRow({
  icon,
  iconColor,
  iconBg,
  label,
  sublabel,
  value,
  disabled,
  onToggle,
  showDivider,
  palette,
}: ToggleRowProps) {
  return (
    <>
      <View style={[styles.row, disabled && styles.rowDisabled]}>
        <View style={[styles.rowIcon, { backgroundColor: iconBg }]}>
          <Ionicons name={icon} size={20} color={iconColor} />
        </View>
        <View style={styles.rowTextWrap}>
          <Text style={[styles.rowLabel, { color: palette.text.primary }]} numberOfLines={1}>
            {label}
          </Text>
          {sublabel ? (
            <Text style={[styles.rowDesc, { color: palette.text.secondary }]} numberOfLines={2}>
              {sublabel}
            </Text>
          ) : null}
        </View>
        <Switch
          value={value}
          disabled={disabled}
          onValueChange={onToggle}
          trackColor={{ false: palette.border.subtle, true: palette.accent.primary }}
          // iOS uses the system green track; Android tints the thumb.
          thumbColor={Platform.OS === 'android' ? colors.white : undefined}
          ios_backgroundColor={palette.border.subtle}
        />
      </View>
      {showDivider && <View style={[styles.separator, { backgroundColor: palette.border.subtle }]} />}
    </>
  );
});

interface StatusRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  tone: 'ok' | 'warn' | 'bad' | 'neutral';
  showDivider: boolean;
  palette: ReturnType<typeof useColors>;
}

function StatusRow({ icon, label, value, tone, showDivider, palette }: StatusRowProps) {
  const toneColor =
    tone === 'ok'
      ? colors.green[600]
      : tone === 'bad'
        ? colors.rose[600]
        : tone === 'warn'
          ? colors.amber[600]
          : palette.text.secondary;
  return (
    <>
      <View style={styles.statusRow}>
        <Ionicons name={icon} size={18} color={palette.text.tertiary} style={styles.statusIcon} />
        <Text style={[styles.statusLabel, { color: palette.text.primary }]} numberOfLines={1}>
          {label}
        </Text>
        <Text style={[styles.statusValue, { color: toneColor }]} numberOfLines={1}>
          {value}
        </Text>
      </View>
      {showDivider && (
        <View style={[styles.separator, styles.separatorFull, { backgroundColor: palette.border.subtle }]} />
      )}
    </>
  );
}

interface ActionRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  busy?: boolean;
  showDivider: boolean;
  palette: ReturnType<typeof useColors>;
}

function ActionRow({ icon, label, onPress, busy, showDivider, palette }: ActionRowProps) {
  return (
    <>
      <TouchableOpacity style={styles.statusRow} onPress={onPress} disabled={busy} activeOpacity={0.6}>
        <Ionicons name={icon} size={18} color={palette.accent.primary} style={styles.statusIcon} />
        <Text style={[styles.statusLabel, { color: palette.accent.primary, fontWeight: fontWeight.semibold }]}>
          {label}
        </Text>
        {busy ? <ActivityIndicator size="small" color={palette.accent.primary} /> : null}
      </TouchableOpacity>
      {showDivider && (
        <View style={[styles.separator, styles.separatorFull, { backgroundColor: palette.border.subtle }]} />
      )}
    </>
  );
}

// ─── Time helpers ────────────────────────────────────────────────────────────

/**
 * Three states, not two. `delivered` requires a positive receipt, so "not
 * delivered" must not be painted red while the verdict is merely outstanding —
 * that would cry wolf on every healthy test whose receipt is a second late.
 */
function resultAccent(result: PushDiagnostics): string {
  if (result.delivered) return colors.green[600];
  if (result.pending) return colors.amber[600];
  return colors.rose[600];
}

/** 'HH:MM' → a Date today at that time (the picker works in Dates). */
function hhmmToDate(hhmm: string | null, fallback: string): Date {
  const [h, m] = (hhmm ?? fallback).split(':').map((n) => parseInt(n, 10));
  const d = new Date();
  d.setHours(Number.isFinite(h) ? h : 0, Number.isFinite(m) ? m : 0, 0, 0);
  return d;
}

function dateToHhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * The device's offset from UTC in MINUTES EAST (Moscow = +180).
 * getTimezoneOffset() reports the inverse (minutes WEST), hence the negation —
 * getting this backwards would shift quiet hours by twice the offset.
 */
function currentTzOffsetMinutes(): number {
  return -new Date().getTimezoneOffset();
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function NotificationSettingsScreen() {
  const navigation = useNavigation<{ goBack: () => void }>();
  const palette = useColors();
  const shadow = useShadow();
  const queryClient = useQueryClient();
  const tabBarHeight = useTabBarHeight();

  const [permissionGranted, setPermissionGranted] = React.useState<boolean | null>(null);
  const [testResult, setTestResult] = React.useState<PushDiagnostics | null>(null);
  const [picker, setPicker] = React.useState<null | 'from' | 'to'>(null);

  // ── Queries ────────────────────────────────────────────────────────────────

  const {
    data: prefs,
    isLoading: prefsLoading,
    isError: prefsError,
  } = useQuery<NotificationPreferences>({
    queryKey: QK_PREFS,
    queryFn: async () => (await notificationsApi.getPreferences()).data,
    staleTime: 5 * 60 * 1000,
  });

  const {
    data: settings,
    isLoading: settingsLoading,
    isError: settingsError,
  } = useQuery<NotificationSettings>({
    queryKey: QK_SETTINGS,
    queryFn: async () => (await notificationsApi.getSettings()).data,
    staleTime: 5 * 60 * 1000,
  });

  const { data: tokens, isError: tokensError } = useQuery<PushTokenInfo[]>({
    queryKey: QK_TOKENS,
    queryFn: async () => (await pushApi.tokens()).data,
    staleTime: 30 * 1000,
  });

  /**
   * A failed load must NOT fall through to a rendered form (the web page makes
   * the same guarantee). Both writes are REPLACE-semantics: rendering defaults
   * after a failed GET means the next innocent toggle PUTs those defaults and
   * SILENTLY DESTROYS the user's real state — quiet hours wiped, a deliberately
   * disabled master switch turned back on, the entire mute list cleared.
   * So: no data ⇒ no switches, only a retry.
   */
  const loadFailed = (prefsError && !prefs) || (settingsError && !settings);

  const muted = prefs?.muted ?? [];
  const effective: NotificationSettings = settings ?? {
    masterEnabled: true,
    sound: true,
    quietFrom: null,
    quietTo: null,
    tzOffsetMinutes: null,
  };
  const quietEnabled = !!effective.quietFrom && !!effective.quietTo;

  // ── Permission state (also refreshed when returning from iOS Settings) ─────

  const refreshPermission = React.useCallback(async () => {
    try {
      const { granted } = await Notifications.getPermissionsAsync();
      setPermissionGranted(granted);
    } catch {
      setPermissionGranted(null);
    }
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      void refreshPermission();
    }, [refreshPermission]),
  );

  React.useEffect(() => {
    // Coming back from the iOS Settings app does NOT re-focus the screen (it was
    // never blurred) — only the AppState flips. Without this the diagnostics
    // would keep claiming "разрешение не выдано" right after the user gave it.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshPermission();
    });
    return () => sub.remove();
  }, [refreshPermission]);

  // ── Mutations ──────────────────────────────────────────────────────────────

  const prefsMutation = useMutation<
    NotificationPreferences,
    unknown,
    NotificationCategory[],
    { previous: NotificationPreferences | undefined }
  >({
    mutationFn: async (newMuted) => (await notificationsApi.updatePreferences(newMuted)).data,
    onMutate: async (newMuted) => {
      await queryClient.cancelQueries({ queryKey: QK_PREFS });
      const previous = queryClient.getQueryData<NotificationPreferences>(QK_PREFS);
      queryClient.setQueryData<NotificationPreferences>(QK_PREFS, { muted: newMuted });
      return { previous };
    },
    onError: (err, _newMuted, context) => {
      // Roll back to the pre-toggle snapshot + видимый фидбек (волна C):
      // тумблер молча прыгал обратно — пользователь думал, что сохранил.
      if (context?.previous) queryClient.setQueryData(QK_PREFS, context.previous);
      haptic('error');
      showMutationErrorToast(err);
    },
    onSuccess: (server) => queryClient.setQueryData<NotificationPreferences>(QK_PREFS, server),
  });

  const settingsMutation = useMutation<
    NotificationSettings,
    unknown,
    NotificationSettings,
    { previous: NotificationSettings | undefined }
  >({
    mutationFn: async (next) => (await notificationsApi.updateSettings(next)).data,
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: QK_SETTINGS });
      const previous = queryClient.getQueryData<NotificationSettings>(QK_SETTINGS);
      queryClient.setQueryData<NotificationSettings>(QK_SETTINGS, next);
      return { previous };
    },
    onError: (err, _next, context) => {
      if (context?.previous) queryClient.setQueryData(QK_SETTINGS, context.previous);
      haptic('error');
      showMutationErrorToast(err);
    },
    onSuccess: (server) => queryClient.setQueryData<NotificationSettings>(QK_SETTINGS, server),
  });

  const testMutation = useMutation<PushDiagnostics, unknown, void>({
    mutationFn: async () => (await pushApi.test()).data,
    onSuccess: (result) => {
      setTestResult(result);
      haptic(result.delivered ? 'success' : 'error');
      // A test can prune a dead token server-side — re-read the truth.
      void queryClient.invalidateQueries({ queryKey: QK_TOKENS });
    },
    onError: (err) => {
      haptic('error');
      showMutationErrorToast(err);
    },
  });

  const [registering, setRegistering] = React.useState(false);

  const onRegisterDevice = React.useCallback(async () => {
    haptic('tap');
    setRegistering(true);
    try {
      await registerPushToken();
      await refreshPermission();
      await queryClient.invalidateQueries({ queryKey: QK_TOKENS });
    } finally {
      setRegistering(false);
    }
  }, [queryClient, refreshPermission]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const onToggleCategory = React.useCallback(
    (key: NotificationCategory, nextEnabled: boolean) => {
      haptic('tap');
      // Switch ON  ⇒ remove from muted. Switch OFF ⇒ add to muted.
      const current = queryClient.getQueryData<NotificationPreferences>(QK_PREFS)?.muted ?? [];
      const set = new Set(current);
      if (nextEnabled) set.delete(key);
      else set.add(key);
      prefsMutation.mutate(Array.from(set));
    },
    [queryClient, prefsMutation],
  );

  const saveSettings = React.useCallback(
    (patch: Partial<NotificationSettings>) => {
      haptic('tap');
      const current = queryClient.getQueryData<NotificationSettings>(QK_SETTINGS) ?? effective;
      settingsMutation.mutate({
        ...current,
        ...patch,
        // Always stamp the CURRENT device offset: the user may have travelled
        // or the phone may have switched timezone since the row was written.
        tzOffsetMinutes: currentTzOffsetMinutes(),
      });
    },
    [queryClient, settingsMutation, effective],
  );

  const onToggleQuiet = React.useCallback(
    (next: boolean) => {
      saveSettings(
        next
          ? { quietFrom: effective.quietFrom ?? DEFAULT_QUIET_FROM, quietTo: effective.quietTo ?? DEFAULT_QUIET_TO }
          : { quietFrom: null, quietTo: null },
      );
    },
    [saveSettings, effective.quietFrom, effective.quietTo],
  );

  const onPickTime = React.useCallback(
    (date: Date) => {
      const value = dateToHhmm(date);
      if (picker === 'from') saveSettings({ quietFrom: value, quietTo: effective.quietTo ?? DEFAULT_QUIET_TO });
      else if (picker === 'to') saveSettings({ quietFrom: effective.quietFrom ?? DEFAULT_QUIET_FROM, quietTo: value });
      setPicker(null);
    },
    [picker, saveSettings, effective.quietFrom, effective.quietTo],
  );

  const isMuted = (key: NotificationCategory) => muted.includes(key);
  const categoriesDisabled = !effective.masterEnabled || prefsMutation.isPending;

  // ── Diagnostics-derived display values ─────────────────────────────────────

  const androidUnconfigured = Platform.OS === 'android' && !isAndroidPushConfigured();
  const tokenCount = tokens?.length ?? 0;
  // An old backend (deploy window) has no /push/tokens → 404. That is NOT the
  // same as "устройство не зарегистрировано"; claiming it would send the owner
  // chasing a bug that isn't there.
  const tokenStateKnown = !tokensError && tokens !== undefined;

  /**
   * `extra.apsEnvironment` describes the config that produced the JS BUNDLE,
   * which equals the installed binary's entitlement ONLY when we are running
   * the bundle that shipped inside that binary.
   *
   * runtimeVersion policy is `appVersion`, so an OTA update can land this very
   * screen on an OLDER binary built with `aps-environment: development` — and
   * it would then confidently display "production" in green, sending the owner
   * hunting in the wrong place. When the launch is not embedded we simply do
   * not know, and we say so.
   */
  const apsKnown = Updates.isEmbeddedLaunch;
  const apsEnvironment =
    (Constants.expoConfig?.extra as { apsEnvironment?: string } | undefined)?.apsEnvironment ?? 'неизвестно';

  const cardStyle = [styles.card, shadow, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }];

  if (prefsLoading || settingsLoading) {
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Уведомления" onBack={() => navigation.goBack()} />
        <ActivityIndicator style={{ marginTop: spacing[10] }} color={palette.accent.primary} />
      </View>
    );
  }

  if (loadFailed) {
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Уведомления" onBack={() => navigation.goBack()} />
        <View style={styles.loadErrorWrap}>
          <Ionicons name="cloud-offline-outline" size={40} color={palette.text.tertiary} />
          <Text style={[styles.loadErrorTitle, { color: palette.text.primary }]}>Не удалось загрузить настройки</Text>
          <Text style={[styles.loadErrorText, { color: palette.text.secondary }]}>
            Переключатели скрыты намеренно: если показать их сейчас, любое изменение перезапишет ваши настоящие
            настройки значениями по умолчанию.
          </Text>
          <TouchableOpacity
            style={[styles.retryBtn, { backgroundColor: palette.accent.primary }]}
            onPress={() => {
              haptic('tap');
              void queryClient.invalidateQueries({ queryKey: QK_PREFS });
              void queryClient.invalidateQueries({ queryKey: QK_SETTINGS });
            }}
            activeOpacity={0.8}
          >
            <Text style={styles.retryText}>Повторить</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Уведомления" onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + spacing[6] }]}
        contentInset={{ bottom: tabBarHeight }}
        scrollIndicatorInsets={{ bottom: tabBarHeight }}
        automaticallyAdjustContentInsets={false}
      >
        {/* ── Основное ─────────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={[iosSectionLabel, styles.sectionTitle, { color: palette.text.secondary }]}>ОСНОВНОЕ</Text>
          <View style={cardStyle}>
            <ToggleRow
              icon="notifications-outline"
              iconColor={palette.accent.primary}
              iconBg={palette.mode === 'dark' ? softTint(palette.accent.primary, 'dark') : colors.blue[50]}
              label="Все уведомления"
              sublabel="Главный выключатель — отключает всё разом"
              value={effective.masterEnabled}
              disabled={settingsMutation.isPending}
              onToggle={(next) => saveSettings({ masterEnabled: next })}
              showDivider
              palette={palette}
            />
            <ToggleRow
              icon="volume-high-outline"
              iconColor={colors.purple[600]}
              iconBg={palette.mode === 'dark' ? softTint(colors.purple[600], 'dark') : colors.purple[50]}
              label="Звук и вибрация"
              sublabel="Выключите — уведомления придут беззвучно"
              value={effective.sound}
              disabled={!effective.masterEnabled || settingsMutation.isPending}
              onToggle={(next) => saveSettings({ sound: next })}
              showDivider={false}
              palette={palette}
            />
          </View>
        </View>

        {/* ── Тихие часы ───────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={[iosSectionLabel, styles.sectionTitle, { color: palette.text.secondary }]}>ТИХИЕ ЧАСЫ</Text>
          <View style={cardStyle}>
            <ToggleRow
              icon="moon-outline"
              iconColor={colors.indigo[600]}
              iconBg={palette.mode === 'dark' ? softTint(colors.indigo[600], 'dark') : colors.indigo[50]}
              label="Не беспокоить"
              sublabel="В этот интервал уведомления не приходят"
              value={quietEnabled}
              disabled={!effective.masterEnabled || settingsMutation.isPending}
              onToggle={onToggleQuiet}
              showDivider={quietEnabled}
              palette={palette}
            />
            {quietEnabled ? (
              <>
                <TouchableOpacity
                  style={styles.timeRow}
                  onPress={() => {
                    haptic('tap');
                    setPicker('from');
                  }}
                  activeOpacity={0.6}
                >
                  <Text style={[styles.timeLabel, { color: palette.text.primary }]}>Начало</Text>
                  <Text style={[styles.timeValue, { color: palette.accent.primary }]}>{effective.quietFrom}</Text>
                  <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
                </TouchableOpacity>
                <View style={[styles.separator, styles.separatorFull, { backgroundColor: palette.border.subtle }]} />
                <TouchableOpacity
                  style={styles.timeRow}
                  onPress={() => {
                    haptic('tap');
                    setPicker('to');
                  }}
                  activeOpacity={0.6}
                >
                  <Text style={[styles.timeLabel, { color: palette.text.primary }]}>Окончание</Text>
                  <Text style={[styles.timeValue, { color: palette.accent.primary }]}>{effective.quietTo}</Text>
                  <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
                </TouchableOpacity>
              </>
            ) : null}
          </View>
          {quietEnabled ? (
            <Text style={[styles.footer, { color: palette.text.tertiary }]}>
              С {effective.quietFrom} до {effective.quietTo} уведомления не приходят вовсе — они не копятся и не
              приходят позже. Объявления от поддержки приходят всегда.
            </Text>
          ) : null}
        </View>

        {/* ── Категории ────────────────────────────────────────────────────── */}
        {SECTIONS.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={[iosSectionLabel, styles.sectionTitle, { color: palette.text.secondary }]}>
              {section.title}
            </Text>
            <View style={cardStyle}>
              {section.rows.map((row, idx) => (
                <ToggleRow
                  key={row.key}
                  icon={row.icon}
                  iconColor={row.iconColor}
                  iconBg={palette.mode === 'dark' ? softTint(row.iconColor, 'dark') : row.iconBg}
                  label={row.label}
                  sublabel={row.sublabel}
                  value={effective.masterEnabled && !isMuted(row.key)}
                  disabled={categoriesDisabled}
                  onToggle={(next) => onToggleCategory(row.key, next)}
                  showDivider={idx < section.rows.length - 1}
                  palette={palette}
                />
              ))}
            </View>
          </View>
        ))}

        {!effective.masterEnabled ? (
          <Text style={[styles.footer, { color: palette.text.tertiary }]}>
            «Все уведомления» выключены — отдельные категории не действуют, пока не включите главный выключатель.
          </Text>
        ) : null}

        {/* ── Диагностика ──────────────────────────────────────────────────── */}
        <View style={styles.section}>
          <Text style={[iosSectionLabel, styles.sectionTitle, { color: palette.text.secondary }]}>ДИАГНОСТИКА</Text>
          <View style={cardStyle}>
            <StatusRow
              icon="lock-open-outline"
              label="Разрешение системы"
              value={permissionGranted === null ? '—' : permissionGranted ? 'Выдано' : 'Не выдано'}
              tone={permissionGranted === null ? 'neutral' : permissionGranted ? 'ok' : 'bad'}
              showDivider
              palette={palette}
            />
            <StatusRow
              icon="phone-portrait-outline"
              label="Устройство зарегистрировано"
              value={!tokenStateKnown ? '—' : tokenCount > 0 ? `Да (${tokenCount})` : 'Нет'}
              tone={!tokenStateKnown ? 'neutral' : tokenCount > 0 ? 'ok' : 'bad'}
              showDivider
              palette={palette}
            />
            <StatusRow
              icon="cloud-outline"
              label="Среда доставки (APNs)"
              value={apsKnown ? apsEnvironment : 'неизвестно (OTA)'}
              tone={apsKnown ? (apsEnvironment === 'production' ? 'ok' : 'warn') : 'neutral'}
              showDivider
              palette={palette}
            />
            {permissionGranted === false ? (
              <ActionRow
                icon="settings-outline"
                label="Открыть настройки iPhone"
                onPress={() => {
                  haptic('tap');
                  void Linking.openSettings();
                }}
                showDivider
                palette={palette}
              />
            ) : null}
            {tokenStateKnown && tokenCount === 0 ? (
              <ActionRow
                icon="refresh-outline"
                label="Зарегистрировать это устройство"
                onPress={onRegisterDevice}
                busy={registering}
                showDivider
                palette={palette}
              />
            ) : null}
            <ActionRow
              icon="paper-plane-outline"
              label="Отправить тестовый пуш"
              onPress={() => {
                haptic('tap');
                setTestResult(null);
                testMutation.mutate();
              }}
              busy={testMutation.isPending}
              showDivider={false}
              palette={palette}
            />
          </View>

          {androidUnconfigured ? (
            <Text style={[styles.footer, { color: palette.text.tertiary }]}>
              На этом Android-устройстве push пока не работает: в сборке нет Firebase (google-services.json). iPhone это
              не касается.
            </Text>
          ) : null}

          {testMutation.isPending ? (
            <Text style={[styles.footer, { color: palette.text.tertiary }]}>
              Отправляем и ждём подтверждение доставки — это занимает несколько секунд.
            </Text>
          ) : null}

          {testResult ? (
            <View
              style={[styles.resultCard, { backgroundColor: palette.bg.card, borderColor: resultAccent(testResult) }]}
            >
              <View style={styles.resultHeader}>
                <Ionicons
                  name={
                    testResult.delivered ? 'checkmark-circle' : testResult.pending ? 'time-outline' : 'alert-circle'
                  }
                  size={20}
                  color={resultAccent(testResult)}
                />
                <Text style={[styles.resultTitle, { color: resultAccent(testResult) }]}>
                  {testResult.delivered
                    ? 'Доставлено'
                    : testResult.pending
                      ? 'Отправлено, ждём ответ'
                      : 'Не доставлено'}
                </Text>
              </View>
              <Text style={[styles.resultText, { color: palette.text.secondary }]}>{testResult.hint}</Text>
              <Text style={[styles.resultMeta, { color: palette.text.tertiary }]}>
                Устройств: {testResult.tokenCount} · отправлено: {testResult.sent} · ответ Expo:{' '}
                {testResult.status ?? 'нет'}
                {testResult.receipts.length > 0
                  ? ` · квитанции: ${testResult.receipts.map((r) => r.error ?? r.status).join(', ')}`
                  : ''}
              </Text>
            </View>
          ) : null}
        </View>

        <Text style={[styles.footer, styles.footerLast, { color: palette.text.tertiary }]}>
          Важные объявления от поддержки приходят всегда — их нельзя отключить.
        </Text>
      </ScrollView>

      <DateTimePickerModal
        visible={picker !== null}
        mode="time"
        value={
          picker === 'to'
            ? hhmmToDate(effective.quietTo, DEFAULT_QUIET_TO)
            : hhmmToDate(effective.quietFrom, DEFAULT_QUIET_FROM)
        }
        onConfirm={onPickTime}
        onCancel={() => setPicker(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing[4], paddingTop: spacing[2], gap: spacing[4] },

  section: { gap: spacing[1.5] },
  sectionTitle: { marginLeft: spacing[3], marginBottom: spacing[1.5] },

  card: {
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    shadowColor: colors.black,
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
    ...(Platform.OS === 'android' ? { elevation: 1 } : null),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3.5],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    minHeight: 60,
  },
  rowDisabled: { opacity: 0.45 },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: spacing[4] + 40 + spacing[3.5], // align under text (skip icon + gap)
  },
  separatorFull: { marginLeft: spacing[4] },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTextWrap: { flex: 1, minWidth: 0 },
  rowLabel: { fontSize: 16, fontWeight: '600', letterSpacing: -0.2 },
  rowDesc: { fontSize: 12, marginTop: 1 },

  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3.5],
    minHeight: 50,
  },
  timeLabel: { flex: 1, fontSize: 16, letterSpacing: -0.2 },
  timeValue: { fontSize: 16, fontWeight: fontWeight.semibold },

  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3.5],
    minHeight: 50,
  },
  statusIcon: { width: 20, textAlign: 'center' },
  statusLabel: { flex: 1, fontSize: fontSize.sm, letterSpacing: -0.2 },
  statusValue: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },

  resultCard: {
    marginTop: spacing[2],
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3.5],
    gap: spacing[1.5],
  },
  resultHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  resultTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  resultText: { fontSize: fontSize.sm, lineHeight: 19 },
  resultMeta: { fontSize: fontSize.xs, lineHeight: 16 },

  footer: {
    fontSize: fontSize.xs,
    lineHeight: 18,
    marginTop: spacing[1],
    marginLeft: spacing[3],
    marginRight: spacing[3],
  },
  footerLast: { marginBottom: spacing[2] },

  loadErrorWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[8],
    gap: spacing[3],
    marginTop: -spacing[10],
  },
  loadErrorTitle: { fontSize: 17, fontWeight: fontWeight.semibold, textAlign: 'center' },
  loadErrorText: { fontSize: fontSize.sm, lineHeight: 20, textAlign: 'center' },
  retryBtn: {
    marginTop: spacing[2],
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.xl,
  },
  retryText: { color: colors.white, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
});
