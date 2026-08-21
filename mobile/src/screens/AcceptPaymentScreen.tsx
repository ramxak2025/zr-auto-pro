/**
 * AcceptPaymentScreen — приём оплаты по отложенному заказ-наряду
 * (Round 14, режим «Кассир», CASHIER_MODE_SPEC).
 *
 * ЕДИНЫЙ флоу активации: сюда ведут и тап по карточке в кассирской очереди
 * «Оплата» (CashierPaymentScreen), и кнопка «Принять оплату» в CheckDetail
 * при включённом режиме кассовой смены. Экран живёт на КОРНЕВОМ стеке
 * (slide-up, перекрывает таб-бар — как CheckCreate).
 *
 * Деньги: строки заказа read-only; кассир может дать СКИДКУ (живой пересчёт
 * итога — та же формула, что в Кассе: скидка применяется к ТОВАРАМ, услуги
 * не дисконтируются) и выбрать способ нал / карта / смешанная (в смешанной
 * вводится нал, карта доводится до итога автоматически — паттерн
 * CheckCreateScreen). CTA «Оплачено — N ₽» шлёт единственный PATCH
 * { isDeferred:false, paymentMethod, cashAmount, cardAmount, discount } —
 * активация идёт тем же серверным путём, что обычное закрытие (все
 * пересчёты/гейты сохранены; не-кассиру сервер ответит 403).
 *
 * 155: при праве sell_installment доступен способ «Рассрочка» — первый взнос
 * (0..итог, нал или карта) уходит в cashAmount/cardAmount, остаток — план
 * рассрочки, который сервер создаёт в той же транзакции активации
 * (installment.nextPaymentDate — дата следующего платежа, по умолчанию +30 дн).
 *
 * Android-совместимо: только кросс-платформенные примитивы.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import { checksApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import IosScreenHeader from '../components/IosScreenHeader';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import DateTimePickerModal from '../components/DateTimePickerModal';
import InstallmentSaleFields from '../components/installments/InstallmentSaleFields';
import { toYmd, formatYmdHuman } from '../components/installments/installmentUi';
import { haptic } from '../platform/haptics';
import { buildShadow } from '../platform/iosSurface';
import { colors, fontSize, fontWeight, borderRadius, spacing, softTint } from '../theme';
import { CHECK_MONEY_DEPENDENT_KEYS } from './CheckDetailScreen';
import type { Check, PaymentMethod } from '../../../shared/types';

function formatMoney(v: number) {
  return (
    Math.round(v ?? 0)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
  );
}

/** '1 200' / '1200,50' → number (терпимо к пробелам и запятой). */
function parseMoneyInput(raw: string): number {
  const n = parseFloat(raw.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

type PayMethod = 'cash' | 'card' | 'cash_card' | 'installment';

const METHODS: Array<{ key: PayMethod; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { key: 'cash', label: 'Наличные', icon: 'cash-outline' },
  { key: 'card', label: 'Карта', icon: 'card-outline' },
  { key: 'cash_card', label: 'Смешанная', icon: 'swap-horizontal-outline' },
];

// «Рассрочка» (155) — доп. способ при праве sell_installment: первый взнос
// (может быть 0) уходит в cash/card, остаток — план рассрочки на сервере.
const INSTALLMENT_METHOD: (typeof METHODS)[number] = {
  key: 'installment',
  label: 'Рассрочка',
  icon: 'calendar-outline',
};

export default function AcceptPaymentScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const palette = useColors();
  const isDark = palette.mode === 'dark';
  const { hasPermission } = useAuth();
  const { id } = route.params as { id: string };

  const {
    data: check,
    isLoading,
    isError,
    refetch,
  } = useQuery<Check>({
    queryKey: ['check', id],
    queryFn: async () => (await checksApi.getById(id)).data,
    // Деньги: активация должна считаться от подтверждённой правды сервера.
    refetchOnMount: 'always',
  });

  const [method, setMethod] = useState<PayMethod>('cash');
  const [discount, setDiscount] = useState('');
  const [cashPart, setCashPart] = useState('');
  const discountRef = useRef<TextInput>(null);

  // ── Рассрочка (155) ──────────────────────────────────────────────────
  // Первый взнос (0..total, по умолчанию 0), способ взноса нал/карта и дата
  // следующего платежа (+30 дней по умолчанию — как в Кассе).
  const canSellInstallment = hasPermission('sell_installment');
  const [installmentFirst, setInstallmentFirst] = useState('');
  const [installmentPart, setInstallmentPart] = useState<'cash' | 'card'>('cash');
  const [installmentNextDate, setInstallmentNextDate] = useState<Date>(() => new Date(Date.now() + 30 * 86400000));
  const [showInstallmentDatePicker, setShowInstallmentDatePicker] = useState(false);
  const methods = useMemo(
    () => (canSellInstallment ? [...METHODS, INSTALLMENT_METHOD] : METHODS),
    [canSellInstallment],
  );

  // Одноразовая гидрация скидки из чека (админ мог дать её на приёмке).
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!check || hydratedRef.current) return;
    hydratedRef.current = true;
    if (check.discount) setDiscount(String(check.discount));
  }, [check]);

  // ── Живой пересчёт (формула Кассы: скидка — только на товары) ─────────
  const serviceTotal = useMemo(() => (check?.services ?? []).reduce((s, l) => s + l.price * l.quantity, 0), [check]);
  const productTotal = useMemo(
    () => (check?.products ?? []).reduce((s, l) => s + l.sellPrice * l.quantity, 0),
    [check],
  );
  const discountNum = parseMoneyInput(discount);
  const effectiveDiscount = Math.min(discountNum, productTotal);
  const total = serviceTotal + Math.max(productTotal - discountNum, 0);
  // Смешанная: нал вводится, карта доводится до итога (кламп ≥ 0).
  const cashNum = Math.min(parseMoneyInput(cashPart), total);
  const cardCalc = Math.max(total - cashNum, 0);
  // Рассрочка: первый взнос клампится к итогу, остаток уходит в план.
  const installmentFirstNum = Math.min(parseMoneyInput(installmentFirst), total);
  const installmentRemaining = Math.max(total - installmentFirstNum, 0);

  const payMutation = useMutation({
    mutationFn: () => {
      let finalCash = 0;
      let finalCard = 0;
      if (method === 'cash') finalCash = total;
      else if (method === 'card') finalCard = total;
      else if (method === 'installment') {
        // Взнос уходит выбранным способом; остаток — план рассрочки (сервер).
        if (installmentPart === 'cash') finalCash = installmentFirstNum;
        else finalCard = installmentFirstNum;
      } else {
        finalCash = cashNum;
        finalCard = cardCalc;
      }
      // Выделенный роут PATCH /checks/:id/accept-payment (Round 14): гейт —
      // accept_payment, НЕ checks_edit. Пресет «Кассир» (edit='none') иначе
      // получал бы 403 на PATCH /checks/:id; заодно кассир закрывает ЧУЖИЕ
      // драфты (own-гейт на этом пути снят). Экран гейтится canAccept ниже,
      // так что право у вызывающего гарантированно есть.
      return checksApi.acceptPayment(id, {
        paymentMethod: method,
        cashAmount: finalCash,
        cardAmount: finalCard,
        // Скидка уходит ЯВНО числом — 0 тоже значение (стирание скидки).
        discount: discountNum,
        // Только при рассрочке: дата следующего платежа плана (YYYY-MM-DD).
        ...(method === 'installment' ? { installment: { nextPaymentDate: toYmd(installmentNextDate) } } : {}),
      });
    },
    onSuccess: async () => {
      haptic('success');
      // Деталь — по подтверждённой правде; списки/доска/деньги — фоново.
      await queryClient.refetchQueries({ queryKey: ['check', id] });
      queryClient.invalidateQueries({ queryKey: ['checks'] });
      queryClient.invalidateQueries({ queryKey: ['checks-infinite'] });
      queryClient.invalidateQueries({ queryKey: ['checks', 'board'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-v2'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-chart'] });
      queryClient.invalidateQueries({ queryKey: ['checks-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['cashflow'] });
      // Кассовая смена: принятая оплата ложится в текущую смену кассира.
      queryClient.invalidateQueries({ queryKey: ['cash-shift'] });
      // Рассрочка: активация с остатком создаёт план — раздел «Рассрочка»
      // должен увидеть его без ручного pull-to-refresh.
      queryClient.invalidateQueries({ queryKey: ['installments'] });
      for (const queryKey of CHECK_MONEY_DEPENDENT_KEYS) {
        queryClient.invalidateQueries({ queryKey });
      }
      navigation.goBack();
    },
    onError: (err: any) => {
      haptic('error');
      // 403 «оплату принимает только кассир» / 400 — серверный текст точнее.
      Alert.alert(
        'Не удалось принять оплату',
        err?.response?.data?.message || 'Проверьте соединение и попробуйте ещё раз.',
      );
    },
  });

  const canAccept = hasPermission('accept_payment');

  // ── Пограничные состояния ────────────────────────────────────────────
  let body: React.ReactNode = null;
  if (!check && isLoading) {
    body = (
      <View style={styles.centerFill}>
        <LoadingSpinner />
      </View>
    );
  } else if (!check && isError) {
    body = (
      <View style={styles.centerFill}>
        <EmptyState
          icon="receipt"
          title="Не удалось загрузить заказ"
          description="Проверьте соединение."
          action={{ label: 'Повторить', onPress: () => refetch() }}
        />
      </View>
    );
  } else if (check && !check.isDeferred) {
    body = (
      <View style={styles.centerFill}>
        <EmptyState
          icon="check"
          title="Заказ уже оплачен"
          description={`Заказ-наряд #${check.number} закрыт на ${formatMoney(check.totalRevenue)}.`}
          action={{ label: 'Открыть заказ', onPress: () => navigation.replace('CheckDetail', { id }) }}
        />
      </View>
    );
  } else if (check && !canAccept) {
    body = (
      <View style={styles.centerFill}>
        <EmptyState
          icon="lock"
          title="Нет права приёма оплаты"
          description="Оплату принимает кассир — роль с правом «Приём оплаты»."
        />
      </View>
    );
  } else if (check) {
    const assignees = check.assignees ?? [];
    body = (
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ── Кто и что: авто + клиент + исполнители + место ─────────── */}
          <View
            style={[
              styles.card,
              buildShadow(palette),
              { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
            ]}
          >
            <View style={styles.carRow}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.carTitle, { color: palette.text.primary }]} numberOfLines={1}>
                  {check.car?.makeModel || check.client?.fullName || `Заказ-наряд #${check.number}`}
                </Text>
                <Text style={[styles.clientLine, { color: palette.text.secondary }]} numberOfLines={1}>
                  {check.client?.fullName ?? 'Розничный покупатель'}
                </Text>
              </View>
              {check.car?.plateNumber ? (
                <View
                  style={[
                    styles.plateTag,
                    isDark && {
                      backgroundColor: softTint(colors.primary[600], 'dark'),
                      borderColor: palette.border.strong,
                    },
                  ]}
                >
                  <Text style={[styles.plateTagText, isDark && { color: palette.accent.primaryText }]}>
                    {check.car.plateNumber}
                  </Text>
                </View>
              ) : null}
            </View>
            {(assignees.length > 0 || check.location?.name) && (
              <View style={styles.metaRow}>
                {assignees.length > 0 && (
                  <View style={styles.metaItem}>
                    <Ionicons name="people-outline" size={13} color={palette.text.tertiary} />
                    <Text style={[styles.metaText, { color: palette.text.secondary }]} numberOfLines={1}>
                      {assignees.map((a) => (a.fullName ?? '').split(' ')[0] || '—').join(', ')}
                    </Text>
                  </View>
                )}
                {check.location?.name ? (
                  <View style={styles.metaItem}>
                    <Ionicons name="location-outline" size={13} color={palette.text.tertiary} />
                    <Text style={[styles.metaText, { color: palette.text.secondary }]} numberOfLines={1}>
                      {check.location.name}
                    </Text>
                  </View>
                ) : null}
              </View>
            )}
          </View>

          {/* ── Строки заказа — read-only ──────────────────────────────── */}
          <View
            style={[
              styles.card,
              buildShadow(palette),
              { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
            ]}
          >
            <Text style={[styles.sectionLabel, { color: palette.text.primary }]}>Состав заказа</Text>
            {(check.services ?? []).map((l, i) => (
              <View key={`s-${i}`} style={[styles.lineRow, { borderTopColor: palette.border.subtle }]}>
                <Text style={[styles.lineName, { color: palette.text.primary }]} numberOfLines={2}>
                  {l.name}
                </Text>
                <Text style={[styles.lineQty, { color: palette.text.tertiary }]}>×{l.quantity}</Text>
                <Text style={[styles.linePrice, { color: palette.text.primary }]}>
                  {formatMoney(l.price * l.quantity)}
                </Text>
              </View>
            ))}
            {(check.products ?? []).map((l, i) => (
              <View key={`p-${i}`} style={[styles.lineRow, { borderTopColor: palette.border.subtle }]}>
                <Text style={[styles.lineName, { color: palette.text.primary }]} numberOfLines={2}>
                  {l.name}
                </Text>
                <Text style={[styles.lineQty, { color: palette.text.tertiary }]}>×{l.quantity}</Text>
                <Text style={[styles.linePrice, { color: palette.text.primary }]}>
                  {formatMoney(l.sellPrice * l.quantity)}
                </Text>
              </View>
            ))}
            {(check.services?.length ?? 0) + (check.products?.length ?? 0) === 0 && (
              <Text style={[styles.emptyLines, { color: palette.text.tertiary }]}>Позиций нет — заказ без состава</Text>
            )}
          </View>

          {/* ── Скидка (живой пересчёт) ────────────────────────────────── */}
          <View
            style={[
              styles.card,
              buildShadow(palette),
              { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
            ]}
          >
            <TouchableOpacity
              activeOpacity={1}
              onPress={() => discountRef.current?.focus()}
              style={[styles.discountRow, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
            >
              <Ionicons name="pricetag-outline" size={16} color={colors.amber[600]} />
              <Text style={[styles.discountLabel, { color: palette.text.secondary }]}>Скидка</Text>
              <TextInput
                ref={discountRef}
                value={discount}
                onChangeText={setDiscount}
                style={[styles.discountInput, { color: palette.text.primary }]}
                keyboardType="numeric"
                placeholder="0"
                placeholderTextColor={palette.text.tertiary}
              />
              <Text style={[styles.discountCurrency, { color: palette.text.tertiary }]}>₽</Text>
            </TouchableOpacity>
            <Text style={[styles.discountHint, { color: palette.text.tertiary }]}>Скидка применяется к товарам</Text>
            {discountNum > 0 && effectiveDiscount < discountNum && (
              <View style={[styles.discountWarnRow, { backgroundColor: softTint(colors.amber[600], palette.mode) }]}>
                <Ionicons
                  name="alert-circle-outline"
                  size={14}
                  color={isDark ? colors.amber[200] : colors.amber[700]}
                />
                <Text style={[styles.discountWarnText, { color: isDark ? colors.amber[200] : colors.amber[700] }]}>
                  {productTotal === 0
                    ? 'В заказе нет товаров — скидка не применится'
                    : `Скидка применена частично: ${formatMoney(effectiveDiscount)} из ${formatMoney(discountNum)}`}
                </Text>
              </View>
            )}

            {/* Итог: услуги / товары / скидка / к оплате */}
            <View style={[styles.totalsBlock, { borderTopColor: palette.border.subtle }]}>
              {serviceTotal > 0 && (
                <View style={styles.totalsRow}>
                  <Text style={[styles.totalsLabel, { color: palette.text.secondary }]}>Услуги</Text>
                  <Text style={[styles.totalsValue, { color: palette.text.primary }]}>{formatMoney(serviceTotal)}</Text>
                </View>
              )}
              {productTotal > 0 && (
                <View style={styles.totalsRow}>
                  <Text style={[styles.totalsLabel, { color: palette.text.secondary }]}>Товары</Text>
                  <Text style={[styles.totalsValue, { color: palette.text.primary }]}>{formatMoney(productTotal)}</Text>
                </View>
              )}
              {effectiveDiscount > 0 && (
                <View style={styles.totalsRow}>
                  <Text style={[styles.totalsLabel, { color: colors.amber[600] }]}>Скидка</Text>
                  <Text style={[styles.totalsValue, { color: colors.amber[600] }]}>
                    −{formatMoney(effectiveDiscount)}
                  </Text>
                </View>
              )}
              <View style={styles.totalsRow}>
                <Text style={[styles.grandLabel, { color: palette.text.primary }]}>К оплате</Text>
                <Text style={[styles.grandValue, { color: palette.text.primary }]}>{formatMoney(total)}</Text>
              </View>
            </View>
          </View>

          {/* ── Способ оплаты ──────────────────────────────────────────── */}
          <View
            style={[
              styles.card,
              buildShadow(palette),
              { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
            ]}
          >
            <Text style={[styles.sectionLabel, { color: palette.text.primary }]}>Способ оплаты</Text>
            <View style={styles.methodRow}>
              {methods.map((m) => {
                const active = method === m.key;
                return (
                  <TouchableOpacity
                    key={m.key}
                    style={[
                      styles.methodChip,
                      { borderColor: palette.border.subtle, backgroundColor: palette.bg.muted },
                      active && {
                        backgroundColor: softTint(colors.primary[600], palette.mode),
                        borderColor: colors.primary[isDark ? 400 : 300],
                      },
                    ]}
                    onPress={() => {
                      haptic('select');
                      setMethod(m.key);
                    }}
                    activeOpacity={0.7}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={m.label}
                  >
                    <Ionicons
                      name={m.icon}
                      size={17}
                      color={active ? colors.primary[isDark ? 300 : 600] : palette.text.tertiary}
                    />
                    <Text
                      style={[
                        styles.methodChipText,
                        { color: active ? colors.primary[isDark ? 300 : 700] : palette.text.secondary },
                      ]}
                    >
                      {m.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {method === 'cash_card' && (
              <View
                style={[styles.splitBlock, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
              >
                <View style={styles.splitRow}>
                  <Text style={[styles.splitLabel, { color: palette.text.secondary }]}>Наличными</Text>
                  <TextInput
                    value={cashPart}
                    onChangeText={setCashPart}
                    style={[styles.splitInput, { color: palette.text.primary, borderColor: palette.border.subtle }]}
                    keyboardType="numeric"
                    placeholder="0"
                    placeholderTextColor={palette.text.tertiary}
                  />
                </View>
                <View style={styles.splitRow}>
                  <Text style={[styles.splitLabel, { color: palette.text.secondary }]}>Картой (авто)</Text>
                  <Text style={[styles.splitCardAmount, { color: palette.text.primary }]}>{formatMoney(cardCalc)}</Text>
                </View>
              </View>
            )}

            {method === 'installment' && (
              <View style={{ marginTop: spacing[3], gap: spacing[2.5] }}>
                <InstallmentSaleFields
                  palette={palette}
                  total={total}
                  firstPayment={installmentFirst}
                  onFirstPaymentChange={setInstallmentFirst}
                  remaining={installmentRemaining}
                  nextDateLabel={formatYmdHuman(toYmd(installmentNextDate))}
                  onOpenDatePicker={() => setShowInstallmentDatePicker(true)}
                />
                {/* Способ первого взноса: нал / карта (взнос уходит в
                    cashAmount / cardAmount активации). */}
                <View style={styles.partRow}>
                  <Text style={[styles.partLabel, { color: palette.text.secondary }]}>Взнос</Text>
                  {(
                    [
                      { key: 'cash', label: 'Наличные', icon: 'cash-outline' },
                      { key: 'card', label: 'Карта', icon: 'card-outline' },
                    ] as Array<{ key: 'cash' | 'card'; label: string; icon: keyof typeof Ionicons.glyphMap }>
                  ).map((p) => {
                    const active = installmentPart === p.key;
                    return (
                      <TouchableOpacity
                        key={p.key}
                        style={[
                          styles.partChip,
                          { borderColor: palette.border.subtle, backgroundColor: palette.bg.muted },
                          active && {
                            backgroundColor: softTint(colors.primary[600], palette.mode),
                            borderColor: colors.primary[isDark ? 400 : 300],
                          },
                        ]}
                        onPress={() => {
                          haptic('select');
                          setInstallmentPart(p.key);
                        }}
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={`Взнос — ${p.label}`}
                      >
                        <Ionicons
                          name={p.icon}
                          size={15}
                          color={active ? colors.primary[isDark ? 300 : 600] : palette.text.tertiary}
                        />
                        <Text
                          style={[
                            styles.partChipText,
                            { color: active ? colors.primary[isDark ? 300 : 700] : palette.text.secondary },
                          ]}
                        >
                          {p.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}
          </View>

          {/* ── CTA «Оплачено — N ₽» / «Оформить рассрочку» ────────────── */}
          <TouchableOpacity
            activeOpacity={0.85}
            disabled={payMutation.isPending}
            onPress={() => {
              haptic('select');
              payMutation.mutate();
            }}
            accessibilityRole="button"
            accessibilityLabel={
              method === 'installment'
                ? `Оформить рассрочку — взнос ${formatMoney(installmentFirstNum)}`
                : `Оплачено — ${formatMoney(total)}`
            }
          >
            <LinearGradient
              colors={[colors.green[500], colors.green[600]]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.payBtn}
            >
              {payMutation.isPending ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={20} color={colors.white} />
                  <Text style={styles.payBtnText}>
                    {method === 'installment'
                      ? `Оформить рассрочку — взнос ${formatMoney(installmentFirstNum)}`
                      : `Оплачено — ${formatMoney(total)}`}
                  </Text>
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>
        </ScrollView>

        {/* Дата следующего платежа по рассрочке (паттерн CheckCreateScreen). */}
        <DateTimePickerModal
          visible={showInstallmentDatePicker}
          value={installmentNextDate}
          mode="date"
          onConfirm={(d) => {
            setInstallmentNextDate(d);
            setShowInstallmentDatePicker(false);
          }}
          onCancel={() => setShowInstallmentDatePicker(false)}
        />
      </KeyboardAvoidingView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.bg.canvas }]} edges={['top']}>
      <IosScreenHeader
        title={check ? `Заказ-наряд #${check.number}` : 'Приём оплаты'}
        subtitle="Приём оплаты"
        onBack={() => navigation.goBack()}
      />
      {body}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  centerFill: { flex: 1, justifyContent: 'center' },
  scrollContent: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[10] },

  card: {
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing[4],
  },

  // Кто и что
  carRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  carTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold },
  clientLine: { fontSize: fontSize.sm, marginTop: 2 },
  plateTag: {
    backgroundColor: colors.primary[50],
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: colors.primary[200],
  },
  plateTagText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.primary[700], letterSpacing: 1 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3], marginTop: spacing[2.5] },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: spacing[1], maxWidth: '100%' },
  metaText: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, flexShrink: 1 },

  // Строки
  sectionLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, marginBottom: spacing[2] },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[2.5],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  lineName: { flex: 1, fontSize: fontSize.sm },
  lineQty: { fontSize: fontSize.xs, fontWeight: fontWeight.medium },
  linePrice: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  emptyLines: { fontSize: fontSize.sm, paddingVertical: spacing[2] },

  // Скидка + итоги
  discountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
  },
  discountLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  discountInput: {
    flex: 1,
    textAlign: 'right',
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    paddingVertical: spacing[2],
  },
  discountCurrency: { fontSize: fontSize.sm },
  discountHint: { fontSize: 11, marginTop: spacing[1.5], marginLeft: spacing[1] },
  discountWarnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[2.5],
    paddingVertical: spacing[2],
    marginTop: spacing[2],
  },
  discountWarnText: { flex: 1, fontSize: 11, lineHeight: 15, fontWeight: fontWeight.medium },
  totalsBlock: {
    marginTop: spacing[3],
    paddingTop: spacing[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing[1.5],
  },
  totalsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  totalsLabel: { fontSize: fontSize.sm },
  totalsValue: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  grandLabel: { fontSize: fontSize.base, fontWeight: fontWeight.bold },
  grandValue: { fontSize: fontSize.lg, fontWeight: fontWeight.bold },

  // Способ
  methodRow: { flexDirection: 'row', gap: spacing[2] },
  methodChip: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    paddingVertical: spacing[2.5],
  },
  methodChipText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  splitBlock: {
    marginTop: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    gap: spacing[1],
  },
  splitRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[1],
  },
  splitLabel: { fontSize: fontSize.sm },
  splitInput: {
    minWidth: 110,
    textAlign: 'right',
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    borderBottomWidth: 1,
    paddingVertical: spacing[1],
  },
  splitCardAmount: { fontSize: fontSize.base, fontWeight: fontWeight.semibold },

  // Рассрочка: способ первого взноса (нал/карта).
  partRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  partLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, marginRight: spacing[1] },
  partChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    paddingVertical: spacing[2],
  },
  partChipText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold },

  // CTA
  payBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    borderRadius: borderRadius['2xl'],
    paddingVertical: spacing[4],
  },
  payBtnText: { color: colors.white, fontSize: fontSize.base, fontWeight: fontWeight.bold },
});
