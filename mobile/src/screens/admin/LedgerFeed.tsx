/**
 * LedgerFeed — строки ленты взаиморасчётов менеджера с владельцем платформы: платные
 * оплаты (со снимком доли владельца) и расчёты, новые сверху. Общая для кабинета
 * менеджера («Расчёты») и карточки менеджера у суперадмина. Экраны кладут строки в
 * FlatList, чтобы история за 36 месяцев не рендерилась целиком.
 *
 * Правая колонка — влияние на долг менеджера: оплата добавляет долю владельца (красным),
 * расчёт уменьшает долг (зелёным); корректировка со знаком «минус» долг увеличивает.
 */
import React from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../platform/Typography';
import { haptic } from '../../platform/haptics';
import { useColors } from '../../contexts/ThemeContext';
import { useIosSurface } from '../../platform/iosSurface';
import { spacing, borderRadius } from '../../theme';
import type { ManagerLedger, ManagerSettlement } from '../../../../shared/types';
import { creditColor, debtColor, formatDateTime, formatMoneyExact, formatPercent } from './adminShared';

/** Окно лент по умолчанию и максимум, который принимает сервер (`months` 1..36). */
export const LEDGER_MONTHS_DEFAULT = 12;
export const LEDGER_MONTHS_MAX = 36;

type LedgerPayment = ManagerLedger['payments'][number];

export type LedgerFeedItem =
  | { kind: 'payment'; key: string; at: number; payment: LedgerPayment }
  | { kind: 'settlement'; key: string; at: number; settlement: ManagerSettlement };

/** 'YYYY-MM-DD' (или ISO) → локальная дата без сдвига часового пояса. */
function parseDay(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

export function formatIsoDay(iso: string): string {
  const day = parseDay(iso);
  return day ? day.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : iso;
}

/** Платежи и расчёты одной лентой, новые сверху. */
export function buildLedgerFeed(ledger: ManagerLedger | undefined): LedgerFeedItem[] {
  if (!ledger) return [];
  const items: LedgerFeedItem[] = [];
  for (const payment of ledger.payments) {
    items.push({ kind: 'payment', key: `p-${payment.id}`, at: new Date(payment.createdAt).getTime(), payment });
  }
  for (const settlement of ledger.settlements) {
    // У расчёта дата без времени: считаем его концом дня, чтобы он шёл после оплат того же дня.
    const day = parseDay(settlement.settledOn);
    const at = day ? day.getTime() + 24 * 3600 * 1000 - 1 : new Date(settlement.createdAt).getTime();
    items.push({ kind: 'settlement', key: `s-${settlement.id}`, at, settlement });
  }
  return items.sort((a, b) => b.at - a.at);
}

interface LedgerFeedRowProps {
  item: LedgerFeedItem;
  /** Удалять расчёты может только суперадмин; у менеджера корзины нет. */
  onDeleteSettlement?: (settlement: ManagerSettlement) => void;
}

export const LedgerFeedRow = React.memo(function LedgerFeedRow({ item, onDeleteSettlement }: LedgerFeedRowProps) {
  const palette = useColors();
  const surface = useIosSurface();

  if (item.kind === 'payment') {
    const p = item.payment;
    return (
      <View style={[styles.row, surface.cardCompact]}>
        <View style={[styles.icon, { backgroundColor: palette.bg.muted }]}>
          <Ionicons name="card-outline" size={16} color={palette.text.secondary} />
        </View>
        <View style={styles.body}>
          <Text style={[styles.title, { color: palette.text.primary }]} numberOfLines={1}>
            {p.tenantName}
          </Text>
          <Text style={[styles.sub, { color: palette.text.secondary }]} numberOfLines={1}>
            Оплата {formatMoneyExact(p.amount)}
            {p.ownerSharePercent != null ? ` · доля владельца ${formatPercent(p.ownerSharePercent)}` : ''}
          </Text>
          <Text style={[styles.meta, { color: palette.text.tertiary }]} numberOfLines={1}>
            {formatDateTime(p.createdAt)}
            {p.planName ? ` · ${p.planName}` : ''}
          </Text>
        </View>
        {p.ownerShareAmount != null ? (
          <View style={styles.amountCol}>
            <Text style={[styles.amount, { color: debtColor(palette) }]}>+{formatMoneyExact(p.ownerShareAmount)}</Text>
            <Text style={[styles.caption, { color: palette.text.tertiary }]}>к долгу</Text>
          </View>
        ) : null}
      </View>
    );
  }

  const s = item.settlement;
  const positive = s.amount > 0;
  const confirmDelete = () => {
    haptic('warning');
    Alert.alert(
      'Удалить расчёт?',
      `Расчёт ${formatMoneyExact(s.amount)} от ${formatIsoDay(s.settledOn)} будет удалён, баланс менеджера пересчитается.`,
      [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Удалить', style: 'destructive', onPress: () => onDeleteSettlement?.(s) },
      ],
    );
  };
  return (
    <View style={[styles.row, surface.cardCompact]}>
      <View style={[styles.icon, { backgroundColor: palette.bg.muted }]}>
        <Ionicons name="swap-horizontal-outline" size={16} color={palette.text.secondary} />
      </View>
      <View style={styles.body}>
        <Text style={[styles.title, { color: palette.text.primary }]} numberOfLines={1}>
          {positive ? 'Расчёт с владельцем' : 'Корректировка'}
        </Text>
        <Text style={[styles.sub, { color: palette.text.secondary }]} numberOfLines={2}>
          {s.note || (positive ? 'Передано владельцу' : 'Корректировка баланса')}
        </Text>
        <Text style={[styles.meta, { color: palette.text.tertiary }]} numberOfLines={1}>
          {formatIsoDay(s.settledOn)} · внёс владелец
        </Text>
      </View>
      <View style={styles.amountCol}>
        <Text style={[styles.amount, { color: positive ? creditColor(palette) : debtColor(palette) }]}>
          {positive ? '−' : '+'}
          {formatMoneyExact(Math.abs(s.amount))}
        </Text>
        <Text style={[styles.caption, { color: palette.text.tertiary }]}>{positive ? 'погашено' : 'к долгу'}</Text>
      </View>
      {onDeleteSettlement ? (
        <Pressable onPress={confirmDelete} hitSlop={10} style={styles.trash} accessibilityLabel="Удалить расчёт">
          <Ionicons name="trash-outline" size={18} color={palette.text.tertiary} />
        </Pressable>
      ) : null}
    </View>
  );
});

interface LedgerFeedFooterProps {
  months: number;
  count: number;
  /** Расширить окно до максимума; не передан — кнопки нет. */
  onShowMore?: () => void;
}

/** Подпись под лентой: за какой период показано и как раскрыть больше. */
export function LedgerFeedFooter({ months, count, onShowMore }: LedgerFeedFooterProps) {
  const palette = useColors();
  return (
    <View style={styles.footer}>
      <Text style={[styles.footerText, { color: palette.text.tertiary }]}>
        {count === 0 ? `За ${months} мес. операций нет` : `Показаны операции за ${months} мес.`}
      </Text>
      {onShowMore && months < LEDGER_MONTHS_MAX ? (
        <Pressable
          onPress={() => {
            haptic('select');
            onShowMore();
          }}
          hitSlop={8}
        >
          <Text style={[styles.footerLink, { color: palette.accent.primary }]}>
            Показать за {LEDGER_MONTHS_MAX} мес.
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

interface LedgerFeedTailProps {
  months: number;
  count: number;
  /** Есть ли уже ответ сервера (в том числе от прежнего окна). */
  hasData: boolean;
  isLoading: boolean;
  isError: boolean;
  /** Окно расширили: пока грузится новое, на экране лента прежнего окна. */
  isPlaceholder: boolean;
  onRetry: () => void;
  onShowMore: () => void;
}

/** Низ ленты: первая загрузка, ошибка, прогресс расширения окна или подпись периода. */
export function LedgerFeedTail({
  months,
  count,
  hasData,
  isLoading,
  isError,
  isPlaceholder,
  onRetry,
  onShowMore,
}: LedgerFeedTailProps) {
  const palette = useColors();
  if ((isLoading && !hasData) || isPlaceholder) {
    return <ActivityIndicator color={palette.accent.primary} style={styles.tail} />;
  }
  if (isError && !hasData) {
    return (
      <View style={styles.tail}>
        <Ionicons name="cloud-offline-outline" size={36} color={palette.text.tertiary} />
        <Text style={[styles.tailText, { color: palette.text.secondary }]}>Не удалось загрузить расчёты</Text>
        <Pressable
          onPress={() => {
            haptic('tap');
            onRetry();
          }}
          hitSlop={8}
        >
          <Text style={[styles.tailRetry, { color: palette.accent.primary }]}>Повторить</Text>
        </Pressable>
      </View>
    );
  }
  return <LedgerFeedFooter months={months} count={count} onShowMore={onShowMore} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingVertical: spacing[3] },
  icon: { width: 32, height: 32, borderRadius: borderRadius.lg, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1 },
  title: { fontSize: 15, fontWeight: '700' },
  sub: { fontSize: 13, marginTop: 1 },
  meta: { fontSize: 12, marginTop: 2 },
  amountCol: { alignItems: 'flex-end' },
  amount: { fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  caption: { fontSize: 11, marginTop: 1 },
  trash: { paddingLeft: spacing[1] },
  footer: { alignItems: 'center', gap: spacing[2], paddingVertical: spacing[4] },
  footerText: { fontSize: 12 },
  footerLink: { fontSize: 14, fontWeight: '600' },
  tail: { alignItems: 'center', gap: spacing[2], paddingVertical: spacing[8] },
  tailText: { fontSize: 14, textAlign: 'center' },
  tailRetry: { fontSize: 15, fontWeight: '600' },
});
