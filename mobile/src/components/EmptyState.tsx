/**
 * EmptyState v2 — adds an optional icon glyph and a soft entrance animation,
 * while keeping the original `title / description / action` API so all 25
 * existing screens that use it keep working unchanged.
 *
 * Animation: Reanimated 4 layout animation (`FadeInDown`) — runs on the UI
 * thread, doesn't block the JS thread.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { haptic } from '../platform/haptics';
import { Icon, IconName } from '../platform/Icon';
import { PressableScale } from '../platform/PressableScale';
import { shadow } from '../platform/shadow';
import { Text } from '../platform/Typography';
import { colors } from '../theme';
import { useColors } from '../contexts/ThemeContext';

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: IconName;
  action?: {
    label: string;
    onPress: () => void;
  };
}

export default function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  const palette = useColors();
  return (
    <Animated.View
      entering={FadeInDown.duration(380).springify().damping(18)}
      style={styles.container}
    >
      {icon && (
        <View style={[styles.iconWrap, { backgroundColor: palette.bg.muted }]}>
          <Icon name={icon} size={28} color={palette.text.tertiary} />
        </View>
      )}
      <Text variant="title2" color={palette.text.primary} style={styles.title}>
        {title}
      </Text>
      {description && (
        <Text variant="footnote" color={palette.text.secondary} style={styles.description}>
          {description}
        </Text>
      )}
      {action && (
        <PressableScale
          onPress={() => {
            haptic('tap');
            action.onPress();
          }}
          style={[styles.button, { backgroundColor: palette.accent.primary }, shadow('sm', colors.primary[700])]}
        >
          <Text variant="callout" color={colors.white}>
            {action.label}
          </Text>
        </PressableScale>
      )}
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
    backgroundColor: colors.gray[100],
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
    backgroundColor: colors.primary[600],
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 14,
  },
});
