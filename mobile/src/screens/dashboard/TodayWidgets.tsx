import type { TabParamList } from '../../navigation/AppNavigator';
import { openAttention } from './attentionNavigation';
import React, { useCallback, useEffect, useState } from 'react';
import { AppState, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect, useNavigation, type NavigationProp } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { dashboardApi, salaryApi } from '../../api/services';
import { useAuth } from '../../contexts/AuthContext';
import { useColors } from '../../contexts/ThemeContext';
import { useTenantTimezone } from '../../contexts/TenantTimezoneContext';
import { formatDayKey } from '../../../../shared/utils/formatters';
import { ATTENTION_LABELS, EARNINGS_EXPLANATION, earningsMoney } from '../../../../shared/utils/dashboardAttention';
import type { AttentionBucketId } from '../../../../shared/types';
import EmployeeAvatar from '../../components/EmployeeAvatar';
import { Skeleton } from '../../components/Skeleton';

function useTodayScope() {
  const { user } = useAuth();
  const timezone = useTenantTimezone();
  const [day, setDay] = useState(() => formatDayKey(new Date(), timezone));
  useEffect(() => {
    const update = () => setDay(formatDayKey(new Date(), timezone));
    update();
    const timer = setInterval(update, 60_000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') update();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [timezone]);
  return [user?.id, user?.currentPointId ?? null, timezone, day, JSON.stringify(user?.permissions)] as const;
}
function useRefresh(refetch: () => unknown, enabled = true) {
  useFocusEffect(
    useCallback(() => {
      if (enabled) void refetch();
    }, [enabled, refetch]),
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (enabled && state === 'active') void refetch();
    });
    return () => sub.remove();
  }, [enabled, refetch]);
}
function Retry({ text, retry, busy }: { text: string; retry: () => unknown; busy: boolean }) {
  const p = useColors();
  return (
    <View style={styles.error} accessibilityRole="alert">
      <Text style={{ color: p.text.secondary, flex: 1 }}>{text}</Text>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`${text}. Повторить`}
        disabled={busy}
        onPress={() => retry()}
        style={styles.retry}
      >
        <Text style={{ color: p.text.primary }}>Повторить</Text>
      </TouchableOpacity>
    </View>
  );
}
function Widget({ title, date, children }: { title: string; date?: string; children: React.ReactNode }) {
  const p = useColors();
  return (
    <View style={[styles.card, { backgroundColor: p.bg.card, borderColor: p.border.subtle }]}>
      <Text accessibilityRole="header" style={[styles.title, { color: p.text.primary }]}>
        {title}
      </Text>
      <Text style={[styles.subtitle, { color: p.text.secondary }]}>
        {date ? `${date} · текущий филиал` : 'Текущий филиал'}
      </Text>
      {children}
    </View>
  );
}
export function AttentionCard() {
  const { user, hasPermission } = useAuth();
  const scope = useTodayScope();
  const p = useColors();
  const navigation = useNavigation<NavigationProp<TabParamList>>();
  const query = useQuery({
    queryKey: ['dashboard-attention', ...scope],
    queryFn: async () => (await dashboardApi.attention()).data,
    staleTime: 30_000,
    refetchOnMount: 'always',
    placeholderData: undefined,
  });
  useRefresh(query.refetch);
  const open = (id: AttentionBucketId) =>
    openAttention(navigation, id, hasPermission('checks_view_all') ? undefined : user?.id);
  if (!query.isLoading && !query.isError && !query.data?.buckets.length) return null;
  return (
    <Widget title="Требует внимания" date={query.data?.date}>
      {query.isLoading ? (
        <Skeleton height={160} radius={8} />
      ) : query.isError ? (
        <Retry text="Задачи не обновились" retry={query.refetch} busy={query.isFetching} />
      ) : null}
      {query.data?.buckets.map((b) =>
        b.error ? (
          <Retry
            key={b.id}
            text={`${ATTENTION_LABELS[b.id]}: не загрузилось`}
            retry={query.refetch}
            busy={query.isFetching}
          />
        ) : (
          <TouchableOpacity
            key={b.id}
            accessibilityRole="button"
            accessibilityLabel={`${ATTENTION_LABELS[b.id]}: ${b.count}`}
            onPress={() => open(b.id)}
            style={[styles.row, { borderBottomColor: p.border.subtle }]}
          >
            <Text style={[styles.name, { color: b.count ? p.text.primary : p.text.secondary }]}>
              {ATTENTION_LABELS[b.id]}
            </Text>
            <Text style={[styles.money, { color: p.text.primary }]}>{b.count}</Text>
            <Ionicons name="chevron-forward" size={16} color={p.text.tertiary} />
          </TouchableOpacity>
        ),
      )}
      {query.data?.buckets.every((b) => b.count === 0 && !b.error) && (
        <Text style={[styles.note, { color: p.text.secondary }]}>Всё под контролем</Text>
      )}
    </Widget>
  );
}
export function TodayEarningsCard() {
  const { hasPermission } = useAuth();
  const allowed = hasPermission('salary_view_all');
  const scope = useTodayScope();
  const p = useColors();
  const [expanded, setExpanded] = useState(false);
  const query = useQuery({
    queryKey: ['salary-today-earnings', ...scope],
    queryFn: async () => (await salaryApi.getTodayEarnings()).data,
    enabled: allowed,
    staleTime: 30_000,
    refetchOnMount: 'always',
    placeholderData: undefined,
  });
  useRefresh(query.refetch, allowed);
  if (!allowed) return null;
  return (
    <Widget title="Заработок сегодня" date={query.data?.date}>
      {query.isLoading ? (
        <Skeleton height={160} radius={8} />
      ) : query.isError ? (
        <Retry text="Заработок не обновился" retry={query.refetch} busy={query.isFetching} />
      ) : null}
      {(expanded ? query.data?.employees : query.data?.employees.slice(0, 5))?.map((e) => (
        <View key={e.id} style={[styles.row, { borderBottomColor: p.border.subtle }]}>
          <EmployeeAvatar
            avatar={e.avatar}
            userId={e.id}
            style={[styles.avatar, { backgroundColor: p.bg.muted }]}
            imageStyle={styles.avatar}
          >
            <Text style={{ color: p.text.secondary }}>{e.name.trim().slice(0, 1)}</Text>
          </EmployeeAvatar>
          <Text style={[styles.name, { color: p.text.primary }]}>{e.name}</Text>
          <Text style={[styles.money, { color: p.text.primary }]}>{earningsMoney(e.earnedAmount)}</Text>
        </View>
      ))}
      {query.data && !query.data.employees.length && (
        <Text style={[styles.note, { color: p.text.secondary }]}>В этом филиале пока нет сотрудников</Text>
      )}
      {(query.data?.employees.length ?? 0) > 5 && (
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          onPress={() => setExpanded(!expanded)}
          style={styles.retry}
        >
          <Text style={{ color: p.text.primary }}>
            {expanded ? 'Свернуть' : `Показать всех (${query.data?.employees.length})`}
          </Text>
        </TouchableOpacity>
      )}
      {query.data && (
        <View style={styles.total}>
          <Text style={[styles.name, { color: p.text.primary }]}>Всего</Text>
          <Text style={[styles.money, { color: p.text.primary }]}>{earningsMoney(query.data.total)}</Text>
        </View>
      )}
      <Text style={[styles.note, { color: p.text.secondary }]}>{EARNINGS_EXPLANATION}</Text>
    </Widget>
  );
}
const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 16 },
  title: { fontSize: 17, fontWeight: '600' },
  subtitle: { fontSize: 12, marginTop: 4, marginBottom: 12 },
  row: {
    minHeight: 52,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  name: { flex: 1, minWidth: 0, flexShrink: 1, fontSize: 14, lineHeight: 20 },
  money: { flexShrink: 0, textAlign: 'right', fontSize: 14, fontWeight: '600', fontVariant: ['tabular-nums'] },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  note: { fontSize: 12, lineHeight: 18, marginTop: 12 },
  total: { flexDirection: 'row', gap: 10, paddingTop: 14 },
  error: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  retry: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
});
