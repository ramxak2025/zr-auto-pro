import React, { forwardRef, type ForwardedRef, type ReactElement, type RefAttributes } from 'react';
import type { FlatList, FlatListProps } from 'react-native';
import type { FlashListProps, FlashListRef } from '@shopify/flash-list';
import Animated, { type AnimatedProps } from 'react-native-reanimated';
import { TabBarFlatList, TabBarFlashList, TabBarScrollView, type ScrollReservation } from './TabBarScrollable';

/** Module-level types keep native scrollers and row identities stable across renders. */
export const ScreenSectionScrollView = Animated.createAnimatedComponent(TabBarScrollView);
export const ScreenSectionFlatList = Animated.createAnimatedComponent(TabBarFlatList) as <T>(
  props: AnimatedProps<FlatListProps<T> & ScrollReservation> & RefAttributes<FlatList<T>>,
) => ReactElement;

const FlashListAdapter = forwardRef(function SectionFlashList<T>(
  props: FlashListProps<T> & ScrollReservation,
  ref: ForwardedRef<FlashListRef<T>>,
) {
  return <TabBarFlashList {...props} ref={ref} />;
}) as <T>(props: FlashListProps<T> & ScrollReservation & RefAttributes<FlashListRef<T>>) => ReactElement;

export const ScreenSectionFlashList = Animated.createAnimatedComponent(FlashListAdapter) as <T>(
  props: AnimatedProps<FlashListProps<T> & ScrollReservation> & RefAttributes<FlashListRef<T>>,
) => ReactElement;
