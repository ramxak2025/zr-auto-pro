/**
 * KnowledgeCourseListScreen — «Учебный центр».
 *
 * A scrollable list of course cards (cover + title + progress bar + status +
 * completed checkmark). A slim overall-progress banner sits on top when the
 * user has started at least one course. Managers get a «+» to create a course.
 *
 * Data: listCourses() — progress fields are per signed-in user, so we keep a
 * short staleTime and revalidate on focus rather than persisting.
 */
import React from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import IosScreenHeader from '../components/IosScreenHeader';
import EmptyState from '../components/EmptyState';
import QueryErrorState from '../components/QueryErrorState';
import { ListSkeleton } from '../components/Skeleton';
import CourseCard from '../components/knowledge/CourseCard';
import ProgressBar from '../components/knowledge/ProgressBar';
import { Text } from '../platform/Typography';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { useColors } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { knowledgeApi } from '../api/services';
import { spacing, borderRadius } from '../theme';
import { haptic } from '../platform/haptics';
import type { KnowledgeCourse } from '../../../shared/types';

export default function KnowledgeCourseListScreen() {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  // Мутации базы знаний — ключ knowledge_manage (сервер гейтит тем же ключом;
  // «права как в Битрикс24», 2026-07: admin живёт по матрице из /auth/me).
  const { hasPermission } = useAuth();
  const isManager = hasPermission('knowledge_manage');

  const { data, isLoading, isError, isFetching, refetch, isRefetching } = useQuery<KnowledgeCourse[]>({
    queryKey: ['knowledge-courses'],
    queryFn: async () => (await knowledgeApi.listCourses()).data,
    // 60s, единый со staleTime этого же ключа на KnowledgeBaseScreen —
    // разные значения на один ключ давали лишние рефетчи при переходах.
    staleTime: 60_000,
  });

  const openCourse = React.useCallback(
    (course: KnowledgeCourse) => {
      navigation.navigate('KnowledgeCourseDetail', { id: course.id, title: course.title });
    },
    [navigation],
  );

  // Overall progress across all started courses (premium "keep learning" banner).
  const overall = React.useMemo(() => {
    if (!data || data.length === 0) return null;
    const totalLessons = data.reduce((sum, c) => sum + c.lessonCount, 0);
    const doneLessons = data.reduce((sum, c) => sum + c.completedLessons, 0);
    const completedCourses = data.filter((c) => c.completed).length;
    if (doneLessons === 0) return null;
    const percent = totalLessons > 0 ? Math.round((doneLessons / totalLessons) * 100) : 0;
    return { percent, completedCourses, totalCourses: data.length };
  }, [data]);

  const headerTrailing = isManager ? (
    <Pressable
      onPress={() => {
        haptic('tap');
        navigation.navigate('KnowledgeCourseEditor', {});
      }}
      hitSlop={10}
      style={[styles.headerBtn, { backgroundColor: palette.accent.primarySoft }]}
      accessibilityRole="button"
      accessibilityLabel="Создать курс"
    >
      <Ionicons name="add" size={22} color={palette.accent.primary} />
    </Pressable>
  ) : undefined;

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Учебный центр" onBack={() => navigation.goBack()} trailing={headerTrailing} />

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: tabBarHeight + spacing[6] }]}
        contentInset={{ bottom: tabBarHeight }}
        scrollIndicatorInsets={{ bottom: tabBarHeight }}
        automaticallyAdjustContentInsets={false}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching && !isLoading}
            onRefresh={refetch}
            tintColor={palette.text.tertiary}
          />
        }
      >
        {overall ? (
          <View style={[styles.overall, { backgroundColor: palette.accent.primarySoft }]}>
            <View style={styles.overallTop}>
              <Ionicons name="ribbon-outline" size={20} color={palette.accent.primary} />
              <Text variant="bodyEmph" style={{ flex: 1, color: palette.accent.primaryText }}>
                Ваш прогресс
              </Text>
              <Text variant="bodyEmph" style={{ color: palette.accent.primaryText }}>
                {overall.percent}%
              </Text>
            </View>
            <ProgressBar percent={overall.percent} />
            <Text variant="caption" style={{ color: palette.accent.primaryText }}>
              Пройдено {overall.completedCourses} из {overall.totalCourses}
            </Text>
          </View>
        ) : null}

        {data === undefined && isFetching ? (
          <ListSkeleton count={4} />
        ) : isError && data === undefined ? (
          // Сервер сейчас может отдавать 500 — честная ошибка с «Повторить»
          // вместо вечного спиннера или ложного «пусто». Как только бэкенд
          // починят, retry / pull-to-refresh оживят экран без апдейта.
          <QueryErrorState
            title="Не удалось загрузить курсы"
            description="Проверьте соединение и попробуйте снова."
            onRetry={() => refetch()}
          />
        ) : data === undefined ? (
          <ListSkeleton count={4} />
        ) : data.length > 0 ? (
          <View style={styles.list}>
            {data.map((c) => (
              <CourseCard key={c.id} course={c} onPress={openCourse} />
            ))}
          </View>
        ) : (
          <EmptyState
            icon="star"
            title="Курсов пока нет"
            description={
              isManager
                ? 'Создайте первый курс — нажмите «+» в правом верхнем углу.'
                : 'Здесь появятся обучающие курсы автосервиса.'
            }
            action={
              isManager
                ? { label: 'Создать курс', onPress: () => navigation.navigate('KnowledgeCourseEditor', {}) }
                : undefined
            }
          />
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: spacing[4], paddingTop: spacing[2] },
  list: { gap: spacing[3.5] },

  headerBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },

  overall: {
    borderRadius: borderRadius['2xl'],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3.5],
    gap: spacing[2],
    marginBottom: spacing[4],
  },
  overallTop: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
});
