import React from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { capturePlatformSession, assertPlatformSession } from './platformSession';
export function usePlatformSession() {
  const { user, token } = useAuth();
  const session = React.useMemo(() => capturePlatformSession(), [user, token]);
  const allowed = (user?.role === 'manager' || user?.role === 'superadmin') && session.isCurrent();
  return { session, allowed, role: user?.role };
}
export function usePlatformReminders() {
  const { session, allowed } = usePlatformSession();
  const query = useQuery({
    queryKey: ['manager', 'reminders', session.data.key, session.data.generation],
    enabled: allowed,
    queryFn: async () => {
      assertPlatformSession(session, allowed);
      const response = await session.manager.reminders();
      assertPlatformSession(session, allowed);
      return response.data;
    },
  });
  useFocusEffect(
    React.useCallback(() => {
      if (allowed) void query.refetch();
    }, [allowed, query.refetch]),
  );
  React.useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && allowed && session.isCurrent()) void query.refetch();
    });
    return () => subscription.remove();
  }, [allowed, query.refetch, session]);
  return query;
}
