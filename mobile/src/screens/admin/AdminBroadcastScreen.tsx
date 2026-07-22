/**
 * AdminBroadcastScreen — compose + send a platform-wide announcement
 * («объявление от поддержки») to every tenant owner.
 *
 *   • Fields: title, body, optional imageUrl (URL or upload), up to 3 buttons
 *     ({ label, action: 'dismiss' | 'link', url? }).
 *   • Таргетинг (096): «Всем» или сегмент — тарифы, статус подписки
 *     (триал/платящие/истёкшие), активность за окно дней, отключённые.
 *   • Планирование (096): «Сейчас» или отложенная отправка на дату+время
 *     (scheduledAt) — паритет с web AdminBroadcastPage.
 *   • LIVE PREVIEW reuses the real <BroadcastModal> so what the superadmin
 *     sees is exactly what owners get — no duplicated card markup.
 *   • Отправка → notificationsApi.createBroadcast(...) with a confirm dialog,
 *     success haptic + toast.
 */
import React from 'react';
import { View, StyleSheet, ScrollView, Pressable, TextInput, Switch, Alert, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notificationsApi, uploadsApi, plansApi } from '../../api/services';
import { getImageUrl } from '../../api/axios';
import IosScreenHeader from '../../components/IosScreenHeader';
import BroadcastModal from '../../components/BroadcastModal';
import DateTimePickerModal from '../../components/DateTimePickerModal';
import { Text } from '../../platform/Typography';
import { haptic } from '../../platform/haptics';
import { useAuth } from '../../contexts/AuthContext';
import { useColors } from '../../contexts/ThemeContext';
import { useIosSurface } from '../../platform/iosSurface';
import { colors, spacing, borderRadius, softTint } from '../../theme';
import { useAdminTabBarScrollInsets } from '../../hooks/useAdminTabBarHeight';
import type {
  Broadcast,
  BroadcastButton,
  BroadcastHistoryItem,
  BroadcastSegment,
  BroadcastSubscriptionStatus,
  Plan,
} from '../../../../shared/types';
import { formatDateTime } from './adminShared';

/** Russian plural for «N просмотр / просмотра / просмотров». */
function pluralViews(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} просмотр`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} просмотра`;
  return `${n} просмотров`;
}

interface DraftButton {
  label: string;
  action: 'dismiss' | 'link';
  url: string;
}

const MAX_BUTTONS = 3;

// ── 096 — таргетинг + планирование (зеркалит web AdminBroadcastPage) ──
type TargetMode = 'all' | 'segment';
type ScheduleMode = 'now' | 'later';
type ActivityMode = 'any' | 'active' | 'dormant';

const STATUS_OPTIONS: { value: BroadcastSubscriptionStatus; label: string }[] = [
  { value: 'trial', label: 'Триал' },
  { value: 'paid', label: 'Платящие' },
  { value: 'expired', label: 'Истёкшие' },
];

const STATUS_LABELS: Record<BroadcastSubscriptionStatus, string> = {
  trial: 'триал',
  paid: 'платящие',
  expired: 'истёкшие',
};

/** Human Russian summary of a segment — та же сводка, что на web. */
function describeSegment(segment: BroadcastSegment | null | undefined, plans: Plan[] | undefined): string {
  if (!segment) return 'Все владельцы';
  const parts: string[] = [];
  if (segment.planIds?.length) {
    const names = segment.planIds.map((id) => plans?.find((p) => p.id === id)?.name ?? 'тариф');
    parts.push(`тарифы: ${names.join(', ')}`);
  }
  if (segment.subscriptionStatuses?.length) {
    parts.push(`статус: ${segment.subscriptionStatuses.map((s) => STATUS_LABELS[s]).join(', ')}`);
  }
  if (segment.activity) {
    parts.push(`${segment.activity === 'active' ? 'активные' : 'спящие'} за ${segment.activityWindowDays ?? 30} дн.`);
  }
  if (segment.includeInactive) parts.push('включая отключённые');
  return parts.length ? parts.join(' · ') : 'Все владельцы';
}

/** Дефолт отложенной отправки — ровный час, минимум через полчаса от «сейчас». */
function defaultScheduledDate(): Date {
  const d = new Date(Date.now() + 90 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  return d;
}

/**
 * Pull a legible reason out of an axios error. class-validator returns
 * `message` either as a string or an array of strings (e.g. a rejected
 * `imageUrl` → ["imageUrl must be a URL address"]). Falls back to the Russian
 * generic so the alert is never empty.
 */
function extractServerMessage(error: unknown): string {
  const data = (error as { response?: { data?: { message?: unknown } } })?.response?.data;
  const message = data?.message;
  if (Array.isArray(message)) {
    const joined = message.filter((m): m is string => typeof m === 'string').join('\n');
    if (joined) return joined;
  } else if (typeof message === 'string' && message.trim()) {
    return message;
  }
  return 'Не удалось отправить объявление';
}

export default function AdminBroadcastScreen() {
  const palette = useColors();
  const surface = useIosSurface();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isSuperadmin = user?.role === 'superadmin';
  const { contentInset, contentContainerPaddingBottom } = useAdminTabBarScrollInsets();

  const [title, setTitle] = React.useState('');
  const [body, setBody] = React.useState('');
  const [imageUrl, setImageUrl] = React.useState('');
  const [buttons, setButtons] = React.useState<DraftButton[]>([]);
  const [uploading, setUploading] = React.useState(false);
  const [previewOpen, setPreviewOpen] = React.useState(false);
  const [toast, setToast] = React.useState<string | null>(null);
  // ── 096 — таргетинг ──
  const [targetMode, setTargetMode] = React.useState<TargetMode>('all');
  const [planIds, setPlanIds] = React.useState<string[]>([]);
  const [statuses, setStatuses] = React.useState<BroadcastSubscriptionStatus[]>([]);
  const [activity, setActivity] = React.useState<ActivityMode>('any');
  const [activityWindowDays, setActivityWindowDays] = React.useState('30');
  const [includeInactive, setIncludeInactive] = React.useState(false);
  // ── 096 — планирование ──
  const [scheduleMode, setScheduleMode] = React.useState<ScheduleMode>('now');
  const [scheduledDate, setScheduledDate] = React.useState<Date | null>(null);
  const [pickerMode, setPickerMode] = React.useState<'date' | 'time' | null>(null);
  // Self-preview: the actual broadcast returned by the server, shown to the
  // superadmin right after sending (the fan-out targets directors, not the
  // sender, so without this the superadmin sees «ничего не пришло»).
  const [sentBroadcast, setSentBroadcast] = React.useState<Broadcast | null>(null);
  // Tap a history row → re-open the exact card directors received (read-only).
  const [historyPreview, setHistoryPreview] = React.useState<Broadcast | null>(null);
  // Which history row's cancel is in-flight (per-row spinner).
  const [cancellingId, setCancellingId] = React.useState<string | null>(null);

  // ── Broadcast history (superadmin-only; backend 403s otherwise) ──
  const historyQuery = useQuery<BroadcastHistoryItem[]>({
    queryKey: ['admin-broadcasts'],
    queryFn: async () => (await notificationsApi.listBroadcasts()).data,
    enabled: isSuperadmin,
  });
  const history = historyQuery.data ?? [];

  // Тарифы — чипы сегмента + имена в сводках истории (тот же ключ, что у
  // остальных админ-экранов, чтобы кэш был общий).
  const { data: plans = [] } = useQuery<Plan[]>({
    queryKey: ['admin-plans'],
    queryFn: async () => (await plansApi.getAll()).data,
    enabled: isSuperadmin,
  });
  const activePlans = React.useMemo(() => plans.filter((p) => p.isActive), [plans]);

  /** Собрать сегмент из формы; undefined = всем (back-compat контракта 096). */
  const buildSegment = React.useCallback((): BroadcastSegment | undefined => {
    if (targetMode === 'all') return undefined;
    const seg: BroadcastSegment = {};
    if (planIds.length) seg.planIds = planIds;
    if (statuses.length) seg.subscriptionStatuses = statuses;
    if (activity !== 'any') {
      seg.activity = activity;
      seg.activityWindowDays = parseInt(activityWindowDays, 10) || 30;
    }
    if (includeInactive) seg.includeInactive = true;
    return Object.keys(seg).length > 0 ? seg : undefined;
  }, [targetMode, planIds, statuses, activity, activityWindowDays, includeInactive]);

  const recipientsText = targetMode === 'all' ? 'Все владельцы автосервисов' : describeSegment(buildSegment(), plans);
  const isDeferred = scheduleMode === 'later';

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => {
      setCancellingId(id);
      await notificationsApi.cancelBroadcast(id);
    },
    onSuccess: () => {
      haptic('success');
      setToast('Рассылка отменена — больше не показывается');
      setTimeout(() => setToast(null), 2800);
      queryClient.invalidateQueries({ queryKey: ['admin-broadcasts'] });
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось отменить рассылку. Попробуйте ещё раз.');
    },
    onSettled: () => setCancellingId(null),
  });

  const handleCancel = React.useCallback(
    (item: BroadcastHistoryItem) => {
      haptic('warning');
      Alert.alert(
        'Отменить рассылку?',
        `«${item.title}» перестанет показываться владельцам, которые её ещё не видели. Уже показанные карточки не исчезнут. Действие необратимо.`,
        [
          { text: 'Назад', style: 'cancel' },
          { text: 'Отменить рассылку', style: 'destructive', onPress: () => cancelMutation.mutate(item.id) },
        ],
      );
    },
    [cancelMutation],
  );

  const openHistoryPreview = React.useCallback((item: BroadcastHistoryItem) => {
    haptic('tap');
    setHistoryPreview({
      id: item.id,
      title: item.title,
      body: item.body,
      imageUrl: item.imageUrl ? (getImageUrl(item.imageUrl) ?? item.imageUrl) : undefined,
      buttons: item.buttons,
      createdAt: item.createdAt,
    });
  }, []);

  // Sanitise draft → the exact shape createBroadcast / BroadcastModal expect.
  const cleanButtons = React.useMemo<BroadcastButton[]>(
    () =>
      buttons
        .filter((b) => b.label.trim().length > 0)
        .map((b) =>
          b.action === 'link' && b.url.trim()
            ? { label: b.label.trim(), action: 'link' as const, url: b.url.trim() }
            : { label: b.label.trim(), action: 'dismiss' as const },
        ),
    [buttons],
  );

  // Preview broadcast object (id/createdAt are placeholders — BroadcastModal
  // only reads title/body/imageUrl/buttons).
  const previewBroadcast = React.useMemo<Broadcast>(
    () => ({
      id: 'preview',
      title: title.trim() || 'Заголовок объявления',
      body: body.trim() || 'Текст объявления появится здесь.',
      imageUrl: imageUrl.trim() ? getImageUrl(imageUrl.trim()) : undefined,
      buttons: cleanButtons,
      createdAt: new Date().toISOString(),
    }),
    [title, body, imageUrl, cleanButtons],
  );

  const sendMutation = useMutation({
    mutationFn: async () => {
      const deferred = scheduleMode === 'later' && scheduledDate != null;
      const res = await notificationsApi.createBroadcast({
        title: title.trim(),
        body: body.trim(),
        // `imageUrl` is stored ABSOLUTE (the uploader saves the resolved URL),
        // so it passes the backend `@IsUrl` check. A manually typed relative
        // path is resolved here too as a safety net.
        imageUrl: imageUrl.trim() ? (getImageUrl(imageUrl.trim()) ?? imageUrl.trim()) : undefined,
        buttons: cleanButtons.length > 0 ? cleanButtons : undefined,
        // 096 — сегмент (undefined = всем) + отложенная отправка.
        segment: buildSegment(),
        scheduledAt: deferred ? scheduledDate.toISOString() : undefined,
      });
      return { created: res.data, deferred };
    },
    onSuccess: ({ created, deferred }) => {
      haptic('success');
      setTitle('');
      setBody('');
      setImageUrl('');
      setButtons([]);
      setTargetMode('all');
      setPlanIds([]);
      setStatuses([]);
      setActivity('any');
      setActivityWindowDays('30');
      setIncludeInactive(false);
      setScheduleMode('now');
      setScheduledDate(null);
      setToast(deferred ? 'Рассылка запланирована' : 'Объявление отправлено');
      setTimeout(() => setToast(null), 2800);
      // Show the superadmin the EXACT card owners will receive (confirmation).
      // Для отложенной рассылки карточка ещё никому не ушла — не открываем.
      if (!deferred) setSentBroadcast(created);
      // Surface it in the history list immediately.
      queryClient.invalidateQueries({ queryKey: ['admin-broadcasts'] });
    },
    onError: (error: unknown) => {
      haptic('error');
      Alert.alert('Ошибка', extractServerMessage(error));
    },
  });

  const pickImage = React.useCallback(async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [16, 9],
        quality: 0.8,
      });
      if (res.canceled) return;
      const asset = res.assets[0];
      setUploading(true);
      const up = await uploadsApi.upload(asset.uri, asset.fileName || 'broadcast.jpg');
      // The uploader returns a RELATIVE path (/api/uploads/…); store the
      // ABSOLUTE URL so the POSTed value passes the backend `@IsUrl` check.
      setImageUrl(getImageUrl(up.data.url) ?? up.data.url);
    } catch {
      Alert.alert('Ошибка', 'Не удалось загрузить изображение.');
    } finally {
      setUploading(false);
    }
  }, []);

  const handleSend = React.useCallback(() => {
    if (!title.trim()) {
      Alert.alert('Укажите заголовок', 'Заголовок объявления обязателен.');
      return;
    }
    if (!body.trim()) {
      Alert.alert('Укажите текст', 'Текст объявления обязателен.');
      return;
    }
    if (scheduleMode === 'later') {
      if (!scheduledDate) {
        Alert.alert('Выберите время', 'Укажите дату и время отправки.');
        return;
      }
      if (scheduledDate.getTime() <= Date.now()) {
        Alert.alert('Время в прошлом', 'Время отправки должно быть в будущем.');
        return;
      }
    }
    haptic('warning');
    // Final review — show the superadmin exactly what will go out before the
    // irreversible fan-out (push + in-app card to the targeted owners).
    const buttonsLine = cleanButtons.length > 0 ? `\nКнопки: ${cleanButtons.map((b) => b.label).join(', ')}` : '';
    const imageLine = imageUrl.trim() ? '\nС изображением' : '';
    const deferred = scheduleMode === 'later' && scheduledDate != null;
    const whenLine = deferred ? formatDateTime(scheduledDate.toISOString()) : 'сейчас';
    Alert.alert(
      deferred ? 'Запланировать рассылку?' : 'Отправить рассылку?',
      `«${title.trim()}»\n\n${body.trim()}${imageLine}${buttonsLine}\n\nКому: ${recipientsText}\nКогда: ${whenLine}\n\nВладельцы получат push-уведомление и карточку в приложении.`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: deferred ? 'Запланировать' : 'Отправить',
          style: 'destructive',
          onPress: () => sendMutation.mutate(),
        },
      ],
    );
  }, [title, body, imageUrl, cleanButtons, scheduleMode, scheduledDate, recipientsText, sendMutation]);

  const addButton = React.useCallback(() => {
    if (buttons.length >= MAX_BUTTONS) return;
    haptic('tap');
    setButtons([...buttons, { label: '', action: 'dismiss', url: '' }]);
  }, [buttons]);

  // Hard gate — this whole cabinet is superadmin-only (the backend also 403s
  // create/list/cancel, but never render the authoring UI to anyone else).
  if (!isSuperadmin) {
    return (
      <View style={[styles.root, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Рассылка" subtitle="Объявление владельцам" />
        <View style={styles.gateBlock}>
          <Ionicons name="lock-closed-outline" size={40} color={palette.text.tertiary} />
          <Text style={[styles.gateText, { color: palette.text.secondary }]}>Раздел доступен только суперадмину.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title="Рассылка"
        subtitle="Объявление владельцам"
        trailing={
          <Pressable
            onPress={() => {
              haptic('tap');
              setPreviewOpen(true);
            }}
            style={[styles.previewBtn, { backgroundColor: palette.bg.muted }]}
            hitSlop={6}
          >
            <Ionicons name="eye-outline" size={20} color={palette.text.primary} />
          </Pressable>
        }
      />

      <ScrollView
        contentInset={contentInset}
        contentContainerStyle={[styles.scroll, { paddingBottom: contentContainerPaddingBottom }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Title */}
        <Text style={[styles.label, { color: palette.text.tertiary }]}>Заголовок</Text>
        <View style={[styles.inputCard, surface.card]}>
          <TextInput
            style={[styles.input, { color: palette.text.primary }]}
            placeholder="Например, Новая функция"
            placeholderTextColor={palette.text.tertiary}
            value={title}
            onChangeText={setTitle}
            maxLength={80}
          />
        </View>

        {/* Body */}
        <Text style={[styles.label, { color: palette.text.tertiary }]}>Текст</Text>
        <View style={[styles.inputCard, surface.card]}>
          <TextInput
            style={[styles.input, styles.multiline, { color: palette.text.primary }]}
            placeholder="Опишите объявление…"
            placeholderTextColor={palette.text.tertiary}
            value={body}
            onChangeText={setBody}
            multiline
            maxLength={600}
          />
        </View>

        {/* Image */}
        <Text style={[styles.label, { color: palette.text.tertiary }]}>Изображение (необязательно)</Text>
        <View style={[styles.inputCard, surface.card, styles.imageRow]}>
          <TextInput
            style={[styles.input, { flex: 1, color: palette.text.primary }]}
            placeholder="URL или загрузите файл"
            placeholderTextColor={palette.text.tertiary}
            value={imageUrl}
            onChangeText={setImageUrl}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {imageUrl.length > 0 && (
            <Pressable onPress={() => setImageUrl('')} hitSlop={8}>
              <Ionicons name="close-circle" size={20} color={palette.text.tertiary} />
            </Pressable>
          )}
          <Pressable
            onPress={pickImage}
            disabled={uploading}
            style={[styles.uploadBtn, { backgroundColor: palette.accent.primarySoft }]}
            hitSlop={6}
          >
            {uploading ? (
              <ActivityIndicator size="small" color={palette.accent.primaryText} />
            ) : (
              <Ionicons name="image-outline" size={18} color={palette.accent.primaryText} />
            )}
          </Pressable>
        </View>

        {/* Buttons */}
        <View style={styles.btnsHead}>
          <Text style={[styles.label, { color: palette.text.tertiary, marginBottom: 0 }]}>
            Кнопки ({buttons.length}/{MAX_BUTTONS})
          </Text>
          {buttons.length < MAX_BUTTONS && (
            <Pressable onPress={addButton} style={styles.addBtnRow} hitSlop={6}>
              <Ionicons name="add-circle" size={18} color={palette.accent.primary} />
              <Text style={[styles.addBtnText, { color: palette.accent.primary }]}>Добавить</Text>
            </Pressable>
          )}
        </View>

        {buttons.map((btn, idx) => (
          <View key={idx} style={[styles.inputCard, surface.card, { gap: spacing[2.5] }]}>
            <View style={styles.btnTopRow}>
              <TextInput
                style={[styles.input, { flex: 1, color: palette.text.primary }]}
                placeholder={`Текст кнопки ${idx + 1}`}
                placeholderTextColor={palette.text.tertiary}
                value={btn.label}
                onChangeText={(v) => setButtons(buttons.map((b, i) => (i === idx ? { ...b, label: v } : b)))}
                maxLength={30}
              />
              <Pressable
                onPress={() => {
                  haptic('tap');
                  setButtons(buttons.filter((_, i) => i !== idx));
                }}
                hitSlop={8}
              >
                <Ionicons name="trash-outline" size={18} color={colors.red[500]} />
              </Pressable>
            </View>
            <View style={styles.actionToggle}>
              {(['dismiss', 'link'] as const).map((act) => {
                const on = btn.action === act;
                return (
                  <Pressable
                    key={act}
                    onPress={() => {
                      haptic('select');
                      setButtons(buttons.map((b, i) => (i === idx ? { ...b, action: act } : b)));
                    }}
                    style={[
                      styles.actionChip,
                      {
                        backgroundColor: on ? palette.accent.primary : palette.bg.muted,
                      },
                    ]}
                  >
                    <Text style={[styles.actionChipText, { color: on ? '#fff' : palette.text.secondary }]}>
                      {act === 'dismiss' ? 'Закрыть' : 'Ссылка'}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {btn.action === 'link' && (
              <TextInput
                style={[
                  styles.input,
                  styles.linkInput,
                  { color: palette.text.primary, borderColor: palette.border.subtle },
                ]}
                placeholder="https://…"
                placeholderTextColor={palette.text.tertiary}
                value={btn.url}
                onChangeText={(v) => setButtons(buttons.map((b, i) => (i === idx ? { ...b, url: v } : b)))}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
              />
            )}
          </View>
        ))}

        {/* ── Кому отправить (096 — сегменты) ── */}
        <Text style={[styles.label, { color: palette.text.tertiary }]}>Кому отправить</Text>
        <View style={[styles.inputCard, surface.card, styles.targetCard]}>
          <View style={styles.modeRow}>
            {(
              [
                { value: 'all', label: 'Всем' },
                { value: 'segment', label: 'По сегменту' },
              ] as { value: TargetMode; label: string }[]
            ).map((opt) => {
              const on = targetMode === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => {
                    haptic('select');
                    setTargetMode(opt.value);
                  }}
                  style={[styles.actionChip, { backgroundColor: on ? palette.accent.primary : palette.bg.muted }]}
                >
                  <Text style={[styles.actionChipText, { color: on ? '#fff' : palette.text.secondary }]}>
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {targetMode === 'segment' && (
            <>
              {activePlans.length > 0 && (
                <>
                  <Text style={[styles.subLabel, { color: palette.text.tertiary }]}>Тарифы</Text>
                  <View style={styles.chipsWrap}>
                    {activePlans.map((p) => {
                      const on = planIds.includes(p.id);
                      return (
                        <Pressable
                          key={p.id}
                          onPress={() => {
                            haptic('select');
                            setPlanIds((prev) =>
                              prev.includes(p.id) ? prev.filter((x) => x !== p.id) : [...prev, p.id],
                            );
                          }}
                          style={[
                            styles.actionChip,
                            { backgroundColor: on ? palette.accent.primary : palette.bg.muted },
                          ]}
                        >
                          <Text style={[styles.actionChipText, { color: on ? '#fff' : palette.text.secondary }]}>
                            {p.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </>
              )}

              <Text style={[styles.subLabel, { color: palette.text.tertiary }]}>Статус подписки</Text>
              <View style={styles.chipsWrap}>
                {STATUS_OPTIONS.map((s) => {
                  const on = statuses.includes(s.value);
                  return (
                    <Pressable
                      key={s.value}
                      onPress={() => {
                        haptic('select');
                        setStatuses((prev) =>
                          prev.includes(s.value) ? prev.filter((x) => x !== s.value) : [...prev, s.value],
                        );
                      }}
                      style={[styles.actionChip, { backgroundColor: on ? palette.accent.primary : palette.bg.muted }]}
                    >
                      <Text style={[styles.actionChipText, { color: on ? '#fff' : palette.text.secondary }]}>
                        {s.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={[styles.subLabel, { color: palette.text.tertiary }]}>Активность</Text>
              <View style={styles.chipsWrap}>
                {(
                  [
                    { value: 'any', label: 'Любая' },
                    { value: 'active', label: 'Активные' },
                    { value: 'dormant', label: 'Спящие' },
                  ] as { value: ActivityMode; label: string }[]
                ).map((opt) => {
                  const on = activity === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => {
                        haptic('select');
                        setActivity(opt.value);
                      }}
                      style={[styles.actionChip, { backgroundColor: on ? palette.accent.primary : palette.bg.muted }]}
                    >
                      <Text style={[styles.actionChipText, { color: on ? '#fff' : palette.text.secondary }]}>
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
                {activity !== 'any' && (
                  <View style={[styles.windowBox, { borderColor: palette.border.subtle }]}>
                    <TextInput
                      style={[styles.windowInput, { color: palette.text.primary }]}
                      keyboardType="number-pad"
                      value={activityWindowDays}
                      onChangeText={(v) => setActivityWindowDays(v.replace(/[^0-9]/g, ''))}
                      maxLength={3}
                    />
                    <Text style={[styles.windowSuffix, { color: palette.text.tertiary }]}>дн.</Text>
                  </View>
                )}
              </View>

              <View style={styles.switchRow}>
                <Text style={[styles.switchRowLabel, { color: palette.text.primary }]}>Включая отключённые</Text>
                <Switch
                  value={includeInactive}
                  onValueChange={(v) => {
                    haptic('select');
                    setIncludeInactive(v);
                  }}
                  trackColor={{ true: palette.accent.primary }}
                />
              </View>
            </>
          )}

          <Text style={[styles.summaryText, { color: palette.text.tertiary }]} numberOfLines={2}>
            Получатели: {recipientsText}
          </Text>
        </View>

        {/* ── Когда отправить (096 — планирование) ── */}
        <Text style={[styles.label, { color: palette.text.tertiary }]}>Когда отправить</Text>
        <View style={[styles.inputCard, surface.card, styles.targetCard]}>
          <View style={styles.modeRow}>
            {(
              [
                { value: 'now', label: 'Сейчас' },
                { value: 'later', label: 'Запланировать' },
              ] as { value: ScheduleMode; label: string }[]
            ).map((opt) => {
              const on = scheduleMode === opt.value;
              return (
                <Pressable
                  key={opt.value}
                  onPress={() => {
                    haptic('select');
                    setScheduleMode(opt.value);
                    if (opt.value === 'later' && !scheduledDate) setScheduledDate(defaultScheduledDate());
                  }}
                  style={[styles.actionChip, { backgroundColor: on ? palette.accent.primary : palette.bg.muted }]}
                >
                  <Text style={[styles.actionChipText, { color: on ? '#fff' : palette.text.secondary }]}>
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          {isDeferred && (
            <>
              <View style={styles.scheduleRow}>
                <Pressable
                  onPress={() => {
                    haptic('tap');
                    setPickerMode('date');
                  }}
                  style={[styles.scheduleBtn, { backgroundColor: palette.bg.muted }]}
                >
                  <Ionicons name="calendar-outline" size={16} color={palette.text.secondary} />
                  <Text style={[styles.scheduleBtnText, { color: palette.text.primary }]}>
                    {scheduledDate
                      ? scheduledDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
                      : 'Дата'}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    haptic('tap');
                    setPickerMode('time');
                  }}
                  style={[styles.scheduleBtn, { backgroundColor: palette.bg.muted }]}
                >
                  <Ionicons name="time-outline" size={16} color={palette.text.secondary} />
                  <Text style={[styles.scheduleBtnText, { color: palette.text.primary }]}>
                    {scheduledDate
                      ? scheduledDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
                      : 'Время'}
                  </Text>
                </Pressable>
              </View>
              {scheduledDate && scheduledDate.getTime() <= Date.now() && (
                <Text style={[styles.summaryText, { color: colors.red[500] }]}>
                  Время отправки должно быть в будущем.
                </Text>
              )}
            </>
          )}
        </View>

        {/* Send */}
        <Pressable
          onPress={handleSend}
          disabled={sendMutation.isPending}
          style={[styles.sendBtn, { backgroundColor: palette.accent.primary }]}
        >
          {sendMutation.isPending ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <>
              <Ionicons name={isDeferred ? 'time' : 'megaphone'} size={18} color={colors.white} />
              <Text style={styles.sendText}>
                {isDeferred
                  ? 'Запланировать рассылку'
                  : targetMode === 'all'
                    ? 'Отправить всем владельцам'
                    : 'Отправить по сегменту'}
              </Text>
            </>
          )}
        </Pressable>

        {/* ── История рассылок ── */}
        <Text style={[styles.label, styles.historyHead, { color: palette.text.tertiary }]}>История рассылок</Text>

        {historyQuery.isLoading ? (
          <View style={styles.historyState}>
            <ActivityIndicator color={palette.accent.primary} />
          </View>
        ) : historyQuery.isError ? (
          <View style={styles.historyState}>
            <Ionicons name="cloud-offline-outline" size={32} color={palette.text.tertiary} />
            <Text style={[styles.historyStateText, { color: palette.text.secondary }]}>
              Не удалось загрузить историю
            </Text>
            <Pressable
              onPress={() => {
                haptic('tap');
                historyQuery.refetch();
              }}
              style={[styles.retryBtn, { backgroundColor: palette.accent.primarySoft }]}
            >
              <Text style={[styles.retryText, { color: palette.accent.primaryText }]}>Повторить</Text>
            </Pressable>
          </View>
        ) : history.length === 0 ? (
          <View style={styles.historyState}>
            <Ionicons name="megaphone-outline" size={32} color={palette.text.tertiary} />
            <Text style={[styles.historyStateText, { color: palette.text.secondary }]}>
              Пока нет отправленных объявлений
            </Text>
          </View>
        ) : (
          history.map((item) => {
            const cancelled = item.cancelledAt != null;
            // 096 — запланирована, но fan-out ещё не сработал.
            const scheduledPending = !cancelled && item.sentAt === null && item.scheduledAt != null;
            const targetText = item.targetAll ? 'Всем владельцам' : describeSegment(item.segment, plans);
            return (
              <Pressable
                key={item.id}
                onPress={() => openHistoryPreview(item)}
                style={[styles.historyCard, surface.card]}
              >
                <View style={styles.historyTopRow}>
                  <Text style={[styles.historyTitle, { color: palette.text.primary }]} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <View
                    style={[
                      styles.badge,
                      {
                        backgroundColor: cancelled
                          ? colors.gray[100]
                          : palette.mode === 'dark'
                            ? softTint(scheduledPending ? colors.blue[600] : colors.green[600], 'dark')
                            : scheduledPending
                              ? colors.blue[50]
                              : colors.green[50],
                      },
                    ]}
                  >
                    <Text
                      style={[
                        styles.badgeText,
                        {
                          color: cancelled ? colors.gray[600] : scheduledPending ? colors.blue[700] : colors.green[700],
                        },
                      ]}
                    >
                      {cancelled ? 'Отменена' : scheduledPending ? 'Запланирована' : 'Активна'}
                    </Text>
                  </View>
                </View>
                <Text style={[styles.historyMeta, { color: palette.text.tertiary }]} numberOfLines={1}>
                  {scheduledPending && item.scheduledAt
                    ? `отправка ${formatDateTime(item.scheduledAt)}`
                    : `${formatDateTime(item.createdAt)} · ${pluralViews(item.seenCount)}`}
                </Text>
                <Text style={[styles.historyMeta, { color: palette.text.tertiary }]} numberOfLines={1}>
                  {targetText}
                </Text>
                {!cancelled && (
                  <Pressable
                    onPress={() => handleCancel(item)}
                    disabled={cancellingId === item.id}
                    style={[styles.cancelBtn, { borderColor: palette.border.subtle }]}
                    hitSlop={4}
                  >
                    {cancellingId === item.id ? (
                      <ActivityIndicator size="small" color={colors.red[500]} />
                    ) : (
                      <>
                        <Ionicons name="close-circle-outline" size={16} color={colors.red[500]} />
                        <Text style={[styles.cancelText, { color: colors.red[500] }]}>Отменить рассылку</Text>
                      </>
                    )}
                  </Pressable>
                )}
              </Pressable>
            );
          })
        )}
      </ScrollView>

      {/* Live preview — the ACTUAL BroadcastModal owners will see. */}
      <BroadcastModal broadcast={previewOpen ? previewBroadcast : null} onDismiss={() => setPreviewOpen(false)} />

      {/* Self-preview after sending — the real broadcast the server created,
          so the superadmin always sees the result of a successful send. */}
      <BroadcastModal broadcast={sentBroadcast} onDismiss={() => setSentBroadcast(null)} />

      {/* History row preview — re-open exactly what directors received. */}
      <BroadcastModal broadcast={historyPreview} onDismiss={() => setHistoryPreview(null)} />

      {/* 096 — пикер даты/времени отложенной отправки. Пикер сохраняет
          «другую половину» даты из value, поэтому date/time не конфликтуют. */}
      <DateTimePickerModal
        visible={pickerMode !== null}
        value={scheduledDate ?? defaultScheduledDate()}
        mode={pickerMode ?? 'date'}
        onConfirm={(d) => {
          setScheduledDate(d);
          setPickerMode(null);
        }}
        onCancel={() => setPickerMode(null)}
      />

      {/* Toast */}
      {toast && (
        <View style={[styles.toast, { backgroundColor: palette.bg.elevated, borderColor: palette.border.subtle }]}>
          <Ionicons name="checkmark-circle" size={18} color={colors.green[500]} />
          <Text style={[styles.toastText, { color: palette.text.primary }]}>{toast}</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  previewBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingHorizontal: spacing[4], paddingTop: spacing[1], gap: spacing[1.5] },
  label: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: spacing[2.5],
    marginBottom: spacing[1.5],
    marginLeft: spacing[1],
  },
  inputCard: { paddingHorizontal: spacing[3], paddingVertical: spacing[1] },
  input: { fontSize: 16, paddingVertical: spacing[3] },
  multiline: { minHeight: 96, textAlignVertical: 'top' },
  imageRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  uploadBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  btnsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing[2.5],
    marginBottom: spacing[1.5],
    paddingHorizontal: spacing[1],
  },
  addBtnRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  addBtnText: { fontSize: 14, fontWeight: '600' },
  btnTopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  actionToggle: { flexDirection: 'row', gap: spacing[2], paddingBottom: spacing[2] },
  actionChip: { paddingHorizontal: spacing[4], paddingVertical: spacing[2], borderRadius: borderRadius.full },
  actionChipText: { fontSize: 13, fontWeight: '600' },
  linkInput: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing[2],
    marginBottom: spacing[1],
  },
  // 096 — targeting + scheduling
  targetCard: { paddingVertical: spacing[3], gap: spacing[2.5] },
  modeRow: { flexDirection: 'row', gap: spacing[2] },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[2] },
  subLabel: { fontSize: 12, fontWeight: '600', marginTop: spacing[1] },
  windowBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
  },
  windowInput: { fontSize: 14, fontWeight: '600', minWidth: 28, textAlign: 'center', paddingVertical: 2 },
  windowSuffix: { fontSize: 12 },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing[1] },
  switchRowLabel: { fontSize: 14, fontWeight: '500', flex: 1 },
  summaryText: { fontSize: 12, lineHeight: 16 },
  scheduleRow: { flexDirection: 'row', gap: spacing[2] },
  scheduleBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.xl,
  },
  scheduleBtnText: { fontSize: 14, fontWeight: '600' },
  sendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[4],
    borderRadius: borderRadius['2xl'],
    marginTop: spacing[5],
  },
  sendText: { color: colors.white, fontSize: 16, fontWeight: '700' },
  // Gate
  gateBlock: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[8],
  },
  gateText: { fontSize: 15, textAlign: 'center', lineHeight: 21 },
  // History
  historyHead: { marginTop: spacing[6] },
  historyState: { alignItems: 'center', justifyContent: 'center', paddingVertical: spacing[8], gap: spacing[2.5] },
  historyStateText: { fontSize: 14, textAlign: 'center' },
  retryBtn: {
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.full,
    marginTop: spacing[1],
  },
  retryText: { fontSize: 14, fontWeight: '700' },
  historyCard: { paddingHorizontal: spacing[4], paddingVertical: spacing[3.5], gap: spacing[1.5] },
  historyTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing[2] },
  historyTitle: { fontSize: 15, fontWeight: '700', flex: 1 },
  badge: { paddingHorizontal: spacing[2], paddingVertical: 3, borderRadius: borderRadius.full },
  badgeText: { fontSize: 10, fontWeight: '700' },
  historyMeta: { fontSize: 12 },
  cancelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: spacing[1],
  },
  cancelText: { fontSize: 13, fontWeight: '600' },
  toast: {
    position: 'absolute',
    left: spacing[5],
    right: spacing[5],
    bottom: spacing[24],
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3.5],
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
  },
  toastText: { fontSize: 14, fontWeight: '600', flex: 1 },
});
