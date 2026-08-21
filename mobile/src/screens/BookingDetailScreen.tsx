/**
 * BookingDetailScreen — карточка записи + действия.
 *
 * Действия (docs/ONLINE_BOOKING_DESIGN.md §5–6):
 *   • «Подтвердить приход» — навигация в CheckCreate с префиллом
 *     { bookingId, prefillClientId, prefillCarId, prefillMasterId,
 *       prefillComment }. После УСПЕШНОГО сохранения чека CheckCreate сам
 *       зовёт bookingsApi.convert(bookingId, checkId) (param-gated, см.
 *       CheckCreateScreen). Тут — только запуск потока.
 *   • «Перенести» — PATCH scheduledAt через DateTimePickerModal (дата+время).
 *   • «Отменить» — POST /cancel. Мастер отменяет ТОЛЬКО свою (сервер
 *     проверяет; UI прячет кнопку для чужой). Админ/владелец — любую.
 *
 * Данных getById у API нет — деталь читаем из кэша списков
 * ['bookings','upcoming'|'past'] (список уже persistent-cached). Если записи
 * там нет (диплинк/cold-start) — добираем list() и ищем по id.
 *
 * Android-safe: пикер кроссплатформенный, никаких iOS-only API.
 */
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import IosScreenHeader from '../components/IosScreenHeader';
import QueryErrorState from '../components/QueryErrorState';
import { ListSkeleton } from '../components/Skeleton';
import ConfirmDialog from '../components/ConfirmDialog';
import DateTimePickerModal from '../components/DateTimePickerModal';
import Modal from '../components/Modal';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import { bookingsApi } from '../api/services';
import { haptic } from '../platform/haptics';
import { iosSectionLabel } from '../platform/iosSurface';
import { colors, borderRadius, spacing, softTint } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { UserRole, type Booking } from '../../../shared/types';
import { formatPhone } from '../../../shared/validation/phone';
import { statusChip, formatBookingDateTime, masterLabel, isActiveBooking } from './bookings/bookingHelpers';

export default function BookingDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const queryClient = useQueryClient();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const { user, isRole } = useAuth();
  const bookingId: string = route.params?.id;

  const isOwnerClass = isRole(UserRole.SUPERADMIN, UserRole.DIRECTOR, UserRole.ADMIN);

  const [showReschedule, setShowReschedule] = useState(false);
  const [rescheduleStep, setRescheduleStep] = useState<'date' | 'time' | null>(null);
  const [rescheduleDraft, setRescheduleDraft] = useState<Date | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [commentModalOpen, setCommentModalOpen] = useState(false);
  const [commentDraft, setCommentDraft] = useState('');

  // Поиск записи в кэше обоих списков (без сети, если данные уже есть). Это
  // initialData реактивного запроса ниже, чтобы экран открывался мгновенно.
  const findInCache = useCallback((): Booking | undefined => {
    for (const scope of ['upcoming', 'past'] as const) {
      const list = queryClient.getQueryData<Booking[]>(['bookings', scope]);
      const found = list?.find((b) => b.id === bookingId);
      if (found) return found;
    }
    return undefined;
  }, [queryClient, bookingId]);

  // Реактивный единый источник: запрос всегда активен, но при наличии записи в
  // кэше списков — initialData отдаёт её сразу (без спиннера). После reschedule/
  // cancel мы инвалидируем этот ключ → он рефетчит списки и заново находит
  // запись, поэтому hero-дата обновляется (в отличие от не-реактивного
  // getQueryData в useMemo, который держал бы устаревший объект).
  const {
    data: booking,
    isError,
    refetch,
  } = useQuery<Booking | null>({
    queryKey: ['booking-detail', bookingId],
    queryFn: async () => {
      const [upcoming, past] = await Promise.all([
        bookingsApi.list({ scope: 'upcoming' }),
        bookingsApi.list({ scope: 'past' }),
      ]);
      // Попутно освежим кэш списков, чтобы экран был консистентен со списком.
      queryClient.setQueryData(['bookings', 'upcoming'], upcoming.data);
      queryClient.setQueryData(['bookings', 'past'], past.data);
      return [...upcoming.data, ...past.data].find((b) => b.id === bookingId) ?? null;
    },
    initialData: () => findInCache(),
    // Если запись была в кэше — не дёргаем сеть на маунте (initialData свежий
    // из списка). Принудительный рефетч — только после мутаций (invalidate).
    initialDataUpdatedAt: () => (findInCache() ? Date.now() : 0),
    staleTime: 30_000,
  });

  // ── Mutations ────────────────────────────────────────────────────────────
  const cancelMutation = useMutation({
    mutationFn: () => bookingsApi.cancel(bookingId),
    onSuccess: async () => {
      haptic('success');
      await queryClient.invalidateQueries({ queryKey: ['bookings'] });
      await queryClient.invalidateQueries({ queryKey: ['booking-detail', bookingId] });
      navigation.goBack();
    },
    onError: (err: any) => {
      haptic('error');
      // Сервер сам не даст мастеру отменить чужую запись (403) — отражаем.
      const msg =
        err?.response?.status === 403
          ? 'Отменить эту запись может только её мастер или администратор.'
          : 'Не удалось отменить запись. Проверьте подключение.';
      Alert.alert('Ошибка', msg);
    },
  });

  const rescheduleMutation = useMutation({
    mutationFn: (iso: string) => bookingsApi.update(bookingId, { scheduledAt: iso }),
    onSuccess: async () => {
      haptic('success');
      await queryClient.invalidateQueries({ queryKey: ['bookings'] });
      await queryClient.invalidateQueries({ queryKey: ['booking-detail', bookingId] });
    },
    onError: (err: any) => {
      haptic('error');
      const msg =
        err?.response?.status === 403
          ? 'Перенести эту запись может только её мастер или администратор.'
          : 'Не удалось перенести запись. Проверьте подключение.';
      Alert.alert('Ошибка', msg);
    },
  });

  // Комментарий записи — тот же PATCH /bookings/:id, что и перенос. Пустая
  // строка очищает комментарий. Текст ошибки бэкенда показываем дословно.
  const commentMutation = useMutation({
    mutationFn: (comment: string) => bookingsApi.update(bookingId, { comment }),
    onSuccess: async () => {
      haptic('success');
      setCommentModalOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['bookings'] });
      await queryClient.invalidateQueries({ queryKey: ['booking-detail', bookingId] });
    },
    onError: (err: any) => {
      haptic('error');
      Alert.alert('Ошибка', err?.response?.data?.message || 'Не удалось сохранить комментарий');
    },
  });

  // ── Permissions (отражаем серверную проверку) ────────────────────────────
  // Мастер может отменить/перенести ТОЛЬКО свою запись; админ/владелец — любую.
  const isOwnBooking = !!booking?.masterId && booking.masterId === user?.id;
  const canMutate = isOwnerClass || isOwnBooking;
  const active = booking ? isActiveBooking(booking.status) : false;
  // Сервер принимает PATCH только для status='scheduled' (НЕ isActiveBooking).
  const canEditComment = canMutate && booking?.status === 'scheduled';

  // «Подтвердить приход» → CheckCreate с префиллом. CheckCreate после успешного
  // сохранения чека сам вызовет convert(bookingId, checkId).
  const handleConfirmArrival = () => {
    if (!booking) return;
    haptic('impact');
    navigation.navigate('CheckCreate', {
      bookingId: booking.id,
      prefillClientId: booking.clientId,
      prefillCarId: booking.carId || undefined,
      prefillMasterId: booking.masterId || undefined,
      prefillComment: booking.comment || undefined,
    });
  };

  const startReschedule = () => {
    if (!booking) return;
    haptic('tap');
    setRescheduleDraft(new Date(booking.scheduledAt));
    setRescheduleStep('date');
    setShowReschedule(true);
  };

  const openCommentEditor = () => {
    if (!booking) return;
    haptic('select');
    setCommentDraft(booking.comment ?? '');
    setCommentModalOpen(true);
  };

  // ── States ─────────────────────────────────────────────────────────────
  // booking === undefined ⇒ кэш-промах и запрос ещё не завершился. С данными
  // (даже null) сразу идём дальше — SWR держит контент во время рефетча.
  if (booking === undefined) {
    if (isError) {
      return (
        <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
          <IosScreenHeader title="Запись" onBack={() => navigation.goBack()} />
          <QueryErrorState
            title="Не удалось загрузить запись"
            description="Проверьте подключение к интернету и попробуйте ещё раз"
            onRetry={() => refetch()}
          />
        </View>
      );
    }
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Запись" onBack={() => navigation.goBack()} />
        <ListSkeleton count={3} />
      </View>
    );
  }

  // Запись могла быть удалена/не найдена.
  if (booking === null || !booking) {
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Запись" onBack={() => navigation.goBack()} />
        <QueryErrorState
          title="Запись не найдена"
          description="Возможно, она была удалена"
          onRetry={() => navigation.goBack()}
        />
      </View>
    );
  }

  const chip = statusChip(booking.status);

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Запись" onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: tabBarHeight + spacing[8] }]}
        contentInset={{ bottom: tabBarHeight }}
        scrollIndicatorInsets={{ bottom: tabBarHeight }}
      >
        {/* ── Status + datetime hero ── */}
        <View style={[styles.hero, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
          <View style={[styles.statusChip, { backgroundColor: chip.bg }]}>
            <Text style={[styles.statusChipText, { color: chip.text }]}>{chip.label}</Text>
          </View>
          <Text style={[styles.heroDate, { color: palette.text.primary }]}>
            {formatBookingDateTime(booking.scheduledAt)}
          </Text>
          {rescheduleMutation.isPending ? (
            <Text style={[styles.heroSaving, { color: palette.text.tertiary }]}>Сохраняю перенос…</Text>
          ) : null}
        </View>

        {/* ── Client ── */}
        <Text style={[iosSectionLabel, styles.sectionLabel, { color: palette.text.secondary }]}>КЛИЕНТ</Text>
        <View style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
          <View style={styles.cardRow}>
            <View style={[styles.avatar, palette.mode === 'dark' && { backgroundColor: palette.accent.primarySoft }]}>
              <Ionicons
                name="person"
                size={18}
                color={palette.mode === 'dark' ? palette.accent.primaryText : colors.primary[700]}
              />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={[styles.cardTitle, { color: palette.text.primary }]} numberOfLines={1}>
                {booking.clientName || 'Клиент'}
              </Text>
              {booking.clientPhone ? (
                <Text style={[styles.cardSub, { color: palette.text.tertiary }]} numberOfLines={1}>
                  {formatPhone(booking.clientPhone)}
                </Text>
              ) : null}
            </View>
          </View>
          {booking.carPlate || booking.carMakeModel ? (
            <View style={[styles.cardDivided, { borderTopColor: palette.border.subtle }]}>
              <Ionicons name="car-outline" size={16} color={palette.text.secondary} />
              {booking.carPlate ? (
                <View style={[styles.plateChip, { borderColor: palette.border.subtle }]}>
                  <Text style={[styles.plateChipText, { color: palette.text.primary }]}>{booking.carPlate}</Text>
                </View>
              ) : null}
              <Text style={[styles.cardSub, { color: palette.text.secondary, flex: 1 }]} numberOfLines={1}>
                {booking.carMakeModel || '—'}
              </Text>
            </View>
          ) : null}
        </View>

        {/* ── Master ── */}
        <Text style={[iosSectionLabel, styles.sectionLabel, { color: palette.text.secondary }]}>МАСТЕР</Text>
        <View style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
          <View style={styles.cardRow}>
            <Ionicons name="person-circle-outline" size={20} color={palette.text.secondary} />
            <Text
              style={[styles.cardTitle, { color: booking.masterId ? palette.text.primary : palette.text.tertiary }]}
              numberOfLines={1}
            >
              {masterLabel(booking)}
            </Text>
          </View>
        </View>

        {/* ── Comment ── */}
        {booking.comment ? (
          <>
            <View style={styles.commentLabelRow}>
              <Text style={[iosSectionLabel, styles.commentLabelInRow, { color: palette.text.secondary }]}>
                КОММЕНТАРИЙ
              </Text>
              {canEditComment ? (
                <TouchableOpacity
                  onPress={openCommentEditor}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  accessibilityRole="button"
                  accessibilityLabel="Изменить комментарий"
                >
                  <Ionicons name="pencil" size={16} color={colors.primary[600]} />
                </TouchableOpacity>
              ) : null}
            </View>
            <View style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
              <Text style={[styles.commentText, { color: palette.text.primary }]}>{booking.comment}</Text>
            </View>
          </>
        ) : canEditComment ? (
          <>
            <Text style={[iosSectionLabel, styles.sectionLabel, { color: palette.text.secondary }]}>КОММЕНТАРИЙ</Text>
            <TouchableOpacity
              style={[styles.addCommentCard, { borderColor: palette.border.strong }]}
              onPress={openCommentEditor}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Добавить комментарий"
            >
              <Ionicons name="add-circle-outline" size={18} color={palette.text.secondary} />
              <Text style={[styles.addCommentText, { color: palette.text.secondary }]}>Добавить комментарий</Text>
            </TouchableOpacity>
          </>
        ) : null}

        {/* ── Linked check (converted) ── */}
        {booking.checkId ? (
          <TouchableOpacity
            style={[
              styles.checkCard,
              palette.mode === 'dark'
                ? { backgroundColor: palette.accent.primarySoft, borderColor: palette.border.strong }
                : { backgroundColor: colors.primary[50], borderColor: colors.primary[100] },
            ]}
            onPress={() => navigation.navigate('CheckDetail', { id: booking.checkId })}
            activeOpacity={0.8}
          >
            <Ionicons
              name="receipt-outline"
              size={20}
              color={palette.mode === 'dark' ? palette.accent.primaryText : colors.primary[700]}
            />
            <View style={{ flex: 1 }}>
              <Text style={[styles.checkCardTitle, palette.mode === 'dark' && { color: palette.accent.primaryText }]}>
                {booking.checkNumber != null ? `Чек №${booking.checkNumber}` : 'Связанный чек'}
              </Text>
              <Text style={[styles.checkCardSub, palette.mode === 'dark' && { color: palette.accent.primaryText }]}>
                Запись проведена в кассе
              </Text>
            </View>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={palette.mode === 'dark' ? palette.accent.primaryText : colors.primary[600]}
            />
          </TouchableOpacity>
        ) : null}

        {/* ── Actions ── */}
        {active ? (
          <View style={styles.actions}>
            {/* Главное действие — приход → касса. */}
            <TouchableOpacity
              style={[styles.primaryAction, { backgroundColor: colors.primary[600] }]}
              onPress={handleConfirmArrival}
              activeOpacity={0.85}
            >
              <Ionicons name="enter-outline" size={20} color={colors.white} />
              <Text style={styles.primaryActionText}>Подтвердить приход</Text>
            </TouchableOpacity>
            <Text style={[styles.primaryActionHint, { color: palette.text.tertiary }]}>
              Откроется касса с подставленным клиентом — добавьте услуги и сохраните чек
            </Text>

            {canMutate ? (
              <View style={styles.secondaryRow}>
                <TouchableOpacity
                  style={[
                    styles.secondaryBtn,
                    { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
                  ]}
                  onPress={startReschedule}
                  activeOpacity={0.8}
                >
                  <Ionicons name="calendar-outline" size={17} color={palette.text.primary} />
                  <Text style={[styles.secondaryBtnText, { color: palette.text.primary }]}>Перенести</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.secondaryBtn, { backgroundColor: palette.bg.card, borderColor: colors.red[200] }]}
                  onPress={() => {
                    haptic('tap');
                    setConfirmCancel(true);
                  }}
                  activeOpacity={0.8}
                >
                  <Ionicons name="close-circle-outline" size={17} color={colors.red[600]} />
                  <Text style={[styles.secondaryBtnText, { color: colors.red[600] }]}>Отменить</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <Text style={[styles.noPermHint, { color: palette.text.tertiary }]}>
                Перенести или отменить эту запись может только её мастер или администратор
              </Text>
            )}
          </View>
        ) : null}
      </ScrollView>

      {/* ── Reschedule: date → time → PATCH ── */}
      <DateTimePickerModal
        visible={showReschedule && rescheduleStep === 'date'}
        value={rescheduleDraft || new Date(booking.scheduledAt)}
        mode="date"
        onConfirm={(d) => {
          const base = rescheduleDraft || new Date(booking.scheduledAt);
          const next = new Date(base);
          next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
          setRescheduleDraft(next);
          setRescheduleStep('time');
        }}
        onCancel={() => {
          setShowReschedule(false);
          setRescheduleStep(null);
        }}
      />
      <DateTimePickerModal
        visible={showReschedule && rescheduleStep === 'time'}
        value={rescheduleDraft || new Date(booking.scheduledAt)}
        mode="time"
        onConfirm={(d) => {
          const base = rescheduleDraft || new Date(booking.scheduledAt);
          const next = new Date(base);
          next.setHours(d.getHours(), d.getMinutes(), 0, 0);
          setShowReschedule(false);
          setRescheduleStep(null);
          setRescheduleDraft(null);
          rescheduleMutation.mutate(next.toISOString());
        }}
        onCancel={() => {
          setShowReschedule(false);
          setRescheduleStep(null);
        }}
      />

      {/* ── Cancel confirm ── */}
      <ConfirmDialog
        visible={confirmCancel}
        title="Отменить запись?"
        message={
          cancelMutation.isPending ? 'Отменяю…' : 'Запись будет отменена. Клиент не будет ожидаться в это время.'
        }
        confirmText="Отменить запись"
        variant="danger"
        onClose={() => setConfirmCancel(false)}
        onConfirm={() => {
          setConfirmCancel(false);
          cancelMutation.mutate();
        }}
      />

      {/* ── Comment editor (паттерн CheckDetailScreen) ── */}
      <Modal visible={commentModalOpen} onClose={() => setCommentModalOpen(false)} title="Комментарий к записи">
        <TextInput
          value={commentDraft}
          onChangeText={setCommentDraft}
          style={[
            styles.commentInput,
            { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
          ]}
          multiline
          maxLength={2000}
          autoFocus
          placeholder="Например: установка ГБО, ТО, диагностика…"
          placeholderTextColor={palette.text.tertiary}
        />
        <View style={[styles.commentActions, { borderTopColor: palette.border.subtle }]}>
          <TouchableOpacity
            style={[styles.commentCancelBtn, { borderColor: palette.border.strong }]}
            onPress={() => setCommentModalOpen(false)}
            disabled={commentMutation.isPending}
          >
            <Text style={[styles.commentCancelBtnText, { color: palette.text.secondary }]}>Отмена</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.commentSaveBtn}
            onPress={() => {
              if (commentMutation.isPending) return;
              commentMutation.mutate(commentDraft.trim());
            }}
            activeOpacity={0.85}
            disabled={commentMutation.isPending}
          >
            {commentMutation.isPending ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={styles.commentSaveBtnText}>Сохранить</Text>
            )}
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Перекрывающий лоадер при отмене — короткий, на весь экран не нужен. */}
      {cancelMutation.isPending ? (
        <View style={styles.busyOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color={colors.primary[600]} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: spacing[4], paddingTop: spacing[1] },

  sectionLabel: { marginLeft: spacing[1], marginTop: spacing[4], marginBottom: spacing[2] },

  hero: {
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing[4],
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[2],
  },
  statusChip: { paddingHorizontal: spacing[2.5], paddingVertical: 3, borderRadius: borderRadius.full },
  statusChipText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.2 },
  heroDate: { fontSize: 22, fontWeight: '700', letterSpacing: -0.4 },
  heroSaving: { fontSize: 12 },

  card: {
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing[3.5],
    gap: spacing[2.5],
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { fontSize: 15, fontWeight: '600', letterSpacing: -0.1, flex: 1 },
  cardSub: { fontSize: 13, marginTop: 1 },
  cardDivided: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: spacing[2.5],
  },
  plateChip: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: borderRadius.sm,
    borderWidth: StyleSheet.hairlineWidth,
  },
  plateChipText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3 },
  commentText: { fontSize: 15, lineHeight: 21 },

  // Comment: editable header + placeholder + editor modal
  commentLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing[4],
    marginBottom: spacing[2],
  },
  commentLabelInRow: { marginLeft: spacing[1] },
  addCommentCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3.5],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderStyle: 'dashed',
  },
  addCommentText: { fontSize: 14, fontWeight: '600' },
  // Геометрия поля — как commentInput в BookingCreateScreen.
  commentInput: {
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing[3.5],
    minHeight: 90,
    fontSize: 15,
    textAlignVertical: 'top',
    marginBottom: spacing[3],
  },
  commentActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[3],
    paddingTop: spacing[4],
    borderTopWidth: 1,
  },
  commentCancelBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },
  commentCancelBtnText: { fontSize: 14, fontWeight: '500' },
  commentSaveBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primary[600],
    minWidth: 132,
    alignItems: 'center',
    justifyContent: 'center',
  },
  commentSaveBtnText: { fontSize: 14, fontWeight: '600', color: colors.white },

  checkCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginTop: spacing[4],
    padding: spacing[3.5],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
  },
  checkCardTitle: { fontSize: 15, fontWeight: '700', color: colors.primary[800], letterSpacing: -0.2 },
  checkCardSub: { fontSize: 12, color: colors.primary[600], marginTop: 1 },

  actions: { marginTop: spacing[6], gap: spacing[2] },
  primaryAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[4],
    borderRadius: borderRadius.xl,
  },
  primaryActionText: { fontSize: 16, fontWeight: '700', color: colors.white, letterSpacing: -0.2 },
  primaryActionHint: { fontSize: 12, textAlign: 'center', paddingHorizontal: spacing[4], lineHeight: 16 },

  secondaryRow: { flexDirection: 'row', gap: spacing[3], marginTop: spacing[3] },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3.5],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  secondaryBtnText: { fontSize: 14, fontWeight: '600' },
  noPermHint: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: spacing[3],
    paddingHorizontal: spacing[4],
    lineHeight: 16,
  },

  busyOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.04)',
  },
});
