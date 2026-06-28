/**
 * KnowledgeArticleScreen — the article reader.
 *
 * Sections (top → bottom):
 *   • cover image (if any)
 *   • title + category / updated-at meta
 *   • markdown body (in-house renderer — no native module)
 *   • attachments (tap → open URL)
 *
 * Regulation behaviour:
 *   • type==='regulation' && !acknowledged → sticky bottom «Ознакомлен» CTA.
 *     Tap → acknowledge(id) → flips to the acknowledged state and refreshes
 *     the pending-count badge (home + Ещё menu).
 *   • already acknowledged → green «✓ Вы ознакомились».
 *
 * Manager extras (director/admin/superadmin):
 *   • header «изменить» → editor
 *   • for regulations: «Кто ознакомился: N/M» → modal (who read / who hasn't).
 */
import React from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import IosScreenHeader from '../components/IosScreenHeader';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import QueryErrorState from '../components/QueryErrorState';
import CachedImage from '../components/CachedImage';
import Markdown from '../components/knowledge/Markdown';
import KnowledgeBlocks from '../components/KnowledgeBlocks';
import VideoEmbed from '../components/knowledge/VideoEmbed';
import { Text } from '../platform/Typography';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { useColors } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { knowledgeApi } from '../api/services';
import { getImageUrl } from '../api/axios';
import { spacing, borderRadius, colors, softTint } from '../theme';
import { haptic } from '../platform/haptics';
import { formatDateShort } from '../../../shared/utils/formatters';
import { UserRole } from '../../../shared/types';
import type { KnowledgeArticle, KnowledgeAcksResponse, ArticleFeedbackResult } from '../../../shared/types';

type ParamList = { KnowledgeArticle: { id: string; title?: string } };

/**
 * Visible height of the sticky ack CTA band — the action bar floats just
 * ABOVE the tab bar (anchored at `bottom: tabBarHeight`), so its own height
 * is only button minHeight (52) + comfortable vertical padding, NOT a second
 * full tab-bar inset. The scroll content reserves this band so the last
 * article content never hides under the CTA.
 *   button (52) + paddingTop (spacing[3] = 12) + paddingBottom (spacing[3] = 12)
 */
const ACK_BAR_HEIGHT = 52 + spacing[3] + spacing[3];

/** Small visible gap between the floating action bar and the tab bar below it. */
const ACK_BAR_GAP = spacing[2];

/** Per-article AsyncStorage key holding the regulation version this user acked. */
const ackedVersionKey = (id: string) => `kb:ackedVersion:${id}`;

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

export default function KnowledgeArticleScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<ParamList, 'KnowledgeArticle'>>();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { isRole } = useAuth();
  const isManager = isRole(UserRole.DIRECTOR, UserRole.ADMIN, UserRole.SUPERADMIN);

  const id = route.params?.id;
  const [acksOpen, setAcksOpen] = React.useState(false);
  // The regulation version this user previously acknowledged (from AsyncStorage).
  // `undefined` = not yet read; `null` = never acked locally.
  const [ackedVersion, setAckedVersion] = React.useState<number | null | undefined>(undefined);

  const {
    data: article,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery<KnowledgeArticle>({
    queryKey: ['knowledge-article', id],
    queryFn: async () => (await knowledgeApi.getArticle(id)).data,
    enabled: !!id,
    staleTime: 60_000,
  });

  const isRegulation = article?.type === 'regulation';

  // Split attachments: videos render as inline players (VideoEmbed), the rest
  // (documents / images) keep the existing tap-to-open file list.
  const videoAttachments = React.useMemo(
    () => (article?.attachments ?? []).filter((a) => a.type === 'video'),
    [article?.attachments],
  );
  const fileAttachments = React.useMemo(
    () => (article?.attachments ?? []).filter((a) => a.type !== 'video'),
    [article?.attachments],
  );

  // Read the locally-remembered acked version once we know the id.
  React.useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(ackedVersionKey(id))
      .then((raw) => {
        if (!alive) return;
        const parsed = raw != null ? Number(raw) : NaN;
        setAckedVersion(Number.isFinite(parsed) ? parsed : null);
      })
      .catch(() => alive && setAckedVersion(null));
    return () => {
      alive = false;
    };
  }, [id]);

  const ackMutation = useMutation({
    mutationFn: async () => (await knowledgeApi.acknowledge(id)).data,
    onSuccess: (res) => {
      haptic('success');
      // Remember which version we just acked, so a later version bump is detected.
      const acked = res?.version ?? article?.version ?? 1;
      setAckedVersion(acked);
      AsyncStorage.setItem(ackedVersionKey(id), String(acked)).catch(() => {});
      // Optimistically flip the local cache to acknowledged.
      queryClient.setQueryData<KnowledgeArticle>(['knowledge-article', id], (prev) =>
        prev ? { ...prev, acknowledged: true } : prev,
      );
      // Refresh the pending-count badge everywhere it's shown.
      queryClient.invalidateQueries({ queryKey: ['knowledge-regulations-pending'] });
      queryClient.invalidateQueries({ queryKey: ['knowledge-article-acks', id] });
    },
  });

  // ── Feedback («Было полезно?») ──────────────────────────────────────────
  // Local mirror of the helpful/not-helpful counts + this user's vote, seeded
  // from the article and updated optimistically on tap.
  const [feedback, setFeedback] = React.useState<{
    helpfulCount: number;
    notHelpfulCount: number;
    myFeedback?: boolean;
  } | null>(null);

  React.useEffect(() => {
    if (article) {
      setFeedback({
        helpfulCount: article.helpfulCount ?? 0,
        notHelpfulCount: article.notHelpfulCount ?? 0,
        myFeedback: article.myFeedback,
      });
    }
  }, [article?.id, article?.helpfulCount, article?.notHelpfulCount, article?.myFeedback]);

  const feedbackMutation = useMutation({
    mutationFn: async (helpful: boolean) => (await knowledgeApi.articleFeedback(id, helpful)).data,
    onSuccess: (res: ArticleFeedbackResult) => {
      haptic('select');
      setFeedback({ helpfulCount: res.helpfulCount, notHelpfulCount: res.notHelpfulCount, myFeedback: res.myFeedback });
    },
    onError: () => haptic('error'),
  });

  // Regulation re-acknowledgment: the backend already returns acknowledged=false
  // when the current version is newer than what the user acked. If we also have
  // a locally-remembered older acked version, we know it's specifically an
  // *update* (vs. a first-time ack) and can say so.
  const currentVersion = article?.version ?? 1;
  const regulationUpdated =
    isRegulation && article?.acknowledged === false && ackedVersion != null && ackedVersion < currentVersion;

  // Acks list (manager, regulation only) — lazy: only fetched when modal opens.
  const { data: acks } = useQuery<KnowledgeAcksResponse>({
    queryKey: ['knowledge-article-acks', id],
    queryFn: async () => (await knowledgeApi.listAcks(id)).data,
    enabled: !!id && isManager && isRegulation && acksOpen,
    staleTime: 30_000,
  });

  const openAttachment = (url: string) => {
    haptic('tap');
    const full = getImageUrl(url) ?? url;
    Linking.openURL(full).catch(() => {});
  };

  if (!id) {
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Статья" onBack={() => navigation.goBack()} />
        <EmptyState icon="warning" title="Статья не найдена" />
      </View>
    );
  }

  const headerTrailing = isManager ? (
    <Pressable
      onPress={() => {
        haptic('tap');
        navigation.navigate('KnowledgeEditor', { id });
      }}
      hitSlop={10}
      style={[styles.headerBtn, { backgroundColor: palette.bg.muted }]}
      accessibilityRole="button"
      accessibilityLabel="Изменить"
    >
      <Ionicons name="create-outline" size={19} color={palette.text.primary} />
    </Pressable>
  ) : undefined;

  const showStickyAck = isRegulation && article?.acknowledged === false && !isLoading;

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title={route.params?.title ?? article?.title ?? 'Статья'}
        onBack={() => navigation.goBack()}
        trailing={headerTrailing}
      />

      {article === undefined && isFetching ? (
        <LoadingSpinner />
      ) : isError && article === undefined ? (
        <QueryErrorState
          title="Не удалось загрузить статью"
          description="Проверьте соединение и попробуйте снова."
          onRetry={() => refetch()}
        />
      ) : article ? (
        <ScrollView
          contentContainerStyle={[
            styles.content,
            // Reserve room for the floating tab bar, plus — when the ack CTA is
            // shown — exactly the action-bar band (which floats just above the
            // tab bar). No double tab-bar inset, so no oversized dead zone.
            {
              paddingBottom: tabBarHeight + (showStickyAck ? ACK_BAR_GAP + ACK_BAR_HEIGHT : 0) + spacing[6],
            },
          ]}
          contentInset={{ bottom: tabBarHeight }}
          scrollIndicatorInsets={{ bottom: tabBarHeight }}
          automaticallyAdjustContentInsets={false}
          showsVerticalScrollIndicator={false}
        >
          {article.coverImage ? (
            <CachedImage
              source={{ uri: getImageUrl(article.coverImage) }}
              style={[styles.cover, { backgroundColor: palette.bg.muted }]}
              resizeMode="cover"
            />
          ) : null}

          {/* Kicker — the article kind, set above the headline like a magazine
              section label. */}
          <Text
            variant="label"
            numberOfLines={1}
            style={[styles.kicker, { color: isRegulation ? colors.amber[600] : palette.accent.primary }]}
          >
            {isRegulation ? 'Регламент' : 'Статья'}
          </Text>

          <Text variant="title1" color={palette.text.primary} style={styles.title}>
            {article.title}
          </Text>

          {/* Status chips — only the actionable, attention-grade flags. */}
          {article.mandatory || article.dueDate ? (
            <View style={styles.chipsRow}>
              {article.mandatory ? (
                <View
                  style={[
                    styles.typeChip,
                    { backgroundColor: palette.mode === 'dark' ? softTint(colors.red[600], 'dark') : colors.red[50] },
                  ]}
                >
                  <Ionicons
                    name="alert-circle"
                    size={12}
                    color={palette.mode === 'dark' ? colors.red[300] : colors.red[600]}
                  />
                  <Text
                    variant="caption"
                    style={{ color: palette.mode === 'dark' ? colors.red[300] : colors.red[700], fontWeight: '700' }}
                  >
                    Обязательно
                  </Text>
                </View>
              ) : null}
              {article.dueDate ? (
                <View style={[styles.typeChip, { backgroundColor: palette.bg.muted }]}>
                  <Ionicons name="time-outline" size={12} color={palette.text.secondary} />
                  <Text variant="caption" style={{ color: palette.text.secondary, fontWeight: '700' }}>
                    Срок: {formatDateShort(article.dueDate)}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}

          {/* Byline — quiet, magazine-style: category · updated · views. */}
          <View style={styles.bylineRow}>
            {article.categoryName ? (
              <>
                <Text variant="footnote" numberOfLines={1} style={{ color: palette.text.tertiary, flexShrink: 1 }}>
                  {article.categoryName}
                </Text>
                <Text variant="footnote" style={{ color: palette.text.tertiary }}>
                  ·
                </Text>
              </>
            ) : null}
            <Text variant="footnote" style={{ color: palette.text.tertiary }}>
              Обновлено {formatDateShort(article.updatedAt)}
            </Text>
            {typeof article.viewCount === 'number' && article.viewCount > 0 ? (
              <>
                <Text variant="footnote" style={{ color: palette.text.tertiary }}>
                  ·
                </Text>
                <View style={styles.viewCount}>
                  <Ionicons name="eye-outline" size={13} color={palette.text.tertiary} />
                  <Text variant="footnote" style={{ color: palette.text.tertiary }}>
                    {article.viewCount}
                  </Text>
                </View>
              </>
            ) : null}
          </View>

          {/* Hairline rule under the headline — the magazine "deck" separator. */}
          <View style={[styles.headlineRule, { backgroundColor: palette.border.subtle }]} />

          {/* Regulation updated — re-acknowledge */}
          {regulationUpdated ? (
            <View
              style={[
                styles.updatedBanner,
                palette.mode === 'dark'
                  ? { backgroundColor: softTint(colors.amber[600], 'dark'), borderColor: palette.border.subtle }
                  : { backgroundColor: colors.amber[50], borderColor: colors.amber[200] },
              ]}
            >
              <Ionicons
                name="refresh-circle"
                size={18}
                color={palette.mode === 'dark' ? colors.amber[200] : colors.amber[600]}
              />
              <Text
                variant="footnote"
                style={{
                  flex: 1,
                  color: palette.mode === 'dark' ? colors.amber[200] : colors.amber[800],
                  fontWeight: '600',
                }}
              >
                Регламент обновлён — ознакомьтесь заново.
              </Text>
            </View>
          ) : null}

          {/* Already-acknowledged confirmation (regulation) */}
          {isRegulation && article.acknowledged ? (
            <View
              style={[
                styles.ackDone,
                palette.mode === 'dark'
                  ? { backgroundColor: softTint(colors.green[600], 'dark'), borderColor: palette.border.subtle }
                  : { backgroundColor: colors.green[50], borderColor: colors.green[200] },
              ]}
            >
              <Ionicons
                name="checkmark-circle"
                size={18}
                color={palette.mode === 'dark' ? colors.green[300] : colors.green[600]}
              />
              <Text
                variant="bodyEmph"
                style={{ color: palette.mode === 'dark' ? colors.green[300] : colors.green[700] }}
              >
                Вы ознакомились
              </Text>
            </View>
          ) : null}

          {/* Видео (inline) — отображаются над текстом, как «обложка» темы */}
          {videoAttachments.length > 0 ? (
            <View style={styles.videoSection}>
              {videoAttachments.map((att, i) => (
                <VideoEmbed key={`${att.url}-${i}`} attachment={att} />
              ))}
            </View>
          ) : null}

          {/* Body — block-based content (079) wins; otherwise the markdown
              body; otherwise an honest «нет содержимого» note. */}
          <View style={styles.bodyWrap}>
            {article.blocks && article.blocks.length > 0 ? (
              <KnowledgeBlocks blocks={article.blocks} />
            ) : article.body?.trim() ? (
              <Markdown content={article.body} />
            ) : (
              <Text variant="body" style={{ color: palette.text.tertiary }}>
                Содержимое не добавлено.
              </Text>
            )}
          </View>

          {/* Было полезно? */}
          <View style={[styles.feedbackCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
            <Text variant="bodyEmph" style={{ color: palette.text.primary }}>
              Было полезно?
            </Text>
            <View style={styles.feedbackBtns}>
              <Pressable
                onPress={() => feedbackMutation.mutate(true)}
                disabled={feedbackMutation.isPending}
                style={[
                  styles.feedbackBtn,
                  {
                    backgroundColor:
                      feedback?.myFeedback === true
                        ? palette.mode === 'dark'
                          ? softTint(colors.green[600], 'dark')
                          : colors.green[50]
                        : palette.bg.muted,
                    borderColor: feedback?.myFeedback === true ? colors.green[300] : 'transparent',
                  },
                ]}
              >
                <Ionicons
                  name={feedback?.myFeedback === true ? 'thumbs-up' : 'thumbs-up-outline'}
                  size={18}
                  color={
                    feedback?.myFeedback === true
                      ? palette.mode === 'dark'
                        ? colors.green[300]
                        : colors.green[600]
                      : palette.text.secondary
                  }
                />
                <Text
                  variant="footnote"
                  style={{
                    color:
                      feedback?.myFeedback === true
                        ? palette.mode === 'dark'
                          ? colors.green[300]
                          : colors.green[700]
                        : palette.text.secondary,
                    fontWeight: '600',
                  }}
                >
                  {feedback?.helpfulCount ?? 0}
                </Text>
              </Pressable>
              <Pressable
                onPress={() => feedbackMutation.mutate(false)}
                disabled={feedbackMutation.isPending}
                style={[
                  styles.feedbackBtn,
                  {
                    backgroundColor:
                      feedback?.myFeedback === false
                        ? palette.mode === 'dark'
                          ? softTint(colors.red[600], 'dark')
                          : colors.red[50]
                        : palette.bg.muted,
                    borderColor: feedback?.myFeedback === false ? colors.red[200] : 'transparent',
                  },
                ]}
              >
                <Ionicons
                  name={feedback?.myFeedback === false ? 'thumbs-down' : 'thumbs-down-outline'}
                  size={18}
                  color={
                    feedback?.myFeedback === false
                      ? palette.mode === 'dark'
                        ? colors.red[300]
                        : colors.red[600]
                      : palette.text.secondary
                  }
                />
                <Text
                  variant="footnote"
                  style={{
                    color:
                      feedback?.myFeedback === false
                        ? palette.mode === 'dark'
                          ? colors.red[300]
                          : colors.red[700]
                        : palette.text.secondary,
                    fontWeight: '600',
                  }}
                >
                  {feedback?.notHelpfulCount ?? 0}
                </Text>
              </Pressable>
            </View>
          </View>

          {/* Attachments (документы / изображения — видео вынесены выше) */}
          {fileAttachments.length > 0 ? (
            <View style={styles.attachments}>
              <Text variant="label" style={{ color: palette.text.tertiary, marginBottom: spacing[2] }}>
                Вложения
              </Text>
              <View style={{ gap: spacing[2] }}>
                {fileAttachments.map((att, i) => (
                  <Pressable
                    key={`${att.url}-${i}`}
                    onPress={() => openAttachment(att.url)}
                    style={({ pressed }) => [
                      styles.attachRow,
                      {
                        backgroundColor: palette.bg.card,
                        borderColor: palette.border.subtle,
                        opacity: pressed ? 0.7 : 1,
                      },
                    ]}
                  >
                    <View style={[styles.attachIcon, { backgroundColor: palette.accent.primarySoft }]}>
                      <Ionicons name="document-attach-outline" size={18} color={palette.accent.primary} />
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text variant="bodyEmph" numberOfLines={1} style={{ color: palette.text.primary }}>
                        {att.name}
                      </Text>
                      {att.size ? (
                        <Text variant="caption" style={{ color: palette.text.tertiary }}>
                          {formatBytes(att.size)}
                        </Text>
                      ) : null}
                    </View>
                    <Ionicons name="open-outline" size={18} color={palette.text.tertiary} />
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}

          {/* Manager: кто ознакомился */}
          {isManager && isRegulation ? (
            <Pressable
              onPress={() => {
                haptic('tap');
                setAcksOpen(true);
              }}
              style={({ pressed }) => [
                styles.acksTrigger,
                { backgroundColor: palette.bg.card, borderColor: palette.border.subtle, opacity: pressed ? 0.7 : 1 },
              ]}
            >
              <Ionicons name="people-outline" size={18} color={palette.text.secondary} />
              <Text variant="bodyEmph" style={{ flex: 1, color: palette.text.primary }}>
                Кто ознакомился
              </Text>
              {acks ? (
                <Text variant="footnote" style={{ color: palette.text.secondary }}>
                  {acks.acknowledgedCount}/{acks.totalAudience}
                </Text>
              ) : null}
              <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
            </Pressable>
          ) : null}
        </ScrollView>
      ) : (
        // pending без активного запроса (offline-пауза) — спиннер, не пустота.
        <LoadingSpinner />
      )}

      {/* Sticky «Ознакомлен» CTA — a compact bar that floats just above the
          floating Liquid-Glass tab bar. Anchored at `bottom: tabBarHeight +
          gap` so the home-indicator safe area (already inside tabBarHeight) is
          respected exactly once — no doubled inset, no oversized chin. */}
      {showStickyAck ? (
        <View
          style={[
            styles.stickyWrap,
            {
              bottom: tabBarHeight + ACK_BAR_GAP,
              backgroundColor: palette.bg.elevated,
              borderTopColor: palette.border.subtle,
            },
          ]}
        >
          <Pressable
            onPress={() => ackMutation.mutate()}
            disabled={ackMutation.isPending}
            style={({ pressed }) => [
              styles.ackBtn,
              { backgroundColor: palette.accent.primary, opacity: pressed || ackMutation.isPending ? 0.85 : 1 },
            ]}
          >
            <Ionicons name="checkmark" size={20} color={colors.white} />
            <Text variant="callout" color={colors.white}>
              {ackMutation.isPending ? 'Подтверждаем…' : regulationUpdated ? 'Ознакомиться заново' : 'Ознакомлен'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {/* Acks modal */}
      <Modal visible={acksOpen} transparent animationType="slide" onRequestClose={() => setAcksOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setAcksOpen(false)}>
          <Pressable
            style={[
              styles.modalSheet,
              { backgroundColor: palette.bg.elevated, paddingBottom: Math.max(insets.bottom, spacing[4]) },
            ]}
            onPress={(e) => e.stopPropagation()}
          >
            <View style={[styles.modalHandle, { backgroundColor: palette.border.strong }]} />
            <Text variant="title3" color={palette.text.primary} style={{ marginBottom: spacing[1] }}>
              Кто ознакомился
            </Text>
            {acks ? (
              <Text variant="footnote" style={{ color: palette.text.secondary, marginBottom: spacing[3] }}>
                {acks.acknowledgedCount} из {acks.totalAudience} сотрудников
              </Text>
            ) : null}
            <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
              {(acks?.acknowledged ?? []).map((a) => (
                <View key={`ack-${a.userId}`} style={styles.ackPersonRow}>
                  <Ionicons name="checkmark-circle" size={18} color={colors.green[600]} />
                  <Text variant="body" style={{ flex: 1, color: palette.text.primary }}>
                    {a.userName}
                  </Text>
                  <Text variant="caption" style={{ color: palette.text.tertiary }}>
                    {formatDateShort(a.acknowledgedAt)}
                  </Text>
                </View>
              ))}
              {(acks?.pending ?? []).map((p) => (
                <View key={`pend-${p.userId}`} style={styles.ackPersonRow}>
                  <Ionicons name="ellipse-outline" size={18} color={palette.text.tertiary} />
                  <Text variant="body" style={{ flex: 1, color: palette.text.secondary }}>
                    {p.userName}
                  </Text>
                  <Text variant="caption" style={{ color: palette.text.tertiary }}>
                    не прочитал
                  </Text>
                </View>
              ))}
              {acks && acks.acknowledged.length === 0 && acks.pending.length === 0 ? (
                <Text variant="footnote" style={{ color: palette.text.tertiary, paddingVertical: spacing[4] }}>
                  Нет данных.
                </Text>
              ) : null}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: spacing[4], paddingTop: spacing[1] },

  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },

  cover: {
    width: '100%',
    height: 224,
    borderRadius: borderRadius['2xl'],
    marginBottom: spacing[4],
  },
  kicker: { marginBottom: spacing[1.5] },
  title: { marginBottom: spacing[2.5] },
  chipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing[2],
    marginBottom: spacing[2.5],
  },
  bylineRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing[1.5] },
  headlineRule: { height: StyleSheet.hairlineWidth, marginTop: spacing[3.5], marginBottom: spacing[4] },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
  },

  viewCount: { flexDirection: 'row', alignItems: 'center', gap: 3 },

  ackDone: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
    marginBottom: spacing[3],
  },

  updatedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
    marginBottom: spacing[3],
  },

  feedbackCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3.5],
    marginTop: spacing[5],
  },
  feedbackBtns: { flexDirection: 'row', gap: spacing[2] },
  feedbackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    borderRadius: borderRadius.full,
    borderWidth: 1,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    minWidth: 56,
    justifyContent: 'center',
  },

  bodyWrap: { marginTop: 0 },

  videoSection: { marginTop: spacing[1], marginBottom: spacing[4], gap: spacing[3] },

  attachments: { marginTop: spacing[5] },
  attachRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
  },
  attachIcon: {
    width: 38,
    height: 38,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },

  acksTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3.5],
    marginTop: spacing[5],
  },

  stickyWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    // `bottom` is set inline = tabBarHeight + gap, so the bar floats just
    // above the tab bar. Compact padding only — no extra safe-area inset here.
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  ackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[3.5],
    minHeight: 52,
  },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: spacing[3],
  },
  ackPersonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    paddingVertical: spacing[2.5],
  },
});
