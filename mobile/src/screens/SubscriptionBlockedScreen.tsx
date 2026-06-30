/**
 * SubscriptionBlockedScreen — the HARD subscription gate (102).
 *
 * Rendered by <SubscriptionGate> (AppNavigator) IN PLACE of the entire
 * car-service tab tree when the tenant's authoritative `status` is
 * 'expired' or 'suspended'. Every employee of that tenant — director, admin,
 * master — hits this full-screen block; there is NO app access until the
 * status resolves back to 'active' (a superadmin продлевает/возобновляет, then
 * the tenant pulls-to-refresh / re-checks here).
 *
 * Tone: professional, serious, Autexa-branded — never «по-детски». No upgrade
 * CTA that violates App Store Guideline 3.1.1; the path to resolution is a
 * support contact (info@autexa.pw) plus a re-check.
 *
 *   • expired   → tells the owner the subscription lapsed, names the plan +
 *                 price to renew, points to support for payment.
 *   • suspended → tells the user работа временно недоступна, points to support.
 *
 * Self-contained: reads the warm ['subscription'] cache (no new fetch on the
 * happy path), logs out via AuthContext, opens mail / re-checks on demand. It
 * deliberately takes NO navigation prop — it lives outside any navigator.
 */
import React from 'react';
import { View, StyleSheet, ScrollView, Pressable, Linking, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { subscriptionApi } from '../api/services';
import { Text } from '../platform/Typography';
import { haptic } from '../platform/haptics';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import { useIosSurface } from '../platform/iosSurface';
import { colors, spacing, borderRadius, softTint } from '../theme';
import type { SubscriptionInfo, SubscriptionStatus } from '../../../shared/types';

const SUPPORT_EMAIL = 'info@autexa.pw';

export default function SubscriptionBlockedScreen() {
  const palette = useColors();
  const surface = useIosSurface();
  const queryClient = useQueryClient();
  const { logout } = useAuth();
  const [refreshing, setRefreshing] = React.useState(false);

  // Warm cache — populated by the gate that mounted us. No spinner on mount.
  const { data: sub } = useQuery<SubscriptionInfo>({
    queryKey: ['subscription'],
    queryFn: async () => (await subscriptionApi.get()).data,
    staleTime: 60 * 1000,
  });

  const status: SubscriptionStatus = sub?.status === 'suspended' ? 'suspended' : 'expired';
  const suspended = status === 'suspended';
  const planName = sub?.planName?.trim() || sub?.plans?.find((p) => p.id === sub?.planId)?.name || 'ваш тариф';
  const planPrice = sub?.planPrice ?? sub?.monthlyPrice ?? 0;

  const onRecheck = React.useCallback(async () => {
    haptic('tap');
    setRefreshing(true);
    try {
      await queryClient.invalidateQueries({ queryKey: ['subscription'] });
      await queryClient.refetchQueries({ queryKey: ['subscription'] });
    } finally {
      setRefreshing(false);
    }
  }, [queryClient]);

  const onEmail = React.useCallback(() => {
    haptic('tap');
    Linking.openURL(`mailto:${SUPPORT_EMAIL}`).catch(() => {});
  }, []);

  const onLogout = React.useCallback(() => {
    haptic('tap');
    logout();
  }, [logout]);

  const accent = suspended ? colors.amber[600] : colors.red[600];
  const accentSoft = palette.mode === 'dark' ? softTint(accent, 'dark') : suspended ? colors.amber[50] : colors.red[50];

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.bg.canvas }]} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false} bounces={false}>
        {/* Brand line */}
        <Text style={[styles.brand, { color: palette.text.tertiary }]}>AUTEXA</Text>

        {/* Status emblem */}
        <View style={[styles.emblem, { backgroundColor: accentSoft }]}>
          <Ionicons name={suspended ? 'pause-circle' : 'time'} size={40} color={accent} />
        </View>

        <Text style={[styles.title, { color: palette.text.primary }]}>
          {suspended ? 'Подписка приостановлена' : 'Срок действия подписки истёк'}
        </Text>

        <Text style={[styles.body, { color: palette.text.secondary }]}>
          {suspended
            ? 'Работа в приложении временно недоступна. Для возобновления свяжитесь с нами.'
            : 'К сожалению, действие вашей подписки на Autexa завершилось. Чтобы продолжить работу, продлите тариф ниже. До оплаты доступ к разделам ограничен.'}
        </Text>

        {/* Plan / price callout — only meaningful for an expired subscription. */}
        {!suspended ? (
          <View style={[styles.planCard, surface.card]}>
            <View style={[styles.planIcon, { backgroundColor: palette.accent.primarySoft }]}>
              <Ionicons name="pricetags" size={20} color={palette.accent.primaryText} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.planLabel, { color: palette.text.tertiary }]}>Тариф для продления</Text>
              <Text style={[styles.planName, { color: palette.text.primary }]} numberOfLines={1}>
                {planName}
              </Text>
            </View>
            <View style={styles.priceWrap}>
              <Text style={[styles.priceValue, { color: palette.text.primary }]}>
                {planPrice.toLocaleString('ru-RU')}
              </Text>
              <Text style={[styles.priceSuffix, { color: palette.text.secondary }]}>₽/мес</Text>
            </View>
          </View>
        ) : null}

        {/* Support contact — the path to resolution (no in-app purchase). */}
        <Pressable style={[styles.contactCard, surface.card]} onPress={onEmail}>
          <View style={[styles.contactIcon, { backgroundColor: accentSoft }]}>
            <Ionicons name="mail" size={18} color={accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.contactLabel, { color: palette.text.tertiary }]}>
              {suspended ? 'Связаться с нами' : 'По вопросам оплаты'}
            </Text>
            <Text style={[styles.contactValue, { color: palette.text.primary }]}>{SUPPORT_EMAIL}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
        </Pressable>

        <View style={styles.actions}>
          {/* Re-check — once оплата прошла, this flips the gate without a relaunch. */}
          <Pressable
            onPress={onRecheck}
            disabled={refreshing}
            style={[styles.primaryBtn, { backgroundColor: palette.accent.primary }]}
          >
            {refreshing ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <>
                <Ionicons name="refresh" size={18} color={colors.white} />
                <Text style={styles.primaryBtnText}>Проверить статус</Text>
              </>
            )}
          </Pressable>

          <Pressable onPress={onLogout} style={styles.secondaryBtn} hitSlop={8}>
            <Ionicons name="log-out-outline" size={18} color={palette.text.secondary} />
            <Text style={[styles.secondaryBtnText, { color: palette.text.secondary }]}>Выйти из аккаунта</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[10],
    gap: spacing[4],
  },
  brand: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 4,
    textAlign: 'center',
    marginBottom: spacing[2],
  },
  emblem: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
    textAlign: 'center',
    marginTop: spacing[1],
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    paddingHorizontal: spacing[1],
  },
  planCard: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], padding: spacing[4] },
  planIcon: { width: 40, height: 40, borderRadius: borderRadius.xl, alignItems: 'center', justifyContent: 'center' },
  planLabel: { fontSize: 12, fontWeight: '600' },
  planName: { fontSize: 16, fontWeight: '700', marginTop: 2 },
  priceWrap: { alignItems: 'flex-end' },
  priceValue: { fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  priceSuffix: { fontSize: 12, fontWeight: '500' },
  contactCard: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], padding: spacing[4] },
  contactIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  contactLabel: { fontSize: 12, fontWeight: '600' },
  contactValue: { fontSize: 15, fontWeight: '700', marginTop: 2 },
  actions: { gap: spacing[2], marginTop: spacing[2] },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[4],
    borderRadius: borderRadius['2xl'],
  },
  primaryBtnText: { color: colors.white, fontSize: 16, fontWeight: '700' },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3],
  },
  secondaryBtnText: { fontSize: 15, fontWeight: '600' },
});
