import React, { useEffect, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { CommonActions, type NavigationProp, useNavigation } from '@react-navigation/native';
import Ionicons from '../../../components/icons/IoniconsShim';
import { useColors, useThemeMode } from '../../../contexts/ThemeContext';
import { useAuth } from '../../../contexts/AuthContext';
import { usePointAccess } from '../../../hooks/usePoints';
import type { TabParamList } from '../../../navigation/AppNavigator';
import type { OwnerHomeTimelinePeriod } from '../../../../../shared/types/ownerHome';

const target = Platform.OS === 'android' ? 48 : 44;
export function OwnerHomeToolbar({
  calendarEnabled,
  onCalendar,
  onSettings,
  reducedMotion,
}: {
  calendarEnabled: boolean;
  onCalendar: () => void;
  onSettings: () => void;
  reducedMotion: boolean;
}) {
  const p = useColors(),
    { mode, toggle } = useThemeMode();
  const { user, hasPermission } = useAuth();
  const { currentPoint, currentPointId, multiPoint } = usePointAccess();
  const navigation = useNavigation<NavigationProp<TabParamList>>();
  const name = currentPoint?.name || (!currentPointId ? user?.tenant?.name : undefined) || 'Автосервис';
  const themeProgress = useSharedValue(1);
  useEffect(() => {
    cancelAnimation(themeProgress);
    themeProgress.value = reducedMotion ? 1 : 0;
    if (!reducedMotion)
      themeProgress.value = withTiming(1, {
        duration: 180,
        easing: Easing.out(Easing.cubic),
        reduceMotion: ReduceMotion.System,
      });
    return () => cancelAnimation(themeProgress);
  }, [mode, reducedMotion, themeProgress]);
  const themeStyle = useAnimatedStyle(() => ({
    opacity: themeProgress.value,
    transform: [{ rotate: `${(1 - themeProgress.value) * -35}deg` }],
  }));
  const choices = [
    ...(multiPoint ? [{ text: 'Филиалы', screen: 'Points' }] : []),
    ...(hasPermission('company_manage') ? [{ text: 'Настройки компании', screen: 'CompanySettings' }] : []),
  ];
  const companyMenu = () => {
    const open = (index: number) => {
      const choice = choices[index];
      if (choice)
        navigation.dispatch(
          CommonActions.navigate({ name: 'MoreTab', params: { screen: choice.screen, initial: false } }),
        );
    };
    if (Platform.OS === 'ios')
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: name,
          options: [...choices.map((choice) => choice.text), 'Отмена'],
          cancelButtonIndex: choices.length,
          userInterfaceStyle: mode,
        },
        open,
      );
    else
      Alert.alert(name, undefined, [
        ...choices.map((choice, index) => ({ text: choice.text, onPress: () => open(index) })),
        { text: 'Отмена', style: 'cancel' },
      ]);
  };
  return (
    <View style={styles.toolbar}>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`Автосервис: ${name}. Действия с компанией`}
        disabled={!choices.length}
        style={styles.company}
        onPress={companyMenu}
      >
        <Text style={[styles.companyName, { color: p.text.primary }]} numberOfLines={2}>
          {name}
        </Text>
        {choices.length > 0 && <Ionicons name="chevron-down" size={13} color={p.text.secondary} />}
      </TouchableOpacity>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Выбрать дату и период"
        disabled={!calendarEnabled}
        style={[styles.tool, { backgroundColor: p.bg.card, opacity: calendarEnabled ? 1 : 0.45 }]}
        onPress={onCalendar}
      >
        <Ionicons name="calendar-outline" size={22} color={p.text.primary} />
      </TouchableOpacity>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={mode === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
        style={[styles.tool, { backgroundColor: p.bg.card }]}
        onPress={toggle}
      >
        <Animated.View style={themeStyle}>
          <Ionicons name={mode === 'dark' ? 'sun-outline' : 'moon-outline'} size={23} color={p.text.primary} />
        </Animated.View>
      </TouchableOpacity>
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Настроить главную"
        style={[styles.tool, { backgroundColor: p.bg.card }]}
        onPress={onSettings}
      >
        <Ionicons name="options-outline" size={22} color={p.text.primary} />
      </TouchableOpacity>
    </View>
  );
}

export function OwnerHomePeriodControl({
  value,
  onChange,
  dayIsToday,
  reducedMotion,
}: {
  value: OwnerHomeTimelinePeriod;
  onChange: (period: OwnerHomeTimelinePeriod) => void;
  dayIsToday: boolean;
  reducedMotion: boolean;
}) {
  const p = useColors(),
    { fontScale } = useWindowDimensions();
  const [width, setWidth] = useState(0);
  const periods: { id: OwnerHomeTimelinePeriod; label: string }[] = [
    { id: 'day', label: dayIsToday ? 'Сегодня' : 'День' },
    { id: 'week', label: 'Неделя' },
    { id: 'month', label: 'Месяц' },
    { id: 'year', label: 'Год' },
  ];
  const columns = fontScale > 2 ? 1 : fontScale > 1.2 ? 2 : 4;
  const height = Math.max(target, Math.ceil(18 * fontScale + 12));
  const index = periods.findIndex((period) => period.id === value);
  const x = useSharedValue(0),
    y = useSharedValue(0);
  useEffect(() => {
    cancelAnimation(x);
    cancelAnimation(y);
    const nextX = ((index % columns) * width) / columns,
      nextY = Math.floor(index / columns) * height;
    const config = { duration: 200, easing: Easing.out(Easing.cubic), reduceMotion: ReduceMotion.System };
    x.value = reducedMotion ? nextX : withTiming(nextX, config);
    y.value = reducedMotion ? nextY : withTiming(nextY, config);
    return () => {
      cancelAnimation(x);
      cancelAnimation(y);
    };
  }, [x, y, index, width, columns, height, reducedMotion]);
  const indicator = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }] }));
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="Период отчёта"
      style={[styles.periods, { backgroundColor: p.bg.muted }]}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      <Animated.View
        pointerEvents="none"
        style={[
          styles.periodIndicator,
          { backgroundColor: p.bg.card, width: Math.max(0, width / columns - 6), height: height - 6 },
          indicator,
        ]}
      />
      {periods.map((period) => (
        <TouchableOpacity
          key={period.id}
          accessibilityRole="radio"
          accessibilityLabel={period.label}
          accessibilityState={{ checked: value === period.id }}
          onPress={() => onChange(period.id)}
          style={[styles.periodButton, { width: `${100 / columns}%`, minHeight: height }]}
        >
          <Text
            style={{
              color: value === period.id ? p.text.primary : p.text.secondary,
              fontWeight: value === period.id ? '600' : '400',
              fontSize: 13,
              lineHeight: 18,
            }}
          >
            {period.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: target, marginBottom: 10 },
  company: {
    flex: 1,
    minWidth: 0,
    minHeight: target,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingRight: 4,
  },
  companyName: { fontSize: 14, lineHeight: 20, fontWeight: '600', flexShrink: 1 },
  tool: { width: target, height: target, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  periods: { flexDirection: 'row', flexWrap: 'wrap', borderRadius: 13, marginBottom: 12, position: 'relative' },
  periodButton: { justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8 },
  periodIndicator: { position: 'absolute', left: 3, top: 3, borderRadius: 10 },
});
