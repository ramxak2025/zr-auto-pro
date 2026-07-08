/**
 * MarketingScreen — «Маркетинг» hub.
 *
 * The owner called the old Маркетинг a «франкенштейн модулей без структуры»:
 * analytics, integration keys, review texts, платёжки and broadcasts were all
 * jumbled together. This hub is now a calm, grouped index — each row opens a
 * single, well-scoped screen, and every configuration surface has exactly one
 * home:
 *
 *   АНАЛИТИКА
 *     • Отчёты                → MarketingReports    (analytics, read-only)
 *
 *   РАБОТА С КЛИЕНТАМИ
 *     • Отзывы и репутация    → ReviewsReputation   (лента, рейтинг мастеров,
 *                                                    подарок за отзыв, запрос)
 *     • Рассылки              → Mailings            (сегментная + авто-рассылки)
 *     • Лояльность            → Loyalty             (бонусы / кешбэк)
 *
 *   ПОДКЛЮЧЕНИЯ И НАСТРОЙКИ
 *     • Интеграции            → Integrations        (телефония, каналы рассылок,
 *                                                    онлайн-касса 54-ФЗ, эквайринг)
 *     • Настройки             → MarketingSettings   (площадки отзывов + все тексты:
 *                                                    отзыв, машина готова, визит,
 *                                                    рассрочка)
 *
 * Gating: reading (отчёты, отзывы) is open to anyone who can see Маркетинг;
 * everything that configures outbound messaging / API keys / money settings
 * (рассылки, лояльность, интеграции, настройки) stays owner-class
 * (director / admin / superadmin) — the same access the old menu rows had.
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
import SectionHeader from '../components/SectionHeader';
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

interface Group {
  key: string;
  title: string;
  items: Direction[];
}

const GROUPS: Group[] = [
  {
    key: 'analytics',
    title: 'Аналитика',
    items: [
      {
        key: 'reports',
        label: 'Отчёты',
        description: 'Рейтинги, воронка отзывов, динамика по периодам',
        screen: 'MarketingReports',
        icon: 'stats-chart-outline',
        iconBg: colors.violet[50],
        iconColor: colors.violet[600],
      },
    ],
  },
  {
    key: 'clients',
    title: 'Работа с клиентами',
    items: [
      {
        key: 'reviews',
        label: 'Отзывы и репутация',
        description: 'Лента отзывов, рейтинг мастеров, подарок за отзыв',
        screen: 'ReviewsReputation',
        icon: 'star-outline',
        iconBg: colors.amber[50],
        iconColor: colors.amber[600],
      },
      {
        key: 'mailings',
        label: 'Рассылки',
        description: 'Сегментные и авто-рассылки, возврат клиентов',
        screen: 'Mailings',
        icon: 'paper-plane-outline',
        iconBg: colors.blue[50],
        iconColor: colors.blue[600],
        ownerOnly: true,
      },
      {
        key: 'loyalty',
        label: 'Лояльность',
        description: 'Бонусы и кешбэк за визиты',
        screen: 'Loyalty',
        icon: 'ribbon-outline',
        iconBg: colors.emerald[50],
        iconColor: colors.emerald[700],
        ownerOnly: true,
      },
    ],
  },
  {
    key: 'connections',
    title: 'Подключения и настройки',
    items: [
      {
        key: 'integrations',
        label: 'Интеграции',
        description: 'Телефония, каналы рассылок, онлайн-касса, эквайринг',
        screen: 'Integrations',
        icon: 'git-network-outline',
        iconBg: colors.slate[100],
        iconColor: colors.slate[600],
        ownerOnly: true,
      },
      {
        key: 'settings',
        label: 'Настройки',
        description: 'Площадки отзывов и тексты уведомлений клиентам',
        screen: 'MarketingSettings',
        icon: 'options-outline',
        iconBg: colors.indigo[50],
        iconColor: colors.indigo[600],
        ownerOnly: true,
      },
    ],
  },
];

export default function MarketingScreen() {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const { isRole } = useAuth();

  const isOwner = isRole(UserRole.DIRECTOR, UserRole.ADMIN, UserRole.SUPERADMIN);

  const visibleGroups = GROUPS.map((g) => ({
    ...g,
    items: g.items.filter((d) => !d.ownerOnly || isOwner),
  })).filter((g) => g.items.length > 0);

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Маркетинг" onBack={() => navigation.goBack()} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + spacing[4] }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.intro, { color: palette.text.secondary }]}>
          Всё про продвижение и связь с клиентами в одном месте — отчёты, отзывы, рассылки и подключения.
        </Text>

        {visibleGroups.map((group) => (
          <View key={group.key} style={styles.group}>
            <SectionHeader title={group.title} count={null} />
            <View style={styles.groupCards}>
              {group.items.map((d, idx) => (
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
          </View>
        ))}
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
    marginBottom: spacing[4],
  },
  group: { marginTop: spacing[1] },
  groupCards: { gap: spacing[3], marginTop: spacing[2] },
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
