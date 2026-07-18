import React from 'react';
import { ActivityIndicator, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Text } from '../platform/Typography';
import { useColors } from '../contexts/ThemeContext';

interface SessionRecoveryScreenProps {
  pending: boolean;
  onRetry: () => void;
  onLogout: () => void;
}

export default function SessionRecoveryScreen({ pending, onRetry, onLogout }: SessionRecoveryScreenProps) {
  const palette = useColors();
  return (
    <View style={[styles.container, { backgroundColor: palette.bg.canvas }]}>
      <ActivityIndicator size="large" color={palette.accent.primary} />
      <Text style={[styles.title, { color: palette.text.primary }]}>Восстанавливаем вход</Text>
      <Text style={[styles.message, { color: palette.text.secondary }]}>
        Сессия сохранена. Ждём доступный API после смены сети, Wi-Fi или VPN — повторный вход не требуется.
      </Text>
      <TouchableOpacity
        accessibilityRole="button"
        disabled={pending}
        onPress={onRetry}
        style={[styles.primaryButton, { backgroundColor: palette.accent.primary }, pending && styles.disabled]}
      >
        <Text style={[styles.primaryLabel, { color: palette.text.inverse }]}>
          {pending ? 'Проверяем…' : 'Проверить снова'}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity accessibilityRole="button" onPress={onLogout} style={styles.logoutButton}>
        <Text style={[styles.logoutLabel, { color: palette.text.secondary }]}>Выйти из аккаунта</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  title: {
    marginTop: 20,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
  },
  message: {
    marginTop: 10,
    maxWidth: 420,
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  primaryButton: {
    minWidth: 210,
    marginTop: 28,
    paddingHorizontal: 22,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  primaryLabel: {
    fontSize: 16,
    fontWeight: '700',
  },
  disabled: {
    opacity: 0.65,
  },
  logoutButton: {
    marginTop: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  logoutLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
});
