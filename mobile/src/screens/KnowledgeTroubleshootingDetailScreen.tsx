/**
 * KnowledgeTroubleshootingDetailScreen — a single troubleshooting entry.
 *
 * Layout: title + severity chip + system/make meta → «Симптом» → «Причина» →
 * «Решение» (markdown) → tags. Managers get a header «изменить» → editor.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import IosScreenHeader from '../components/IosScreenHeader';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import Markdown from '../components/knowledge/Markdown';
import { Text } from '../platform/Typography';
import { iosSectionLabel } from '../platform/iosSurface';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { useColors } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { knowledgeApi } from '../api/services';
import { spacing, borderRadius } from '../theme';
import { haptic } from '../platform/haptics';
import { severityStyle } from '../components/knowledge/severity';
import { UserRole } from '../../../shared/types';
import type { Troubleshooting } from '../../../shared/types';

type ParamList = { KnowledgeTroubleshootingDetail: { id: string; title?: string } };

export default function KnowledgeTroubleshootingDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<ParamList, 'KnowledgeTroubleshootingDetail'>>();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const { isRole } = useAuth();
  const isManager = isRole(UserRole.DIRECTOR, UserRole.ADMIN, UserRole.SUPERADMIN);

  const id = route.params?.id;

  const { data: entry, isLoading, isError, refetch } = useQuery<Troubleshooting>({
    queryKey: ['knowledge-troubleshooting-entry', id],
    queryFn: async () => (await knowledgeApi.getTroubleshooting(id)).data,
    enabled: !!id,
    staleTime: 60_000,
  });

  if (!id) {
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Неисправность" onBack={() => navigation.goBack()} />
        <EmptyState icon="warning" title="Запись не найдена" />
      </View>
    );
  }

  const headerTrailing = isManager ? (
    <Pressable
      onPress={() => {
        haptic('tap');
        navigation.navigate('KnowledgeTroubleshootingEditor', { id });
      }}
      hitSlop={10}
      style={[styles.headerBtn, { backgroundColor: palette.bg.muted }]}
      accessibilityRole="button"
      accessibilityLabel="Изменить"
    >
      <Ionicons name="create-outline" size={19} color={palette.text.primary} />
    </Pressable>
  ) : undefined;

  const sev = entry ? severityStyle(entry.severity) : null;
  const metaParts = entry ? ([entry.system, entry.carMake].filter(Boolean) as string[]) : [];

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title={route.params?.title ?? entry?.title ?? 'Неисправность'}
        onBack={() => navigation.goBack()}
        trailing={headerTrailing}
      />

      {isLoading && !entry ? (
        <LoadingSpinner />
      ) : isError && !entry ? (
        <EmptyState
          icon="warning"
          title="Не удалось загрузить"
          description="Проверьте соединение и попробуйте снова."
          action={{ label: 'Повторить', onPress: () => refetch() }}
        />
      ) : entry ? (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + spacing[6] }]}
          contentInset={{ bottom: tabBarHeight }}
          scrollIndicatorInsets={{ bottom: tabBarHeight }}
          automaticallyAdjustContentInsets={false}
          showsVerticalScrollIndicator={false}
        >
          <Text variant="title1" color={palette.text.primary} style={styles.title}>
            {entry.title}
          </Text>

          <View style={styles.metaRow}>
            {sev ? (
              <View style={[styles.sevChip, { backgroundColor: sev.bg }]}>
                <Ionicons name="alert-circle" size={12} color={sev.color} />
                <Text variant="caption" style={{ color: sev.color, fontWeight: '700' }}>
                  {sev.label}
                </Text>
              </View>
            ) : null}
            {metaParts.length > 0 ? (
              <Text variant="footnote" style={{ color: palette.text.secondary }}>
                {metaParts.join(' · ')}
              </Text>
            ) : null}
          </View>

          {/* Симптом */}
          <Section label="Симптом" palette={palette}>
            <Text variant="body" style={{ color: palette.text.primary }}>
              {entry.symptom}
            </Text>
          </Section>

          {/* Причина */}
          <Section label="Причина" palette={palette}>
            <Text variant="body" style={{ color: palette.text.primary }}>
              {entry.cause}
            </Text>
          </Section>

          {/* Решение (markdown) */}
          <Section label="Решение" palette={palette}>
            {entry.solution?.trim() ? (
              <Markdown content={entry.solution} />
            ) : (
              <Text variant="body" style={{ color: palette.text.tertiary }}>
                Решение не добавлено.
              </Text>
            )}
          </Section>

          {/* Tags */}
          {entry.tags.length > 0 ? (
            <View style={styles.tagsWrap}>
              {entry.tags.map((t) => (
                <View key={t} style={[styles.tag, { backgroundColor: palette.bg.muted }]}>
                  <Text variant="caption" style={{ color: palette.text.secondary }}>
                    #{t}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}
        </ScrollView>
      ) : null}
    </View>
  );
}

function Section({
  label,
  palette,
  children,
}: {
  label: string;
  palette: ReturnType<typeof useColors>;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.section, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
      <Text style={[iosSectionLabel, { color: palette.text.tertiary, marginBottom: spacing[2] }]}>{label}</Text>
      {children}
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
  title: { marginBottom: spacing[2] },
  metaRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing[2], marginBottom: spacing[3] },
  sevChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing[2],
    paddingVertical: 3,
  },
  section: {
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3.5],
    marginBottom: spacing[3],
  },
  tagsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2], marginTop: spacing[2] },
  tag: {
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing[2.5],
    paddingVertical: spacing[1.5],
  },
});
