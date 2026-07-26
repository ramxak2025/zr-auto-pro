/**
 * MailingsScreen — «Рассылки».
 *
 * Restructured around the server's segment-broadcast + auto-mailing overview
 * (мигр. 124) so the owner trusts that nobody gets spammed:
 *
 *   • Ручная — сегментная рассылка. Выбираешь СЕГМЕНТ (все / давно не приезжали /
 *     по источнику / есть долг / вручную), КАНАЛ (из подключённых интеграций) и
 *     текст → `marketingApi.sendSegmentBroadcast`. Результат честно показывает
 *     «Отправлено · Пропущено (дубли) · Ошибок» — `skippedDedup` берётся из
 *     анти-спам-журнала. «Возвращение клиентов» теперь просто пресет сегмента.
 *
 *   • Авто — обзор автоматических рассылок (`getAutoMailings`): отзыв, машина
 *     готова, напоминание о визите, оплата рассрочки — со статусом вкл/выкл и
 *     переходом в «Настройки» для правки текста. Анти-спам-примечание рядом.
 *
 * Каждая отправка идемпотентна (`idempotencyKey`) — повтор при плохой сети не
 * задваивает списание SMS.
 */
import React, { useMemo, useRef, useState } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { useColors } from '../contexts/ThemeContext';
import { marketingApi, clientsApi, clientSourcesApi, bookingsApi, installmentsApi } from '../api/services';
import { colors, fontSize, fontWeight, borderRadius, spacing, softTint } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import IosScreenHeader from '../components/IosScreenHeader';
import AnimatedCard from '../components/AnimatedCard';
import { KeyboardAwareScroll } from '../components/KeyboardAware';
import { Text } from '../platform/Typography';
import { haptic } from '../platform/haptics';
import type {
  Client,
  MessagingIntegration,
  SegmentBroadcastCriteria,
  SegmentBroadcastResult,
  AutoMailingOverview,
} from '../../../shared/types';

type TabKey = 'manual' | 'auto';
type SegmentKey = 'all' | 'inactive' | 'source' | 'debt' | 'clients';

const TEMPLATES: { id: string; title: string; body: string }[] = [
  {
    id: 'thanks',
    title: 'Спасибо за визит',
    body: 'Здравствуйте, {имя}! Спасибо за визит. Будем рады видеть вас снова.',
  },
  {
    id: 'seasonal',
    title: 'Сезонная акция',
    body: 'Здравствуйте, {имя}! Сезон смены резины — успейте записаться по спеццене.',
  },
  {
    id: 'oil',
    title: 'Скидка на масло',
    body: 'Здравствуйте, {имя}! В этом месяце скидка 10% на замену моторного масла.',
  },
  {
    id: 'comeback',
    title: 'Давно не виделись',
    body: 'Здравствуйте, {имя}! Давно вас не было — приезжайте на бесплатную диагностику.',
  },
];

const SEGMENTS: { key: SegmentKey; title: string; subtitle: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'all', title: 'Все клиенты', subtitle: 'Всем с телефоном (кроме розницы)', icon: 'people-outline' },
  {
    key: 'inactive',
    title: 'Давно не приезжали',
    subtitle: 'Возврат клиентов — не были N дней',
    icon: 'repeat-outline',
  },
  { key: 'source', title: 'По источнику', subtitle: 'Пришли из конкретного канала', icon: 'funnel-outline' },
  { key: 'debt', title: 'Есть долг', subtitle: 'Незакрытая рассрочка или долг', icon: 'alert-circle-outline' },
  {
    key: 'clients',
    title: 'Выбрать вручную',
    subtitle: 'Отметить конкретных клиентов',
    icon: 'checkmark-circle-outline',
  },
];

const CHANNEL_META: Record<
  MessagingIntegration['providerType'],
  { label: string; icon: keyof typeof Ionicons.glyphMap }
> = {
  whatsapp: { label: 'WhatsApp', icon: 'logo-whatsapp' },
  telegram: { label: 'Telegram', icon: 'paper-plane-outline' },
  smsru: { label: 'SMS.RU', icon: 'chatbox-ellipses-outline' },
  sms: { label: 'SMS', icon: 'chatbox-outline' },
  moizvonki: { label: 'Мои Звонки', icon: 'call-outline' },
  email: { label: 'Email', icon: 'mail-outline' },
};

function makeIdempotencyKey(): string {
  return `mail-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function pluralDays(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'день';
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'дня';
  return 'дней';
}

function pluralClients(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'клиенту';
  return 'клиентам';
}

// ─────────────────────────────────────────────────────────────────────
//  Ручная — segment broadcast
// ─────────────────────────────────────────────────────────────────────

function ManualTab() {
  const palette = useColors();
  const queryClient = useQueryClient();

  const [segmentKey, setSegmentKey] = useState<SegmentKey>('all');
  const [days, setDays] = useState(90);
  const [source, setSource] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, Client>>({});
  const [search, setSearch] = useState('');
  const [channelId, setChannelId] = useState<string | null>(null); // null = «Авто» (default channel)
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<SegmentBroadcastResult | null>(null);
  // Идёт dry-run предпросмотр (POST broadcast/preview) перед подтверждением.
  const [previewing, setPreviewing] = useState(false);
  const idempotencyKey = useRef(makeIdempotencyKey());

  // A distinct composition = a fresh idempotency key. Retries of the SAME
  // composition reuse it, so a flaky-network retry never double-sends.
  React.useEffect(() => {
    idempotencyKey.current = makeIdempotencyKey();
    setResult(null);
  }, [segmentKey, days, source, message, channelId, picked]);

  const integrationsQuery = useQuery({
    queryKey: ['marketing-integrations'],
    queryFn: async () => (await marketingApi.getIntegrations()).data,
    staleTime: 60_000,
  });
  // 'sms'/'email' исключены: адаптеры-заглушки без транспорта — сервер такие
  // каналы не выбирает, предлагать их чипом = обещать фантомную отправку.
  const channels: MessagingIntegration[] = (Array.isArray(integrationsQuery.data) ? integrationsQuery.data : []).filter(
    (i) => i.isActive && i.providerType !== 'sms' && i.providerType !== 'email',
  );

  const sourcesQuery = useQuery({
    queryKey: ['client-sources'],
    queryFn: async () => (await clientSourcesApi.get()).data,
    staleTime: 5 * 60_000,
    enabled: segmentKey === 'source',
  });
  const sources = sourcesQuery.data?.sources ?? [];

  const clientsQuery = useQuery({
    queryKey: ['mailings-clients', search],
    queryFn: async () => (await clientsApi.getAll({ search, page: 1, limit: 50 })).data,
    staleTime: 30_000,
    enabled: segmentKey === 'clients',
  });
  const clients = clientsQuery.data?.data ?? [];
  const pickedIds = Object.keys(picked);

  const buildSegment = (): SegmentBroadcastCriteria | undefined => {
    switch (segmentKey) {
      case 'all':
        return undefined;
      case 'inactive':
        return { lastVisitDays: days };
      case 'source':
        return source ? { source } : undefined;
      case 'debt':
        return { hasDebt: true };
      case 'clients':
        return { clientIds: pickedIds };
    }
  };

  const segmentReady =
    segmentKey !== 'source' && segmentKey !== 'clients'
      ? true
      : segmentKey === 'source'
        ? !!source
        : pickedIds.length > 0;

  const canSend = message.trim().length > 0 && segmentReady;

  const send = useMutation({
    mutationFn: async () => {
      const res = await marketingApi.sendSegmentBroadcast({
        segment: buildSegment(),
        message: message.trim(),
        integrationId: channelId ?? undefined,
        idempotencyKey: idempotencyKey.current,
      });
      return res.data;
    },
    onSuccess: (res) => {
      haptic('success');
      setResult(res);
      queryClient.invalidateQueries({ queryKey: ['marketing-dashboard'] });
      // Next send gets a new key.
      idempotencyKey.current = makeIdempotencyKey();
    },
    onError: (e: any) => {
      haptic('error');
      Alert.alert('Ошибка', e?.response?.data?.message || 'Не удалось отправить рассылку');
    },
  });

  const togglePick = (c: Client) => {
    haptic('select');
    setPicked((prev) => {
      const next = { ...prev };
      if (next[c.id]) delete next[c.id];
      else next[c.id] = c;
      return next;
    });
  };

  /**
   * Шаг подтверждения на данных dry-run предпросмотра: ДО отправки владелец
   * видит «уйдёт N клиентам через <канал>», текст сообщения, примеры
   * получателей и анти-спам-гарантию (потолок из meta сервера, не хардкод).
   * Preview НИЧЕГО не отправляет; если он недоступен (сеть/старый сервер) —
   * падаем в прежнее общее подтверждение, отправку не блокируем.
   */
  const confirmSend = async () => {
    if (!canSend || previewing) return;
    haptic('tap');
    setPreviewing(true);
    try {
      const { data: pv } = await marketingApi.previewBroadcast({
        segment: buildSegment(),
        integrationId: channelId ?? undefined,
      });
      if (!pv.channelConnected) {
        haptic('warning');
        Alert.alert(
          'Канал не подключён',
          'Нет подключённого канала рассылок — сообщения не уйдут. Подключите SMS.RU или WhatsApp в разделе «Интеграции».',
        );
        return;
      }
      if (pv.recipientsCount === 0) {
        Alert.alert('Некому отправлять', 'В выбранном сегменте нет клиентов с телефоном.');
        return;
      }
      const channelLabel = pv.channel ? (CHANNEL_META[pv.channel]?.label ?? pv.channel) : 'канал по умолчанию';
      const names = pv.sample
        .slice(0, 3)
        .map((s) => s.name)
        .join(', ');
      Alert.alert(
        `Уйдёт ${pv.recipientsCount} ${pluralClients(pv.recipientsCount)} через ${channelLabel}`,
        `«${message.trim()}»` +
          (names ? `\n\nСреди получателей: ${names}` : '') +
          `\n\nНе больше ${pv.perClient24hCap} сообщений клиенту за 24 ч — часть может быть пропущена защитой от спама.`,
        [
          { text: 'Отменить', style: 'cancel' },
          { text: 'Отправить', onPress: () => send.mutate() },
        ],
      );
    } catch {
      Alert.alert('Отправить рассылку?', 'Сообщение уйдёт выбранному сегменту. Дубли отсеются автоматически.', [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Отправить', onPress: () => send.mutate() },
      ]);
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <View style={{ gap: spacing[3] }}>
      {/* Step 1 — Segment */}
      <AnimatedCard
        index={0}
        style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
      >
        <StepHeader n={1} icon="people-outline" title="Кому" hint="Выберите сегмент" />
        <View style={{ gap: spacing[2] }}>
          {SEGMENTS.map((s) => {
            const active = segmentKey === s.key;
            return (
              <TouchableOpacity
                key={s.key}
                onPress={() => {
                  haptic('select');
                  setSegmentKey(s.key);
                }}
                activeOpacity={0.8}
                style={[
                  styles.segmentRow,
                  {
                    backgroundColor: active ? palette.accent.primarySoft : palette.bg.muted,
                    borderColor: active ? palette.accent.primary : palette.border.subtle,
                  },
                ]}
              >
                <Ionicons name={s.icon} size={18} color={active ? palette.accent.primary : palette.text.tertiary} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.segmentTitle, { color: palette.text.primary }]}>{s.title}</Text>
                  <Text style={[styles.segmentSub, { color: palette.text.tertiary }]}>{s.subtitle}</Text>
                </View>
                <View
                  style={[
                    styles.radio,
                    active
                      ? { borderColor: palette.accent.primary, backgroundColor: palette.accent.primary }
                      : { borderColor: palette.border.strong },
                  ]}
                >
                  {active ? <Ionicons name="checkmark" size={12} color={colors.white} /> : null}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Days sub-control for «давно не приезжали» */}
        {segmentKey === 'inactive' ? (
          <View style={{ marginTop: spacing[3] }}>
            <Text style={[styles.subLabel, { color: palette.text.secondary }]}>Не приезжали дольше</Text>
            <View style={{ flexDirection: 'row', gap: spacing[2], marginTop: spacing[2] }}>
              {[30, 60, 90, 180].map((d) => {
                const active = days === d;
                return (
                  <TouchableOpacity
                    key={d}
                    onPress={() => {
                      haptic('select');
                      setDays(d);
                    }}
                    style={[
                      styles.dayChip,
                      {
                        backgroundColor: active ? palette.accent.primary : palette.bg.muted,
                        borderColor: active ? palette.accent.primary : palette.border.subtle,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        fontSize: fontSize.sm,
                        fontWeight: fontWeight.bold,
                        color: active ? colors.white : palette.text.secondary,
                      }}
                    >
                      {d}
                    </Text>
                    <Text style={{ fontSize: 10, color: active ? colors.white : palette.text.tertiary }}>
                      {pluralDays(d)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        ) : null}

        {/* Source picker */}
        {segmentKey === 'source' ? (
          <View style={{ marginTop: spacing[3] }}>
            <Text style={[styles.subLabel, { color: palette.text.secondary }]}>Источник</Text>
            {sourcesQuery.isLoading ? (
              <ActivityIndicator color={palette.accent.primary} style={{ marginVertical: spacing[3] }} />
            ) : sources.length === 0 ? (
              <Text style={[styles.emptyHint, { color: palette.text.tertiary }]}>Источники не заданы</Text>
            ) : (
              <View style={styles.chipWrap}>
                {sources.map((s) => {
                  const active = source === s;
                  return (
                    <TouchableOpacity
                      key={s}
                      onPress={() => {
                        haptic('select');
                        setSource(active ? null : s);
                      }}
                      style={[
                        styles.sourceChip,
                        {
                          backgroundColor: active ? palette.accent.primarySoft : palette.bg.muted,
                          borderColor: active ? palette.accent.primary : palette.border.subtle,
                        },
                      ]}
                    >
                      <Text
                        style={{
                          fontSize: 12,
                          fontWeight: '600',
                          color: active ? palette.accent.primary : palette.text.secondary,
                        }}
                      >
                        {s}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            )}
          </View>
        ) : null}

        {/* Manual client multi-select */}
        {segmentKey === 'clients' ? (
          <View style={{ marginTop: spacing[3] }}>
            <View style={[styles.searchRow, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
              <Ionicons name="search-outline" size={16} color={palette.text.tertiary} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                style={[styles.searchInput, { color: palette.text.primary }]}
                placeholder="Имя или телефон"
                placeholderTextColor={palette.text.tertiary}
                autoCorrect={false}
              />
              {pickedIds.length > 0 ? (
                <TouchableOpacity onPress={() => setPicked({})} hitSlop={6}>
                  <Text style={{ fontSize: 12, fontWeight: '600', color: palette.accent.primary }}>Сброс</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <Text style={[styles.subLabel, { color: palette.text.tertiary, marginTop: spacing[2] }]}>
              Выбрано: {pickedIds.length}
            </Text>
            <View style={{ maxHeight: 240, marginTop: spacing[1] }}>
              {clientsQuery.isLoading && clients.length === 0 ? (
                <ActivityIndicator color={palette.accent.primary} style={{ marginVertical: spacing[4] }} />
              ) : clients.length === 0 ? (
                <Text style={[styles.emptyHint, { color: palette.text.tertiary }]}>Никого не нашли</Text>
              ) : (
                <ScrollView
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  nestedScrollEnabled
                >
                  {clients.map((c) => {
                    const active = !!picked[c.id];
                    return (
                      <TouchableOpacity
                        key={c.id}
                        style={[
                          styles.clientRow,
                          {
                            backgroundColor: active ? palette.accent.primarySoft : palette.bg.card,
                            borderColor: active ? palette.accent.primary : palette.border.subtle,
                          },
                        ]}
                        onPress={() => togglePick(c)}
                      >
                        <View
                          style={[
                            styles.checkbox,
                            active
                              ? { backgroundColor: palette.accent.primary, borderColor: palette.accent.primary }
                              : { borderColor: palette.border.strong },
                          ]}
                        >
                          {active ? <Ionicons name="checkmark" size={14} color={colors.white} /> : null}
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.clientName, { color: palette.text.primary }]} numberOfLines={1}>
                            {c.fullName}
                          </Text>
                          <Text style={[styles.clientPhone, { color: palette.text.tertiary }]} numberOfLines={1}>
                            {c.phone || 'нет телефона'}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}
            </View>
          </View>
        ) : null}
      </AnimatedCard>

      {/* Step 2 — Channel */}
      <AnimatedCard
        index={1}
        style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
      >
        <StepHeader n={2} icon="git-network-outline" title="Канал" hint="Откуда отправить" />
        <View style={styles.chipWrap}>
          <ChannelChip
            label="Авто"
            icon="flash-outline"
            active={channelId === null}
            onPress={() => {
              haptic('select');
              setChannelId(null);
            }}
          />
          {channels.map((ch) => {
            const meta = CHANNEL_META[ch.providerType];
            return (
              <ChannelChip
                key={ch.id}
                label={meta?.label ?? ch.providerType}
                icon={meta?.icon ?? 'chatbox-outline'}
                active={channelId === ch.id}
                onPress={() => {
                  haptic('select');
                  setChannelId(ch.id);
                }}
              />
            );
          })}
        </View>
        {channels.length === 0 ? (
          <Text style={[styles.channelNote, { color: palette.text.tertiary }]}>
            Нет подключённых каналов — «Авто» использует канал по умолчанию. Подключить можно в «Интеграции».
          </Text>
        ) : (
          <Text style={[styles.channelNote, { color: palette.text.tertiary }]}>
            «Авто» — активный канал по умолчанию.
          </Text>
        )}
      </AnimatedCard>

      {/* Step 3 — Message */}
      <AnimatedCard
        index={2}
        style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
      >
        <StepHeader n={3} icon="document-text-outline" title="Сообщение" hint="Что напишем" />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: spacing[2], paddingBottom: spacing[1] }}
          style={{ marginBottom: spacing[3] }}
        >
          {TEMPLATES.map((tpl) => (
            <TouchableOpacity
              key={tpl.id}
              onPress={() => {
                haptic('tap');
                setMessage(tpl.body);
              }}
              style={[styles.templateChip, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
            >
              <Ionicons name="document-text-outline" size={13} color={palette.text.secondary} />
              <Text style={{ fontSize: 12, fontWeight: '600', color: palette.text.secondary }}>{tpl.title}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <TextInput
          value={message}
          onChangeText={setMessage}
          style={[
            styles.textArea,
            { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
          ]}
          multiline
          textAlignVertical="top"
          placeholder="Введите сообщение или выберите шаблон выше"
          placeholderTextColor={palette.text.tertiary}
        />
        <Text style={[styles.varHint, { color: palette.text.tertiary }]}>
          {'{имя}'} и {'{авто}'} подставятся для каждого получателя
        </Text>
      </AnimatedCard>

      {/* Result */}
      {result ? (
        <View style={[styles.resultCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
          <View style={styles.resultRow}>
            <ResultStat value={result.sent} label="Отправлено" tone="ok" />
            <ResultStat value={result.skippedDedup} label="Пропущено" tone="muted" />
            <ResultStat value={result.failed} label="Ошибок" tone={result.failed > 0 ? 'warn' : 'muted'} />
          </View>
          {result.skippedDedup > 0 ? (
            <Text style={[styles.resultNote, { color: palette.text.tertiary }]}>
              Пропущены дубли — этим клиентам уже писали недавно (анти-спам).
            </Text>
          ) : null}
        </View>
      ) : null}

      {/* Send — сначала dry-run предпросмотр, отправка только после «Отправить» */}
      <TouchableOpacity
        style={[
          styles.sendBtn,
          { backgroundColor: palette.accent.primary },
          (!canSend || send.isPending || previewing) && { opacity: 0.5 },
        ]}
        disabled={!canSend || send.isPending || previewing}
        onPress={confirmSend}
      >
        {send.isPending || previewing ? (
          <ActivityIndicator size="small" color={colors.white} />
        ) : (
          <>
            <Ionicons name="paper-plane" size={18} color={colors.white} />
            <Text style={styles.sendBtnText}>Проверить и отправить</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

function ChannelChip({
  label,
  icon,
  active,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  active: boolean;
  onPress: () => void;
}) {
  const palette = useColors();
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[
        styles.channelChip,
        {
          backgroundColor: active ? palette.accent.primarySoft : palette.bg.muted,
          borderColor: active ? palette.accent.primary : palette.border.subtle,
        },
      ]}
    >
      <Ionicons name={icon} size={15} color={active ? palette.accent.primary : palette.text.tertiary} />
      <Text
        style={{ fontSize: 13, fontWeight: '600', color: active ? palette.accent.primary : palette.text.secondary }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function ResultStat({ value, label, tone }: { value: number; label: string; tone: 'ok' | 'warn' | 'muted' }) {
  const palette = useColors();
  const color = tone === 'ok' ? colors.green[600] : tone === 'warn' ? colors.orange[600] : palette.text.secondary;
  return (
    <View style={styles.resultStat}>
      <Text style={[styles.resultValue, { color }]}>{value}</Text>
      <Text style={[styles.resultLabel, { color: palette.text.tertiary }]}>{label}</Text>
    </View>
  );
}

function StepHeader({
  n,
  icon,
  title,
  hint,
}: {
  n: number;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  hint: string;
}) {
  const palette = useColors();
  return (
    <View style={styles.stepHeader}>
      <View style={[styles.stepNumber, { backgroundColor: palette.accent.primary }]}>
        <Text style={styles.stepNumberText}>{n}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[1.5] }}>
          <Ionicons name={icon} size={15} color={palette.text.primary} />
          <Text style={[styles.stepTitle, { color: palette.text.primary }]}>{title}</Text>
        </View>
        <Text style={[styles.stepHint, { color: palette.text.tertiary }]}>{hint}</Text>
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Авто — auto-mailing overview
// ─────────────────────────────────────────────────────────────────────

const AUTO_META: Record<
  AutoMailingOverview['type'],
  { title: string; icon: keyof typeof Ionicons.glyphMap; tint: string }
> = {
  review: { title: 'Запрос отзыва', icon: 'star-outline', tint: colors.amber[600] },
  car_ready: { title: 'Машина готова', icon: 'car-sport-outline', tint: colors.blue[600] },
  booking_confirm: { title: 'Подтверждение записи', icon: 'calendar-outline', tint: colors.indigo[600] },
  booking_reminder: { title: 'Напоминание о записи', icon: 'alarm-outline', tint: colors.cyan[600] },
  service_reminder: { title: 'Давно не обслуживались', icon: 'notifications-outline', tint: colors.violet[600] },
  installment_reminder: { title: 'Оплата рассрочки', icon: 'card-outline', tint: colors.emerald[700] },
};

/** Экран настроек, где живёт текст/условия каждого сценария. */
const AUTO_SETTINGS_SCREEN: Record<AutoMailingOverview['type'], string> = {
  review: 'MarketingSettings',
  car_ready: 'MarketingSettings',
  service_reminder: 'MarketingSettings',
  installment_reminder: 'MarketingSettings',
  booking_confirm: 'BookingSettings',
  booking_reminder: 'BookingSettings',
};

function formatLastSent(iso?: string | null): string {
  if (!iso) return 'Ещё не отправлялась';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return 'Ещё не отправлялась';
  const now = new Date();
  const date = dt.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: dt.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
  const time = dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `Последняя отправка: ${date}, ${time}`;
}

/** iOS-переключатель (как в MarketingSettingsScreen — единый визуальный язык). */
function AutoSwitch({ value, onToggle }: { value: boolean; onToggle: () => void }) {
  const palette = useColors();
  return (
    <TouchableOpacity
      onPress={onToggle}
      activeOpacity={0.8}
      hitSlop={8}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
    >
      <View style={[styles.switchTrack, { backgroundColor: value ? palette.accent.primary : palette.border.strong }]}>
        <View style={[styles.switchThumb, { transform: [{ translateX: value ? 20 : 2 }] }]} />
      </View>
    </TouchableOpacity>
  );
}

function AutoTab() {
  const palette = useColors();
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  // Какой сценарий сейчас переключается (спиннер на его тумблере).
  const [pendingType, setPendingType] = useState<AutoMailingOverview['type'] | null>(null);

  const query = useQuery({
    queryKey: ['marketing-auto-mailings'],
    queryFn: async () => (await marketingApi.getAutoMailings()).data,
    staleTime: 30_000,
  });
  const items: AutoMailingOverview[] = Array.isArray(query.data) ? query.data : [];

  // Текущий шаблон запроса отзыва — для confirm-диалога при включении:
  // владелец видит, ЧТО именно уйдёт клиенту, до того как включил.
  const settingsQuery = useQuery({
    queryKey: ['marketing-settings'],
    queryFn: async () => (await marketingApi.getSettings()).data,
    staleTime: 60_000,
  });

  // Один тумблер — одна точка настроек на сервере. Каждый сценарий пишется
  // своим существующим endpoint'ом (см. settingsRef реестра).
  const toggle = useMutation({
    mutationFn: async ({ type, next }: { type: AutoMailingOverview['type']; next: boolean }) => {
      switch (type) {
        case 'review':
          await marketingApi.updateSettings({ autoSendEnabled: next });
          break;
        case 'car_ready':
          await marketingApi.updateCarReadySettings({ enabled: next });
          break;
        case 'service_reminder':
          await marketingApi.updateReminderSettings({ enabled: next });
          break;
        case 'installment_reminder':
          await installmentsApi.updateReminderSettings({ mode: next ? 'auto' : 'off' });
          break;
        case 'booking_confirm':
          await bookingsApi.updateSettings({ notifyClientOnCreate: next });
          break;
        case 'booking_reminder':
          await bookingsApi.updateSettings({ reminderEnabled: next });
          break;
      }
    },
    onMutate: ({ type }) => setPendingType(type),
    onSuccess: () => haptic('success'),
    onError: (e: any) => {
      haptic('error');
      Alert.alert('Ошибка', e?.response?.data?.message || 'Не удалось изменить настройку');
    },
    onSettled: () => {
      setPendingType(null);
      // Реестр + все экраны-редакторы, которые читают эти же настройки.
      queryClient.invalidateQueries({ queryKey: ['marketing-auto-mailings'] });
      queryClient.invalidateQueries({ queryKey: ['marketing-settings'] });
      queryClient.invalidateQueries({ queryKey: ['marketing-car-ready'] });
      queryClient.invalidateQueries({ queryKey: ['reminder-settings'] });
      queryClient.invalidateQueries({ queryKey: ['installment-reminder-settings'] });
      queryClient.invalidateQueries({ queryKey: ['booking-settings'] });
    },
  });

  /**
   * Включение любого сценария — только через явное подтверждение: видно,
   * ЧТО и КОГДА уйдёт клиенту (страх «пойдут ещё какие-то смс» снимается до
   * включения, а не после). Для «Запроса отзыва» показываем реальный шаблон
   * сообщения. Выключение — мгновенно, без церемоний.
   */
  const requestToggle = (item: AutoMailingOverview) => {
    if (pendingType) return;
    haptic('select');
    const next = !item.enabled;
    if (!next) {
      toggle.mutate({ type: item.type, next });
      return;
    }
    const meta = AUTO_META[item.type];
    if (item.type === 'review') {
      const template =
        settingsQuery.data?.messageTemplate ||
        'Здравствуйте, {clientName}! Спасибо за визит в {tenantName}. Оцените качество обслуживания: {reviewLink}';
      Alert.alert(
        'Включить запрос отзыва?',
        `После каждого закрытого заказ-наряда клиент ОДИН раз получит сообщение:\n\n«${template}»\n\n` +
          '{clientName} — имя клиента, {tenantName} — название сервиса, {reviewLink} — персональная ссылка на отзыв. ' +
          'Текст меняется в «Настройки» → «Запрос отзыва».',
        [
          { text: 'Отмена', style: 'cancel' },
          { text: 'Включить', onPress: () => toggle.mutate({ type: item.type, next }) },
        ],
      );
      return;
    }
    Alert.alert(
      `Включить «${item.humanTitle ?? meta.title}»?`,
      `${item.trigger ?? item.summary}. Каждая отправка проходит общий анти-спам-фильтр — дубли и лишние сообщения отсекаются.`,
      [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Включить', onPress: () => toggle.mutate({ type: item.type, next }) },
      ],
    );
  };

  return (
    <View style={{ gap: spacing[3] }}>
      {/* Anti-spam trust note */}
      <View
        style={[styles.antiSpam, { backgroundColor: palette.accent.primarySoft, borderColor: palette.accent.primary }]}
      >
        <Ionicons name="shield-checkmark-outline" size={18} color={palette.accent.primary} />
        <Text style={[styles.antiSpamText, { color: palette.text.secondary }]}>
          Здесь ВСЕ автоматические сообщения клиентам — других нет. Всё проходит общий анти-спам-фильтр: не больше 3
          сообщений клиенту за 24 часа, повторы отсекаются. Каждая отправка видна в «Журнале отправок».
        </Text>
      </View>

      {query.isLoading && items.length === 0 ? (
        <ActivityIndicator color={palette.accent.primary} style={{ marginTop: spacing[6] }} />
      ) : items.length === 0 ? (
        <View style={styles.emptyBlock}>
          <View style={[styles.emptyIcon, { backgroundColor: palette.bg.muted }]}>
            <Ionicons name="notifications-off-outline" size={26} color={palette.text.tertiary} />
          </View>
          <Text style={[styles.emptyTitle, { color: palette.text.primary }]}>Авто-рассылки не настроены</Text>
          <Text style={[styles.emptyHint, { color: palette.text.tertiary, textAlign: 'center' }]}>
            Включите их в «Настройки» — там же задаётся текст.
          </Text>
        </View>
      ) : (
        items.map((it, idx) => {
          const meta = AUTO_META[it.type] ?? {
            title: it.humanTitle ?? it.type,
            icon: 'notifications-outline' as const,
            tint: colors.slate[600],
          };
          return (
            <AnimatedCard
              key={it.type}
              index={idx}
              style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
            >
              <View style={styles.autoRow}>
                <View
                  style={[
                    styles.autoIcon,
                    { backgroundColor: palette.mode === 'dark' ? softTint(meta.tint, 'dark') : `${meta.tint}18` },
                  ]}
                >
                  <Ionicons name={meta.icon} size={20} color={meta.tint} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.autoTitle, { color: palette.text.primary }]} numberOfLines={1}>
                    {it.humanTitle ?? meta.title}
                  </Text>
                  <Text style={[styles.autoSummary, { color: palette.text.tertiary }]} numberOfLines={2}>
                    {it.trigger ?? it.summary}
                  </Text>
                </View>
                {pendingType === it.type ? (
                  <ActivityIndicator size="small" color={palette.accent.primary} />
                ) : (
                  <AutoSwitch value={it.enabled} onToggle={() => requestToggle(it)} />
                )}
              </View>

              {/* Последняя реальная отправка (из журнала) + переход к настройке */}
              <View style={[styles.autoFooter, { borderTopColor: palette.border.subtle }]}>
                <Text style={[styles.autoLastSent, { color: palette.text.tertiary }]} numberOfLines={1}>
                  {formatLastSent(it.lastSentAt)}
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    haptic('tap');
                    navigation.navigate(AUTO_SETTINGS_SCREEN[it.type] ?? 'MarketingSettings');
                  }}
                  hitSlop={8}
                  style={styles.autoConfigureBtn}
                >
                  <Text style={[styles.autoConfigure, { color: palette.accent.primary }]}>Настроить</Text>
                  <Ionicons name="chevron-forward" size={13} color={palette.accent.primary} />
                </TouchableOpacity>
              </View>
            </AnimatedCard>
          );
        })
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Screen
// ─────────────────────────────────────────────────────────────────────

export default function MailingsScreen() {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<TabKey>('manual');
  const [refreshing, setRefreshing] = useState(false);

  const tabs: {
    key: TabKey;
    label: string;
    iconOutline: keyof typeof Ionicons.glyphMap;
    iconSolid: keyof typeof Ionicons.glyphMap;
  }[] = useMemo(
    () => [
      { key: 'manual', label: 'Ручная', iconOutline: 'paper-plane-outline', iconSolid: 'paper-plane' },
      { key: 'auto', label: 'Авто', iconOutline: 'notifications-outline', iconSolid: 'notifications' },
    ],
    [],
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['marketing-integrations'] }),
      queryClient.invalidateQueries({ queryKey: ['marketing-auto-mailings'] }),
    ]);
    setRefreshing(false);
  };

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Рассылки" onBack={() => navigation.goBack()} />

      <View style={styles.tabBarWrap}>
        <View style={[styles.tabBar, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
          {tabs.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                style={[styles.tab, active && [styles.tabActive, { backgroundColor: palette.bg.card }]]}
                onPress={() => {
                  haptic('select');
                  setActiveTab(tab.key);
                }}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={active ? tab.iconSolid : tab.iconOutline}
                  size={15}
                  color={active ? palette.accent.primary : palette.text.tertiary}
                />
                <Text
                  style={[
                    styles.tabText,
                    {
                      color: active ? palette.text.primary : palette.text.tertiary,
                      fontWeight: active ? fontWeight.bold : fontWeight.medium,
                    },
                  ]}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* KeyboardAwareScroll (Round 11 #1): поле сообщения (multiline) держится
          над клавиатурой на iOS И Android. paddingBottom >= tabBarHeight —
          правило плавающего tab bar не нарушено. */}
      <KeyboardAwareScroll
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + spacing[4] }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.accent.primary} />
        }
      >
        {activeTab === 'manual' ? <ManualTab /> : <AutoTab />}
      </KeyboardAwareScroll>
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

  // Segmented tab control
  tabBarWrap: { paddingHorizontal: spacing[4], paddingBottom: spacing[2.5] },
  tabBar: {
    flexDirection: 'row',
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 4,
    gap: 4,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
  },
  tabActive: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  tabText: { fontSize: 13 },

  card: { borderRadius: borderRadius['2xl'], borderWidth: 1, padding: spacing[4] },

  // Step header
  stepHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], marginBottom: spacing[3] },
  stepNumber: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  stepNumberText: { color: colors.white, fontSize: 13, fontWeight: '700' },
  stepTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, letterSpacing: -0.2 },
  stepHint: { fontSize: 11, marginTop: 2 },

  // Segment rows
  segmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    padding: spacing[3],
  },
  segmentTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  segmentSub: { fontSize: 11, marginTop: 2 },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },

  subLabel: { fontSize: fontSize.xs, fontWeight: fontWeight.medium },

  // Day chips
  dayChip: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },

  // Source chips
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  sourceChip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },

  // Channel chips
  channelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  channelNote: { fontSize: 11, marginTop: spacing[2.5], lineHeight: 15 },

  // Client picker
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
  },
  searchInput: { flex: 1, fontSize: fontSize.sm, padding: 0 },
  clientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    marginBottom: spacing[2],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clientName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  clientPhone: { fontSize: fontSize.xs, marginTop: 1 },

  // Templates + message
  templateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  textArea: {
    borderWidth: 1,
    borderRadius: borderRadius.xl,
    padding: spacing[3],
    fontSize: fontSize.sm,
    minHeight: 110,
  },
  varHint: { fontSize: 11, marginTop: spacing[2] },

  // Result
  resultCard: { borderRadius: borderRadius['2xl'], borderWidth: 1, padding: spacing[4] },
  resultRow: { flexDirection: 'row' },
  resultStat: { flex: 1, alignItems: 'center' },
  resultValue: { fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] },
  resultLabel: { fontSize: 11, marginTop: 2 },
  resultNote: { fontSize: 11, marginTop: spacing[3], lineHeight: 15, textAlign: 'center' },

  // Send
  sendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[4],
  },
  sendBtnText: { color: colors.white, fontSize: fontSize.base, fontWeight: fontWeight.bold },

  // Anti-spam note
  antiSpam: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2.5],
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    padding: spacing[3.5],
  },
  antiSpamText: { flex: 1, fontSize: fontSize.xs, lineHeight: 17 },

  // Auto rows
  autoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  autoIcon: { width: 44, height: 44, borderRadius: borderRadius.xl, alignItems: 'center', justifyContent: 'center' },
  autoTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, letterSpacing: -0.2 },
  autoSummary: { fontSize: fontSize.xs, marginTop: 2, lineHeight: 16 },
  statePill: { paddingHorizontal: spacing[2], paddingVertical: 3, borderRadius: borderRadius.full },
  autoConfigure: { fontSize: 12, fontWeight: '600' },
  autoFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: spacing[3],
    paddingTop: spacing[2.5],
  },
  autoLastSent: { flex: 1, fontSize: 11 },
  autoConfigureBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },

  // iOS-переключатель (общий язык с MarketingSettingsScreen)
  switchTrack: { width: 46, height: 26, borderRadius: 13, justifyContent: 'center' },
  switchThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.white,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },

  // Empty
  emptyBlock: { alignItems: 'center', paddingVertical: spacing[10], gap: spacing[3] },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  emptyHint: { fontSize: fontSize.sm, maxWidth: 280 },
});
