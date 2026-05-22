import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  RefreshControl,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import { marketingApi } from '../api/services';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import AnimatedCard from '../components/AnimatedCard';
import IosScreenHeader from '../components/IosScreenHeader';
import Modal from '../components/Modal';
import { UserRole } from '../../../shared/types';

type TabKey = 'dashboard' | 'reviews' | 'integrations' | 'settings';

function StarRating({ rating, size = 14 }: { rating: number; size?: number }) {
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    stars.push(
      <Ionicons
        key={i}
        name={i <= Math.round(rating) ? 'star' : 'star-outline'}
        size={size}
        color={i <= Math.round(rating) ? colors.amber[200] : colors.gray[300]}
      />,
    );
  }
  return <View style={{ flexDirection: 'row', gap: 1 }}>{stars}</View>;
}

// ── Dashboard Tab ──
function DashboardTab() {
  const palette = useColors();
  const { data, isLoading } = useQuery({
    queryKey: ['marketing-dashboard'],
    queryFn: async () => {
      const res = await marketingApi.getDashboard();
      return res.data;
    },
    staleTime: 60_000,
  });

  if (isLoading) return <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary[600]} />;
  if (!data) return <Text style={styles.emptyText}>Нет данных</Text>;

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
      label: 'Токенов отправлено',
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
      {/* Stats Grid */}
      <View style={styles.statsGrid}>
        {stats.map((stat, idx) => (
          <AnimatedCard
            key={stat.label}
            index={idx}
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

      {/* Review Funnel */}
      {data.totalReviews > 0 && (
        <AnimatedCard
          index={4}
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
          index={5}
          style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
        >
          <View style={styles.sectionHeaderRow}>
            <Text style={[styles.sectionTitle, { color: palette.text.primary }]}>Рейтинг сотрудников</Text>
            <Ionicons name="trophy-outline" size={18} color={colors.amber[600]} />
          </View>
          {data.employeeRatings.map((emp: any, idx: number) => (
            <View
              key={emp.employeeId || idx}
              style={[styles.empRow, idx > 0 && [styles.empRowBorder, { borderTopColor: palette.border.subtle }]]}
            >
              <View style={[styles.empRankBadge, { backgroundColor: palette.bg.muted }]}>
                {idx < 3 ? (
                  <Ionicons name="trophy" size={16} color={idx === 0 ? '#FFD700' : idx === 1 ? '#C0C0C0' : '#CD7F32'} />
                ) : (
                  <Text style={[styles.empRankText, { color: palette.text.tertiary }]}>{idx + 1}</Text>
                )}
              </View>
              <View style={styles.empInfo}>
                <Text style={[styles.empName, { color: palette.text.primary }]} numberOfLines={1}>
                  {emp.employeeName}
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                  <StarRating rating={emp.averageRating || 0} size={12} />
                  <Text style={[styles.empReviewCount, { color: palette.text.tertiary }]}>{emp.reviewCount} отзывов</Text>
                </View>
              </View>
              <Text style={[styles.empRating, { color: palette.text.primary }]}>{(emp.averageRating || 0).toFixed(1)}</Text>
            </View>
          ))}
        </AnimatedCard>
      )}

      {/* Alerts */}
      {data.unreadAlerts > 0 && (
        <AnimatedCard index={6} style={[styles.card, styles.alertCard]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
            <Ionicons name="warning-outline" size={20} color={colors.red[600]} />
            <Text style={styles.alertText}>{data.unreadAlerts} непрочитанных оповещений</Text>
          </View>
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

// ── Reviews Tab ──
function ReviewsTab() {
  const palette = useColors();
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const { data, isLoading } = useQuery({
    queryKey: ['marketing-reviews', month],
    queryFn: async () => {
      const res = await marketingApi.getReviews({ month });
      return res.data;
    },
  });

  const reviews: any[] = Array.isArray(data) ? data : [];

  const navigateMonth = (dir: number) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + dir, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  };

  const monthLabel = (() => {
    const [y, m] = month.split('-').map(Number);
    const names = [
      'Январь',
      'Февраль',
      'Март',
      'Апрель',
      'Май',
      'Июнь',
      'Июль',
      'Август',
      'Сентябрь',
      'Октябрь',
      'Ноябрь',
      'Декабрь',
    ];
    return `${names[m - 1]} ${y}`;
  })();

  return (
    <View style={{ gap: spacing[4] }}>
      {/* Month navigation */}
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

      {isLoading ? (
        <ActivityIndicator color={colors.primary[600]} style={{ marginTop: 20 }} />
      ) : (Array.isArray(reviews) ? reviews : []).length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="chatbubbles-outline" size={40} color={palette.text.tertiary} />
          <Text style={[styles.emptyTitle, { color: palette.text.tertiary }]}>Нет отзывов за этот месяц</Text>
        </View>
      ) : (
        (Array.isArray(reviews) ? reviews : []).map((review: any, idx: number) => (
          <AnimatedCard
            key={review.id || idx}
            index={idx}
            style={[styles.reviewCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
          >
            <View style={styles.reviewHeader}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.reviewClientName, { color: palette.text.primary }]}>{review.clientName || 'Клиент'}</Text>
                <Text style={[styles.reviewDate, { color: palette.text.tertiary }]}>{new Date(review.createdAt).toLocaleDateString('ru-RU')}</Text>
              </View>
              <StarRating rating={review.rating} size={16} />
            </View>
            {review.comment && <Text style={[styles.reviewComment, { color: palette.text.secondary }]}>{review.comment}</Text>}
            {review.employeeName && (
              <View style={[styles.reviewEmployeeTag, { borderTopColor: palette.border.subtle }]}>
                <Ionicons name="person-outline" size={12} color={palette.text.tertiary} />
                <Text style={[styles.reviewEmployeeText, { color: palette.text.tertiary }]}>{review.employeeName}</Text>
              </View>
            )}
          </AnimatedCard>
        ))
      )}
    </View>
  );
}

// ── Integrations Tab ── (with CRUD)
function IntegrationsTab() {
  const palette = useColors();
  const queryClient = useQueryClient();
  const { data: integrations, isLoading } = useQuery({
    queryKey: ['marketing-integrations'],
    queryFn: async () => {
      const res = await marketingApi.getIntegrations();
      return res.data;
    },
    staleTime: 60_000,
  });

  const { data: platformLinks } = useQuery({
    queryKey: ['marketing-platform-links'],
    queryFn: async () => {
      const res = await marketingApi.getPlatformLinks();
      return res.data;
    },
    staleTime: 60_000,
  });

  const [editProvider, setEditProvider] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [editPlatform, setEditPlatform] = useState<string | null>(null);
  const [platformUrl, setPlatformUrl] = useState('');

  const upsertIntegration = useMutation({
    mutationFn: (data: any) => marketingApi.upsertIntegration(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketing-integrations'] });
      setEditProvider(null);
      setApiKey('');
    },
    onError: () => Alert.alert('Ошибка', 'Не удалось сохранить'),
  });

  const removeIntegration = useMutation({
    mutationFn: (id: string) => marketingApi.removeIntegration(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['marketing-integrations'] }),
    onError: () => Alert.alert('Ошибка', 'Не удалось удалить'),
  });

  const upsertLink = useMutation({
    mutationFn: (data: any) => marketingApi.upsertPlatformLink(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketing-platform-links'] });
      setEditPlatform(null);
      setPlatformUrl('');
    },
    onError: () => Alert.alert('Ошибка', 'Не удалось сохранить'),
  });

  const removeLink = useMutation({
    mutationFn: (id: string) => marketingApi.removePlatformLink(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['marketing-platform-links'] }),
    onError: () => Alert.alert('Ошибка', 'Не удалось удалить'),
  });

  if (isLoading) return <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary[600]} />;

  const providers = [
    {
      key: 'sms_ru',
      name: 'SMS.RU',
      icon: 'chatbox-outline' as const,
      desc: 'SMS-рассылка',
      keyLabel: 'API ключ SMS.RU',
    },
    {
      key: 'moi_zvonki',
      name: 'МоиЗвонки',
      icon: 'call-outline' as const,
      desc: 'SMS через МоиЗвонки',
      keyLabel: 'API ключ МоиЗвонки',
    },
    {
      key: 'whatsapp',
      name: 'WhatsApp',
      icon: 'logo-whatsapp' as const,
      desc: 'Сообщения WhatsApp',
      keyLabel: 'Token WhatsApp API',
    },
    {
      key: 'email',
      name: 'Email',
      icon: 'mail-outline' as const,
      desc: 'Почтовые рассылки',
      keyLabel: 'SMTP ключ / API ключ',
    },
  ];

  const platforms = [
    { key: 'google', name: 'Google Maps', icon: 'location-outline' as const },
    { key: 'yandex', name: 'Яндекс Карты', icon: 'navigate-outline' as const },
    { key: '2gis', name: '2GIS', icon: 'map-outline' as const },
  ];

  const activeIntegrations = Array.isArray(integrations) ? integrations : [];
  const activeLinks = Array.isArray(platformLinks) ? platformLinks : [];

  const openProviderEdit = (providerKey: string) => {
    const existing = activeIntegrations.find((i: any) => i.providerType === providerKey);
    setApiKey((existing as any)?.apiKey || '');
    setEditProvider(providerKey);
  };

  const openPlatformEdit = (platformKey: string) => {
    const existing = activeLinks.find((l: any) => l.platform === platformKey);
    setPlatformUrl(existing?.url || '');
    setEditPlatform(platformKey);
  };

  const editProviderInfo = providers.find((p) => p.key === editProvider);
  const editPlatformInfo = platforms.find((p) => p.key === editPlatform);

  return (
    <View style={{ gap: spacing[4] }}>
      {/* Messaging Channels */}
      <AnimatedCard
        index={0}
        style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
      >
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionTitle, { color: palette.text.primary }]}>Каналы отправки</Text>
          <Ionicons name="paper-plane-outline" size={16} color={palette.text.tertiary} />
        </View>
        {providers.map((p, idx) => {
          const active = activeIntegrations.find((i: any) => i.providerType === p.key);
          return (
            <TouchableOpacity
              key={p.key}
              style={[styles.integrationRow, idx > 0 && [styles.integrationBorder, { borderTopColor: palette.border.subtle }]]}
              onPress={() => openProviderEdit(p.key)}
              activeOpacity={0.7}
            >
              <View style={[styles.integrationIcon, { backgroundColor: active ? colors.green[50] : palette.bg.muted }]}>
                <Ionicons name={p.icon} size={18} color={active ? colors.green[600] : palette.text.tertiary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.integrationName, { color: palette.text.primary }]}>{p.name}</Text>
                <Text style={[styles.integrationDesc, { color: palette.text.tertiary }]}>{p.desc}</Text>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                <View style={[styles.statusBadge, active ? styles.statusActive : [styles.statusInactive, { backgroundColor: palette.bg.muted }]]}>
                  <Text style={[styles.statusText, active ? styles.statusTextActive : [styles.statusTextInactive, { color: palette.text.tertiary }]]}>
                    {active ? 'Активен' : 'Не настроен'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={14} color={palette.text.tertiary} />
              </View>
            </TouchableOpacity>
          );
        })}
      </AnimatedCard>

      {/* Platform Links */}
      <AnimatedCard
        index={1}
        style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
      >
        <View style={styles.sectionHeaderRow}>
          <Text style={[styles.sectionTitle, { color: palette.text.primary }]}>Площадки для отзывов</Text>
          <Ionicons name="globe-outline" size={16} color={palette.text.tertiary} />
        </View>
        {platforms.map((p, idx) => {
          const link = activeLinks.find((l: any) => l.platform === p.key);
          return (
            <TouchableOpacity
              key={p.key}
              style={[styles.integrationRow, idx > 0 && [styles.integrationBorder, { borderTopColor: palette.border.subtle }]]}
              onPress={() => openPlatformEdit(p.key)}
              activeOpacity={0.7}
            >
              <View style={[styles.integrationIcon, { backgroundColor: link ? colors.blue[50] : palette.bg.muted }]}>
                <Ionicons name={p.icon} size={18} color={link ? colors.blue[600] : palette.text.tertiary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.integrationName, { color: palette.text.primary }]}>{p.name}</Text>
                {link && (
                  <Text style={[styles.integrationDesc, { color: palette.text.tertiary }]} numberOfLines={1}>
                    {link.url}
                  </Text>
                )}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                <View style={[styles.statusBadge, link ? styles.statusActive : [styles.statusInactive, { backgroundColor: palette.bg.muted }]]}>
                  <Text style={[styles.statusText, link ? styles.statusTextActive : [styles.statusTextInactive, { color: palette.text.tertiary }]]}>
                    {link ? 'Настроен' : 'Не настроен'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={14} color={palette.text.tertiary} />
              </View>
            </TouchableOpacity>
          );
        })}
      </AnimatedCard>

      {/* Integration Edit Modal */}
      <Modal
        visible={!!editProvider}
        onClose={() => setEditProvider(null)}
        title={editProviderInfo?.name || 'Интеграция'}
      >
        <View style={styles.formField}>
          <Text style={styles.formLabel}>{editProviderInfo?.keyLabel || 'API ключ'}</Text>
          <TextInput
            value={apiKey}
            onChangeText={setApiKey}
            style={styles.formInput}
            placeholder="Вставьте API ключ..."
            placeholderTextColor={colors.gray[400]}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <View style={styles.formActions}>
          {activeIntegrations.find((i: any) => i.provider === editProvider) && (
            <TouchableOpacity
              style={styles.deleteBtn}
              onPress={() => {
                const existing = activeIntegrations.find((i: any) => i.provider === editProvider);
                if (existing) {
                  removeIntegration.mutate(existing.id);
                  setEditProvider(null);
                }
              }}
            >
              <Ionicons name="trash-outline" size={16} color={colors.red[500]} />
            </TouchableOpacity>
          )}
          <View style={{ flex: 1 }} />
          <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditProvider(null)}>
            <Text style={styles.cancelBtnText}>Отмена</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.saveBtn}
            onPress={() => {
              if (!apiKey.trim()) {
                Alert.alert('Ошибка', 'Введите API ключ');
                return;
              }
              upsertIntegration.mutate({ provider: editProvider, apiKey: apiKey.trim() });
            }}
          >
            {upsertIntegration.isPending ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={styles.saveBtnText}>Сохранить</Text>
            )}
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Platform Link Edit Modal */}
      <Modal
        visible={!!editPlatform}
        onClose={() => setEditPlatform(null)}
        title={editPlatformInfo?.name || 'Площадка'}
      >
        <View style={styles.formField}>
          <Text style={styles.formLabel}>Ссылка на страницу отзывов</Text>
          <TextInput
            value={platformUrl}
            onChangeText={setPlatformUrl}
            style={styles.formInput}
            placeholder="https://..."
            placeholderTextColor={colors.gray[400]}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
        </View>
        <View style={styles.formActions}>
          {activeLinks.find((l: any) => l.platform === editPlatform) && (
            <TouchableOpacity
              style={styles.deleteBtn}
              onPress={() => {
                const existing = activeLinks.find((l: any) => l.platform === editPlatform);
                if (existing) {
                  removeLink.mutate(existing.id);
                  setEditPlatform(null);
                }
              }}
            >
              <Ionicons name="trash-outline" size={16} color={colors.red[500]} />
            </TouchableOpacity>
          )}
          <View style={{ flex: 1 }} />
          <TouchableOpacity style={styles.cancelBtn} onPress={() => setEditPlatform(null)}>
            <Text style={styles.cancelBtnText}>Отмена</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.saveBtn}
            onPress={() => {
              if (!platformUrl.trim()) {
                Alert.alert('Ошибка', 'Введите ссылку');
                return;
              }
              upsertLink.mutate({ platform: editPlatform, url: platformUrl.trim() });
            }}
          >
            {upsertLink.isPending ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={styles.saveBtnText}>Сохранить</Text>
            )}
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
}

// ── Settings Tab ──
function SettingsTab() {
  const palette = useColors();
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useQuery({
    queryKey: ['marketing-settings'],
    queryFn: async () => {
      const res = await marketingApi.getSettings();
      return res.data;
    },
    staleTime: 60_000,
  });

  const [sendTime, setSendTime] = useState('');
  const [delayHours, setDelayHours] = useState('');
  const [autoSend, setAutoSend] = useState(false);
  const [messageTemplate, setMessageTemplate] = useState('');
  const [initialized, setInitialized] = useState(false);

  // Initialize from fetched settings
  if (settings && !initialized) {
    setSendTime(settings.sendTime || '10:00');
    setDelayHours(String(settings.feedbackDelayHours || 24));
    setAutoSend(settings.autoSendEnabled ?? false);
    setMessageTemplate(settings.messageTemplate || '');
    setInitialized(true);
  }

  const updateSettings = useMutation({
    mutationFn: (data: any) => marketingApi.updateSettings(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['marketing-settings'] });
      Alert.alert('Готово', 'Настройки сохранены');
    },
    onError: () => Alert.alert('Ошибка', 'Не удалось сохранить'),
  });

  if (isLoading) return <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary[600]} />;

  return (
    <View style={{ gap: spacing[4] }}>
      {/* Auto-send toggle */}
      <AnimatedCard
        index={0}
        style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
      >
        <TouchableOpacity style={styles.settingsToggleRow} onPress={() => setAutoSend(!autoSend)}>
          <View style={[styles.settingsIconBox, { backgroundColor: autoSend ? colors.green[50] : palette.bg.muted }]}>
            <Ionicons name="send" size={18} color={autoSend ? colors.green[600] : palette.text.tertiary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.settingsLabel, { color: palette.text.primary }]}>Автоматическая отправка</Text>
            <Text style={[styles.settingsHint, { color: palette.text.tertiary }]}>Отправлять запросы на отзыв автоматически</Text>
          </View>
          <Ionicons
            name={autoSend ? 'checkbox' : 'square-outline'}
            size={24}
            color={autoSend ? colors.green[600] : palette.text.tertiary}
          />
        </TouchableOpacity>
      </AnimatedCard>

      {/* Timing settings */}
      <AnimatedCard
        index={1}
        style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
      >
        <Text style={[styles.sectionTitle, { color: palette.text.primary }]}>Время отправки</Text>
        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Время отправки (ЧЧ:ММ)</Text>
          <TextInput
            value={sendTime}
            onChangeText={setSendTime}
            style={[styles.formInput, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary }]}
            placeholder="10:00"
            placeholderTextColor={palette.text.tertiary}
          />
        </View>
        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Задержка после визита (часы)</Text>
          <TextInput
            value={delayHours}
            onChangeText={setDelayHours}
            style={[styles.formInput, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary }]}
            keyboardType="numeric"
            placeholder="24"
            placeholderTextColor={palette.text.tertiary}
          />
        </View>
      </AnimatedCard>

      {/* Message template */}
      <AnimatedCard
        index={2}
        style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
      >
        <Text style={[styles.sectionTitle, { color: palette.text.primary }]}>Шаблон сообщения</Text>
        <View style={styles.formField}>
          <TextInput
            value={messageTemplate}
            onChangeText={setMessageTemplate}
            style={[styles.formInput, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary, minHeight: 100, textAlignVertical: 'top' }]}
            multiline
            placeholder={'Здравствуйте, {client_name}!\nСпасибо за визит...\n{review_link}'}
            placeholderTextColor={palette.text.tertiary}
          />
          <Text style={[styles.templateHint, { color: palette.text.tertiary }]}>
            Переменные: {'{client_name}'}, {'{car_model}'}, {'{review_link}'}, {'{company_name}'}
          </Text>
        </View>
      </AnimatedCard>

      {/* Save button */}
      <TouchableOpacity
        style={styles.settingsSaveBtn}
        onPress={() =>
          updateSettings.mutate({
            sendTime,
            delayHours: Number(delayHours) || 24,
            autoSendEnabled: autoSend,
            messageTemplate,
          })
        }
      >
        {updateSettings.isPending ? (
          <ActivityIndicator color={colors.white} size="small" />
        ) : (
          <>
            <Ionicons name="checkmark-circle" size={18} color={colors.white} />
            <Text style={styles.settingsSaveBtnText}>Сохранить настройки</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

// ── Main Screen ──
export default function MarketingScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [refreshing, setRefreshing] = useState(false);

  const isAdmin =
    user?.role === UserRole.DIRECTOR || user?.role === UserRole.SUPERADMIN || (user?.role as string) === 'admin';
  const tabs: { key: TabKey; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: 'dashboard', label: 'Обзор', icon: 'pie-chart-outline' },
    { key: 'reviews', label: 'Отзывы', icon: 'chatbubbles-outline' },
    { key: 'integrations', label: 'Каналы', icon: 'link-outline' },
    ...(isAdmin
      ? [{ key: 'settings' as TabKey, label: 'Настройки', icon: 'settings-outline' as keyof typeof Ionicons.glyphMap }]
      : []),
  ];

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['marketing-dashboard'] });
    await queryClient.invalidateQueries({ queryKey: ['marketing-reviews'] });
    setRefreshing(false);
  };

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Маркетинг" onBack={() => navigation.goBack()} />

      {/* Tabs */}
      <View style={[styles.tabBar, { backgroundColor: palette.bg.card }]}>
        {tabs.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={[styles.tab, { backgroundColor: palette.bg.muted }, active && styles.tabActive]}
              onPress={() => setActiveTab(tab.key)}
            >
              <Ionicons
                name={(active ? tab.icon.replace('-outline', '') : tab.icon) as any}
                size={18}
                color={active ? colors.primary[600] : palette.text.tertiary}
              />
              <Text style={[styles.tabText, { color: palette.text.tertiary }, active && styles.tabTextActive]}>{tab.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + spacing[4] }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
        }
      >
        {activeTab === 'dashboard' && <DashboardTab />}
        {activeTab === 'reviews' && <ReviewsTab />}
        {activeTab === 'integrations' && <IntegrationsTab />}
        {activeTab === 'settings' && <SettingsTab />}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  // Tabs
  tabBar: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3],
    paddingBottom: spacing[2],
    gap: spacing[1.5],
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[2],
    borderRadius: borderRadius.xl,
    backgroundColor: colors.gray[50],
  },
  tabActive: { backgroundColor: colors.primary[50], borderWidth: 1, borderColor: colors.primary[200] },
  tabText: { fontSize: 11, fontWeight: fontWeight.medium, color: colors.gray[400], marginTop: 3 },
  tabTextActive: { color: colors.primary[600], fontWeight: fontWeight.bold },
  // Content
  scroll: { flex: 1 },
  scrollContent: { padding: spacing[4], paddingBottom: spacing[8] },
  // Stats
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[3] },
  statCard: {
    width: '47%',
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: colors.gray[100],
    padding: spacing[4],
    shadowColor: colors.black,
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  statIconBox: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[3],
  },
  statValue: { fontSize: fontSize['2xl'], fontWeight: fontWeight.bold, color: colors.gray[900] },
  statLabel: { fontSize: fontSize.xs, color: colors.gray[400], marginTop: 2 },
  // Card
  card: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: colors.gray[100],
    padding: spacing[4],
    shadowColor: colors.black,
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
    marginBottom: spacing[3],
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing[3],
  },
  // Funnel
  funnelLabel: { fontSize: fontSize.xs, color: colors.gray[600] },
  funnelValue: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  funnelBarBg: { height: 8, backgroundColor: colors.gray[100], borderRadius: 4, overflow: 'hidden' },
  funnelBarFill: { height: 8, borderRadius: 4 },
  // Employee ratings
  empRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing[3], gap: spacing[3] },
  empRowBorder: { borderTopWidth: 1, borderTopColor: colors.gray[50] },
  empRankBadge: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.gray[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  empRankText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[400] },
  empInfo: { flex: 1, minWidth: 0 },
  empName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  empReviewCount: { fontSize: 11, color: colors.gray[400] },
  empRating: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.gray[900] },
  // Alert
  alertCard: { backgroundColor: colors.red[50], borderColor: colors.red[200] },
  alertText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.red[700] },
  // Empty
  emptyText: { textAlign: 'center', padding: spacing[8], fontSize: fontSize.sm, color: colors.gray[400] },
  emptyCard: { alignItems: 'center', paddingVertical: spacing[12], gap: spacing[3] },
  emptyTitle: { fontSize: fontSize.sm, color: colors.gray[400] },
  // Reviews
  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[4] },
  monthBtn: {
    padding: spacing[2],
    borderRadius: borderRadius.full,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray[200],
  },
  monthLabel: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  reviewCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: colors.gray[100],
    padding: spacing[4],
    shadowColor: colors.black,
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 2,
  },
  reviewHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  reviewClientName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  reviewDate: { fontSize: fontSize.xs, color: colors.gray[400], marginTop: 2 },
  reviewComment: { fontSize: fontSize.sm, color: colors.gray[700], marginTop: spacing[3], lineHeight: 20 },
  reviewEmployeeTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    marginTop: spacing[3],
    paddingTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colors.gray[100],
  },
  reviewEmployeeText: { fontSize: fontSize.xs, color: colors.gray[500] },
  // Integrations
  integrationRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingVertical: spacing[3] },
  integrationBorder: { borderTopWidth: 1, borderTopColor: colors.gray[50] },
  integrationIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  integrationName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900] },
  integrationDesc: { fontSize: fontSize.xs, color: colors.gray[400], marginTop: 1 },
  statusBadge: { paddingHorizontal: spacing[2], paddingVertical: 3, borderRadius: borderRadius.full },
  statusActive: { backgroundColor: colors.green[50] },
  statusInactive: { backgroundColor: colors.gray[100] },
  statusText: { fontSize: 10, fontWeight: fontWeight.medium },
  statusTextActive: { color: colors.green[700] },
  statusTextInactive: { color: colors.gray[500] },
  // Form
  formField: { marginBottom: spacing[3] },
  formLabel: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.gray[700],
    marginBottom: spacing[1.5],
  },
  formInput: {
    backgroundColor: colors.gray[50],
    borderWidth: 1,
    borderColor: colors.gray[200],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[2.5],
    fontSize: fontSize.sm,
    color: colors.gray[900],
  },
  formActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingTop: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colors.gray[100],
  },
  cancelBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.gray[200],
  },
  cancelBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[700] },
  saveBtn: {
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primary[600],
  },
  saveBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.white },
  deleteBtn: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.red[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Settings
  settingsToggleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  settingsIconBox: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  settingsLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  settingsHint: { fontSize: fontSize.xs, color: colors.gray[400], marginTop: 2 },
  templateHint: { fontSize: fontSize.xs, color: colors.gray[400], marginTop: spacing[1.5], fontStyle: 'italic' },
  settingsSaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    backgroundColor: colors.primary[600],
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[3.5],
  },
  settingsSaveBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.white },
});
