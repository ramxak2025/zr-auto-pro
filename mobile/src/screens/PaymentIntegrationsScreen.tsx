/**
 * PaymentIntegrationsScreen — «Приём оплат и касса».
 *
 * Owner-class (director / admin / superadmin) settings for the two money
 * integrations the backend shipped:
 *
 *   • Эквайринг (приём оплаты картой / СБП) — backend payments/ (ЮKassa / Тинькофф).
 *     paymentsApi.getSettings / updateSettings. The secret key is WRITE-ONLY:
 *     the server returns only a mask (`secretKeyMask`) + `hasSecretKey`. We show
 *     the mask as a placeholder and send `secretKey` ONLY when the owner types a
 *     fresh value — re-saving never wipes an existing key.
 *
 *   • Онлайн-касса 54-ФЗ (АТОЛ) — backend fiscal/. fiscalApi.getSettings /
 *     updateSettings. Same mask discipline for the АТОЛ `password`.
 *
 * NAMING: the existing IntegrationsScreen (раздел «Маркетинг») already owns the
 * label «Интеграции» (телефония / мессенджеры / отзывы). To avoid two identical
 * menu rows, this money-focused screen uses the distinct, accurate title
 * «Приём оплат и касса». It is registered in MoreStack (tab bar stays visible)
 * and reachable from the «Остальное» group in MoreScreen, reusing the existing
 * `company-settings` item-key (it is company-level financial config, adjacent to
 * «Настройки компании»; a new shared item-key would break the ITEM_KEYS guard).
 *
 * INERT until configured: both modules return 422 on use until real credentials
 * are entered AND `enabled` is on — hence the hint under each section.
 */
import React, { useEffect, useMemo, useState } from 'react';
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
import { paymentsApi, fiscalApi, walletApi } from '../api/services';
import AnimatedCard from '../components/AnimatedCard';
import IosScreenHeader from '../components/IosScreenHeader';
import Modal from '../components/Modal';
import { useColors } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { colors, fontSize, fontWeight, borderRadius, spacing, softTint } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { haptic } from '../platform/haptics';
import type { PaymentProviderName, FiscalSno, FiscalVat, WalletSettings } from '../../../shared/types';

// ── Option catalogues ─────────────────────────────────────────────────

const PROVIDER_OPTIONS: { value: PaymentProviderName; label: string }[] = [
  { value: 'yookassa', label: 'ЮKassa' },
  { value: 'tinkoff', label: 'Тинькофф' },
];

const SNO_OPTIONS: { value: FiscalSno; label: string }[] = [
  { value: 'osn', label: 'ОСН' },
  { value: 'usn_income', label: 'УСН (доход)' },
  { value: 'usn_income_outcome', label: 'УСН (доход − расход)' },
  { value: 'envd', label: 'ЕНВД' },
  { value: 'esn', label: 'ЕСХН' },
  { value: 'patent', label: 'Патент' },
];

const VAT_OPTIONS: { value: FiscalVat; label: string }[] = [
  { value: 'none', label: 'Без НДС' },
  { value: 'vat0', label: 'НДС 0%' },
  { value: 'vat10', label: 'НДС 10%' },
  { value: 'vat20', label: 'НДС 20%' },
  { value: 'vat110', label: 'НДС 10/110 (расчётный)' },
  { value: 'vat120', label: 'НДС 20/120 (расчётный)' },
];

const CONFIG_HINT = 'Ключи получите в личном кабинете провайдера. До ввода функция неактивна.';

const WALLET_HINT = 'Сертификат Apple Pass Type ID — из Apple Developer. До загрузки карта недоступна.';

// ── Screen ─────────────────────────────────────────────────────────────

export default function PaymentIntegrationsScreen() {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const { hasPermission } = useAuth();

  // Настройки приёма оплат / онлайн-кассы / кошелька — ключ settings_manage
  // (сервер: GET/PATCH /payments/settings, /fiscal/settings, /wallet/settings
  // → тот же ключ; admin живёт по матрице из /auth/me).
  const isOwner = hasPermission('settings_manage');

  if (!isOwner) {
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Приём оплат и касса" onBack={() => navigation.goBack()} />
        <View style={styles.restricted}>
          <Ionicons name="lock-closed-outline" size={40} color={palette.text.tertiary} />
          <Text style={[styles.restrictedText, { color: palette.text.secondary }]}>
            Настройки приёма оплат и онлайн-кассы доступны только владельцу и администратору.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Приём оплат и касса" onBack={() => navigation.goBack()} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + spacing[4] }]}
          keyboardShouldPersistTaps="handled"
        >
          <AcquiringSection index={0} />
          <FiscalSection index={1} />
          <WalletSection index={2} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ── Эквайринг (приём оплаты картой / СБП) ──────────────────────────────

function AcquiringSection({ index }: { index: number }) {
  const palette = useColors();
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['payments', 'settings'],
    queryFn: async () => (await paymentsApi.getSettings()).data,
  });

  const [provider, setProvider] = useState<PaymentProviderName>('yookassa');
  const [enabled, setEnabled] = useState(false);
  const [shopId, setShopId] = useState('');
  // Secret stays empty in the form — the server never returns the raw key. We
  // show the mask as a placeholder and only SEND `secretKey` when this is filled.
  const [secretKey, setSecretKey] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (settings) {
      setProvider(settings.provider ?? 'yookassa');
      setEnabled(!!settings.enabled);
      setShopId(settings.shopId ?? '');
      setSecretKey('');
      setDirty(false);
    }
  }, [settings]);

  const mutation = useMutation({
    mutationFn: (data: { provider: PaymentProviderName; enabled: boolean; shopId?: string; secretKey?: string }) =>
      paymentsApi.updateSettings(data),
    onSuccess: (res) => {
      queryClient.setQueryData(['payments', 'settings'], res.data);
      queryClient.invalidateQueries({ queryKey: ['payments', 'settings'] });
      haptic('success');
      setSecretKey('');
      setDirty(false);
      Alert.alert('Готово', 'Настройки эквайринга сохранены');
    },
    onError: (e: any) => {
      haptic('error');
      Alert.alert('Ошибка', e?.response?.data?.message || 'Не удалось сохранить');
    },
  });

  const handleSave = () => {
    if (mutation.isPending) return;
    const key = secretKey.trim();
    mutation.mutate({
      provider,
      enabled,
      shopId: shopId.trim(),
      // Send the secret ONLY when the owner typed a new one — an omitted key
      // leaves the stored secret untouched (the form shows a mask, not the value).
      ...(key ? { secretKey: key } : null),
    });
  };

  const secretPlaceholder = settings?.hasSecretKey
    ? settings.secretKeyMask || '•••• •••• (ключ сохранён)'
    : 'Вставьте секретный ключ';

  const s = sectionStyles(palette);

  return (
    <AnimatedCard index={index}>
      <View style={s.card}>
        <View style={s.cardHeader}>
          <View
            style={[
              s.iconBadge,
              { backgroundColor: palette.mode === 'dark' ? softTint(colors.blue[600], 'dark') : colors.blue[50] },
            ]}
          >
            <Ionicons name="card-outline" size={18} color={colors.blue[600]} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.cardTitle}>Эквайринг</Text>
            <Text style={s.cardSubtitle}>Оплата картой и СБП</Text>
          </View>
        </View>

        {isLoading && !settings ? (
          <ActivityIndicator style={{ marginVertical: spacing[4] }} color={palette.accent.primary} />
        ) : (
          <>
            <Text style={s.label}>Провайдер</Text>
            <Segmented
              options={PROVIDER_OPTIONS}
              value={provider}
              onChange={(v) => {
                setProvider(v);
                setDirty(true);
              }}
            />

            <ToggleRow
              label="Принимать онлайн-оплату"
              sub="Включите после ввода ключей провайдера"
              value={enabled}
              onChange={(v) => {
                setEnabled(v);
                setDirty(true);
              }}
            />

            <Field
              label="Shop ID"
              value={shopId}
              onChangeText={(v) => {
                setShopId(v);
                setDirty(true);
              }}
              placeholder="123456"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="numbers-and-punctuation"
            />

            <Field
              label="Секретный ключ"
              value={secretKey}
              onChangeText={(v) => {
                setSecretKey(v);
                setDirty(true);
              }}
              placeholder={secretPlaceholder}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={s.hint}>{CONFIG_HINT}</Text>

            {dirty && <SaveButton pending={mutation.isPending} onPress={handleSave} label="Сохранить эквайринг" />}
          </>
        )}
      </View>
    </AnimatedCard>
  );
}

// ── Онлайн-касса 54-ФЗ (АТОЛ) ──────────────────────────────────────────

function FiscalSection({ index }: { index: number }) {
  const palette = useColors();
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['fiscal', 'settings'],
    queryFn: async () => (await fiscalApi.getSettings()).data,
  });

  const [enabled, setEnabled] = useState(false);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [groupCode, setGroupCode] = useState('');
  const [sno, setSno] = useState<FiscalSno | null>(null);
  const [inn, setInn] = useState('');
  const [paymentAddress, setPaymentAddress] = useState('');
  const [companyEmail, setCompanyEmail] = useState('');
  const [vat, setVat] = useState<FiscalVat>('none');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (settings) {
      setEnabled(!!settings.enabled);
      setLogin(settings.login ?? '');
      setPassword('');
      setGroupCode(settings.groupCode ?? '');
      setSno(settings.sno ?? null);
      setInn(settings.inn ?? '');
      setPaymentAddress(settings.paymentAddress ?? '');
      setCompanyEmail(settings.companyEmail ?? '');
      setVat(normalizeVat(settings.vat));
      setDirty(false);
    }
  }, [settings]);

  const mutation = useMutation({
    mutationFn: (data: {
      enabled: boolean;
      login?: string;
      password?: string;
      groupCode?: string;
      sno?: FiscalSno;
      inn?: string;
      paymentAddress?: string;
      companyEmail?: string;
      vat?: FiscalVat;
    }) => fiscalApi.updateSettings(data),
    onSuccess: (res) => {
      queryClient.setQueryData(['fiscal', 'settings'], res.data);
      queryClient.invalidateQueries({ queryKey: ['fiscal', 'settings'] });
      haptic('success');
      setPassword('');
      setDirty(false);
      Alert.alert('Готово', 'Настройки онлайн-кассы сохранены');
    },
    onError: (e: any) => {
      haptic('error');
      Alert.alert('Ошибка', e?.response?.data?.message || 'Не удалось сохранить');
    },
  });

  const handleSave = () => {
    if (mutation.isPending) return;
    const pwd = password.trim();
    mutation.mutate({
      enabled,
      login: login.trim(),
      // Send the password ONLY when the owner typed a new one — an omitted
      // password leaves the stored secret untouched (the form shows a mask).
      ...(pwd ? { password: pwd } : null),
      groupCode: groupCode.trim(),
      ...(sno ? { sno } : null),
      inn: inn.trim(),
      paymentAddress: paymentAddress.trim(),
      companyEmail: companyEmail.trim(),
      vat,
    });
  };

  const passwordPlaceholder = settings?.hasPassword
    ? settings.passwordMask || '•••• •••• (пароль сохранён)'
    : 'Введите пароль АТОЛ';

  const snoLabel = SNO_OPTIONS.find((o) => o.value === sno)?.label;
  const vatLabel = VAT_OPTIONS.find((o) => o.value === vat)?.label;

  const s = sectionStyles(palette);

  return (
    <AnimatedCard index={index}>
      <View style={s.card}>
        <View style={s.cardHeader}>
          <View
            style={[
              s.iconBadge,
              { backgroundColor: palette.mode === 'dark' ? softTint(colors.green[600], 'dark') : colors.green[50] },
            ]}
          >
            <Ionicons name="receipt-outline" size={18} color={colors.green[600]} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.cardTitle}>Онлайн-касса 54-ФЗ</Text>
            <Text style={s.cardSubtitle}>АТОЛ Онлайн — фискализация чеков</Text>
          </View>
        </View>

        {isLoading && !settings ? (
          <ActivityIndicator style={{ marginVertical: spacing[4] }} color={palette.accent.primary} />
        ) : (
          <>
            <ToggleRow
              label="Фискализировать чеки"
              sub="Включите после ввода данных АТОЛ"
              value={enabled}
              onChange={(v) => {
                setEnabled(v);
                setDirty(true);
              }}
            />

            <Field
              label="Логин"
              value={login}
              onChangeText={(v) => {
                setLogin(v);
                setDirty(true);
              }}
              placeholder="Логин интеграции АТОЛ"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Field
              label="Пароль"
              value={password}
              onChangeText={(v) => {
                setPassword(v);
                setDirty(true);
              }}
              placeholder={passwordPlaceholder}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Field
              label="Код группы"
              value={groupCode}
              onChangeText={(v) => {
                setGroupCode(v);
                setDirty(true);
              }}
              placeholder="например, ATOL-ufd-prod"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <PickerField
              label="Система налогообложения (СНО)"
              valueLabel={snoLabel}
              placeholder="Выберите СНО"
              title="Система налогообложения"
              options={SNO_OPTIONS}
              selected={sno}
              onSelect={(v) => {
                setSno(v);
                setDirty(true);
              }}
            />

            <View style={s.rowFields}>
              <View style={{ flex: 1 }}>
                <Field
                  label="ИНН"
                  value={inn}
                  onChangeText={(v) => {
                    setInn(v.replace(/\D/g, '').slice(0, 12));
                    setDirty(true);
                  }}
                  placeholder="1234567890"
                  keyboardType="number-pad"
                />
              </View>
              <View style={{ flex: 1 }}>
                <PickerField
                  label="НДС"
                  valueLabel={vatLabel}
                  placeholder="Ставка"
                  title="Ставка НДС"
                  options={VAT_OPTIONS}
                  selected={vat}
                  onSelect={(v) => {
                    setVat(v);
                    setDirty(true);
                  }}
                />
              </View>
            </View>

            <Field
              label="Адрес расчётов"
              value={paymentAddress}
              onChangeText={(v) => {
                setPaymentAddress(v);
                setDirty(true);
              }}
              placeholder="г. Москва, ул. Примерная, д. 1"
            />

            <Field
              label="Email компании"
              value={companyEmail}
              onChangeText={(v) => {
                setCompanyEmail(v);
                setDirty(true);
              }}
              placeholder="info@autoservice.ru"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Text style={s.hint}>{CONFIG_HINT}</Text>

            {dirty && <SaveButton pending={mutation.isPending} onPress={handleSave} label="Сохранить кассу" />}
          </>
        )}
      </View>
    </AnimatedCard>
  );
}

// АТОЛ vat can come back as an unknown string; clamp to a known option.
function normalizeVat(v: FiscalVat | string | null | undefined): FiscalVat {
  const known = VAT_OPTIONS.map((o) => o.value);
  return (known as string[]).includes(v as string) ? (v as FiscalVat) : 'none';
}

// ── Apple Wallet — карта лояльности (.pkpass) ──────────────────────────
// Owner-class настройки серверной выдачи Apple Wallet pass'ов (backend wallet/).
// Подписывающий материал (certPem / certKeyPem / certKeyPassword / wwdrPem) —
// WRITE-ONLY: сервер возвращает только булевы флаги hasCert / hasCertKey /
// hasCertKeyPassword / hasWwdr, НИКОГДА сам PEM. Поэтому PEM/пароль шлём ТОЛЬКО
// когда владелец ввёл свежее значение (placeholder «загружен», когда флаг true)
// — пересохранение не стирает уже загруженный сертификат. `configured` =
// enabled + cert + key + WWDR + passTypeId + teamId на месте → карта выдаётся.

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function CertStatusChip({ label, ok }: { label: string; ok: boolean }) {
  const palette = useColors();
  const s = sectionStyles(palette);
  return (
    <View
      style={[
        s.statusChip,
        {
          backgroundColor: ok ? colors.green[50] : palette.bg.muted,
          borderColor: ok ? colors.green[200] : palette.border.subtle,
        },
      ]}
    >
      <Ionicons
        name={ok ? 'checkmark-circle' : 'ellipse-outline'}
        size={13}
        color={ok ? colors.green[600] : palette.text.tertiary}
      />
      <Text style={[s.statusChipText, { color: ok ? colors.green[700] : palette.text.tertiary }]}>{label}</Text>
    </View>
  );
}

function WalletSection({ index }: { index: number }) {
  const palette = useColors();
  const queryClient = useQueryClient();

  const { data: settings, isLoading } = useQuery<WalletSettings>({
    queryKey: ['wallet', 'settings'],
    queryFn: async () => (await walletApi.getSettings()).data,
  });

  const [enabled, setEnabled] = useState(false);
  const [passTypeId, setPassTypeId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [organizationName, setOrganizationName] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [bgColor, setBgColor] = useState('');
  // PEM / пароль — write-only: форма всегда стартует пустой, сервер их не отдаёт.
  const [certPem, setCertPem] = useState('');
  const [certKeyPem, setCertKeyPem] = useState('');
  const [certKeyPassword, setCertKeyPassword] = useState('');
  const [wwdrPem, setWwdrPem] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (settings) {
      setEnabled(!!settings.enabled);
      setPassTypeId(settings.passTypeId ?? '');
      setTeamId(settings.teamId ?? '');
      setOrganizationName(settings.organizationName ?? '');
      setLogoUrl(settings.logoUrl ?? '');
      setBgColor(settings.bgColor ?? '');
      setCertPem('');
      setCertKeyPem('');
      setCertKeyPassword('');
      setWwdrPem('');
      setDirty(false);
    }
  }, [settings]);

  const mutation = useMutation({
    mutationFn: (data: {
      enabled: boolean;
      passTypeId?: string;
      teamId?: string;
      organizationName?: string;
      logoUrl?: string;
      bgColor?: string;
      certPem?: string;
      certKeyPem?: string;
      certKeyPassword?: string;
      wwdrPem?: string;
    }) => walletApi.updateSettings(data),
    onSuccess: (res) => {
      queryClient.setQueryData(['wallet', 'settings'], res.data);
      queryClient.invalidateQueries({ queryKey: ['wallet', 'settings'] });
      haptic('success');
      setCertPem('');
      setCertKeyPem('');
      setCertKeyPassword('');
      setWwdrPem('');
      setDirty(false);
      Alert.alert('Готово', 'Настройки Apple Wallet сохранены');
    },
    onError: (e: any) => {
      haptic('error');
      Alert.alert('Ошибка', e?.response?.data?.message || 'Не удалось сохранить');
    },
  });

  const handleSave = () => {
    if (mutation.isPending) return;
    const cert = certPem.trim();
    const key = certKeyPem.trim();
    const keyPwd = certKeyPassword; // пароль может содержать пробелы — не trim'аем
    const wwdr = wwdrPem.trim();
    mutation.mutate({
      enabled,
      passTypeId: passTypeId.trim(),
      teamId: teamId.trim(),
      organizationName: organizationName.trim(),
      logoUrl: logoUrl.trim(),
      bgColor: bgColor.trim(),
      // PEM / пароль уходят на сервер ТОЛЬКО когда поле заполнено — пустое поле
      // оставляет уже загруженный секрет нетронутым (форма показывает флаг, не PEM).
      ...(cert ? { certPem: cert } : null),
      ...(key ? { certKeyPem: key } : null),
      ...(keyPwd ? { certKeyPassword: keyPwd } : null),
      ...(wwdr ? { wwdrPem: wwdr } : null),
    });
  };

  const certPlaceholder = (has: boolean | undefined, begin: string) =>
    has ? 'загружен — оставьте пустым, чтобы не менять' : begin;

  const s = sectionStyles(palette);

  return (
    <AnimatedCard index={index}>
      <View style={s.card}>
        <View style={s.cardHeader}>
          <View style={[s.iconBadge, { backgroundColor: palette.bg.muted }]}>
            <Ionicons name="wallet" size={18} color={palette.text.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.cardTitle}>Apple Wallet</Text>
            <Text style={s.cardSubtitle}>Карта лояльности клиента (.pkpass)</Text>
          </View>
        </View>

        {isLoading && !settings ? (
          <ActivityIndicator style={{ marginVertical: spacing[4] }} color={palette.accent.primary} />
        ) : (
          <>
            {/* Готовность карты — configured == enabled + cert + key + WWDR + IDs. */}
            <View
              style={[
                s.configuredBanner,
                {
                  backgroundColor: settings?.configured ? colors.green[50] : palette.bg.muted,
                },
              ]}
            >
              <Ionicons
                name={settings?.configured ? 'checkmark-circle' : 'information-circle-outline'}
                size={18}
                color={settings?.configured ? colors.green[600] : palette.text.tertiary}
              />
              <Text
                style={[
                  s.configuredBannerText,
                  { color: settings?.configured ? colors.green[700] : palette.text.secondary },
                ]}
              >
                {settings?.configured
                  ? 'Карта готова к выдаче — кнопка «Добавить в Apple Wallet» доступна в карточке клиента.'
                  : 'Карта недоступна — загрузите сертификат и включите выдачу.'}
              </Text>
            </View>

            <View style={s.statusRow}>
              <CertStatusChip label="Сертификат" ok={!!settings?.hasCert} />
              <CertStatusChip label="Ключ" ok={!!settings?.hasCertKey} />
              <CertStatusChip label="Пароль" ok={!!settings?.hasCertKeyPassword} />
              <CertStatusChip label="WWDR" ok={!!settings?.hasWwdr} />
            </View>

            <ToggleRow
              label="Выдавать карту лояльности"
              sub="Включите после загрузки сертификата Pass Type ID"
              value={enabled}
              onChange={(v) => {
                setEnabled(v);
                setDirty(true);
              }}
            />

            <Field
              label="Pass Type ID"
              value={passTypeId}
              onChangeText={(v) => {
                setPassTypeId(v);
                setDirty(true);
              }}
              placeholder="pass.com.autexa.loyalty"
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Field
              label="Team ID"
              value={teamId}
              onChangeText={(v) => {
                setTeamId(v);
                setDirty(true);
              }}
              placeholder="ABCDE12345"
              autoCapitalize="characters"
              autoCorrect={false}
            />

            <Field
              label="Название организации"
              value={organizationName}
              onChangeText={(v) => {
                setOrganizationName(v);
                setDirty(true);
              }}
              placeholder="Название на карте (по умолчанию — компания)"
            />

            <Field
              label="Логотип (URL)"
              value={logoUrl}
              onChangeText={(v) => {
                setLogoUrl(v);
                setDirty(true);
              }}
              placeholder="https://…/logo.png"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />

            <Field
              label="Цвет фона (HEX)"
              value={bgColor}
              onChangeText={(v) => {
                setBgColor(v);
                setDirty(true);
              }}
              placeholder="#1E88E5"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {HEX_RE.test(bgColor.trim()) ? (
              <View style={[s.colorSwatch, { backgroundColor: bgColor.trim(), borderColor: palette.border.subtle }]} />
            ) : null}

            <Field
              label="Сертификат Pass Type ID (PEM)"
              value={certPem}
              onChangeText={(v) => {
                setCertPem(v);
                setDirty(true);
              }}
              placeholder={certPlaceholder(settings?.hasCert, '-----BEGIN CERTIFICATE-----')}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
            />

            <Field
              label="Приватный ключ (PEM)"
              value={certKeyPem}
              onChangeText={(v) => {
                setCertKeyPem(v);
                setDirty(true);
              }}
              placeholder={certPlaceholder(settings?.hasCertKey, '-----BEGIN PRIVATE KEY-----')}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
            />

            <Field
              label="Пароль ключа"
              value={certKeyPassword}
              onChangeText={(v) => {
                setCertKeyPassword(v);
                setDirty(true);
              }}
              placeholder={settings?.hasCertKeyPassword ? 'загружен — оставьте пустым' : 'Если ключ зашифрован'}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />

            <Field
              label="Apple WWDR (PEM)"
              value={wwdrPem}
              onChangeText={(v) => {
                setWwdrPem(v);
                setDirty(true);
              }}
              placeholder={certPlaceholder(settings?.hasWwdr, '-----BEGIN CERTIFICATE-----')}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              hint="Промежуточный сертификат Apple Worldwide Developer Relations."
            />

            <Text style={s.hint}>{WALLET_HINT}</Text>

            {dirty && <SaveButton pending={mutation.isPending} onPress={handleSave} label="Сохранить Apple Wallet" />}
          </>
        )}
      </View>
    </AnimatedCard>
  );
}

// ── Reusable bits ──────────────────────────────────────────────────────

interface FieldProps {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  secureTextEntry?: boolean;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoCorrect?: boolean;
  keyboardType?: React.ComponentProps<typeof TextInput>['keyboardType'];
  // Многострочный ввод (PEM-сертификаты): высокое поле, текст сверху, без маски.
  multiline?: boolean;
  hint?: string;
}

function Field({ label, multiline, hint, ...rest }: FieldProps) {
  const palette = useColors();
  const s = sectionStyles(palette);
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        {...rest}
        multiline={multiline}
        style={[s.input, multiline && s.inputMultiline]}
        placeholderTextColor={palette.text.tertiary}
      />
      {hint ? <Text style={s.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

function ToggleRow({
  label,
  sub,
  value,
  onChange,
}: {
  label: string;
  sub?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  const palette = useColors();
  const s = sectionStyles(palette);
  return (
    <View style={s.toggleRow}>
      <View style={s.toggleTextWrap}>
        <Text style={s.toggleLabel}>{label}</Text>
        {sub ? <Text style={s.toggleSub}>{sub}</Text> : null}
      </View>
      <Switch
        value={value}
        onValueChange={(v) => {
          haptic('select');
          onChange(v);
        }}
        trackColor={{ false: palette.border.subtle, true: palette.accent.primary }}
        thumbColor={Platform.OS === 'android' ? colors.white : undefined}
        ios_backgroundColor={palette.border.subtle}
      />
    </View>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const palette = useColors();
  const s = sectionStyles(palette);
  return (
    <View style={s.segmented}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <TouchableOpacity
            key={opt.value}
            style={[s.segment, active && { backgroundColor: palette.bg.card }, active && s.segmentActiveShadow]}
            activeOpacity={0.8}
            onPress={() => {
              if (!active) {
                haptic('select');
                onChange(opt.value);
              }
            }}
          >
            <Text style={[s.segmentText, { color: active ? palette.text.primary : palette.text.tertiary }]}>
              {opt.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function PickerField<T extends string>({
  label,
  valueLabel,
  placeholder,
  title,
  options,
  selected,
  onSelect,
}: {
  label: string;
  valueLabel?: string;
  placeholder: string;
  title: string;
  options: { value: T; label: string }[];
  selected: T | null;
  onSelect: (v: T) => void;
}) {
  const palette = useColors();
  const s = sectionStyles(palette);
  const [open, setOpen] = useState(false);
  return (
    <View style={s.field}>
      <Text style={s.label}>{label}</Text>
      <TouchableOpacity
        style={s.pickerBtn}
        activeOpacity={0.7}
        onPress={() => {
          haptic('tap');
          setOpen(true);
        }}
      >
        <Text
          style={[s.pickerValue, { color: valueLabel ? palette.text.primary : palette.text.tertiary }]}
          numberOfLines={1}
        >
          {valueLabel || placeholder}
        </Text>
        <Ionicons name="chevron-down" size={16} color={palette.text.tertiary} />
      </TouchableOpacity>

      <Modal visible={open} onClose={() => setOpen(false)} title={title}>
        <View style={{ gap: spacing[1] }}>
          {options.map((opt) => {
            const active = opt.value === selected;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[
                  s.optionRow,
                  { borderColor: palette.border.subtle },
                  active && { backgroundColor: palette.accent.primarySoft, borderColor: palette.accent.primary },
                ]}
                activeOpacity={0.7}
                onPress={() => {
                  haptic('select');
                  onSelect(opt.value);
                  setOpen(false);
                }}
              >
                <Text style={[s.optionText, { color: palette.text.primary }]}>{opt.label}</Text>
                {active && <Ionicons name="checkmark" size={18} color={palette.accent.primary} />}
              </TouchableOpacity>
            );
          })}
        </View>
      </Modal>
    </View>
  );
}

function SaveButton({ pending, onPress, label }: { pending: boolean; onPress: () => void; label: string }) {
  const palette = useColors();
  const s = sectionStyles(palette);
  return (
    <TouchableOpacity
      style={[s.saveBtn, { backgroundColor: palette.accent.primary }, pending && { opacity: 0.6 }]}
      onPress={onPress}
      disabled={pending}
      activeOpacity={0.85}
    >
      {pending ? (
        <ActivityIndicator color={colors.white} size="small" />
      ) : (
        <>
          <Ionicons name="checkmark-circle-outline" size={18} color={colors.white} />
          <Text style={s.saveBtnText}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scrollContent: { padding: spacing[4], gap: spacing[4] },
  restricted: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[8],
    gap: spacing[3],
  },
  restrictedText: { fontSize: fontSize.sm, textAlign: 'center', lineHeight: 21 },
});

// Theme-aware styles built per render (cheap; mirrors how CompanySettings
// flattens palette into its static StyleSheet).
function sectionStyles(palette: ReturnType<typeof useColors>) {
  return StyleSheet.create({
    card: {
      backgroundColor: palette.bg.card,
      borderRadius: borderRadius['2xl'],
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border.subtle,
      padding: spacing[5],
      gap: spacing[3.5],
    },
    cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
    iconBadge: {
      width: 38,
      height: 38,
      borderRadius: borderRadius.lg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardTitle: {
      fontSize: fontSize.base,
      fontWeight: fontWeight.bold,
      color: palette.text.primary,
      letterSpacing: -0.3,
    },
    cardSubtitle: { fontSize: fontSize.xs, color: palette.text.tertiary, marginTop: 1 },

    field: { gap: spacing[1.5] },
    label: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: palette.text.secondary },
    input: {
      backgroundColor: palette.bg.muted,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border.subtle,
      borderRadius: borderRadius.xl,
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[2.5],
      fontSize: fontSize.sm,
      color: palette.text.primary,
    },
    inputMultiline: {
      minHeight: 92,
      paddingTop: spacing[2.5],
      textAlignVertical: 'top',
      fontSize: 12,
      fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    },
    fieldHint: { fontSize: 11, lineHeight: 15, color: palette.text.tertiary },
    hint: { fontSize: 11, lineHeight: 16, color: palette.text.tertiary },
    rowFields: { flexDirection: 'row', gap: spacing[3] },

    // Wallet — статус загруженных PEM-материалов + готовности карты.
    statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
    statusChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[1],
      borderWidth: StyleSheet.hairlineWidth,
      borderRadius: borderRadius.full,
      paddingHorizontal: spacing[2.5],
      paddingVertical: spacing[1.5],
    },
    statusChipText: { fontSize: 12, fontWeight: fontWeight.semibold },
    configuredBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      borderRadius: borderRadius.lg,
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2.5],
    },
    configuredBannerText: { flex: 1, fontSize: 12, fontWeight: fontWeight.medium, lineHeight: 16 },
    colorSwatch: {
      height: 10,
      borderRadius: 5,
      marginTop: spacing[1],
      borderWidth: StyleSheet.hairlineWidth,
    },

    toggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
    toggleTextWrap: { flex: 1, minWidth: 0 },
    toggleLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: palette.text.primary },
    toggleSub: { fontSize: 12, lineHeight: 17, marginTop: 2, color: palette.text.secondary },

    // Segmented control
    segmented: {
      flexDirection: 'row',
      backgroundColor: palette.bg.muted,
      borderRadius: borderRadius.lg,
      padding: 3,
      gap: 3,
    },
    segment: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing[2],
      borderRadius: borderRadius.md,
    },
    segmentActiveShadow: {
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 1 },
          shadowOpacity: 0.1,
          shadowRadius: 2,
        },
        android: { elevation: 1 },
      }),
    },
    segmentText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },

    // Picker
    pickerBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing[2],
      backgroundColor: palette.bg.muted,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: palette.border.subtle,
      borderRadius: borderRadius.xl,
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[3],
    },
    pickerValue: { flex: 1, fontSize: fontSize.sm },
    optionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderWidth: 1,
      borderRadius: borderRadius.lg,
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[3],
    },
    optionText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },

    saveBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing[2],
      borderRadius: borderRadius.xl,
      paddingVertical: spacing[3.5],
      marginTop: spacing[1],
    },
    saveBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.white },
  });
}
