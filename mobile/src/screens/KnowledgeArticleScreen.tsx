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
import IosScreenHeader from '../components/IosScreenHeader';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import CachedImage from '../components/CachedImage';
import Markdown from '../components/knowledge/Markdown';
import { Text } from '../platform/Typography';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { useColors } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { knowledgeApi } from '../api/services';
import { getImageUrl } from '../api/axios';
import { spacing, borderRadius, colors } from '../theme';
import { haptic } from '../platform/haptics';
import { formatDateShort } from '../../../shared/utils/formatters';
import { UserRole } from '../../../shared/types';
import type { KnowledgeArticle, KnowledgeAcksResponse } from '../../../shared/types';

type ParamList = { KnowledgeArticle: { id: string; title?: string } };

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

  const { data: article, isLoading, isError, refetch } = useQuery<KnowledgeArticle>({
    queryKey: ['knowledge-article', id],
    queryFn: async () => (await knowledgeApi.getArticle(id)).data,
    enabled: !!id,
    staleTime: 60_000,
  });

  const isRegulation = article?.type === 'regulation';

  const ackMutation = useMutation({
    mutationFn: async () => (await knowledgeApi.acknowledge(id)).data,
    onSuccess: () => {
      haptic('success');
      // Optimistically flip the local cache to acknowledged.
      queryClient.setQueryData<KnowledgeArticle>(['knowledge-article', id], (prev) =>
        prev ? { ...prev, acknowledged: true } : prev,
      );
      // Refresh the pending-count badge everywhere it's shown.
      queryClient.invalidateQueries({ queryKey: ['knowledge-regulations-pending'] });
      queryClient.invalidateQueries({ queryKey: ['knowledge-article-acks', id] });
    },
  });

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

      {isLoading && !article ? (
        <LoadingSpinner />
      ) : isError && !article ? (
        <EmptyState
          icon="warning"
          title="Не удалось загрузить"
          description="Проверьте соединение и попробуйте снова."
          action={{ label: 'Повторить', onPress: () => refetch() }}
        />
      ) : article ? (
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: (showStickyAck ? 96 : 0) + tabBarHeight + spacing[6] },
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

          <Text variant="title1" color={palette.text.primary} style={styles.title}>
            {article.title}
          </Text>

          <View style={styles.metaRow}>
            {isRegulation ? (
              <View style={[styles.typeChip, { backgroundColor: colors.amber[50] }]}>
                <Ionicons name="shield-checkmark" size={12} color={colors.amber[600]} />
                <Text variant="caption" style={{ color: colors.amber[700], fontWeight: '700' }}>
                  Регламент
                </Text>
              </View>
            ) : null}
            {article.categoryName ? (
              <Text variant="footnote" style={{ color: palette.text.secondary }}>
                {article.categoryName}
              </Text>
            ) : null}
            <Text variant="footnote" style={{ color: palette.text.tertiary }}>
              Обновлено {formatDateShort(article.updatedAt)}
            </Text>
          </View>

          {/* Already-acknowledged confirmation (regulation) */}
          {isRegulation && article.acknowledged ? (
            <View style={[styles.ackDone, { backgroundColor: colors.green[50], borderColor: colors.green[200] }]}>
              <Ionicons name="checkmark-circle" size={18} color={colors.green[600]} />
              <Text variant="bodyEmph" style={{ color: colors.green[700] }}>
                Вы ознакомились
              </Text>
            </View>
          ) : null}

          {/* Body */}
          <View style={styles.bodyWrap}>
            {article.body?.trim() ? (
              <Markdown content={article.body} />
            ) : (
              <Text variant="body" style={{ color: palette.text.tertiary }}>
                Содержимое не добавлено.
              </Text>
            )}
          </View>

          {/* Attachments */}
          {article.attachments && article.attachments.length > 0 ? (
            <View style={styles.attachments}>
              <Text variant="label" style={{ color: palette.text.tertiary, marginBottom: spacing[2] }}>
                Вложения
              </Text>
              <View style={{ gap: spacing[2] }}>
                {article.attachments.map((att, i) => (
                  <Pressable
                    key={`${att.url}-${i}`}
                    onPress={() => openAttachment(att.url)}
                    style={({ pressed }) => [
                      styles.attachRow,
                      { backgroundColor: palette.bg.card, borderColor: palette.border.subtle, opacity: pressed ? 0.7 : 1 },
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
      ) : null}

      {/* Sticky «Ознакомлен» CTA */}
      {showStickyAck ? (
        <View
          style={[
            styles.stickyWrap,
            { paddingBottom: Math.max(insets.bottom, spacing[3]), backgroundColor: palette.bg.elevated, borderTopColor: palette.border.subtle },
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
            <Ionicons name="checkmark-circle" size={20} color={colors.white} />
            <Text variant="callout" color={colors.white}>
              {ackMutation.isPending ? 'Подтверждаем…' : 'Ознакомлен'}
            </Text>
          </Pressable>
        </View>
      ) : null}

      {/* Acks modal */}
      <Modal visible={acksOpen} transparent animationType="slide" onRequestClose={() => setAcksOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setAcksOpen(false)}>
          <Pressable
            style={[styles.modalSheet, { backgroundColor: palette.bg.elevated, paddingBottom: Math.max(insets.bottom, spacing[4]) }]}
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
    height: 200,
    borderRadius: borderRadius['2xl'],
    marginBottom: spacing[4],
  },
  title: { marginBottom: spacing[2] },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing[2], marginBottom: spacing[3] },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
  },

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

  bodyWrap: { marginTop: spacing[1] },

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
    bottom: 0,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
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
