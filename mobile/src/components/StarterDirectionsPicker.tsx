import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { STARTER_DIRECTIONS } from '../../../shared/constants/starterDirections';
import { useOptionalColors } from '../contexts/ThemeContext';
import { getPalette } from '../theme/palette';
export default function StarterDirectionsPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  disabled?: boolean;
}) {
  const palette = useOptionalColors() ?? getPalette('light');
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontSize: 16, fontWeight: '600', color: palette.text.primary }}>Направления автосервиса</Text>
      <Text style={{ fontSize: 13, lineHeight: 18, color: palette.text.secondary }}>
        Необязательно. Стартовые цены — 1 ₽, остатки — 0. Детали и объёмы подбираются по автомобилю.
      </Text>
      {STARTER_DIRECTIONS.map((d) => (
        <TouchableOpacity
          key={d.id}
          disabled={disabled}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: value.includes(d.id), disabled }}
          accessibilityLabel={d.name}
          onPress={() => onChange(value.includes(d.id) ? value.filter((id) => id !== d.id) : [...value, d.id])}
          style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 12 }}
        >
          <Ionicons
            name={value.includes(d.id) ? 'checkbox' : 'square-outline'}
            size={24}
            color={value.includes(d.id) ? palette.accent.primary : palette.text.secondary}
          />
          <Text style={{ fontSize: 15, color: palette.text.primary, flex: 1 }}>{d.name}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}
