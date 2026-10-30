import React from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import type { OwnerHomeTimelinePeriod } from '../../../../../shared/types/ownerHome';
import Ionicons from '../../../components/icons/IoniconsShim';
import { useColors } from '../../../contexts/ThemeContext';
import { ownerPeriodLabels, ownerPeriodNavigation } from './ownerHomePeriodNavigation';

const target = Platform.OS === 'android' ? 48 : 44;

export default function OwnerHomeDateNavigation({
  period,
  selectedDate,
  todayDate,
  enabled,
  onPrevious,
  onNext,
  onToday,
  onCalendar,
}: {
  period: OwnerHomeTimelinePeriod;
  selectedDate?: string;
  todayDate?: string;
  enabled: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onToday: () => void;
  onCalendar: () => void;
}) {
  const p = useColors();
  const { width, fontScale } = useWindowDimensions();
  const navigation = ownerPeriodNavigation(period, selectedDate, todayDate);
  const labels = ownerPeriodLabels[period];
  const ready = enabled && !!navigation;
  const previousEnabled = ready && !!navigation.previousDate;
  const nextEnabled = ready && !!navigation.nextDate;
  const stackReturn = width < 360 || fontScale > 1.2;
  const currentButton = navigation?.canReturnToToday ? (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={labels.reset}
      accessibilityState={{ disabled: !ready }}
      disabled={!ready}
      onPress={ready ? onToday : undefined}
      activeOpacity={0.65}
      style={[styles.current, { opacity: ready ? 1 : 0.4 }]}
    >
      <Text style={[styles.currentText, { color: p.accent.primaryText }]}>Сегодня</Text>
    </TouchableOpacity>
  ) : null;
  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={labels.previous}
          accessibilityState={{ disabled: !previousEnabled }}
          disabled={!previousEnabled}
          onPress={previousEnabled ? onPrevious : undefined}
          activeOpacity={0.65}
          style={[styles.arrow, { opacity: previousEnabled ? 1 : 0.3 }]}
        >
          <Ionicons name="chevron-back" size={21} color={p.accent.primaryText} />
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`${navigation?.rangeLabel ?? labels.current}. Выбрать дату`}
          accessibilityState={{ disabled: !ready }}
          disabled={!ready}
          onPress={ready ? onCalendar : undefined}
          activeOpacity={0.65}
          style={styles.date}
        >
          <Text style={[styles.dateText, { color: p.text.primary }]}>{navigation?.label ?? labels.current}</Text>
          <Ionicons name="chevron-down" size={12} color={p.text.secondary} />
        </TouchableOpacity>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={labels.next}
          accessibilityState={{ disabled: !nextEnabled }}
          disabled={!nextEnabled}
          onPress={nextEnabled ? onNext : undefined}
          activeOpacity={0.65}
          style={[styles.arrow, { opacity: nextEnabled ? 1 : 0.3 }]}
        >
          <Ionicons name="chevron-forward" size={21} color={p.accent.primaryText} />
        </TouchableOpacity>
        {!stackReturn && currentButton}
      </View>
      {stackReturn && currentButton ? <View style={styles.returnRow}>{currentButton}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: -6, marginBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  arrow: { width: target, height: target, alignItems: 'center', justifyContent: 'center' },
  date: {
    flex: 1,
    minWidth: 0,
    minHeight: target,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
  },
  dateText: { fontSize: 13, lineHeight: 18, fontWeight: '500', textAlign: 'center', flexShrink: 1 },
  current: {
    minWidth: target,
    minHeight: target,
    paddingHorizontal: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  currentText: { fontSize: 12, lineHeight: 17, fontWeight: '500' },
  returnRow: { alignItems: 'center' },
});
