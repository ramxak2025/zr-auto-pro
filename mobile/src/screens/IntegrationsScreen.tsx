import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import IosScreenHeader from '../components/IosScreenHeader';
import { Text } from '../platform/Typography';
import { useColors } from '../contexts/ThemeContext';
import { spacing, borderRadius, fontSize, fontWeight } from '../theme';

/**
 * IntegrationsScreen — placeholder for the upcoming "Интеграции" feature
 * (PBX, messengers, CRM exports, payment terminals).
 *
 * Sits in the «Маркетинг» group of the More menu alongside Marketing,
 * Calls, and Mailings. Implementation will arrive in a follow-up.
 */
export default function IntegrationsScreen() {
  const navigation = useNavigation<any>();
  const palette = useColors();

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Интеграции" onBack={() => navigation.goBack()} />
      <View style={styles.body}>
        <View style={[styles.iconWrap, { backgroundColor: palette.bg.muted }]}>
          <Ionicons name="git-network-outline" size={36} color={palette.text.tertiary} />
        </View>
        <Text style={[styles.title, { color: palette.text.primary }]}>Интеграции</Text>
        <Text style={[styles.subtitle, { color: palette.text.secondary }]}>
          Раздел в разработке. Скоро здесь появятся подключения мессенджеров, телефонии и платёжных терминалов.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  body: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[6],
    gap: spacing[3],
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: borderRadius['2xl'],
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[2],
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.semibold,
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: fontSize.sm,
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 280,
  },
});
