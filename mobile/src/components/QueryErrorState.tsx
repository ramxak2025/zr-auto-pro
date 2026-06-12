/**
 * QueryErrorState — компактный error-state для экранов на React Query.
 *
 * Показывается ТОЛЬКО когда запрос упал и кэша нет (isError && !data):
 * пока есть прошлые данные, глобальный stale-while-revalidate должен
 * продолжать их показывать — этот компонент не для таких случаев.
 *
 * Визуально зеркалит EmptyState (та же сетка, типографика и кнопка),
 * чтобы error-state не выглядел «другим приложением».
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { haptic } from '../platform/haptics';
import { PressableScale } from '../platform/PressableScale';
import { shadow } from '../platform/shadow';
import { Text } from '../platform/Typography';
import { colors } from '../theme';
import { useColors } from '../contexts/ThemeContext';

interface QueryErrorStateProps {
  title?: string;
  description?: string;
  onRetry: () => void;
}

export default function QueryErrorState({
  title = 'Не удалось загрузить',
  description,
  onRetry,
}: QueryErrorStateProps) {
  const palette = useColors();
  return (
    <Animated.View entering={FadeInDown.duration(320)} style={styles.container}>
      <View style={[styles.iconWrap, { backgroundColor: palette.bg.muted }]}>
        <Ionicons name="alert-circle" size={28} color={colors.red[500]} />
      </View>
      <Text variant="title2" color={palette.text.primary} style={styles.title}>
        {title}
      </Text>
      {description ? (
        <Text variant="footnote" color={palette.text.secondary} style={styles.description}>
          {description}
        </Text>
      ) : null}
      <PressableScale
        onPress={() => {
          haptic('tap');
          onRetry();
        }}
        style={[styles.button, { backgroundColor: palette.accent.primary }, shadow('sm', colors.primary[700])]}
      >
        <Text variant="callout" color={colors.white}>
          Повторить
        </Text>
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 56,
    paddingHorizontal: 32,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    textAlign: 'center',
  },
  description: {
    textAlign: 'center',
    maxWidth: 320,
    marginTop: 6,
  },
  button: {
    marginTop: 20,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 14,
  },
});
