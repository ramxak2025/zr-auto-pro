import React, { forwardRef } from 'react';
import Animated from 'react-native-reanimated';
import type { FlashListProps, FlashListRef } from '@shopify/flash-list';
import type { Product } from '../../../../shared/types';
import { TabBarFlashList } from '../../components/TabBarScrollable';

// Stable local adapter: the actual FlashList and bottom-navigation reservation
// stay intact. Reanimated attaches through FlashList's getScrollableNode ref.
const ScrollList = forwardRef<FlashListRef<Product>, FlashListProps<Product>>(function WarehouseScrollList(props, ref) {
  return <TabBarFlashList {...props} ref={ref} />;
});
export const WarehouseList = Animated.createAnimatedComponent(ScrollList);
export { useJournalHeaderScroll as useWarehouseScroll } from '../journal/JournalHeader';
