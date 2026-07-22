/**
 * WinbackScreen — «Возвращение клиентов».
 *
 * A win-back outreach tool reachable from the Marketing area («Отзывы и
 * репутация» → карточка «Возвращение клиентов»). It surfaces the
 * server-derived segment of clients who have not visited for a chosen
 * number of days, lets the owner preview that segment, compose one
 * broadcast message and send it to the whole segment in one tap.
 *
 * Data contract (backend already shipped on the marketing API):
 *   • marketingApi.winback(days?)      → WinbackClient[]
 *       sorted longest-absent first; never-visited float to the top with
 *       lastVisit === null; capped at 500 rows.
 *   • marketingApi.winbackSend({ days, message }) → { sent, failed, total }
 *
 * The SAME `days` value drives both the preview query and the send call,
 * so the broadcast audience always matches what the owner just saw.
 *
 * Provider-not-configured case: when the send reports sent === 0 while
 * total > 0, we show a soft hint pointing to «Интеграции» instead of an
 * error — nothing is broken, the tenant just hasn't wired a messaging
 * provider yet.
 *
 * Owner-class gated (director / admin / superadmin) — same role family the
 * Marketing screen uses for its owner-only editors. Android-compatible: no
 * iOS-only APIs in this file; haptics + theme go through the shared
 * platform helpers.
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
import { useAuth } from '../contexts/AuthContext';
import { marketingApi } from '../api/services';
import { colors, fontSize, fontWeight, borderRadius, spacing, softTint } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import IosScreenHeader from '../components/IosScreenHeader';
import AnimatedCard from '../components/AnimatedCard';
import { Text } from '../platform/Typography';
import { haptic } from '../platform/haptics';
import type { WinbackClient } from '../../../shared/types';

const DAY_PRESETS = [30, 60, 90, 180] as const;
const DEFAULT_DAYS = 90;
// The list is a PREVIEW — render a bounded slice so a 500-row segment can't
// jank the scroll. The full count is shown in the summary, and the send goes
// to the whole segment (the backend recomputes it for the same `days`).
const PREVIEW_LIMIT = 60;

const DEFAULT_MESSAGE =
  'Здравствуйте! Вы давно не заглядывали к нам в автосервис. Будем рады видеть вас снова — у нас есть выгодное предложение для вас.';

// ─────────────────────────────────────────────────────────────────────
//  Russian pluralisation helpers
// ─────────────────────────────────────────────────────────────────────

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

const clientsWord = (n: number) => plural(n, 'клиент', 'клиента', 'клиентов');
const clientsDative = (n: number) => plural(n, 'клиенту', 'клиентам', 'клиентам');
const daysWord = (n: number) => plural(n, 'день', 'дня', 'дней');
const checksWord = (n: number) => plural(n, 'заказ', 'заказа', 'заказов');

/** «был N дней назад» from an ISO date, or «ни разу» when never visited. */
function lastVisitLabel(lastVisit: string | null): string {
  if (!lastVisit) return 'ни разу';
  const diffMs = Date.now() - new Date(lastVisit).getTime();
  const days = Math.max(0, Math.floor(diffMs / 86_400_000));
  if (days === 0) return 'был сегодня';
  if (days === 1) return 'был вчера';
  return `был ${days} ${daysWord(days)} назад`;
}

// ─────────────────────────────────────────────────────────────────────
//  Preview row
// ─────────────────────────────────────────────────────────────────────

interface WinbackRowProps {
  client: WinbackClient;
  showBorder: boolean;
  palette: ReturnType<typeof useColors>;
}
const WinbackRow = React.memo(function WinbackRow({ client, showBorder, palette }: WinbackRowProps) {
  const never = client.lastVisit === null;
  return (
    <View style={[styles.clientRow, showBorder && [styles.clientRowBorder, { borderTopColor: palette.border.subtle }]]}>
      <View style={[styles.clientAvatar, { backgroundColor: palette.bg.muted }]}>
        <Ionicons name="person-outline" size={15} color={palette.text.secondary} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={[styles.clientName, { color: palette.text.primary }]} numberOfLines={1}>
          {client.name || 'Без имени'}
        </Text>
        <Text style={[styles.clientPhone, { color: palette.text.tertiary }]} numberOfLines={1}>
          {client.phone || 'нет телефона'}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <View
          style={[
            styles.agoPill,
            {
              backgroundColor: never
                ? palette.mode === 'dark'
                  ? softTint(colors.orange[600], 'dark')
                  : colors.orange[50]
                : palette.bg.muted,
            },
          ]}
        >
          <Text
            style={[
              styles.agoPillText,
              {
                color: never
                  ? palette.mode === 'dark'
                    ? colors.orange[400]
                    : colors.orange[700]
                  : palette.text.secondary,
              },
            ]}
          >
            {lastVisitLabel(client.lastVisit)}
          </Text>
        </View>
        {client.totalChecks > 0 ? (
          <Text style={[styles.clientChecks, { color: palette.text.tertiary }]}>
            {client.totalChecks} {checksWord(client.totalChecks)}
          </Text>
        ) : null}
      </View>
    </View>
  );
});

// ─────────────────────────────────────────────────────────────────────
//  Screen
// ─────────────────────────────────────────────────────────────────────

export default function WinbackScreen() {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();

  // Возврат клиентов (winback) — ключ marketing_access (сервер: GET /marketing/
  // winback + POST winback/send → тот же ключ; admin живёт по матрице).
  const canUse = hasPermission('marketing_access');

  const [days, setDays] = useState<number>(DEFAULT_DAYS);
  const [message, setMessage] = useState<string>(DEFAULT_MESSAGE);
  const [refreshing, setRefreshing] = useState(false);
  const [sendResult, setSendResult] = useState<{ sent: number; failed: number; total: number } | null>(null);

  // Preview the segment. Same `days` feeds the send below.
  const previewQuery = useQuery({
    queryKey: ['winback', days],
    queryFn: async () => (await marketingApi.winback(days)).data,
    enabled: canUse,
    staleTime: 30_000,
  });
  const clients: WinbackClient[] = Array.isArray(previewQuery.data) ? previewQuery.data : [];
  const total = clients.length;
  const visible = useMemo(() => clients.slice(0, PREVIEW_LIMIT), [clients]);

  const send = useMutation({
    mutationFn: () => marketingApi.winbackSend({ days, message: message.trim() }),
    onSuccess: (res) => {
      const result = res.data;
      setSendResult(result);
      if (result.sent > 0) {
        haptic('success');
        Alert.alert(
          'Готово',
          `Отправлено: ${result.sent}` + (result.failed > 0 ? `, не доставлено: ${result.failed}` : ''),
        );
      } else if (result.total > 0) {
        // Segment was non-empty but nothing went out → provider not wired.
        haptic('warning');
      } else {
        haptic('tap');
      }
      queryClient.invalidateQueries({ queryKey: ['marketing-dashboard'] });
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось отправить рассылку. Попробуйте ещё раз.');
    },
  });

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['winback', days] });
    setRefreshing(false);
  };

  const canSend = total > 0 && message.trim().length > 0 && !send.isPending;

  const confirmSend = () => {
    if (!canSend) return;
    haptic('tap');
    Alert.alert(
      'Отправить рассылку?',
      `Сообщение получат ${total} ${clientsWord(total)}, которые не приезжали более ${days} ${daysWord(days)}.`,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Отправить',
          style: 'default',
          onPress: () => {
            setSendResult(null);
            send.mutate();
          },
        },
      ],
    );
  };

  // ── Access guard ────────────────────────────────────────────────────
  if (!canUse) {
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Возвращение клиентов" onBack={() => navigation.goBack()} />
        <View style={styles.emptyCard}>
          <View style={[styles.emptyIcon, { backgroundColor: palette.bg.muted }]}>
            <Ionicons name="lock-closed-outline" size={28} color={palette.text.tertiary} />
          </View>
          <Text style={[styles.emptyTitle, { color: palette.text.primary }]}>Раздел недоступен</Text>
          <Text style={[styles.emptyHint, { color: palette.text.tertiary }]}>
            Возвращение клиентов доступно директору и владельцу автосервиса.
          </Text>
        </View>
      </View>
    );
  }

  const loading = previewQuery.isLoading && clients.length === 0;
  const providerHint = !!sendResult && sendResult.sent === 0 && sendResult.total > 0;

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Возвращение клиентов" onBack={() => navigation.goBack()} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + spacing[4] }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.accent.primary} />
        }
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {/* Intro */}
        <AnimatedCard
          index={0}
          style={[
            styles.introCard,
            { backgroundColor: palette.accent.primarySoft, borderColor: palette.accent.primary },
          ]}
        >
          <View style={[styles.introIcon, { backgroundColor: palette.accent.primary }]}>
            <Ionicons name="repeat-outline" size={18} color={colors.white} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.introTitle, { color: palette.text.primary }]}>
              Верните клиентов, которые давно не приезжали
            </Text>
            <Text style={[styles.introSub, { color: palette.text.secondary }]}>
              Выберите срок отсутствия, посмотрите сегмент и отправьте одно сообщение всем сразу.
            </Text>
          </View>
        </AnimatedCard>

        {/* Period presets */}
        <AnimatedCard
          index={1}
          style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
        >
          <Text style={[styles.sectionTitle, { color: palette.text.primary }]}>Не приезжали более</Text>
          <View style={styles.presetRow}>
            {DAY_PRESETS.map((d) => {
              const active = days === d;
              return (
                <TouchableOpacity
                  key={d}
                  style={[
                    styles.presetChip,
                    {
                      backgroundColor: active ? palette.accent.primary : palette.bg.muted,
                      borderColor: active ? palette.accent.primary : palette.border.subtle,
                    },
                  ]}
                  onPress={() => {
                    haptic('select');
                    setSendResult(null);
                    setDays(d);
                  }}
                >
                  <Text
                    style={{
                      fontSize: fontSize.base,
                      fontWeight: fontWeight.bold,
                      color: active ? colors.white : palette.text.primary,
                    }}
                  >
                    {d}
                  </Text>
                  <Text style={{ fontSize: 11, color: active ? colors.white : palette.text.tertiary }}>
                    {daysWord(d)}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </AnimatedCard>

        {/* Summary count */}
        <AnimatedCard
          index={2}
          style={[styles.summaryCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
        >
          <View style={[styles.summaryIcon, { backgroundColor: palette.bg.muted }]}>
            <Ionicons name="people-outline" size={20} color={palette.accent.primary} />
          </View>
          {loading ? (
            <View style={{ flex: 1 }}>
              <ActivityIndicator color={palette.accent.primary} style={{ alignSelf: 'flex-start' }} />
            </View>
          ) : (
            <View style={{ flex: 1 }}>
              <Text style={[styles.summaryValue, { color: palette.text.primary }]}>
                {total} {clientsWord(total)}
              </Text>
              <Text style={[styles.summarySub, { color: palette.text.tertiary }]}>
                {total === 0
                  ? `Нет клиентов, отсутствовавших более ${days} ${daysWord(days)}`
                  : `Не приезжали более ${days} ${daysWord(days)}`}
              </Text>
            </View>
          )}
        </AnimatedCard>

        {/* Preview list */}
        {!loading && total > 0 && (
          <AnimatedCard
            index={3}
            style={[
              styles.card,
              { backgroundColor: palette.bg.card, borderColor: palette.border.subtle, paddingVertical: spacing[2] },
            ]}
          >
            {visible.map((c, idx) => (
              <WinbackRow key={c.clientId} client={c} showBorder={idx > 0} palette={palette} />
            ))}
            {total > PREVIEW_LIMIT ? (
              <Text style={[styles.moreNote, { color: palette.text.tertiary }]}>
                и ещё {total - PREVIEW_LIMIT} {clientsWord(total - PREVIEW_LIMIT)} в сегменте
              </Text>
            ) : null}
          </AnimatedCard>
        )}

        {/* Compose */}
        <AnimatedCard
          index={4}
          style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
        >
          <View style={styles.sectionHeaderRow}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
              <Ionicons name="document-text-outline" size={16} color={palette.text.secondary} />
              <Text style={[styles.sectionTitle, { color: palette.text.primary, marginBottom: 0 }]}>Сообщение</Text>
            </View>
          </View>
          <TextInput
            value={message}
            onChangeText={(t) => {
              setMessage(t);
              if (sendResult) setSendResult(null);
            }}
            style={[
              styles.textArea,
              { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
            ]}
            multiline
            numberOfLines={5}
            placeholder="Текст сообщения для всех клиентов сегмента"
            placeholderTextColor={palette.text.tertiary}
          />
          <Text style={[styles.charHint, { color: palette.text.tertiary }]}>
            Одно и то же сообщение получат все выбранные клиенты.
          </Text>
        </AnimatedCard>

        {/* Send */}
        <TouchableOpacity
          style={[styles.sendBtn, { backgroundColor: palette.accent.primary }, !canSend && { opacity: 0.5 }]}
          disabled={!canSend}
          onPress={confirmSend}
          activeOpacity={0.85}
        >
          {send.isPending ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <>
              <Ionicons name="paper-plane" size={18} color={colors.white} />
              <Text style={styles.sendBtnText}>
                {total > 0 ? `Отправить ${total} ${clientsDative(total)}` : 'Нет клиентов для рассылки'}
              </Text>
            </>
          )}
        </TouchableOpacity>

        {/* Result */}
        {sendResult ? (
          providerHint ? (
            <View
              style={[
                styles.hintCard,
                palette.mode === 'dark'
                  ? { backgroundColor: softTint(colors.amber[600], 'dark'), borderColor: palette.border.subtle }
                  : { backgroundColor: colors.amber[50], borderColor: colors.amber[200] },
              ]}
            >
              <Ionicons
                name="information-circle-outline"
                size={18}
                color={palette.mode === 'dark' ? colors.amber[200] : colors.amber[700]}
              />
              <View style={{ flex: 1 }}>
                <Text
                  style={[styles.hintTitle, { color: palette.mode === 'dark' ? colors.amber[200] : colors.amber[800] }]}
                >
                  Сообщения не отправлены
                </Text>
                <Text
                  style={[styles.hintText, { color: palette.mode === 'dark' ? colors.amber[200] : colors.amber[800] }]}
                >
                  Подключите провайдера рассылок в разделе «Интеграции», чтобы отправлять сообщения клиентам.
                </Text>
              </View>
            </View>
          ) : (
            <View style={[styles.resultCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
              <Ionicons
                name={sendResult.failed === 0 ? 'checkmark-circle' : 'alert-circle'}
                size={18}
                color={sendResult.failed === 0 ? colors.green[600] : colors.orange[600]}
              />
              <Text style={[styles.resultText, { color: palette.text.secondary }]}>
                Отправлено: {sendResult.sent}
                {sendResult.failed > 0 ? `, не доставлено: ${sendResult.failed}` : ''}
              </Text>
            </View>
          )
        ) : null}
      </ScrollView>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing[4], gap: spacing[4] },

  // Intro banner
  introCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    padding: spacing[3.5],
  },
  introIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  introTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, letterSpacing: -0.3 },
  introSub: { fontSize: fontSize.xs, marginTop: 2, lineHeight: 18 },

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

  // Period presets
  presetRow: { flexDirection: 'row', gap: spacing[2] },
  presetChip: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
  },

  // Summary
  summaryCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    padding: spacing[4],
  },
  summaryIcon: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryValue: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, letterSpacing: -0.4 },
  summarySub: { fontSize: fontSize.xs, marginTop: 2 },

  // Preview rows
  clientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[2.5],
  },
  clientRowBorder: { borderTopWidth: StyleSheet.hairlineWidth },
  clientAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clientName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  clientPhone: { fontSize: fontSize.xs, marginTop: 1 },
  agoPill: {
    paddingHorizontal: spacing[2.5],
    paddingVertical: 4,
    borderRadius: borderRadius.full,
  },
  agoPillText: { fontSize: 11, fontWeight: fontWeight.semibold },
  clientChecks: { fontSize: 10, marginTop: 3 },
  moreNote: { fontSize: fontSize.xs, textAlign: 'center', paddingVertical: spacing[3] },

  // Compose
  textArea: {
    borderWidth: 1,
    borderRadius: borderRadius.xl,
    padding: spacing[3],
    fontSize: fontSize.sm,
    textAlignVertical: 'top',
    minHeight: 120,
  },
  charHint: { fontSize: 11, marginTop: spacing[2] },

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

  // Result + provider hint
  resultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    padding: spacing[3.5],
  },
  resultText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, flex: 1 },
  hintCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2.5],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    padding: spacing[3.5],
  },
  hintTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  hintText: { fontSize: fontSize.xs, marginTop: 2, lineHeight: 18 },

  // Empty / access
  emptyCard: { alignItems: 'center', paddingVertical: spacing[12], paddingHorizontal: spacing[6], gap: spacing[3] },
  emptyIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  emptyHint: { fontSize: fontSize.sm, textAlign: 'center', maxWidth: 280, lineHeight: 20 },
});
