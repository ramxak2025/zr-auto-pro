import React, { forwardRef, useContext, type ForwardedRef, type RefAttributes, type ReactElement } from 'react';
import { ScrollView, FlatList, StyleSheet, type ScrollViewProps, type FlatListProps } from 'react-native';
import { FlashList, type FlashListProps, type FlashListRef } from '@shopify/flash-list';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { floatingTabBarHeight, reservedScrollBottom } from '../utils/tabBarGeometry';

export type ScrollReservation = {
  reserveBottomNavigation?: boolean;
  /** Opt-in only when the containing screen no longer owns a bottom SafeArea frame. */
  reserveSafeAreaBottom?: boolean;
};
/** Scope comes from navigation, not from a guessed route name. Standalone screens keep their padding. */
export function useBottomNavigationReservation(): number {
  const tabHeight = useContext(BottomTabBarHeightContext);
  const insets = useSafeAreaInsets();
  return tabHeight && tabHeight > 0 ? floatingTabBarHeight(insets.bottom) : 0;
}
type ScrollReservationProps = Pick<
  ScrollViewProps,
  'contentContainerStyle' | 'contentInset' | 'scrollIndicatorInsets' | 'horizontal'
>;
function useReservedProps(props: ScrollReservationProps & ScrollReservation): ScrollReservationProps {
  const height = useBottomNavigationReservation();
  const insets = useSafeAreaInsets();
  const { reserveBottomNavigation = true, reserveSafeAreaBottom = false } = props;
  const reservation = Math.max(reserveBottomNavigation ? height : 0, reserveSafeAreaBottom ? insets.bottom : 0);
  if (!reservation || props.horizontal) return {};
  const container = StyleSheet.flatten(props.contentContainerStyle) ?? {};
  const declaredBottom = container.paddingBottom ?? container.paddingVertical ?? container.padding;
  const declaredPadding = typeof declaredBottom === 'number' ? declaredBottom : 0;
  const declaredInset = props.contentInset?.bottom ?? 0;
  const bottom = Math.max(
    reserveBottomNavigation && height > 0
      ? reservedScrollBottom(declaredPadding, declaredInset, height)
      : Math.max(declaredPadding, declaredInset),
    reserveSafeAreaBottom ? insets.bottom : 0,
  );
  return {
    contentContainerStyle: [props.contentContainerStyle, { paddingBottom: bottom }],
    // Reserve space in the content itself on both OSes; never add a second iOS-only bottom inset.
    contentInset: { ...props.contentInset, bottom: 0 },
    scrollIndicatorInsets: {
      ...props.scrollIndicatorInsets,
      bottom: Math.max(props.scrollIndicatorInsets?.bottom ?? 0, reservation),
    },
  };
}
export type TabBarScrollView = ScrollView;
export const TabBarScrollView = forwardRef<ScrollView, ScrollViewProps & ScrollReservation>((props, ref) => {
  const reserved = useReservedProps(props);
  const { reserveBottomNavigation: _reserve, reserveSafeAreaBottom: _safe, ...rest } = props;
  return <ScrollView {...rest} {...reserved} ref={ref} />;
});
TabBarScrollView.displayName = 'TabBarScrollView';
export type TabBarFlatList<T> = FlatList<T>;
export const TabBarFlatList = forwardRef(function TabBarFlatList<T>(
  props: FlatListProps<T> & ScrollReservation,
  ref: ForwardedRef<FlatList<T>>,
) {
  const reserved = useReservedProps(props);
  const { reserveBottomNavigation: _reserve, reserveSafeAreaBottom: _safe, ...rest } = props;
  return <FlatList {...rest} {...reserved} ref={ref} />;
}) as <T>(props: FlatListProps<T> & ScrollReservation & RefAttributes<FlatList<T>>) => ReactElement;
export function TabBarFlashList<T>(
  props: FlashListProps<T> & ScrollReservation & { ref?: React.Ref<FlashListRef<T>> },
) {
  const reserved = useReservedProps(props);
  const { reserveBottomNavigation: _reserve, reserveSafeAreaBottom: _safe, ...rest } = props;
  return (
    <FlashList
      {...rest}
      {...reserved}
      contentContainerStyle={StyleSheet.flatten(reserved.contentContainerStyle ?? props.contentContainerStyle)}
    />
  );
}
