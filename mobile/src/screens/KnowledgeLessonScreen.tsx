/**
 * KnowledgeLessonScreen — the lesson reader + quiz.
 *
 * Flow:
 *   • markdown body (in-house renderer — no native module)
 *   • if hasQuiz → render every question with selectable options. The
 *     «Проверить» button stays disabled until all questions are answered, then
 *     calls completeLesson(id, answers).
 *       – success → mark complete, celebrate, and advance to the next lesson
 *         (or back to the course when this was the last one).
 *       – 400 → the backend requires ALL answers correct; we show
 *         «Есть ошибки, попробуйте снова» using the returned {correct,total}
 *         and let the user retry. No progress is recorded.
 *   • if no quiz → a single «Завершить урок» button → completeLesson(id).
 *
 * The course/lesson queries are invalidated on success so progress, the
 * sequential-unlock state and the «N из M» counters refresh everywhere.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import IosScreenHeader from '../components/IosScreenHeader';
import LoadingSpinner from '../components/LoadingSpinner';
import EmptyState from '../components/EmptyState';
import Markdown from '../components/knowledge/Markdown';
import { Text } from '../platform/Typography';
import { iosSectionLabel } from '../platform/iosSurface';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { useColors } from '../contexts/ThemeContext';
import { knowledgeApi } from '../api/services';
import { spacing, borderRadius, colors } from '../theme';
import { haptic } from '../platform/haptics';
import type { KnowledgeCourse, KnowledgeLesson, LessonProgress } from '../../../shared/types';

type ParamList = { KnowledgeLesson: { courseId: string; lessonId: string; title?: string } };

interface QuizError {
  correct: number;
  total: number;
}

export default function KnowledgeLessonScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<ParamList, 'KnowledgeLesson'>>();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const { courseId, lessonId } = route.params ?? ({} as ParamList['KnowledgeLesson']);

  // The lesson lives on getCourse — read it from there (cache-first) so we don't
  // need a separate lesson endpoint and stay consistent with the detail screen.
  const { data: course, isLoading, isError, refetch } = useQuery<KnowledgeCourse>({
    queryKey: ['knowledge-course', courseId],
    queryFn: async () => (await knowledgeApi.getCourse(courseId)).data,
    enabled: !!courseId,
    staleTime: 20_000,
  });

  const lessons = course?.lessons ?? [];
  const lesson = React.useMemo<KnowledgeLesson | undefined>(
    () => lessons.find((l) => l.id === lessonId),
    [lessons, lessonId],
  );
  const lessonIndex = React.useMemo(() => lessons.findIndex((l) => l.id === lessonId), [lessons, lessonId]);
  const nextLesson = lessonIndex >= 0 && lessonIndex + 1 < lessons.length ? lessons[lessonIndex + 1] : undefined;

  const quiz = lesson?.hasQuiz ? lesson.quiz ?? [] : [];
  const hasQuiz = quiz.length > 0;

  // answers[i] = selected option index for question i, or -1 (unanswered).
  const [answers, setAnswers] = React.useState<number[]>([]);
  const [quizError, setQuizError] = React.useState<QuizError | null>(null);

  // Initialise / reset the answer buffer whenever the quiz identity changes.
  React.useEffect(() => {
    setAnswers(hasQuiz ? new Array(quiz.length).fill(-1) : []);
    setQuizError(null);
  }, [hasQuiz, quiz.length, lessonId]);

  const allAnswered = hasQuiz ? answers.length === quiz.length && answers.every((a) => a >= 0) : true;
  const alreadyDone = !!lesson?.completed;

  const completeMutation = useMutation({
    mutationFn: async () => {
      const res = await knowledgeApi.completeLesson(lessonId, hasQuiz ? answers : undefined);
      return res.data;
    },
    onSuccess: (progress: LessonProgress) => {
      haptic('success');
      setQuizError(null);
      // Refresh course progress + the lessons' completed state.
      queryClient.invalidateQueries({ queryKey: ['knowledge-course', courseId] });
      queryClient.invalidateQueries({ queryKey: ['knowledge-courses'] });
      if (progress.courseCompleted) {
        // Whole course finished — pop back to the course for the cert state.
        navigation.goBack();
      } else if (nextLesson) {
        // Advance to the next lesson in place (replace so back goes to course).
        navigation.replace('KnowledgeLesson', {
          courseId,
          lessonId: nextLesson.id,
          title: nextLesson.title,
        });
      } else {
        navigation.goBack();
      }
    },
    onError: (err: any) => {
      haptic('error');
      const data = err?.response?.data;
      if (err?.response?.status === 400 && data && typeof data.total === 'number') {
        setQuizError({ correct: data.correct ?? 0, total: data.total });
      } else {
        setQuizError({ correct: 0, total: quiz.length });
      }
    },
  });

  const selectAnswer = (qIdx: number, optIdx: number) => {
    haptic('select');
    setQuizError(null);
    setAnswers((prev) => {
      const next = prev.length === quiz.length ? [...prev] : new Array(quiz.length).fill(-1);
      next[qIdx] = optIdx;
      return next;
    });
  };

  if (!courseId || !lessonId) {
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Урок" onBack={() => navigation.goBack()} />
        <EmptyState icon="warning" title="Урок не найден" />
      </View>
    );
  }

  const ctaLabel = alreadyDone
    ? 'Урок пройден'
    : completeMutation.isPending
      ? 'Сохраняем…'
      : hasQuiz
        ? 'Проверить'
        : 'Завершить урок';
  const ctaDisabled = alreadyDone || completeMutation.isPending || (hasQuiz && !allAnswered);

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title={route.params?.title ?? lesson?.title ?? 'Урок'} onBack={() => navigation.goBack()} />

      {isLoading && !course ? (
        <LoadingSpinner />
      ) : isError && !course ? (
        <EmptyState
          icon="warning"
          title="Не удалось загрузить"
          description="Проверьте соединение и попробуйте снова."
          action={{ label: 'Повторить', onPress: () => refetch() }}
        />
      ) : !lesson ? (
        <EmptyState icon="warning" title="Урок не найден" description="Возможно, он был удалён." />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: 96 + tabBarHeight + spacing[4] }]}
          contentInset={{ bottom: tabBarHeight }}
          scrollIndicatorInsets={{ bottom: tabBarHeight }}
          automaticallyAdjustContentInsets={false}
          showsVerticalScrollIndicator={false}
        >
          <Text variant="title2" color={palette.text.primary} style={styles.title}>
            {lesson.title}
          </Text>

          {alreadyDone ? (
            <View style={[styles.doneBanner, { backgroundColor: colors.green[50], borderColor: colors.green[200] }]}>
              <Ionicons name="checkmark-circle" size={18} color={colors.green[600]} />
              <Text variant="bodyEmph" style={{ color: colors.green[700] }}>
                Урок пройден
              </Text>
            </View>
          ) : null}

          {/* Body */}
          {lesson.body?.trim() ? (
            <Markdown content={lesson.body} />
          ) : (
            <Text variant="body" style={{ color: palette.text.tertiary }}>
              Содержимое не добавлено.
            </Text>
          )}

          {/* Quiz */}
          {hasQuiz ? (
            <View style={styles.quizWrap}>
              <Text style={[iosSectionLabel, { color: palette.text.secondary, marginBottom: spacing[2] }]}>
                Проверка знаний
              </Text>
              {quiz.map((q, qIdx) => (
                <View
                  key={qIdx}
                  style={[styles.questionCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
                >
                  <Text variant="bodyEmph" style={{ color: palette.text.primary, marginBottom: spacing[2.5] }}>
                    {qIdx + 1}. {q.question}
                  </Text>
                  <View style={{ gap: spacing[2] }}>
                    {q.options.map((opt, optIdx) => {
                      const selected = answers[qIdx] === optIdx;
                      return (
                        <Pressable
                          key={optIdx}
                          onPress={() => selectAnswer(qIdx, optIdx)}
                          disabled={alreadyDone || completeMutation.isPending}
                          style={[
                            styles.option,
                            {
                              backgroundColor: selected ? palette.accent.primarySoft : palette.bg.muted,
                              borderColor: selected ? palette.accent.primary : 'transparent',
                            },
                          ]}
                        >
                          <Ionicons
                            name={selected ? 'radio-button-on' : 'radio-button-off'}
                            size={20}
                            color={selected ? palette.accent.primary : palette.text.tertiary}
                          />
                          <Text
                            variant="body"
                            style={{ flex: 1, color: selected ? palette.accent.primaryText : palette.text.primary }}
                          >
                            {opt}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              ))}

              {quizError ? (
                <View style={[styles.errorBanner, { backgroundColor: colors.red[50], borderColor: colors.red[200] }]}>
                  <Ionicons name="alert-circle" size={18} color={colors.red[600]} />
                  <Text variant="footnote" style={{ flex: 1, color: colors.red[700] }}>
                    Есть ошибки, попробуйте снова. Правильно {quizError.correct} из {quizError.total}.
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      )}

      {/* Sticky CTA */}
      {lesson ? (
        <View
          style={[
            styles.stickyWrap,
            {
              paddingBottom: Math.max(insets.bottom, spacing[3]),
              backgroundColor: palette.bg.elevated,
              borderTopColor: palette.border.subtle,
            },
          ]}
        >
          <Pressable
            onPress={() => {
              haptic('tap');
              completeMutation.mutate();
            }}
            disabled={ctaDisabled}
            style={({ pressed }) => [
              styles.cta,
              {
                backgroundColor: alreadyDone ? palette.bg.muted : palette.accent.primary,
                opacity: ctaDisabled ? (alreadyDone ? 1 : 0.5) : pressed ? 0.85 : 1,
              },
            ]}
          >
            {alreadyDone ? (
              <Ionicons name="checkmark-circle" size={20} color={colors.green[600]} />
            ) : (
              <Ionicons name={hasQuiz ? 'checkmark-done' : 'checkmark-circle'} size={20} color={colors.white} />
            )}
            <Text variant="callout" color={alreadyDone ? palette.text.secondary : colors.white}>
              {ctaLabel}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: spacing[4], paddingTop: spacing[1] },
  title: { marginBottom: spacing[3] },

  doneBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[2.5],
    marginBottom: spacing[3],
  },

  quizWrap: { marginTop: spacing[5], gap: spacing[3] },
  questionCard: {
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3.5],
  },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    borderRadius: borderRadius.xl,
    borderWidth: 1.5,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
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
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[3.5],
    minHeight: 52,
  },
});
