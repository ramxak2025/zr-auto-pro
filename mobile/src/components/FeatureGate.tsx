import React from 'react';
import { View, Text, StyleSheet, Linking, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { subscriptionApi } from '../api/services';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import type { SubscriptionInfo } from '../../../shared/types';

interface FeatureGateProps {
  featureKey: string;
  title: string;
  description: string;
  benefits: string[];
  children: React.ReactNode;
}

/**
 * Wraps a screen and shows a beautiful paywall if the feature
 * is not included in the tenant's current plan.
 */
export default function FeatureGate({ featureKey, title, description, benefits, children }: FeatureGateProps) {
  const { user } = useAuth();
  const navigation = useNavigation<any>();

  const { data: sub } = useQuery<SubscriptionInfo>({
    queryKey: ['subscription'],
    queryFn: async () => { const res = await subscriptionApi.get(); return res.data; },
    staleTime: 5 * 60 * 1000,
  });

  // Superadmin always has access
  if (user?.role === 'superadmin') {
    return <>{children}</>;
  }

  // Check if feature is in plan
  const planFeatures: string[] = sub?.plans
    ? (() => {
        const currentPlan = sub.plans.find(p => p.name === sub.planName);
        return Array.isArray(currentPlan?.features) ? currentPlan!.features : [];
      })()
    : [];

  // If we don't have subscription data yet, show children (optimistic)
  if (!sub) return <>{children}</>;

  const hasFeature = planFeatures.includes(featureKey);
  if (hasFeature) return <>{children}</>;

  const openWhatsApp = () => {
    const msg = encodeURIComponent(`Здравствуйте! Хочу подключить функцию "${title}".`);
    Linking.openURL(`https://wa.me/79884444436?text=${msg}`);
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Text style={styles.backText}>← Назад</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{title}</Text>
        <View style={{ width: 60 }} />
      </View>

      <View style={styles.container}>
        {/* Lock icon */}
        <LinearGradient
          colors={[colors.gray[100], colors.gray[50]]}
          style={styles.lockCircle}
        >
          <Ionicons name="lock-closed" size={36} color={colors.gray[400]} />
        </LinearGradient>

        <Text style={styles.title}>{title}</Text>
        <Text style={styles.locked}>Недоступно в вашем тарифе</Text>
        <Text style={styles.description}>{description}</Text>

        {/* Benefits */}
        <View style={styles.benefitsCard}>
          <Text style={styles.benefitsTitle}>Что вы получите:</Text>
          {benefits.map((b, i) => (
            <View key={i} style={styles.benefitRow}>
              <Ionicons name="checkmark-circle" size={20} color={colors.green[500]} />
              <Text style={styles.benefitText}>{b}</Text>
            </View>
          ))}
        </View>

        {/* CTA */}
        <TouchableOpacity style={styles.upgradeBtn} onPress={openWhatsApp} activeOpacity={0.8}>
          <Ionicons name="arrow-up-circle" size={20} color={colors.white} />
          <Text style={styles.upgradeBtnText}>Улучшить тариф</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.goBackBtn}>
          <Text style={styles.goBackText}>Вернуться назад</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing[4], paddingVertical: spacing[3], backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.gray[200] },
  backText: { fontSize: fontSize.sm, color: colors.primary[600], fontWeight: fontWeight.medium },
  headerTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.gray[900] },
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing[6], paddingBottom: spacing[8] },
  lockCircle: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center', marginBottom: spacing[5] },
  title: { fontSize: fontSize['2xl'], fontWeight: fontWeight.bold, color: colors.gray[900], textAlign: 'center' },
  locked: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.red[500], marginTop: spacing[2], marginBottom: spacing[2] },
  description: { fontSize: fontSize.sm, color: colors.gray[500], textAlign: 'center', lineHeight: 20, marginBottom: spacing[5] },
  benefitsCard: { backgroundColor: colors.white, borderRadius: borderRadius['2xl'], borderWidth: 1, borderColor: colors.gray[100], padding: spacing[5], width: '100%', marginBottom: spacing[5] },
  benefitsTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[800], marginBottom: spacing[3] },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2.5], paddingVertical: spacing[1.5] },
  benefitText: { fontSize: fontSize.sm, color: colors.gray[700], flex: 1 },
  upgradeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[2], width: '100%', backgroundColor: colors.primary[600], paddingVertical: spacing[4], borderRadius: borderRadius.xl },
  upgradeBtnText: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.white },
  goBackBtn: { marginTop: spacing[3] },
  goBackText: { fontSize: fontSize.sm, color: colors.gray[400] },
});
