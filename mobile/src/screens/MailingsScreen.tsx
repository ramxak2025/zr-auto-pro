import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import IosScreenHeader from '../components/IosScreenHeader';
import { Text } from '../platform/Typography';
import { useColors } from '../contexts/ThemeContext';
import { spacing, borderRadius, fontSize, fontWeight } from '../theme';

/**
 * MailingsScreen — placeholder for the upcoming "Рассылки" (mass-messaging) feature.
 *
 * Sits in the «Маркетинг» group of the More menu. Implementation will plug into
 * the marketing backend module later; until then we render a clean
 * "coming soon" surface so the route is wired and the menu doesn't dead-end.
 */
export default function MailingsScreen() {
  const navigation = useNavigation<any>();
  const palette = useColors();

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Рассылки" onBack={() => navigation.goBack()} />
      <View style={styles.body}>
        <View style={[styles.iconWrap, { backgroundColor: palette.bg.muted }]}>
          <Ionicons name="paper-plane-outline" size={36} color={palette.text.tertiary} />
        </View>
        <Text style={[styles.title, { color: palette.text.primary }]}>Рассылки</Text>
        <Text style={[styles.subtitle, { color: palette.text.secondary }]}>
          Раздел в разработке. Скоро здесь можно будет настраивать SMS- и push-рассылки клиентам.
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
