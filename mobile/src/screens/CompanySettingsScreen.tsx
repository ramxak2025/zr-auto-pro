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
  KeyboardAvoidingView,
  Switch,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { myCompanyApi, loyaltyApi } from '../api/services';
import AnimatedCard from '../components/AnimatedCard';
import IosScreenHeader from '../components/IosScreenHeader';
import { useColors } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import type { Tenant, LoyaltySettings } from '../../../shared/types';
import { UserRole } from '../../../shared/types';
import { formatPhone } from '../../../shared/validation/phone';
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
}

export default function CompanySettingsScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const tabBarHeight = useTabBarHeight();
  const palette = useColors();
  const { user } = useAuth();
  // Тумблер «Смены» доступен только директору/владельцу — это управление
  // фичей тенанта, не персональная настройка. (Мастеру экран настроек
  // компании и так недоступен, но гейтим явно.)
  const canManageShifts =
    user?.role === UserRole.DIRECTOR || user?.role === UserRole.ADMIN || user?.role === UserRole.SUPERADMIN;

  const { data: company, isLoading } = useQuery<Tenant>({
    queryKey: ['my-company'],
    queryFn: async () => (await myCompanyApi.get()).data,
  });

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
  });
  const [dirty, setDirty] = useState(false);

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
      // Boolean toggle — отправляем всегда (включая false), иначе выключить
      // фичу было бы невозможно (`undefined` бэкенд игнорирует).
      ...(canManageShifts ? { shiftsEnabled: form.shiftsEnabled } : null),
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

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Настройки компании" onBack={() => navigation.goBack()} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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

          {/* Программа лояльности — owner-class. Self-contained card: owns its
              own query + form + save (decoupled from the company «Сохранить»
              flow above), so saving cashback config never touches tenant
              fields and vice-versa. */}
          {canManageShifts && <LoyaltySettingsSection index={3} />}

          {/* Save */}
          {dirty && (
            <AnimatedCard index={4}>
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
      </KeyboardAvoidingView>
    </View>
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
