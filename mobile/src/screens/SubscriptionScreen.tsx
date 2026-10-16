import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Linking,
  Platform,
  InputAccessoryView,
  Keyboard,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { subscriptionApi } from '../api/services';
import LoadingSpinner from '../components/LoadingSpinner';
import IosScreenHeader from '../components/IosScreenHeader';
import SubscriptionQuoteBreakdown from '../components/SubscriptionQuoteBreakdown';
import SubscriptionCompositionFields from '../components/SubscriptionCompositionFields';
import { planCompositionLabel, planIncludedLabel, subscriptionContactText } from '../utils/subscriptionPricingText';
import { useSubscriptionCalculator } from './subscription/useSubscriptionCalculator';
import { useColors } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { ALL_FEATURES } from '../../../shared/constants/features';
import type { SubscriptionInfo } from '../../../shared/types';
import { KeyboardAwareScroll } from '../components/KeyboardAware';

const WHATSAPP_PHONE = '79884444436';
export default function SubscriptionScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, undefined>>>();
  const queryClient = useQueryClient();
  const palette = useColors();
  const { hasPermission } = useAuth();
  const allowed = hasPermission('company_manage');
  const isIos = Platform.OS === 'ios';
  const [refreshing, setRefreshing] = React.useState(false);
  const [showFeatures, setShowFeatures] = React.useState(false);
  const {
    data: sub,
    isLoading,
    isError,
    refetch,
  } = useQuery<SubscriptionInfo>({
    queryKey: ['subscription'],
    queryFn: async () => (await subscriptionApi.get()).data,
    enabled: allowed,
  });
  const calc = useSubscriptionCalculator(sub, allowed);
  const plans = sub?.plans ?? [];
  const current = calc.planId === sub?.planId;
  const features = calc.plan?.features ?? (current ? sub?.features : undefined);
  const choices =
    plans.some((p) => p.id === sub?.planId) || !sub?.planId
      ? plans.map((p) => ({ id: p.id, name: p.name, info: planIncludedLabel(p) }))
      : [
          {
            id: sub.planId,
            name: sub.planName ?? 'Текущий тариф',
            info: current && calc.pricing ? planIncludedLabel({ pricing: calc.pricing }) : 'Текущий тариф',
          },
          ...plans.map((p) => ({ id: p.id, name: p.name, info: planIncludedLabel(p) })),
        ];
  const refresh = async () => {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: ['subscription'] });
      await queryClient.invalidateQueries({ queryKey: ['subscription-quote'] });
    } finally {
      setRefreshing(false);
    }
  };
  const contact = (planName?: string) => {
    const message = subscriptionContactText(planName, calc.ready ? calc.quote.data : undefined);
    void Linking.openURL(`https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent(message)}`);
  };
  const button = (label: string, action: () => void, selected = false) => (
    <TouchableOpacity
      key={label}
      onPress={action}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.choice, { backgroundColor: selected ? palette.accent.primarySoft : palette.bg.muted }]}
    >
      <Text
        style={{
          color: selected ? palette.accent.primaryText : palette.text.primary,
          fontWeight: selected ? '600' : '400',
        }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
  if (!allowed)
    return (
      <View style={[styles.screen, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Подписка" onBack={() => navigation.goBack()} />
        <Text style={[styles.message, { color: palette.text.secondary }]}>Нет доступа к настройкам компании.</Text>
      </View>
    );
  if (isLoading) return <LoadingSpinner />;
  return (
    <View style={[styles.screen, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Подписка" onBack={() => navigation.goBack()} />
      <KeyboardAwareScroll
        contentContainerStyle={styles.content}
        extraKeyboardBottomOffset={48}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={palette.accent.primary} />
        }
      >
        {isError ? (
          <View>
            <Text style={{ color: palette.text.secondary }}>Не удалось загрузить подписку.</Text>
            {button('Повторить', () => {
              void refetch();
            })}
          </View>
        ) : null}
        <View style={styles.status}>
          <Text style={[styles.statusTitle, { color: palette.text.primary }]}>
            {sub?.tenantName ?? 'Организация'} · {sub?.planName ?? 'Тариф не назначен'}
          </Text>
          <Text style={{ color: palette.text.secondary, fontSize: fontSize.sm }}>
            Оплачено до:{' '}
            {sub?.subscriptionEnd ? new Date(sub.subscriptionEnd).toLocaleDateString('ru-RU') : 'не указано'}
          </Text>
          <Text style={{ color: palette.text.secondary, fontSize: fontSize.sm }}>
            Фактически: сотрудники — {sub?.usage?.employees ?? sub?.currentUsers ?? 0}, включая владельца · Филиалы —{' '}
            {sub?.usage?.activePoints ?? 0}
          </Text>
          {sub?.subscriptionNote ? <Text style={{ color: palette.text.secondary }}>{sub.subscriptionNote}</Text> : null}
        </View>
        {choices.length ? (
          <View style={[styles.calculator, { backgroundColor: palette.bg.card }]}>
            <Text style={[styles.title, { color: palette.text.primary }]}>Расчёт стоимости</Text>
            <SubscriptionCompositionFields
              employees={calc.employees}
              points={calc.points}
              onEmployees={calc.setEmployees}
              onPoints={calc.setPoints}
              employeePresets
              minimumEmployees={calc.actualEmployees}
              inputAccessoryViewID={isIos ? 'subscription-calculator-done' : undefined}
            />
            <View style={styles.choices}>
              {choices.map((plan) => (
                <TouchableOpacity
                  key={plan.id}
                  onPress={() => calc.setPlan(plan.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Тариф ${plan.name}: ${plan.info}`}
                  accessibilityState={{ selected: calc.planId === plan.id }}
                  style={[
                    styles.planChoice,
                    { backgroundColor: calc.planId === plan.id ? palette.accent.primarySoft : palette.bg.muted },
                  ]}
                >
                  <Text
                    style={{
                      color: calc.planId === plan.id ? palette.accent.primaryText : palette.text.primary,
                      fontWeight: '600',
                    }}
                    numberOfLines={2}
                  >
                    {plan.name}
                  </Text>
                  <Text style={{ color: palette.text.secondary, fontSize: 12 }} numberOfLines={2}>
                    {plan.info}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={styles.choices}>
              {button('Месяц', () => calc.setPeriod('monthly'), calc.period === 'monthly')}
              {button('Год', () => calc.setPeriod('yearly'), calc.period === 'yearly')}
            </View>
            {calc.message ? <Text style={{ color: palette.text.secondary }}>{calc.message}</Text> : null}
            {calc.unsupportedPoints && calc.maxPlan
              ? button('Рассчитать MAX', () => {
                  if (calc.maxPlan) calc.setPlan(calc.maxPlan.id);
                })
              : null}
            {calc.quote.isFetching && calc.valid ? (
              <Text style={{ color: palette.text.secondary }}>Считаем стоимость…</Text>
            ) : calc.ready && calc.quote.data ? (
              <SubscriptionQuoteBreakdown preview={calc.quote.data} compact />
            ) : !calc.message ? (
              <Text style={{ color: palette.text.secondary }}>
                {calc.planId ? 'Укажите состав для расчёта.' : 'Выберите тариф.'}
              </Text>
            ) : null}
            {calc.quote.isError && !calc.unsupportedPoints
              ? button('Повторить расчёт', () => {
                  void calc.quote.refetch();
                })
              : null}
            <TouchableOpacity
              style={[styles.details, { borderTopColor: palette.border.subtle }]}
              onPress={() => setShowFeatures((shown) => !shown)}
              accessibilityRole="button"
              accessibilityLabel="Условия и возможности тарифа"
              accessibilityState={{ expanded: showFeatures }}
            >
              <Text style={{ color: palette.accent.primaryText }}>Условия и возможности</Text>
              <Ionicons
                name={showFeatures ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={palette.accent.primaryText}
              />
            </TouchableOpacity>
            {showFeatures ? (
              <View style={styles.conditions}>
                {calc.plan ? (
                  <Text style={{ color: palette.text.secondary }}>{planCompositionLabel(calc.plan)}</Text>
                ) : calc.pricing ? (
                  <Text style={{ color: palette.text.secondary }}>
                    {planCompositionLabel({ pricing: calc.pricing })}
                  </Text>
                ) : null}
                {features?.length ? (
                  features.map((key) => (
                    <Text key={key} style={{ color: palette.text.secondary }}>
                      {ALL_FEATURES.find((feature) => feature.key === key)?.label ?? key}
                    </Text>
                  ))
                ) : (
                  <Text style={{ color: palette.text.secondary }}>Список возможностей не указан.</Text>
                )}
              </View>
            ) : null}
            <Text style={{ color: palette.text.secondary, fontSize: 12 }}>
              Расчёт для сравнения. Подписка не меняется.
            </Text>
          </View>
        ) : null}
        {!isIos ? (
          <TouchableOpacity
            style={styles.payment}
            onPress={() => contact(calc.ready && !current ? (calc.name ?? undefined) : undefined)}
            accessibilityRole="button"
          >
            <Text style={styles.paymentText}>Связаться для оплаты</Text>
          </TouchableOpacity>
        ) : null}
      </KeyboardAwareScroll>
      {isIos ? (
        <InputAccessoryView nativeID="subscription-calculator-done" backgroundColor={palette.bg.card}>
          <View style={styles.keyboardAccessory}>
            <TouchableOpacity
              onPress={Keyboard.dismiss}
              style={styles.keyboardDone}
              accessibilityRole="button"
              accessibilityLabel="Скрыть клавиатуру"
            >
              <Text style={{ color: palette.accent.primaryText, fontWeight: '600' }}>Готово</Text>
            </TouchableOpacity>
          </View>
        </InputAccessoryView>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  keyboardAccessory: { alignItems: 'flex-end' },
  keyboardDone: { minHeight: 44, paddingHorizontal: spacing[4], justifyContent: 'center' },
  content: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[4] },
  status: { gap: spacing[1] },
  statusTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  calculator: { padding: spacing[4], borderRadius: borderRadius.xl, gap: spacing[2] },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  choice: {
    flex: 1,
    minHeight: 44,
    paddingHorizontal: spacing[3],
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: borderRadius.md,
  },
  planChoice: {
    flex: 1,
    minWidth: 80,
    minHeight: 62,
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2],
    justifyContent: 'center',
    borderRadius: borderRadius.md,
    gap: 3,
  },
  details: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  conditions: { gap: spacing[2], paddingBottom: spacing[2] },
  payment: {
    minHeight: 48,
    borderRadius: borderRadius.md,
    backgroundColor: colors.primary[600],
    alignItems: 'center',
    justifyContent: 'center',
  },
  paymentText: { color: colors.white, fontWeight: fontWeight.semibold },
  message: { padding: spacing[4] },
});
