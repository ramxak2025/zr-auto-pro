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
import { planCompositionLabel, subscriptionContactText } from '../utils/subscriptionPricingText';
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
  const choices =
    plans.some((p) => p.id === sub?.planId) || !sub?.planId
      ? plans.map((p) => ({ id: p.id, name: p.name }))
      : [{ id: sub.planId, name: sub.planName ?? 'Текущий тариф' }, ...plans.map((p) => ({ id: p.id, name: p.name }))];
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
        <View style={[styles.card, { backgroundColor: palette.bg.card }]}>
          <Text style={[styles.title, { color: palette.text.primary }]}>{sub?.tenantName ?? 'Организация'}</Text>
          <Text style={{ color: palette.text.secondary }}>Текущий тариф: {sub?.planName ?? 'Не назначен'}</Text>
          <Text style={{ color: palette.text.primary }}>
            Оплачено до:{' '}
            {sub?.subscriptionEnd ? new Date(sub.subscriptionEnd).toLocaleDateString('ru-RU') : 'не указано'}
          </Text>
          <Text style={{ color: palette.text.secondary }}>
            Фактически: сотрудники — {sub?.usage?.employees ?? sub?.currentUsers ?? 0}, включая владельца · Филиалы —{' '}
            {sub?.usage?.activePoints ?? 0}
          </Text>
          {sub?.subscriptionNote ? <Text style={{ color: palette.text.secondary }}>{sub.subscriptionNote}</Text> : null}
          {!isIos ? (
            <TouchableOpacity style={styles.payment} onPress={() => contact()} accessibilityRole="button">
              <Text style={styles.paymentText}>Связаться для оплаты</Text>
            </TouchableOpacity>
          ) : null}
        </View>
        {choices.length ? (
          <View style={[styles.card, { backgroundColor: palette.bg.card }]}>
            <Text style={[styles.title, { color: palette.text.primary }]}>Расчёт стоимости</Text>
            <Text style={{ color: palette.text.secondary }}>
              Выберите состав для сравнения тарифов. Расчёт не меняет подписку и число сотрудников.
            </Text>
            <View style={styles.choices}>
              {choices.map((plan) => button(plan.name, () => calc.setPlan(plan.id), calc.planId === plan.id))}
            </View>
            <View style={styles.choices}>
              {button('Месяц', () => calc.setPeriod('monthly'), calc.period === 'monthly')}
              {button('Год · 12 за 10', () => calc.setPeriod('yearly'), calc.period === 'yearly')}
            </View>
            {calc.plan ? (
              <Text style={{ color: palette.text.secondary }}>{planCompositionLabel(calc.plan)}</Text>
            ) : calc.pricing ? (
              <Text style={{ color: palette.text.secondary }}>
                Сотрудников включено: {calc.pricing.includedEmployees}. Информация о текущем тарифе.
              </Text>
            ) : null}
            <SubscriptionCompositionFields
              employees={calc.employees}
              points={calc.points}
              onEmployees={calc.setEmployees}
              onPoints={calc.setPoints}
              inputAccessoryViewID={isIos ? 'subscription-calculator-done' : undefined}
            />
            {calc.message ? <Text style={{ color: palette.text.secondary }}>{calc.message}</Text> : null}
            {calc.quote.isFetching ? (
              <Text style={{ color: palette.text.secondary }}>Загружаем расчёт…</Text>
            ) : calc.ready && calc.quote.data ? (
              <SubscriptionQuoteBreakdown preview={calc.quote.data} />
            ) : null}
            {calc.quote.isError
              ? button('Повторить расчёт', () => {
                  void calc.quote.refetch();
                })
              : null}
            <Text style={{ color: palette.text.secondary, fontSize: fontSize.sm }}>
              Фактически сейчас: сотрудники — {calc.actualEmployees} · Филиалы — {calc.actualPoints}. Это нижняя граница
              расчёта.
            </Text>
            {calc.plan ? (
              <>
                <TouchableOpacity
                  style={styles.details}
                  onPress={() => setShowFeatures((shown) => !shown)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showFeatures }}
                >
                  <Text style={{ color: palette.accent.primaryText }}>Что входит в {calc.plan.name}</Text>
                  <Ionicons
                    name={showFeatures ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={palette.accent.primaryText}
                  />
                </TouchableOpacity>
                {showFeatures
                  ? ALL_FEATURES.filter((feature) => calc.plan?.features?.includes(feature.key)).map((feature) => (
                      <Text key={feature.key} style={{ color: palette.text.secondary }}>
                        {feature.label}
                      </Text>
                    ))
                  : null}
              </>
            ) : null}
            {!isIos && !current && calc.name ? (
              <TouchableOpacity
                style={styles.payment}
                onPress={() => contact(calc.name ?? undefined)}
                accessibilityRole="button"
              >
                <Text style={styles.paymentText}>Подключить</Text>
              </TouchableOpacity>
            ) : null}
          </View>
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
  content: { padding: spacing[4], gap: spacing[4], paddingBottom: spacing[4] },
  card: { padding: spacing[4], borderRadius: borderRadius.xl, gap: spacing[3] },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  choice: { minHeight: 44, paddingHorizontal: spacing[3], justifyContent: 'center', borderRadius: borderRadius.md },
  details: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
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
