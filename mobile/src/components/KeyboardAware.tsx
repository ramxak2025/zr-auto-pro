/**
 * KeyboardAware — единая точка «поле над клавиатурой» для обеих платформ.
 *
 * ПРОБЛЕМА (Round 11 #1). На экране не было библиотеки клавиатуры и три
 * расходящихся самописных паттерна. RN-core `KeyboardAvoidingView` даёт
 * приемлемое поведение только на iOS (`behavior='padding'`), на Android с
 * ним — no-op, и `android.softwareKeyboardLayoutMode:"pan"` (adjustPan)
 * не кооперируется со скроллом. Владелец подтвердил: поле ввода прячется
 * ПОД клавиатурой и на iPhone тоже.
 *
 * РЕШЕНИЕ. `react-native-keyboard-controller` даёт ОДИНАКОВОЕ поведение на
 * iOS и Android (JSI-модуль, синхронный с реальными кадрами клавиатуры):
 *  • `KeyboardAvoidingView` — для контейнеров, где контент не скроллится
 *    (центрированный Modal, короткие формы);
 *  • `KeyboardAwareScrollView` — для форм со скроллом: сам подкручивает
 *    фокус так, чтобы активный `TextInput` ОСТАВАЛСЯ ВИДНЫМ над клавиатурой
 *    (поведение WhatsApp/Telegram).
 *
 * ВАЖНО (правило проекта): нижний плавающий tab bar. Все скроллы держат
 * `paddingBottom >= useTabBarHeight()`. Здесь мы прокидываем это в
 * `bottomOffset`/contentContainerStyle, а не хардкодим.
 */
import React from 'react';
import { RefreshControlProps, StyleProp, ViewStyle } from 'react-native';
import {
  KeyboardAvoidingView as KCAvoidingView,
  KeyboardAwareScrollView as KCAwareScrollView,
} from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTabBarHeight } from '../hooks/useTabBarHeight';

interface KeyboardAwareViewProps {
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  /**
   * Доп. отступ снизу поверх безопасной зоны (напр. высота фикс-панели
   * действий, которую нельзя перекрывать клавиатурой). По умолчанию 0.
   */
  extraOffset?: number;
}

/**
 * KeyboardAwareView — для НЕскроллящихся контейнеров (центрированный Modal,
 * bottom sheet). Поднимает весь блок над клавиатурой на обеих платформах.
 * `behavior='padding'` работает одинаково на iOS/Android под
 * keyboard-controller (в отличие от RN-core, где Android — no-op).
 */
export function KeyboardAwareView({ style, children, extraOffset = 0 }: KeyboardAwareViewProps) {
  const insets = useSafeAreaInsets();
  // Смещение, на которое поднимаемся: safe-area снизу + доп. отступ.
  // НЕ хардкод — берём из insets (правило Safe Area проекта).
  const keyboardVerticalOffset = insets.bottom + extraOffset;
  return (
    <KCAvoidingView behavior="padding" keyboardVerticalOffset={keyboardVerticalOffset} style={style}>
      {children}
    </KCAvoidingView>
  );
}

interface KeyboardAwareScrollProps {
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  children: React.ReactNode;
  /**
   * Резервируем место под плавающий tab bar по правилу проекта. Если экран
   * пушится поверх tab bar (edit-режим) — передать false и задать свой
   * paddingBottom в contentContainerStyle.
   */
  reserveTabBar?: boolean;
  /** Доп. нижний отступ фокуса — напр. высота фикс-кнопки «Сохранить». */
  extraKeyboardBottomOffset?: number;
  refreshControl?: React.ReactElement<RefreshControlProps>;
  showsVerticalScrollIndicator?: boolean;
  /** Проброс на нативный ScrollView для «липких» шапок и т.п. */
  stickyHeaderIndices?: number[];
}

/**
 * KeyboardAwareScroll — для форм со скроллом. Активный `TextInput` всегда
 * остаётся ВИДНЫМ над клавиатурой (авто-скролл к фокусу). WhatsApp-ощущение:
 * `keyboardShouldPersistTaps="handled"` (тап по кнопке не «съедается»
 * закрытием клавиатуры) + `keyboardDismissMode="interactive"` (клавиатура
 * тянется вниз вместе с жестом скролла).
 *
 * `bottomOffset` — на сколько ПОДНЯТЬ фокус над клавиатурой: высота
 * tab bar (чтобы поле не оказалось под плавающим баром) + доп. отступ.
 */
export function KeyboardAwareScroll({
  style,
  contentContainerStyle,
  children,
  reserveTabBar = true,
  extraKeyboardBottomOffset = 0,
  refreshControl,
  showsVerticalScrollIndicator = false,
  stickyHeaderIndices,
}: KeyboardAwareScrollProps) {
  const tabBarHeight = useTabBarHeight();
  // Отступ фокуса над клавиатурой: не даём активному полю уйти под
  // плавающий tab bar + запас под фикс-кнопку, если есть.
  const bottomOffset = (reserveTabBar ? tabBarHeight : 0) + extraKeyboardBottomOffset;
  return (
    <KCAwareScrollView
      style={style}
      contentContainerStyle={contentContainerStyle}
      bottomOffset={bottomOffset}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      showsVerticalScrollIndicator={showsVerticalScrollIndicator}
      refreshControl={refreshControl}
      stickyHeaderIndices={stickyHeaderIndices}
    >
      {children}
    </KCAwareScrollView>
  );
}
