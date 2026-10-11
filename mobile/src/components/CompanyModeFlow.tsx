import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '../contexts/ThemeContext';

export default function CompanyModeFlow({ steps }: { steps: readonly string[] }) {
  const palette = useColors();
  return (
    <View accessibilityLabel={steps.join(' → ')} style={[styles.flow, { backgroundColor: palette.bg.muted }]}>
      {steps.map((step, index) => (
        <React.Fragment key={step}>
          {index > 0 && <Ionicons name="chevron-forward" size={12} color={palette.text.tertiary} />}
          <View style={styles.step}>
            <Text style={[styles.copy, { color: palette.text.secondary }]}>{step}</Text>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}
const styles = StyleSheet.create({
  flow: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 4, borderRadius: 12, marginTop: 10 },
  step: { flex: 1 },
  copy: { fontSize: 12, lineHeight: 17, textAlign: 'center', fontWeight: '500' },
});
