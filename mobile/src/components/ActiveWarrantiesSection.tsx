/**
 * ActiveWarrantiesSection — premium informational block rendered inside
 * the selected-client area of the cash screen. It surfaces what is still
 * under warranty FOR THE WHOLE CLIENT (across every car they own), e.g.:
 *
 *   ┌─────────────────────────────────────────────┐
 *   │ 🛡 На гарантии        2 активные гарантии   │
 *   ├─────────────────────────────────────────────┤
 *   │ 🔧 Диагностика            ┌ ещё 24 дня ┐    │
 *   │ 📦 Редуктор Нордик        └ 3 мес 5 дней ┘   │
 *   └─────────────────────────────────────────────┘
 *
 *   • Shield header + count of active warranties.
 *   • Per-item row: tool/cube icon, item name, remaining-time chip.
 *   • Chip colour reflects urgency by days-left:
 *       ≥ 14 days → green   (healthy)
 *       1-13 days → amber   (ending soon)
 *       ≤ 0 days → red      (defensive — backend filters expired out)
 *
 * Data contract:
 *   `warrantyApi.active({ clientId, carId? })` → `ActiveWarranty[]`
 *     = { kind: 'product'|'service', name, expiresAt, daysLeft }
 *   Returns ALL active (not used, not expired) warranties for the client,
 *   soonest-to-expire first; empty array if none. Scoping by `clientId`
 *   (rather than a single `carId`) is deliberate: the owner's mental model
 *   is "THIS CLIENT has something under warranty", not "this exact car".
 *   Previously the section queried `activeForCar(carId)`, so a warranty on
 *   a different car than the default-selected one never showed.
 *
 *   `daysLeft` is supplied by the backend; we still recompute defensively
 *   from `expiresAt` when it is missing/non-finite so the chip stays
 *   accurate even hours after the fetch.
 *
 * Behaviour:
 *   - Query key `['warranty-active-client', clientId]`, gated by
 *     `enabled: !!clientId`, `staleTime: 60s` — cheap, never blocks the
 *     Касса open.
 *   - On the FIRST load for a freshly-selected client (no cached answer
 *     yet) renders a single, calm «Собираю информацию по клиенту…» row with
 *     a small spinner — so the block reserves itself instead of popping the
 *     badges in late ("через раз"). The global `placeholderData: prev=>prev`
 *     SWR + persistent cache mean a previously-seen client skips the loader
 *     and shows the real badges instantly.
 *   - Renders NOTHING (no empty band) when there is no client, or once the
 *     load resolves to zero active warranties — the form is dense enough
 *     without a placeholder, and the loader never lingers.
 *   - Dark-mode aware via `useColors()`.
 *
 * Why a dedicated component:
 *   The cash screen file is already ~2.9k lines; isolating the query +
 *   urgency styling here keeps it readable and reusable.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, AccessibilityInfo } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { warrantyApi } from '../api/services';
import { useColors } from '../contexts/ThemeContext';
import { fontSize, fontWeight, spacing, borderRadius } from '../theme';
import type { SemanticPalette } from '../theme/palette';
import { formatDaysLeft } from '../utils/warrantyFormat';
import type { ActiveWarranty } from '../../../shared/types';

interface ActiveWarrantiesSectionProps {
  /** Resolved client id — warranties are shown across ALL the client's cars. */
  clientId?: string;
  /** Optional: scope to a single car. Default (undefined) shows the whole client. */
  carId?: string;
}

/** Decline "активная гарантия" by quantity. */
function pluraliseActive(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return `${n} активная гарантия`;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return `${n} активные гарантии`;
  return `${n} активных гарантий`;
}

/**
 * Whole days remaining until `expiresAt` (rounded up so "expires later
 * today" still reads as 1 day, not 0). Past dates → 0.
 */
function daysUntil(expiresAt: string): number {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (!Number.isFinite(ms)) return 0;
  if (ms <= 0) return 0;
  return Math.ceil(ms / 86_400_000);
}

/**
 * Resolve the days-left to show on the chip. Prefers the backend-computed
 * `daysLeft`, falling back to a client-side computation from `expiresAt`
 * when the backend value is missing or not a finite number.
 */
function resolveDaysLeft(w: ActiveWarranty): number {
  if (typeof w.daysLeft === 'number' && Number.isFinite(w.daysLeft)) {
    return w.daysLeft;
  }
  return daysUntil(w.expiresAt);
}

/**
 * Map daysLeft → (background, border, text) tokens for the urgency chip.
 * Returns hex strings rather than theme tokens because the chip colour
 * MUST stay green/amber/red regardless of light/dark — we only shift the
 * surface intensity per mode. Threshold: < 14 days → amber.
 */
function urgencyTones(daysLeft: number, isDark: boolean) {
  // Green for healthy warranties (≥ 14 days left).
  if (daysLeft >= 14) {
    return isDark
      ? { bg: 'rgba(34, 197, 94, 0.16)', border: 'rgba(34, 197, 94, 0.3)', text: '#86efac' }
      : { bg: '#ecfdf5', border: '#a7f3d0', text: '#047857' };
  }
  // Amber for the "ending soon" band (1-13 days).
  if (daysLeft >= 1) {
    return isDark
      ? { bg: 'rgba(245, 158, 11, 0.16)', border: 'rgba(245, 158, 11, 0.32)', text: '#fcd34d' }
      : { bg: '#fffbeb', border: '#fde68a', text: '#b45309' };
  }
  // Red for the danger zone (defensive — backend should filter expired).
  return isDark
    ? { bg: 'rgba(239, 68, 68, 0.18)', border: 'rgba(239, 68, 68, 0.34)', text: '#fca5a5' }
    : { bg: '#fef2f2', border: '#fecaca', text: '#b91c1c' };
}

export default function ActiveWarrantiesSection({ clientId, carId }: ActiveWarrantiesSectionProps) {
  const palette = useColors();
  const isDark = palette.mode === 'dark';

  // We can show warranties scoped to a client (all their cars) OR to a
  // single car — at least one filter must be present, otherwise the backend
  // (correctly) returns an empty list. `enabled` follows the same rule so we
  // never fire a useless request that can only come back empty.
  const hasScope = !!clientId || !!carId;

  const { data, isLoading } = useQuery<ActiveWarranty[]>({
    // Key on both scope ids — the default cash-screen usage passes only
    // `clientId` (whole-client view); a future car-scoped caller can pass
    // `carId`. Including both in the key keeps the cache correct either way.
    queryKey: ['warranty-active-client', clientId, carId],
    queryFn: async () => {
      const res = await warrantyApi.active({ clientId, carId });
      // Be defensive about the payload: `res.data` is the ActiveWarranty[]
      // array, but guard against a non-array (e.g. an error envelope) so a
      // malformed response degrades to "nothing to show", never a crash.
      return Array.isArray(res.data) ? res.data : [];
    },
    enabled: hasScope,
    staleTime: 60_000,
  });

  if (!hasScope) return null;

  // First load (no cached answer yet) for a freshly-selected client →
  // surface a single, calm "gathering info" row instead of popping the
  // real badges in late. `isLoading` is true ONLY on the very first fetch
  // with no data; thanks to the global `placeholderData: prev => prev`
  // SWR + persistent cache, re-selecting a previously-seen client skips
  // this entirely (data is already there), so there is no "через раз"
  // flash. Once resolved we either render the warranties (data.length > 0)
  // or nothing (empty) — the loader never lingers and never shows when
  // there simply is no warranty.
  if (isLoading && !data) {
    return <ClientMetaLoading palette={palette} />;
  }

  const items = data || [];
  if (items.length === 0) return null;

  return (
    <View
      style={[styles.box, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
    >
      <View style={styles.headerRow}>
        <View style={[styles.shieldWrap, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
          <Ionicons name="shield-checkmark-outline" size={12} color={palette.text.secondary} />
        </View>
        <Text style={[styles.headerTitle, { color: palette.text.primary }]}>На гарантии</Text>
        <View style={{ flex: 1 }} />
        <Text style={[styles.headerCount, { color: palette.text.tertiary }]}>
          {pluraliseActive(items.length)}
        </Text>
      </View>
      <View style={[styles.divider, { backgroundColor: palette.border.subtle }]} />
      <View style={styles.list}>
        {items.map((w, i) => {
          const daysLeft = resolveDaysLeft(w);
          const tone = urgencyTones(daysLeft, isDark);
          const iconName = w.kind === 'product' ? 'cube-outline' : 'build-outline';
          return (
            <View key={`${w.kind}:${w.name}:${w.expiresAt}:${i}`} style={styles.row}>
              <View
                style={[styles.iconWrap, { backgroundColor: palette.bg.canvas, borderColor: palette.border.subtle }]}
              >
                <Ionicons name={iconName} size={14} color={palette.text.secondary} />
              </View>
              <Text style={[styles.itemName, { color: palette.text.primary }]} numberOfLines={1}>
                {w.name}
              </Text>
              <View style={[styles.chip, { backgroundColor: tone.bg, borderColor: tone.border }]}>
                <Ionicons name="time-outline" size={11} color={tone.text} style={styles.chipIcon} />
                <Text style={[styles.chipText, { color: tone.text }]} numberOfLines={1}>
                  {formatDaysLeft(daysLeft)}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/**
 * ClientMetaLoading — calm, premium "gathering info" row shown while the
 * freshly-selected client's warranty (and, conceptually, their visit) data
 * is still loading for the FIRST time. A single muted line + a small
 * spinner — never a big block. Honours Reduce Motion: when enabled, the
 * spinner is swapped for a static hourglass glyph so nothing animates.
 */
function ClientMetaLoading({ palette }: { palette: SemanticPalette }) {
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (alive) setReduceMotion(v);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => {
      setReduceMotion(v);
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  return (
    <View
      style={[
        styles.loadingRow,
        { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
      ]}
    >
      {reduceMotion ? (
        <Ionicons name="hourglass-outline" size={13} color={palette.text.tertiary} />
      ) : (
        <ActivityIndicator size="small" color={palette.text.tertiary} />
      )}
      <Text style={[styles.loadingText, { color: palette.text.secondary }]} numberOfLines={1}>
        Собираю информацию по клиенту…
      </Text>
    </View>
  );
}

// Exported so future consumers (client detail, dashboard alerts) can reuse
// the pluralisation / urgency / days-left helpers without redeclaring them.
export { pluraliseActive, urgencyTones, daysUntil };

const styles = StyleSheet.create({
  box: {
    marginTop: spacing[2],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    gap: spacing[2],
  },
  loadingRow: {
    marginTop: spacing[2],
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
  },
  loadingText: {
    flex: 1,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    letterSpacing: -0.1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
  },
  shieldWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    letterSpacing: -0.1,
  },
  headerCount: {
    fontSize: 11,
    fontWeight: fontWeight.medium,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  list: {
    gap: spacing[1.5],
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  iconWrap: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemName: {
    flex: 1,
    fontSize: 13,
    fontWeight: fontWeight.semibold,
    letterSpacing: -0.1,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipIcon: {
    marginTop: -0.5,
  },
  chipText: {
    fontSize: 11,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.1,
  },
});
