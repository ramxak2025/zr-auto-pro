import React, { useEffect, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../platform/Typography';
import { useColors } from '../../contexts/ThemeContext';
import { pointKindLabel, usePointAccess } from '../../hooks/usePoints';
import type { FreshnessQueryLike } from '../../components/FreshnessBadge';

function freshnessLabel(age: number) {
  if (age < 5_000) return 'Обновлено только что';
  if (age < 60_000) return `Обновлено ${Math.round(age / 1_000)} сек назад`;
  if (age < 3_600_000) return `Обновлено ${Math.round(age / 60_000)} мин назад`;
  if (age < 86_400_000) return `Обновлено ${Math.round(age / 3_600_000)} ч назад`;
  return age < 172_800_000 ? 'Обновлено вчера' : 'Обновлено давно';
}

/** The current service remains a read-only session label, never a branch switcher. */
export default function JournalContext({ query }: { query: FreshnessQueryLike }) {
  const p = useColors();
  const { currentPoint, multiPoint } = usePointAccess();
  const { fontScale } = useWindowDimensions();
  const [, tick] = useState(0);
  const refreshing = query.isFetching && !query.isLoading;
  useEffect(() => {
    if (refreshing || !query.dataUpdatedAt) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const age = Date.now() - query.dataUpdatedAt;
      timer = setTimeout(
        () => {
          tick((value) => value + 1);
          schedule();
        },
        age < 60_000 ? 5_000 : age < 3_600_000 ? 30_000 : 300_000,
      );
    };
    schedule();
    return () => clearTimeout(timer);
  }, [query.dataUpdatedAt, refreshing]);
  const status = refreshing
    ? 'Обновляется…'
    : query.dataUpdatedAt
      ? freshnessLabel(Date.now() - query.dataUpdatedAt)
      : '';
  const branch = multiPoint && currentPoint;
  return (
    <View style={[s.row, fontScale > 1.3 && s.stack]}>
      {branch && (
        <View
          style={s.branch}
          accessibilityLabel={`Автосервис: ${branch.name}, ${pointKindLabel(branch).toLowerCase()}`}
          accessibilityRole="text"
        >
          <Ionicons name={branch.isMain ? 'home-outline' : 'business-outline'} size={14} color={p.text.secondary} />
          <Text
            variant="footnote"
            color={p.text.secondary}
            numberOfLines={fontScale > 1.3 ? undefined : 1}
            style={s.branchText}
          >
            {branch.name}
          </Text>
        </View>
      )}
      {!!status && (
        <View style={[s.status, fontScale > 1.3 && s.stackedStatus]}>
          {branch && fontScale <= 1.3 && <View style={[s.dot, { backgroundColor: p.border.strong }]} />}
          <Text variant="footnote" color={p.text.secondary} style={s.statusText}>
            {status}
          </Text>
        </View>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  row: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  stack: { flexDirection: 'column', alignItems: 'stretch', gap: 4, width: '100%' },
  branch: { flexShrink: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 5 },
  branchText: { flexShrink: 1 },
  status: { flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  stackedStatus: { width: '100%', minWidth: 0, alignSelf: 'stretch' },
  statusText: { flexShrink: 1, minWidth: 0 },
  dot: { width: 3, height: 3, borderRadius: 2 },
});
