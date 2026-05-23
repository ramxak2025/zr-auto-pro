/**
 * MailingsScreen — "Рассылки".
 *
 * Three tabs:
 *   • SMS-напоминания — toggle / interval / template / "Отправить сейчас"
 *                       (moved here from MarketingScreen).
 *   • Ручная рассылка — pick clients, choose channel + template, send.
 *   • История          — past mailings list (best-effort; stubs when the
 *                        backend doesn't yet expose history).
 *
 * The «Ручная рассылка» / «История» tabs are forward-looking — the backend
 * exposes `marketingApi.sendSms` (single recipient) today, so we batch
 * client-side and surface a clear "Отправлено N / ошибок M" toast. As soon
 * as a real `/marketing/mailings` endpoint lands we can swap the loop for
 * one call without changing the UX.
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

type TabKey = 'reminders' | 'manual' | 'history';

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
//  SMS-напоминания
// ─────────────────────────────────────────────────────────────────────

function RemindersTab() {
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

  // Sync local state once settings arrive
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
      Alert.alert('Готово', 'Настройки сохранены');
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось сохранить настройки');
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
      Alert.alert('Ошибка', 'Не удалось отправить напоминания');
    },
  });

  return (
    <View style={{ gap: spacing[4] }}>
      <AnimatedCard
        index={0}
        style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
      >
        <Text style={[styles.sectionTitle, { color: palette.text.primary, marginBottom: spacing[3] }]}>
          Авто-напоминания клиентам
        </Text>

        {/* Toggle row */}
        <View style={[styles.settingsRow, { borderBottomColor: palette.border.subtle }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.settingsRowLabel, { color: palette.text.primary }]}>
              Авто-напоминания включены
            </Text>
            <Text style={{ fontSize: 11, color: palette.text.tertiary, marginTop: 2 }}>
              Рассылка клиентам, давно не посещавшим сервис
            </Text>
          </View>
          <TouchableOpacity
            style={[
              styles.toggleBtn,
              { backgroundColor: enabled ? palette.accent.primary : palette.bg.muted },
            ]}
            onPress={() => {
              haptic('select');
              setEnabled((v) => !v);
            }}
          >
            <Text
              style={{
                fontSize: 12,
                fontWeight: '600',
                color: enabled ? colors.white : palette.text.tertiary,
              }}
            >
              {enabled ? 'Вкл' : 'Выкл'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Interval */}
        <View style={{ marginTop: spacing[3] }}>
          <Text
            style={[styles.settingsRowLabel, { color: palette.text.secondary, marginBottom: spacing[2] }]}
          >
            Интервал (месяцев с визита)
          </Text>
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
                      fontSize: 13,
                      fontWeight: '600',
                      color: active ? colors.white : palette.text.secondary,
                    }}
                  >
                    {m} мес.
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Template */}
        <View style={{ marginTop: spacing[3] }}>
          <Text
            style={[styles.settingsRowLabel, { color: palette.text.secondary, marginBottom: spacing[1.5] }]}
          >
            Шаблон сообщения
          </Text>
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
            placeholder="Привет, {name}! Прошло {months} месяцев с вашего последнего визита. Ждём вас в сервисе!"
            placeholderTextColor={palette.text.tertiary}
          />
          <Text style={{ fontSize: 11, color: palette.text.tertiary, marginTop: spacing[1] }}>
            Переменные: {'{name}'} — имя, {'{months}'} — месяцев, {'{car}'} — авто
          </Text>
        </View>

        <TouchableOpacity
          style={[
            styles.primaryBtn,
            { backgroundColor: palette.accent.primary },
            saveSettings.isPending && { opacity: 0.6 },
          ]}
          onPress={() => saveSettings.mutate()}
          disabled={saveSettings.isPending}
        >
          {saveSettings.isPending ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <>
              <Ionicons name="checkmark-circle" size={18} color={colors.white} />
              <Text style={styles.primaryBtnText}>Сохранить</Text>
            </>
          )}
        </TouchableOpacity>

        <View
          style={{
            height: StyleSheet.hairlineWidth,
            backgroundColor: palette.border.subtle,
            marginVertical: spacing[3],
          }}
        />

        <TouchableOpacity
          style={[
            styles.secondaryBtn,
            { backgroundColor: colors.orange[50], borderColor: colors.orange[400] },
            sendNow.isPending && { opacity: 0.6 },
          ]}
          onPress={() => {
            haptic('tap');
            setSendResult(null);
            sendNow.mutate();
          }}
          disabled={sendNow.isPending}
        >
          {sendNow.isPending ? (
            <ActivityIndicator size="small" color={colors.orange[600]} />
          ) : (
            <>
              <Ionicons name="send-outline" size={16} color={colors.orange[600]} />
              <Text style={{ fontSize: 14, fontWeight: '600', color: colors.orange[700] }}>
                Отправить сейчас
              </Text>
            </>
          )}
        </TouchableOpacity>

        {sendResult ? (
          <Text
            style={{
              fontSize: 12,
              color: palette.text.secondary,
              textAlign: 'center',
              marginTop: spacing[2],
            }}
          >
            {sendResult}
          </Text>
        ) : null}
      </AnimatedCard>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Ручная рассылка
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
      // No backend bulk endpoint yet — fire one SMS per recipient in
      // sequence so a single failure doesn't abort the whole batch.
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
      Alert.alert('Ошибка', 'Не удалось отправить рассылку');
    },
  });

  const canSend = pickedIds.length > 0 && message.trim().length > 0 && !send.isPending;

  return (
    <View style={{ gap: spacing[4] }}>
      {/* Recipients */}
      <View style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionTitle, { color: palette.text.primary, marginBottom: 0 }]}>
            Получатели
          </Text>
          <Text style={[styles.sectionAside, { color: palette.text.tertiary }]}>
            выбрано: {pickedIds.length}
          </Text>
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

        <View style={{ maxHeight: 260, marginTop: spacing[2] }}>
          {clientsQuery.isLoading && clients.length === 0 ? (
            <ActivityIndicator color={palette.accent.primary} style={{ marginVertical: spacing[4] }} />
          ) : clients.length === 0 ? (
            <Text style={[styles.helperText, { color: palette.text.tertiary }]}>Ничего не найдено</Text>
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
      </View>

      {/* Channel + templates */}
      <View style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
        <Text style={[styles.sectionTitle, { color: palette.text.primary }]}>Сообщение</Text>

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
        <Text style={{ fontSize: 11, color: palette.text.tertiary, marginTop: spacing[1] }}>
          Переменные: {'{имя}'}, {'{авто}'} — будут подставлены для каждого получателя
        </Text>

        <TouchableOpacity
          style={[
            styles.primaryBtn,
            { backgroundColor: palette.accent.primary, marginTop: spacing[3] },
            !canSend && { opacity: 0.55 },
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
              <Ionicons name="send" size={16} color={colors.white} />
              <Text style={styles.primaryBtnText}>
                Отправить{pickedIds.length > 0 ? ` (${pickedIds.length})` : ''}
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
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
        <Text style={[styles.emptyTitle, { color: palette.text.primary }]}>История пуста</Text>
        <Text style={[styles.emptyHint, { color: palette.text.tertiary }]}>
          История появится после первой рассылки
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
          style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[3] }}>
            <View style={[styles.histIcon, { backgroundColor: palette.accent.primarySoft }]}>
              <Ionicons
                name={h.channel === 'whatsapp' ? 'logo-whatsapp' : 'chatbox'}
                size={18}
                color={palette.accent.primary}
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
                {h.audience} получателей · доставлено {h.delivered}
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
  const [activeTab, setActiveTab] = useState<TabKey>('reminders');
  const [refreshing, setRefreshing] = useState(false);
  // History is in-memory only until the backend ships a real endpoint.
  const [history, setHistory] = useState<ManualHistoryEntry[]>([]);

  const tabs: { key: TabKey; label: string; icon: keyof typeof Ionicons.glyphMap }[] = useMemo(
    () => [
      { key: 'reminders', label: 'Напоминания', icon: 'notifications-outline' },
      { key: 'manual', label: 'Рассылка', icon: 'paper-plane-outline' },
      { key: 'history', label: 'История', icon: 'time-outline' },
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

      <View style={styles.tabBar}>
        {tabs.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[
                styles.tab,
                { backgroundColor: palette.bg.muted },
                active && {
                  backgroundColor: palette.accent.primarySoft,
                  borderWidth: 1,
                  borderColor: palette.accent.primary,
                },
              ]}
              onPress={() => {
                haptic('select');
                setActiveTab(tab.key);
              }}
            >
              <Ionicons
                name={(active ? tab.icon.replace('-outline', '') : tab.icon) as any}
                size={16}
                color={active ? palette.accent.primary : palette.text.tertiary}
              />
              <Text
                style={[
                  styles.tabText,
                  { color: active ? palette.accent.primary : palette.text.tertiary },
                  active && { fontWeight: fontWeight.bold },
                ]}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + spacing[4] }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.accent.primary} />
        }
        keyboardShouldPersistTaps="handled"
      >
        {activeTab === 'reminders' && <RemindersTab />}
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
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: spacing[3],
    paddingBottom: spacing[2],
    gap: spacing[2],
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.xl,
  },
  tabText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },

  scroll: { flex: 1 },
  scrollContent: { padding: spacing[4] },

  card: {
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    padding: spacing[4],
  },
  sectionTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, marginBottom: spacing[3] },
  sectionAside: { fontSize: fontSize.xs, fontWeight: fontWeight.medium },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[3],
  },

  // Settings rows
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  settingsRowLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  toggleBtn: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
    borderRadius: borderRadius.full,
    minWidth: 56,
    alignItems: 'center',
  },
  intervalChip: {
    flex: 1,
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingVertical: spacing[2],
    alignItems: 'center',
  },

  textArea: {
    borderWidth: 1,
    borderRadius: borderRadius.xl,
    padding: spacing[3],
    fontSize: fontSize.sm,
    textAlignVertical: 'top',
    minHeight: 100,
  },
  helperText: { fontSize: fontSize.xs, paddingVertical: spacing[3] },

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

  // History
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
