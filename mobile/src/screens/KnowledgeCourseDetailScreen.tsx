/**
 * KnowledgeCourseDetailScreen — a single course with its lessons.
 *
 * Layout:
 *   • cover + title + description
 *   • progress card (bar + «N из M уроков») OR a celebratory «Курс пройден»
 *     state with a certificate-style badge when `completed`
 *   • lessons list: each row shows its completed state, a quiz badge, and a
 *     locked/next indicator. Lessons unlock sequentially — the first not-yet-
 *     completed lesson is the «next» (tappable); the ones after it are locked
 *     until the user finishes the earlier ones. A manager sees everything
 *     unlocked (so they can review / edit).
 *
 * Managers get a header «изменить» → editor.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import IosScreenHeader from '../components/IosScreenHeader';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import QueryErrorState from '../components/QueryErrorState';
import CachedImage from '../components/CachedImage';
import ProgressBar from '../components/knowledge/ProgressBar';
import { Text } from '../platform/Typography';
import { iosSectionLabel } from '../platform/iosSurface';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { useColors } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { knowledgeApi } from '../api/services';
import { getImageUrl } from '../api/axios';
import { spacing, borderRadius, colors, softTint } from '../theme';
import { haptic } from '../platform/haptics';
import { UserRole } from '../../../shared/types';
import type { KnowledgeCourse, KnowledgeLesson } from '../../../shared/types';

type ParamList = { KnowledgeCourseDetail: { id: string; title?: string } };

export default function KnowledgeCourseDetailScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<ParamList, 'KnowledgeCourseDetail'>>();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const { isRole } = useAuth();
  const isManager = isRole(UserRole.DIRECTOR, UserRole.ADMIN, UserRole.SUPERADMIN);

  const id = route.params?.id;

  const {
    data: course,
    isError,
    isFetching,
    refetch,
  } = useQuery<KnowledgeCourse>({
    queryKey: ['knowledge-course', id],
    queryFn: async () => (await knowledgeApi.getCourse(id)).data,
    enabled: !!id,
    // 60s, единый со staleTime этого же ключа на KnowledgeLessonScreen.
    // Прогресс обновляют мутации через invalidateQueries, так что дольше
    // держать кэш безопасно.
    staleTime: 60_000,
  });

  const lessons = course?.lessons ?? [];

  // Index of the first incomplete lesson — that's the "next" one a learner can
  // open. Everything after it is locked (sequential unlock). -1 = all done.
  const nextIndex = React.useMemo(() => lessons.findIndex((l) => !l.completed), [lessons]);

  const openLesson = React.useCallback(
    (lesson: KnowledgeLesson) => {
      navigation.navigate('KnowledgeLesson', { courseId: id, lessonId: lesson.id, title: lesson.title });
    },
    [navigation, id],
  );

  if (!id) {
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Курс" onBack={() => navigation.goBack()} />
        <EmptyState icon="warning" title="Курс не найден" />
      </View>
    );
  }

  const headerTrailing = isManager ? (
    <Pressable
      onPress={() => {
        haptic('tap');
        navigation.navigate('KnowledgeCourseEditor', { id });
      }}
      hitSlop={10}
      style={[styles.headerBtn, { backgroundColor: palette.bg.muted }]}
      accessibilityRole="button"
      accessibilityLabel="Изменить курс"
    >
      <Ionicons name="create-outline" size={19} color={palette.text.primary} />
    </Pressable>
  ) : undefined;

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader
        title={route.params?.title ?? course?.title ?? 'Курс'}
        onBack={() => navigation.goBack()}
        trailing={headerTrailing}
      />

      {course === undefined && isFetching ? (
        <LoadingSpinner />
      ) : isError && course === undefined ? (
        <QueryErrorState
          title="Не удалось загрузить курс"
          description="Проверьте соединение и попробуйте снова."
          onRetry={() => refetch()}
        />
      ) : course ? (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + spacing[6] }]}
          contentInset={{ bottom: tabBarHeight }}
          scrollIndicatorInsets={{ bottom: tabBarHeight }}
          automaticallyAdjustContentInsets={false}
          showsVerticalScrollIndicator={false}
        >
          {course.coverImage ? (
            <CachedImage
              source={{ uri: getImageUrl(course.coverImage) }}
              style={[styles.cover, { backgroundColor: palette.bg.muted }]}
              resizeMode="cover"
            />
          ) : null}

          <Text variant="title1" color={palette.text.primary} style={styles.title}>
            {course.title}
          </Text>
          {course.description ? (
            <Text variant="body" style={{ color: palette.text.secondary, marginBottom: spacing[3] }}>
              {course.description}
            </Text>
          ) : null}

          {/* Progress / completed state */}
          {course.completed ? (
            <View
              style={[
                styles.certCard,
                palette.mode === 'dark'
                  ? { backgroundColor: softTint(colors.green[600], 'dark'), borderColor: palette.border.subtle }
                  : { backgroundColor: colors.green[50], borderColor: colors.green[200] },
              ]}
            >
              <View
                style={[
                  styles.certBadge,
                  {
                    backgroundColor: palette.mode === 'dark' ? softTint(colors.green[600], 'dark') : colors.green[100],
                  },
                ]}
              >
                <Ionicons
                  name="ribbon"
                  size={26}
                  color={palette.mode === 'dark' ? colors.green[300] : colors.green[600]}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  variant="bodyEmph"
                  style={{ color: palette.mode === 'dark' ? colors.green[300] : colors.green[700] }}
                >
                  Курс пройден
                </Text>
                <Text
                  variant="footnote"
                  style={{ color: palette.mode === 'dark' ? colors.green[300] : colors.green[600] }}
                >
                  Вы прошли все {course.lessonCount} уроков. Сертификат начислен.
                </Text>
              </View>
            </View>
          ) : (
            <View
              style={[styles.progressCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
            >
              <View style={styles.progressTop}>
                <Text variant="bodyEmph" style={{ color: palette.text.primary }}>
                  {course.completedLessons} из {course.lessonCount} уроков
                </Text>
                <Text variant="footnote" style={{ color: palette.text.secondary }}>
                  {course.progressPercent}%
                </Text>
              </View>
              <ProgressBar percent={course.progressPercent} />
            </View>
          )}

          {/* Lessons */}
          <Text style={[iosSectionLabel, styles.sectionTitle, { color: palette.text.secondary }]}>Уроки</Text>
          {lessons.length === 0 ? (
            <EmptyState
              icon="journal"
              title="Уроков пока нет"
              description={isManager ? 'Добавьте первый урок через «изменить».' : 'В этом курсе ещё нет уроков.'}
            />
          ) : (
            <View style={styles.lessonList}>
              {lessons.map((lesson, idx) => {
                const isNext = idx === nextIndex;
                // Learners: a lesson after the "next" one is locked. Managers: all open.
                const locked = !isManager && !lesson.completed && nextIndex !== -1 && idx > nextIndex;
                return (
                  <LessonRow
                    key={lesson.id}
                    lesson={lesson}
                    index={idx}
                    isNext={isNext}
                    locked={locked}
                    palette={palette}
                    onPress={() => openLesson(lesson)}
                  />
                );
              })}
            </View>
          )}
        </ScrollView>
      ) : (
        // pending без активного запроса (offline-пауза) — спиннер, не пустота.
        <LoadingSpinner />
      )}
    </View>
  );
}

function LessonRow({
  lesson,
  index,
  isNext,
  locked,
  palette,
  onPress,
}: {
  lesson: KnowledgeLesson;
  index: number;
  isNext: boolean;
  locked: boolean;
  palette: ReturnType<typeof useColors>;
  onPress: () => void;
}) {
  const iconName = lesson.completed
    ? 'checkmark-circle'
    : locked
      ? 'lock-closed'
      : isNext
        ? 'play-circle'
        : 'ellipse-outline';
  const iconColor = lesson.completed
    ? colors.green[500]
    : locked
      ? palette.text.tertiary
      : isNext
        ? palette.accent.primary
        : palette.text.secondary;

  return (
    <Pressable
      onPress={onPress}
      disabled={locked}
      style={({ pressed }) => [
        styles.lessonRow,
        {
          backgroundColor: palette.bg.card,
          borderColor: isNext ? palette.accent.primary : palette.border.subtle,
          opacity: locked ? 0.55 : pressed ? 0.7 : 1,
        },
      ]}
    >
      <Ionicons name={iconName} size={24} color={iconColor} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text variant="bodyEmph" numberOfLines={2} style={{ color: palette.text.primary }}>
          {index + 1}. {lesson.title}
        </Text>
        <View style={styles.lessonMeta}>
          {lesson.hasQuiz ? (
            <View style={[styles.quizChip, { backgroundColor: palette.accent.primarySoft }]}>
              <Ionicons name="help-circle-outline" size={12} color={palette.accent.primary} />
              <Text variant="caption" style={{ color: palette.accent.primary, fontWeight: '700' }}>
                Тест
              </Text>
            </View>
          ) : null}
          <Text variant="caption" style={{ color: palette.text.tertiary }}>
            {lesson.completed ? 'Пройдено' : locked ? 'Откроется позже' : isNext ? 'Продолжить' : 'Доступно'}
          </Text>
        </View>
      </View>
      {!locked ? <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} /> : null}
    </Pressable>
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
    height: 180,
    borderRadius: borderRadius['2xl'],
    marginBottom: spacing[4],
  },
  title: { marginBottom: spacing[2] },

  progressCard: {
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3.5],
    gap: spacing[2.5],
    marginBottom: spacing[5],
  },
  progressTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  certCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3.5],
    marginBottom: spacing[5],
  },
  certBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },

  sectionTitle: { marginLeft: spacing[1], marginBottom: spacing[2] },
  lessonList: { gap: spacing[2] },
  lessonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
    minHeight: 64,
  },
  lessonMeta: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  quizChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderRadius: borderRadius.full,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
  },
});
