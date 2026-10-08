import type { NavigationAction } from '@react-navigation/native';

let requestSequence = 0;

export interface LongPressState {
  current: boolean;
}

export function createMoreTabPressHandlers(state: LongPressState, normalPress: () => void, longPress?: () => void) {
  return {
    onPressIn: () => {
      state.current = false;
    },
    onLongPress: () => {
      if (!longPress) return;
      state.current = true;
      longPress();
    },
    onPress: () => {
      if (!state.current) normalPress();
    },
  };
}

/** The More stack owns the sheet; a unique route param opens it even when that
 * stack was not mounted at the time the tab was long-pressed. */
export function openAccountPicker(
  navigation: { dispatch: (action: NavigationAction) => void },
  tabRoute = 'MoreTab',
  homeRoute = 'MoreHome',
): void {
  requestSequence += 1;
  navigation.dispatch({
    type: 'NAVIGATE',
    payload: { name: tabRoute, params: { screen: homeRoute, params: { accountPickerRequest: requestSequence } } },
  });
}
