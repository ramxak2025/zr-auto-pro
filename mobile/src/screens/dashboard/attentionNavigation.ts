import type { NavigationProp } from '@react-navigation/native';
import type { TabParamList } from '../../navigation/AppNavigator';
import type { AttentionBucketId } from '../../../../shared/types';

export function openAttention(
  navigation: Pick<NavigationProp<TabParamList>, 'navigate'>,
  id: AttentionBucketId,
  ownId?: string,
) {
  if (id === 'bookings')
    navigation.navigate('MoreTab', { screen: 'PublicBookingRequests', params: { pendingOnly: true }, initial: false });
  else if (id === 'purchase-orders')
    navigation.navigate('MoreTab', { screen: 'PurchaseOrders', params: { status: 'ordered' }, initial: false });
  else if (id === 'installments')
    navigation.navigate('MoreTab', { screen: 'Installments', params: { status: 'overdue' }, initial: false });
  else if (id === 'low-stock')
    navigation.navigate('Products', { screen: 'ProductsHome', params: { lowStock: true }, initial: false });
  else
    navigation.navigate('Checks', {
      screen: 'ChecksHome',
      params: { deferredOnly: true, ...(ownId ? { deferredMasterId: ownId } : {}) },
      initial: false,
    });
}
