/**
 * AdminRegistrationRequestsScreen — superadmin review of self-service
 * registration requests (migration 123).
 *
 *   • Segmented status filter (Ожидают / Одобрены / Отклонены) →
 *     adminApi.listRegistrationRequests(status). Newest first (server order).
 *   • Each request card: company, owner, phone, comment, date + a status chip.
 *   • Pending requests carry two actions:
 *       – Принять → trial sheet (default 14 дней, or an explicit «до даты»,
 *         mirrors the AdminTenantDetail extend sheet) → approveRegistrationRequest
 *         creates the tenant + owner + a FREE trial. On success we jump straight
 *         into the created tenant's detail card.
 *       – Отклонить → optional reason modal → rejectRegistrationRequest.
 *
 * After any decision we invalidate the requests list + tenants + admin-stats so
 * the Overview board / metrics reflect the new tenant immediately.
 *
 * On the visual system — IosScreenHeader, iosCard (surface), StatusChip, theme
 * palette. Android-safe (no iOS-only API; Alert.prompt avoided in favour of a
 * cross-platform reason modal).
 */
import React from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
  Modal,
  TextInput,
  Platform,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { adminApi } from '../../api/services';
import IosScreenHeader from '../../components/IosScreenHeader';
import DateTimePickerModal from '../../components/DateTimePickerModal';
import { Text } from '../../platform/Typography';
import { haptic } from '../../platform/haptics';
import { useColors } from '../../contexts/ThemeContext';
import { useIosSurface } from '../../platform/iosSurface';
import { colors, spacing, borderRadius, getBadgeColors } from '../../theme';
import { useAdminTabBarScrollInsets } from '../../hooks/useAdminTabBarHeight';
import { formatPhone } from '../../../../shared/validation/phone';
import type { RegistrationRequest, Tenant } from '../../../../shared/types';
import { formatDateTime, formatFullDate, StatusChip, InitialAvatar, type StatusInfo } from './adminShared';

type StatusFilter = 'pending' | 'approved' | 'rejected';

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'pending', label: 'Ожидают' },
  { key: 'approved', label: 'Одобрены' },
  { key: 'rejected', label: 'Отклонены' },
];

/** Trial presets for the approve sheet — фиксированные окна пробного периода. */
const TRIAL_PRESETS: { label: string; days: number }[] = [
  { label: '14 дней', days: 14 },
  { label: '30 дней', days: 30 },
  { label: '90 дней', days: 90 },
];

const DAY_MS = 24 * 60 * 60 * 1000;

/** End of the given local day (23:59:59) — natural meaning of «действует до …». */
function endOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(23, 59, 59, 999);
  return c;
}

/** Status → coloured chip descriptor for a registration request. */
function requestStatusInfo(status: RegistrationRequest['status'], mode: 'light' | 'dark'): StatusInfo {
  const dark = mode === 'dark';
  const badges = getBadgeColors('dark');
  if (status === 'approved')
    return dark
      ? { bg: badges.green.bg, text: badges.green.text, label: 'Одобрена' }
      : { bg: colors.green[50], text: colors.green[700], label: 'Одобрена' };
  if (status === 'rejected')
    return dark
      ? { bg: badges.red.bg, text: badges.red.text, label: 'Отклонена' }
      : { bg: colors.red[50], text: colors.red[700], label: 'Отклонена' };
  return dark
    ? { bg: badges.blue.bg, text: badges.blue.text, label: 'Ожидает' }
    : { bg: colors.blue[50], text: colors.blue[700], label: 'Ожидает' };
}

export default function AdminRegistrationRequestsScreen() {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const surface = useIosSurface();
  const queryClient = useQueryClient();
  const { contentInset, contentContainerPaddingBottom } = useAdminTabBarScrollInsets();

  const [filter, setFilter] = React.useState<StatusFilter>('pending');
  const [refreshing, setRefreshing] = React.useState(false);

  // Approve sheet state
  const [approving, setApproving] = React.useState<RegistrationRequest | null>(null);
  const [trialMode, setTrialMode] = React.useState<'days' | 'until'>('days');
  const [trialDays, setTrialDays] = React.useState('14');
  const [trialUntil, setTrialUntil] = React.useState<Date | null>(null);
  const [trialDatePickerOpen, setTrialDatePickerOpen] = React.useState(false);

  // Reject modal state
  const [rejecting, setRejecting] = React.useState<RegistrationRequest | null>(null);
  const [rejectReason, setRejectReason] = React.useState('');

  const [busyId, setBusyId] = React.useState<string | null>(null);

  const {
    data: requests = [],
    isLoading,
    isError,
    refetch,
  } = useQuery<RegistrationRequest[]>({
    queryKey: ['admin-registration-requests', filter],
    queryFn: async () => (await adminApi.listRegistrationRequests(filter)).data,
  });

  const invalidate = React.useCallback(() => {
    // Every status bucket may change (a pending row leaves → appears elsewhere).
    queryClient.invalidateQueries({ queryKey: ['admin-registration-requests'] });
    queryClient.invalidateQueries({ queryKey: ['admin-tenants'] });
    queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
  }, [queryClient]);

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const approveMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: { until?: string; trialDays?: number } }) => {
      setBusyId(id);
      return (await adminApi.approveRegistrationRequest(id, data)).data;
    },
    onSuccess: (tenant: Tenant) => {
      haptic('success');
      setApproving(null);
      invalidate();
      // Jump into the freshly created tenant so the operator can immediately
      // tune the plan / employees — AdminTenantDetail is a sibling in this stack.
      if (tenant?.id) navigation.navigate('AdminTenantDetail', { id: tenant.id });
    },
    onError: (error: unknown) => {
      haptic('error');
      const msg = (error as { response?: { data?: { message?: unknown } } })?.response?.data?.message;
      const reason = Array.isArray(msg) ? msg.filter((m): m is string => typeof m === 'string').join('\n') : msg;
      Alert.alert('Ошибка', typeof reason === 'string' && reason.trim() ? reason : 'Не удалось одобрить заявку');
    },
    onSettled: () => setBusyId(null),
  });

  const rejectMutation = useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      setBusyId(id);
      await adminApi.rejectRegistrationRequest(id, reason ? { reason } : undefined);
    },
    onSuccess: () => {
      haptic('success');
      setRejecting(null);
      setRejectReason('');
      invalidate();
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось отклонить заявку');
    },
    onSettled: () => setBusyId(null),
  });

  const openApprove = React.useCallback((req: RegistrationRequest) => {
    haptic('tap');
    setTrialMode('days');
    setTrialDays('14');
    setTrialUntil(null);
    setApproving(req);
  }, []);

  const openReject = React.useCallback((req: RegistrationRequest) => {
    haptic('tap');
    setRejectReason('');
    setRejecting(req);
  }, []);

  const applyTrialPreset = React.useCallback((days: number) => {
    haptic('select');
    setTrialMode('days');
    setTrialDays(String(days));
    setTrialUntil(null);
  }, []);

  const submitApprove = React.useCallback(() => {
    if (!approving) return;
    if (trialMode === 'until') {
      if (!trialUntil) {
        haptic('error');
        Alert.alert('Укажите дату', 'Выберите дату окончания пробного периода.');
        return;
      }
      const until = endOfDay(trialUntil);
      if (until.getTime() <= Date.now()) {
        haptic('error');
        Alert.alert('Неверная дата', 'Дата окончания должна быть в будущем.');
        return;
      }
      approveMutation.mutate({ id: approving.id, data: { until: until.toISOString() } });
    } else {
      const days = Math.round(Number(trialDays));
      if (!Number.isFinite(days) || days <= 0) {
        haptic('error');
        Alert.alert('Укажите срок', 'Введите количество дней пробного периода больше нуля.');
        return;
      }
      approveMutation.mutate({ id: approving.id, data: { trialDays: days } });
    }
  }, [approving, trialMode, trialDays, trialUntil, approveMutation]);

  // Resolved «действует до» preview for the approve sheet recap.
  const resolvedUntil = React.useMemo(() => {
    if (trialMode === 'until') return trialUntil;
    const days = Math.round(Number(trialDays));
    if (!Number.isFinite(days) || days <= 0) return null;
    return endOfDay(new Date(Date.now() + days * DAY_MS));
  }, [trialMode, trialDays, trialUntil]);

  const busy = busyId === approving?.id || busyId === rejecting?.id;

  return (
    <View style={[styles.root, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title="Заявки на регистрацию"
        subtitle="Самостоятельная регистрация"
        onBack={() => navigation.goBack()}
      />

      {/* Status filter */}
      <View style={styles.filterRow}>
        {FILTERS.map((f) => {
          const on = filter === f.key;
          return (
            <Pressable
              key={f.key}
              onPress={() => {
                haptic('select');
                setFilter(f.key);
              }}
              style={[
                styles.filterChip,
                {
                  backgroundColor: on ? palette.accent.primary : palette.bg.card,
                  borderColor: on ? palette.accent.primary : palette.border.subtle,
                },
              ]}
            >
              <Text style={[styles.filterChipText, { color: on ? colors.white : palette.text.secondary }]}>
                {f.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView
        contentInset={contentInset}
        contentContainerStyle={[styles.scroll, { paddingBottom: contentContainerPaddingBottom }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.accent.primary} />
        }
      >
        {isLoading ? (
          <ActivityIndicator color={palette.accent.primary} style={{ marginTop: spacing[10] }} />
        ) : isError ? (
          <View style={styles.stateBlock}>
            <Ionicons name="cloud-offline-outline" size={40} color={palette.text.tertiary} />
            <Text style={[styles.stateText, { color: palette.text.secondary }]}>Не удалось загрузить заявки</Text>
            <Pressable
              onPress={() => {
                haptic('tap');
                refetch();
              }}
              style={[styles.retryBtn, { backgroundColor: palette.accent.primarySoft }]}
            >
              <Text style={[styles.retryText, { color: palette.accent.primaryText }]}>Повторить</Text>
            </Pressable>
          </View>
        ) : requests.length === 0 ? (
          <View style={styles.stateBlock}>
            <Ionicons name="mail-open-outline" size={40} color={palette.text.tertiary} />
            <Text style={[styles.stateText, { color: palette.text.secondary }]}>
              {filter === 'pending'
                ? 'Нет новых заявок на регистрацию'
                : filter === 'approved'
                  ? 'Одобренных заявок пока нет'
                  : 'Отклонённых заявок пока нет'}
            </Text>
          </View>
        ) : (
          requests.map((req) => (
            <View key={req.id} style={[styles.card, surface.card]}>
              <View style={styles.cardHead}>
                <InitialAvatar name={req.companyName} palette={palette} size={40} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.company, { color: palette.text.primary }]} numberOfLines={1}>
                    {req.companyName}
                  </Text>
                  <Text style={[styles.owner, { color: palette.text.secondary }]} numberOfLines={1}>
                    {req.ownerName}
                  </Text>
                </View>
                <StatusChip status={requestStatusInfo(req.status, palette.mode)} />
              </View>

              <View style={styles.metaRow}>
                <Ionicons name="call-outline" size={15} color={palette.text.tertiary} />
                <Text style={[styles.metaText, { color: palette.text.secondary }]}>{formatPhone(req.phone)}</Text>
              </View>
              <View style={styles.metaRow}>
                <Ionicons name="time-outline" size={15} color={palette.text.tertiary} />
                <Text style={[styles.metaText, { color: palette.text.tertiary }]}>{formatDateTime(req.createdAt)}</Text>
              </View>

              {req.comment ? (
                <View style={[styles.commentBox, { backgroundColor: palette.bg.muted }]}>
                  <Text style={[styles.commentText, { color: palette.text.secondary }]}>{req.comment}</Text>
                </View>
              ) : null}

              {req.status === 'rejected' && req.rejectReason ? (
                <View style={styles.metaRow}>
                  <Ionicons name="close-circle-outline" size={15} color={colors.red[500]} />
                  <Text style={[styles.metaText, { color: colors.red[600] }]} numberOfLines={2}>
                    {req.rejectReason}
                  </Text>
                </View>
              ) : null}

              {req.status === 'approved' && req.reviewedAt ? (
                <View style={styles.metaRow}>
                  <Ionicons name="checkmark-circle-outline" size={15} color={colors.green[600]} />
                  <Text style={[styles.metaText, { color: palette.text.tertiary }]}>
                    Одобрена · {formatDateTime(req.reviewedAt)}
                  </Text>
                </View>
              ) : null}

              {req.status === 'approved' && req.createdTenantId ? (
                <Pressable
                  onPress={() => {
                    haptic('tap');
                    navigation.navigate('AdminTenantDetail', { id: req.createdTenantId });
                  }}
                  style={[styles.openTenantRow, { borderTopColor: palette.border.subtle }]}
                >
                  <Ionicons name="business-outline" size={16} color={palette.accent.primaryText} />
                  <Text style={[styles.openTenantText, { color: palette.accent.primaryText }]}>
                    Открыть карточку клиента
                  </Text>
                  <Ionicons name="chevron-forward" size={15} color={palette.text.tertiary} />
                </Pressable>
              ) : null}

              {req.status === 'pending' ? (
                <View style={styles.actionsRow}>
                  <Pressable
                    onPress={() => openReject(req)}
                    disabled={busyId === req.id}
                    style={[styles.rejectBtn, { borderColor: palette.border.strong }]}
                  >
                    <Ionicons name="close" size={16} color={colors.red[600]} />
                    <Text style={[styles.rejectBtnText, { color: colors.red[600] }]}>Отклонить</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => openApprove(req)}
                    disabled={busyId === req.id}
                    style={[styles.approveBtn, { backgroundColor: palette.accent.primary }]}
                  >
                    {busyId === req.id ? (
                      <ActivityIndicator size="small" color={colors.white} />
                    ) : (
                      <>
                        <Ionicons name="checkmark" size={16} color={colors.white} />
                        <Text style={styles.approveBtnText}>Принять</Text>
                      </>
                    )}
                  </Pressable>
                </View>
              ) : null}
            </View>
          ))
        )}
      </ScrollView>

      {/* Approve — trial sheet */}
      <Modal
        visible={!!approving}
        transparent
        statusBarTranslucent
        animationType="slide"
        onRequestClose={() => setApproving(null)}
      >
        <View style={styles.sheetBackdrop}>
          <View style={[styles.sheet, { backgroundColor: palette.bg.canvas }]}>
            <View style={[styles.sheetHandleRow, { borderBottomColor: palette.border.subtle }]}>
              <Pressable onPress={() => setApproving(null)} hitSlop={8}>
                <Text style={[styles.sheetCancel, { color: palette.text.secondary }]}>Отмена</Text>
              </Pressable>
              <Text style={[styles.sheetTitle, { color: palette.text.primary }]}>Принять заявку</Text>
              <Pressable onPress={submitApprove} disabled={busy} hitSlop={8}>
                {busy ? (
                  <ActivityIndicator size="small" color={palette.accent.primary} />
                ) : (
                  <Text style={[styles.sheetSave, { color: palette.accent.primary }]}>Принять</Text>
                )}
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={styles.sheetScroll}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {approving ? (
                <View style={[styles.recap, surface.cardCompact]}>
                  <Text style={[styles.recapCompany, { color: palette.text.primary }]} numberOfLines={1}>
                    {approving.companyName}
                  </Text>
                  <Text style={[styles.recapOwner, { color: palette.text.tertiary }]} numberOfLines={1}>
                    {approving.ownerName} · {formatPhone(approving.phone)}
                  </Text>
                </View>
              ) : null}

              <Text style={[styles.fieldLabel, { color: palette.text.tertiary }]}>Пробный период</Text>
              <View style={styles.segmented}>
                {(['days', 'until'] as const).map((m) => {
                  const on = trialMode === m;
                  return (
                    <Pressable
                      key={m}
                      onPress={() => {
                        haptic('select');
                        setTrialMode(m);
                      }}
                      style={[
                        styles.segment,
                        {
                          backgroundColor: on ? palette.accent.primary : palette.bg.card,
                          borderColor: on ? palette.accent.primary : palette.border.subtle,
                        },
                      ]}
                    >
                      <Ionicons
                        name={m === 'days' ? 'hourglass-outline' : 'calendar-outline'}
                        size={16}
                        color={on ? colors.white : palette.text.secondary}
                      />
                      <Text style={[styles.segmentText, { color: on ? colors.white : palette.text.secondary }]}>
                        {m === 'days' ? 'Дней' : 'До даты'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {trialMode === 'days' ? (
                <>
                  <View style={styles.presetRow}>
                    {TRIAL_PRESETS.map((p) => {
                      const on = Math.round(Number(trialDays)) === p.days;
                      return (
                        <Pressable
                          key={p.label}
                          onPress={() => applyTrialPreset(p.days)}
                          style={[
                            styles.presetChip,
                            {
                              backgroundColor: on ? palette.accent.primarySoft : palette.bg.card,
                              borderColor: on ? palette.accent.primary : palette.border.subtle,
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.presetChipText,
                              { color: on ? palette.accent.primaryText : palette.text.secondary },
                            ]}
                          >
                            {p.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text style={[styles.fieldLabel, { color: palette.text.tertiary }]}>Количество дней</Text>
                  <View style={[styles.inputWrap, surface.cardCompact]}>
                    <TextInput
                      style={[styles.sheetInput, styles.daysInput, { color: palette.text.primary }]}
                      placeholder="14"
                      placeholderTextColor={palette.text.tertiary}
                      keyboardType="number-pad"
                      value={trialDays}
                      onChangeText={(v) => setTrialDays(v.replace(/[^0-9]/g, ''))}
                    />
                  </View>
                </>
              ) : (
                <>
                  <Text style={[styles.fieldLabel, { color: palette.text.tertiary }]}>Действует до</Text>
                  <Pressable
                    onPress={() => {
                      haptic('tap');
                      setTrialDatePickerOpen(true);
                    }}
                    style={[styles.dateRow, surface.cardCompact]}
                  >
                    <Ionicons name="calendar-outline" size={18} color={palette.text.secondary} />
                    <Text
                      style={[styles.dateValue, { color: trialUntil ? palette.text.primary : palette.text.tertiary }]}
                    >
                      {trialUntil ? formatFullDate(trialUntil.toISOString()) : 'Выбрать дату'}
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
                  </Pressable>
                </>
              )}

              <View style={styles.hintRow}>
                <Ionicons name="gift-outline" size={15} color={colors.green[600]} />
                <Text style={[styles.hintText, { color: palette.text.secondary }]}>
                  Будет создан автосервис, аккаунт владельца и бесплатный пробный период
                  {resolvedUntil ? ` до ${formatFullDate(resolvedUntil.toISOString())}` : ''}.
                </Text>
              </View>

              <View style={{ height: spacing[8] }} />
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Date picker for the approve sheet (sibling Modal — the proven pattern). */}
      <DateTimePickerModal
        visible={trialDatePickerOpen}
        value={trialUntil ?? new Date(Date.now() + 14 * DAY_MS)}
        mode="date"
        onConfirm={(d) => {
          setTrialUntil(d);
          setTrialDatePickerOpen(false);
        }}
        onCancel={() => setTrialDatePickerOpen(false)}
      />

      {/* Reject — reason modal (cross-platform; Alert.prompt is iOS-only). */}
      <Modal
        visible={!!rejecting}
        transparent
        statusBarTranslucent
        animationType="fade"
        onRequestClose={() => setRejecting(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setRejecting(null)}>
          <Pressable style={[styles.modalCard, { backgroundColor: palette.bg.card }]} onPress={() => {}}>
            <Text style={[styles.modalTitle, { color: palette.text.primary }]}>Отклонить заявку?</Text>
            <Text style={[styles.modalHint, { color: palette.text.secondary }]}>
              {rejecting ? `«${rejecting.companyName}» — ` : ''}автосервис создан не будет. Причина не обязательна.
            </Text>
            <TextInput
              style={[styles.modalInput, { color: palette.text.primary, borderColor: palette.border.subtle }]}
              placeholder="Причина (необязательно)"
              placeholderTextColor={palette.text.tertiary}
              value={rejectReason}
              onChangeText={setRejectReason}
              multiline
              maxLength={200}
            />
            <View style={styles.modalActions}>
              <Pressable style={styles.modalCancel} onPress={() => setRejecting(null)}>
                <Text style={[styles.modalCancelText, { color: palette.text.secondary }]}>Отмена</Text>
              </Pressable>
              <Pressable
                style={[styles.modalConfirm, { backgroundColor: colors.red[600] }]}
                disabled={busy}
                onPress={() =>
                  rejecting && rejectMutation.mutate({ id: rejecting.id, reason: rejectReason.trim() || undefined })
                }
              >
                {busy ? (
                  <ActivityIndicator size="small" color={colors.white} />
                ) : (
                  <Text style={styles.modalConfirmText}>Отклонить</Text>
                )}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  filterRow: { flexDirection: 'row', gap: spacing[2], paddingHorizontal: spacing[4], paddingBottom: spacing[2] },
  filterChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  filterChipText: { fontSize: 13, fontWeight: '700' },
  scroll: { paddingHorizontal: spacing[4], paddingTop: spacing[1], gap: spacing[3] },
  card: { padding: spacing[4], gap: spacing[2] },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  company: { fontSize: 16, fontWeight: '700' },
  owner: { fontSize: 13, marginTop: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  metaText: { fontSize: 13, flex: 1 },
  commentBox: { borderRadius: borderRadius.lg, paddingHorizontal: spacing[3], paddingVertical: spacing[2.5] },
  commentText: { fontSize: 13, lineHeight: 19 },
  openTenantRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingTop: spacing[2.5],
    marginTop: spacing[1],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  openTenantText: { flex: 1, fontSize: 14, fontWeight: '600' },
  actionsRow: { flexDirection: 'row', gap: spacing[2.5], marginTop: spacing[1] },
  rejectBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  rejectBtnText: { fontSize: 14, fontWeight: '700' },
  approveBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.full,
  },
  approveBtnText: { color: colors.white, fontSize: 14, fontWeight: '700' },
  stateBlock: { alignItems: 'center', justifyContent: 'center', paddingTop: spacing[16], gap: spacing[3] },
  stateText: { fontSize: 15, textAlign: 'center', paddingHorizontal: spacing[6] },
  retryBtn: { paddingHorizontal: spacing[5], paddingVertical: spacing[2.5], borderRadius: borderRadius.full },
  retryText: { fontSize: 14, fontWeight: '700' },
  // Approve sheet
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    maxHeight: '92%',
    borderTopLeftRadius: borderRadius['3xl'],
    borderTopRightRadius: borderRadius['3xl'],
    paddingTop: spacing[2],
  },
  sheetHandleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetCancel: { fontSize: 15, fontWeight: '500' },
  sheetTitle: { fontSize: 16, fontWeight: '700' },
  sheetSave: { fontSize: 15, fontWeight: '700' },
  sheetScroll: { padding: spacing[4], gap: spacing[2] },
  recap: { gap: 2, marginBottom: spacing[1] },
  recapCompany: { fontSize: 16, fontWeight: '700' },
  recapOwner: { fontSize: 13 },
  fieldLabel: { fontSize: 12, fontWeight: '600', marginLeft: spacing[1], marginTop: spacing[2] },
  segmented: { flexDirection: 'row', gap: spacing[2] },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  segmentText: { fontSize: 15, fontWeight: '700' },
  presetRow: { flexDirection: 'row', gap: spacing[2], marginTop: spacing[2] },
  presetChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  presetChipText: { fontSize: 13, fontWeight: '600' },
  inputWrap: { paddingHorizontal: spacing[3] },
  sheetInput: { fontSize: 16, paddingVertical: spacing[3] },
  daysInput: { fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3.5],
    marginTop: spacing[2],
  },
  dateValue: { flex: 1, fontSize: 16, fontWeight: '600' },
  hintRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2], marginTop: spacing[3] },
  hintText: { flex: 1, fontSize: 13, lineHeight: 18 },
  // Reject modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[6],
  },
  modalCard: {
    width: '100%',
    borderRadius: borderRadius['2xl'],
    padding: spacing[5],
    gap: spacing[3],
    ...Platform.select({
      ios: { shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 24 },
      android: { elevation: 12 },
    }),
  },
  modalTitle: { fontSize: 17, fontWeight: '700' },
  modalHint: { fontSize: 13, lineHeight: 19 },
  modalInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    fontSize: 16,
    minHeight: 72,
    textAlignVertical: 'top',
  },
  modalActions: { flexDirection: 'row', gap: spacing[3], marginTop: spacing[1] },
  modalCancel: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing[3] },
  modalCancelText: { fontSize: 15, fontWeight: '600' },
  modalConfirm: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[3],
    borderRadius: borderRadius.xl,
  },
  modalConfirmText: { color: colors.white, fontSize: 15, fontWeight: '700' },
});
