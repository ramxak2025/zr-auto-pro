import { useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect, useIsFocused } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { invalidateAttendanceQueries } from '../../../shared/utils/attendanceQueries';

/** An opening from another device must reach the visible schedule without a manual refresh. */
export function useAttendanceRefresh(): void {
  const queryClient = useQueryClient();
  const isFocused = useIsFocused();
  const refresh = useCallback(() => {
    if (AppState.currentState === 'active') void invalidateAttendanceQueries(queryClient);
  }, [queryClient]);
  useFocusEffect(refresh);
  useEffect(() => {
    if (!isFocused) return;
    const timer = setInterval(refresh, 60_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [isFocused, refresh]);
}
