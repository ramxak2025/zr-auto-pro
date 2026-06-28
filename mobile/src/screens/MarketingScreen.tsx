/**
 * MarketingScreen — «Маркетинг» hub.
 *
 * The owner kept getting lost in a single jumbled «Маркетинг» list that
 * mixed analytics, integration keys, review settings and broadcasts. This
 * screen is now a clean hub that routes into exactly four well-labelled
 * directions, each its own sub-screen:
 *
 *   1. Маркетинговые отчёты  → MarketingReports     (analytics, read-only)
 *   2. Отзывы и репутация    → ReviewsReputation    (collect reviews, площадки)
 *   3. Интеграции            → Integrations         (ALL integrations: касса 54-ФЗ,
 *                                                    эквайринг, мессенджеры, телефония)
 *   4. Рассылки              → Mailings             (авто/ручные рассылки, шаблоны)
 *
 * Звонки (call journal) stays a sibling row in the «Ещё» menu — it's a
 * daily-use log, not a marketing setting. PaymentIntegrations is reached
 * from inside «Интеграции» so every integration lives under one roof.
 *
 * Owner-class gating: «Интеграции» and «Рассылки» configure API keys /
 * outbound messaging, so they stay director/admin/superadmin only — exactly
 * the access the previous separate menu rows had. «Отчёты» and «Отзывы»
 * stay open to anyone who can see the Маркетинг section (matching the old
 * always-open «Отзывы и репутация» entry).
 */
import React from 'react';
import { View, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useColors } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { colors, fontSize, fontWeight, borderRadius, spacing, softTint } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import AnimatedCard from '../components/AnimatedCard';
import IosScreenHeader from '../components/IosScreenHeader';
import { Text } from '../platform/Typography';
import { haptic } from '../platform/haptics';
import { UserRole } from '../../../shared/types';

interface Direction {
  key: string;
  label: string;
  description: string;
  screen: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconBg: string;
  iconColor: string;
  /** Owner-class only (director / admin / superadmin). */
  ownerOnly?: boolean;
}

const DIRECTIONS: Direction[] = [
  {
    key: 'reports',
    label: 'Маркетинговые отчёты',
    description: 'Аналитика отзывов, рейтинги, воронка',
    screen: 'MarketingReports',
    icon: 'stats-chart-outline',
    iconBg: colors.violet[50],
    iconColor: colors.violet[600],
  },
  {
    key: 'reviews',
    label: 'Отзывы и репутация',
    description: 'Сбор отзывов, площадки, подарок за отзыв',
    screen: 'ReviewsReputation',
    icon: 'star-outline',
    iconBg: colors.amber[50],
    iconColor: colors.amber[600],
  },
  {
    key: 'integrations',
    label: 'Интеграции',
    description: 'Касса 54-ФЗ, эквайринг, мессенджеры, телефония',
    screen: 'Integrations',
    icon: 'extension-puzzle-outline',
    iconBg: colors.slate[100],
    iconColor: colors.slate[600],
    ownerOnly: true,
  },
  {
    key: 'mailings',
    label: 'Рассылки',
    description: 'Авто и ручные рассылки, шаблоны, возврат клиентов',
    screen: 'Mailings',
    icon: 'paper-plane-outline',
    iconBg: colors.blue[50],
    iconColor: colors.blue[600],
    ownerOnly: true,
  },
];

export default function MarketingScreen() {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const { isRole } = useAuth();

  const isOwner = isRole(UserRole.DIRECTOR, UserRole.ADMIN, UserRole.SUPERADMIN);
  const visible = DIRECTIONS.filter((d) => !d.ownerOnly || isOwner);

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Маркетинг" onBack={() => navigation.goBack()} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + spacing[4] }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.intro, { color: palette.text.secondary }]}>
          Всё про продвижение в одном месте — отчёты, отзывы, интеграции и рассылки клиентам.
        </Text>

        <View style={{ gap: spacing[3] }}>
          {visible.map((d, idx) => (
            <AnimatedCard
              key={d.key}
              index={idx}
              onPress={() => {
                haptic('tap');
                navigation.navigate(d.screen);
              }}
              style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
            >
              <View style={styles.cardRow}>
                <View
                  style={[
                    styles.iconTile,
                    { backgroundColor: palette.mode === 'dark' ? softTint(d.iconColor, 'dark') : d.iconBg },
                  ]}
                >
                  <Ionicons name={d.icon} size={22} color={d.iconColor} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[styles.cardTitle, { color: palette.text.primary }]} numberOfLines={1}>
                    {d.label}
                  </Text>
                  <Text style={[styles.cardDesc, { color: palette.text.secondary }]} numberOfLines={2}>
                    {d.description}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={palette.text.tertiary} />
              </View>
            </AnimatedCard>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing[4] },
  intro: {
    fontSize: fontSize.sm,
    lineHeight: 20,
    marginBottom: spacing[5],
  },
  card: {
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    padding: spacing[4],
  },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3.5] },
  iconTile: {
    width: 48,
    height: 48,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, letterSpacing: -0.2 },
  cardDesc: { fontSize: fontSize.xs, marginTop: 3, lineHeight: 17 },
});
