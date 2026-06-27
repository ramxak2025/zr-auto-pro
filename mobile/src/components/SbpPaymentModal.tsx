/**
 * SbpPaymentModal — приём оплаты по СБП / QR на экране кассы (эквайринг).
 *
 * ДОБАВОЧНЫЙ модуль: НЕ трогает существующую математику чека
 * (нал / карта / смешанная / отложенный). По нажатию «Оплата по СБП / QR» в
 * секции оплаты родитель (`CheckCreateScreen`) открывает эту модалку с суммой
 * «К оплате». Модалка:
 *   1. создаёт онлайн-платёж: paymentsApi.create({ amount, method: 'sbp', checkId? });
 *   2. показывает платёжную ссылку СБП (qr-пейлоад nspk.ru / confirmationUrl) +
 *      кнопку «Открыть в приложении банка» (Linking);
 *   3. опрашивает статус paymentsApi.get(id) каждые ~3с (до ~2 мин) + ручная
 *      кнопка «Проверить оплату»;
 *   4. при status='succeeded' зовёт onSucceeded() — родитель проводит чек по
 *      существующему КАРТОЧНОМУ (электронному) тендеру. СБП — электронные
 *      деньги, поэтому маппится на существующий 'card'; новых tender-колонок
 *      не вводим.
 *
 * 422 от /payments/create → «Эквайринг не подключён» (владелец ещё не ввёл
 * ключи ЮKassa и/или не включил приём оплат). Модуль инертен до настройки.
 *
 * QR-картинку НЕ рисуем сторонней либой — её нет в зависимостях, а собственный
 * энкодер платёжного QR без возможности проверить сканером — риск для денег.
 * По правилу задачи показываем сам пейлоад + ссылку-фолбэк: ссылка СБП
 * (nspk.ru) открывается приложением банка напрямую.
 *
 * Презентация + сетевой цикл инкапсулированы здесь; состояние выбора способа
 * оплаты и проведение чека остаются у родителя. Android-совместимо (RNModal +
 * ModalBlurBackdrop + Linking — без iOS-only API).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal as RNModal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Linking,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ModalBlurBackdrop from './ModalBlurBackdrop';
import { useColors } from '../contexts/ThemeContext';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { haptic } from '../platform/haptics';
import { paymentsApi } from '../api/services';
import type { Payment } from '../../../shared/types';

const POLL_INTERVAL_MS = 3000;
const POLL_CAP_MS = 120000; // ~2 минуты авто-опроса, дальше — только вручную

/** Фаза экрана СБП. Управляет тем, что видит кассир. */
type Phase = 'creating' | 'awaiting' | 'succeeded' | 'canceled' | 'expired' | 'not_configured' | 'error';

interface SbpPaymentModalProps {
  visible: boolean;
  /** Сумма к оплате (= «К оплате» чека). */
  amount: number;
  /** Привязка к заказ-наряду, если он уже существует (режим редактирования). */
  checkId?: string;
  onClose: () => void;
  /** Оплата подтверждена СБП — родитель проводит чек по карточному тендеру. */
  onSucceeded: () => void;
}

function formatMoney(v: number): string {
  return (
    Math.round(v)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
  );
}

export default function SbpPaymentModal({ visible, amount, checkId, onClose, onSucceeded }: SbpPaymentModalProps) {
  const palette = useColors();

  const [phase, setPhase] = useState<Phase>('creating');
  const [payment, setPayment] = useState<Payment | null>(null);
  const [errorText, setErrorText] = useState('');
  const [checking, setChecking] = useState(false);

  // Всё мутабельное держим в ref'ах, чтобы setInterval-тик и асинхронные
  // колбэки всегда видели свежие значения без пере-подписки таймера.
  const paymentIdRef = useRef<string | null>(null);
  const startedAtRef = useRef(0);
  const succeededFiredRef = useRef(false);
  const visibleRef = useRef(visible);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tickRef = useRef<() => void>(() => {});
  const onSucceededRef = useRef(onSucceeded);
  const amountRef = useRef(amount);
  const checkIdRef = useRef(checkId);
  visibleRef.current = visible;
  onSucceededRef.current = onSucceeded;
  amountRef.current = amount;
  checkIdRef.current = checkId;

  const stopPoll = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const clearSuccessTimer = useCallback(() => {
    if (successTimerRef.current) {
      clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
  }, []);

  // Успех: фиксируем один раз, гасим таймеры, лёгкая пауза для галочки, затем
  // отдаём управление родителю (он проведёт чек по карточному тендеру).
  const handleSucceeded = useCallback(() => {
    if (succeededFiredRef.current) return;
    succeededFiredRef.current = true;
    stopPoll();
    setPhase('succeeded');
    haptic('success');
    clearSuccessTimer();
    successTimerRef.current = setTimeout(() => {
      if (visibleRef.current) onSucceededRef.current();
    }, 700);
  }, [stopPoll, clearSuccessTimer]);

  // Один опрос статуса. `manual=true` — нажата кнопка «Проверить оплату».
  const pollOnce = useCallback(
    async (manual: boolean) => {
      const id = paymentIdRef.current;
      if (!id) return;
      if (manual) {
        haptic('tap');
        setChecking(true);
      }
      try {
        const res = await paymentsApi.get(id);
        if (!visibleRef.current) return;
        const p = res.data;
        setPayment(p);
        if (p.status === 'succeeded') {
          handleSucceeded();
          return;
        }
        if (p.status === 'canceled') {
          stopPoll();
          setPhase('canceled');
          return;
        }
        // всё ещё pending — проверяем потолок авто-опроса
        if (Date.now() - startedAtRef.current > POLL_CAP_MS) {
          stopPoll();
          setPhase('expired');
        }
      } catch {
        // транзиентная сеть — молча продолжаем опрос (не пугаем кассира)
      } finally {
        if (manual) setChecking(false);
      }
    },
    [handleSucceeded, stopPoll],
  );

  // Тик всегда вызывает свежий pollOnce.
  tickRef.current = () => {
    void pollOnce(false);
  };

  const startPoll = useCallback(() => {
    stopPoll();
    startedAtRef.current = Date.now();
    pollTimerRef.current = setInterval(() => tickRef.current(), POLL_INTERVAL_MS);
  }, [stopPoll]);

  // Создание платежа. Используется и при открытии, и кнопкой «Повторить».
  const createPayment = useCallback(() => {
    stopPoll();
    clearSuccessTimer();
    succeededFiredRef.current = false;
    paymentIdRef.current = null;
    setPayment(null);
    setErrorText('');
    setChecking(false);
    setPhase('creating');
    paymentsApi
      .create({ amount: amountRef.current, method: 'sbp', checkId: checkIdRef.current })
      .then((res) => {
        if (!visibleRef.current) return;
        const p = res.data;
        setPayment(p);
        paymentIdRef.current = p.id;
        if (p.status === 'succeeded') {
          handleSucceeded();
          return;
        }
        if (p.status === 'canceled') {
          setPhase('canceled');
          return;
        }
        setPhase('awaiting');
        startPoll();
      })
      .catch((err: { response?: { status?: number; data?: { message?: string; error?: string } } }) => {
        if (!visibleRef.current) return;
        const status = err?.response?.status;
        if (status === 422) {
          setPhase('not_configured');
          return;
        }
        const data = err?.response?.data;
        setErrorText(data?.message || data?.error || 'Не удалось создать платёж. Попробуйте ещё раз.');
        setPhase('error');
      });
  }, [stopPoll, clearSuccessTimer, handleSucceeded, startPoll]);

  // Жизненный цикл: создаём платёж при открытии, всё гасим при закрытии.
  useEffect(() => {
    if (visible) {
      createPayment();
    }
    return () => {
      stopPoll();
      clearSuccessTimer();
    };
  }, [visible, createPayment, stopPoll, clearSuccessTimer]);

  const openLink = useCallback(async () => {
    const url = payment?.confirmationUrl || payment?.qr;
    if (!url) return;
    haptic('tap');
    try {
      const ok = await Linking.canOpenURL(url);
      if (!ok) throw new Error('cannot open');
      await Linking.openURL(url);
    } catch {
      Alert.alert('Не удалось открыть ссылку', 'Скопируйте ссылку СБП и откройте её в приложении банка вручную.');
    }
  }, [payment]);

  const sbpPayload = payment?.qr || payment?.confirmationUrl || '';

  return (
    <RNModal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <ModalBlurBackdrop onPress={onClose} />
        <View style={[styles.card, { backgroundColor: palette.bg.elevated }]}>
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <Ionicons name="qr-code-outline" size={18} color={colors.purple[600]} />
              <Text style={[styles.title, { color: palette.text.primary }]}>Оплата по СБП</Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={[styles.closeBtn, { backgroundColor: palette.bg.muted }]}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityLabel="Закрыть"
            >
              <Ionicons name="close" size={18} color={palette.text.tertiary} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={{ maxHeight: 460 }}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
          >
            {/* Сумма к оплате — общий контекст для всех фаз, кроме ошибок настройки. */}
            {phase !== 'not_configured' && phase !== 'error' && (
              <View style={styles.amountWrap}>
                <Text style={[styles.amountHint, { color: palette.text.tertiary }]}>К оплате по СБП</Text>
                <Text style={[styles.amountValue, { color: palette.text.primary }]}>{formatMoney(amount)}</Text>
              </View>
            )}

            {phase === 'creating' && (
              <View style={styles.centerBlock}>
                <ActivityIndicator color={colors.purple[600]} />
                <Text style={[styles.centerText, { color: palette.text.secondary }]}>Создаём счёт для оплаты…</Text>
              </View>
            )}

            {phase === 'not_configured' && (
              <View style={styles.centerBlock}>
                <View style={[styles.statusIcon, { backgroundColor: colors.amber[50] }]}>
                  <Ionicons name="alert-circle-outline" size={30} color={colors.amber[600]} />
                </View>
                <Text style={[styles.centerTitle, { color: palette.text.primary }]}>Эквайринг не подключён</Text>
                <Text style={[styles.centerText, { color: palette.text.secondary }]}>
                  Приём оплаты по СБП ещё не настроен. Владельцу автосервиса нужно подключить эквайринг (ключи ЮKassa) в
                  настройках. Сейчас примите оплату наличными или картой.
                </Text>
                <TouchableOpacity
                  style={[styles.secondaryBtn, { borderColor: palette.border.strong }]}
                  onPress={onClose}
                  accessibilityRole="button"
                >
                  <Text style={[styles.secondaryBtnText, { color: palette.text.primary }]}>Понятно</Text>
                </TouchableOpacity>
              </View>
            )}

            {phase === 'error' && (
              <View style={styles.centerBlock}>
                <View style={[styles.statusIcon, { backgroundColor: colors.rose[50] }]}>
                  <Ionicons name="close-circle-outline" size={30} color={colors.rose[600]} />
                </View>
                <Text style={[styles.centerTitle, { color: palette.text.primary }]}>Не удалось создать платёж</Text>
                <Text style={[styles.centerText, { color: palette.text.secondary }]}>{errorText}</Text>
                <TouchableOpacity
                  style={[styles.primaryBtn, { backgroundColor: colors.purple[600] }]}
                  onPress={createPayment}
                  accessibilityRole="button"
                >
                  <Ionicons name="refresh" size={18} color="#FFFFFF" />
                  <Text style={styles.primaryBtnText}>Повторить</Text>
                </TouchableOpacity>
              </View>
            )}

            {phase === 'awaiting' && (
              <>
                {/* Платёжная ссылка СБП — пейлоад nspk.ru / confirmationUrl. */}
                <View
                  style={[styles.payloadBox, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
                >
                  <Text style={[styles.payloadHint, { color: palette.text.tertiary }]}>Платёжная ссылка СБП</Text>
                  <Text style={[styles.payloadText, { color: palette.text.primary }]} selectable numberOfLines={4}>
                    {sbpPayload || '—'}
                  </Text>
                  <Text style={[styles.payloadNote, { color: palette.text.tertiary }]}>
                    Клиент открывает ссылку в приложении банка или сканирует её как QR.
                  </Text>
                </View>

                {!!(payment?.confirmationUrl || payment?.qr) && (
                  <TouchableOpacity
                    style={[styles.primaryBtn, { backgroundColor: colors.purple[600] }]}
                    onPress={openLink}
                    accessibilityRole="button"
                    accessibilityLabel="Открыть в приложении банка"
                  >
                    <Ionicons name="open-outline" size={18} color="#FFFFFF" />
                    <Text style={styles.primaryBtnText}>Открыть в приложении банка</Text>
                  </TouchableOpacity>
                )}

                <View style={styles.waitRow}>
                  <ActivityIndicator size="small" color={colors.purple[600]} />
                  <Text style={[styles.waitText, { color: palette.text.secondary }]}>
                    Ожидаем подтверждение оплаты…
                  </Text>
                </View>

                <TouchableOpacity
                  style={[styles.secondaryBtn, { borderColor: palette.border.strong }]}
                  onPress={() => pollOnce(true)}
                  disabled={checking}
                  accessibilityRole="button"
                >
                  {checking ? (
                    <ActivityIndicator size="small" color={palette.text.primary} />
                  ) : (
                    <>
                      <Ionicons name="refresh" size={16} color={palette.text.primary} />
                      <Text style={[styles.secondaryBtnText, { color: palette.text.primary }]}>Проверить оплату</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            )}

            {phase === 'succeeded' && (
              <View style={styles.centerBlock}>
                <View style={[styles.statusIcon, { backgroundColor: colors.green[50] }]}>
                  <Ionicons name="checkmark-circle" size={34} color={colors.green[600]} />
                </View>
                <Text style={[styles.centerTitle, { color: colors.green[700] }]}>Оплата получена</Text>
                <Text style={[styles.centerText, { color: palette.text.secondary }]}>Проводим чек…</Text>
              </View>
            )}

            {(phase === 'canceled' || phase === 'expired') && (
              <View style={styles.centerBlock}>
                <View style={[styles.statusIcon, { backgroundColor: palette.bg.muted }]}>
                  <Ionicons
                    name={phase === 'canceled' ? 'close-circle-outline' : 'time-outline'}
                    size={30}
                    color={palette.text.tertiary}
                  />
                </View>
                <Text style={[styles.centerTitle, { color: palette.text.primary }]}>
                  {phase === 'canceled' ? 'Платёж отменён' : 'Истекло время ожидания'}
                </Text>
                <Text style={[styles.centerText, { color: palette.text.secondary }]}>
                  {phase === 'canceled'
                    ? 'Оплата по СБП не была завершена. Создайте новый платёж или примите оплату иначе.'
                    : 'Подтверждение не пришло автоматически. Проверьте оплату вручную или создайте новый платёж.'}
                </Text>
                {phase === 'expired' && (
                  <TouchableOpacity
                    style={[styles.secondaryBtn, { borderColor: palette.border.strong }]}
                    onPress={() => pollOnce(true)}
                    disabled={checking}
                    accessibilityRole="button"
                  >
                    {checking ? (
                      <ActivityIndicator size="small" color={palette.text.primary} />
                    ) : (
                      <>
                        <Ionicons name="refresh" size={16} color={palette.text.primary} />
                        <Text style={[styles.secondaryBtnText, { color: palette.text.primary }]}>Проверить оплату</Text>
                      </>
                    )}
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[styles.primaryBtn, { backgroundColor: colors.purple[600] }]}
                  onPress={createPayment}
                  accessibilityRole="button"
                >
                  <Ionicons name="refresh" size={18} color="#FFFFFF" />
                  <Text style={styles.primaryBtnText}>Новый платёж</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing[5],
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: Platform.OS === 'android' ? 28 : borderRadius['2xl'],
    paddingTop: spacing[4],
    paddingBottom: spacing[4],
    paddingHorizontal: spacing[4],
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 28,
    elevation: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[3],
  },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { gap: spacing[3], paddingBottom: spacing[1] },
  amountWrap: { alignItems: 'center', gap: 2 },
  amountHint: { fontSize: fontSize.xs, letterSpacing: -0.1 },
  amountValue: { fontSize: 28, fontWeight: fontWeight.bold, letterSpacing: -0.5 },
  centerBlock: { alignItems: 'center', gap: spacing[3], paddingVertical: spacing[2] },
  centerTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, textAlign: 'center' },
  centerText: { fontSize: fontSize.sm, textAlign: 'center', lineHeight: 20, paddingHorizontal: spacing[2] },
  statusIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  payloadBox: {
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    padding: spacing[3],
    gap: spacing[2],
  },
  payloadHint: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, letterSpacing: -0.1 },
  payloadText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  payloadNote: { fontSize: fontSize.xs, lineHeight: 16 },
  waitRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[2] },
  waitText: { fontSize: fontSize.sm },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.xl,
  },
  primaryBtnText: { color: '#FFFFFF', fontSize: fontSize.base, fontWeight: fontWeight.bold },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: 1.5,
  },
  secondaryBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
});
