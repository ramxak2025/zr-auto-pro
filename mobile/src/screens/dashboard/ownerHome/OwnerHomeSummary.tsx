import React, { useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  AppState,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useColors } from '../../../contexts/ThemeContext';
import { colors } from '../../../theme';
import type { OwnerHomeTimeline } from '../../../../../shared/types/ownerHome';
import { ownerMoney, ownerPercentLabel, ownerRangeLabel, type OwnerHomeScope } from './ownerHomeState';
import OwnerHomeCloud from './OwnerHomeCloud';

const touchSize = Platform.OS === 'android' ? 48 : 44;
const summaryGradient = {
  light: ['#285BCB', '#244CAA', '#24428E'],
  dark: ['#263B67', '#203157', '#192744'],
} as const;

type SummaryProps = {
  data: OwnerHomeTimeline;
  scope: OwnerHomeScope;
  active: boolean;
  reducedMotion: boolean;
  onRangeDetails: () => void;
  onMonthDetails: () => void;
  onInfo: () => void;
  widgetActions?: React.ReactNode;
};

/** Values are the validated server totals; this surface never fetches or derives money. */
export default function OwnerHomeSummary({
  data,
  scope,
  active,
  reducedMotion,
  onRangeDetails,
  onMonthDetails,
  onInfo,
  widgetActions,
}: SummaryProps) {
  const p = useColors();
  const { fontScale } = useWindowDimensions();
  const ink = p.mode === 'dark' ? p.text.primary : p.text.inverse;
  const scopeKey = JSON.stringify(scope.key);
  const live = useRef({ active, data, scope, scopeKey });
  live.current = { active, data, scope, scopeKey };
  const mounted = useRef(true);
  const opacity = useSharedValue(1);
  const entrance = useAnimatedStyle(() => ({ opacity: opacity.value }));
  useEffect(() => {
    mounted.current = true;
    cancelAnimation(opacity);
    if (active && !reducedMotion) {
      opacity.value = 0.8;
      opacity.value = withTiming(1, {
        duration: 180,
        easing: Easing.out(Easing.cubic),
        reduceMotion: ReduceMotion.System,
      });
    } else opacity.value = 1;
    return () => {
      mounted.current = false;
      cancelAnimation(opacity);
    };
  }, [active, reducedMotion, opacity]);
  const press = (action: () => void) => {
    const current = live.current;
    if (
      mounted.current &&
      current.active &&
      AppState.currentState === 'active' &&
      current.scope.isCurrent() &&
      current.scopeKey === scopeKey &&
      current.data === data
    )
      action();
  };
  const disabled = !active || !scope.isCurrent();
  const footer = data.footer;
  const monthMode = data.range.period === 'month';
  const monthRange = ownerRangeLabel(
    footer.current.period.from,
    footer.current.period.through,
    data.todayDate.slice(0, 4),
  );
  const comparisonRange = ownerRangeLabel(
    footer.comparison.period.from,
    footer.comparison.period.through,
    data.todayDate.slice(0, 4),
  );
  const delta = footer.comparison.mtdDelta;
  const change =
    ownerPercentLabel(delta, footer.comparison.mtd.netProfit) ??
    `${delta.amount > 0 ? '+' : ''}${ownerMoney(delta.amount)}`;
  const changeInk = delta.amount > 0 ? colors.green[100] : delta.amount < 0 ? colors.red[100] : ink;

  return (
    <Animated.View style={[styles.card, entrance]} testID="owner-home-summary">
      <LinearGradient
        key={`summary-type-${fontScale}`}
        colors={summaryGradient[p.mode]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.surface}
      >
        <OwnerHomeCloud />
        <View style={styles.heading}>
          <Text style={[styles.label, { color: ink }]}>Чистая прибыль</Text>
          <View style={styles.headingActions}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`Как рассчитана прибыль. ${data.basisLabel}`}
              accessibilityState={{ disabled }}
              disabled={disabled}
              activeOpacity={0.7}
              onPress={() => press(onInfo)}
              style={styles.info}
            >
              <Ionicons name="information-circle-outline" size={21} color={ink} />
            </TouchableOpacity>
            {widgetActions}
          </View>
        </View>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`Чистая прибыль ${ownerMoney(data.totals.netProfit)}. Оборот ${ownerMoney(data.totals.revenue)}. Открыть расчёт за выбранный период`}
          accessibilityState={{ disabled }}
          disabled={disabled}
          activeOpacity={0.7}
          onPress={() => press(onRangeDetails)}
          style={styles.period}
        >
          <View style={styles.valueRow}>
            <Text testID="owner-summary-profit" style={[styles.profit, { color: ink }]}>
              {ownerMoney(data.totals.netProfit)}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={ink} />
          </View>
          <View style={styles.turnover}>
            <Text style={[styles.secondaryLabel, { color: ink }]}>Оборот</Text>
            <Text testID="owner-summary-turnover" style={[styles.turnoverValue, { color: ink }]}>
              {ownerMoney(data.totals.revenue)}
            </Text>
          </View>
        </TouchableOpacity>
        <View style={[styles.divider, { backgroundColor: ink }]} />
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`Прибыль за месяц, ${monthRange}: ${ownerMoney(footer.current.mtd.netProfit)}. ${change} к ${comparisonRange}. Открыть месячный расчёт`}
          accessibilityState={{ disabled }}
          disabled={disabled}
          activeOpacity={0.7}
          onPress={() => press(onMonthDetails)}
          style={styles.month}
        >
          <Text style={[styles.secondaryLabel, { color: ink }]}>
            {monthMode ? 'Сравнение с прошлым месяцем' : `Прибыль за месяц · ${monthRange}`}
          </Text>
          {!monthMode && (
            <View style={styles.valueRow}>
              <Text testID="owner-summary-month-profit" style={[styles.monthProfit, { color: ink }]}>
                {ownerMoney(footer.current.mtd.netProfit)}
              </Text>
              <Ionicons name="chevron-forward" size={14} color={ink} />
            </View>
          )}
          <View style={styles.comparisonRow}>
            <Text style={[styles.comparison, { color: ink }]}>
              <Text style={[styles.change, { color: changeInk }]}>{change}</Text>
              {' к '}
              {comparisonRange}
            </Text>
            {monthMode && <Ionicons name="chevron-forward" size={14} color={ink} />}
          </View>
        </TouchableOpacity>
      </LinearGradient>
    </Animated.View>
  );
}

export function OwnerHomeSummaryPlaceholder({
  errorMessage,
  retrying,
  onRetry,
  widgetActions,
}: {
  errorMessage?: string;
  retrying: boolean;
  onRetry: () => unknown;
  widgetActions?: React.ReactNode;
}) {
  const p = useColors();
  const { fontScale } = useWindowDimensions();
  const ink = p.mode === 'dark' ? p.text.primary : p.text.inverse;
  return (
    <View style={styles.card} testID="owner-home-summary-placeholder">
      <LinearGradient
        key={`summary-placeholder-type-${fontScale}`}
        colors={summaryGradient[p.mode]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.surface}
      >
        <OwnerHomeCloud />
        <View style={styles.heading}>
          <Text style={[styles.label, { color: ink }]}>Чистая прибыль</Text>
          {widgetActions && <View style={styles.headingActions}>{widgetActions}</View>}
        </View>
        <View style={styles.status} accessibilityLiveRegion="polite">
          <Text style={[styles.statusTitle, { color: ink }]}>{errorMessage ?? 'Загружаем сводку'}</Text>
          {errorMessage ? (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Повторить загрузку сводки"
              accessibilityState={{ disabled: retrying, busy: retrying }}
              disabled={retrying}
              activeOpacity={0.7}
              onPress={onRetry}
              style={styles.retry}
            >
              {retrying ? <ActivityIndicator color={ink} /> : <Ionicons name="refresh-outline" size={18} color={ink} />}
              <Text style={[styles.retryLabel, { color: ink }]}>{retrying ? 'Загружаем…' : 'Повторить'}</Text>
            </TouchableOpacity>
          ) : (
            <ActivityIndicator color={ink} accessibilityLabel="Загружается выбранный период" />
          )}
        </View>
      </LinearGradient>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 22, overflow: 'hidden' },
  surface: { minHeight: 244, paddingHorizontal: 20, paddingTop: 5, paddingBottom: 18 },
  heading: {
    minHeight: touchSize,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    columnGap: 8,
  },
  label: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 118,
    minWidth: 118,
    alignSelf: 'flex-end',
    marginBottom: 2,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
    opacity: 0.9,
  },
  headingActions: {
    flexDirection: 'row',
    flexShrink: 0,
    alignItems: 'center',
    marginLeft: 'auto',
    marginRight: -10,
  },
  info: { width: touchSize, minHeight: touchSize, alignItems: 'center', justifyContent: 'center' },
  period: { minHeight: touchSize, gap: 5 },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  profit: {
    flex: 1,
    minWidth: 0,
    fontSize: 36,
    lineHeight: 44,
    fontWeight: '600',
    letterSpacing: -0.7,
    fontVariant: ['tabular-nums'],
  },
  turnover: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 7, rowGap: 2 },
  secondaryLabel: { fontSize: 13, lineHeight: 19, fontWeight: '500', opacity: 0.84 },
  turnoverValue: { fontSize: 17, lineHeight: 24, fontWeight: '600', fontVariant: ['tabular-nums'] },
  divider: { height: StyleSheet.hairlineWidth, opacity: 0.2, marginTop: 15, marginBottom: 13 },
  month: { minHeight: touchSize, gap: 3 },
  monthProfit: {
    flex: 1,
    minWidth: 0,
    fontSize: 23,
    lineHeight: 30,
    fontWeight: '600',
    letterSpacing: -0.3,
    fontVariant: ['tabular-nums'],
  },
  comparisonRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  comparison: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 19 },
  change: { fontWeight: '600', fontVariant: ['tabular-nums'] },
  status: { flex: 1, alignItems: 'flex-start', justifyContent: 'center', gap: 12, paddingVertical: 18 },
  statusTitle: { fontSize: 17, lineHeight: 24, fontWeight: '500' },
  retry: {
    minHeight: touchSize,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingRight: 12,
  },
  retryLabel: { fontSize: 14, lineHeight: 21, fontWeight: '600' },
});
