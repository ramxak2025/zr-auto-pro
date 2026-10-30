import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, AppState, Image, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
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

const touchSize = Platform.OS === 'android' ? 48 : 44;

type SummaryProps = {
  data: OwnerHomeTimeline;
  scope: OwnerHomeScope;
  active: boolean;
  reducedMotion: boolean;
  onRangeDetails: () => void;
  onMonthDetails: () => void;
  onInfo: () => void;
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
}: SummaryProps) {
  const p = useColors();
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
      <LinearGradient colors={p.heroGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.surface}>
        <BrandClouds ink={ink} />
        <View style={styles.heading}>
          <Text style={[styles.label, { color: ink }]}>Чистая прибыль</Text>
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
}: {
  errorMessage?: string;
  retrying: boolean;
  onRetry: () => unknown;
}) {
  const p = useColors();
  const ink = p.mode === 'dark' ? p.text.primary : p.text.inverse;
  return (
    <View style={styles.card} testID="owner-home-summary-placeholder">
      <LinearGradient
        colors={p.heroGradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.surface, styles.placeholder]}
      >
        <BrandClouds ink={ink} />
        <Text style={[styles.label, { color: ink }]}>Чистая прибыль</Text>
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

function BrandClouds({ ink }: { ink: string }) {
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={styles.brand}
    >
      {[styles.cloudUpper, styles.cloudLower].map((position, index) => (
        <View key={index} style={[styles.cloudClip, position]}>
          <Image
            source={require('../../../../assets/logo.png')}
            resizeMode="stretch"
            accessible={false}
            style={[styles.cloudImage, { tintColor: ink }]}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, overflow: 'hidden' },
  surface: { minHeight: 244, paddingHorizontal: 20, paddingTop: 4, paddingBottom: 18 },
  brand: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, overflow: 'hidden' },
  // The existing logo is 1501 × 361. Clip at x=600, before the wordmark starts at x≈630.
  // Tinting its alpha preserves the original cloud contour without introducing another asset.
  cloudClip: { position: 'absolute', width: 120, height: 72.2, overflow: 'hidden' },
  cloudImage: { position: 'absolute', left: 0, top: 0, width: 300.2, height: 72.2 },
  cloudUpper: { top: 22, right: 23, opacity: 0.055, transform: [{ rotate: '-12deg' }] },
  cloudLower: { bottom: 33, right: -40, opacity: 0.045, transform: [{ rotate: '-12deg' }] },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  label: { flex: 1, fontSize: 14, lineHeight: 20, fontWeight: '500' },
  info: { width: touchSize, minHeight: touchSize, alignItems: 'center', justifyContent: 'center', marginRight: -10 },
  period: { minHeight: touchSize, gap: 5 },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  profit: {
    flex: 1,
    minWidth: 0,
    fontSize: 34,
    lineHeight: 42,
    fontWeight: '600',
    letterSpacing: -0.6,
    fontVariant: ['tabular-nums'],
  },
  turnover: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 7, rowGap: 2 },
  secondaryLabel: { fontSize: 13, lineHeight: 19, opacity: 0.84 },
  turnoverValue: { fontSize: 16, lineHeight: 22, fontWeight: '500', fontVariant: ['tabular-nums'] },
  divider: { height: StyleSheet.hairlineWidth, opacity: 0.2, marginTop: 14, marginBottom: 12 },
  month: { minHeight: touchSize, gap: 3 },
  monthProfit: { flex: 1, minWidth: 0, fontSize: 20, lineHeight: 27, fontWeight: '600', fontVariant: ['tabular-nums'] },
  comparisonRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  comparison: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 19 },
  change: { fontWeight: '600', fontVariant: ['tabular-nums'] },
  placeholder: { paddingTop: 18 },
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
