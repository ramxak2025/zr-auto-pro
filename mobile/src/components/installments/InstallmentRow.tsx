/**
 * InstallmentRow — one «Рассрочка» plan as a premium card row. Shared by the
 * InstallmentsScreen list. Presentational only: client name + originating
 * заказ-наряд, a paid/total progress bar, the outstanding remainder (accent-
 * coloured), the due label and an open|overdue|closed status chip.
 *
 * Module-scope + memo'd so a background revalidation that rebuilds the list
 * doesn't tear down + remount every row.
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AnimatedCard from '../AnimatedCard';
import { Text } from '../../platform/Typography';
import type { useColors } from '../../contexts/ThemeContext';
import { colors, fontSize, fontWeight, borderRadius, spacing, softTint } from '../../theme';
import { formatInstallmentMoney, dueLabel, statusChip, remainingColor } from './installmentUi';
import type { InstallmentPlan } from '../../../../shared/types';

interface InstallmentRowProps {
  item: InstallmentPlan;
  index: number;
  onPress: (plan: InstallmentPlan) => void;
  palette: ReturnType<typeof useColors>;
}

function InstallmentRowBase({ item, index, onPress, palette }: InstallmentRowProps) {
  const chip = statusChip(item, palette.mode);
  const remColor = remainingColor(item);
  const total = item.total || 0;
  const paid = item.paid || 0;
  const pct = total > 0 ? Math.max(0, Math.min(1, paid / total)) : item.status === 'closed' ? 1 : 0;
  const closed = item.status === 'closed';
  const subtitle = item.checkNumber ? `Заказ-наряд №${item.checkNumber}` : 'Рассрочка';
  const due = dueLabel(item);

  return (
    <AnimatedCard
      style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
      index={index}
      onPress={() => onPress(item)}
    >
      <View style={styles.topRow}>
        <View
          style={[
            styles.iconCircle,
            {
              backgroundColor: closed
                ? palette.bg.muted
                : item.overdue
                  ? softTint(colors.red[600], palette.mode)
                  : softTint(colors.green[600], palette.mode),
            },
          ]}
        >
          <Ionicons
            name={closed ? 'checkmark-done' : 'card-outline'}
            size={18}
            color={
              closed
                ? palette.text.tertiary
                : item.overdue
                  ? palette.mode === 'dark'
                    ? colors.red[300]
                    : colors.red[600]
                  : palette.mode === 'dark'
                    ? colors.green[300]
                    : colors.green[600]
            }
          />
        </View>
        <View style={styles.info}>
          <Text style={[styles.name, { color: palette.text.primary }]} numberOfLines={1}>
            {item.clientName || 'Без клиента'}
          </Text>
          <Text style={[styles.subtitle, { color: palette.text.tertiary }]} numberOfLines={1}>
            {subtitle}
          </Text>
        </View>
        <View style={styles.amountWrap}>
          <Text style={[styles.remaining, { color: remColor }]} numberOfLines={1} adjustsFontSizeToFit>
            {closed ? 'Погашена' : formatInstallmentMoney(item.remaining)}
          </Text>
          {!closed ? <Text style={[styles.remainingHint, { color: palette.text.tertiary }]}>остаток</Text> : null}
        </View>
      </View>

      {/* Paid / total progress */}
      <View style={[styles.track, { backgroundColor: palette.bg.muted }]}>
        <View
          style={[styles.fill, { width: `${pct * 100}%`, backgroundColor: closed ? colors.green[600] : remColor }]}
        />
      </View>

      <View style={styles.metaRow}>
        <Text style={[styles.meta, { color: palette.text.tertiary }]} numberOfLines={1}>
          {formatInstallmentMoney(paid)} из {formatInstallmentMoney(total)}
        </Text>
        <View style={styles.metaRight}>
          {due ? (
            <Text
              style={[styles.due, { color: item.overdue ? colors.red[600] : palette.text.secondary }]}
              numberOfLines={1}
            >
              {due}
            </Text>
          ) : null}
          <View style={[styles.chip, { backgroundColor: chip.bg }]}>
            <Text style={[styles.chipText, { color: chip.text }]}>{chip.label}</Text>
          </View>
        </View>
      </View>
    </AnimatedCard>
  );
}

const InstallmentRow = React.memo(InstallmentRowBase);
export default InstallmentRow;

const styles = StyleSheet.create({
  card: {
    borderRadius: borderRadius['2xl'],
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
    marginBottom: spacing[2.5],
    borderWidth: StyleSheet.hairlineWidth,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  iconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1, minWidth: 0, gap: 2 },
  name: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, letterSpacing: -0.2 },
  subtitle: { fontSize: 12.5 },
  amountWrap: { alignItems: 'flex-end', maxWidth: 130, gap: 1 },
  remaining: { fontSize: 17, fontWeight: fontWeight.bold, letterSpacing: -0.3 },
  remainingHint: { fontSize: 11, fontWeight: fontWeight.medium },

  track: { height: 5, borderRadius: 3, marginTop: spacing[3], overflow: 'hidden' },
  fill: { height: 5, borderRadius: 3 },

  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing[2.5],
    gap: spacing[2],
  },
  meta: { fontSize: 12.5, fontWeight: fontWeight.medium, flexShrink: 1 },
  metaRight: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  due: { fontSize: 12.5, fontWeight: fontWeight.semibold },
  chip: { paddingHorizontal: spacing[2], paddingVertical: 3, borderRadius: borderRadius.full },
  chipText: { fontSize: 11, fontWeight: fontWeight.bold, letterSpacing: 0.1 },
});
