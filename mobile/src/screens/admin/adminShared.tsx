/**
 * adminShared — formatting + status helpers + small UI primitives shared by
 * the superadmin platform-operator screens (Overview / Tenants / Plans /
 * Broadcast / More). Keeps the screens on ONE visual language and avoids the
 * copy-paste drift the old AdminScreen monolith suffered from.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../platform/Typography';
import { colors, spacing, borderRadius } from '../../theme';
import type { SemanticPalette } from '../../theme/palette';
import type { Tenant } from '../../../../shared/types';

export function formatMoney(value: number): string {
  const rounded = Math.round(value || 0);
  return rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽';
}

export function formatDate(d?: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatFullDate(d?: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function formatDateTime(d?: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function isExpired(dateStr?: string | null): boolean {
  if (!dateStr) return true;
  return new Date(dateStr) < new Date();
}

/** Whole days until subscriptionEnd (can be negative when already lapsed). */
export function daysLeft(dateStr?: string | null): number | null {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

export interface StatusInfo {
  bg: string;
  text: string;
  label: string;
}

/** Resolve a tenant's subscription status into a coloured chip descriptor. */
export function tenantStatus(tenant: Tenant): StatusInfo {
  if (!tenant.isActive) return { bg: colors.red[50], text: colors.red[700], label: 'Отключён' };
  if (!tenant.subscriptionEnd) return { bg: colors.gray[100], text: colors.gray[600], label: 'Без подписки' };
  if (isExpired(tenant.subscriptionEnd)) return { bg: colors.red[50], text: colors.red[700], label: 'Истёк' };
  const left = daysLeft(tenant.subscriptionEnd);
  if (left !== null && left <= 7) return { bg: colors.amber[50], text: colors.amber[700], label: `${left} дн.` };
  return { bg: colors.green[50], text: colors.green[700], label: 'Активен' };
}

/** Coloured status chip. */
export function StatusChip({ status }: { status: StatusInfo }) {
  return (
    <View style={[chipStyles.chip, { backgroundColor: status.bg }]}>
      <Text style={[chipStyles.chipText, { color: status.text }]}>{status.label}</Text>
    </View>
  );
}

/** Round avatar with the entity's first letter. */
export function InitialAvatar({ name, palette, size = 40 }: { name?: string; palette: SemanticPalette; size?: number }) {
  return (
    <View
      style={[
        chipStyles.avatar,
        { width: size, height: size, borderRadius: size / 4, backgroundColor: palette.accent.primarySoft },
      ]}
    >
      <Text style={[chipStyles.avatarText, { color: palette.accent.primaryText, fontSize: size * 0.4 }]}>
        {name?.charAt(0)?.toUpperCase() || 'T'}
      </Text>
    </View>
  );
}

const chipStyles = StyleSheet.create({
  chip: {
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  chipText: {
    fontSize: 10,
    fontWeight: '700',
  },
  avatar: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontWeight: '700',
  },
});
