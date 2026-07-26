/**
 * MessagesJournalScreen — «Журнал отправок».
 *
 * Раздел доверия: sent_messages (мигр. 124) писался при КАЖДОЙ отправке
 * клиенту, но никогда не читался — железные анти-спам-гарантии существовали,
 * но были невидимы. Этот экран отвечает на два страха владельца:
 *   «пойдут ещё какие-то смс клиентам?» → вот лента КАЖДОГО сообщения:
 *     что, кому, когда, каким каналом, дошло или нет;
 *   «клиенту придёт 10 смс?» → лимиты гейта видны прямо здесь (потолок
 *     3/24ч и окно дубля приходят в meta с сервера, не хардкодом).
 *
 * Лента — keyset-курсор (как журнал чеков): useInfiniteQuery, первая страница
 * без cursor, дальше nextCursor. Текста сообщения в журнале НЕТ (сервер
 * хранит только content_hash) — строка показывает тип/канал/кому/когда/статус.
 * Записи канала telegram помечены «в чат владельца» — бот пишет владельцу,
 * не клиенту.
 */
import React, { useMemo, useState } from 'react';
import {
  View,
  FlatList,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { useColors } from '../contexts/ThemeContext';
import { marketingApi } from '../api/services';
import { colors, fontSize, fontWeight, borderRadius, spacing, softTint } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import IosScreenHeader from '../components/IosScreenHeader';
import { Text } from '../platform/Typography';
import { haptic } from '../platform/haptics';
import type { SentMessage, SentMessagesResponse, SentMessageType } from '../../../shared/types';

// ─── Метаданные типов сообщений (продуктовые русские имена) ───────────
const TYPE_META: Record<SentMessageType, { label: string; icon: keyof typeof Ionicons.glyphMap; tint: string }> = {
  review: { label: 'Запрос отзыва', icon: 'star-outline', tint: colors.amber[600] },
  car_ready: { label: 'Машина готова', icon: 'car-sport-outline', tint: colors.blue[600] },
  reminder: { label: 'Напоминание', icon: 'notifications-outline', tint: colors.violet[600] },
  winback: { label: 'Возврат клиентов', icon: 'repeat-outline', tint: colors.teal[600] },
  booking: { label: 'Запись', icon: 'calendar-outline', tint: colors.indigo[600] },
  manual: { label: 'Сообщение', icon: 'chatbox-outline', tint: colors.slate[600] },
  broadcast: { label: 'Рассылка', icon: 'paper-plane-outline', tint: colors.emerald[700] },
};

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  smsru: 'SMS.RU',
  moizvonki: 'Мои Звонки',
  sms: 'SMS',
  email: 'Email',
};

// Фильтр-чипы по типу. null = все.
const FILTERS: { key: SentMessageType | null; label: string }[] = [
  { key: null, label: 'Все' },
  { key: 'review', label: 'Отзывы' },
  { key: 'car_ready', label: 'Машина готова' },
  { key: 'broadcast', label: 'Рассылки' },
  { key: 'reminder', label: 'Напоминания' },
  { key: 'winback', label: 'Возврат' },
  { key: 'booking', label: 'Записи' },
];

/** Нормализованный 10-значный ключ → человеческий вид «+7 988 444-44-85». */
function formatPhone(phone: string): string {
  const d = String(phone ?? '').replace(/\D/g, '');
  if (d.length !== 10) return phone || '—';
  return `+7 ${d.slice(0, 3)} ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8)}`;
}

function formatWhen(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  const now = new Date();
  const time = dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(dt, now)) return `Сегодня, ${time}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(dt, yesterday)) return `Вчера, ${time}`;
  const date = dt.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    year: dt.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
  return `${date}, ${time}`;
}

// ─── Строка журнала ───────────────────────────────────────────────────
function JournalRow({ item }: { item: SentMessage }) {
  const palette = useColors();
  const meta = TYPE_META[item.messageType] ?? TYPE_META.manual;
  const failed = item.status === 'failed';
  const channel = item.providerType ? (CHANNEL_LABEL[item.providerType] ?? item.providerType) : null;

  return (
    <View style={[styles.row, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
      <View
        style={[
          styles.rowIcon,
          { backgroundColor: palette.mode === 'dark' ? softTint(meta.tint, 'dark') : `${meta.tint}18` },
        ]}
      >
        <Ionicons name={meta.icon} size={18} color={meta.tint} />
      </View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={styles.rowTop}>
          <Text style={[styles.rowWho, { color: palette.text.primary }]} numberOfLines={1}>
            {item.toOwner ? 'В чат владельца' : item.clientName || formatPhone(item.phone)}
          </Text>
          <Text style={[styles.rowWhen, { color: palette.text.tertiary }]}>{formatWhen(item.sentAt)}</Text>
        </View>

        <View style={styles.rowBottom}>
          <Text style={[styles.rowType, { color: palette.text.secondary }]} numberOfLines={1}>
            {meta.label}
            {channel ? ` · ${channel}` : ''}
          </Text>
          {failed ? (
            <View style={styles.statusWrap}>
              <Ionicons name="close-circle" size={13} color={colors.red[500]} />
              <Text style={[styles.statusText, { color: colors.red[600] }]}>Ошибка</Text>
            </View>
          ) : (
            <View style={styles.statusWrap}>
              <Ionicons name="checkmark-circle" size={13} color={colors.green[600]} />
              <Text style={[styles.statusText, { color: colors.green[700] }]}>Отправлено</Text>
            </View>
          )}
        </View>

        {/* Telegram → это уведомление персоналу, не сообщение клиенту. */}
        {item.toOwner ? (
          <Text style={[styles.rowNote, { color: palette.text.tertiary }]} numberOfLines={1}>
            Telegram-бот пишет владельцу, не клиенту
          </Text>
        ) : null}

        {failed && item.error ? (
          <Text style={[styles.rowNote, { color: colors.red[500] }]} numberOfLines={2}>
            {item.error}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

// ─── Экран ────────────────────────────────────────────────────────────
export default function MessagesJournalScreen() {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const [typeFilter, setTypeFilter] = useState<SentMessageType | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const query = useInfiniteQuery<SentMessagesResponse>({
    queryKey: ['sent-messages', typeFilter],
    queryFn: async ({ pageParam }) =>
      (
        await marketingApi.getSentMessages({
          cursor: (pageParam as string) || undefined,
          limit: 30,
          type: typeFilter ?? undefined,
        })
      ).data,
    initialPageParam: '',
    // Конец ленты определяет сервер: nextCursor === null.
    getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
    staleTime: 15_000,
  });

  const rows = useMemo(() => (query.data?.pages ?? []).flatMap((p) => p?.data ?? []), [query.data]);
  // Лимиты гейта — из meta первой страницы (сервер шлёт их всегда, даже при
  // пустой ленте). Fallback на текущие серверные константы.
  const meta = query.data?.pages?.[0]?.meta;
  const cap = meta?.perClient24hCap ?? 3;

  const onRefresh = async () => {
    setRefreshing(true);
    await query.refetch();
    setRefreshing(false);
  };

  const guaranteeLine = `Не больше ${cap} сообщений клиенту за 24 часа, повторы отсекаются автоматически.`;

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Журнал отправок" onBack={() => navigation.goBack()} />

      {/* Фильтр-чипы по типу */}
      <View style={styles.filterWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
          {FILTERS.map((f) => {
            const active = typeFilter === f.key;
            return (
              <TouchableOpacity
                key={f.key ?? 'all'}
                onPress={() => {
                  haptic('select');
                  setTypeFilter(f.key);
                }}
                style={[
                  styles.filterChip,
                  {
                    backgroundColor: active ? palette.accent.primary : palette.bg.muted,
                    borderColor: active ? palette.accent.primary : palette.border.subtle,
                  },
                ]}
              >
                <Text
                  style={{
                    fontSize: 12,
                    fontWeight: '600',
                    color: active ? colors.white : palette.text.secondary,
                  }}
                >
                  {f.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      <FlatList
        data={rows}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <JournalRow item={item} />}
        contentContainerStyle={[styles.listContent, { paddingBottom: tabBarHeight + spacing[4] }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.accent.primary} />
        }
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetchingNextPage) query.fetchNextPage();
        }}
        ListHeaderComponent={
          rows.length > 0 ? (
            <View
              style={[
                styles.guarantee,
                { backgroundColor: palette.accent.primarySoft, borderColor: palette.accent.primary },
              ]}
            >
              <Ionicons name="shield-checkmark-outline" size={18} color={palette.accent.primary} />
              <Text style={[styles.guaranteeText, { color: palette.text.secondary }]}>{guaranteeLine}</Text>
            </View>
          ) : null
        }
        ListEmptyComponent={
          query.isLoading ? (
            <ActivityIndicator color={palette.accent.primary} style={{ marginTop: spacing[10] }} />
          ) : (
            // Пустое состояние — витрина гарантий, а не «ничего нет».
            <View style={styles.emptyBlock}>
              <View
                style={[
                  styles.emptyIcon,
                  {
                    backgroundColor:
                      palette.mode === 'dark' ? softTint(palette.accent.primary, 'dark') : palette.accent.primarySoft,
                  },
                ]}
              >
                <Ionicons name="shield-checkmark-outline" size={30} color={palette.accent.primary} />
              </View>
              <Text style={[styles.emptyTitle, { color: palette.text.primary }]}>
                {typeFilter ? 'Таких отправок ещё не было' : 'Здесь видно каждое сообщение'}
              </Text>
              <Text style={[styles.emptyHint, { color: palette.text.secondary }]}>
                {typeFilter
                  ? 'Как только сообщение этого типа уйдёт клиенту — оно появится в этой ленте.'
                  : `Каждое сообщение, которое уходит вашим клиентам, попадает в этот журнал: что, кому, когда и каким каналом. ${guaranteeLine}`}
              </Text>
            </View>
          )
        }
        ListFooterComponent={
          query.isFetchingNextPage ? (
            <ActivityIndicator color={palette.accent.primary} style={{ marginVertical: spacing[4] }} />
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },

  filterWrap: { paddingBottom: spacing[2.5] },
  filterRow: { paddingHorizontal: spacing[4], gap: spacing[2] },
  filterChip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },

  listContent: { paddingHorizontal: spacing[4], gap: spacing[2] },

  guarantee: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2.5],
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    padding: spacing[3.5],
    marginBottom: spacing[1],
  },
  guaranteeText: { flex: 1, fontSize: fontSize.xs, lineHeight: 17 },

  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    padding: spacing[3],
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  rowWho: { flex: 1, fontSize: fontSize.sm, fontWeight: fontWeight.semibold, letterSpacing: -0.1 },
  rowWhen: { fontSize: 11, fontVariant: ['tabular-nums'] },
  rowBottom: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginTop: 3 },
  rowType: { flex: 1, fontSize: fontSize.xs },
  statusWrap: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  statusText: { fontSize: 11, fontWeight: '600' },
  rowNote: { fontSize: 11, marginTop: 3, lineHeight: 15 },

  emptyBlock: { alignItems: 'center', paddingVertical: spacing[10], paddingHorizontal: spacing[4], gap: spacing[3] },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, textAlign: 'center' },
  emptyHint: { fontSize: fontSize.sm, lineHeight: 20, textAlign: 'center', maxWidth: 320 },
});
