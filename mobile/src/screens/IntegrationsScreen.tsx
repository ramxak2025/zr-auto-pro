/**
 * IntegrationsScreen — "Интеграции".
 *
 * Visual catalogue of available providers grouped by category:
 *   • Онлайн-касса          — 54-ФЗ фискализация (→ PaymentIntegrations)
 *   • Эквайринг             — приём оплат картой/СБП + Apple Wallet (→ PaymentIntegrations)
 *   • Телефония             — МоиЗвонки (SMS+phone), Мегафон ВАТС, Mango Office
 *   • Каналы рассылок       — WhatsApp Cloud API, SMS.RU, Telegram (бот → чат персонала)
 *
 * Автоуведомления «Машина готова» и площадки отзывов переехали в «Настройки»
 * (MarketingSettings) — этот экран теперь про подключение каналов, а не про их
 * настройку.
 *
 * Provider cards render the connection status pulled from
 * `marketingApi.getIntegrations()` for messaging providers. Tapping a card
 * opens a configuration modal where the owner can:
 *   • paste an API key / token (password input);
 *   • copy the webhook URL (auto-populated);
 *   • test the connection (lightweight server-side ping);
 *   • toggle the integration on/off;
 *   • delete an existing connection.
 *
 * Backend constraints (after migrations 054 + 087):
 *   • messaging_integrations.provider_type ∈
 *     ('whatsapp','sms','smsru','moizvonki','email','telegram')
 *     We pick the most appropriate enum for each card. 087 added Telegram
 *     plus two non-secret routing fields: `phoneNumberId` (WhatsApp Cloud API
 *     phone number id) and `chatId` (Telegram owner/staff chat). The api_key
 *     (Bearer token / bot token) stays write-only — never returned by the API.
 *   • review_platform_links.platform ∈ ('google','yandex','2gis','avito').
 *     Avito is a first-class platform now — owner pastes a profile URL.
 *   • car_ready_settings (087): { enabled, messageTemplate } — auto-notify the
 *     client when a check moves to «готова». Sent via the active provider.
 *
 * Owner-reported fixes (2026-05):
 *   • "Нет значка раздела Интеграции, нет значка Мегафон ВАТС" — both
 *     used Ionicons names that resolved to `Circle` in our Lucide shim.
 *     Switched Мегафон to `cellular` (mapped → Signal).
 *     MoreScreen entry now uses `extension-puzzle-outline` (Puzzle).
 *
 * Owner-reported redesign (2026-07):
 *   • "Иконки провайдеров — пустые/серые кружки" — every provider tile now
 *     renders a SOLID brand-colour tile with a WHITE glyph (iOS «app-icon»
 *     pattern) via `provider.brand` / `brandBg`+`brandFg`, so WhatsApp reads
 *     green, Telegram blue, SMS.RU orange, Мегафон зелёный и т.д. — узнаваемо
 *     в светлой и тёмной теме. Apple Wallet — адаптивный «графит».
 */
import React, { useMemo, useState } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Platform,
  Share,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import Constants from 'expo-constants';
import { useColors } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { marketingApi, telephonyApi } from '../api/services';
import { SERVER_URL } from '../api/axios';
import { colors, fontSize, fontWeight, borderRadius, spacing, softTint } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import IosScreenHeader from '../components/IosScreenHeader';
import AnimatedCard from '../components/AnimatedCard';
import Modal from '../components/Modal';
import { Text } from '../platform/Typography';
import { haptic } from '../platform/haptics';
import type { MessagingIntegration, TelephonySettings } from '../../../shared/types';

// ─────────────────────────────────────────────────────────────────────
//  Provider catalogue
// ─────────────────────────────────────────────────────────────────────

type ProviderKind = 'phone' | 'whatsapp';

interface ProviderDef {
  key: string;
  /** DB provider_type to store under. */
  dbType: 'whatsapp' | 'sms' | 'smsru' | 'moizvonki' | 'email' | 'telegram';
  kind: ProviderKind;
  name: string;
  description: string;
  iconName: keyof typeof import('@expo/vector-icons/build/Ionicons').default.glyphMap;
  /**
   * Solid brand colour for the icon tile. Rendered as a filled rounded tile with
   * a WHITE glyph on top (iOS «app-icon» pattern) — reads as a recognizable brand
   * badge in both light and dark, instead of the pale-tint «серый кружок» owner
   * reported. Use the provider's real brand colour where known.
   */
  brand: string;
  /** Field labels. */
  apiKeyLabel: string;
  /** Show senderPhone field. */
  needsPhone?: boolean;
  /** Show senderName field. */
  needsName?: boolean;
  /**
   * «Мои Звонки» has a DEDICATED two-field form that must match the backend
   * data contract (getMoiZvonkiConfig): `webhook_url` = the moizvonki SUBDOMAIN
   * (backend builds `https://<domain>.moizvonki.ru/api/v1`), `sender_name` =
   * the account EMAIL/login. It uses polling (no inbound autexa webhook), so we
   * must NOT send/show the auto `webhookUrlFor()` URL for it — doing so
   * overwrote the domain+login and broke «Мои Звонки». Mirrors the web form.
   */
  moizvonkiFields?: boolean;
  /** Show WhatsApp Cloud API «Phone number ID» field → phoneNumberId. */
  needsPhoneNumberId?: boolean;
  /** Show Telegram «Chat ID» field → chatId. */
  needsChatId?: boolean;
  /**
   * This provider can send SMS to CLIENTS. When true the config modal shows an
   * independent «Отправлять SMS клиентам» switch (migration 127), decoupled from
   * the connection on/off. WhatsApp/Telegram route to messengers, not SMS, so
   * they leave it undefined.
   */
  sendsClientSms?: boolean;
  /** Provider-specific notice rendered at the top of the config modal. */
  hint?: string;
}

const PHONE_PROVIDERS: ProviderDef[] = [
  {
    key: 'moizvonki',
    dbType: 'moizvonki',
    kind: 'phone',
    name: 'Мои Звонки',
    description: 'Виртуальная АТС, обработка звонков и SMS',
    iconName: 'call',
    brand: '#4F46E5', // индиго — телефония
    apiKeyLabel: 'Ключ API',
    moizvonkiFields: true,
    sendsClientSms: true,
  },
  {
    key: 'megafon',
    dbType: 'sms',
    kind: 'phone',
    name: 'Мегафон ВАТС',
    description: 'Звонки и SMS через Мегафон',
    iconName: 'cellular',
    brand: '#00B956', // фирменный зелёный Мегафона
    apiKeyLabel: 'Токен ВАТС',
    needsPhone: true,
    sendsClientSms: true,
  },
];

// Messengers share the same DB table (one row per provider_type). Each card
// maps to exactly ONE provider_type so it round-trips through getIntegrations
// without two cards fighting over the same row.
const MESSENGER_PROVIDERS: ProviderDef[] = [
  {
    key: 'whatsapp',
    dbType: 'whatsapp',
    kind: 'whatsapp',
    name: 'WhatsApp Business',
    description: 'WhatsApp Cloud API — сообщения клиентам',
    iconName: 'logo-whatsapp',
    brand: '#25D366', // фирменный зелёный WhatsApp
    // Cloud API auth = a permanent Bearer access token (write-only → apiKey)
    // routed by a Phone number ID (non-secret → phoneNumberId).
    apiKeyLabel: 'Access token',
    needsPhoneNumberId: true,
  },
  {
    key: 'telegram',
    dbType: 'telegram',
    kind: 'whatsapp',
    name: 'Telegram',
    description: 'Уведомления через Telegram-бота',
    iconName: 'paper-plane',
    brand: '#229ED9', // фирменный синий Telegram
    // Bot token (write-only → apiKey) + target chat (non-secret → chatId).
    apiKeyLabel: 'Токен бота',
    needsChatId: true,
    hint: 'Telegram отправляет уведомления в чат владельца/персонала, не клиенту',
  },
  {
    key: 'smsru',
    dbType: 'smsru',
    kind: 'whatsapp',
    name: 'SMS.RU',
    description: 'Массовые SMS-рассылки клиентам',
    iconName: 'chatbox-ellipses-outline',
    brand: '#F97316', // оранжевый — SMS-канал, отличается от синих мессенджеров
    apiKeyLabel: 'API ID',
    needsName: true,
    sendsClientSms: true,
  },
];

// ─────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────

function relativeTime(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'Только что';
  if (minutes < 60) return `${minutes} мин. назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ч. назад`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} дн. назад`;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function webhookUrlFor(providerKey: string, tenantId: string | undefined): string {
  const apiUrl: string = Constants.expoConfig?.extra?.apiUrl ?? 'https://autexa.pw/api';
  // Strip trailing /api so the webhook lives at /api/webhooks/...
  const base = apiUrl.replace(/\/api\/?$/, '');
  return `${base}/api/webhooks/${providerKey}/${tenantId || 'tenant_id'}`;
}

// Mango pushes VPBX call events to a PUBLIC, signature-verified callback that the
// owner must paste into Mango's VPBX settings. The route lives at
// `<origin>/api/telephony/webhook/<tenantId>` (server-only, not part of the client
// API). `SERVER_URL` is the axios baseURL with the trailing `/api` stripped — the
// canonical origin we already derive for image URLs — so the webhook is always
// pinned to the exact backend this build talks to.
function mangoWebhookUrl(tenantId: string | undefined): string {
  return `${SERVER_URL}/api/telephony/webhook/${tenantId || 'tenant_id'}`;
}

// ─────────────────────────────────────────────────────────────────────
//  Provider card
// ─────────────────────────────────────────────────────────────────────

interface ProviderCardProps {
  provider: ProviderDef;
  integration?: MessagingIntegration;
  onPress: () => void;
  index: number;
}

function ProviderCard({ provider, integration, onPress, index }: ProviderCardProps) {
  const palette = useColors();
  const connected = !!integration?.isActive;
  const setup = !!integration && !integration.isActive;
  const status: 'ok' | 'warn' | 'off' = connected ? 'ok' : setup ? 'warn' : 'off';
  const relative = relativeTime(integration?.createdAt);

  return (
    <AnimatedCard
      index={index}
      onPress={onPress}
      style={[styles.providerCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
    >
      <View style={styles.providerCardRow}>
        <View style={[styles.providerLogo, { backgroundColor: provider.brand }]}>
          <Ionicons name={provider.iconName as any} size={22} color={colors.white} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.providerName, { color: palette.text.primary }]} numberOfLines={1}>
            {provider.name}
          </Text>
          <Text style={[styles.providerDesc, { color: palette.text.tertiary }]} numberOfLines={2}>
            {provider.description}
          </Text>
          <View style={styles.providerMeta}>
            <StatusPill kind={status} />
            {connected && relative && (
              <Text style={[styles.providerActive, { color: palette.text.tertiary }]} numberOfLines={1}>
                · Активен · {relative}
              </Text>
            )}
          </View>
        </View>
        <Ionicons name="chevron-forward" size={18} color={palette.text.tertiary} />
      </View>
    </AnimatedCard>
  );
}

function StatusPill({ kind }: { kind: 'ok' | 'warn' | 'off' }) {
  const palette = useColors();
  const map = {
    ok: {
      bg: palette.mode === 'dark' ? softTint(colors.green[600], 'dark') : colors.green[50],
      fg: palette.mode === 'dark' ? colors.green[300] : colors.green[700],
      label: 'Подключено',
      dot: colors.green[500],
    },
    warn: {
      bg: palette.mode === 'dark' ? softTint(colors.amber[600], 'dark') : colors.amber[50],
      fg: palette.mode === 'dark' ? colors.amber[200] : colors.amber[700],
      label: 'Есть ошибки',
      dot: colors.amber[600],
    },
    off: {
      bg: palette.bg.muted,
      fg: palette.text.tertiary,
      label: 'Не подключено',
      dot: palette.border.strong,
    },
  }[kind];
  return (
    <View style={[styles.statusPill, { backgroundColor: map.bg }]}>
      <View style={[styles.statusDot, { backgroundColor: map.dot }]} />
      <Text style={[styles.statusPillText, { color: map.fg }]}>{map.label}</Text>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Money-integration entry card
//  A plain navigation row (not a connect-modal trigger): the эквайринг /
//  онлайн-касса / Apple Wallet settings live on PaymentIntegrationsScreen,
//  so these cards just push there. Reuses the provider-card visual language
//  so money + comms integrations read as one catalogue.
// ─────────────────────────────────────────────────────────────────────

interface MoneyEntryCardProps {
  name: string;
  description: string;
  iconName: keyof typeof import('@expo/vector-icons/build/Ionicons').default.glyphMap;
  /** Solid brand tile colour + glyph colour (usually white on brand). */
  brandBg: string;
  brandFg: string;
  onPress: () => void;
  index: number;
}

function MoneyEntryCard({ name, description, iconName, brandBg, brandFg, onPress, index }: MoneyEntryCardProps) {
  const palette = useColors();
  return (
    <AnimatedCard
      index={index}
      onPress={onPress}
      style={[styles.providerCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
    >
      <View style={styles.providerCardRow}>
        <View style={[styles.providerLogo, { backgroundColor: brandBg }]}>
          <Ionicons name={iconName as any} size={22} color={brandFg} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.providerName, { color: palette.text.primary }]} numberOfLines={1}>
            {name}
          </Text>
          <Text style={[styles.providerDesc, { color: palette.text.tertiary }]} numberOfLines={2}>
            {description}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={palette.text.tertiary} />
      </View>
    </AnimatedCard>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Provider connection modal
// ─────────────────────────────────────────────────────────────────────

function ProviderModal({
  provider,
  existing,
  onClose,
}: {
  provider: ProviderDef | null;
  existing?: MessagingIntegration;
  onClose: () => void;
}) {
  const palette = useColors();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const tenantId = user?.tenantId;

  const [apiKey, setApiKey] = useState('');
  const [senderPhone, setSenderPhone] = useState('');
  const [senderName, setSenderName] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [chatId, setChatId] = useState('');
  // «Мои Звонки» — поддомен в moizvonki.ru, хранится в webhookUrl (см. бэк
  // getMoiZvonkiConfig). Отдельный state, т.к. для остальных провайдеров
  // webhookUrl — авто-URL autexa, который «Мои Звонки» НЕ использует.
  const [moizvonkiDomain, setMoizvonkiDomain] = useState('');
  const [isActive, setIsActive] = useState(true);
  // Independent outbound-SMS switch (127) — decoupled from isActive. Defaults on.
  const [smsEnabled, setSmsEnabled] = useState(true);
  const [testStatus, setTestStatus] = useState<'idle' | 'ok' | 'err'>('idle');
  const [copied, setCopied] = useState(false);

  // Re-initialise fields whenever a different provider opens. The api_key is
  // write-only (never returned), so it always starts blank; the non-secret
  // routing fields (phoneNumberId / chatId) are pre-filled from the server.
  React.useEffect(() => {
    if (!provider) return;
    setApiKey('');
    setSenderPhone(existing?.senderPhone || '');
    setSenderName(existing?.senderName || '');
    setPhoneNumberId(existing?.phoneNumberId || '');
    setChatId(existing?.chatId || '');
    // Для «Мои Звонки» webhookUrl — это сохранённый поддомен.
    setMoizvonkiDomain(existing?.webhookUrl || '');
    setIsActive(existing ? existing.isActive : true);
    // Legacy rows are server-backfilled to true; a brand-new integration also
    // starts sending SMS unless the owner mutes it.
    setSmsEnabled(existing ? existing.smsNotificationsEnabled !== false : true);
    setTestStatus('idle');
    setCopied(false);
  }, [provider, existing]);

  const webhookUrl = useMemo(() => (provider ? webhookUrlFor(provider.key, tenantId) : ''), [provider, tenantId]);

  const save = useMutation({
    mutationFn: (payload: any) => marketingApi.upsertIntegration(payload),
    onSuccess: () => {
      haptic('success');
      queryClient.invalidateQueries({ queryKey: ['marketing-integrations'] });
      Alert.alert('Готово', 'Интеграция сохранена');
      onClose();
    },
    onError: (e: any) => {
      haptic('error');
      Alert.alert('Ошибка', e?.response?.data?.message || 'Не удалось сохранить');
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => marketingApi.removeIntegration(id),
    onSuccess: () => {
      haptic('success');
      queryClient.invalidateQueries({ queryKey: ['marketing-integrations'] });
      onClose();
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось отключить интеграцию');
    },
  });

  const test = useMutation({
    mutationFn: () => marketingApi.testIntegration(existing?.id),
    onSuccess: () => {
      haptic('success');
      setTestStatus('ok');
    },
    onError: () => {
      haptic('error');
      setTestStatus('err');
    },
  });

  if (!provider) return null;

  const handleSave = () => {
    if (!apiKey.trim() && !existing) {
      Alert.alert('Ошибка', `Введите ${provider.apiKeyLabel}`);
      return;
    }
    if (provider.needsPhoneNumberId && !phoneNumberId.trim()) {
      Alert.alert('Ошибка', 'Введите Phone number ID');
      return;
    }
    if (provider.needsChatId && !chatId.trim()) {
      Alert.alert('Ошибка', 'Введите Chat ID');
      return;
    }
    if (provider.moizvonkiFields) {
      if (!moizvonkiDomain.trim()) {
        Alert.alert('Ошибка', 'Введите домен (поддомен в moizvonki.ru)');
        return;
      }
      if (!senderName.trim()) {
        Alert.alert('Ошибка', 'Введите Email (логин в Мои Звонки)');
        return;
      }
    }
    save.mutate({
      id: existing?.id,
      providerType: provider.dbType,
      // Sentinel «keep existing» — backend leaves the stored token untouched
      // when the owner doesn't re-enter the write-only key on edit.
      apiKey: apiKey.trim() || '_existing_',
      senderName: senderName.trim() || undefined,
      senderPhone: senderPhone.trim() || undefined,
      phoneNumberId: provider.needsPhoneNumberId ? phoneNumberId.trim() || undefined : undefined,
      chatId: provider.needsChatId ? chatId.trim() || undefined : undefined,
      // Persist the independent client-SMS switch only for SMS-capable providers;
      // omitting it for others leaves the stored value untouched server-side.
      smsNotificationsEnabled: provider.sendsClientSms ? smsEnabled : undefined,
      // «Мои Звонки» хранит в webhookUrl СВОЙ поддомен (бэк строит из него
      // https://<домен>.moizvonki.ru/api/v1) — НЕ авто-URL autexa (он polling,
      // без входящего webhook). Для всех прочих — авто-URL как раньше.
      webhookUrl: provider.moizvonkiFields ? moizvonkiDomain.trim() : webhookUrl,
      isActive,
    });
  };

  const handleCopyWebhook = async () => {
    // No `expo-clipboard` in the project — surface the share sheet so
    // the owner can drop the URL into their email / messenger.
    try {
      await Share.share({ message: webhookUrl, url: webhookUrl });
      haptic('success');
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // User dismissed — not an error.
    }
  };

  const handleDisconnect = () => {
    if (!existing) return;
    Alert.alert('Отключить интеграцию', `Удалить «${provider.name}»?`, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Отключить',
        style: 'destructive',
        onPress: () => remove.mutate(existing.id),
      },
    ]);
  };

  return (
    <Modal visible={!!provider} onClose={onClose} title={provider.name}>
      <View style={styles.modalHeaderBlock}>
        <View style={[styles.modalLogo, { backgroundColor: provider.brand }]}>
          <Ionicons name={provider.iconName as any} size={26} color={colors.white} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.modalDesc, { color: palette.text.secondary }]}>{provider.description}</Text>
        </View>
      </View>

      {/* Provider-specific notice (e.g. Telegram routes to owner/staff chat) */}
      {provider.hint && (
        <View
          style={[
            styles.notice,
            { borderColor: palette.border.subtle, backgroundColor: palette.bg.muted, marginBottom: spacing[3] },
          ]}
        >
          <Ionicons name="information-circle-outline" size={16} color={palette.text.secondary} />
          <Text style={[styles.noticeText, { color: palette.text.secondary }]}>{provider.hint}</Text>
        </View>
      )}

      {/* API key (write-only — masked on edit, only sent when re-entered) */}
      <View style={styles.formField}>
        <Text style={[styles.formLabel, { color: palette.text.secondary }]}>{provider.apiKeyLabel}</Text>
        <TextInput
          value={apiKey}
          onChangeText={setApiKey}
          style={[
            styles.formInput,
            {
              backgroundColor: palette.bg.muted,
              borderColor: palette.border.subtle,
              color: palette.text.primary,
            },
          ]}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={existing ? '••••••••••• (оставьте пустым)' : 'Вставьте ключ'}
          placeholderTextColor={palette.text.tertiary}
        />
      </View>

      {/* «Мои Звонки» — домен (поддомен) + email (логин). Совпадает с веб-формой
          и контрактом бэка getMoiZvonkiConfig: домен → webhookUrl, email →
          senderName. */}
      {provider.moizvonkiFields && (
        <>
          <View style={styles.formField}>
            <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Домен (поддомен в moizvonki.ru)</Text>
            <View style={styles.moizvonkiDomainRow}>
              <TextInput
                value={moizvonkiDomain}
                onChangeText={(t) => setMoizvonkiDomain(t.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                style={[
                  styles.formInput,
                  styles.moizvonkiDomainInput,
                  {
                    backgroundColor: palette.bg.muted,
                    borderColor: palette.border.subtle,
                    color: palette.text.primary,
                  },
                ]}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                placeholder="mycompany"
                placeholderTextColor={palette.text.tertiary}
              />
              <View
                style={[
                  styles.moizvonkiSuffix,
                  { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
                ]}
              >
                <Text style={[styles.moizvonkiSuffixText, { color: palette.text.tertiary }]}>.moizvonki.ru</Text>
              </View>
            </View>
            <Text style={{ fontSize: 11, color: palette.text.tertiary, marginTop: spacing[1] }}>
              Если адрес mycompany.moizvonki.ru — введите mycompany
            </Text>
          </View>

          <View style={styles.formField}>
            <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Email (логин в Мои Звонки)</Text>
            <TextInput
              value={senderName}
              onChangeText={setSenderName}
              style={[
                styles.formInput,
                {
                  backgroundColor: palette.bg.muted,
                  borderColor: palette.border.subtle,
                  color: palette.text.primary,
                },
              ]}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="user@mail.ru"
              placeholderTextColor={palette.text.tertiary}
            />
          </View>
        </>
      )}

      {/* WhatsApp Cloud API — Phone number ID (non-secret routing id) */}
      {provider.needsPhoneNumberId && (
        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Phone number ID</Text>
          <TextInput
            value={phoneNumberId}
            onChangeText={setPhoneNumberId}
            style={[
              styles.formInput,
              {
                backgroundColor: palette.bg.muted,
                borderColor: palette.border.subtle,
                color: palette.text.primary,
              },
            ]}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="number-pad"
            placeholder="Напр. 123456789012345"
            placeholderTextColor={palette.text.tertiary}
          />
          <Text style={{ fontSize: 11, color: palette.text.tertiary, marginTop: spacing[1] }}>
            Из Meta for Developers → WhatsApp → API Setup
          </Text>
        </View>
      )}

      {/* Telegram — Chat ID (owner/staff chat the bot posts to) */}
      {provider.needsChatId && (
        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Chat ID</Text>
          <TextInput
            value={chatId}
            onChangeText={setChatId}
            style={[
              styles.formInput,
              {
                backgroundColor: palette.bg.muted,
                borderColor: palette.border.subtle,
                color: palette.text.primary,
              },
            ]}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="Напр. -1001234567890"
            placeholderTextColor={palette.text.tertiary}
          />
          <Text style={{ fontSize: 11, color: palette.text.tertiary, marginTop: spacing[1] }}>
            ID чата или группы. Узнать можно через @userinfobot
          </Text>
        </View>
      )}

      {provider.needsPhone && (
        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>
            {provider.kind === 'whatsapp' ? 'Номер WhatsApp' : 'Виртуальный номер'}
          </Text>
          <TextInput
            value={senderPhone}
            onChangeText={setSenderPhone}
            style={[
              styles.formInput,
              {
                backgroundColor: palette.bg.muted,
                borderColor: palette.border.subtle,
                color: palette.text.primary,
              },
            ]}
            keyboardType="phone-pad"
            placeholder="+7 999 123-45-67"
            placeholderTextColor={palette.text.tertiary}
          />
        </View>
      )}

      {provider.needsName && (
        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Имя отправителя</Text>
          <TextInput
            value={senderName}
            onChangeText={setSenderName}
            style={[
              styles.formInput,
              {
                backgroundColor: palette.bg.muted,
                borderColor: palette.border.subtle,
                color: palette.text.primary,
              },
            ]}
            autoCapitalize="words"
            placeholder="Autexa"
            placeholderTextColor={palette.text.tertiary}
          />
        </View>
      )}

      {/* Webhook — авто-URL autexa для входящих webhook'ов провайдера. «Мои
          Звонки» работает по polling (без входящего webhook) и НЕ показывает
          этот блок: его webhookUrl занят под поддомен. */}
      {!provider.moizvonkiFields && (
        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Webhook URL</Text>
          <View style={[styles.webhookRow, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
            <Text
              style={[styles.webhookText, { color: palette.text.primary }]}
              numberOfLines={1}
              ellipsizeMode="middle"
            >
              {webhookUrl}
            </Text>
            <TouchableOpacity
              onPress={handleCopyWebhook}
              hitSlop={6}
              style={[styles.webhookCopy, { backgroundColor: palette.bg.card }]}
              accessibilityRole="button"
              accessibilityLabel="Поделиться webhook"
            >
              <Ionicons
                name={copied ? 'checkmark' : 'share-outline'}
                size={16}
                color={copied ? colors.green[600] : palette.text.secondary}
              />
            </TouchableOpacity>
          </View>
          <Text style={{ fontSize: 11, color: palette.text.tertiary, marginTop: spacing[1] }}>
            Нажмите «Поделиться», чтобы перенести URL в почту или мессенджер и вставить в личный кабинет провайдера
          </Text>
        </View>
      )}

      {/* Active toggle */}
      <TouchableOpacity
        style={[styles.activeRow, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
        onPress={() => {
          haptic('select');
          setIsActive((v) => !v);
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={[styles.activeLabel, { color: palette.text.primary }]}>Использовать как основной</Text>
          <Text style={[styles.activeSub, { color: palette.text.tertiary }]}>
            Отключите, чтобы сохранить настройки, но не использовать
          </Text>
        </View>
        <View
          style={[styles.switchTrack, { backgroundColor: isActive ? palette.accent.primary : palette.border.strong }]}
        >
          <View style={[styles.switchThumb, { transform: [{ translateX: isActive ? 20 : 2 }] }]} />
        </View>
      </TouchableOpacity>

      {/* Independent client-SMS switch (127) — separate from the connection
          on/off. Muting it stops client SMS while the integration stays
          connected; for «Мои Звонки» call sync keeps working regardless. */}
      {provider.sendsClientSms && (
        <TouchableOpacity
          style={[styles.activeRow, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
          onPress={() => {
            haptic('select');
            setSmsEnabled((v) => !v);
          }}
          accessibilityRole="switch"
          accessibilityState={{ checked: smsEnabled }}
        >
          <View style={{ flex: 1 }}>
            <Text style={[styles.activeLabel, { color: palette.text.primary }]}>Отправлять SMS клиентам</Text>
            <Text style={[styles.activeSub, { color: palette.text.tertiary }]}>
              {smsEnabled
                ? 'SMS клиентам отправляются через этот сервис'
                : 'SMS клиентам не отправляются — интеграция остаётся подключённой, синхронизация звонков не затрагивается'}
            </Text>
          </View>
          <View
            style={[
              styles.switchTrack,
              { backgroundColor: smsEnabled ? palette.accent.primary : palette.border.strong },
            ]}
          >
            <View style={[styles.switchThumb, { transform: [{ translateX: smsEnabled ? 20 : 2 }] }]} />
          </View>
        </TouchableOpacity>
      )}

      {/* Test connection */}
      <TouchableOpacity
        style={[
          styles.secondaryBtn,
          { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
          test.isPending && { opacity: 0.6 },
        ]}
        onPress={() => {
          haptic('tap');
          setTestStatus('idle');
          test.mutate();
        }}
        disabled={test.isPending}
      >
        {test.isPending ? (
          <ActivityIndicator size="small" color={palette.text.secondary} />
        ) : testStatus === 'ok' ? (
          <>
            <Ionicons name="checkmark-circle" size={16} color={colors.green[600]} />
            <Text style={[styles.secondaryBtnText, { color: colors.green[700] }]}>Подключение работает</Text>
          </>
        ) : testStatus === 'err' ? (
          <>
            <Ionicons name="alert-circle" size={16} color={colors.red[600]} />
            <Text style={[styles.secondaryBtnText, { color: colors.red[700] }]}>Тест не прошёл</Text>
          </>
        ) : (
          <>
            <Ionicons name="flash-outline" size={16} color={palette.text.secondary} />
            <Text style={[styles.secondaryBtnText, { color: palette.text.secondary }]}>Тест подключения</Text>
          </>
        )}
      </TouchableOpacity>

      {/* Save / Disconnect */}
      <TouchableOpacity
        style={[
          styles.primaryBtn,
          { backgroundColor: palette.accent.primary, marginTop: spacing[3] },
          save.isPending && { opacity: 0.6 },
        ]}
        onPress={handleSave}
        disabled={save.isPending}
      >
        {save.isPending ? (
          <ActivityIndicator size="small" color={colors.white} />
        ) : (
          <>
            <Ionicons name="checkmark" size={16} color={colors.white} />
            <Text style={styles.primaryBtnText}>Сохранить</Text>
          </>
        )}
      </TouchableOpacity>

      {existing && (
        <TouchableOpacity
          style={[styles.dangerBtn, remove.isPending && { opacity: 0.6 }]}
          onPress={handleDisconnect}
          disabled={remove.isPending}
        >
          <Ionicons name="close-circle-outline" size={16} color={colors.red[600]} />
          <Text style={[styles.secondaryBtnText, { color: colors.red[700] }]}>Отключить</Text>
        </TouchableOpacity>
      )}

      {/* Log placeholder */}
      <View style={[styles.logBlock, { borderColor: palette.border.subtle, backgroundColor: palette.bg.muted }]}>
        <View style={styles.logHeader}>
          <Ionicons name="terminal-outline" size={14} color={palette.text.tertiary} />
          <Text style={[styles.logHeaderText, { color: palette.text.secondary }]}>Журнал событий</Text>
        </View>
        <Text style={[styles.logEmpty, { color: palette.text.tertiary }]}>
          Записи появятся после первого webhook-вызова
        </Text>
      </View>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Screen
// ─────────────────────────────────────────────────────────────────────

export default function IntegrationsScreen() {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();

  const [openProvider, setOpenProvider] = useState<ProviderDef | null>(null);
  const [mangoOpen, setMangoOpen] = useState(false);

  const integrationsQuery = useQuery({
    queryKey: ['marketing-integrations'],
    queryFn: async () => (await marketingApi.getIntegrations()).data,
    staleTime: 60_000,
  });

  const integrations: MessagingIntegration[] = Array.isArray(integrationsQuery.data) ? integrationsQuery.data : [];

  // Find which DB row matches each visual provider card. We key by
  // `dbType` because the DB only stores the enum, not our visual key.
  const findIntegration = (p: ProviderDef): MessagingIntegration | undefined =>
    integrations.find((i) => i.providerType === p.dbType);

  const loading = integrationsQuery.isLoading;

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Интеграции" onBack={() => navigation.goBack()} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + spacing[4] }]}
      >
        <Text style={[styles.heroSub, { color: palette.text.secondary }]}>
          Подключайте сервисы — приём оплат, касса, звонки и каналы рассылок
        </Text>

        {/* 1. Онлайн-касса 54-ФЗ — the fiscalization settings live on their own
            screen (PaymentIntegrations) because their secrets + long forms differ
            from the messaging flow. Surfaced here so it's reachable from one
            «Интеграции» roof. The target screen self-gates to owner-class. */}
        <SectionHeader title="Онлайн-касса" hint="54-ФЗ · фискализация" />
        <View style={{ gap: spacing[2.5] }}>
          <MoneyEntryCard
            index={0}
            name="Онлайн-касса 54-ФЗ"
            description="АТОЛ Онлайн — фискализация чеков"
            iconName="receipt"
            brandBg="#16A34A"
            brandFg={colors.white}
            onPress={() => {
              haptic('tap');
              navigation.navigate('PaymentIntegrations');
            }}
          />
        </View>
        <View style={{ height: spacing[5] }} />

        {/* 2. Эквайринг — приём оплат картой/СБП + Apple Wallet. Same target
            screen (PaymentIntegrations), grouped apart from фискализация. */}
        <SectionHeader title="Эквайринг" hint="Приём оплат картой и СБП" />
        <View style={{ gap: spacing[2.5] }}>
          <MoneyEntryCard
            index={0}
            name="Приём оплаты картой и СБП"
            description="Эквайринг — ЮKassa или Тинькофф"
            iconName="card"
            brandBg="#2563EB"
            brandFg={colors.white}
            onPress={() => {
              haptic('tap');
              navigation.navigate('PaymentIntegrations');
            }}
          />
          <MoneyEntryCard
            index={1}
            name="Apple Wallet"
            description="Карта лояльности клиента (.pkpass)"
            iconName="wallet"
            // Apple Wallet — нейтральный «графит»: чёрная плитка + белый глиф в
            // светлой теме, белая плитка + тёмный глиф в тёмной (Apple-эстетика,
            // контраст сохраняется в обоих режимах).
            brandBg={palette.text.primary}
            brandFg={palette.bg.card}
            onPress={() => {
              haptic('tap');
              navigation.navigate('PaymentIntegrations');
            }}
          />
        </View>
        <View style={{ height: spacing[5] }} />

        {loading && integrations.length === 0 ? (
          <ActivityIndicator color={palette.accent.primary} style={{ marginTop: spacing[8] }} />
        ) : (
          <>
            {/* 3. Телефония — phone providers + Mango Office */}
            <SectionHeader title="Телефония" hint="Звонки и SMS" />
            <View style={{ gap: spacing[2.5] }}>
              {PHONE_PROVIDERS.map((p, idx) => (
                <ProviderCard
                  key={p.key}
                  provider={p}
                  integration={findIntegration(p)}
                  onPress={() => {
                    haptic('tap');
                    setOpenProvider(p);
                  }}
                  index={idx}
                />
              ))}
            </View>

            {/* Mango Office — виртуальная АТС (own backend: telephonyApi). Now a
                compact tap-to-open card (like every other provider); its config —
                секреты + callback URL — живут в модалке MangoModal. */}
            <View style={{ height: spacing[2.5] }} />
            <MangoCard
              index={PHONE_PROVIDERS.length}
              onPress={() => {
                haptic('tap');
                setMangoOpen(true);
              }}
            />

            {/* 4. Каналы рассылок — WhatsApp Cloud API + SMS.RU + Telegram */}
            <View style={{ height: spacing[5] }} />
            <SectionHeader title="Каналы рассылок" hint="WhatsApp · SMS.RU · Telegram" />
            <View style={{ gap: spacing[2.5] }}>
              {MESSENGER_PROVIDERS.map((p, idx) => (
                <ProviderCard
                  key={p.key}
                  provider={p}
                  integration={findIntegration(p)}
                  onPress={() => {
                    haptic('tap');
                    setOpenProvider(p);
                  }}
                  index={idx}
                />
              ))}
            </View>
          </>
        )}
      </ScrollView>

      <ProviderModal
        provider={openProvider}
        existing={openProvider ? findIntegration(openProvider) : undefined}
        onClose={() => setOpenProvider(null)}
      />

      <MangoModal visible={mangoOpen} onClose={() => setMangoOpen(false)} />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Mango Office (виртуальная АТС) — телефония config
//
//  Distinct from the marketing PHONE_PROVIDERS cards: Mango lives in its own
//  backend (telephonyApi, migration 088) with a masked write-only api_key +
//  api_salt and a server-only signature-verified callback the owner pastes into
//  Mango's VPBX settings. Incoming/missed calls land in the existing calls list
//  (CallsScreen) once the owner enters real keys AND flips the toggle on.
// ─────────────────────────────────────────────────────────────────────

// Mango Office — фирменный «коралловый» тон. Плитка сплошного цвета + белый глиф.
const MANGO_BRAND = '#E11D48';

/** Read-only view of Mango's connection state for the compact catalogue card. */
function useMangoStatus(): 'ok' | 'warn' | 'off' {
  const settingsQuery = useQuery({
    queryKey: ['telephony-settings'],
    queryFn: async () => (await telephonyApi.getSettings()).data,
    staleTime: 60_000,
  });
  const settings: TelephonySettings | undefined = settingsQuery.data;
  const configured = !!settings?.hasApiKey && !!settings?.hasApiSalt;
  return settings?.enabled && configured ? 'ok' : configured ? 'warn' : 'off';
}

/**
 * Mango Office — compact tap-to-open card, matching every other provider's
 * ProviderCard visual language (logo pill · name · desc · StatusPill · chevron).
 * The full config form lives in MangoModal, opened on tap.
 */
function MangoCard({ onPress, index }: { onPress: () => void; index: number }) {
  const palette = useColors();
  const status = useMangoStatus();

  return (
    <AnimatedCard
      index={index}
      onPress={onPress}
      style={[styles.providerCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
    >
      <View style={styles.providerCardRow}>
        <View style={[styles.providerLogo, { backgroundColor: MANGO_BRAND }]}>
          <Ionicons name="call" size={22} color={colors.white} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.providerName, { color: palette.text.primary }]} numberOfLines={1}>
            Mango Office
          </Text>
          <Text style={[styles.providerDesc, { color: palette.text.tertiary }]} numberOfLines={2}>
            Виртуальная АТС — входящие и пропущенные звонки
          </Text>
          <View style={styles.providerMeta}>
            <StatusPill kind={status} />
          </View>
        </View>
        <Ionicons name="chevron-forward" size={18} color={palette.text.tertiary} />
      </View>
    </AnimatedCard>
  );
}

/**
 * Mango Office config modal — same tap-to-open pattern as ProviderModal.
 *
 * Distinct from the marketing PHONE_PROVIDERS cards: Mango lives in its own
 * backend (telephonyApi, migration 088) with a masked write-only api_key +
 * api_salt and a server-only signature-verified callback the owner pastes into
 * Mango's VPBX settings. Incoming/missed calls land in the existing calls list
 * (CallsScreen) once the owner enters real keys AND flips the toggle on.
 */
function MangoModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const palette = useColors();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const tenantId = user?.tenantId;

  const settingsQuery = useQuery({
    queryKey: ['telephony-settings'],
    queryFn: async () => (await telephonyApi.getSettings()).data,
    staleTime: 60_000,
  });
  const settings: TelephonySettings | undefined = settingsQuery.data;

  // Both secrets are WRITE-ONLY — the inputs always start blank and only carry a
  // value when the owner re-types one. The masks live on the server response and
  // are surfaced as placeholders, never as editable text.
  const [enabled, setEnabled] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [apiSalt, setApiSalt] = useState('');
  const [copied, setCopied] = useState(false);

  // Re-hydrate the toggle from the server every time the sheet (re)opens, so
  // reopening reflects the stored state; while open, a background refetch never
  // flips an unsaved switch (guarded by `visible`).
  React.useEffect(() => {
    if (visible && settings) {
      setEnabled(!!settings.enabled);
      setApiKey('');
      setApiSalt('');
      setCopied(false);
    }
    // Only re-sync on open transition, not on every settings refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const webhookUrl = useMemo(() => mangoWebhookUrl(tenantId), [tenantId]);

  const save = useMutation({
    mutationFn: () => {
      const key = apiKey.trim();
      const salt = apiSalt.trim();
      return telephonyApi.updateSettings({
        provider: 'mango',
        enabled,
        // Send a secret ONLY when re-entered — an omitted field leaves the
        // stored value untouched server-side.
        ...(key ? { apiKey: key } : {}),
        ...(salt ? { apiSalt: salt } : {}),
      });
    },
    onSuccess: () => {
      haptic('success');
      // Drop the typed secrets so they don't linger in memory; the refetched
      // masks now reflect the freshly stored values.
      setApiKey('');
      setApiSalt('');
      queryClient.invalidateQueries({ queryKey: ['telephony-settings'] });
      Alert.alert('Готово', 'Настройки телефонии сохранены');
      onClose();
    },
    onError: (e: any) => {
      haptic('error');
      Alert.alert('Ошибка', e?.response?.data?.message || 'Не удалось сохранить');
    },
  });

  const handleSave = () => {
    const key = apiKey.trim();
    const salt = apiSalt.trim();
    // Enabling without any stored OR freshly entered secret would leave the
    // integration inert — block it with a clear message rather than a silent no-op.
    if (enabled && !key && !settings?.hasApiKey) {
      Alert.alert('Ошибка', 'Введите API ключ Mango (vpbx)');
      return;
    }
    if (enabled && !salt && !settings?.hasApiSalt) {
      Alert.alert('Ошибка', 'Введите ключ подписи (Sign / salt)');
      return;
    }
    save.mutate();
  };

  const handleCopyWebhook = async () => {
    // No `expo-clipboard` in the project — surface the share sheet so the owner
    // can drop the URL into Mango's VPBX settings via email / messenger.
    try {
      await Share.share({ message: webhookUrl, url: webhookUrl });
      haptic('success');
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // User dismissed — not an error.
    }
  };

  return (
    <Modal visible={visible} onClose={onClose} title="Mango Office">
      <View style={styles.modalHeaderBlock}>
        <View style={[styles.modalLogo, { backgroundColor: MANGO_BRAND }]}>
          <Ionicons name="call" size={26} color={colors.white} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.modalDesc, { color: palette.text.secondary }]}>
            Виртуальная АТС — входящие и пропущенные звонки в списке звонков
          </Text>
        </View>
      </View>

      {/* Hint */}
      <View
        style={[
          styles.notice,
          { borderColor: palette.border.subtle, backgroundColor: palette.bg.muted, marginBottom: spacing[3] },
        ]}
      >
        <Ionicons name="information-circle-outline" size={16} color={palette.text.secondary} />
        <Text style={[styles.noticeText, { color: palette.text.secondary }]}>
          Ключи — в личном кабинете Mango. До ввода телефония неактивна.
        </Text>
      </View>

      {/* Enabled toggle */}
      <TouchableOpacity
        style={[styles.activeRow, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
        onPress={() => {
          haptic('select');
          setEnabled((v) => !v);
        }}
        accessibilityRole="switch"
        accessibilityState={{ checked: enabled }}
      >
        <View style={{ flex: 1 }}>
          <Text style={[styles.activeLabel, { color: palette.text.primary }]}>Включить телефонию</Text>
          <Text style={[styles.activeSub, { color: palette.text.tertiary }]}>
            Звонки начнут попадать в список после ввода ключей
          </Text>
        </View>
        <View
          style={[styles.switchTrack, { backgroundColor: enabled ? palette.accent.primary : palette.border.strong }]}
        >
          <View style={[styles.switchThumb, { transform: [{ translateX: enabled ? 20 : 2 }] }]} />
        </View>
      </TouchableOpacity>

      {/* API key (write-only — masked on edit, only sent when re-entered) */}
      <View style={styles.formField}>
        <Text style={[styles.formLabel, { color: palette.text.secondary }]}>API ключ (vpbx)</Text>
        <TextInput
          value={apiKey}
          onChangeText={setApiKey}
          style={[
            styles.formInput,
            { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
          ]}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={
            settings?.hasApiKey ? settings.apiKeyMask || '••••••••••• (оставьте пустым)' : 'Вставьте API ключ'
          }
          placeholderTextColor={palette.text.tertiary}
        />
        {settings?.hasApiKey ? (
          <Text style={{ fontSize: 11, color: palette.text.tertiary, marginTop: spacing[1] }}>
            Ключ сохранён. Оставьте пустым, чтобы не менять.
          </Text>
        ) : null}
      </View>

      {/* Sign salt (write-only — masked on edit, only sent when re-entered) */}
      <View style={styles.formField}>
        <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Ключ подписи (Sign / salt)</Text>
        <TextInput
          value={apiSalt}
          onChangeText={setApiSalt}
          style={[
            styles.formInput,
            { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
          ]}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          placeholder={
            settings?.hasApiSalt ? settings.apiSaltMask || '••••••••••• (оставьте пустым)' : 'Вставьте ключ подписи'
          }
          placeholderTextColor={palette.text.tertiary}
        />
        {settings?.hasApiSalt ? (
          <Text style={{ fontSize: 11, color: palette.text.tertiary, marginTop: spacing[1] }}>
            Соль сохранена. Оставьте пустым, чтобы не менять.
          </Text>
        ) : null}
      </View>

      {/* Webhook callback URL — read-only, copy/share into Mango's VPBX settings */}
      <View style={styles.formField}>
        <Text style={[styles.formLabel, { color: palette.text.secondary }]}>URL для webhook Mango</Text>
        <View style={[styles.webhookRow, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
          <Text style={[styles.webhookText, { color: palette.text.primary }]} numberOfLines={1} ellipsizeMode="middle">
            {webhookUrl}
          </Text>
          <TouchableOpacity
            onPress={handleCopyWebhook}
            hitSlop={6}
            style={[styles.webhookCopy, { backgroundColor: palette.bg.card }]}
            accessibilityRole="button"
            accessibilityLabel="Поделиться webhook URL"
          >
            <Ionicons
              name={copied ? 'checkmark' : 'share-outline'}
              size={16}
              color={copied ? colors.green[600] : palette.text.secondary}
            />
          </TouchableOpacity>
        </View>
        <Text style={{ fontSize: 11, color: palette.text.tertiary, marginTop: spacing[1] }}>
          Вставьте этот URL в настройки VPBX Mango
        </Text>
      </View>

      <TouchableOpacity
        style={[
          styles.primaryBtn,
          { backgroundColor: palette.accent.primary, marginTop: spacing[1] },
          save.isPending && { opacity: 0.6 },
        ]}
        onPress={handleSave}
        disabled={save.isPending || settingsQuery.isLoading}
      >
        {save.isPending ? (
          <ActivityIndicator size="small" color={colors.white} />
        ) : (
          <>
            <Ionicons name="checkmark" size={16} color={colors.white} />
            <Text style={styles.primaryBtnText}>Сохранить</Text>
          </>
        )}
      </TouchableOpacity>
    </Modal>
  );
}

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  const palette = useColors();
  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionTitle, { color: palette.text.primary }]}>{title}</Text>
      {hint ? <Text style={[styles.sectionHint, { color: palette.text.tertiary }]}>{hint}</Text> : null}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing[4] },

  heroSub: {
    fontSize: fontSize.sm,
    marginBottom: spacing[5],
    lineHeight: 20,
  },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: spacing[3],
  },
  sectionTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, letterSpacing: -0.3 },
  sectionHint: { fontSize: fontSize.xs, fontWeight: fontWeight.medium },

  // Provider card
  providerCard: {
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    padding: spacing[4],
  },
  providerCardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  providerLogo: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  providerName: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, letterSpacing: -0.2 },
  providerDesc: { fontSize: fontSize.xs, marginTop: 2, lineHeight: 17 },
  providerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[2],
  },
  providerActive: { fontSize: 11, flex: 1 },

  // Status pill
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing[2.5],
    paddingVertical: 4,
    borderRadius: borderRadius.full,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusPillText: { fontSize: 11, fontWeight: fontWeight.semibold },

  // Modal
  modalHeaderBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginBottom: spacing[4],
  },
  modalLogo: {
    width: 52,
    height: 52,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalDesc: { fontSize: fontSize.sm, lineHeight: 20 },

  formField: { marginBottom: spacing[3] },
  formLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, marginBottom: spacing[1.5] },
  formInput: {
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[2.5],
    fontSize: fontSize.sm,
  },
  templateInput: {
    minHeight: 96,
    lineHeight: 20,
    paddingTop: spacing[2.5],
  },

  // «Мои Звонки» домен-поле с суффиксом .moizvonki.ru (как в веб-форме)
  moizvonkiDomainRow: { flexDirection: 'row', alignItems: 'stretch' },
  moizvonkiDomainInput: {
    flex: 1,
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
    borderRightWidth: 0,
  },
  moizvonkiSuffix: {
    justifyContent: 'center',
    paddingHorizontal: spacing[3],
    borderWidth: 1,
    borderLeftWidth: 0,
    borderTopRightRadius: borderRadius.lg,
    borderBottomRightRadius: borderRadius.lg,
  },
  moizvonkiSuffixText: { fontSize: 12 },

  // Webhook row
  webhookRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  webhookText: { flex: 1, fontSize: 12 },
  webhookCopy: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Active switch row
  activeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderWidth: 1,
    borderRadius: borderRadius.xl,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
    marginBottom: spacing[3],
  },
  activeLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  activeSub: { fontSize: 11, marginTop: 2 },
  switchTrack: {
    width: 44,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
  },
  switchThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#ffffff',
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.15,
        shadowRadius: 2,
      },
      android: { elevation: 2 },
    }),
  },

  // Buttons
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[3.5],
  },
  primaryBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.white },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    borderWidth: 1,
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[3],
  },
  secondaryBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },

  dangerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[3],
    marginTop: spacing[2],
  },

  // Log block
  logBlock: {
    borderWidth: 1,
    borderRadius: borderRadius.xl,
    padding: spacing[3],
    marginTop: spacing[4],
  },
  logHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    marginBottom: spacing[1],
  },
  logHeaderText: { fontSize: 12, fontWeight: fontWeight.semibold },
  logEmpty: { fontSize: 11 },

  // Notice (for unsupported platforms)
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2],
    borderWidth: 1,
    borderRadius: borderRadius.xl,
    padding: spacing[3],
  },
  noticeText: { flex: 1, fontSize: fontSize.xs, lineHeight: 18 },
});
