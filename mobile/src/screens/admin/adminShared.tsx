/**
 * adminShared — formatting + status helpers + small UI primitives shared by
 * the superadmin platform-operator screens (Overview / Tenants / Plans /
 * Broadcast / More). Keeps the screens on ONE visual language and avoids the
 * copy-paste drift the old AdminScreen monolith suffered from.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from '../../platform/Typography';
import { colors, spacing, borderRadius, getBadgeColors, softTint } from '../../theme';
import type { SemanticPalette } from '../../theme/palette';
import type { Tenant, SubscriptionStatus, SubscriptionPeriodKind, FeatureGroup } from '../../../../shared/types';

/**
 * Human labels for the feature-catalog groups (core / section / integration).
 * Shared by the plan editor's grouped toggle list so the section headings read
 * consistently in Russian.
 */
export const FEATURE_GROUP_LABELS: Record<FeatureGroup, string> = {
  core: 'Основные',
  section: 'Разделы',
  integration: 'Интеграции',
};

/** Stable display order for the feature groups. */
export const FEATURE_GROUP_ORDER: FeatureGroup[] = ['core', 'section', 'integration'];

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

/** Compact «12 июл.» — day + short month, no year. Used inside tight chips. */
export function formatDayMonth(d?: string | null): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

/** 'YYYY-MM' → короткий русский месяц «июл.» для оси мини-графика. */
export function formatMonthShort(ym: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return ym;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, 1);
  if (Number.isNaN(date.getTime())) return ym;
  return date.toLocaleDateString('ru-RU', { month: 'short' });
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

/**
 * Resolve a tenant's subscription status into a coloured chip descriptor.
 *
 * `mode` is threaded in from the caller's `palette.mode` (this is a pure
 * helper, not a component, so it can't call a hook). LIGHT branches are the
 * untouched legacy pale-[50]/[100] objects — byte-identical. DARK branches
 * swap the washed pastel for a translucent accent glow (`getBadgeColors('dark')`
 * for red/gray/green whose light objects already match the badge map; amber has
 * no badge entry so it's built by hand) carrying a light [300] text.
 */
export function tenantStatus(tenant: Tenant, mode: 'light' | 'dark' = 'light'): StatusInfo {
  const dark = mode === 'dark';
  const badgesDark = getBadgeColors('dark');
  if (!tenant.isActive)
    return dark
      ? { bg: badgesDark.red.bg, text: badgesDark.red.text, label: 'Отключён' }
      : { bg: colors.red[50], text: colors.red[700], label: 'Отключён' };
  if (!tenant.subscriptionEnd)
    return dark
      ? { bg: badgesDark.gray.bg, text: badgesDark.gray.text, label: 'Без подписки' }
      : { bg: colors.gray[100], text: colors.gray[600], label: 'Без подписки' };
  if (isExpired(tenant.subscriptionEnd))
    return dark
      ? { bg: badgesDark.red.bg, text: badgesDark.red.text, label: 'Истёк' }
      : { bg: colors.red[50], text: colors.red[700], label: 'Истёк' };
  const left = daysLeft(tenant.subscriptionEnd);
  if (left !== null && left <= 7)
    return dark
      ? { bg: softTint(colors.amber[600], 'dark'), text: '#fcd34d', label: `${left} дн.` }
      : { bg: colors.amber[50], text: colors.amber[700], label: `${left} дн.` };
  return dark
    ? { bg: badgesDark.green.bg, text: badgesDark.green.text, label: 'Активен' }
    : { bg: colors.green[50], text: colors.green[700], label: 'Активен' };
}

/**
 * Authoritative subscription-status chip descriptor (102). Unlike
 * {@link tenantStatus} (which derives a label from isActive + subscriptionEnd),
 * this maps the SERVER-resolved `SubscriptionStatus` straight to a chip so the
 * tenant cabinet shows exactly what the gate enforces:
 *   active → green «Активна», expired → red «Истекла», suspended → amber
 *   «Приостановлена». Light branches use the established pale objects; dark
 *   swaps for translucent accent glows (mirrors tenantStatus).
 */
export function subscriptionStatusInfo(status: SubscriptionStatus, mode: 'light' | 'dark' = 'light'): StatusInfo {
  const dark = mode === 'dark';
  const badgesDark = getBadgeColors('dark');
  if (status === 'suspended')
    return dark
      ? { bg: softTint(colors.amber[600], 'dark'), text: '#fcd34d', label: 'Приостановлена' }
      : { bg: colors.amber[50], text: colors.amber[700], label: 'Приостановлена' };
  if (status === 'expired')
    return dark
      ? { bg: badgesDark.red.bg, text: badgesDark.red.text, label: 'Истекла' }
      : { bg: colors.red[50], text: colors.red[700], label: 'Истекла' };
  return dark
    ? { bg: badgesDark.green.bg, text: badgesDark.green.text, label: 'Активна' }
    : { bg: colors.green[50], text: colors.green[700], label: 'Активна' };
}

/**
 * 122 — chip describing the CURRENT subscription period's KIND with its end
 * date baked in: «Оплачено до 12 июл.» (paid → green, это выручка) /
 * «Бесплатно до 12 июл.» (free → blue, НИКОГДА не выручка).
 *
 * Returns `null` when the kind is unknown (no ledger row anchoring the current
 * `subscription_end` — e.g. the date was set directly via PATCH/legacy) so the
 * caller simply omits the chip. Light branches use the pale tailwind objects;
 * dark swaps for the translucent badge fills (mirrors {@link tenantStatus}).
 */
export function periodKindChip(
  kind: SubscriptionPeriodKind | null | undefined,
  subscriptionEnd: string | null | undefined,
  mode: 'light' | 'dark' = 'light',
): StatusInfo | null {
  if (kind !== 'paid' && kind !== 'free') return null;
  const dark = mode === 'dark';
  const badges = getBadgeColors('dark');
  const until = formatDayMonth(subscriptionEnd);
  if (kind === 'paid')
    return dark
      ? { bg: badges.green.bg, text: badges.green.text, label: `Оплачено до ${until}` }
      : { bg: colors.green[50], text: colors.green[700], label: `Оплачено до ${until}` };
  return dark
    ? { bg: badges.blue.bg, text: badges.blue.text, label: `Бесплатно до ${until}` }
    : { bg: colors.blue[50], text: colors.blue[700], label: `Бесплатно до ${until}` };
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
export function InitialAvatar({
  name,
  palette,
  size = 40,
}: {
  name?: string;
  palette: SemanticPalette;
  size?: number;
}) {
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
