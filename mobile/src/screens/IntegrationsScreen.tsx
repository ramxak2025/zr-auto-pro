/**
 * IntegrationsScreen — "Интеграции".
 *
 * Visual catalogue of available providers grouped by category:
 *   • Телефония и звонки    — МоиЗвонки (SMS+phone), Мегафон ВАТС
 *   • Мессенджеры           — WhatsApp Cloud API, Telegram (бот → чат персонала)
 *   • Автоуведомления       — «Машина готова» (toggle + шаблон сообщения)
 *   • Площадки отзывов      — Google / Яндекс / 2GIS / Авито (URL only)
 *
 * Provider cards render the connection status pulled from
 * `marketingApi.getIntegrations()` for messaging providers and from
 * `marketingApi.getPlatformLinks()` for review platforms. Tapping a card
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
 *     Switched Мегафон to `cellular-outline` (now mapped → Signal).
 *     MoreScreen entry now uses `extension-puzzle-outline` (Puzzle).
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
import { marketingApi } from '../api/services';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import IosScreenHeader from '../components/IosScreenHeader';
import AnimatedCard from '../components/AnimatedCard';
import Modal from '../components/Modal';
import { Text } from '../platform/Typography';
import { haptic } from '../platform/haptics';
import type { MessagingIntegration, ReviewPlatformLink } from '../../../shared/types';

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
  /** Used for the icon tint pill. */
  tone: { bg: string; fg: string };
  /** Field labels. */
  apiKeyLabel: string;
  /** Show senderPhone field. */
  needsPhone?: boolean;
  /** Show senderName field. */
  needsName?: boolean;
  /** Show WhatsApp Cloud API «Phone number ID» field → phoneNumberId. */
  needsPhoneNumberId?: boolean;
  /** Show Telegram «Chat ID» field → chatId. */
  needsChatId?: boolean;
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
    iconName: 'call-outline',
    tone: { bg: colors.blue[50], fg: colors.blue[600] },
    apiKeyLabel: 'API ключ',
    needsName: true,
  },
  {
    key: 'megafon',
    dbType: 'sms',
    kind: 'phone',
    name: 'Мегафон ВАТС',
    description: 'Звонки и SMS через Мегафон',
    iconName: 'cellular-outline',
    tone: { bg: colors.green[50], fg: colors.green[600] },
    apiKeyLabel: 'Токен ВАТС',
    needsPhone: true,
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
    tone: { bg: '#dcf8c6', fg: '#075E54' },
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
    iconName: 'paper-plane-outline',
    tone: { bg: '#e1f3fb', fg: '#229ED9' },
    // Bot token (write-only → apiKey) + target chat (non-secret → chatId).
    apiKeyLabel: 'Токен бота',
    needsChatId: true,
    hint: 'Telegram отправляет уведомления в чат владельца/персонала, не клиенту',
  },
];

interface PlatformDef {
  key: string; // db platform value or 'avito'
  name: string;
  description: string;
  iconName: keyof typeof import('@expo/vector-icons/build/Ionicons').default.glyphMap;
  tone: { bg: string; fg: string };
  /** False when backend has no DB row for this platform. */
  supported: boolean;
}

// Placeholder + hint per platform — picked to match the canonical
// profile URL format the owner is most likely to paste, so the input
// hints at what's expected without forcing format validation.
const PLATFORM_PLACEHOLDERS: Record<string, string> = {
  google: 'https://maps.google.com/...',
  yandex: 'https://yandex.ru/maps/org/...',
  '2gis': 'https://2gis.ru/...',
  avito: 'https://www.avito.ru/avtomoyka_xxx',
};
const PLATFORM_HINTS: Record<string, string> = {
  avito: 'Откройте свой профиль на Авито и скопируйте URL из адресной строки',
  google: 'Откройте свою карточку в Google Maps и скопируйте URL',
  yandex: 'Откройте свою карточку в Яндекс.Картах и скопируйте URL',
  '2gis': 'Откройте свою карточку в 2GIS и скопируйте URL',
};

const PLATFORMS: PlatformDef[] = [
  {
    key: 'google',
    name: 'Google Business',
    description: 'Профиль компании в Google Maps',
    // Lucide has no Google brand mark — fall back to a globe which our
    // shim already maps. `logo-google` resolves to Globe via the map.
    iconName: 'logo-google',
    tone: { bg: '#dbeafe', fg: '#1d4ed8' },
    supported: true,
  },
  {
    key: 'yandex',
    name: 'Яндекс Бизнес',
    description: 'Карточка в Яндекс Картах',
    iconName: 'globe-outline',
    tone: { bg: '#fee2e2', fg: '#b91c1c' },
    supported: true,
  },
  {
    key: '2gis',
    name: '2GIS',
    description: 'Профиль в справочнике 2GIS',
    iconName: 'map-outline',
    tone: { bg: '#dcfce7', fg: '#16a34a' },
    supported: true,
  },
  {
    key: 'avito',
    name: 'Авито',
    description: 'Профиль автосервиса на Авито',
    iconName: 'storefront-outline',
    tone: { bg: '#dbeafe', fg: '#2563eb' },
    // Migration 054 added 'avito' to the platform CHECK constraint —
    // it's a first-class platform now.
    supported: true,
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
        <View style={[styles.providerLogo, { backgroundColor: provider.tone.bg }]}>
          <Ionicons name={provider.iconName as any} size={22} color={provider.tone.fg} />
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
      bg: colors.green[50],
      fg: colors.green[700],
      label: 'Подключено',
      dot: colors.green[500],
    },
    warn: {
      bg: colors.amber[50],
      fg: colors.amber[700],
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
//  Platform card
// ─────────────────────────────────────────────────────────────────────

interface PlatformCardProps {
  platform: PlatformDef;
  link?: ReviewPlatformLink;
  onPress: () => void;
  index: number;
}

function PlatformCard({ platform, link, onPress, index }: PlatformCardProps) {
  const palette = useColors();
  const connected = !!link?.url;
  return (
    <AnimatedCard
      index={index}
      onPress={onPress}
      style={[styles.providerCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
    >
      <View style={styles.providerCardRow}>
        <View style={[styles.providerLogo, { backgroundColor: platform.tone.bg }]}>
          <Ionicons name={platform.iconName as any} size={22} color={platform.tone.fg} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.providerName, { color: palette.text.primary }]} numberOfLines={1}>
            {platform.name}
          </Text>
          <Text style={[styles.providerDesc, { color: palette.text.tertiary }]} numberOfLines={2}>
            {platform.description}
          </Text>
          <View style={styles.providerMeta}>
            <StatusPill kind={!platform.supported ? 'warn' : connected ? 'ok' : 'off'} />
            {connected && link?.url && (
              <Text style={[styles.providerActive, { color: palette.text.tertiary }]} numberOfLines={1}>
                · {link.url.replace(/^https?:\/\//, '').slice(0, 30)}
              </Text>
            )}
          </View>
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
  const [isActive, setIsActive] = useState(true);
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
    setIsActive(existing ? existing.isActive : true);
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
      webhookUrl,
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
        <View style={[styles.modalLogo, { backgroundColor: provider.tone.bg }]}>
          <Ionicons name={provider.iconName as any} size={26} color={provider.tone.fg} />
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

      {/* Webhook */}
      <View style={styles.formField}>
        <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Webhook URL</Text>
        <View style={[styles.webhookRow, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
          <Text style={[styles.webhookText, { color: palette.text.primary }]} numberOfLines={1} ellipsizeMode="middle">
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
//  Platform link modal
// ─────────────────────────────────────────────────────────────────────

function PlatformModal({
  platform,
  existing,
  onClose,
}: {
  platform: PlatformDef | null;
  existing?: ReviewPlatformLink;
  onClose: () => void;
}) {
  const palette = useColors();
  const queryClient = useQueryClient();
  const [url, setUrl] = useState('');
  const [isActive, setIsActive] = useState(true);

  React.useEffect(() => {
    if (!platform) return;
    setUrl(existing?.url || '');
    setIsActive(existing?.isActive ?? true);
  }, [platform, existing]);

  const save = useMutation({
    mutationFn: () => marketingApi.upsertPlatformLink({ platform: platform!.key, url: url.trim(), isActive }),
    onSuccess: () => {
      haptic('success');
      queryClient.invalidateQueries({ queryKey: ['marketing-platform-links'] });
      Alert.alert('Готово', 'Ссылка сохранена');
      onClose();
    },
    onError: (e: any) => {
      haptic('error');
      Alert.alert('Ошибка', e?.response?.data?.message || 'Не удалось сохранить');
    },
  });

  const remove = useMutation({
    mutationFn: () => marketingApi.removePlatformLink(existing!.id),
    onSuccess: () => {
      haptic('success');
      queryClient.invalidateQueries({ queryKey: ['marketing-platform-links'] });
      onClose();
    },
    onError: () => Alert.alert('Ошибка', 'Не удалось удалить'),
  });

  if (!platform) return null;

  // Dead branch in 2026-05 — all current platforms are `supported: true`
  // after migration 054 added Avito to the CHECK constraint. Kept as a
  // safety net so a future "we added a platform but its DB enum isn't
  // ready yet" doesn't crash the modal — it just shows a notice.
  if (!platform.supported) {
    return (
      <Modal visible={!!platform} onClose={onClose} title={platform.name}>
        <View style={styles.modalHeaderBlock}>
          <View style={[styles.modalLogo, { backgroundColor: platform.tone.bg }]}>
            <Ionicons name={platform.iconName as any} size={26} color={platform.tone.fg} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.modalDesc, { color: palette.text.secondary }]}>{platform.description}</Text>
          </View>
        </View>
        <View style={[styles.notice, { borderColor: palette.border.subtle, backgroundColor: palette.bg.muted }]}>
          <Ionicons name="information-circle-outline" size={16} color={palette.text.secondary} />
          <Text style={[styles.noticeText, { color: palette.text.secondary }]}>
            Эта интеграция временно недоступна. Попробуйте позже.
          </Text>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={!!platform} onClose={onClose} title={platform.name}>
      <View style={styles.modalHeaderBlock}>
        <View style={[styles.modalLogo, { backgroundColor: platform.tone.bg }]}>
          <Ionicons name={platform.iconName as any} size={26} color={platform.tone.fg} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.modalDesc, { color: palette.text.secondary }]}>{platform.description}</Text>
        </View>
      </View>

      <View style={styles.formField}>
        <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Ссылка на профиль / страницу отзывов</Text>
        <TextInput
          value={url}
          onChangeText={setUrl}
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
          keyboardType="url"
          placeholder={PLATFORM_PLACEHOLDERS[platform.key] || 'https://...'}
          placeholderTextColor={palette.text.tertiary}
        />
        {PLATFORM_HINTS[platform.key] ? (
          <Text style={{ fontSize: 11, color: palette.text.tertiary, marginTop: spacing[1] }}>
            {PLATFORM_HINTS[platform.key]}
          </Text>
        ) : null}
      </View>

      <TouchableOpacity
        style={[styles.activeRow, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
        onPress={() => {
          haptic('select');
          setIsActive((v) => !v);
        }}
      >
        <Text style={[styles.activeLabel, { color: palette.text.primary }]}>Показывать в воронке</Text>
        <View
          style={[styles.switchTrack, { backgroundColor: isActive ? palette.accent.primary : palette.border.strong }]}
        >
          <View style={[styles.switchThumb, { transform: [{ translateX: isActive ? 20 : 2 }] }]} />
        </View>
      </TouchableOpacity>

      <TouchableOpacity
        style={[
          styles.primaryBtn,
          { backgroundColor: palette.accent.primary, marginTop: spacing[3] },
          save.isPending && { opacity: 0.6 },
        ]}
        onPress={() => {
          if (!url.trim()) {
            Alert.alert('Ошибка', 'Введите ссылку');
            return;
          }
          save.mutate();
        }}
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
          onPress={() => {
            Alert.alert('Удалить ссылку', `Убрать ${platform.name} из списка?`, [
              { text: 'Отмена', style: 'cancel' },
              { text: 'Удалить', style: 'destructive', onPress: () => remove.mutate() },
            ]);
          }}
          disabled={remove.isPending}
        >
          <Ionicons name="trash-outline" size={16} color={colors.red[600]} />
          <Text style={[styles.secondaryBtnText, { color: colors.red[700] }]}>Удалить</Text>
        </TouchableOpacity>
      )}
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
  const [openPlatform, setOpenPlatform] = useState<PlatformDef | null>(null);

  const integrationsQuery = useQuery({
    queryKey: ['marketing-integrations'],
    queryFn: async () => (await marketingApi.getIntegrations()).data,
    staleTime: 60_000,
  });
  const platformsQuery = useQuery({
    queryKey: ['marketing-platform-links'],
    queryFn: async () => (await marketingApi.getPlatformLinks()).data,
    staleTime: 60_000,
  });

  const integrations: MessagingIntegration[] = Array.isArray(integrationsQuery.data) ? integrationsQuery.data : [];
  const platformLinks: ReviewPlatformLink[] = Array.isArray(platformsQuery.data) ? platformsQuery.data : [];

  // Find which DB row matches each visual provider card. We key by
  // `dbType` because the DB only stores the enum, not our visual key.
  const findIntegration = (p: ProviderDef): MessagingIntegration | undefined =>
    integrations.find((i) => i.providerType === p.dbType);

  const findLink = (p: PlatformDef): ReviewPlatformLink | undefined => platformLinks.find((l) => l.platform === p.key);

  const loading = integrationsQuery.isLoading || platformsQuery.isLoading;

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Интеграции" onBack={() => navigation.goBack()} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + spacing[4] }]}
      >
        <Text style={[styles.heroSub, { color: palette.text.secondary }]}>
          Подключайте сервисы — звонки, мессенджеры, отзывы
        </Text>

        {loading && integrations.length === 0 && platformLinks.length === 0 ? (
          <ActivityIndicator color={palette.accent.primary} style={{ marginTop: spacing[8] }} />
        ) : (
          <>
            {/* Phone providers */}
            <SectionHeader title="Телефония и звонки" hint="Звонки и SMS" />
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

            {/* Messengers — WhatsApp Cloud API + Telegram */}
            <View style={{ height: spacing[5] }} />
            <SectionHeader title="Мессенджеры" hint="WhatsApp и Telegram" />
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
                  index={idx + 2}
                />
              ))}
            </View>

            {/* «Машина готова» auto-notification */}
            <View style={{ height: spacing[5] }} />
            <SectionHeader title="Автоуведомления" hint="Когда машина готова" />
            <CarReadySection />

            {/* Platforms */}
            <View style={{ height: spacing[5] }} />
            <SectionHeader title="Площадки отзывов" hint="Профили компании" />
            <View style={{ gap: spacing[2.5] }}>
              {PLATFORMS.map((p, idx) => (
                <PlatformCard
                  key={p.key}
                  platform={p}
                  link={findLink(p)}
                  onPress={() => {
                    haptic('tap');
                    setOpenPlatform(p);
                  }}
                  index={idx + 4}
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
      <PlatformModal
        platform={openPlatform}
        existing={openPlatform ? findLink(openPlatform) : undefined}
        onClose={() => setOpenPlatform(null)}
      />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  «Машина готова» auto-notification section
// ─────────────────────────────────────────────────────────────────────

const DEFAULT_CAR_READY_TEMPLATE =
  'Здравствуйте, {clientName}! Ваш автомобиль {car} готов к выдаче. Заказ-наряд №{number}. Спасибо, что выбрали нас!';

const CAR_READY_PLACEHOLDERS = '{number} — номер заказа · {car} — авто · {clientName} — имя клиента';

function CarReadySection() {
  const palette = useColors();
  const queryClient = useQueryClient();

  const [enabled, setEnabled] = useState(false);
  const [template, setTemplate] = useState(DEFAULT_CAR_READY_TEMPLATE);
  // Hydrate the form once from the server, then let the owner edit freely —
  // a background refetch must not clobber unsaved keystrokes.
  const hydrated = React.useRef(false);

  const settingsQuery = useQuery({
    queryKey: ['marketing-car-ready'],
    queryFn: async () => (await marketingApi.getCarReadySettings()).data,
    staleTime: 60_000,
  });

  React.useEffect(() => {
    if (settingsQuery.data && !hydrated.current) {
      hydrated.current = true;
      setEnabled(!!settingsQuery.data.enabled);
      setTemplate(settingsQuery.data.messageTemplate || DEFAULT_CAR_READY_TEMPLATE);
    }
  }, [settingsQuery.data]);

  const save = useMutation({
    mutationFn: () =>
      marketingApi.updateCarReadySettings({
        enabled,
        messageTemplate: template.trim() || DEFAULT_CAR_READY_TEMPLATE,
      }),
    onSuccess: () => {
      haptic('success');
      queryClient.invalidateQueries({ queryKey: ['marketing-car-ready'] });
      Alert.alert('Готово', 'Настройки уведомления сохранены');
    },
    onError: (e: any) => {
      haptic('error');
      Alert.alert('Ошибка', e?.response?.data?.message || 'Не удалось сохранить');
    },
  });

  const handleSave = () => {
    if (enabled && !template.trim()) {
      Alert.alert('Ошибка', 'Введите текст уведомления');
      return;
    }
    save.mutate();
  };

  return (
    <View style={[styles.carReadyCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
      {/* Enable toggle */}
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
          <Text style={[styles.activeLabel, { color: palette.text.primary }]}>Уведомлять клиента</Text>
          <Text style={[styles.activeSub, { color: palette.text.tertiary }]}>
            Сообщение уйдёт автоматически, когда машина переходит в статус «Готова»
          </Text>
        </View>
        <View
          style={[styles.switchTrack, { backgroundColor: enabled ? palette.accent.primary : palette.border.strong }]}
        >
          <View style={[styles.switchThumb, { transform: [{ translateX: enabled ? 20 : 2 }] }]} />
        </View>
      </TouchableOpacity>

      {/* Template editor */}
      <View style={styles.formField}>
        <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Текст сообщения</Text>
        <TextInput
          value={template}
          onChangeText={setTemplate}
          style={[
            styles.formInput,
            styles.templateInput,
            {
              backgroundColor: palette.bg.muted,
              borderColor: palette.border.subtle,
              color: palette.text.primary,
            },
          ]}
          multiline
          textAlignVertical="top"
          placeholder={DEFAULT_CAR_READY_TEMPLATE}
          placeholderTextColor={palette.text.tertiary}
        />
        <Text style={{ fontSize: 11, color: palette.text.tertiary, marginTop: spacing[1] }}>
          Переменные: {CAR_READY_PLACEHOLDERS}
        </Text>
      </View>

      {/* Channel note */}
      <View style={[styles.notice, { borderColor: palette.border.subtle, backgroundColor: palette.bg.muted }]}>
        <Ionicons name="information-circle-outline" size={16} color={palette.text.secondary} />
        <Text style={[styles.noticeText, { color: palette.text.secondary }]}>
          Отправляется через активный канал (WhatsApp / Telegram / SMS). Подключите его выше.
        </Text>
      </View>

      <TouchableOpacity
        style={[
          styles.primaryBtn,
          { backgroundColor: palette.accent.primary, marginTop: spacing[3] },
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
    </View>
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

  // «Машина готова» card
  carReadyCard: {
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    padding: spacing[4],
  },

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
