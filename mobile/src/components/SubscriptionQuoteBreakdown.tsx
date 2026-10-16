import React from 'react';
import { View, Text } from 'react-native';
import { useColors } from '../contexts/ThemeContext';
import { spacing, fontSize } from '../theme';
import type { SubscriptionQuotePreview } from '../../../shared/types';
import { getSubscriptionMonthlyDisplay } from '../../../shared/utils/subscriptionPricing';
import { subscriptionMoney as money } from '../utils/subscriptionPricingText';
export default function SubscriptionQuoteBreakdown({
  preview,
  hideMoney = false,
}: {
  preview: SubscriptionQuotePreview;
  hideMoney?: boolean;
}) {
  const palette = useColors();
  const q = preview.quote;
  const display = getSubscriptionMonthlyDisplay(q);
  const annual = q.period === 'yearly';
  const factor = q.chargedMonths;
  return (
    <View style={{ gap: spacing[2], paddingVertical: spacing[3] }}>
      {!hideMoney && (
        <>
          <Text style={{ fontSize: 28, fontWeight: '700', color: palette.text.primary }}>
            {display.approximate ? '≈ ' : ''}
            {money(display.amount)}/мес
          </Text>
          {annual ? (
            <Text style={{ fontSize: fontSize.sm, color: palette.text.secondary }}>в месяц при оплате за год</Text>
          ) : null}
          {annual ? (
            <Text style={{ fontSize: fontSize.base, fontWeight: '600', color: palette.text.primary }}>
              К оплате сразу за 12 месяцев: {money(q.total)}
            </Text>
          ) : null}
        </>
      )}
      <Text style={{ fontSize: fontSize.sm, color: palette.text.secondary }}>
        В расчёте: сотрудники — {q.employees} · Филиалы — {q.points}. Сотрудников включено: {q.includedEmployees}; сверх
        включённых: {q.extraEmployees}.
      </Text>
      {!hideMoney && (
        <>
          <Text style={{ fontSize: fontSize.sm, color: palette.text.secondary }}>
            {annual
              ? `За 12 месяцев: база ${money(q.baseMonthlyAmount * factor)} + сотрудники ${money(q.employeesMonthlyAmount * factor)} + филиалы ${money(q.pointsMonthlyAmount * factor)} = ${money(q.total)}.`
              : `За месяц: база ${money(q.baseMonthlyAmount)} + сотрудники ${money(q.employeesMonthlyAmount)} + филиалы ${money(q.pointsMonthlyAmount)} = ${money(q.total)}.`}
          </Text>
          {annual ? (
            <Text style={{ fontSize: fontSize.sm, color: palette.text.secondary }}>
              12 месяцев по цене 10. Скидка распространяется на сотрудников и филиалы.
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}
