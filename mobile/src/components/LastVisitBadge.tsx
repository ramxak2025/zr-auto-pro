import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { checksApi } from '../api/services';
import { colors, fontSize, fontWeight, spacing } from '../theme';

/**
 * Badge that surfaces the most recent visit for a client/car combo. Mounted
 * inside the cash screen under the selected-client card so the master
 * immediately sees when this customer was here last and on which car.
 */
interface LastVisitBadgeProps {
  clientId?: string;
  carId?: string;
}

function formatRu(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `${date} в ${time}`;
}

function formatMoney(value: number): string {
  return value.toLocaleString('ru-RU') + ' ₽';
}

export default function LastVisitBadge({ clientId, carId }: LastVisitBadgeProps) {
  const enabled = !!clientId || !!carId;
  const { data, isLoading } = useQuery({
    queryKey: ['last-visit', { clientId, carId }],
    queryFn: async () => {
      const res = await checksApi.getLastVisit({ clientId, carId });
      return res.data;
    },
    enabled,
    staleTime: 60_000,
  });

  if (!enabled) return null;

  if (isLoading) {
    return (
      <View style={styles.row}>
        <ActivityIndicator size="small" color={colors.gray[400]} />
        <Text style={styles.muted}>Ищем последний визит…</Text>
      </View>
    );
  }

  if (!data) {
    return (
      <View style={styles.row}>
        <Ionicons name="time-outline" size={14} color={colors.gray[500]} />
        <Text style={styles.muted}>Это первый визит клиента</Text>
      </View>
    );
  }

  return (
    <View style={styles.box}>
      <View style={styles.headerRow}>
        <Ionicons name="time-outline" size={14} color={colors.gray[600]} />
        <Text style={styles.headerLabel}>Последний визит</Text>
      </View>
      <Text style={styles.body}>
        {formatRu(data.date)}
        {data.masterName ? `  ·  мастер ${data.masterName}` : ''}
      </Text>
      <Text style={styles.bodyBold}>
        {formatMoney(data.totalRevenue)}
        {data.carPlate ? `  ·  ${data.carPlate}` : ''}
        {data.carMakeModel ? ` (${data.carMakeModel})` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5] || 6,
    paddingHorizontal: spacing[3],
    paddingTop: spacing[2],
  },
  box: {
    paddingHorizontal: spacing[3],
    paddingTop: spacing[3],
    marginTop: spacing[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.gray[200],
    gap: 2,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.gray[700],
  },
  body: {
    fontSize: fontSize.xs,
    color: colors.gray[600],
  },
  bodyBold: {
    fontSize: fontSize.xs,
    color: colors.gray[900],
    fontWeight: fontWeight.semibold,
  },
  muted: {
    fontSize: fontSize.xs,
    color: colors.gray[500],
  },
});
