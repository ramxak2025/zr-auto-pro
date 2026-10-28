import { ScreenSectionScrollView } from '../components/ScreenSectionScrollable';
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
import { type NativeStackNavigationProp } from '@react-navigation/native-stack';
import { subscriptionApi } from '../api/services';
import LoadingSpinner from '../components/LoadingSpinner';
import IosScreenHeader from '../components/IosScreenHeader';
import SubscriptionQuoteBreakdown from '../components/SubscriptionQuoteBreakdown';
import SubscriptionCompositionFields from '../components/SubscriptionCompositionFields';
import {
  planCompositionLabel,
  planIncludedLabel,
  subscriptionContactText,
  subscriptionMoney,
} from '../utils/subscriptionPricingText';
import { assignedSubscriptionPlan, subscriptionOffers } from '../../../shared/utils/subscriptionPresentation';
import { useSubscriptionCalculator } from './subscription/useSubscriptionCalculator';
import { useColors } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { ALL_FEATURES } from '../../../shared/constants/features';
import { type SubscriptionInfo } from '../../../shared/types';
import { KeyboardAwareScroll } from '../components/KeyboardAware';
import { useScreenSectionScroll } from '../components/ScreenSectionHeader';

const WHATSAPP_PHONE = '79884444436';
export default function SubscriptionScreen() {
  const section = useScreenSectionScroll();
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, undefined>>>();
  const queryClient = useQueryClient();
  const palette = useColors();
  const { hasPermission } = useAuth();
  const allowed = hasPermission('company_manage');
  const isIos = Platform.OS === 'ios';
  const [refreshing, setRefreshing] = React.useState(false);
  const [showFeatures, setShowFeatures] = React.useState(false);
  const [showConditions, setShowConditions] = React.useState(false);
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
  const currentPlan = assignedSubscriptionPlan(sub);
  const archived = currentPlan?.isActive === false;
  const choices = subscriptionOffers(sub);
  const endDate = sub?.subscriptionEnd ? new Date(sub.subscriptionEnd) : undefined;
  const endLabel =
    sub?.subscriptionEnd === null
      ? 'Без ограничения срока'
      : endDate && !Number.isNaN(endDate.getTime())
        ? endDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
        : 'Срок не указан';
  const status = sub?.status === 'suspended' ? 'Приостановлена' : sub?.status === 'expired' ? 'Истекла' : 'Активна';
  const refresh = async () => {
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: ['subscription'] });
      await queryClient.invalidateQueries({ queryKey: ['subscription-quote'] });
    } finally {
      setRefreshing(false);
    }
  };
  const contact = () => {
    if (isIos || !calc.ready) return;
    const message = subscriptionContactText(calc.name, calc.quote.data);
    void Linking.openURL(`https://wa.me/${WHATSAPP_PHONE}?text=${encodeURIComponent(message)}`);
  };
  const button = (label: string, action: () => void, selected = false) => (
    <TouchableOpacity
      key={label}
      onPress={action}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.choice, { backgroundColor: selected ? palette.bg.card : palette.bg.muted }]}
    >
      <Text
        style={{
          color: selected ? palette.accent.primaryText : palette.text.secondary,
          fontSize: fontSize.sm,
          fontWeight: selected ? fontWeight.semibold : fontWeight.normal,
        }}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
  const row = (label: string, value: string) => (
    <View key={label} style={[styles.row, { borderTopColor: palette.border.subtle }]}>
      <Text style={[styles.rowLabel, { color: palette.text.secondary }]}>{label}</Text>
      <Text style={[styles.rowValue, { color: palette.text.primary }]}>{value}</Text>
    </View>
  );
  if (!allowed)
    return (
      <View style={[styles.screen, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader scroll={section} title="Подписка" onBack={() => navigation.goBack()} />
        <ScreenSectionScrollView
          onScroll={section.onScroll}
          scrollEventThrottle={16}
          contentInsetAdjustmentBehavior="never"
          contentContainerStyle={{ flexGrow: 1, paddingTop: section.contentTop }}
        >
          <Text style={[styles.message, { color: palette.text.secondary }]}>Нет доступа к настройкам компании.</Text>
        </ScreenSectionScrollView>
      </View>
    );
  if (isLoading)
    return (
      <View style={{ flex: 1, backgroundColor: palette.bg.canvas }}>
        <IosScreenHeader scroll={section} title="Подписка" onBack={() => navigation.goBack()} />
        <ScreenSectionScrollView
          onScroll={section.onScroll}
          scrollEventThrottle={16}
          contentInsetAdjustmentBehavior="never"
          contentContainerStyle={{ flexGrow: 1, paddingTop: section.contentTop }}
        >
          <LoadingSpinner />
        </ScreenSectionScrollView>
      </View>
    );
  return (
    <View style={[styles.screen, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader scroll={section} title="Подписка" onBack={() => navigation.goBack()} />
      <KeyboardAwareScroll
        onScroll={section.onScroll}
        contentInsetAdjustmentBehavior="never"
        scrollEventThrottle={16}
        contentContainerStyle={[styles.content, { paddingTop: section.contentTop + spacing[4] }]}
        extraKeyboardBottomOffset={48}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={palette.accent.primary} />
        }
      >
        {isError ? (
          <View style={[styles.section, { backgroundColor: palette.bg.card }]}>
            <Text style={[styles.body, { color: palette.text.secondary }]}>Не удалось загрузить подписку.</Text>
            {button('Повторить', () => {
              void refetch();
            })}
          </View>
        ) : sub ? (
          <>
            <View style={styles.sectionHeading}>
              <Text style={[styles.heading, { color: palette.text.primary }]}>Текущая подписка</Text>
              <Text style={[styles.status, { color: palette.text.secondary }]}>{status}</Text>
            </View>
            <View style={[styles.section, { backgroundColor: palette.bg.card }]} accessibilityLabel="Текущая подписка">
              <View style={styles.planHeader}>
                <Text style={[styles.planName, { color: palette.text.primary }]}>
                  {sub.planName ?? 'Тариф не назначен'}
                </Text>
                {archived ? (
                  <View style={[styles.badge, { backgroundColor: palette.bg.muted }]}>
                    <Text style={[styles.caption, { color: palette.text.secondary }]}>Архивный тариф</Text>
                  </View>
                ) : null}
              </View>
              <Text style={[styles.body, { color: palette.text.secondary }]}>{sub.tenantName}</Text>
              {archived ? (
                <Text style={[styles.body, { color: palette.text.secondary }]}>
                  У вас сохранены условия прежнего тарифа. Ниже можно рассчитать новый.
                </Text>
              ) : null}
              <View>
                {row('Доступ до', endLabel)}
                {row(
                  'Месячная ставка',
                  sub.monthlyPrice != null ? subscriptionMoney(sub.monthlyPrice) : 'Ставка не указана',
                )}
                {row(
                  'Сотрудники',
                  `${sub.usage?.employees ?? sub.currentUsers} · лимит ${sub.maxUsers ?? 'не указан'}`,
                )}
                {row('Действующие филиалы', String(sub.usage?.activePoints ?? 'Не указано'))}
              </View>
              <TouchableOpacity
                onPress={() => setShowFeatures((shown) => !shown)}
                accessibilityRole="button"
                accessibilityLabel="Возможности текущего тарифа"
                accessibilityState={{ expanded: showFeatures }}
                style={[styles.disclosure, { borderTopColor: palette.border.subtle }]}
              >
                <Text style={[styles.body, styles.flex, { color: palette.accent.primaryText }]}>
                  Возможности текущего тарифа
                </Text>
                <Ionicons
                  name={showFeatures ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={palette.accent.primaryText}
                />
              </TouchableOpacity>
              {showFeatures ? (
                <View style={styles.conditions}>
                  {sub.features?.length ? (
                    sub.features.map((key) => (
                      <Text key={key} style={[styles.body, { color: palette.text.secondary }]}>
                        {ALL_FEATURES.find((feature) => feature.key === key)?.label ?? key}
                      </Text>
                    ))
                  ) : (
                    <Text style={[styles.body, { color: palette.text.secondary }]}>Список возможностей не указан.</Text>
                  )}
                </View>
              ) : null}
              {sub.subscriptionNote ? (
                <Text style={[styles.body, { color: palette.text.secondary }]}>{sub.subscriptionNote}</Text>
              ) : null}
            </View>
            <View style={styles.builderHeading}>
              <Text style={[styles.heading, { color: palette.text.primary }]}>Соберите новый тариф</Text>
              <Text style={[styles.body, { color: palette.text.secondary }]}>
                Подберите состав и период. Расчёт не меняет вашу подписку.
              </Text>
            </View>
            {choices.length ? (
              <>
                <View style={[styles.section, { backgroundColor: palette.bg.card }]}>
                  <Text style={[styles.label, { color: palette.text.primary }]}>Тариф для расчёта</Text>
                  {choices.map((plan) => (
                    <TouchableOpacity
                      key={plan.id}
                      onPress={() => calc.setPlan(plan.id)}
                      accessibilityRole="radio"
                      accessibilityLabel={`Тариф ${plan.name}: ${planIncludedLabel(plan)}`}
                      accessibilityState={{ checked: calc.planId === plan.id }}
                      style={[
                        styles.planChoice,
                        {
                          borderColor: calc.planId === plan.id ? palette.accent.primary : palette.border.subtle,
                          backgroundColor: calc.planId === plan.id ? palette.bg.muted : palette.bg.card,
                        },
                      ]}
                    >
                      <View style={styles.flex}>
                        <Text style={[styles.label, { color: palette.text.primary }]}>{plan.name}</Text>
                        <Text style={[styles.caption, { color: palette.text.secondary }]}>
                          {planIncludedLabel(plan)}
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.planIndicator,
                          {
                            borderColor: calc.planId === plan.id ? palette.accent.primary : palette.text.secondary,
                            backgroundColor: calc.planId === plan.id ? palette.accent.primary : 'transparent',
                          },
                        ]}
                      >
                        {calc.planId === plan.id && <Ionicons name="checkmark" size={16} color="#FFFFFF" />}
                      </View>
                    </TouchableOpacity>
                  ))}
                  {calc.pricing ? (
                    <Text style={[styles.caption, { color: palette.text.secondary }]}>
                      Включено {calc.pricing.includedEmployees} сотрудников · дополнительных{' '}
                      {/^\d+$/.test(calc.employees)
                        ? Math.max(0, Number(calc.employees) - calc.pricing.includedEmployees)
                        : '—'}
                      .
                    </Text>
                  ) : null}
                </View>
                <View style={[styles.section, { backgroundColor: palette.bg.card }]}>
                  <Text style={[styles.label, { color: palette.text.primary }]}>Состав команды</Text>
                  <SubscriptionCompositionFields
                    employees={calc.employees}
                    points={calc.points}
                    onEmployees={calc.setEmployees}
                    onPoints={calc.setPoints}
                    employeePresets
                    minimumEmployees={calc.actualEmployees}
                    inputAccessoryViewID={isIos ? 'subscription-calculator-done' : undefined}
                  />
                  <Text style={[styles.caption, { color: palette.text.secondary }]}>
                    Сейчас работает: {sub.usage?.employees ?? sub.currentUsers} сотрудников, включая владельца ·
                    филиалов {sub.usage?.activePoints ?? 1}.
                  </Text>
                </View>
                <View style={[styles.section, { backgroundColor: palette.bg.card }]}>
                  <Text style={[styles.label, { color: palette.text.primary }]}>Период расчёта</Text>
                  <View style={[styles.segmented, { backgroundColor: palette.bg.muted }]}>
                    {button('Месяц', () => calc.setPeriod('monthly'), calc.period === 'monthly')}
                    {button('Год · 12 за 10', () => calc.setPeriod('yearly'), calc.period === 'yearly')}
                  </View>
                  <View style={[styles.result, { borderTopColor: palette.border.subtle }]}>
                    <Text style={[styles.label, { color: palette.text.primary }]}>
                      Ваш расчёт{calc.name ? ` · ${calc.name}` : ''}
                    </Text>
                    {calc.message ? (
                      <Text accessibilityLiveRegion="polite" style={[styles.body, { color: palette.text.secondary }]}>
                        {calc.message}
                      </Text>
                    ) : calc.quote.isFetching && calc.valid && calc.planId ? (
                      <Text style={[styles.body, { color: palette.text.secondary }]}>Считаем стоимость…</Text>
                    ) : calc.ready && calc.quote.data ? (
                      <SubscriptionQuoteBreakdown preview={calc.quote.data} compact informational={isIos} />
                    ) : (
                      <Text style={[styles.body, { color: palette.text.secondary }]}>
                        {calc.planId
                          ? 'Укажите состав для расчёта.'
                          : 'Выберите тариф, чтобы увидеть стоимость нового состава.'}
                      </Text>
                    )}
                    {calc.unsupportedPoints && calc.maxPlan
                      ? button('Рассчитать MAX', () => {
                          if (calc.maxPlan) calc.setPlan(calc.maxPlan.id);
                        })
                      : calc.quote.isError && calc.planId
                        ? button('Повторить расчёт', () => {
                            void calc.quote.refetch();
                          })
                        : null}
                  </View>
                  {calc.plan ? (
                    <>
                      <TouchableOpacity
                        onPress={() => setShowConditions((shown) => !shown)}
                        accessibilityRole="button"
                        accessibilityLabel="Условия выбранного тарифа"
                        accessibilityState={{ expanded: showConditions }}
                        style={[styles.disclosure, { borderTopColor: palette.border.subtle }]}
                      >
                        <Text style={[styles.body, styles.flex, { color: palette.accent.primaryText }]}>
                          Условия выбранного тарифа
                        </Text>
                        <Ionicons
                          name={showConditions ? 'chevron-up' : 'chevron-down'}
                          size={18}
                          color={palette.accent.primaryText}
                        />
                      </TouchableOpacity>
                      {showConditions ? (
                        <View style={styles.conditions}>
                          <Text style={[styles.body, { color: palette.text.secondary }]}>
                            {planCompositionLabel(calc.plan)}
                          </Text>
                          {calc.plan.features?.map((key) => (
                            <Text key={key} style={[styles.body, { color: palette.text.secondary }]}>
                              {ALL_FEATURES.find((feature) => feature.key === key)?.label ?? key}
                            </Text>
                          ))}
                        </View>
                      ) : null}
                    </>
                  ) : null}
                  {!isIos ? (
                    <TouchableOpacity
                      disabled={!calc.ready}
                      onPress={contact}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: !calc.ready }}
                      style={[
                        styles.contact,
                        { backgroundColor: palette.accent.primary, opacity: calc.ready ? 1 : 0.45 },
                      ]}
                    >
                      <Text style={[styles.label, { color: palette.text.inverse }]}>Обсудить этот расчёт</Text>
                    </TouchableOpacity>
                  ) : null}
                  <Text style={[styles.caption, { color: palette.text.secondary }]}>
                    {isIos
                      ? 'Информационный расчёт. Условия и срок текущей подписки сохраняются.'
                      : 'Обсуждение в WhatsApp. Условия и срок текущей подписки сохраняются до согласования изменений.'}
                  </Text>
                </View>
              </>
            ) : (
              <View style={[styles.section, { backgroundColor: palette.bg.card }]}>
                <Text style={[styles.label, { color: palette.text.primary }]}>Нет доступных тарифов для расчёта</Text>
                <Text style={[styles.body, { color: palette.text.secondary }]}>Текущие условия показаны выше.</Text>
                {button('Обновить данные', () => {
                  void refetch();
                })}
              </View>
            )}
          </>
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
              <Text style={[styles.label, { color: palette.accent.primaryText }]}>Готово</Text>
            </TouchableOpacity>
          </View>
        </InputAccessoryView>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[8] },
  sectionHeading: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[2],
    paddingHorizontal: spacing[1],
  },
  heading: { fontSize: fontSize.lg, fontWeight: fontWeight.semibold },
  status: { fontSize: fontSize.sm },
  section: { padding: spacing[4], borderRadius: borderRadius.xl, gap: spacing[3] },
  builderHeading: { paddingTop: spacing[5], paddingHorizontal: spacing[1], gap: spacing[1] },
  planHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing[2] },
  planName: { fontSize: fontSize['2xl'], fontWeight: fontWeight.semibold, flexShrink: 1 },
  badge: { borderRadius: borderRadius.sm, paddingVertical: spacing[1], paddingHorizontal: spacing[2] },
  body: { fontSize: fontSize.base, lineHeight: 23 },
  caption: { fontSize: fontSize.sm, lineHeight: 20 },
  label: { fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  flex: { flex: 1 },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    gap: spacing[2],
    padding: spacing[3],
    borderWidth: 1,
    borderRadius: borderRadius.md,
  },
  planIndicator: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  rowLabel: { fontSize: fontSize.sm, flexShrink: 1 },
  rowValue: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    textAlign: 'right',
    marginLeft: 'auto',
    fontVariant: ['tabular-nums'],
    flexShrink: 1,
  },
  disclosure: {
    minHeight: 48,
    paddingTop: spacing[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  conditions: { gap: spacing[2] },
  planChoice: {
    minHeight: 64,
    paddingVertical: spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
  },
  segmented: { flexDirection: 'row', gap: spacing[1], padding: spacing[1], borderRadius: borderRadius.lg },
  choice: {
    flex: 1,
    minHeight: 48,
    padding: spacing[2],
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  result: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing[4], gap: spacing[3] },
  contact: {
    minHeight: 48,
    borderRadius: borderRadius.lg,
    padding: spacing[3],
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyboardAccessory: { alignItems: 'flex-end' },
  keyboardDone: { minHeight: 44, paddingHorizontal: spacing[4], justifyContent: 'center' },
  message: { textAlign: 'center', padding: spacing[6] },
});
