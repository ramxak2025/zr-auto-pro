import React from 'react';
import { View, Text } from 'react-native';
import { useColors } from '../contexts/ThemeContext';
import { spacing, fontSize } from '../theme';
import type { SubscriptionQuotePreview } from '../../../shared/types';
const money = (value: number) => `${value.toLocaleString('ru-RU')} ₽`;
export default function SubscriptionQuoteBreakdown({
  preview,
  hideMoney = false,
}: {
  preview: SubscriptionQuotePreview;
  hideMoney?: boolean;
}) {
  const palette = useColors();
  const q = preview.quote;
  const lines = [
    `Сотрудники, включая владельца: включено ${q.includedEmployees}, используется ${preview.usage.employees}, дополнительно в расчёте ${q.extraEmployees}.`,
    `Филиалы: используется ${preview.usage.activePoints}${q.includedPoints != null ? `, включено ${q.includedPoints}, дополнительно в расчёте ${q.extraPoints}` : ''}.`,
    ...(!hideMoney
      ? [
          `База ${money(q.baseMonthlyAmount)} + сотрудники ${money(q.employeesMonthlyAmount)} + филиалы ${money(q.pointsMonthlyAmount)} = ${money(q.monthlyTotal)}/мес.`,
          q.period === 'yearly'
            ? `12 месяцев по цене 10: ${money(q.total)} за год, включая все доплаты.`
            : `Расчёт на месяц: ${money(q.total)}.`,
        ]
      : []),
  ];
  return (
    <View style={{ gap: spacing[2], paddingVertical: spacing[3] }}>
      {lines.map((line) => (
        <Text key={line} style={{ fontSize: fontSize.sm, color: palette.text.secondary }}>
          {line}
        </Text>
      ))}
    </View>
  );
}
