import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: {
    label: string;
    onPress: () => void;
  };
}

export default function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      {description && <Text style={styles.description}>{description}</Text>}
      {action && (
        <TouchableOpacity style={styles.button} onPress={action.onPress}>
          <Text style={styles.buttonText}>{action.label}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  title: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.medium,
    color: colors.gray[900],
    marginBottom: spacing[1],
  },
  description: {
    fontSize: fontSize.sm,
    color: colors.gray[500],
    textAlign: 'center',
    maxWidth: 300,
    marginBottom: spacing[4],
  },
  button: {
    backgroundColor: colors.primary[600],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
  },
  buttonText: {
    color: colors.white,
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
});
