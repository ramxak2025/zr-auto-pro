/**
 * ReviewsReputationScreen — «Отзывы и репутация».
 *
 * One of the four «Маркетинг» directions (hub → this screen). Owns
 * everything about COLLECTING reviews and the shop's public REPUTATION —
 * the pure analytics (KPI / воронка / рейтинг сотрудников) live in the
 * sibling «Маркетинговые отчёты» screen (MarketingReportsScreen) so the
 * two concerns stop competing for the same «Сводка» tab.
 *
 * Two tabs:
 *   • Мотивация — manual review-request CTA, «Подарок за отзыв» editor and
 *                 «Источники клиентов» editor (owner). (The review-platform
 *                 links moved to the top-level «Настройки» section, so the
 *                 read-only «Площадки» summary no longer lives here.)
 *   • Отзывы    — «Рейтинг мастеров» leaderboard on top of the
 *                 month-paginated review feed.
 *
 * Header trailing slot opens a one-off SMS / WhatsApp review request to a
 * picked client (RequestReviewModal). Extracted verbatim from the former
 * MarketingScreen so no review-collection behaviour is lost in the regroup.
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
import { useAuth } from '../contexts/AuthContext';
import { marketingApi, clientsApi, clientSourcesApi } from '../api/services';
import { colors, fontSize, fontWeight, borderRadius, spacing, softTint } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import AnimatedCard from '../components/AnimatedCard';
import IosScreenHeader from '../components/IosScreenHeader';
import Modal from '../components/Modal';
import EmptyState from '../components/EmptyState';
import SectionHeader from '../components/SectionHeader';
import { Text } from '../platform/Typography';
import { haptic } from '../platform/haptics';
import type { Client, EmployeeReviewRating, ReviewSettings } from '../../../shared/types';

const MAX_SOURCE_LEN = 100;

/** Trim + collapse whitespace + case-insensitive dedupe + length clamp. */
function normalizeSources(list: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const value = raw.trim().replace(/\s+/g, ' ').slice(0, MAX_SOURCE_LEN);
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

type TabKey = 'settings' | 'reviews';

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

/** Memoised review row — keeps the feed `.map(...)` from rebuilding every row on parent re-render. */
interface ReviewItemProps {
  review: {
    id?: string;
    clientName?: string;
    createdAt: string;
    rating: number;
    comment?: string;
    employeeName?: string;
  };
  index: number;
  palette: ReturnType<typeof useColors>;
}
const ReviewItem = React.memo(function ReviewItem({ review, index, palette }: ReviewItemProps) {
  return (
    <AnimatedCard
      index={index}
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
          <Text style={[styles.reviewEmployeeText, { color: palette.text.tertiary }]}>{review.employeeName}</Text>
        </View>
      )}
    </AnimatedCard>
  );
});

// ─────────────────────────────────────────────────────────────────────
//  Motivational-message editor card
// ─────────────────────────────────────────────────────────────────────

function MotivationCard() {
  const palette = useColors();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<string>('');
  const [dirty, setDirty] = useState(false);

  const settingsQuery = useQuery({
    queryKey: ['marketing-review-settings'],
    queryFn: async () => (await marketingApi.getSettings()).data,
    staleTime: 60_000,
  });

  // Sync local draft with server state — but only when we're not mid-edit
  // (otherwise typing would be clobbered every time React Query revalidates).
  React.useEffect(() => {
    if (settingsQuery.data && !dirty) {
      setDraft(settingsQuery.data.motivationMessage ?? '');
    }
  }, [settingsQuery.data, dirty]);

  const save = useMutation({
    mutationFn: () => marketingApi.updateSettings({ motivationMessage: draft.trim() } as Partial<ReviewSettings>),
    onSuccess: () => {
      haptic('success');
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ['marketing-review-settings'] });
      Alert.alert('Сохранено', 'Сообщение будет показано клиенту на странице отзыва');
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось сохранить');
    },
  });

  const placeholder = 'Например: «Замена воздушного фильтра в подарок за честный отзыв»';

  return (
    <AnimatedCard
      index={0}
      style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
    >
      <View style={styles.sectionHeaderRow}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
          <View
            style={[
              styles.giftBadge,
              { backgroundColor: palette.mode === 'dark' ? softTint(colors.amber[600], 'dark') : colors.amber[50] },
            ]}
          >
            <Ionicons name="gift-outline" size={16} color={colors.amber[700]} />
          </View>
          <Text style={[styles.sectionTitle, { color: palette.text.primary, marginBottom: 0 }]}>Подарок за отзыв</Text>
        </View>
        {settingsQuery.data?.motivationMessage ? <View style={styles.motivationActiveDot} /> : null}
      </View>

      <Text style={[styles.motivationHint, { color: palette.text.tertiary }]}>
        Эта фраза будет показана клиенту на странице оценки, а также подставлена в шаблон сообщения вместо{' '}
        {'{motivation}'}.
      </Text>

      <TextInput
        value={draft}
        onChangeText={(t) => {
          setDraft(t);
          if (!dirty) setDirty(true);
        }}
        multiline
        numberOfLines={3}
        placeholder={placeholder}
        placeholderTextColor={palette.text.tertiary}
        style={[
          styles.motivationInput,
          {
            backgroundColor: palette.bg.muted,
            borderColor: dirty ? palette.accent.primary : palette.border.subtle,
            color: palette.text.primary,
          },
        ]}
      />

      <TouchableOpacity
        style={[
          styles.motivationSaveBtn,
          {
            backgroundColor: dirty ? palette.accent.primary : palette.bg.muted,
          },
          (!dirty || save.isPending) && { opacity: 0.7 },
        ]}
        disabled={!dirty || save.isPending}
        onPress={() => {
          haptic('tap');
          save.mutate();
        }}
      >
        {save.isPending ? (
          <ActivityIndicator size="small" color={dirty ? colors.white : palette.text.tertiary} />
        ) : (
          <>
            <Ionicons name="checkmark" size={16} color={dirty ? colors.white : palette.text.tertiary} />
            <Text style={[styles.motivationSaveText, { color: dirty ? colors.white : palette.text.tertiary }]}>
              {dirty ? 'Сохранить' : 'Без изменений'}
            </Text>
          </>
        )}
      </TouchableOpacity>
    </AnimatedCard>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Client-source list editor (owner-editable)
//  This is the list that powers the "Откуда узнал" picker when creating
//  a client. Edited here, consumed in ClientsScreen.
// ─────────────────────────────────────────────────────────────────────

function ClientSourcesCard() {
  const palette = useColors();
  const queryClient = useQueryClient();

  const sourcesQuery = useQuery({
    queryKey: ['client-sources'],
    queryFn: async () => (await clientSourcesApi.get()).data,
    staleTime: 60_000,
  });
  const sources = sourcesQuery.data?.sources ?? [];

  // Editor modal: editIndex === -1 → adding new, >= 0 → renaming existing.
  const [editorOpen, setEditorOpen] = useState(false);
  const [editIndex, setEditIndex] = useState(-1);
  const [draft, setDraft] = useState('');

  const save = useMutation({
    mutationFn: (next: string[]) => clientSourcesApi.update(normalizeSources(next)),
    onSuccess: (res) => {
      queryClient.setQueryData(['client-sources'], res.data);
      queryClient.invalidateQueries({ queryKey: ['client-sources'] });
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось сохранить список источников');
    },
  });

  const openAdd = () => {
    setEditIndex(-1);
    setDraft('');
    setEditorOpen(true);
  };

  const openRename = (index: number) => {
    setEditIndex(index);
    setDraft(sources[index] ?? '');
    setEditorOpen(true);
  };

  const commitEditor = () => {
    const value = draft.trim().replace(/\s+/g, ' ').slice(0, MAX_SOURCE_LEN);
    if (!value) {
      Alert.alert('Пустое значение', 'Введите название источника');
      return;
    }
    const exists = sources.some((s, i) => i !== editIndex && s.toLowerCase() === value.toLowerCase());
    if (exists) {
      Alert.alert('Уже есть', 'Такой источник уже в списке');
      return;
    }
    const next = [...sources];
    if (editIndex >= 0) next[editIndex] = value;
    else next.push(value);
    haptic('success');
    setEditorOpen(false);
    save.mutate(next);
  };

  const removeAt = (index: number) => {
    const name = sources[index];
    Alert.alert('Удалить источник?', name, [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () => {
          haptic('tap');
          save.mutate(sources.filter((_, i) => i !== index));
        },
      },
    ]);
  };

  return (
    <>
      <AnimatedCard
        index={0}
        style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
      >
        <View style={styles.sectionHeaderRow}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
            <View style={[styles.giftBadge, { backgroundColor: palette.accent.primarySoft }]}>
              <Ionicons name="pricetags-outline" size={16} color={palette.accent.primary} />
            </View>
            <Text style={[styles.sectionTitle, { color: palette.text.primary, marginBottom: 0 }]}>
              Источники клиентов
            </Text>
          </View>
          <TouchableOpacity
            onPress={() => {
              haptic('tap');
              openAdd();
            }}
            hitSlop={8}
            style={[styles.sourceAddBtn, { backgroundColor: palette.accent.primarySoft }]}
            accessibilityRole="button"
            accessibilityLabel="Добавить источник"
          >
            <Ionicons name="add" size={18} color={palette.accent.primary} />
          </TouchableOpacity>
        </View>

        <Text style={[styles.motivationHint, { color: palette.text.tertiary }]}>
          Откуда клиент узнал о сервисе. Этот список появляется при добавлении клиента. Если список пуст — источник не
          запрашивается.
        </Text>

        {sourcesQuery.isLoading && sources.length === 0 ? (
          <ActivityIndicator color={palette.accent.primary} style={{ marginVertical: spacing[4] }} />
        ) : sources.length === 0 ? (
          <EmptyState
            title="Источников пока нет"
            description="Добавьте первый источник, например «Авито» или «По рекомендации»"
            action={{ label: 'Добавить', onPress: openAdd }}
          />
        ) : (
          <View>
            {sources.map((source, idx) => (
              <View
                key={`${source}-${idx}`}
                style={[
                  styles.sourceRow,
                  idx > 0 && [styles.sourceRowBorder, { borderTopColor: palette.border.subtle }],
                ]}
              >
                <View style={[styles.sourceBadge, { backgroundColor: palette.bg.muted }]}>
                  <Ionicons name="pricetag-outline" size={14} color={palette.text.secondary} />
                </View>
                <Text style={[styles.sourceName, { color: palette.text.primary }]} numberOfLines={1}>
                  {source}
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    haptic('tap');
                    openRename(idx);
                  }}
                  hitSlop={8}
                  style={styles.sourceIconBtn}
                  accessibilityLabel="Переименовать"
                >
                  <Ionicons name="create-outline" size={18} color={palette.text.secondary} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => removeAt(idx)}
                  hitSlop={8}
                  style={styles.sourceIconBtn}
                  accessibilityLabel="Удалить"
                >
                  <Ionicons name="trash-outline" size={18} color={colors.red[500]} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </AnimatedCard>

      {/* Add / rename modal — Modal already renders ModalBlurBackdrop */}
      <Modal
        visible={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editIndex >= 0 ? 'Переименовать источник' : 'Новый источник'}
      >
        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Название</Text>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            maxLength={MAX_SOURCE_LEN}
            style={[
              styles.formInput,
              {
                backgroundColor: palette.bg.muted,
                borderColor: palette.border.subtle,
                color: palette.text.primary,
              },
            ]}
            placeholder="Например: Авито, Инстаграм, По рекомендации"
            placeholderTextColor={palette.text.tertiary}
            autoFocus
            returnKeyType="done"
            onSubmitEditing={commitEditor}
          />
        </View>
        <TouchableOpacity
          style={[
            styles.primaryBtn,
            { backgroundColor: palette.accent.primary, marginTop: spacing[1] },
            (save.isPending || !draft.trim()) && { opacity: 0.55 },
          ]}
          disabled={save.isPending || !draft.trim()}
          onPress={commitEditor}
        >
          {save.isPending ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <>
              <Ionicons name="checkmark" size={16} color={colors.white} />
              <Text style={styles.primaryBtnText}>Сохранить</Text>
            </>
          )}
        </TouchableOpacity>
      </Modal>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Рейтинг мастеров — employee leaderboard by review score
//  Shares the ['marketing-dashboard'] cache key with MarketingReportsScreen
//  so opening either screen warms the other. Read-only, sits atop the feed.
// ─────────────────────────────────────────────────────────────────────

/** Medal tint for the top-3 index badge; falls back to a neutral chip. */
function medalTint(rank: number, palette: ReturnType<typeof useColors>): { bg: string; fg: string } {
  const dark = palette.mode === 'dark';
  switch (rank) {
    case 1: // gold
      return { bg: dark ? softTint(colors.amber[600], 'dark') : colors.amber[100], fg: colors.amber[700] };
    case 2: // silver
      return { bg: dark ? softTint(colors.slate[500], 'dark') : colors.slate[100], fg: colors.slate[600] };
    case 3: // bronze
      return { bg: dark ? softTint(colors.orange[500], 'dark') : colors.orange[50], fg: colors.orange[700] };
    default:
      return { bg: palette.bg.muted, fg: palette.text.tertiary };
  }
}

function LeaderboardRow({ item, rank }: { item: EmployeeReviewRating; rank: number }) {
  const palette = useColors();
  const tint = medalTint(rank, palette);
  const isMedal = rank <= 3;
  return (
    <View style={[styles.leaderRow, rank > 1 && [styles.leaderRowBorder, { borderTopColor: palette.border.subtle }]]}>
      <View style={[styles.rankBadge, { backgroundColor: tint.bg }]}>
        <Text style={[styles.rankBadgeText, { color: tint.fg }]}>{isMedal ? rank : `#${rank}`}</Text>
      </View>
      <Text style={[styles.leaderName, { color: palette.text.primary }]} numberOfLines={1}>
        {item.employeeName}
      </Text>
      <View style={styles.leaderScore}>
        <Ionicons name="star" size={13} color={colors.amber[600]} />
        <Text style={[styles.leaderRating, { color: palette.text.primary }]}>{item.avgRating.toFixed(1)}</Text>
      </View>
      <Text style={[styles.leaderCount, { color: palette.text.tertiary }]}>{item.reviewCount} отз.</Text>
    </View>
  );
}

function LeaderboardCard() {
  const palette = useColors();
  const { data } = useQuery({
    queryKey: ['marketing-dashboard'],
    queryFn: async () => (await marketingApi.getDashboard()).data,
    staleTime: 60_000,
  });

  const ranked = useMemo(() => {
    const list = data?.employeeRatings ?? [];
    return [...list].sort((a, b) => b.avgRating - a.avgRating || b.reviewCount - a.reviewCount);
  }, [data?.employeeRatings]);

  return (
    <AnimatedCard
      index={0}
      style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
    >
      {ranked.length === 0 ? (
        <View style={styles.leaderEmpty}>
          <Ionicons name="trophy-outline" size={28} color={palette.text.tertiary} />
          <Text style={[styles.leaderEmptyText, { color: palette.text.tertiary }]}>Пока нет отзывов по мастерам</Text>
        </View>
      ) : (
        ranked.map((item, idx) => <LeaderboardRow key={item.employeeId} item={item} rank={idx + 1} />)
      )}
    </AnimatedCard>
  );
}

// ─────────────────────────────────────────────────────────────────────
//  Настройки (review collection + reputation)
// ─────────────────────────────────────────────────────────────────────

function SettingsTab({ onRequestReview }: { onRequestReview: () => void }) {
  const palette = useColors();
  const { hasPermission } = useAuth();
  // Справочник источников клиентов — ключ settings_manage (сервер: POST
  // /client-sources → тот же ключ; admin живёт по матрице из /auth/me).
  const canEditSources = hasPermission('settings_manage');

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
          <Text style={[styles.ctaSub, { color: palette.text.secondary }]}>Отправьте клиенту персональную ссылку</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={palette.text.tertiary} />
      </Pressable>

      {/* Motivational gift editor */}
      <MotivationCard />

      {/* Client-source list editor (owner-only) */}
      {canEditSources && <ClientSourcesCard />}
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
  }, [month]);

  return (
    <View style={{ gap: spacing[4] }}>
      {/* Рейтинг мастеров — leaderboard atop the feed */}
      <SectionHeader title="Рейтинг мастеров" />
      <LeaderboardCard />

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
          <ReviewItem key={review.id || idx} review={review} index={idx} palette={palette} />
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

  // Preview the motivational gift sentence — removes the "wait, what message
  // will the client actually see?" anxiety.
  const settingsQuery = useQuery({
    queryKey: ['marketing-review-settings'],
    queryFn: async () => (await marketingApi.getSettings()).data,
    staleTime: 60_000,
    enabled: visible,
  });
  const motivation = settingsQuery.data?.motivationMessage?.trim() || '';

  // Debounce-ish: refetch on every change but staleTime swallows duplicates.
  const clientsQuery = useQuery({
    queryKey: ['marketing-request-clients', search],
    queryFn: async () => (await clientsApi.getAll({ search, page: 1, limit: 30 })).data,
    enabled: visible,
    staleTime: 30_000,
  });
  const clients = clientsQuery.data?.data ?? [];

  const sendSms = useMutation({
    mutationFn: ({ phone, text }: { phone: string; text: string }) => marketingApi.sendSms({ phone, text }),
  });

  const buildText = (client: Client): string => {
    const firstName = client.fullName.split(' ')[0] || client.fullName;
    const greeting =
      channel === 'whatsapp'
        ? `Здравствуйте, ${firstName}! Будем благодарны за отзыв о нашем сервисе.`
        : `Здравствуйте, ${firstName}! Оставьте, пожалуйста, отзыв о работе сервиса. Ссылка придёт отдельным сообщением.`;
    return motivation ? `${greeting}\n\n${motivation}` : greeting;
  };

  const handleSend = () => {
    if (!selected) {
      Alert.alert('Выберите клиента', 'Сначала выберите клиента из списка');
      return;
    }
    if (!selected.phone) {
      Alert.alert('Нет телефона', 'У клиента не указан номер телефона');
      return;
    }
    sendSms.mutate(
      { phone: selected.phone, text: buildText(selected) },
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
      {/* Motivation preview — what the client will actually see */}
      {motivation ? (
        <View
          style={[
            styles.motivationPreview,
            palette.mode === 'dark'
              ? { borderColor: palette.border.subtle, backgroundColor: softTint(colors.amber[600], 'dark') }
              : { borderColor: colors.amber[200], backgroundColor: colors.amber[50] },
          ]}
        >
          <View
            style={[
              styles.giftBadge,
              { backgroundColor: palette.mode === 'dark' ? softTint(colors.amber[600], 'dark') : colors.amber[100] },
            ]}
          >
            <Ionicons name="gift-outline" size={14} color={colors.amber[700]} />
          </View>
          <View style={{ flex: 1 }}>
            <Text
              style={[
                styles.motivationPreviewLabel,
                { color: palette.mode === 'dark' ? colors.amber[200] : colors.amber[800] },
              ]}
            >
              Клиент увидит
            </Text>
            <Text
              style={[
                styles.motivationPreviewText,
                { color: palette.mode === 'dark' ? colors.amber[200] : colors.amber[800] },
              ]}
            >
              {motivation}
            </Text>
          </View>
        </View>
      ) : null}

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
                  style={[styles.channelChipText, { color: active ? palette.accent.primary : palette.text.secondary }]}
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
          <Text style={[styles.platformsHint, { color: palette.text.tertiary }]}>Ничего не найдено</Text>
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
                  {active && <Ionicons name="checkmark" size={20} color={palette.accent.primary} />}
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
            <Ionicons name="paper-plane" size={16} color={colors.white} />
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

export default function ReviewsReputationScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const [activeTab, setActiveTab] = useState<TabKey>('settings');
  const [refreshing, setRefreshing] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);

  const tabs: {
    key: TabKey;
    label: string;
    iconOutline: keyof typeof Ionicons.glyphMap;
    iconSolid: keyof typeof Ionicons.glyphMap;
  }[] = [
    { key: 'settings', label: 'Мотивация', iconOutline: 'options-outline', iconSolid: 'options' },
    { key: 'reviews', label: 'Отзывы', iconOutline: 'chatbubbles-outline', iconSolid: 'chatbubbles' },
  ];

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['marketing-dashboard'] }),
      queryClient.invalidateQueries({ queryKey: ['marketing-reviews'] }),
      queryClient.invalidateQueries({ queryKey: ['marketing-review-settings'] }),
      queryClient.invalidateQueries({ queryKey: ['client-sources'] }),
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
                name={active ? tab.iconSolid : tab.iconOutline}
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
        removeClippedSubviews
        scrollEventThrottle={16}
      >
        {activeTab === 'settings' && <SettingsTab onRequestReview={() => setRequestOpen(true)} />}
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

  // Motivational gift card
  giftBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  motivationActiveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.green[500],
  },
  motivationHint: {
    fontSize: fontSize.xs,
    lineHeight: 18,
    marginBottom: spacing[3],
  },
  motivationInput: {
    borderWidth: 1.5,
    borderRadius: borderRadius.xl,
    padding: spacing[3],
    fontSize: fontSize.sm,
    minHeight: 86,
    textAlignVertical: 'top',
    marginBottom: spacing[3],
  },
  motivationSaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[3],
  },
  motivationSaveText: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },

  // Motivation preview inside RequestReviewModal
  motivationPreview: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2.5],
    borderWidth: 1,
    borderRadius: borderRadius.xl,
    padding: spacing[3],
    marginBottom: spacing[3],
  },
  motivationPreviewLabel: {
    fontSize: 10,
    fontWeight: fontWeight.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  motivationPreviewText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    lineHeight: 19,
  },

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

  // Client sources
  sourceAddBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    paddingVertical: spacing[2.5],
  },
  sourceRowBorder: { borderTopWidth: 1 },
  sourceBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sourceName: { flex: 1, fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  sourceIconBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Shared hint text (also used by the request-review modal's empty state)
  platformsHint: { fontSize: fontSize.xs, lineHeight: 18 },

  // Leaderboard (рейтинг мастеров)
  leaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[2.5],
  },
  leaderRowBorder: { borderTopWidth: 1 },
  rankBadge: {
    minWidth: 30,
    height: 30,
    paddingHorizontal: spacing[1.5],
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankBadgeText: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, fontVariant: ['tabular-nums'] },
  leaderName: { flex: 1, fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  leaderScore: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  leaderRating: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, fontVariant: ['tabular-nums'] },
  leaderCount: { fontSize: fontSize.xs, minWidth: 56, textAlign: 'right', fontVariant: ['tabular-nums'] },
  leaderEmpty: { alignItems: 'center', gap: spacing[2], paddingVertical: spacing[4] },
  leaderEmptyText: { fontSize: fontSize.sm },

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
