import React, { forwardRef, useContext, type ForwardedRef, type RefAttributes, type ReactElement } from 'react';
import { ScrollView, FlatList, StyleSheet, type ScrollViewProps, type FlatListProps } from 'react-native';
import { FlashList, type FlashListProps, type FlashListRef } from '@shopify/flash-list';
import { BottomTabBarHeightContext } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { floatingTabBarHeight, reservedScrollBottom } from '../utils/tabBarGeometry';

type Reservation = { reserveBottomNavigation?: boolean };
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
function useReservedProps(props: ScrollReservationProps & Reservation): ScrollReservationProps {
  const height = useBottomNavigationReservation();
  const { reserveBottomNavigation = true } = props;
  if (!height || !reserveBottomNavigation || props.horizontal) return {};
  const container = StyleSheet.flatten(props.contentContainerStyle) ?? {};
  const declaredBottom = container.paddingBottom ?? container.paddingVertical ?? container.padding;
  const bottom = reservedScrollBottom(
    typeof declaredBottom === 'number' ? declaredBottom : 0,
    props.contentInset?.bottom ?? 0,
    height,
  );
  return {
    contentContainerStyle: [props.contentContainerStyle, { paddingBottom: bottom }],
    // Reserve space in the content itself on both OSes; never add a second iOS-only bottom inset.
    contentInset: { ...props.contentInset, bottom: 0 },
    scrollIndicatorInsets: {
      ...props.scrollIndicatorInsets,
      bottom: Math.max(props.scrollIndicatorInsets?.bottom ?? 0, height),
    },
  };
}
export type TabBarScrollView = ScrollView;
export const TabBarScrollView = forwardRef<ScrollView, ScrollViewProps & Reservation>((props, ref) => {
  const reserved = useReservedProps(props);
  const { reserveBottomNavigation: _reserve, ...rest } = props;
  return <ScrollView {...rest} {...reserved} ref={ref} />;
});
TabBarScrollView.displayName = 'TabBarScrollView';
export type TabBarFlatList<T> = FlatList<T>;
export const TabBarFlatList = forwardRef(function TabBarFlatList<T>(
  props: FlatListProps<T> & Reservation,
  ref: ForwardedRef<FlatList<T>>,
) {
  const reserved = useReservedProps(props);
  const { reserveBottomNavigation: _reserve, ...rest } = props;
  return <FlatList {...rest} {...reserved} ref={ref} />;
}) as <T>(props: FlatListProps<T> & Reservation & RefAttributes<FlatList<T>>) => ReactElement;
export function TabBarFlashList<T>(props: FlashListProps<T> & Reservation & { ref?: React.Ref<FlashListRef<T>> }) {
  const reserved = useReservedProps(props);
  const { reserveBottomNavigation: _reserve, ...rest } = props;
  return (
    <FlashList
      {...rest}
      {...reserved}
      contentContainerStyle={StyleSheet.flatten(reserved.contentContainerStyle ?? props.contentContainerStyle)}
    />
  );
}
