/**
 * MailingsScreen — "Рассылки".
 *
 * Owner feedback ("сам дизайн ux ui не нравится, надо сделать современный
 * и удобный и убрать тавтологию в словах") drove a full UI rebuild:
 *
 *   • Round segmented control tabs (capsule, not square chips).
 *   • Tab labels deduplicated: "Авто-напоминания" / "Ручная" / "История".
 *     The word «рассылка» is no longer repeated on every tab.
 *   • Step-based "Ручная" tab — Получатели → Сообщение → Отправить.
 *   • Polished history rows with channel icon + delivery status pill.
 *   • All Ionicons names verified to have explicit map entries (active
 *     variants get a `tab.iconSolid` so the runtime never has to strip
 *     `-outline` and hit the Circle fallback).
 *
 * Backend stays unchanged — manual bulk send still loops `sendSms` per
 * recipient client-side; history is in-memory until `/marketing/mailings`
 * ships server-side.
 */
import React, { useMemo, useState } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Pressable,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { useColors } from '../contexts/ThemeContext';
import { marketingApi, clientsApi } from '../api/services';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import IosScreenHeader from '../components/IosScreenHeader';
import AnimatedCard from '../components/AnimatedCard';
import { Text } from '../platform/Typography';
import { haptic } from '../platform/haptics';
import type { Client } from '../../../shared/types';

type TabKey = 'auto' | 'manual' | 'history';

const TEMPLATES: { id: string; title: string; body: string }[] = [
  {
    id: 'thanks',
    title: 'Спасибо за визит',
    body: 'Здравствуйте, {имя}! Спасибо за визит в наш сервис. Будем рады видеть вас снова.',
  },
  {
    id: 'maintenance',
    title: 'Напоминание о ТО',
    body: 'Здравствуйте, {имя}! По нашим данным вашему {авто} скоро потребуется ТО. Запишитесь по телефону.',
  },
  {
    id: 'seasonal',
    title: 'Сезонная акция',
    body: 'Здравствуйте, {имя}! Сейчас сезон смены резины — успейте записаться по специальной цене.',
  },
  {
    id: 'oil',
    title: 'Скидка на масло',
    body: 'Здравствуйте, {имя}! Только в этом месяце скидка 10% на замену моторного масла.',
  },
];

// ─────────────────────────────────────────────────────────────────────
//  Авто-напоминания
// ─────────────────────────────────────────────────────────────────────

function AutoTab() {
  const palette = useColors();

  const [enabled, setEnabled] = useState(false);
  const [monthsInterval, setMonthsInterval] = useState(6);
  const [messageTemplate, setMessageTemplate] = useState('');
  const [sendResult, setSendResult] = useState<string | null>(null);

  const { data: settings, refetch: refetchSettings } = useQuery({
    queryKey: ['reminder-settings'],
    queryFn: async () => (await marketingApi.getReminderSettings()).data,
    staleTime: 60_000,
  });

  React.useEffect(() => {
    if (settings) {
      setEnabled(settings.enabled);
      setMonthsInterval(settings.monthsInterval);
      setMessageTemplate(settings.messageTemplate);
    }
  }, [settings]);

  const saveSettings = useMutation({
    mutationFn: () => marketingApi.updateReminderSettings({ enabled, monthsInterval, messageTemplate }),
    onSuccess: () => {
      haptic('success');
      refetchSettings();
      Alert.alert('Сохранено', 'Настройки применены');
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось сохранить');
    },
  });

  const sendNow = useMutation({
    mutationFn: () => marketingApi.sendReminders(),
    onSuccess: (res) => {
      haptic('success');
      setSendResult(`Отправлено: ${res.data.sent}, ошибок: ${res.data.errors}`);
      Alert.alert('Готово', `Отправлено: ${res.data.sent}, ошибок: ${res.data.errors}`);
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось отправить');
    },
  });

  const insertVariable = (variable: string) => {
    haptic('select');
    setMessageTemplate((prev) => `${prev}${variable}`);
  };

  return (
    <View style={{ gap: spacing[3] }}>
      {/* Big enable row */}
      <AnimatedCard
        index={0}
        style={[styles.bigToggleCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
      >
        <View style={[styles.bigToggleIcon, { backgroundColor: enabled ? colors.green[50] : palette.bg.muted }]}>
          <Ionicons
            name={enabled ? 'notifications' : 'notifications-outline'}
            size={20}
            color={enabled ? colors.green[600] : palette.text.tertiary}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.bigToggleTitle, { color: palette.text.primary }]}>Авто-напоминания о ТО</Text>
          <Text style={[styles.bigToggleSub, { color: palette.text.tertiary }]}>
            {enabled ? 'Включены — клиенты получают раз в N месяцев' : 'Отключены — никому не пишем'}
          </Text>
        </View>
        <Pressable
          onPress={() => {
            haptic('select');
            setEnabled((v) => !v);
          }}
          style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}
          hitSlop={8}
        >
          <View
            style={[
              styles.switchTrack,
              { backgroundColor: enabled ? palette.accent.primary : palette.border.strong },
            ]}
          >
            <View style={[styles.switchThumb, { transform: [{ translateX: enabled ? 20 : 2 }] }]} />
          </View>
        </Pressable>
      </AnimatedCard>

      {/* Interval */}
      <AnimatedCard
        index={1}
        style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
      >
        <Text style={[styles.sectionTitle, { color: palette.text.primary }]}>Раз в N месяцев</Text>
        <View style={{ flexDirection: 'row', gap: spacing[2] }}>
          {[3, 6, 12].map((m) => {
            const active = monthsInterval === m;
            return (
              <TouchableOpacity
                key={m}
                style={[
                  styles.intervalChip,
                  {
                    backgroundColor: active ? palette.accent.primary : palette.bg.muted,
                    borderColor: active ? palette.accent.primary : palette.border.subtle,
                  },
                ]}
                onPress={() => {
                  haptic('select');
                  setMonthsInterval(m);
                }}
              >
                <Text
                  style={{
                    fontSize: fontSize.sm,
                    fontWeight: fontWeight.bold,
                    color: active ? colors.white : palette.text.secondary,
                  }}
                >
                  {m}
                </Text>
                <Text
                  style={{
                    fontSize: 11,
                    color: active ? colors.white : palette.text.tertiary,
                  }}
                >
                  {m === 3 ? 'месяца' : 'месяцев'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </AnimatedCard>

      {/* Template */}
      <AnimatedCard
        index={2}
        style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
      >
        <View style={styles.sectionHeaderRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
            <Ionicons name="document-text-outline" size={16} color={palette.text.secondary} />
            <Text style={[styles.sectionTitle, { color: palette.text.primary, marginBottom: 0 }]}>
              Шаблон сообщения
            </Text>
          </View>
        </View>

        <TextInput
          value={messageTemplate}
          onChangeText={setMessageTemplate}
          style={[
            styles.textArea,
            {
              backgroundColor: palette.bg.muted,
              borderColor: palette.border.subtle,
              color: palette.text.primary,
            },
          ]}
          multiline
          numberOfLines={4}
          placeholder="Здравствуйте, {имя}! Прошло {месяцы} месяцев с вашего последнего визита. Ждём вас!"
          placeholderTextColor={palette.text.tertiary}
        />

        <Text style={[styles.varHint, { color: palette.text.tertiary }]}>
          Переменные — нажмите, чтобы вставить
        </Text>
        <View style={styles.varRow}>
          {[
            { label: '{имя}', insert: '{имя}' },
            { label: '{авто}', insert: '{авто}' },
            { label: '{месяцы}', insert: '{месяцы}' },
          ].map((v) => (
            <TouchableOpacity
              key={v.label}
              onPress={() => insertVariable(v.insert)}
              style={[
                styles.varChip,
                { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
              ]}
            >
              <Text style={{ fontSize: 12, color: palette.accent.primary, fontWeight: '600' }}>
                {v.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </AnimatedCard>

      {/* Actions */}
      <View style={styles.actionsRow}>
        <TouchableOpacity
          style={[
            styles.actionBtnPrimary,
            { backgroundColor: palette.accent.primary },
            saveSettings.isPending && { opacity: 0.7 },
          ]}
          onPress={() => {
            haptic('tap');
            saveSettings.mutate();
          }}
          disabled={saveSettings.isPending}
        >
          {saveSettings.isPending ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={16} color={colors.white} />
              <Text style={styles.actionBtnPrimaryText}>Сохранить</Text>
            </>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.actionBtnSecondary,
            { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
            sendNow.isPending && { opacity: 0.7 },
          ]}
          onPress={() => {
            haptic('tap');
            setSendResult(null);
            sendNow.mutate();
          }}
          disabled={sendNow.isPending}
        >
          {sendNow.isPending ? (
            <ActivityIndicator size="small" color={palette.text.primary} />
          ) : (
            <>
              <Ionicons name="paper-plane-outline" size={16} color={palette.text.primary} />
              <Text style={[styles.actionBtnSecondaryText, { color: palette.text.primary }]}>
                Отправить сейчас
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>

      {sendResult ? (
        <Text style={[styles.resultText, { color: palette.text.tertiary }]}>{sendResult}</Text>
      ) : null}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Ручная
// ─────────────────────────────────────────────────────────────────────

function ManualTab({
  history,
  setHistory,
}: {
  history: ManualHistoryEntry[];
  setHistory: (next: ManualHistoryEntry[]) => void;
}) {
  const palette = useColors();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<Record<string, Client>>({});
  const [channel, setChannel] = useState<'sms' | 'whatsapp'>('sms');
  const [message, setMessage] = useState('');

  const clientsQuery = useQuery({
    queryKey: ['mailings-clients', search],
    queryFn: async () =>
      (await clientsApi.getAll({ search, page: 1, limit: 50 })).data,
    staleTime: 30_000,
  });
  const clients = clientsQuery.data?.data ?? [];
  const pickedIds = Object.keys(picked);

  const togglePick = (c: Client) => {
    haptic('select');
    setPicked((prev) => {
      const next = { ...prev };
      if (next[c.id]) delete next[c.id];
      else next[c.id] = c;
      return next;
    });
  };

  const applyTemplate = (tpl: (typeof TEMPLATES)[number]) => {
    haptic('tap');
    setMessage(tpl.body);
  };

  const send = useMutation({
    mutationFn: async () => {
      let sent = 0;
      let errors = 0;
      for (const id of pickedIds) {
        const c = picked[id];
        if (!c.phone) {
          errors += 1;
          continue;
        }
        const text = renderTemplate(message, c);
        try {
          await marketingApi.sendSms({ phone: c.phone, text });
          sent += 1;
        } catch {
          errors += 1;
        }
      }
      return { sent, errors };
    },
    onSuccess: (res) => {
      haptic('success');
      const entry: ManualHistoryEntry = {
        id: `local-${Date.now()}`,
        sentAt: new Date().toISOString(),
        channel,
        audience: pickedIds.length,
        delivered: res.sent,
        failed: res.errors,
        textPreview: message.slice(0, 80),
      };
      setHistory([entry, ...history].slice(0, 50));
      Alert.alert(
        'Готово',
        `Отправлено: ${res.sent}${res.errors ? `, ошибок: ${res.errors}` : ''}`,
      );
      setPicked({});
      setMessage('');
      queryClient.invalidateQueries({ queryKey: ['marketing-dashboard'] });
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось отправить');
    },
  });

  const canSend = pickedIds.length > 0 && message.trim().length > 0 && !send.isPending;

  return (
    <View style={{ gap: spacing[3] }}>
      {/* Step 1 — Получатели */}
      <AnimatedCard
        index={0}
        style={[styles.stepCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
      >
        <View style={styles.stepHeader}>
          <View style={[styles.stepNumber, { backgroundColor: palette.accent.primary }]}>
            <Text style={styles.stepNumberText}>1</Text>
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[1.5] }}>
              <Ionicons name="people-outline" size={15} color={palette.text.primary} />
              <Text style={[styles.stepTitle, { color: palette.text.primary }]}>Получатели</Text>
            </View>
            <Text style={[styles.stepCount, { color: palette.text.tertiary }]}>
              Выбрано: {pickedIds.length}
            </Text>
          </View>
          {pickedIds.length > 0 && (
            <TouchableOpacity
              onPress={() => {
                haptic('tap');
                setPicked({});
              }}
              hitSlop={6}
            >
              <Text style={[styles.stepClear, { color: palette.accent.primary }]}>Сбросить</Text>
            </TouchableOpacity>
          )}
        </View>

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
        </View>

        <View style={{ maxHeight: 240, marginTop: spacing[2] }}>
          {clientsQuery.isLoading && clients.length === 0 ? (
            <ActivityIndicator color={palette.accent.primary} style={{ marginVertical: spacing[4] }} />
          ) : clients.length === 0 ? (
            <Text style={[styles.helperText, { color: palette.text.tertiary }]}>Никого не нашли</Text>
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
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
                          : { borderColor: palette.border.strong, backgroundColor: 'transparent' },
                      ]}
                    >
                      {active && <Ionicons name="checkmark" size={14} color={colors.white} />}
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
      </AnimatedCard>

      {/* Step 2 — Сообщение */}
      <AnimatedCard
        index={1}
        style={[styles.stepCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
      >
        <View style={styles.stepHeader}>
          <View style={[styles.stepNumber, { backgroundColor: palette.accent.primary }]}>
            <Text style={styles.stepNumberText}>2</Text>
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[1.5] }}>
              <Ionicons name="document-text-outline" size={15} color={palette.text.primary} />
              <Text style={[styles.stepTitle, { color: palette.text.primary }]}>Сообщение</Text>
            </View>
            <Text style={[styles.stepCount, { color: palette.text.tertiary }]}>
              Канал · {channel === 'sms' ? 'SMS' : 'WhatsApp'}
            </Text>
          </View>
        </View>

        <View style={{ flexDirection: 'row', gap: spacing[2], marginBottom: spacing[3] }}>
          {(['sms', 'whatsapp'] as const).map((c) => {
            const active = channel === c;
            return (
              <TouchableOpacity
                key={c}
                onPress={() => {
                  haptic('select');
                  setChannel(c);
                }}
                style={[
                  styles.channelChip,
                  {
                    backgroundColor: active ? palette.accent.primarySoft : palette.bg.muted,
                    borderColor: active ? palette.accent.primary : palette.border.subtle,
                  },
                ]}
              >
                <Ionicons
                  name={c === 'sms' ? 'chatbox-outline' : 'logo-whatsapp'}
                  size={16}
                  color={active ? palette.accent.primary : palette.text.tertiary}
                />
                <Text
                  style={{
                    fontSize: fontSize.sm,
                    fontWeight: '600',
                    color: active ? palette.accent.primary : palette.text.secondary,
                  }}
                >
                  {c === 'sms' ? 'SMS' : 'WhatsApp'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: spacing[2], paddingBottom: spacing[1] }}
          style={{ marginBottom: spacing[3] }}
        >
          {TEMPLATES.map((tpl) => (
            <TouchableOpacity
              key={tpl.id}
              onPress={() => applyTemplate(tpl)}
              style={[
                styles.templateChip,
                { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
              ]}
            >
              <Ionicons name="document-text-outline" size={13} color={palette.text.secondary} />
              <Text style={{ fontSize: 12, fontWeight: '600', color: palette.text.secondary }}>
                {tpl.title}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <TextInput
          value={message}
          onChangeText={setMessage}
          style={[
            styles.textArea,
            {
              backgroundColor: palette.bg.muted,
              borderColor: palette.border.subtle,
              color: palette.text.primary,
            },
          ]}
          multiline
          numberOfLines={5}
          placeholder="Введите сообщение или выберите шаблон выше"
          placeholderTextColor={palette.text.tertiary}
        />
        <Text style={[styles.varHint, { color: palette.text.tertiary }]}>
          Переменные {'{имя}'}, {'{авто}'} подставятся для каждого получателя
        </Text>
      </AnimatedCard>

      {/* Step 3 — Send */}
      <TouchableOpacity
        style={[
          styles.bigSendBtn,
          { backgroundColor: palette.accent.primary },
          !canSend && { opacity: 0.5 },
        ]}
        disabled={!canSend}
        onPress={() => {
          haptic('tap');
          send.mutate();
        }}
      >
        {send.isPending ? (
          <ActivityIndicator size="small" color={colors.white} />
        ) : (
          <>
            <Ionicons name="paper-plane" size={18} color={colors.white} />
            <Text style={styles.bigSendBtnText}>
              {pickedIds.length > 0
                ? `Отправить ${pickedIds.length} ${pluralize(pickedIds.length)}`
                : 'Выберите получателей'}
            </Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

function pluralize(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'сообщение';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'сообщения';
  return 'сообщений';
}

function renderTemplate(tpl: string, client: Client): string {
  const firstName = client.fullName.split(' ')[0] || client.fullName;
  const car = client.cars?.[0];
  const carLabel = car ? car.makeModel || car.plateNumber : 'ваш автомобиль';
  return tpl
    .replace(/\{имя\}/g, firstName)
    .replace(/\{name\}/g, firstName)
    .replace(/\{авто\}/g, carLabel)
    .replace(/\{car\}/g, carLabel);
}

// ─────────────────────────────────────────────────────────────────────
//  История
// ─────────────────────────────────────────────────────────────────────

interface ManualHistoryEntry {
  id: string;
  sentAt: string;
  channel: 'sms' | 'whatsapp';
  audience: number;
  delivered: number;
  failed: number;
  textPreview: string;
}

function HistoryTab({ history }: { history: ManualHistoryEntry[] }) {
  const palette = useColors();
  if (history.length === 0) {
    return (
      <View style={styles.emptyCard}>
        <View style={[styles.emptyIcon, { backgroundColor: palette.bg.muted }]}>
          <Ionicons name="time-outline" size={28} color={palette.text.tertiary} />
        </View>
        <Text style={[styles.emptyTitle, { color: palette.text.primary }]}>Здесь будут отправленные рассылки</Text>
        <Text style={[styles.emptyHint, { color: palette.text.tertiary }]}>
          История появится после первой отправки
        </Text>
      </View>
    );
  }
  return (
    <View style={{ gap: spacing[3] }}>
      {history.map((h, idx) => (
        <AnimatedCard
          key={h.id}
          index={idx}
          style={[styles.histCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[3] }}>
            <View
              style={[
                styles.histIcon,
                {
                  backgroundColor:
                    h.channel === 'whatsapp' ? '#dcf8c6' : palette.accent.primarySoft,
                },
              ]}
            >
              <Ionicons
                name={h.channel === 'whatsapp' ? 'logo-whatsapp' : 'chatbox'}
                size={18}
                color={h.channel === 'whatsapp' ? '#075E54' : palette.accent.primary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.histTitle, { color: palette.text.primary }]}>
                {new Date(h.sentAt).toLocaleString('ru-RU', {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
              <Text style={[styles.histSub, { color: palette.text.tertiary }]}>
                {h.audience} {pluralize(h.audience)} · доставлено {h.delivered}
                {h.failed > 0 ? `, ошибок ${h.failed}` : ''}
              </Text>
            </View>
            <View
              style={[
                styles.statusPill,
                h.failed === 0 ? styles.statusPillOk : { backgroundColor: colors.orange[50] },
              ]}
            >
              <Text
                style={[
                  styles.statusPillText,
                  { color: h.failed === 0 ? colors.green[700] : colors.orange[700] },
                ]}
              >
                {h.failed === 0 ? 'Доставлено' : 'Частично'}
              </Text>
            </View>
          </View>
          {h.textPreview ? (
            <Text style={[styles.histPreview, { color: palette.text.secondary }]} numberOfLines={2}>
              {h.textPreview}
            </Text>
          ) : null}
        </AnimatedCard>
      ))}
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
  const [activeTab, setActiveTab] = useState<TabKey>('auto');
  const [refreshing, setRefreshing] = useState(false);
  // History is in-memory only until the backend ships a real endpoint.
  const [history, setHistory] = useState<ManualHistoryEntry[]>([]);

  const tabs: {
    key: TabKey;
    label: string;
    iconOutline: keyof typeof Ionicons.glyphMap;
    iconSolid: keyof typeof Ionicons.glyphMap;
  }[] = useMemo(
    () => [
      { key: 'auto', label: 'Авто-напоминания', iconOutline: 'notifications-outline', iconSolid: 'notifications' },
      { key: 'manual', label: 'Ручная', iconOutline: 'paper-plane-outline', iconSolid: 'paper-plane' },
      { key: 'history', label: 'История', iconOutline: 'time-outline', iconSolid: 'time' },
    ],
    [],
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['reminder-settings'] });
    await queryClient.invalidateQueries({ queryKey: ['mailings-clients'] });
    setRefreshing(false);
  };

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Рассылки" onBack={() => navigation.goBack()} />

      {/* Round capsule segmented control */}
      <View style={styles.tabBarWrap}>
        <View style={[styles.tabBar, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
          {tabs.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <TouchableOpacity
                key={tab.key}
                style={[
                  styles.tab,
                  active && [styles.tabActive, { backgroundColor: palette.bg.card }],
                ]}
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
                  numberOfLines={1}
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

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + spacing[4] }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.accent.primary} />
        }
        keyboardShouldPersistTaps="handled"
      >
        {activeTab === 'auto' && <AutoTab />}
        {activeTab === 'manual' && <ManualTab history={history} setHistory={setHistory} />}
        {activeTab === 'history' && <HistoryTab history={history} />}
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1 },

  // Round capsule segmented control
  tabBarWrap: {
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[2.5],
  },
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
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.08,
        shadowRadius: 2,
      },
      android: { elevation: 1 },
    }),
  },
  tabText: { fontSize: 12.5 },

  scroll: { flex: 1 },
  scrollContent: { padding: spacing[4] },

  // Generic card
  card: {
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    padding: spacing[4],
  },
  sectionTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, marginBottom: spacing[3] },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[3],
  },

  // Big toggle card (Авто-напоминания master switch)
  bigToggleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    padding: spacing[4],
  },
  bigToggleIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bigToggleTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, letterSpacing: -0.2 },
  bigToggleSub: { fontSize: 12, marginTop: 2 },

  // iOS-style switch
  switchTrack: {
    width: 44,
    height: 26,
    borderRadius: 13,
    justifyContent: 'center',
  },
  switchThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
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

  // Interval chips
  intervalChip: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0,
    paddingVertical: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
  },

  // Variables
  varHint: { fontSize: 11, marginTop: spacing[2], marginBottom: spacing[2] },
  varRow: { flexDirection: 'row', gap: spacing[2], flexWrap: 'wrap' },
  varChip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },

  // Action row (Save + Send now)
  actionsRow: { flexDirection: 'row', gap: spacing[2] },
  actionBtnPrimary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[3.5],
  },
  actionBtnPrimaryText: { color: colors.white, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  actionBtnSecondary: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    paddingVertical: spacing[3.5],
  },
  actionBtnSecondaryText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },

  resultText: { fontSize: 12, textAlign: 'center', marginTop: spacing[2] },

  // Step cards
  stepCard: {
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    padding: spacing[4],
  },
  stepHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginBottom: spacing[3],
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumberText: { color: colors.white, fontSize: 13, fontWeight: '700' },
  stepTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, letterSpacing: -0.2 },
  stepCount: { fontSize: 11, marginTop: 2 },
  stepClear: { fontSize: 12, fontWeight: '600' },

  // Search
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
  helperText: { fontSize: fontSize.xs, paddingVertical: spacing[3], textAlign: 'center' },

  // Client picker rows
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

  // Channel chip
  channelChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },

  // Template chip
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
    textAlignVertical: 'top',
    minHeight: 110,
  },

  // Big send button at bottom of step flow
  bigSendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[4],
  },
  bigSendBtnText: { color: colors.white, fontSize: fontSize.base, fontWeight: fontWeight.bold },

  // History
  histCard: {
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    padding: spacing[4],
  },
  histIcon: {
    width: 38,
    height: 38,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  histTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  histSub: { fontSize: fontSize.xs, marginTop: 2 },
  histPreview: { fontSize: fontSize.xs, marginTop: spacing[3], lineHeight: 18 },
  statusPill: { paddingHorizontal: spacing[2.5], paddingVertical: 4, borderRadius: borderRadius.full },
  statusPillOk: { backgroundColor: colors.green[50] },
  statusPillText: { fontSize: 10, fontWeight: fontWeight.semibold },

  // Empty
  emptyCard: {
    alignItems: 'center',
    paddingVertical: spacing[12],
    gap: spacing[3],
  },
  emptyIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  emptyHint: { fontSize: fontSize.sm, textAlign: 'center', maxWidth: 280 },
});
