/**
 * InstallmentDetailScreen — карточка одной рассрочки (Round 13 редизайн).
 * Открыта тапом по строке в InstallmentsScreen (план приходит параметром
 * навигации для мгновенного рендера); свежие цифры, поручители и история
 * переносов читаются из `installmentsApi.clientLedger(clientId)`.
 *
 * Структура секций:
 *   1. Hero — остаток/статус/прогресс (обрезание крупной цифры вылечено явным
 *      lineHeight, эталон MarketingReportsScreen.kpiValue).
 *   2. Действия (debts_manage, открытый план): платёж / перенос даты (с
 *      причиной → installment_reschedules) / погашение.
 *   3. «Клиент и авто» — имя, телефон, авто из заказ-наряда, постоянные кнопки
 *      Позвонить/WhatsApp (неактивны при пустом телефоне — R12: phone=''
 *      легален) и «Заказ-наряд» при checkId.
 *   4. «Фото» — фото ЧЕКА (checkId — единственный носитель, отдельного
 *      хранилища у плана нет): общий кеш ['check-photos', checkId] с
 *      CheckDetailScreen, добавление, длинный тап → удалить/заменить. Гейт —
 *      inline-паттерн canAttachPhotos из CheckCreateScreen (фича check_photos).
 *   5. «Поручители» — список с Позвонить/WhatsApp, добавление и удаление
 *      (длинный тап) под debts_manage.
 *   6. «История» — единый таймлайн: первый взнос + платежи + ПЕРЕНОСЫ даты
 *      («12 авг → 19 авг», причина серым), новые сверху.
 *   7. «Звонки» — звонки клиента за период рассрочки (calls_view; плеер под
 *      calls_listen) через общий CallRow из CallsScreen. Ошибка телефонии →
 *      секция молча скрыта. Query НЕ персистится (ключ вне whitelist).
 *   8. «Напоминание клиенту» — как раньше, внизу, только при manual-режиме.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Share,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { setAudioModeAsync } from 'expo-audio';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import IosScreenHeader from '../components/IosScreenHeader';
import SectionHeader from '../components/SectionHeader';
import AnimatedCard from '../components/AnimatedCard';
import DateTimePickerModal from '../components/DateTimePickerModal';
import Modal from '../components/Modal';
import InstallmentPayModal from '../components/installments/InstallmentPayModal';
import { CallRow, type Call } from '../components/calls/CallRow';
import { Text } from '../platform/Typography';
import {
  formatInstallmentMoney,
  formatYmdHuman,
  dueLabel,
  statusChip,
  remainingColor,
  toYmd,
  ymdToDate,
  buildReminderText,
  telHref,
  whatsappHref,
} from '../components/installments/installmentUi';
import { installmentsApi, checkPhotosApi, callsApi, subscriptionApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { colors, fontSize, fontWeight, borderRadius, spacing, softTint } from '../theme';
import { haptic } from '../platform/haptics';
import { formatPhone } from '../../../shared/validation/phone';
import type {
  InstallmentPlan,
  InstallmentClientLedger,
  InstallmentPayment,
  InstallmentReschedule,
  InstallmentReminderSettings,
  CheckPhoto,
  SubscriptionInfo,
} from '../../../shared/types';

function formatDateTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${formatYmdHuman(toYmd(d))}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Есть ли у строки хоть одна цифра — «телефон непуст» (R12: '' легален). */
function hasPhone(phone?: string | null): boolean {
  return !!phone && phone.replace(/[^\d]/g, '').length > 0;
}

// Единый таймлайн «Истории»: первый взнос + платежи + переносы, новые сверху.
type HistoryEvent =
  | { kind: 'down'; ts: number; date: string; amount: number }
  | { kind: 'payment'; ts: number; payment: InstallmentPayment }
  | { kind: 'reschedule'; ts: number; reschedule: InstallmentReschedule };

export default function InstallmentDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const queryClient = useQueryClient();
  const { user: authUser, hasPermission } = useAuth();

  const initialPlan: InstallmentPlan = route.params?.plan;
  const planId = initialPlan?.id;
  const clientId = initialPlan?.clientId;

  // Приём платежа / досрочное погашение / правка плана / поручители —
  // debts_manage (сервер: POST :planId/pay, payoff, guarantors, PATCH → тот же ключ).
  const canManage = hasPermission('debts_manage');

  const [showPay, setShowPay] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Перенос даты (Round 13 #7): после выбора даты — модалка причины; PATCH
  // уходит только из неё (закрыл без подтверждения — переноса нет).
  const [pendingRescheduleYmd, setPendingRescheduleYmd] = useState<string | null>(null);
  const [rescheduleReason, setRescheduleReason] = useState('');

  // Форма «+ Добавить поручителя» (Round 13 #6). Кросс-платформенный Modal —
  // Alert.prompt запрещён (iOS-only).
  const [showGuarantorForm, setShowGuarantorForm] = useState(false);
  const [gName, setGName] = useState('');
  const [gRelation, setGRelation] = useState('');
  const [gPhone, setGPhone] = useState('');

  // Единственный раскрытый плеер записей (как в CallsScreen).
  const [playingId, setPlayingId] = useState<string | null>(null);

  // Fresh plan + payment ledger for this client. Find this plan by id; until it
  // arrives, render from the nav-param plan (instant, no flicker).
  const { data: ledger } = useQuery<InstallmentClientLedger>({
    queryKey: ['installments', 'client', clientId],
    queryFn: async () => (await installmentsApi.clientLedger(clientId)).data,
    enabled: !!clientId,
  });

  // Reminder settings — only owner-class may read them (server-gated). When the
  // tenant runs reminders in MANUAL mode, we surface per-plan contact actions
  // («Скопировать» / «Открыть WhatsApp» / «Позвонить») below.
  const { data: reminderSettings } = useQuery<InstallmentReminderSettings>({
    queryKey: ['installments', 'reminder-settings'],
    queryFn: async () => (await installmentsApi.getReminderSettings()).data,
    enabled: canManage,
    staleTime: 5 * 60 * 1000,
  });

  const plan: InstallmentPlan = useMemo(() => {
    const fresh = ledger?.plans?.find((p) => p.id === planId);
    return fresh ?? initialPlan;
  }, [ledger, planId, initialPlan]);

  const payments = useMemo(() => (ledger?.payments ?? []).filter((p) => p.planId === planId), [ledger, planId]);
  const guarantors = plan?.guarantors ?? [];
  const reschedules = plan?.reschedules ?? [];
  const clientHasPhone = hasPhone(plan?.clientPhone);

  // ── Фото чека (Round 13 #4) ───────────────────────────────────────────────
  // Inline-гейт фичи check_photos — паттерн CheckCreateScreen: FeatureGate тут
  // не подходит (он заменяет весь экран paywall'ом), секцию просто прячем.
  const { data: subInfo } = useQuery<SubscriptionInfo>({
    queryKey: ['subscription'],
    queryFn: async () => (await subscriptionApi.get()).data,
    staleTime: 5 * 60 * 1000,
  });
  const canAttachPhotos = useMemo(() => {
    if (authUser?.role === 'superadmin') return true;
    if (!subInfo) return true; // optimistic — same behaviour as FeatureGate
    return Array.isArray(subInfo.features) && subInfo.features.includes('check_photos');
  }, [authUser?.role, subInfo]);

  const checkId = plan?.checkId ?? null;
  const showPhotos = !!checkId && canAttachPhotos;
  // ОБЩИЙ ключ с CheckDetailScreen — оба экрана бьют в один кеш.
  const { data: photos = [], refetch: refetchPhotos } = useQuery<CheckPhoto[]>({
    queryKey: ['check-photos', checkId],
    queryFn: async () => (await checkPhotosApi.getByCheck(checkId!)).data,
    enabled: showPhotos,
    staleTime: 30_000,
  });

  /** Системный пикер → FormData → POST в чек рассрочки (носитель фото — чек). */
  const pickAndUploadPhoto = async (): Promise<boolean> => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
    });
    if (result.canceled || !checkId) return false;
    const asset = result.assets[0];
    const uri = asset.uri;
    const filename = uri.split('/').pop() || 'photo.jpg';
    const formData = new FormData();
    formData.append('photo', { uri, name: filename, type: 'image/jpeg' } as any);
    await checkPhotosApi.upload(checkId, formData);
    return true;
  };

  const uploadPhotoMutation = useMutation({
    mutationFn: pickAndUploadPhoto,
    onSuccess: (uploaded) => {
      if (uploaded) {
        haptic('success');
        refetchPhotos();
      }
    },
    onError: () => Alert.alert('Ошибка', 'Не удалось загрузить фото'),
  });

  const deletePhotoMutation = useMutation({
    mutationFn: (photoId: string) => checkPhotosApi.remove(photoId),
    onSuccess: () => refetchPhotos(),
    onError: () => Alert.alert('Ошибка', 'Не удалось удалить фото'),
  });

  // «Заменить» = новое фото загружается, затем старое удаляется — если пикер
  // отменён или аплоад упал, старое остаётся на месте.
  const replacePhotoMutation = useMutation({
    mutationFn: async (photoId: string) => {
      const uploaded = await pickAndUploadPhoto();
      if (uploaded) await checkPhotosApi.remove(photoId);
      return uploaded;
    },
    onSuccess: (replaced) => {
      if (replaced) haptic('success');
      refetchPhotos();
    },
    onError: () => {
      Alert.alert('Ошибка', 'Не удалось заменить фото');
      refetchPhotos();
    },
  });

  const onPhotoLongPress = (photoId: string) => {
    haptic('tap');
    Alert.alert('Фото заказ-наряда', 'Что сделать с этим фото?', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Заменить', onPress: () => replacePhotoMutation.mutate(photoId) },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () =>
          Alert.alert('Удалить фото?', 'Это действие необратимо', [
            { text: 'Отмена', style: 'cancel' },
            { text: 'Удалить', style: 'destructive', onPress: () => deletePhotoMutation.mutate(photoId) },
          ]),
      },
    ]);
  };

  // ── Звонки за период рассрочки (Round 13 #8) ──────────────────────────────
  // Ключ 'installment-calls' НАМЕРЕННО вне whitelist persistentCache — записи
  // звонков не персистим. Гейт: calls_view + клиент с телефоном (бэкенд для
  // бестелефонного клиента честно отдаёт пусто, но и запрос не нужен).
  const canViewCalls = hasPermission('calls_view');
  const canListen = hasPermission('calls_listen');
  const callsEnabled = !!clientId && canViewCalls && clientHasPhone;
  const callsRange = useMemo(() => {
    const from = plan?.createdAt ? toYmd(new Date(plan.createdAt)) : undefined;
    const to = plan?.closedAt ? toYmd(new Date(plan.closedAt)) : toYmd(new Date());
    return { dateFrom: from, dateTo: to };
  }, [plan?.createdAt, plan?.closedAt]);
  const {
    data: callsData,
    isLoading: callsLoading,
    isError: callsError,
  } = useQuery<{ calls: Call[]; total: number }>({
    queryKey: ['installment-calls', planId],
    queryFn: async () => (await callsApi.getClientCalls(clientId, callsRange)).data,
    enabled: callsEnabled,
    staleTime: 60_000,
    retry: false,
  });
  const calls: Call[] = callsData?.calls ?? [];

  // Аудио-сессия для плеера записей: как в CallsScreen — играть и при
  // беззвучном переключателе iPhone. При уходе с экрана глушим плеер.
  useEffect(() => {
    if (!callsEnabled) return;
    setAudioModeAsync({
      playsInSilentMode: true,
      shouldPlayInBackground: false,
      interruptionMode: 'mixWithOthers',
      allowsRecording: false,
    }).catch(() => {});
    return () => {
      setPlayingId(null);
    };
  }, [callsEnabled]);

  // ── Мутации плана ─────────────────────────────────────────────────────────
  const updateMutation = useMutation({
    mutationFn: (vars: { nextPaymentDate?: string; comment?: string; rescheduleReason?: string }) =>
      installmentsApi.update(planId, vars),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['installments'] });
      haptic('success');
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось перенести дату');
    },
  });

  const payoffMutation = useMutation({
    // Способ оплаты (119) пробрасывается на бэкенд, чтобы погашение легло в
    // кассу принявшего (нал/карта). Дефолта тут нет — выбор в самом алерте.
    mutationFn: (method: 'cash' | 'card') => installmentsApi.payoff(planId, { method }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['installments'] });
      haptic('success');
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось погасить рассрочку');
    },
  });

  const addGuarantorMutation = useMutation({
    mutationFn: (vars: { fullName: string; relation?: string; phone?: string }) =>
      installmentsApi.addGuarantor(planId, vars),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['installments'] });
      haptic('success');
      setShowGuarantorForm(false);
      setGName('');
      setGRelation('');
      setGPhone('');
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось добавить поручителя');
    },
  });

  const removeGuarantorMutation = useMutation({
    mutationFn: (guarantorId: string) => installmentsApi.removeGuarantor(planId, guarantorId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['installments'] });
      haptic('success');
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось удалить поручителя');
    },
  });

  const confirmPayoff = () => {
    haptic('tap');
    Alert.alert(
      'Погасить полностью?',
      `Остаток ${formatInstallmentMoney(plan.remaining)} будет погашен, рассрочка закроется. Как приняты деньги?`,
      [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Картой', style: 'default', onPress: () => payoffMutation.mutate('card') },
        { text: 'Наличными', style: 'default', onPress: () => payoffMutation.mutate('cash') },
      ],
    );
  };

  const submitReschedule = () => {
    if (!pendingRescheduleYmd || updateMutation.isPending) return;
    updateMutation.mutate({
      nextPaymentDate: pendingRescheduleYmd,
      rescheduleReason: rescheduleReason.trim() || undefined,
    });
    setPendingRescheduleYmd(null);
    setRescheduleReason('');
  };

  const submitGuarantor = () => {
    const fullName = gName.trim();
    if (!fullName || addGuarantorMutation.isPending) return;
    addGuarantorMutation.mutate({
      fullName,
      relation: gRelation.trim() || undefined,
      phone: gPhone.trim() || undefined,
    });
  };

  const onDeleteGuarantor = (guarantorId: string, name: string) => {
    if (!canManage) return;
    haptic('tap');
    Alert.alert('Удалить поручителя?', name, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => removeGuarantorMutation.mutate(guarantorId) },
    ]);
  };

  // ── Контакты (постоянные, не только manual-режим) ─────────────────────────
  const callPhone = (phone?: string | null) => {
    if (!hasPhone(phone)) return;
    haptic('tap');
    Linking.openURL(telHref(phone)).catch(() => Alert.alert('Звонок', 'Не удалось открыть телефон.'));
  };
  const whatsappPhone = (phone?: string | null) => {
    if (!hasPhone(phone)) return;
    haptic('tap');
    Linking.openURL(whatsappHref(phone)).catch(() => Alert.alert('WhatsApp', 'Не удалось открыть WhatsApp.'));
  };

  // ── Ручное напоминание (mode === 'manual') ────────────────────────────────
  // «Скопировать» — системный share-лист с готовым текстом (в проекте нет
  // expo-clipboard); WhatsApp/Позвонить — те же постоянные хелперы.
  const manualReminders = reminderSettings?.mode === 'manual';
  const onCopyReminder = () => {
    haptic('tap');
    Share.share({ message: buildReminderText(reminderSettings?.template, plan) }).catch(() => {});
  };

  // ── Единый таймлайн истории ───────────────────────────────────────────────
  const history = useMemo<HistoryEvent[]>(() => {
    const events: HistoryEvent[] = [];
    if (plan?.downPayment > 0 && plan.createdAt) {
      events.push({
        kind: 'down',
        ts: new Date(plan.createdAt).getTime() || 0,
        date: plan.createdAt,
        amount: plan.downPayment,
      });
    }
    for (const p of payments) {
      events.push({ kind: 'payment', ts: new Date(p.paidAt).getTime() || 0, payment: p });
    }
    for (const r of reschedules) {
      events.push({ kind: 'reschedule', ts: new Date(r.createdAt).getTime() || 0, reschedule: r });
    }
    events.sort((a, b) => b.ts - a.ts);
    return events;
  }, [plan?.downPayment, plan?.createdAt, payments, reschedules]);

  if (!initialPlan) {
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Рассрочка" onBack={() => navigation.goBack()} centerTitle />
      </View>
    );
  }

  const chip = statusChip(plan, palette.mode);
  const remColor = remainingColor(plan);
  const closed = plan.status === 'closed';
  const due = dueLabel(plan);
  const busy = payoffMutation.isPending || updateMutation.isPending;
  const disabledContactColor = palette.text.tertiary;
  const showCallsSection = callsEnabled && !callsError;

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title={plan.checkNumber ? `Заказ-наряд №${plan.checkNumber}` : 'Рассрочка'}
        subtitle={plan.clientName || undefined}
        onBack={() => navigation.goBack()}
        centerTitle
      />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: tabBarHeight + spacing[6] }]}
        showsVerticalScrollIndicator={false}
      >
        {/* 1. Hero summary */}
        <AnimatedCard
          style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
          index={0}
        >
          <View style={styles.summaryTop}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.summaryHint, { color: palette.text.tertiary }]}>
                {closed ? 'Погашено' : 'Остаток'}
              </Text>
              <Text style={[styles.summaryRemaining, { color: remColor }]} numberOfLines={1} adjustsFontSizeToFit>
                {formatInstallmentMoney(closed ? plan.total : plan.remaining)}
              </Text>
            </View>
            <View style={[styles.chip, { backgroundColor: chip.bg }]}>
              <Text style={[styles.chipText, { color: chip.text }]}>{chip.label}</Text>
            </View>
          </View>

          {/* paid / total progress */}
          <View style={[styles.track, { backgroundColor: palette.bg.muted }]}>
            <View
              style={[
                styles.fill,
                {
                  width: `${plan.total > 0 ? Math.max(0, Math.min(1, plan.paid / plan.total)) * 100 : closed ? 100 : 0}%`,
                  backgroundColor: closed ? colors.green[600] : remColor,
                },
              ]}
            />
          </View>

          <View style={styles.statsRow}>
            <Stat label="Сумма" value={formatInstallmentMoney(plan.total)} palette={palette} />
            <Stat
              label="Внесено"
              value={formatInstallmentMoney(plan.paid)}
              palette={palette}
              valueColor={colors.green[600]}
            />
            <Stat
              label="Остаток"
              value={formatInstallmentMoney(plan.remaining)}
              palette={palette}
              valueColor={closed ? palette.text.secondary : remColor}
            />
          </View>

          {!closed && due ? (
            <View style={[styles.dueRow, { borderTopColor: palette.border.subtle }]}>
              <Ionicons
                name={plan.overdue ? 'alert-circle' : 'calendar-outline'}
                size={16}
                color={plan.overdue ? colors.red[600] : palette.text.secondary}
              />
              <Text style={[styles.dueText, { color: plan.overdue ? colors.red[600] : palette.text.secondary }]}>
                {due}
                {plan.nextPaymentDate ? ` · ${formatYmdHuman(plan.nextPaymentDate)}` : ''}
              </Text>
            </View>
          ) : null}

          {plan.comment ? (
            <View style={[styles.metaLine, { borderTopColor: palette.border.subtle }]}>
              <Ionicons name="chatbubble-ellipses-outline" size={15} color={palette.text.tertiary} />
              <Text style={[styles.metaText, { color: palette.text.secondary }]}>{plan.comment}</Text>
            </View>
          ) : null}
        </AnimatedCard>

        {/* 2. Actions — debts_manage, hidden when closed. */}
        {canManage && !closed ? (
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: colors.green[600] }]}
              activeOpacity={0.85}
              onPress={() => {
                haptic('tap');
                setShowPay(true);
              }}
              disabled={busy}
            >
              <Ionicons name="add-circle-outline" size={19} color={colors.white} />
              <Text style={styles.primaryBtnText}>Внести платёж</Text>
            </TouchableOpacity>
            <View style={styles.secondaryRow}>
              <TouchableOpacity
                style={[styles.secondaryBtn, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
                activeOpacity={0.8}
                onPress={() => {
                  haptic('tap');
                  setShowDatePicker(true);
                }}
                disabled={busy}
              >
                <Ionicons name="calendar-outline" size={17} color={palette.accent.primary} />
                <Text style={[styles.secondaryBtnText, { color: palette.text.primary }]}>Перенести дату</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.secondaryBtn,
                  { backgroundColor: softTint(colors.green[600], palette.mode), borderColor: 'transparent' },
                ]}
                activeOpacity={0.8}
                onPress={confirmPayoff}
                disabled={busy}
              >
                {payoffMutation.isPending ? (
                  <ActivityIndicator size="small" color={colors.green[600]} />
                ) : (
                  <>
                    <Ionicons
                      name="checkmark-done"
                      size={17}
                      color={palette.mode === 'dark' ? colors.green[300] : colors.green[700]}
                    />
                    <Text
                      style={[
                        styles.secondaryBtnText,
                        { color: palette.mode === 'dark' ? colors.green[300] : colors.green[700] },
                      ]}
                    >
                      Погасить
                    </Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : null}

        {/* 3. Клиент и авто */}
        <SectionHeader title="Клиент и авто" />
        <AnimatedCard
          style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
          index={1}
        >
          <TouchableOpacity
            style={styles.personRow}
            activeOpacity={0.7}
            onPress={() => {
              haptic('select');
              navigation.navigate('ClientDetail', { id: plan.clientId });
            }}
          >
            <View style={[styles.personIcon, { backgroundColor: softTint(colors.blue[600], palette.mode) }]}>
              <Ionicons
                name="person-outline"
                size={17}
                color={palette.mode === 'dark' ? colors.blue[300] : colors.blue[600]}
              />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.personName, { color: palette.text.primary }]} numberOfLines={1}>
                {plan.clientName || 'Клиент'}
              </Text>
              <Text style={[styles.personMeta, { color: palette.text.tertiary }]} numberOfLines={1}>
                {clientHasPhone ? formatPhone(plan.clientPhone || '') : 'Телефон не указан'}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
          </TouchableOpacity>

          {plan.carId ? (
            <View style={[styles.carRow, { borderTopColor: palette.border.subtle }]}>
              <View style={[styles.personIcon, { backgroundColor: palette.bg.muted }]}>
                <Ionicons name="car-sport-outline" size={17} color={palette.text.secondary} />
              </View>
              <Text style={[styles.carName, { color: palette.text.primary }]} numberOfLines={1}>
                {plan.carMakeModel || 'Автомобиль'}
              </Text>
              {plan.carPlate ? (
                <View
                  style={[styles.plateBadge, { borderColor: palette.border.strong, backgroundColor: palette.bg.muted }]}
                >
                  <Text style={[styles.plateText, { color: palette.text.primary }]}>{plan.carPlate}</Text>
                </View>
              ) : null}
            </View>
          ) : null}

          <View style={[styles.contactRow, { borderTopColor: palette.border.subtle }]}>
            <TouchableOpacity
              style={[styles.contactBtn, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
              activeOpacity={0.8}
              onPress={() => callPhone(plan.clientPhone)}
              disabled={!clientHasPhone}
            >
              <Ionicons
                name="call-outline"
                size={17}
                color={clientHasPhone ? colors.green[600] : disabledContactColor}
              />
              <Text
                style={[styles.contactBtnText, { color: clientHasPhone ? palette.text.primary : disabledContactColor }]}
              >
                Позвонить
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.contactBtn,
                clientHasPhone
                  ? { backgroundColor: softTint(colors.green[600], palette.mode), borderColor: 'transparent' }
                  : { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
              ]}
              activeOpacity={0.8}
              onPress={() => whatsappPhone(plan.clientPhone)}
              disabled={!clientHasPhone}
            >
              <Ionicons name="logo-whatsapp" size={17} color={clientHasPhone ? '#25D366' : disabledContactColor} />
              <Text
                style={[styles.contactBtnText, { color: clientHasPhone ? palette.text.primary : disabledContactColor }]}
              >
                WhatsApp
              </Text>
            </TouchableOpacity>
            {plan.checkId ? (
              <TouchableOpacity
                style={[styles.contactBtn, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
                activeOpacity={0.8}
                onPress={() => {
                  haptic('select');
                  navigation.navigate('CheckDetail', { id: plan.checkId });
                }}
              >
                <Ionicons name="document-text-outline" size={17} color={palette.accent.primary} />
                <Text style={[styles.contactBtnText, { color: palette.text.primary }]}>Заказ-наряд</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </AnimatedCard>

        {/* 4. Фото заказ-наряда (checkId — единственный носитель) */}
        {showPhotos ? (
          <>
            <SectionHeader
              title="Фото"
              count={photos.length || undefined}
              trailing={
                <TouchableOpacity
                  onPress={() => {
                    haptic('tap');
                    uploadPhotoMutation.mutate();
                  }}
                  disabled={uploadPhotoMutation.isPending || replacePhotoMutation.isPending}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityLabel="Добавить фото"
                >
                  {uploadPhotoMutation.isPending || replacePhotoMutation.isPending ? (
                    <ActivityIndicator size="small" color={palette.accent.primary} />
                  ) : (
                    <Ionicons name="add-circle-outline" size={20} color={palette.accent.primary} />
                  )}
                </TouchableOpacity>
              }
            />
            <AnimatedCard
              style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
              index={2}
            >
              {photos.length === 0 ? (
                <View style={styles.photoEmpty}>
                  <Ionicons name="images-outline" size={26} color={palette.text.tertiary} />
                  <Text style={[styles.photoEmptyText, { color: palette.text.tertiary }]}>
                    Нет фото. Нажмите «+» чтобы добавить — фото хранятся в заказ-наряде.
                  </Text>
                </View>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoStrip}>
                  {photos.map((photo) => (
                    <TouchableOpacity
                      key={photo.id}
                      onLongPress={() => onPhotoLongPress(photo.id)}
                      delayLongPress={500}
                      activeOpacity={0.85}
                    >
                      <Image
                        source={{ uri: photo.photoUrl }}
                        style={styles.photoThumb}
                        contentFit="cover"
                        transition={200}
                        placeholder={{ blurhash: 'L4SY{q?b00?b~q?b?b?b?b?b?b?b' }}
                        placeholderContentFit="cover"
                        cachePolicy="memory-disk"
                      />
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
            </AnimatedCard>
          </>
        ) : null}

        {/* 5. Поручители */}
        {guarantors.length > 0 || canManage ? (
          <>
            <SectionHeader
              title="Поручители"
              count={guarantors.length || undefined}
              trailing={
                canManage ? (
                  <TouchableOpacity
                    onPress={() => {
                      haptic('tap');
                      setShowGuarantorForm(true);
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityLabel="Добавить поручителя"
                  >
                    <Ionicons name="add-circle-outline" size={20} color={palette.accent.primary} />
                  </TouchableOpacity>
                ) : undefined
              }
            />
            <AnimatedCard
              style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
              index={2}
            >
              {guarantors.length === 0 ? (
                <Text style={[styles.emptyText, { color: palette.text.tertiary }]}>
                  Поручителей нет. Добавьте человека, который ручается за должника, — его контакты будут под рукой.
                </Text>
              ) : (
                guarantors.map((g, i) => {
                  const gHasPhone = hasPhone(g.phone);
                  const meta = [g.relation, gHasPhone ? formatPhone(g.phone || '') : null].filter(Boolean).join(' · ');
                  return (
                    <TouchableOpacity
                      key={g.id}
                      style={[
                        styles.guarantorRow,
                        i < guarantors.length - 1
                          ? { borderBottomColor: palette.border.subtle }
                          : { borderBottomWidth: 0 },
                      ]}
                      activeOpacity={canManage ? 0.7 : 1}
                      onLongPress={() => onDeleteGuarantor(g.id, g.fullName)}
                      delayLongPress={500}
                    >
                      <View style={[styles.personIcon, { backgroundColor: softTint(colors.amber[600], palette.mode) }]}>
                        <Ionicons
                          name="shield-checkmark-outline"
                          size={16}
                          color={palette.mode === 'dark' ? colors.amber[200] : colors.amber[600]}
                        />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={[styles.personName, { color: palette.text.primary }]} numberOfLines={1}>
                          {g.fullName}
                        </Text>
                        {meta ? (
                          <Text style={[styles.personMeta, { color: palette.text.tertiary }]} numberOfLines={1}>
                            {meta}
                          </Text>
                        ) : null}
                      </View>
                      {gHasPhone ? (
                        <View style={styles.guarantorActions}>
                          <TouchableOpacity
                            style={[styles.roundBtn, { backgroundColor: palette.bg.muted }]}
                            onPress={() => callPhone(g.phone)}
                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                            accessibilityLabel={`Позвонить: ${g.fullName}`}
                          >
                            <Ionicons name="call-outline" size={15} color={colors.green[600]} />
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.roundBtn, { backgroundColor: palette.bg.muted }]}
                            onPress={() => whatsappPhone(g.phone)}
                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                            accessibilityLabel={`WhatsApp: ${g.fullName}`}
                          >
                            <Ionicons name="logo-whatsapp" size={15} color="#25D366" />
                          </TouchableOpacity>
                        </View>
                      ) : null}
                    </TouchableOpacity>
                  );
                })
              )}
              {canManage && guarantors.length > 0 ? (
                <Text style={[styles.hintText, { color: palette.text.tertiary }]}>
                  Долгое нажатие на поручителя — удалить.
                </Text>
              ) : null}
            </AnimatedCard>
          </>
        ) : null}

        {/* 6. Единая история: взнос + платежи + переносы */}
        <SectionHeader title="История" count={history.length || undefined} />
        <AnimatedCard
          style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
          index={3}
        >
          {history.length === 0 ? (
            <Text style={[styles.emptyText, { color: palette.text.tertiary }]}>Платежей пока не было</Text>
          ) : (
            history.map((ev, i) => {
              const last = i === history.length - 1;
              const rowBorder = last ? { borderBottomWidth: 0 } : { borderBottomColor: palette.border.subtle };
              if (ev.kind === 'reschedule') {
                const r = ev.reschedule;
                const fromLabel = r.oldDate ? formatYmdHuman(r.oldDate) : 'без даты';
                const toLabel = r.newDate ? formatYmdHuman(r.newDate) : 'без даты';
                return (
                  <View key={`r-${r.id}`} style={[styles.payRow, rowBorder]}>
                    <View style={[styles.payIcon, { backgroundColor: softTint(colors.amber[600], palette.mode) }]}>
                      <Ionicons
                        name="calendar-outline"
                        size={15}
                        color={palette.mode === 'dark' ? colors.amber[200] : colors.amber[600]}
                      />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.payName, { color: palette.text.primary }]} numberOfLines={1}>
                        {fromLabel} → {toLabel}
                      </Text>
                      <Text style={[styles.payMeta, { color: palette.text.tertiary }]} numberOfLines={1}>
                        {[formatDateTime(r.createdAt), r.createdByName].filter(Boolean).join(' · ')}
                      </Text>
                      {r.reason ? (
                        <Text style={[styles.payReason, { color: palette.text.tertiary }]} numberOfLines={2}>
                          {r.reason}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={[styles.payKindLabel, { color: palette.text.tertiary }]}>перенос</Text>
                  </View>
                );
              }
              if (ev.kind === 'down') {
                return (
                  <View key="down" style={[styles.payRow, rowBorder]}>
                    <View style={[styles.payIcon, { backgroundColor: softTint(colors.blue[600], palette.mode) }]}>
                      <Ionicons
                        name="wallet-outline"
                        size={15}
                        color={palette.mode === 'dark' ? colors.blue[300] : colors.blue[600]}
                      />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.payName, { color: palette.text.primary }]}>Первый взнос</Text>
                      <Text style={[styles.payMeta, { color: palette.text.tertiary }]}>{formatDateTime(ev.date)}</Text>
                    </View>
                    <Text style={[styles.payAmount, { color: colors.green[600] }]}>
                      +{formatInstallmentMoney(ev.amount)}
                    </Text>
                  </View>
                );
              }
              const p = ev.payment;
              return (
                <View key={p.id} style={[styles.payRow, rowBorder]}>
                  <View style={[styles.payIcon, { backgroundColor: softTint(colors.green[600], palette.mode) }]}>
                    <Ionicons
                      name="cash-outline"
                      size={15}
                      color={palette.mode === 'dark' ? colors.green[300] : colors.green[600]}
                    />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.payName, { color: palette.text.primary }]} numberOfLines={1}>
                      {p.comment || 'Платёж'}
                    </Text>
                    <Text style={[styles.payMeta, { color: palette.text.tertiary }]} numberOfLines={1}>
                      {[formatDateTime(p.paidAt), p.createdByName].filter(Boolean).join(' · ')}
                    </Text>
                  </View>
                  <Text style={[styles.payAmount, { color: colors.green[600] }]}>
                    +{formatInstallmentMoney(p.amount)}
                  </Text>
                </View>
              );
            })
          )}
        </AnimatedCard>

        {/* 7. Звонки за период рассрочки (ошибка телефонии → секция скрыта) */}
        {showCallsSection ? (
          <>
            <SectionHeader title="Звонки" count={calls.length || undefined} />
            <AnimatedCard
              style={[
                styles.card,
                styles.callsCard,
                { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
              ]}
              index={4}
            >
              {callsLoading ? (
                <ActivityIndicator size="small" color={colors.primary[500]} style={styles.callsSpinner} />
              ) : calls.length === 0 ? (
                <Text style={[styles.emptyText, styles.callsEmpty, { color: palette.text.tertiary }]}>
                  Звонков за период рассрочки нет
                </Text>
              ) : (
                calls.map((call, idx) => (
                  <CallRow
                    key={`${call.id}-${idx}`}
                    call={call}
                    navigation={navigation}
                    playingId={playingId}
                    setPlayingId={setPlayingId}
                    canListen={canListen}
                    palette={palette}
                  />
                ))
              )}
            </AnimatedCard>
          </>
        ) : null}

        {/* 8. Ручное напоминание — только в manual-режиме, для открытой рассрочки. */}
        {manualReminders && canManage && !closed ? (
          <>
            <SectionHeader title="Напоминание клиенту" />
            <AnimatedCard
              style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
              index={5}
            >
              <Text style={[styles.reminderHint, { color: palette.text.secondary }]}>
                Скопируйте готовый текст и отправьте клиенту в WhatsApp или позвоните.
              </Text>
              <View style={styles.reminderRow}>
                <TouchableOpacity
                  style={[
                    styles.reminderBtn,
                    { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
                  ]}
                  activeOpacity={0.8}
                  onPress={onCopyReminder}
                >
                  <Ionicons name="copy-outline" size={17} color={palette.accent.primary} />
                  <Text style={[styles.reminderBtnText, { color: palette.text.primary }]}>Скопировать</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.reminderBtn,
                    { backgroundColor: softTint(colors.green[600], palette.mode), borderColor: 'transparent' },
                  ]}
                  activeOpacity={0.8}
                  onPress={() => whatsappPhone(plan.clientPhone)}
                  disabled={!clientHasPhone}
                >
                  <Ionicons name="logo-whatsapp" size={17} color={clientHasPhone ? '#25D366' : palette.text.tertiary} />
                  <Text
                    style={[
                      styles.reminderBtnText,
                      { color: clientHasPhone ? palette.text.primary : palette.text.tertiary },
                    ]}
                  >
                    WhatsApp
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.reminderBtn,
                    { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
                  ]}
                  activeOpacity={0.8}
                  onPress={() => callPhone(plan.clientPhone)}
                  disabled={!clientHasPhone}
                >
                  <Ionicons
                    name="call-outline"
                    size={17}
                    color={clientHasPhone ? colors.green[600] : palette.text.tertiary}
                  />
                  <Text
                    style={[
                      styles.reminderBtnText,
                      { color: clientHasPhone ? palette.text.primary : palette.text.tertiary },
                    ]}
                  >
                    Позвонить
                  </Text>
                </TouchableOpacity>
              </View>
            </AnimatedCard>
          </>
        ) : null}
      </ScrollView>

      <InstallmentPayModal visible={showPay} plan={plan} onClose={() => setShowPay(false)} onPaid={() => {}} />

      <DateTimePickerModal
        visible={showDatePicker}
        value={plan.nextPaymentDate ? ymdToDate(plan.nextPaymentDate) : new Date()}
        mode="date"
        onConfirm={(d) => {
          setShowDatePicker(false);
          // PATCH уходит из модалки причины (Round 13 #7) — не отсюда.
          setRescheduleReason('');
          setPendingRescheduleYmd(toYmd(d));
        }}
        onCancel={() => setShowDatePicker(false)}
      />

      {/* Причина переноса — по образцу InstallmentPayModal: причина опциональна,
          но поле на виду. Закрытие без подтверждения = переноса нет. */}
      <Modal
        visible={!!pendingRescheduleYmd}
        onClose={() => {
          setPendingRescheduleYmd(null);
          setRescheduleReason('');
        }}
        title="Перенос платежа"
      >
        <View>
          <View style={[styles.rescheduleBanner, { backgroundColor: palette.bg.muted }]}>
            <Ionicons name="calendar-outline" size={17} color={palette.accent.primary} />
            <Text style={[styles.rescheduleBannerText, { color: palette.text.primary }]}>
              {plan.nextPaymentDate ? `${formatYmdHuman(plan.nextPaymentDate)} → ` : 'Новая дата: '}
              {pendingRescheduleYmd ? formatYmdHuman(pendingRescheduleYmd) : ''}
            </Text>
          </View>
          <Text style={[styles.fieldLabel, { color: palette.text.secondary }]}>Причина переноса (необязательно)</Text>
          <TextInput
            style={[
              styles.input,
              { backgroundColor: palette.bg.muted, color: palette.text.primary, borderColor: palette.border.subtle },
            ]}
            value={rescheduleReason}
            onChangeText={setRescheduleReason}
            placeholder="Например: клиент попросил до зарплаты"
            placeholderTextColor={palette.text.tertiary}
            returnKeyType="done"
            maxLength={500}
          />
          <TouchableOpacity
            style={[styles.submitBtn, { backgroundColor: palette.accent.primary }]}
            onPress={submitReschedule}
            disabled={updateMutation.isPending}
            activeOpacity={0.85}
          >
            {updateMutation.isPending ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Text style={styles.submitBtnText}>Перенести дату</Text>
            )}
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Добавление поручителя — кросс-платформенная форма (не Alert.prompt). */}
      <Modal visible={showGuarantorForm} onClose={() => setShowGuarantorForm(false)} title="Новый поручитель">
        <View>
          <Text style={[styles.fieldLabel, { color: palette.text.secondary }]}>Имя *</Text>
          <TextInput
            style={[
              styles.input,
              { backgroundColor: palette.bg.muted, color: palette.text.primary, borderColor: palette.border.subtle },
            ]}
            value={gName}
            onChangeText={setGName}
            placeholder="Фамилия Имя"
            placeholderTextColor={palette.text.tertiary}
            autoFocus
            returnKeyType="next"
            maxLength={200}
          />
          <Text style={[styles.fieldLabel, styles.fieldLabelGap, { color: palette.text.secondary }]}>
            Кем приходится
          </Text>
          <TextInput
            style={[
              styles.input,
              { backgroundColor: palette.bg.muted, color: palette.text.primary, borderColor: palette.border.subtle },
            ]}
            value={gRelation}
            onChangeText={setGRelation}
            placeholder="Брат, сосед, коллега…"
            placeholderTextColor={palette.text.tertiary}
            returnKeyType="next"
            maxLength={200}
          />
          <Text style={[styles.fieldLabel, styles.fieldLabelGap, { color: palette.text.secondary }]}>Телефон</Text>
          <TextInput
            style={[
              styles.input,
              { backgroundColor: palette.bg.muted, color: palette.text.primary, borderColor: palette.border.subtle },
            ]}
            value={gPhone}
            onChangeText={setGPhone}
            placeholder="+7 900 000-00-00"
            placeholderTextColor={palette.text.tertiary}
            keyboardType="phone-pad"
            returnKeyType="done"
            maxLength={32}
          />
          <TouchableOpacity
            style={[
              styles.submitBtn,
              { backgroundColor: palette.accent.primary },
              (!gName.trim() || addGuarantorMutation.isPending) && styles.submitDisabled,
            ]}
            onPress={submitGuarantor}
            disabled={!gName.trim() || addGuarantorMutation.isPending}
            activeOpacity={0.85}
          >
            {addGuarantorMutation.isPending ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Text style={styles.submitBtnText}>Добавить поручителя</Text>
            )}
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

function Stat({
  label,
  value,
  palette,
  valueColor,
}: {
  label: string;
  value: string;
  palette: ReturnType<typeof useColors>;
  valueColor?: string;
}) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statLabel, { color: palette.text.tertiary }]}>{label}</Text>
      <Text
        style={[styles.statValue, { color: valueColor ?? palette.text.primary }]}
        numberOfLines={1}
        adjustsFontSizeToFit
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: spacing[4], paddingTop: spacing[2] },
  card: {
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing[4],
    marginBottom: spacing[3],
  },

  summaryTop: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3] },
  summaryHint: { fontSize: 12.5, fontWeight: fontWeight.medium },
  summaryRemaining: {
    fontSize: 30,
    // Явная высота строки (Round 13 #3): без неё крупный глиф-бокс наследует
    // Typography `body` lineHeight:22 и обрезается сверху — эталон фикса
    // MarketingReportsScreen.kpiValue / heroValue.
    lineHeight: 38,
    fontWeight: fontWeight.bold,
    letterSpacing: -0.8,
    marginTop: 2,
  },
  chip: { paddingHorizontal: spacing[2.5], paddingVertical: 4, borderRadius: borderRadius.full },
  chipText: { fontSize: 11.5, fontWeight: fontWeight.bold, letterSpacing: 0.1 },

  track: { height: 6, borderRadius: 3, marginTop: spacing[3.5], overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },

  statsRow: { flexDirection: 'row', marginTop: spacing[3.5], gap: spacing[2] },
  stat: { flex: 1, gap: 3 },
  statLabel: { fontSize: 11.5, fontWeight: fontWeight.medium },
  statValue: { fontSize: 15, lineHeight: 20, fontWeight: fontWeight.bold, letterSpacing: -0.3 },

  dueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[3.5],
    paddingTop: spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  dueText: { fontSize: 13.5, fontWeight: fontWeight.semibold, flex: 1 },

  metaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[3],
    paddingTop: spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  metaText: { fontSize: 14, flex: 1 },

  actions: { marginBottom: spacing[4], gap: spacing[2.5] },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[3.5],
  },
  primaryBtnText: { color: colors.white, fontSize: fontSize.base, fontWeight: fontWeight.bold },
  secondaryRow: { flexDirection: 'row', gap: spacing[2.5] },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing[3],
  },
  secondaryBtnText: { fontSize: 13.5, fontWeight: fontWeight.semibold },

  // «Клиент и авто»
  personRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  personIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  personName: { fontSize: 14.5, fontWeight: fontWeight.semibold, letterSpacing: -0.2 },
  personMeta: { fontSize: 12.5, marginTop: 2 },
  carRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginTop: spacing[3],
    paddingTop: spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  carName: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: fontWeight.medium },
  plateBadge: {
    borderWidth: 1,
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
  },
  plateText: {
    fontSize: 12.5,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.8,
    fontVariant: ['tabular-nums'],
    textTransform: 'uppercase',
  },
  contactRow: {
    flexDirection: 'row',
    gap: spacing[2],
    marginTop: spacing[3],
    paddingTop: spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  contactBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing[2.5],
    paddingHorizontal: spacing[1],
  },
  contactBtnText: { fontSize: 12.5, fontWeight: fontWeight.semibold },

  // Фото
  photoEmpty: { flexDirection: 'row', alignItems: 'center', gap: spacing[2.5] },
  photoEmptyText: { fontSize: 12.5, flex: 1, lineHeight: 17 },
  photoStrip: { gap: spacing[2] },
  photoThumb: { width: 80, height: 80, borderRadius: 10, backgroundColor: colors.gray[100] },

  // Поручители
  guarantorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[2.5],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  guarantorActions: { flexDirection: 'row', gap: spacing[2] },
  roundBtn: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  hintText: { fontSize: 11.5, marginTop: spacing[2.5] },
  emptyText: { fontSize: 13, lineHeight: 18, textAlign: 'center', paddingVertical: spacing[2] },

  // История
  payRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  payIcon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  payName: { fontSize: 14, fontWeight: fontWeight.semibold },
  payMeta: { fontSize: 12, marginTop: 2 },
  payReason: { fontSize: 12, marginTop: 2, fontStyle: 'italic' },
  payAmount: { fontSize: 15, fontWeight: fontWeight.bold, letterSpacing: -0.2 },
  payKindLabel: { fontSize: 11.5, fontWeight: fontWeight.medium },

  // Звонки — CallRow тянется на всю ширину карточки, поэтому без внутреннего
  // паддинга; скругление карточки клипует строки.
  callsCard: { padding: 0, overflow: 'hidden' },
  callsSpinner: { paddingVertical: spacing[6] },
  callsEmpty: { paddingVertical: spacing[5], paddingHorizontal: spacing[4] },

  // Напоминание
  reminderHint: { fontSize: 13.5, lineHeight: 19, marginBottom: spacing[3] },
  reminderRow: { flexDirection: 'row', gap: spacing[2] },
  reminderBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[1],
  },
  reminderBtnText: { fontSize: 12.5, fontWeight: fontWeight.semibold },

  // Модалки (перенос / поручитель)
  rescheduleBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
    marginBottom: spacing[3],
  },
  rescheduleBannerText: { fontSize: 15, fontWeight: fontWeight.semibold, flex: 1 },
  fieldLabel: { fontSize: 13, fontWeight: fontWeight.medium, marginBottom: spacing[1.5] },
  fieldLabelGap: { marginTop: spacing[3] },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
    fontSize: 16,
  },
  submitBtn: {
    marginTop: spacing[4],
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[3.5],
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitDisabled: { opacity: 0.5 },
  submitBtnText: { color: colors.white, fontSize: fontSize.base, fontWeight: fontWeight.bold },
});
