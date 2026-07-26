import * as React from 'react';
import { Platform, Pressable, View, ViewStyle, StyleProp } from 'react-native';
import { requireNativeViewManager } from 'expo-modules-core';

/**
 * AutexaKassaButton — premium native iOS central tab CTA.
 *
 * On iOS this resolves to the Swift AutexaKassaButtonView (see
 * mobile/modules/autexa-liquid-glass/ios/AutexaKassaButtonView.swift)
 * which renders UIVisualEffectView + UIVibrancyEffect + SF Symbol with
 * native spring + haptics. The button has NO label per product spec.
 *
 * On Android (and as a defensive fallback if the native module isn't
 * registered for any reason — e.g. dev playground or unrelated build
 * failure) we render a simple translucent surface so the bar isn't
 * blank.
 */

interface AutexaKassaButtonNativeProps {
  symbolName: string;
  focused: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}

interface AutexaKassaButtonProps {
  /** SF Symbol name on iOS. Default 'doc.text.fill'. */
  symbolName?: string;
  focused?: boolean;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

// ВАЖНО: событие на границе с нативом называется onKassaPress, а НЕ onPress.
// RN резервирует `topPress` (то есть проп `onPress`) как ВСПЛЫВАЮЩЕЕ событие
// любого View, а Expo регистрирует события модуля как ПРЯМЫЕ. Совпадение имён
// даёт invariant «Event cannot be both direct and bubbling: topPress» и белый
// экран на первом же рендере кнопки. Проверка живёт под `__DEV__`
// (ReactNativeViewConfigRegistry), поэтому релизные сборки не падали, а любая
// дев-сборка умирала сразу после логина. Не переименовывать обратно.
let NativeKassaView: React.ComponentType<{
  symbolName?: string;
  focused?: boolean;
  onKassaPress?: (e: { nativeEvent: Record<string, never> }) => void;
  style?: StyleProp<ViewStyle>;
}> | null = null;
try {
  NativeKassaView = requireNativeViewManager('AutexaKassaButton');
} catch {
  NativeKassaView = null;
}

export function AutexaKassaButton({
  symbolName = 'doc.text.fill',
  focused = false,
  onPress,
  style,
}: AutexaKassaButtonProps) {
  if (Platform.OS === 'ios' && NativeKassaView) {
    return <NativeKassaView symbolName={symbolName} focused={focused} onKassaPress={() => onPress?.()} style={style} />;
  }
  // JS fallback — Android or missing native module. Cheap-but-not-broken.
  return (
    <Pressable onPress={onPress} style={style}>
      <View
        style={{
          flex: 1,
          backgroundColor: 'rgba(37, 99, 235, 0.10)',
          borderRadius: 16,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      />
    </Pressable>
  );
}
