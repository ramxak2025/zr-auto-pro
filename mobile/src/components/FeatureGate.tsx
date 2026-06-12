import React from 'react';
import { View, StyleSheet, Linking, Pressable, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { subscriptionApi } from '../api/services';
import { Text } from '../platform/Typography';
import { haptic } from '../platform/haptics';
import { useColors } from '../contexts/ThemeContext';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { featureLabel } from '../../../shared/constants/features';
import type { SubscriptionInfo, Plan } from '../../../shared/types';

interface FeatureGateProps {
  featureKey: string;
  title: string;
  description: string;
  benefits: string[];
  children: React.ReactNode;
}

/**
 * Find the cheapest ACTIVE plan whose feature set includes `featureKey`. This is
 * the plan we tell the owner to upgrade to. Returns null if no plan unlocks it
 * (then we fall back to the generic copy).
 */
function cheapestUnlockingPlan(plans: Plan[] | undefined, featureKey: string): Plan | null {
  if (!Array.isArray(plans)) return null;
  const candidates = plans
    .filter((p) => p.isActive && Array.isArray(p.features) && p.features.includes(featureKey))
    .sort((a, b) => a.monthlyPrice - b.monthlyPrice);
  return candidates[0] ?? null;
}

/**
 * Wraps a screen and shows a premium paywall if the feature is not included in
 * the tenant's current plan.
 *
 * Access is resolved via `sub.features.includes(featureKey)` — the authoritative
 * server-resolved feature list keyed on the tenant's planId — NOT the old
 * fragile match by plan NAME. The locked card NAMES the unlocking tariff and
 * its price, with a primary CTA into the in-app Subscription screen.
 */
export default function FeatureGate({ featureKey, title, description, benefits, children }: FeatureGateProps) {
  const { user } = useAuth();
  const navigation = useNavigation<any>();
  const palette = useColors();

  const { data: sub } = useQuery<SubscriptionInfo>({
    queryKey: ['subscription'],
    queryFn: async () => (await subscriptionApi.get()).data,
    staleTime: 5 * 60 * 1000,
  });

  // Superadmin bypasses every gate.
  if (user?.role === 'superadmin') {
    return <>{children}</>;
  }

  // Optimistic while loading — never flash a paywall before we know the plan.
  if (!sub) return <>{children}</>;

  // Gate on the server-resolved feature list (authoritative, by planId).
  if (Array.isArray(sub.features) && sub.features.includes(featureKey)) {
    return <>{children}</>;
  }

  const unlockingPlan = cheapestUnlockingPlan(sub.plans, featureKey);
  // Highlights for the named plan: its gated features as human labels (excludes
  // always-on keys like check_photos that aren't paywalls). Cap at 5.
  const planHighlights: string[] = unlockingPlan
    ? unlockingPlan.features.map((k) => featureLabel(k)).slice(0, 6)
    : benefits;

  const openWhatsApp = () => {
    haptic('tap');
    const msg = encodeURIComponent(`Здравствуйте! Хочу подключить функцию «${title}».`);
    Linking.openURL(`https://wa.me/79884444436?text=${msg}`).catch(() => {});
  };

  const goToSubscription = () => {
    haptic('tap');
    // Subscription screen lives inside MoreStack; gated screens are reached via
    // MoreStack so a sibling navigate resolves correctly.
    navigation.navigate('Subscription');
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.bg.canvas }]} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={10}
          style={[styles.backBtn, { backgroundColor: palette.bg.muted }]}
        >
          <Ionicons name="chevron-back" size={20} color={palette.text.primary} />
        </Pressable>
        <Text style={[styles.headerTitle, { color: palette.text.primary }]}>{title}</Text>
        <View style={{ width: 36 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Hero lock */}
        <LinearGradient
          colors={[palette.accent.primary, colors.primary[700]] as [string, string]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.heroCard}
        >
          <View style={styles.lockRing}>
            <Ionicons name="lock-closed" size={30} color={colors.white} />
          </View>
          <Text style={styles.heroTitle}>{title}</Text>
          {unlockingPlan ? (
            <>
              <Text style={styles.heroPlan}>Доступно на тарифе «{unlockingPlan.name}»</Text>
              <View style={styles.priceRow}>
                <Text style={styles.priceValue}>{unlockingPlan.monthlyPrice.toLocaleString('ru-RU')}</Text>
                <Text style={styles.priceSuffix}> ₽/мес</Text>
              </View>
            </>
          ) : (
            <Text style={styles.heroPlan}>Недоступно в вашем тарифе</Text>
          )}
        </LinearGradient>

        <Text style={[styles.description, { color: palette.text.secondary }]}>{description}</Text>

        {/* What the plan unlocks */}
        <View style={[styles.benefitsCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
          <Text style={[styles.benefitsTitle, { color: palette.text.primary }]}>
            {unlockingPlan ? `Тариф «${unlockingPlan.name}» включает` : 'Что вы получите'}
          </Text>
          {planHighlights.map((b, i) => (
            <View key={i} style={styles.benefitRow}>
              <Ionicons name="checkmark" size={20} color={colors.green[500]} />
              <Text style={[styles.benefitText, { color: palette.text.secondary }]}>{b}</Text>
            </View>
          ))}
        </View>

        {/* Primary CTA → in-app subscription screen. */}
        <Pressable style={[styles.primaryBtn, { backgroundColor: palette.accent.primary }]} onPress={goToSubscription}>
          <Ionicons name="rocket-outline" size={18} color={colors.white} />
          <Text style={styles.primaryBtnText}>
            {unlockingPlan ? `Перейти на «${unlockingPlan.name}»` : 'Выбрать тариф'}
          </Text>
        </Pressable>

        {/* WhatsApp — secondary fallback. */}
        <Pressable style={styles.secondaryBtn} onPress={openWhatsApp}>
          <Ionicons name="logo-whatsapp" size={18} color={palette.text.secondary} />
          <Text style={[styles.secondaryBtnText, { color: palette.text.secondary }]}>Написать в поддержку</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
  },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '600', letterSpacing: -0.4 },
  scroll: { paddingHorizontal: spacing[5], paddingBottom: spacing[10], gap: spacing[4] },
  heroCard: {
    borderRadius: borderRadius['3xl'],
    padding: spacing[6],
    alignItems: 'center',
    marginTop: spacing[2],
    shadowColor: colors.primary[700],
    shadowOpacity: 0.25,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  lockRing: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[3],
  },
  heroTitle: { fontSize: fontSize['2xl'], fontWeight: fontWeight.bold, color: colors.white, textAlign: 'center' },
  heroPlan: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: 'rgba(255,255,255,0.92)',
    marginTop: spacing[2],
    textAlign: 'center',
  },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', marginTop: spacing[1] },
  priceValue: { fontSize: 30, fontWeight: '800', color: colors.white, letterSpacing: -1 },
  priceSuffix: { fontSize: fontSize.base, color: 'rgba(255,255,255,0.85)' },
  description: { fontSize: fontSize.sm, textAlign: 'center', lineHeight: 21 },
  benefitsCard: {
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    padding: spacing[5],
    gap: spacing[1],
  },
  benefitsTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, marginBottom: spacing[2] },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2.5], paddingVertical: spacing[1.5] },
  benefitText: { fontSize: fontSize.sm, flex: 1 },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[4],
    borderRadius: borderRadius['2xl'],
  },
  primaryBtnText: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.white },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[2],
  },
  secondaryBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },
});
