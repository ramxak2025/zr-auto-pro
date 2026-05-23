/**
 * MarketingScreen — "Отзывы и репутация".
 *
 * Refocused: the screen used to be a multi-tab Marketing hub (dashboard +
 * reviews + integrations + reminders + settings). Integrations and SMS
 * reminders moved out to their own screens (`IntegrationsScreen`,
 * `MailingsScreen`). This screen now hosts ONLY review-side concerns:
 *
 *   • Сводка   — KPI grid + new-negative alerts card + per-platform rating
 *                (from `getPlatformLinks`) + funnel + employee rankings.
 *   • Отзывы   — per-month list of submitted reviews.
 *
 * Top-bar trailing slot exposes "Запросить отзыв" — opens a sheet to pick
 * an existing client and fire a one-off SMS via `marketingApi.sendSms`.
 *
 * The route name in the navigator stays `Marketing` so the existing
 * MoreScreen link doesn't break.
 */
import React, { useMemo, useState } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Alert,
  Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { useColors } from '../contexts/ThemeContext';
import { marketingApi, clientsApi } from '../api/services';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import AnimatedCard from '../components/AnimatedCard';
import IosScreenHeader from '../components/IosScreenHeader';
import Modal from '../components/Modal';
import { Text } from '../platform/Typography';
import { haptic } from '../platform/haptics';
import type { Client, ReviewAlert, ReviewPlatformLink } from '../../../shared/types';

type TabKey = 'dashboard' | 'reviews';

const PLATFORM_LABELS: Record<string, string> = {
  google: 'Google',
  yandex: 'Яндекс',
  '2gis': '2GIS',
  avito: 'Авито',
};

function StarRating({ rating, size = 14 }: { rating: number; size?: number }) {
  const stars = [] as React.ReactElement[];
  for (let i = 1; i <= 5; i++) {
    stars.push(
      <Ionicons
        key={i}
        name={i <= Math.round(rating) ? 'star' : 'star-outline'}
        size={size}
        color={i <= Math.round(rating) ? colors.amber[600] : colors.gray[300]}
      />,
    );
  }
  return <View style={{ flexDirection: 'row', gap: 1 }}>{stars}</View>;
}

// ─────────────────────────────────────────────────────────────────────
//  Сводка
// ─────────────────────────────────────────────────────────────────────

function DashboardTab({ onRequestReview }: { onRequestReview: () => void }) {
  const palette = useColors();

  const dashboardQuery = useQuery({
    queryKey: ['marketing-dashboard'],
    queryFn: async () => (await marketingApi.getDashboard()).data,
    staleTime: 60_000,
  });
  const alertsQuery = useQuery({
    queryKey: ['marketing-alerts'],
    queryFn: async () => (await marketingApi.getAlerts()).data,
    staleTime: 60_000,
  });
  const platformQuery = useQuery({
    queryKey: ['marketing-platform-links'],
    queryFn: async () => (await marketingApi.getPlatformLinks()).data,
    staleTime: 60_000,
  });

  const data = dashboardQuery.data;
  const alerts: ReviewAlert[] = Array.isArray(alertsQuery.data) ? alertsQuery.data : [];
  const platforms: ReviewPlatformLink[] = Array.isArray(platformQuery.data) ? platformQuery.data : [];

  if (dashboardQuery.isLoading && !data) {
    return <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary[600]} />;
  }
  if (!data) {
    return (
      <View style={styles.emptyCard}>
        <Ionicons name="chatbubbles-outline" size={36} color={palette.text.tertiary} />
        <Text style={[styles.emptyTitle, { color: palette.text.tertiary }]}>Нет данных</Text>
      </View>
    );
  }

  const unreadNegative = alerts.filter((a) => !a.isRead && a.alertType === 'consecutive_negative').length;

  const stats = [
    {
      label: 'Всего отзывов',
      value: data.totalReviews || 0,
      icon: 'chatbubbles-outline' as const,
      color: colors.primary[600],
      bg: colors.primary[50],
    },
    {
      label: 'Средний рейтинг',
      value: data.avgRating ? data.avgRating.toFixed(1) : '—',
      icon: 'star' as const,
      color: colors.amber[600],
      bg: colors.amber[50],
    },
    {
      label: 'Запросов отправлено',
      value: data.tokensSent || 0,
      icon: 'send-outline' as const,
      color: colors.teal[600],
      bg: colors.teal[50],
    },
    {
      label: 'Отклик',
      value: data.responseRate ? `${Math.round(data.responseRate)}%` : '—',
      icon: 'trending-up-outline' as const,
      color: colors.green[600],
      bg: colors.green[50],
    },
  ];

  return (
    <View style={{ gap: spacing[4] }}>
      {/* Manual review request CTA */}
      <Pressable
        onPress={() => {
          haptic('tap');
          onRequestReview();
        }}
        style={({ pressed }) => [
          styles.ctaCard,
          {
            backgroundColor: palette.accent.primarySoft,
            borderColor: palette.accent.primary,
            opacity: pressed ? 0.85 : 1,
          },
        ]}
      >
        <View style={[styles.ctaIcon, { backgroundColor: palette.accent.primary }]}>
          <Ionicons name="paper-plane" size={18} color={colors.white} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.ctaTitle, { color: palette.text.primary }]}>Запросить отзыв вручную</Text>
          <Text style={[styles.ctaSub, { color: palette.text.secondary }]}>
            Отправьте клиенту персональную ссылку
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={palette.text.tertiary} />
      </Pressable>

      {/* Negative alerts highlight */}
      {unreadNegative > 0 && (
        <AnimatedCard index={0} style={[styles.alertCard]}>
          <View style={[styles.alertIcon, { backgroundColor: colors.red[100] }]}>
            <Ionicons name="warning" size={18} color={colors.red[600]} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.alertTitle, { color: colors.red[700] }]}>
              {unreadNegative} новых негативных отзыва
            </Text>
            <Text style={[styles.alertSub, { color: colors.red[700] }]}>
              Откройте вкладку «Отзывы» — клиенты ждут реакции
            </Text>
          </View>
        </AnimatedCard>
      )}

      {/* KPI Grid */}
      <View style={styles.statsGrid}>
        {stats.map((stat, idx) => (
          <AnimatedCard
            key={stat.label}
            index={idx + 1}
            style={[styles.statCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
          >
            <View style={[styles.statIconBox, { backgroundColor: stat.bg }]}>
              <Ionicons name={stat.icon} size={18} color={stat.color} />
            </View>
            <Text style={[styles.statValue, { color: palette.text.primary }]}>{stat.value}</Text>
            <Text style={[styles.statLabel, { color: palette.text.tertiary }]}>{stat.label}</Text>
          </AnimatedCard>
        ))}
      </View>

      {/* Platforms rating */}
      <AnimatedCard
        index={5}
        style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
      >
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionTitle, { color: palette.text.primary }]}>Площадки</Text>
          <Ionicons name="globe-outline" size={16} color={palette.text.tertiary} />
        </View>
        {platforms.length === 0 ? (
          <Text style={[styles.platformsHint, { color: palette.text.tertiary }]}>
            Площадки не подключены. Откройте «Интеграции», чтобы добавить ссылки на Google / Яндекс / 2GIS.
          </Text>
        ) : (
          platforms.map((p, idx) => (
            <View
              key={p.id}
              style={[
                styles.platformRow,
                idx > 0 && [styles.platformRowBorder, { borderTopColor: palette.border.subtle }],
              ]}
            >
              <View style={[styles.platformBadge, { backgroundColor: palette.bg.muted }]}>
                <Ionicons name="link-outline" size={16} color={palette.text.secondary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.platformName, { color: palette.text.primary }]} numberOfLines={1}>
                  {PLATFORM_LABELS[p.platform] ?? p.platform}
                </Text>
                <Text style={[styles.platformUrl, { color: palette.text.tertiary }]} numberOfLines={1}>
                  {p.url}
                </Text>
              </View>
              <View
                style={[
                  styles.statusPill,
                  p.isActive ? styles.statusPillActive : { backgroundColor: palette.bg.muted },
                ]}
              >
                <Text
                  style={[
                    styles.statusPillText,
                    p.isActive ? styles.statusPillTextActive : { color: palette.text.tertiary },
                  ]}
                >
                  {p.isActive ? 'Подключено' : 'Выключено'}
                </Text>
              </View>
            </View>
          ))
        )}
      </AnimatedCard>

      {/* Review Funnel */}
      {data.totalReviews > 0 && (
        <AnimatedCard
          index={6}
          style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
        >
          <Text style={[styles.sectionTitle, { color: palette.text.primary }]}>Воронка отзывов</Text>
          <View style={{ gap: spacing[3] }}>
            <FunnelBar
              label="Ссылки отправлены"
              value={data.tokensSent || 0}
              max={data.tokensSent || 1}
              color={colors.primary[500]}
            />
            <FunnelBar
              label="Получен отклик"
              value={data.totalReviews || 0}
              max={data.tokensSent || 1}
              color={colors.blue[600]}
            />
            <FunnelBar
              label="Позитивные (4-5)"
              value={data.positiveReviews || 0}
              max={data.tokensSent || 1}
              color={colors.green[500]}
            />
            <FunnelBar
              label="Перешли на площадку"
              value={data.publicRedirects || 0}
              max={data.tokensSent || 1}
              color={colors.emerald[700]}
            />
          </View>
        </AnimatedCard>
      )}

      {/* Employee Ratings */}
      {data.employeeRatings && data.employeeRatings.length > 0 && (
        <AnimatedCard
          index={7}
          style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
        >
          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.sectionTitle, { color: palette.text.primary }]}>Рейтинг сотрудников</Text>
            <Ionicons name="trophy-outline" size={18} color={colors.amber[600]} />
          </View>
          {data.employeeRatings.map((emp, idx) => (
            <View
              key={emp.employeeId || idx}
              style={[styles.empRow, idx > 0 && [styles.empRowBorder, { borderTopColor: palette.border.subtle }]]}
            >
              <View style={[styles.empRankBadge, { backgroundColor: palette.bg.muted }]}>
                {idx < 3 ? (
                  <Ionicons
                    name="trophy"
                    size={16}
                    color={idx === 0 ? '#FFD700' : idx === 1 ? '#C0C0C0' : '#CD7F32'}
                  />
                ) : (
                  <Text style={[styles.empRankText, { color: palette.text.tertiary }]}>{idx + 1}</Text>
                )}
              </View>
              <View style={styles.empInfo}>
                <Text style={[styles.empName, { color: palette.text.primary }]} numberOfLines={1}>
                  {emp.employeeName}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                  <StarRating rating={emp.avgRating || 0} size={12} />
                  <Text style={[styles.empReviewCount, { color: palette.text.tertiary }]}>
                    {emp.reviewCount} отзывов
                  </Text>
                </View>
              </View>
              <Text style={[styles.empRating, { color: palette.text.primary }]}>
                {(emp.avgRating || 0).toFixed(1)}
              </Text>
            </View>
          ))}
        </AnimatedCard>
      )}
    </View>
  );
}

function FunnelBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const palette = useColors();
  const percent = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
        <Text style={[styles.funnelLabel, { color: palette.text.secondary }]}>{label}</Text>
        <Text style={[styles.funnelValue, { color: palette.text.primary }]}>
          {value} ({percent}%)
        </Text>
      </View>
      <View style={[styles.funnelBarBg, { backgroundColor: palette.bg.muted }]}>
        <View style={[styles.funnelBarFill, { width: `${percent}%`, backgroundColor: color }]} />
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Отзывы
// ─────────────────────────────────────────────────────────────────────

function ReviewsTab() {
  const palette = useColors();
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const { data, isLoading } = useQuery({
    queryKey: ['marketing-reviews', month],
    queryFn: async () => (await marketingApi.getReviews({ month })).data,
  });

  const reviews = Array.isArray(data) ? data : [];

  const navigateMonth = (dir: number) => {
    haptic('tap');
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + dir, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const monthLabel = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const names = [
      'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
      'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
    ];
    return `${names[m - 1]} ${y}`;
  }, [month]);

  return (
    <View style={{ gap: spacing[4] }}>
      <View style={styles.monthNav}>
        <TouchableOpacity
          onPress={() => navigateMonth(-1)}
          style={[styles.monthBtn, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
        >
          <Ionicons name="chevron-back" size={20} color={palette.text.secondary} />
        </TouchableOpacity>
        <Text style={[styles.monthLabel, { color: palette.text.primary }]}>{monthLabel}</Text>
        <TouchableOpacity
          onPress={() => navigateMonth(1)}
          style={[styles.monthBtn, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
        >
          <Ionicons name="chevron-forward" size={20} color={palette.text.secondary} />
        </TouchableOpacity>
      </View>

      {isLoading && reviews.length === 0 ? (
        <ActivityIndicator color={colors.primary[600]} style={{ marginTop: 20 }} />
      ) : reviews.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="chatbubbles-outline" size={40} color={palette.text.tertiary} />
          <Text style={[styles.emptyTitle, { color: palette.text.tertiary }]}>Нет отзывов за этот месяц</Text>
        </View>
      ) : (
        reviews.map((review, idx) => (
          <AnimatedCard
            key={review.id || idx}
            index={idx}
            style={[styles.reviewCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
          >
            <View style={styles.reviewHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.reviewClientName, { color: palette.text.primary }]}>
                  {review.clientName || 'Клиент'}
                </Text>
                <Text style={[styles.reviewDate, { color: palette.text.tertiary }]}>
                  {new Date(review.createdAt).toLocaleDateString('ru-RU')}
                </Text>
              </View>
              <StarRating rating={review.rating} size={16} />
            </View>
            {review.comment && (
              <Text style={[styles.reviewComment, { color: palette.text.secondary }]}>{review.comment}</Text>
            )}
            {review.employeeName && (
              <View style={[styles.reviewEmployeeTag, { borderTopColor: palette.border.subtle }]}>
                <Ionicons name="person-outline" size={12} color={palette.text.tertiary} />
                <Text style={[styles.reviewEmployeeText, { color: palette.text.tertiary }]}>
                  {review.employeeName}
                </Text>
              </View>
            )}
          </AnimatedCard>
        ))
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Request review modal
// ─────────────────────────────────────────────────────────────────────

function RequestReviewModal({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const palette = useColors();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Client | null>(null);
  const [channel, setChannel] = useState<'sms' | 'whatsapp'>('sms');

  // Debounce-ish: refetch on every change but staleTime swallows duplicates.
  const clientsQuery = useQuery({
    queryKey: ['marketing-request-clients', search],
    queryFn: async () =>
      (await clientsApi.getAll({ search, page: 1, limit: 30 })).data,
    enabled: visible,
    staleTime: 30_000,
  });
  const clients = clientsQuery.data?.data ?? [];

  const sendSms = useMutation({
    mutationFn: ({ phone, text }: { phone: string; text: string }) =>
      marketingApi.sendSms({ phone, text }),
  });

  const handleSend = () => {
    if (!selected) {
      Alert.alert('Выберите клиента', 'Сначала выберите клиента из списка');
      return;
    }
    if (!selected.phone) {
      Alert.alert('Нет телефона', 'У клиента не указан номер телефона');
      return;
    }
    const text =
      channel === 'whatsapp'
        ? `Здравствуйте, ${selected.fullName.split(' ')[0]}! Будем благодарны за отзыв о нашем сервисе.`
        : `Здравствуйте, ${selected.fullName.split(' ')[0]}! Оставьте, пожалуйста, отзыв о работе сервиса. Ссылка придёт отдельным сообщением.`;
    sendSms.mutate(
      { phone: selected.phone, text },
      {
        onSuccess: () => {
          haptic('success');
          Alert.alert('Готово', 'Запрос отзыва отправлен');
          setSelected(null);
          setSearch('');
          onClose();
        },
        onError: (e: any) => {
          haptic('error');
          Alert.alert('Ошибка', e?.response?.data?.message || 'Не удалось отправить запрос');
        },
      },
    );
  };

  return (
    <Modal visible={visible} onClose={onClose} title="Запросить отзыв">
      {/* Channel */}
      <View style={styles.formField}>
        <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Канал</Text>
        <View style={{ flexDirection: 'row', gap: spacing[2] }}>
          {(['sms', 'whatsapp'] as const).map((c) => {
            const active = channel === c;
            return (
              <TouchableOpacity
                key={c}
                onPress={() => {
                  haptic('select');
                  setChannel(c);
                }}
                style={[
                  styles.channelChip,
                  {
                    backgroundColor: active ? palette.accent.primarySoft : palette.bg.muted,
                    borderColor: active ? palette.accent.primary : palette.border.subtle,
                  },
                ]}
              >
                <Ionicons
                  name={c === 'sms' ? 'chatbox-outline' : 'logo-whatsapp'}
                  size={16}
                  color={active ? palette.accent.primary : palette.text.tertiary}
                />
                <Text
                  style={[
                    styles.channelChipText,
                    { color: active ? palette.accent.primary : palette.text.secondary },
                  ]}
                >
                  {c === 'sms' ? 'SMS' : 'WhatsApp'}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Search */}
      <View style={styles.formField}>
        <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Клиент</Text>
        <TextInput
          value={search}
          onChangeText={setSearch}
          style={[
            styles.formInput,
            {
              backgroundColor: palette.bg.muted,
              borderColor: palette.border.subtle,
              color: palette.text.primary,
            },
          ]}
          placeholder="Имя или телефон"
          placeholderTextColor={palette.text.tertiary}
          autoCorrect={false}
        />
      </View>

      {/* List */}
      <View style={{ maxHeight: 260 }}>
        {clientsQuery.isLoading ? (
          <ActivityIndicator color={colors.primary[600]} style={{ marginVertical: spacing[4] }} />
        ) : clients.length === 0 ? (
          <Text style={[styles.platformsHint, { color: palette.text.tertiary }]}>
            Ничего не найдено
          </Text>
        ) : (
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            {clients.map((c) => {
              const active = selected?.id === c.id;
              return (
                <TouchableOpacity
                  key={c.id}
                  style={[
                    styles.clientRow,
                    {
                      backgroundColor: active ? palette.accent.primarySoft : palette.bg.card,
                      borderColor: active ? palette.accent.primary : palette.border.subtle,
                    },
                  ]}
                  onPress={() => {
                    haptic('select');
                    setSelected(c);
                  }}
                >
                  <View style={[styles.clientAvatar, { backgroundColor: palette.bg.muted }]}>
                    <Ionicons name="person-outline" size={14} color={palette.text.secondary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.clientName, { color: palette.text.primary }]} numberOfLines={1}>
                      {c.fullName}
                    </Text>
                    <Text style={[styles.clientPhone, { color: palette.text.tertiary }]} numberOfLines={1}>
                      {c.phone || 'нет телефона'}
                    </Text>
                  </View>
                  {active && (
                    <Ionicons name="checkmark-circle" size={20} color={palette.accent.primary} />
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}
      </View>

      <TouchableOpacity
        style={[
          styles.primaryBtn,
          { backgroundColor: palette.accent.primary },
          (!selected || sendSms.isPending) && { opacity: 0.55 },
        ]}
        disabled={!selected || sendSms.isPending}
        onPress={handleSend}
      >
        {sendSms.isPending ? (
          <ActivityIndicator size="small" color={colors.white} />
        ) : (
          <>
            <Ionicons name="send" size={16} color={colors.white} />
            <Text style={styles.primaryBtnText}>Отправить запрос</Text>
          </>
        )}
      </TouchableOpacity>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Screen
// ─────────────────────────────────────────────────────────────────────

export default function MarketingScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [refreshing, setRefreshing] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);

  const tabs: { key: TabKey; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: 'dashboard', label: 'Сводка', icon: 'pie-chart-outline' },
    { key: 'reviews', label: 'Отзывы', icon: 'chatbubbles-outline' },
  ];

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['marketing-dashboard'] }),
      queryClient.invalidateQueries({ queryKey: ['marketing-alerts'] }),
      queryClient.invalidateQueries({ queryKey: ['marketing-platform-links'] }),
      queryClient.invalidateQueries({ queryKey: ['marketing-reviews'] }),
    ]);
    setRefreshing(false);
  };

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title="Отзывы и репутация"
        onBack={() => navigation.goBack()}
        trailing={
          <TouchableOpacity
            onPress={() => {
              haptic('tap');
              setRequestOpen(true);
            }}
            hitSlop={10}
            style={[styles.headerAction, { backgroundColor: palette.accent.primarySoft }]}
            accessibilityRole="button"
            accessibilityLabel="Запросить отзыв"
          >
            <Ionicons name="paper-plane" size={16} color={palette.accent.primary} />
          </TouchableOpacity>
        }
      />

      <View style={[styles.tabBar, { backgroundColor: palette.bg.canvas }]}>
        {tabs.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[
                styles.tab,
                { backgroundColor: palette.bg.muted },
                active && {
                  backgroundColor: palette.accent.primarySoft,
                  borderWidth: 1,
                  borderColor: palette.accent.primary,
                },
              ]}
              onPress={() => {
                haptic('select');
                setActiveTab(tab.key);
              }}
            >
              <Ionicons
                name={(active ? tab.icon.replace('-outline', '') : tab.icon) as any}
                size={18}
                color={active ? palette.accent.primary : palette.text.tertiary}
              />
              <Text
                style={[
                  styles.tabText,
                  { color: active ? palette.accent.primary : palette.text.tertiary },
                  active && { fontWeight: fontWeight.bold },
                ]}
              >
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + spacing[4] }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.accent.primary} />
        }
      >
        {activeTab === 'dashboard' && <DashboardTab onRequestReview={() => setRequestOpen(true)} />}
        {activeTab === 'reviews' && <ReviewsTab />}
      </ScrollView>

      <RequestReviewModal visible={requestOpen} onClose={() => setRequestOpen(false)} />
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: { flex: 1 },
  headerAction: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Tabs
  tabBar: {
    flexDirection: 'row',
    paddingHorizontal: spacing[3],
    paddingBottom: spacing[2],
    gap: spacing[2],
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.xl,
  },
  tabText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },

  // Content scroll
  scroll: { flex: 1 },
  scrollContent: { padding: spacing[4] },

  // CTA banner
  ctaCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    padding: spacing[3.5],
  },
  ctaIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, letterSpacing: -0.3 },
  ctaSub: { fontSize: fontSize.xs, marginTop: 2 },

  // Alert
  alertCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    backgroundColor: colors.red[50],
    borderColor: colors.red[200],
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    padding: spacing[3.5],
  },
  alertIcon: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  alertSub: { fontSize: fontSize.xs, marginTop: 2 },

  // KPI Grid
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },
  statCard: {
    width: '47%',
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    padding: spacing[4],
  },
  statIconBox: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[3],
  },
  statValue: { fontSize: fontSize['2xl'], fontWeight: fontWeight.bold },
  statLabel: { fontSize: fontSize.xs, marginTop: 2 },

  // Card
  card: {
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    padding: spacing[4],
  },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    marginBottom: spacing[3],
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing[3],
  },

  // Platforms
  platformRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingVertical: spacing[3] },
  platformRowBorder: { borderTopWidth: 1 },
  platformBadge: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  platformName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  platformUrl: { fontSize: fontSize.xs, marginTop: 2 },
  platformsHint: { fontSize: fontSize.xs, lineHeight: 18 },
  statusPill: {
    paddingHorizontal: spacing[2.5],
    paddingVertical: 4,
    borderRadius: borderRadius.full,
  },
  statusPillActive: { backgroundColor: colors.green[50] },
  statusPillText: { fontSize: 10, fontWeight: fontWeight.semibold },
  statusPillTextActive: { color: colors.green[700] },

  // Funnel
  funnelLabel: { fontSize: fontSize.xs },
  funnelValue: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  funnelBarBg: { height: 8, borderRadius: 4, overflow: 'hidden' },
  funnelBarFill: { height: 8, borderRadius: 4 },

  // Employees
  empRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing[3], gap: spacing[3] },
  empRowBorder: { borderTopWidth: 1 },
  empRankBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empRankText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  empInfo: { flex: 1, minWidth: 0 },
  empName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  empReviewCount: { fontSize: 11 },
  empRating: { fontSize: fontSize.lg, fontWeight: fontWeight.bold },

  // Empty
  emptyCard: { alignItems: 'center', paddingVertical: spacing[12], gap: spacing[3] },
  emptyTitle: { fontSize: fontSize.sm },

  // Reviews list
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[4] },
  monthBtn: {
    padding: spacing[2],
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  monthLabel: { fontSize: fontSize.base, fontWeight: fontWeight.semibold },
  reviewCard: {
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    padding: spacing[4],
  },
  reviewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  reviewClientName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  reviewDate: { fontSize: fontSize.xs, marginTop: 2 },
  reviewComment: { fontSize: fontSize.sm, marginTop: spacing[3], lineHeight: 20 },
  reviewEmployeeTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    marginTop: spacing[3],
    paddingTop: spacing[3],
    borderTopWidth: 1,
  },
  reviewEmployeeText: { fontSize: fontSize.xs },

  // Request modal form
  formField: { marginBottom: spacing[3] },
  formLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    marginBottom: spacing[1.5],
  },
  formInput: {
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[2.5],
    fontSize: fontSize.sm,
  },
  channelChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },
  channelChipText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  clientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    marginBottom: spacing[2],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },
  clientAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clientName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  clientPhone: { fontSize: fontSize.xs, marginTop: 1 },

  // Primary action
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[3.5],
    marginTop: spacing[3],
  },
  primaryBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.white },
});
