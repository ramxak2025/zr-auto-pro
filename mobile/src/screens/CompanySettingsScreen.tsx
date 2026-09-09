import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Switch,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { myCompanyApi, loyaltyApi, checksApi, pointsApi } from '../api/services';
import AnimatedCard from '../components/AnimatedCard';
import IosScreenHeader from '../components/IosScreenHeader';
import { KeyboardAwareView } from '../components/KeyboardAware';
import { useColors } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import Modal from '../components/Modal';
import type {
  Tenant,
  LoyaltySettings,
  PosSettings,
  PosSettingsConflict,
  PaymentAcceptorInfo,
  PointsListResponse,
} from '../../../shared/types';
import { POS_SETTINGS_KEY } from '../hooks/usePosSettings';
import { formatPhone } from '../../../shared/validation/phone';
import { RU_TIMEZONES, DEFAULT_TIMEZONE, timezoneOption, formatDateTime } from '../../../shared/utils/formatters';
import { haptic } from '../platform/haptics';

interface CompanyForm {
  name: string;
  phone: string;
  address: string;
  email: string;
  description: string;
  legalName: string;
  inn: string;
  kpp: string;
  ogrn: string;
  receiptFooter: string;
  shiftsEnabled: boolean;
  /** 156 — мульти-точки: общая база клиентов всех точек (true, дефолт). */
  pointsSharedClients: boolean;
  /** 157 — часовой пояс автосервиса (IANA-id). Дефолт — Москва. */
  timezone: string;
}

export default function CompanySettingsScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const tabBarHeight = useTabBarHeight();
  const palette = useColors();
  const { hasPermission } = useAuth();
  // «Права как в Битрикс24» (2026-07): данные компании и тумблер «Смены»
  // (часть PATCH /my-company) — ключ company_manage (сид «Администратора»
  // false — сервер и раньше пускал только director/superadmin). Кассовый
  // режим и лояльность — отдельные эндпоинты под settings_manage.
  const canManageShifts = hasPermission('company_manage');
  const canManagePosSettings = hasPermission('settings_manage');

  const { data: company, isLoading } = useQuery<Tenant>({
    queryKey: ['my-company'],
    queryFn: async () => (await myCompanyApi.get()).data,
  });

  // 156 — мульти-точки: сколько живых точек у тенанта. Переключатель «Общая
  // база клиентов» виден только когда точек больше одной (0–1 = одноточечный
  // режим, ничего нового не показываем).
  const { data: pointsData } = useQuery<PointsListResponse>({
    queryKey: ['points'],
    queryFn: async () => (await pointsApi.list()).data,
    staleTime: 60_000,
  });
  const pointsCount = pointsData?.points.length ?? 0;

  const [form, setForm] = useState<CompanyForm>({
    name: '',
    phone: '',
    address: '',
    email: '',
    description: '',
    legalName: '',
    inn: '',
    kpp: '',
    ogrn: '',
    receiptFooter: '',
    shiftsEnabled: false,
    pointsSharedClients: true,
    timezone: DEFAULT_TIMEZONE,
  });
  const [dirty, setDirty] = useState(false);
  // 157 — шит выбора часового пояса (список из 11 российских зон).
  const [tzPickerOpen, setTzPickerOpen] = useState(false);

  useEffect(() => {
    if (company) {
      setForm({
        name: company.name || '',
        phone: company.phone || '',
        address: company.address || '',
        email: company.email || '',
        description: company.description || '',
        legalName: company.legalName || '',
        inn: company.inn || '',
        kpp: company.kpp || '',
        ogrn: company.ogrn || '',
        receiptFooter: company.receiptFooter || '',
        shiftsEnabled: company.shiftsEnabled === true,
        pointsSharedClients: company.pointsSharedClients !== false,
        timezone: company.timezone || DEFAULT_TIMEZONE,
      });
      setDirty(false);
    }
  }, [company]);

  const mutation = useMutation({
    mutationFn: (data: Partial<Tenant>) => myCompanyApi.update(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-company'] });
      Alert.alert('Готово', 'Настройки сохранены');
      setDirty(false);
    },
    onError: () => Alert.alert('Ошибка', 'Не удалось сохранить'),
  });

  const update = (patch: Partial<CompanyForm>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    setDirty(true);
  };

  const handleSave = () => {
    mutation.mutate({
      name: form.name || undefined,
      phone: form.phone || undefined,
      address: form.address || undefined,
      email: form.email || undefined,
      description: form.description || undefined,
      legalName: form.legalName || undefined,
      inn: form.inn || undefined,
      kpp: form.kpp || undefined,
      ogrn: form.ogrn || undefined,
      receiptFooter: form.receiptFooter || undefined,
      // 157 — пояс отправляем всегда: это обычное значение поля, а не тумблер,
      // и сервер принимает только id из белого списка.
      timezone: form.timezone || DEFAULT_TIMEZONE,
      // Boolean toggle — отправляем всегда (включая false), иначе выключить
      // фичу было бы невозможно (`undefined` бэкенд игнорирует).
      ...(canManageShifts ? { shiftsEnabled: form.shiftsEnabled } : null),
      // 156 — только когда есть что переключать (>1 точки) и есть право.
      ...(canManageShifts && pointsCount > 1 ? { pointsSharedClients: form.pointsSharedClients } : null),
    });
  };

  if (isLoading) {
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Настройки компании" onBack={() => navigation.goBack()} />
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary[600]} />
      </View>
    );
  }

  const cardStyle = StyleSheet.flatten([
    styles.card,
    { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
  ]);
  const cardTitleStyle = StyleSheet.flatten([styles.cardTitle, { color: palette.text.primary }]);
  const labelStyle = StyleSheet.flatten([styles.label, { color: palette.text.secondary }]);
  const inputStyle = StyleSheet.flatten([
    styles.input,
    { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
  ]);
  const placeholderColor = palette.text.tertiary;
  // 157 — выбранный пояс; неизвестный/пустой id показываем как Москву (сервер
  // тоже трактует его так).
  const tzOption = timezoneOption(form.timezone);
  // Поле-«кнопка» пояса повторяет геометрию input'ов карточки, но собрано
  // отдельно: в стиль View нельзя класть текстовые свойства из inputStyle.
  const tzFieldStyle = StyleSheet.flatten([
    styles.tzField,
    { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
  ]);

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Настройки компании" onBack={() => navigation.goBack()} />

      {/* Клавиатура (миграция на keyboard-controller): KeyboardAwareView
          вместо RN-core KAV — offset из insets, одинаково iOS/Android. */}
      <KeyboardAwareView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + spacing[4] }]}>
          {/* Basic info */}
          <AnimatedCard index={0}>
            <View style={cardStyle}>
              <View style={styles.cardHeader}>
                <Ionicons name="business-outline" size={16} color={palette.text.tertiary} />
                <Text style={cardTitleStyle}>Основные данные</Text>
              </View>

              <View style={styles.field}>
                <Text style={labelStyle}>Название компании</Text>
                <TextInput
                  value={form.name}
                  onChangeText={(v) => update({ name: v })}
                  style={inputStyle}
                  placeholder="Автосервис «Мастер»"
                  placeholderTextColor={placeholderColor}
                />
              </View>

              <View style={styles.rowFields}>
                <View style={{ flex: 1 }}>
                  <Text style={labelStyle}>Телефон</Text>
                  {/* Phone mask shared with LoginScreen — user types digits,
                      formatPhone re-formats to +7 (XXX) XXX-XX-XX live. */}
                  <TextInput
                    value={form.phone}
                    onChangeText={(v) => update({ phone: formatPhone(v.replace(/\D/g, '')) })}
                    style={inputStyle}
                    placeholder="+7 (___) ___-__-__"
                    placeholderTextColor={placeholderColor}
                    keyboardType="phone-pad"
                    autoComplete="tel"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={labelStyle}>Email</Text>
                  <TextInput
                    value={form.email}
                    onChangeText={(v) => update({ email: v })}
                    style={inputStyle}
                    placeholder="info@autoservice.ru"
                    placeholderTextColor={placeholderColor}
                    keyboardType="email-address"
                    autoCapitalize="none"
                  />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={labelStyle}>Адрес</Text>
                <TextInput
                  value={form.address}
                  onChangeText={(v) => update({ address: v })}
                  style={inputStyle}
                  placeholder="г. Москва, ул. Примерная, д. 1"
                  placeholderTextColor={placeholderColor}
                />
              </View>

              {/* 157 — часовой пояс автосервиса. Оформлен как остальные поля
                  карточки (тот же inputStyle), но открывает шит выбора: список
                  фиксированный, свободный ввод сервер всё равно отклонит. */}
              <View style={styles.field}>
                <Text style={labelStyle}>Часовой пояс</Text>
                <TouchableOpacity
                  style={tzFieldStyle}
                  onPress={() => {
                    haptic('select');
                    setTzPickerOpen(true);
                  }}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel={`Часовой пояс: ${tzOption.label}, ${tzOption.utc}`}
                >
                  <Text style={[styles.tzFieldText, { color: palette.text.primary }]} numberOfLines={1}>
                    {tzOption.label} · {tzOption.utc}
                  </Text>
                  <Ionicons name="chevron-down" size={16} color={palette.text.tertiary} />
                </TouchableOpacity>
                <Text style={[styles.hint, { color: palette.text.tertiary }]}>
                  От пояса зависит, что считается «сегодня»: выручка за день, смены и отчёты. Сейчас в этом поясе:{' '}
                  {formatDateTime(new Date().toISOString(), tzOption.id)}
                </Text>
              </View>

              <View style={styles.field}>
                <Text style={labelStyle}>Описание</Text>
                <TextInput
                  value={form.description}
                  onChangeText={(v) => update({ description: v })}
                  style={[inputStyle, styles.textarea]}
                  placeholder="Краткое описание автосервиса"
                  placeholderTextColor={placeholderColor}
                  multiline
                  numberOfLines={2}
                />
              </View>
            </View>
          </AnimatedCard>

          {/* Receipt / Legal */}
          <AnimatedCard index={1}>
            <View style={cardStyle}>
              <View style={styles.cardHeader}>
                <Ionicons name="receipt-outline" size={16} color={palette.text.tertiary} />
                <Text style={cardTitleStyle}>Реквизиты для чеков</Text>
              </View>

              <View style={styles.field}>
                <Text style={labelStyle}>Юридическое название</Text>
                <TextInput
                  value={form.legalName}
                  onChangeText={(v) => update({ legalName: v })}
                  style={inputStyle}
                  placeholder="ИП Иванов И.И. или ООО «Мастер»"
                  placeholderTextColor={placeholderColor}
                />
              </View>

              <View style={styles.rowFields3}>
                <View style={{ flex: 1 }}>
                  <Text style={labelStyle}>ИНН</Text>
                  <TextInput
                    value={form.inn}
                    onChangeText={(v) => update({ inn: v.replace(/\D/g, '').slice(0, 12) })}
                    style={inputStyle}
                    placeholder="1234567890"
                    placeholderTextColor={placeholderColor}
                    keyboardType="numeric"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={labelStyle}>КПП</Text>
                  <TextInput
                    value={form.kpp}
                    onChangeText={(v) => update({ kpp: v.replace(/\D/g, '').slice(0, 9) })}
                    style={inputStyle}
                    placeholder="123456789"
                    placeholderTextColor={placeholderColor}
                    keyboardType="numeric"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={labelStyle}>ОГРН</Text>
                  <TextInput
                    value={form.ogrn}
                    onChangeText={(v) => update({ ogrn: v.replace(/\D/g, '').slice(0, 15) })}
                    style={inputStyle}
                    placeholder="1234567890123"
                    placeholderTextColor={placeholderColor}
                    keyboardType="numeric"
                  />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={labelStyle}>Текст внизу чека</Text>
                <TextInput
                  value={form.receiptFooter}
                  onChangeText={(v) => update({ receiptFooter: v })}
                  style={[inputStyle, styles.textarea]}
                  placeholder="Спасибо за визит! Ждём вас снова!"
                  placeholderTextColor={placeholderColor}
                  multiline
                  numberOfLines={2}
                />
                <Text style={[styles.hint, { color: palette.text.tertiary }]}>
                  Этот текст печатается внизу каждого чека
                </Text>
              </View>
            </View>
          </AnimatedCard>

          {/* Shifts subsystem toggle — directors/owners only. */}
          {canManageShifts && (
            <AnimatedCard index={2}>
              <View style={cardStyle}>
                <View style={styles.cardHeader}>
                  <Ionicons name="time-outline" size={16} color={palette.text.tertiary} />
                  <Text style={cardTitleStyle}>Смены</Text>
                </View>

                <View style={styles.toggleRow}>
                  <View style={styles.toggleTextWrap}>
                    <Text style={[styles.toggleLabel, { color: palette.text.primary }]}>
                      Сотрудники открывают смены сами
                    </Text>
                    <Text style={[styles.toggleSub, { color: palette.text.secondary }]}>
                      На главном экране у сотрудников появится кнопка «Открыть смену». Выключите, если смены ведёт
                      администратор.
                    </Text>
                  </View>
                  <Switch
                    value={form.shiftsEnabled}
                    onValueChange={(v) => update({ shiftsEnabled: v })}
                    trackColor={{ false: palette.border.subtle, true: palette.accent.primary }}
                    thumbColor={Platform.OS === 'android' ? colors.white : undefined}
                    ios_backgroundColor={palette.border.subtle}
                  />
                </View>
              </View>
            </AnimatedCard>
          )}

          {/* 156 — мульти-точки: общая или раздельная база клиентов. Видна
              только при >1 живой точке (0–1 точка = одноточечный режим, ничего
              нового не показываем) и тому же праву, что и «Смены». */}
          {canManageShifts && pointsCount > 1 && (
            <AnimatedCard index={3}>
              <View style={cardStyle}>
                <View style={styles.cardHeader}>
                  <Ionicons name="location-outline" size={16} color={palette.text.tertiary} />
                  <Text style={cardTitleStyle}>Точки</Text>
                </View>

                <View style={styles.toggleRow}>
                  <View style={styles.toggleTextWrap}>
                    <Text style={[styles.toggleLabel, { color: palette.text.primary }]}>
                      Общая база клиентов всех точек
                    </Text>
                    <Text style={[styles.toggleSub, { color: palette.text.secondary }]}>
                      Выкл: у каждой точки свой список клиентов.
                    </Text>
                  </View>
                  <Switch
                    value={form.pointsSharedClients}
                    onValueChange={(v) => update({ pointsSharedClients: v })}
                    trackColor={{ false: palette.border.subtle, true: palette.accent.primary }}
                    thumbColor={Platform.OS === 'android' ? colors.white : undefined}
                    ios_backgroundColor={palette.border.subtle}
                  />
                </View>
              </View>
            </AnimatedCard>
          )}

          {/* Режим кассовой смены (092) — ключ settings_manage (сервер: PATCH
              /checks/pos-settings). Self-contained card (own query + save),
              decoupled from the company «Сохранить» flow so flipping the mode
              is one tap and never entangles with tenant fields. */}
          {canManagePosSettings && <PosShiftModeSection index={4} />}

          {/* 155 — «Кто принимает оплату»: явный список кассиров (allowlist в
              pos-settings) либо режим «по ролям». Self-contained card рядом с
              тумблером режима, ключ settings_manage. */}
          {canManagePosSettings && <PaymentAcceptorsSection index={5} />}

          {/* Программа лояльности — ключ settings_manage (сервер: PATCH
              /loyalty/settings). Self-contained card: owns its own query +
              form + save, so saving cashback config never touches tenant
              fields and vice-versa. */}
          {canManagePosSettings && <LoyaltySettingsSection index={6} />}

          {/* Save */}
          {dirty && (
            <AnimatedCard index={7}>
              <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={mutation.isPending}>
                {mutation.isPending ? (
                  <ActivityIndicator color={colors.white} size="small" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle-outline" size={18} color={colors.white} />
                    <Text style={styles.saveBtnText}>Сохранить настройки</Text>
                  </>
                )}
              </TouchableOpacity>
            </AnimatedCard>
          )}
        </ScrollView>
      </KeyboardAwareView>

      {/* 157 — выбор часового пояса. Тот же общий Modal, что и у 409-конфликта
          в секции кассового режима: список с радио-отметкой у текущего, тап =
          выбор и закрытие. Сохраняется общей кнопкой «Сохранить настройки». */}
      <Modal visible={tzPickerOpen} onClose={() => setTzPickerOpen(false)} title="Часовой пояс">
        <Text style={[styles.conflictHint, { color: palette.text.secondary }]}>
          Выберите пояс, в котором работает автосервис. От него зависят «сегодня», смены и отчёты.
        </Text>
        <View style={{ gap: 2 }}>
          {RU_TIMEZONES.map((z) => {
            const selected = z.id === tzOption.id;
            return (
              <TouchableOpacity
                key={z.id}
                style={styles.tzRow}
                onPress={() => {
                  haptic('select');
                  if (z.id !== form.timezone) update({ timezone: z.id });
                  setTzPickerOpen(false);
                }}
                activeOpacity={0.7}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`${z.label}, ${z.utc}`}
              >
                <Ionicons
                  name={selected ? 'radio-button-on' : 'radio-button-off'}
                  size={22}
                  color={selected ? colors.primary[600] : palette.text.tertiary}
                />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.tzRowLabel, { color: palette.text.primary }]} numberOfLines={1}>
                    {z.label}
                  </Text>
                  <Text style={[styles.tzRowHint, { color: palette.text.tertiary }]} numberOfLines={1}>
                    {z.hint}
                  </Text>
                </View>
                <Text style={[styles.tzRowUtc, { color: palette.text.secondary }]}>{z.utc}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </Modal>
    </View>
  );
}

// ── Режим кассовой смены (POS shift-mode, 092) ─────────────────────────
// Owner-class card. Reads GET /checks/pos-settings (the caller is owner-class
// here, so `isCashier` is always true — we only surface the tenant-wide
// `shiftModeEnabled` flag) and PATCHes it. Self-contained — own query + save —
// so it never entangles with the tenant «Сохранить настройки» flow. Saving
// straight on toggle (no separate save button) keeps the one-tap feel of a
// feature switch. OFF by default → ничего в приложении не меняется.
function PosShiftModeSection({ index }: { index: number }) {
  const palette = useColors();
  const queryClient = useQueryClient();
  const navigation = useNavigation<any>();
  // Round 14: 409-конфликт переключения режима — на доске стоят незакрытые
  // заказы (is_deferred + work_status). Модал показывает первые 10 (номер,
  // клиент, сумма) и ведёт на Доску.
  const [conflict, setConflict] = useState<PosSettingsConflict | null>(null);

  const { data: settings } = useQuery<PosSettings>({
    queryKey: POS_SETTINGS_KEY,
    queryFn: async () => (await checksApi.getPosSettings()).data,
    staleTime: 60_000,
  });

  const enabled = settings?.shiftModeEnabled ?? false;

  const mutation = useMutation({
    mutationFn: (shiftModeEnabled: boolean) => checksApi.updatePosSettings({ shiftModeEnabled }),
    // Optimistic: the switch flips instantly; the tab bar / CheckCreate that
    // read the same key pick up the new mode without waiting on the round-trip.
    onMutate: async (next) => {
      await queryClient.cancelQueries({ queryKey: POS_SETTINGS_KEY });
      const prev = queryClient.getQueryData<PosSettings>(POS_SETTINGS_KEY);
      if (prev) queryClient.setQueryData<PosSettings>(POS_SETTINGS_KEY, { ...prev, shiftModeEnabled: next });
      return { prev };
    },
    onError: (err: any, _next, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(POS_SETTINGS_KEY, ctx.prev);
      haptic('error');
      // 409 PosSettingsConflict (Round 14): не генерик-«Ошибка», а список
      // «Сначала закройте заказы (N)» с переходом на Доску.
      const body = err?.response?.data;
      if (err?.response?.status === 409 && typeof body?.count === 'number') {
        setConflict(body as PosSettingsConflict);
        return;
      }
      Alert.alert('Ошибка', body?.message || 'Не удалось изменить режим');
    },
    onSuccess: () => {
      haptic('success');
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: POS_SETTINGS_KEY });
    },
  });

  const cardStyle = StyleSheet.flatten([
    styles.card,
    { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
  ]);
  const cardTitleStyle = StyleSheet.flatten([styles.cardTitle, { color: palette.text.primary }]);

  return (
    <AnimatedCard index={index}>
      <View style={cardStyle}>
        <View style={styles.cardHeader}>
          <Ionicons name="people-circle-outline" size={16} color={palette.text.tertiary} />
          <Text style={cardTitleStyle}>Режим кассовой смены</Text>
        </View>

        <View style={styles.toggleRow}>
          <View style={styles.toggleTextWrap}>
            <Text style={[styles.toggleLabel, { color: palette.text.primary }]}>Оплату принимает только кассир</Text>
            <Text style={[styles.toggleSub, { color: palette.text.secondary }]}>
              Вкл: оплату принимает только кассир (отмечается правом «Приём оплаты»), мастера создают заказ-наряды и
              ведут доску. Выкл: каждый сам пробивает чек, как сейчас.
            </Text>
          </View>
          <Switch
            value={enabled}
            onValueChange={(v) => mutation.mutate(v)}
            disabled={mutation.isPending}
            trackColor={{ false: palette.border.subtle, true: palette.accent.primary }}
            thumbColor={Platform.OS === 'android' ? colors.white : undefined}
            ios_backgroundColor={palette.border.subtle}
          />
        </View>
      </View>

      {/* ── 409: незакрытые заказы конвейера (Round 14) ──────────────── */}
      <Modal
        visible={!!conflict}
        onClose={() => setConflict(null)}
        title={`Сначала закройте заказы (${conflict?.count ?? 0})`}
      >
        <Text style={[styles.conflictHint, { color: palette.text.secondary }]}>
          Режим нельзя переключить, пока на доске стоят незакрытые заказ-наряды. Примите по ним оплату и выдайте машины
          — или удалите черновики.
        </Text>
        <View style={{ gap: spacing[2] }}>
          {(conflict?.checks ?? []).map((c) => (
            <View
              key={c.id}
              style={[styles.conflictRow, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
            >
              <Text style={[styles.conflictNumber, { color: palette.text.primary }]}>#{c.number}</Text>
              <Text style={[styles.conflictClient, { color: palette.text.secondary }]} numberOfLines={1}>
                {c.clientName ?? 'Розничный покупатель'}
              </Text>
              <Text style={[styles.conflictSum, { color: palette.text.primary }]}>
                {Math.round(c.totalRevenue ?? 0)
                  .toString()
                  .replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}{' '}
                ₽
              </Text>
            </View>
          ))}
          {(conflict?.count ?? 0) > (conflict?.checks?.length ?? 0) && (
            <Text style={[styles.conflictHint, { color: palette.text.tertiary }]}>
              Показаны первые {conflict?.checks?.length ?? 0} из {conflict?.count}.
            </Text>
          )}
        </View>
        <TouchableOpacity
          style={styles.conflictBoardBtn}
          onPress={() => {
            setConflict(null);
            haptic('select');
            // Доска живёт в Checks-стеке; initial:false держит Журнал под ней.
            navigation.navigate('Checks', { screen: 'WorkBoard', initial: false });
          }}
          accessibilityRole="button"
          accessibilityLabel="Открыть доску заказ-нарядов"
        >
          <Ionicons name="albums-outline" size={17} color={colors.white} />
          <Text style={styles.conflictBoardBtnText}>Открыть доску</Text>
        </TouchableOpacity>
      </Modal>
    </AnimatedCard>
  );
}

// ── «Кто принимает оплату» (155, payment acceptors allowlist) ───────────
// Self-contained card под settings_manage. Читает GET /checks/payment-acceptors
// (активные сотрудники + резолв «кто фактически принимает и почему») и
// pos-settings (paymentAcceptorIds). Два режима:
//   • null — «по ролям»: принимают все с правом «Приём оплаты» (как раньше);
//   • список — принимают ТОЛЬКО перечисленные (+ owner-class всегда, из
//     списка не убираются).
// Сохранение — PATCH /checks/pos-settings ({ paymentAcceptorIds }); 409 при
// включении режима без единого кассира показываем дословно.
function PaymentAcceptorsSection({ index }: { index: number }) {
  const palette = useColors();
  const queryClient = useQueryClient();

  const { data: settings } = useQuery<PosSettings>({
    queryKey: POS_SETTINGS_KEY,
    queryFn: async () => (await checksApi.getPosSettings()).data,
    staleTime: 60_000,
  });

  const { data: acceptors } = useQuery<PaymentAcceptorInfo[]>({
    queryKey: ['payment-acceptors'],
    queryFn: async () => (await checksApi.paymentAcceptors()).data,
    staleTime: 60_000,
  });

  // Локальный черновик списка: null = режим «по ролям». Синхронизируется с
  // сервером на каждом свежем pos-settings (как соседние секции).
  const [manualIds, setManualIds] = useState<string[] | null>(null);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (settings) {
      setManualIds(settings.paymentAcceptorIds ?? null);
      setDirty(false);
    }
  }, [settings]);

  const mutation = useMutation({
    mutationFn: (paymentAcceptorIds: string[] | null) => checksApi.updatePosSettings({ paymentAcceptorIds }),
    onSuccess: () => {
      haptic('success');
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: POS_SETTINGS_KEY });
      queryClient.invalidateQueries({ queryKey: ['payment-acceptors'] });
    },
    onError: (err: any) => {
      haptic('error');
      // 409 «Некому принимать оплату…» и прочие ошибки бэка — дословно.
      const msg = err?.response?.data?.message;
      Alert.alert('Ошибка', typeof msg === 'string' && msg ? msg : 'Не удалось сохранить список');
    },
  });

  const rows = acceptors ?? [];
  const effectiveNames = rows.filter((a) => a.effective).map((a) => a.fullName || 'Без имени');
  const isManual = manualIds !== null;

  const toggle = (a: PaymentAcceptorInfo) => {
    if (a.isOwnerClass || manualIds === null) return;
    haptic('select');
    setManualIds((prev) => {
      if (prev === null) return prev;
      return prev.includes(a.id) ? prev.filter((id) => id !== a.id) : [...prev, a.id];
    });
    setDirty(true);
  };

  const startManual = () => {
    haptic('select');
    // Стартуем с тех, кто фактически принимает сейчас (owner-class в списке
    // не хранится — они принимают всегда и без него).
    setManualIds(rows.filter((a) => a.effective && !a.isOwnerClass).map((a) => a.id));
    setDirty(true);
  };

  const resetToRoles = () => {
    haptic('select');
    setManualIds(null);
    // null сохраняем сразу — это явное действие «Сбросить к ролям».
    mutation.mutate(null);
  };

  const cardStyle = StyleSheet.flatten([
    styles.card,
    { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
  ]);
  const cardTitleStyle = StyleSheet.flatten([styles.cardTitle, { color: palette.text.primary }]);

  return (
    <AnimatedCard index={index}>
      <View style={cardStyle}>
        <View style={styles.cardHeader}>
          <Ionicons name="card-outline" size={16} color={palette.text.tertiary} />
          <Text style={cardTitleStyle}>Кто принимает оплату</Text>
        </View>

        {!isManual ? (
          <>
            {/* Режим «по ролям» — прежнее поведение. */}
            <View style={[styles.acceptorPlaque, { backgroundColor: palette.bg.muted }]}>
              <Ionicons name="people-outline" size={15} color={palette.text.secondary} />
              <Text style={[styles.acceptorPlaqueText, { color: palette.text.secondary }]}>
                По ролям: принимают все с правом «Приём оплаты»
              </Text>
            </View>
            {effectiveNames.length > 0 && (
              <Text style={[styles.acceptorEffectiveList, { color: palette.text.tertiary }]}>
                Сейчас принимают: {effectiveNames.join(', ')}
              </Text>
            )}
            <TouchableOpacity
              style={[styles.acceptorModeBtn, { borderColor: palette.border.subtle }]}
              onPress={startManual}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Выбрать сотрудников вручную"
            >
              <Ionicons name="checkbox-outline" size={16} color={colors.primary[600]} />
              <Text style={[styles.acceptorModeBtnText, { color: colors.primary[600] }]}>Выбрать вручную</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            {/* Режим явного списка: чекбоксы по каждому активному сотруднику. */}
            <View style={{ gap: 2 }}>
              {rows.map((a) => {
                const checked = a.isOwnerClass || (manualIds?.includes(a.id) ?? false);
                return (
                  <TouchableOpacity
                    key={a.id}
                    style={styles.acceptorRow}
                    onPress={() => toggle(a)}
                    disabled={a.isOwnerClass}
                    activeOpacity={0.7}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked, disabled: a.isOwnerClass }}
                    accessibilityLabel={a.fullName || 'Без имени'}
                  >
                    <Ionicons
                      name={checked ? 'checkbox' : 'square-outline'}
                      size={22}
                      color={
                        a.isOwnerClass ? palette.text.tertiary : checked ? colors.primary[600] : palette.text.tertiary
                      }
                    />
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.acceptorName, { color: palette.text.primary }]} numberOfLines={1}>
                        {a.fullName || 'Без имени'}
                      </Text>
                      {a.roleName ? (
                        <Text style={[styles.acceptorRole, { color: palette.text.tertiary }]} numberOfLines={1}>
                          {a.roleName}
                        </Text>
                      ) : null}
                    </View>
                    {a.isOwnerClass && (
                      <Text style={[styles.acceptorAlways, { color: palette.text.tertiary }]}>всегда может</Text>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.acceptorActionsRow}>
              <TouchableOpacity
                style={[styles.acceptorModeBtn, { borderColor: palette.border.subtle, flex: 1 }]}
                onPress={resetToRoles}
                disabled={mutation.isPending}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Сбросить к ролям"
              >
                <Ionicons name="refresh-outline" size={15} color={palette.text.secondary} />
                <Text style={[styles.acceptorModeBtnText, { color: palette.text.secondary }]}>Сбросить к ролям</Text>
              </TouchableOpacity>
              {dirty && (
                <TouchableOpacity
                  style={[styles.acceptorSaveBtn, { backgroundColor: colors.primary[600], flex: 1 }]}
                  onPress={() => mutation.mutate(manualIds)}
                  disabled={mutation.isPending}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel="Сохранить список"
                >
                  {mutation.isPending ? (
                    <ActivityIndicator color={colors.white} size="small" />
                  ) : (
                    <>
                      <Ionicons name="checkmark-circle-outline" size={15} color={colors.white} />
                      <Text style={styles.acceptorSaveBtnText}>Сохранить</Text>
                    </>
                  )}
                </TouchableOpacity>
              )}
            </View>
          </>
        )}
      </View>
    </AnimatedCard>
  );
}

// ── Программа лояльности (loyalty / cashback config) ───────────────────
// Owner-class card. Reads GET /loyalty/settings (a default row is auto-created
// server-side on first read) and PATCHes it. Kept self-contained — its own
// query, draft state and save — so it never entangles with the tenant
// «Сохранить настройки» flow. The percent fields stay editable even when the
// programme is off (the config is retained), exactly like the backend keeps an
// existing balance spendable after a disable.
function LoyaltySettingsSection({ index }: { index: number }) {
  const palette = useColors();
  const queryClient = useQueryClient();

  const { data: settings } = useQuery<LoyaltySettings>({
    queryKey: ['loyalty', 'settings'],
    queryFn: async () => (await loyaltyApi.getSettings()).data,
  });

  const [enabled, setEnabled] = useState(false);
  // Stored as sanitised digit strings; clamped to 0..100 on save.
  const [accrualText, setAccrualText] = useState('0');
  const [redeemText, setRedeemText] = useState('0');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (settings) {
      setEnabled(settings.enabled);
      setAccrualText(String(settings.accrualPercent ?? 0));
      setRedeemText(String(settings.redeemMaxPercent ?? 0));
      setDirty(false);
    }
  }, [settings]);

  const mutation = useMutation({
    mutationFn: (data: { enabled: boolean; accrualPercent: number; redeemMaxPercent: number }) =>
      loyaltyApi.updateSettings(data),
    onSuccess: (res) => {
      // Write the fresh config straight into cache so any open client bonus
      // card / cash flow reads the new percentages instantly.
      queryClient.setQueryData(['loyalty', 'settings'], res.data);
      queryClient.invalidateQueries({ queryKey: ['loyalty', 'settings'] });
      haptic('success');
      setDirty(false);
      Alert.alert('Готово', 'Настройки лояльности сохранены');
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось сохранить');
    },
  });

  const clampPercent = (t: string) => {
    const n = Number(t.replace(/\D/g, ''));
    if (!Number.isFinite(n)) return 0;
    return Math.min(100, Math.max(0, n));
  };
  const accrualPercent = clampPercent(accrualText);
  const redeemMaxPercent = clampPercent(redeemText);

  const onPercentChange = (setter: (v: string) => void) => (v: string) => {
    setter(v.replace(/\D/g, '').slice(0, 3));
    setDirty(true);
  };

  const handleSave = () => {
    if (mutation.isPending) return;
    mutation.mutate({ enabled, accrualPercent, redeemMaxPercent });
  };

  const cardStyle = StyleSheet.flatten([
    styles.card,
    { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
  ]);
  const cardTitleStyle = StyleSheet.flatten([styles.cardTitle, { color: palette.text.primary }]);
  const labelStyle = StyleSheet.flatten([styles.label, { color: palette.text.secondary }]);
  const inputStyle = StyleSheet.flatten([
    styles.input,
    { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
  ]);

  return (
    <AnimatedCard index={index}>
      <View style={cardStyle}>
        <View style={styles.cardHeader}>
          <Ionicons name="gift-outline" size={16} color={palette.text.tertiary} />
          <Text style={cardTitleStyle}>Программа лояльности</Text>
        </View>

        {/* Master switch. */}
        <View style={styles.toggleRow}>
          <View style={styles.toggleTextWrap}>
            <Text style={[styles.toggleLabel, { color: palette.text.primary }]}>Бонусы клиентам</Text>
            <Text style={[styles.toggleSub, { color: palette.text.secondary }]}>
              Клиенты копят бонусы с чеков и оплачивают ими часть следующего заказа. Выключение не сжигает уже
              накопленные бонусы — их по-прежнему можно потратить.
            </Text>
          </View>
          <Switch
            value={enabled}
            onValueChange={(v) => {
              setEnabled(v);
              setDirty(true);
            }}
            trackColor={{ false: palette.border.subtle, true: palette.accent.primary }}
            thumbColor={Platform.OS === 'android' ? colors.white : undefined}
            ios_backgroundColor={palette.border.subtle}
          />
        </View>

        {/* Percent fields — accrual (cashback) + max redeem share. */}
        <View style={styles.rowFields}>
          <View style={{ flex: 1 }}>
            <Text style={labelStyle}>Кешбэк с чека, %</Text>
            <TextInput
              value={accrualText}
              onChangeText={onPercentChange(setAccrualText)}
              style={inputStyle}
              placeholder="5"
              placeholderTextColor={palette.text.tertiary}
              keyboardType="number-pad"
              maxLength={3}
            />
            <Text style={[styles.hint, { color: palette.text.tertiary }]}>
              Сколько % от суммы чека вернётся клиенту бонусами
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={labelStyle}>Оплата бонусами, макс %</Text>
            <TextInput
              value={redeemText}
              onChangeText={onPercentChange(setRedeemText)}
              style={inputStyle}
              placeholder="30"
              placeholderTextColor={palette.text.tertiary}
              keyboardType="number-pad"
              maxLength={3}
            />
            <Text style={[styles.hint, { color: palette.text.tertiary }]}>
              Какую долю чека разрешено оплатить бонусами
            </Text>
          </View>
        </View>

        {dirty && (
          <TouchableOpacity
            style={[loyaltyStyles.saveBtn, { backgroundColor: palette.accent.primary }]}
            onPress={handleSave}
            disabled={mutation.isPending}
            activeOpacity={0.85}
          >
            {mutation.isPending ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <>
                <Ionicons name="checkmark-circle-outline" size={17} color={colors.white} />
                <Text style={loyaltyStyles.saveBtnText}>Сохранить лояльность</Text>
              </>
            )}
          </TouchableOpacity>
        )}
      </View>
    </AnimatedCard>
  );
}

const loyaltyStyles = StyleSheet.create({
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[3],
    marginTop: spacing[1],
  },
  saveBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.white },
});

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  scrollContent: { padding: spacing[4], gap: spacing[4], paddingBottom: spacing[8] },
  card: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: colors.gray[100],
    padding: spacing[5],
    gap: spacing[4],
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  cardTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  field: { gap: spacing[1] },
  label: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: colors.gray[600] },
  input: {
    backgroundColor: colors.gray[50],
    borderWidth: 1,
    borderColor: colors.gray[200],
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    fontSize: fontSize.sm,
    color: colors.gray[900],
  },
  textarea: { minHeight: 60, textAlignVertical: 'top' },
  hint: { fontSize: 11, color: colors.gray[400], marginTop: 4 },
  rowFields: { flexDirection: 'row', gap: spacing[3] },
  rowFields3: { flexDirection: 'row', gap: spacing[2] },
  toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  toggleTextWrap: { flex: 1, minWidth: 0 },
  toggleLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  toggleSub: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  // 157 — часовой пояс: поле-«кнопка» в карточке и строки шита выбора.
  tzField: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[2],
    backgroundColor: colors.gray[50],
    borderWidth: 1,
    borderColor: colors.gray[200],
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    minHeight: 42,
  },
  tzFieldText: { flex: 1, minWidth: 0, fontSize: fontSize.sm },
  tzRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    paddingVertical: spacing[2],
    minHeight: 44,
  },
  tzRowLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  tzRowHint: { fontSize: 11, marginTop: 1 },
  tzRowUtc: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, flexShrink: 0 },
  // 155 — «Кто принимает оплату»
  acceptorPlaque: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
  },
  acceptorPlaqueText: { flex: 1, minWidth: 0, fontSize: fontSize.xs, lineHeight: 17, fontWeight: fontWeight.medium },
  acceptorEffectiveList: { fontSize: fontSize.xs, lineHeight: 17 },
  acceptorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    paddingVertical: spacing[2],
    minHeight: 40,
  },
  acceptorName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  acceptorRole: { fontSize: 11, marginTop: 1 },
  acceptorAlways: { fontSize: 11, fontWeight: fontWeight.medium, flexShrink: 0 },
  acceptorActionsRow: { flexDirection: 'row', gap: spacing[2.5] },
  acceptorModeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    paddingVertical: spacing[2.5],
    minHeight: 40,
  },
  acceptorModeBtnText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  acceptorSaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[2.5],
    minHeight: 40,
  },
  acceptorSaveBtnText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.white },

  // 409-конфликт переключения режима кассовой смены (Round 14).
  conflictHint: { fontSize: fontSize.sm, lineHeight: 19, marginBottom: spacing[3] },
  conflictRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
  },
  conflictNumber: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  conflictClient: { flex: 1, minWidth: 0, fontSize: fontSize.sm },
  conflictSum: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  conflictBoardBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    marginTop: spacing[4],
    borderRadius: borderRadius.xl,
    backgroundColor: colors.primary[600],
    paddingVertical: spacing[3],
  },
  conflictBoardBtnText: { color: colors.white, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    backgroundColor: colors.primary[600],
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[4],
  },
  saveBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.white },
});
