import React, { forwardRef } from 'react';
import Animated from 'react-native-reanimated';
import type { FlashListProps, FlashListRef } from '@shopify/flash-list';
import type { Service } from '../../../../shared/types';
import { TabBarFlashList } from '../../components/TabBarScrollable';

const ScrollList = forwardRef<FlashListRef<Service>, FlashListProps<Service>>(function ServicesScrollList(props, ref) {
  return <TabBarFlashList {...props} ref={ref} />;
});
export const ServicesList = Animated.createAnimatedComponent(ScrollList);
export { useJournalHeaderScroll as useServicesScroll } from '../journal/JournalHeader';
