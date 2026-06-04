import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { subscriptionApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import FeatureGate from './FeatureGate';
import type { SubscriptionInfo } from '../../../shared/types';

interface GatedScreenProps {
  featureKey: string;
  title: string;
  description: string;
  benefits: string[];
  children: React.ReactNode;
}

/**
 * Lightweight wrapper that checks plan features and renders
 * either the children or a beautiful lock screen.
 */
export default function GatedScreen({ featureKey, title, description, benefits, children }: GatedScreenProps) {
  const { user } = useAuth();

  const { data: sub } = useQuery<SubscriptionInfo>({
    queryKey: ['subscription'],
    queryFn: async () => {
      const res = await subscriptionApi.get();
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  // Only superadmin bypasses all gates
  if (user?.role === 'superadmin') {
    return <>{children}</>;
  }

  // If subscription info hasn't loaded, show optimistically
  if (!sub) return <>{children}</>;

  // Gate on the server-resolved feature list (authoritative, by planId) — no
  // fragile match by plan NAME.
  if (Array.isArray(sub.features) && sub.features.includes(featureKey)) {
    return <>{children}</>;
  }

  return (
    <FeatureGate featureKey={featureKey} title={title} description={description} benefits={benefits}>
      {children}
    </FeatureGate>
  );
}
