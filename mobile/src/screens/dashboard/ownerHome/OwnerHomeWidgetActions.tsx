import React, { useEffect, useRef } from 'react';
import { AppState, Platform, StyleSheet, TouchableOpacity, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Ionicons from '../../../components/icons/IoniconsShim';
import { useColors, useThemeMode } from '../../../contexts/ThemeContext';

/** Home appearance controls stay available even while financial data is loading. */
export default function OwnerHomeWidgetActions({
  enabled,
  isCurrent,
  onSettings,
  reducedMotion,
}: {
  enabled: boolean;
  isCurrent: () => boolean;
  onSettings: () => void;
  reducedMotion: boolean;
}) {
  const p = useColors();
  const { mode, toggle } = useThemeMode();
  const mounted = useRef(true);
  const latest = useRef({ enabled, isCurrent, onSettings, toggle });
  latest.current = { enabled, isCurrent, onSettings, toggle };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const progress = useSharedValue(1);
  useEffect(() => {
    cancelAnimation(progress);
    progress.value = reducedMotion ? 1 : 0;
    if (!reducedMotion)
      progress.value = withTiming(1, {
        duration: 180,
        easing: Easing.out(Easing.cubic),
        reduceMotion: ReduceMotion.System,
      });
    return () => cancelAnimation(progress);
  }, [mode, reducedMotion, progress]);
  const iconStyle = useAnimatedStyle(() => ({
    opacity: 0.6 + 0.4 * progress.value,
    transform: [{ rotate: `${(1 - progress.value) * -25}deg` }],
  }));
  const press = (action: 'toggle' | 'onSettings') => {
    const current = latest.current;
    if (mounted.current && current.enabled && current.isCurrent() && AppState.currentState === 'active')
      current[action]();
  };
  const disabled = !enabled || !isCurrent();
  const ink = p.mode === 'dark' ? p.text.primary : '#FFFFFF';
  return (
    <View style={[styles.group, { opacity: disabled ? 0.45 : 1 }]} testID="owner-home-widget-actions">
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={mode === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
        accessibilityState={{ disabled }}
        disabled={disabled}
        activeOpacity={0.65}
        style={styles.action}
        onPress={() => press('toggle')}
      >
        <Animated.View style={iconStyle}>
          <Ionicons name={mode === 'dark' ? 'sun-outline' : 'moon-outline'} size={20} color={ink} />
        </Animated.View>
      </TouchableOpacity>
      <View pointerEvents="none" style={styles.separator} />
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Настроить главную"
        accessibilityState={{ disabled }}
        disabled={disabled}
        activeOpacity={0.65}
        style={styles.action}
        onPress={() => press('onSettings')}
      >
        <Ionicons name="options-outline" size={20} color={ink} />
      </TouchableOpacity>
    </View>
  );
}

const target = Platform.OS === 'android' ? 48 : 44;
const styles = StyleSheet.create({
  group: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: target / 2,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  action: { width: target, height: target, alignItems: 'center', justifyContent: 'center' },
  separator: { width: StyleSheet.hairlineWidth, height: 18, backgroundColor: 'rgba(255,255,255,0.18)' },
});
