/**
 * CourseCard — a course tile for the «Учебный центр» list.
 *
 * Shows: optional cover, title + description, a progress bar, the
 * «Пройдено» / «N из M уроков» status line and a completed checkmark.
 *
 * Memoised — rendered in a list that re-renders on pull-to-refresh.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import CachedImage from '../CachedImage';
import ProgressBar from './ProgressBar';
import { Text } from '../../platform/Typography';
import { spacing, borderRadius, colors } from '../../theme';
import { useColors } from '../../contexts/ThemeContext';
import { getImageUrl } from '../../api/axios';
import { haptic } from '../../platform/haptics';
import type { KnowledgeCourse } from '../../../../shared/types';

interface CourseCardProps {
  course: KnowledgeCourse;
  onPress: (course: KnowledgeCourse) => void;
}

function CourseCardInner({ course, onPress }: CourseCardProps) {
  const palette = useColors();
  const cover = getImageUrl(course.coverImage);
  const { lessonCount, completedLessons, progressPercent, completed } = course;

  const statusLine = completed
    ? 'Курс пройден'
    : lessonCount === 0
      ? 'Нет уроков'
      : completedLessons > 0
        ? `${completedLessons} из ${lessonCount} уроков`
        : `${lessonCount} ${pluralLessons(lessonCount)}`;

  return (
    <Pressable
      onPress={() => {
        haptic('tap');
        onPress(course);
      }}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: palette.bg.card, borderColor: palette.border.subtle, opacity: pressed ? 0.85 : 1 },
      ]}
    >
      {cover ? (
        <CachedImage source={{ uri: cover }} style={[styles.cover, { backgroundColor: palette.bg.muted }]} resizeMode="cover" />
      ) : (
        <View style={[styles.cover, styles.coverFallback, { backgroundColor: palette.accent.primarySoft }]}>
          <Ionicons name="school-outline" size={30} color={palette.accent.primary} />
        </View>
      )}

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text variant="bodyEmph" numberOfLines={2} style={{ flex: 1, color: palette.text.primary }}>
            {course.title}
          </Text>
          {completed ? <Ionicons name="checkmark-circle" size={20} color={colors.green[500]} /> : null}
        </View>

        {course.description ? (
          <Text variant="footnote" numberOfLines={2} style={{ color: palette.text.secondary }}>
            {course.description}
          </Text>
        ) : null}

        <View style={styles.progressWrap}>
          <ProgressBar percent={progressPercent} />
          <View style={styles.statusRow}>
            <Text variant="caption" style={{ color: completed ? colors.green[600] : palette.text.tertiary, fontWeight: '600' }}>
              {statusLine}
            </Text>
            {!completed && lessonCount > 0 ? (
              <Text variant="caption" style={{ color: palette.text.tertiary }}>
                {progressPercent}%
              </Text>
            ) : null}
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function pluralLessons(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'урок';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'урока';
  return 'уроков';
}

const styles = StyleSheet.create({
  card: {
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  cover: {
    width: '100%',
    height: 132,
  },
  coverFallback: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
    gap: spacing[1.5],
  },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2] },
  progressWrap: { marginTop: spacing[1.5], gap: spacing[1.5] },
  statusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});

export const CourseCard = React.memo(CourseCardInner);
export default CourseCard;
