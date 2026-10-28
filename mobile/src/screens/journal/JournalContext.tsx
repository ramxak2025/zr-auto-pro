import React, { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { Text } from '../../platform/Typography';
import { useColors } from '../../contexts/ThemeContext';
import type { FreshnessQueryLike } from '../../components/FreshnessBadge';

export function journalFreshnessState(queries: FreshnessQueryLike[]) {
  return {
    refreshing: queries.some((query) => query.isFetching && !query.isLoading),
    lastUpdated: queries.reduce(
      (oldest, query) =>
        !query.dataUpdatedAt ? oldest : !oldest ? query.dataUpdatedAt : Math.min(oldest, query.dataUpdatedAt),
      0,
    ),
  };
}

function freshnessLabel(age: number) {
  if (age < 5_000) return 'Обновлено только что';
  if (age < 60_000) return `Обновлено ${Math.round(age / 1_000)} сек назад`;
  if (age < 3_600_000) return `Обновлено ${Math.round(age / 60_000)} мин назад`;
  if (age < 86_400_000) return `Обновлено ${Math.round(age / 3_600_000)} ч назад`;
  return age < 172_800_000 ? 'Обновлено вчера' : 'Обновлено давно';
}

/** Header status only. Branch/session information deliberately does not belong here. */
export default function JournalContext({
  query,
  queries,
}: {
  query?: FreshnessQueryLike;
  queries?: FreshnessQueryLike[];
}) {
  const p = useColors();
  const [, tick] = useState(0);
  const { refreshing, lastUpdated } = journalFreshnessState(queries || (query ? [query] : []));
  useEffect(() => {
    if (refreshing || !lastUpdated) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const age = Date.now() - lastUpdated;
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
  }, [lastUpdated, refreshing]);
  const status = refreshing ? 'Обновляется…' : lastUpdated ? freshnessLabel(Date.now() - lastUpdated) : '';
  return status ? (
    <Text variant="footnote" color={p.text.secondary} style={s.status}>
      {status}
    </Text>
  ) : null;
}
const s = StyleSheet.create({ status: { textAlign: 'right', flexShrink: 1, maxWidth: '100%' } });
