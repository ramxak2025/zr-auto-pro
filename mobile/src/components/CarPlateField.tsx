/**
 * CarPlateField — a unified license-plate editor used by every car
 * create/edit flow (ClientsScreen inline car, ClientDetailScreen car modal).
 *
 * It bundles three pieces that previously had to be wired by hand on each
 * screen and were inconsistent:
 *   • <PlateModeSwitcher>  — RU 🇷🇺 / INT 🌐 toggle.
 *   • <RussianPlateInput>  — the GOST plate (RU) or free-text INT input.
 *   • a «без номеров» checkbox — when on, the plate field is hidden and the
 *     car is stored with an empty plate + `noPlate: true`.
 *
 * Why a component: the foreign-plate path was a known bug — screens used a
 * bare <TextInput> with `processPlateMainInput` (RU-only mask), so a foreign
 * plate like "BG-3845-PA" got mangled and never reached the backend. Routing
 * everything through <RussianPlateInput mode={...}> fixes foreign input by
 * construction, and the explicit mode prop stops the auto-detect surprises.
 *
 * Controlled component. The parent owns three pieces of state — `plate`
 * (the clean stored string), `mode`, and `noPlate` — and gets them back via
 * `onChange`. On «без номеров» the parent should send an empty plate.
 */
import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../platform/Typography';
import RussianPlateInput, { PlateMode } from './RussianPlateInput';
import PlateModeSwitcher from './PlateModeSwitcher';
import { useColors } from '../contexts/ThemeContext';
import { spacing, borderRadius, colors } from '../theme';
import { haptic } from '../platform/haptics';

interface Props {
  /** Clean stored plate string ('А123АА77' or 'BG3845PA'). */
  plate: string;
  /** Explicit RU / foreign mode — controls which keyboard/mask is shown. */
  mode: PlateMode;
  /** «без номеров» flag. When true the plate input is hidden. */
  noPlate: boolean;
  onChangePlate: (clean: string) => void;
  onChangeMode: (mode: PlateMode) => void;
  onChangeNoPlate: (noPlate: boolean) => void;
  /** Hide the mode switcher (e.g. compact inline car block). Defaults to false. */
  autoFocus?: boolean;
}

export default function CarPlateField({
  plate,
  mode,
  noPlate,
  onChangePlate,
  onChangeMode,
  onChangeNoPlate,
  autoFocus = false,
}: Props) {
  const palette = useColors();

  return (
    <View style={styles.wrap}>
      {!noPlate && (
        <>
          <View style={styles.switcherRow}>
            <PlateModeSwitcher value={mode} onChange={onChangeMode} />
          </View>
          <RussianPlateInput
            value={plate}
            onChangeText={onChangePlate}
            mode={mode}
            autoFocus={autoFocus}
            placeholder={mode === 'ru' ? 'Введите госномер' : 'BG-3845-PA'}
          />
        </>
      )}

      {/* «без номеров» — clearing the plate and marking the car so the
          duplicate check is skipped and search filters can find it. */}
      <TouchableOpacity
        style={[
          styles.checkboxRow,
          { borderColor: palette.border.subtle, backgroundColor: palette.bg.muted },
        ]}
        activeOpacity={0.7}
        onPress={() => {
          haptic('select');
          const next = !noPlate;
          onChangeNoPlate(next);
          if (next) onChangePlate('');
        }}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: noPlate }}
      >
        <View
          style={[
            styles.checkbox,
            {
              borderColor: noPlate ? palette.accent.primary : palette.border.strong,
              backgroundColor: noPlate ? palette.accent.primary : 'transparent',
            },
          ]}
        >
          {noPlate && <Ionicons name="checkmark" size={14} color={colors.white} />}
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="body" color={palette.text.primary} style={styles.checkboxLabel}>
            Без номеров
          </Text>
          <Text variant="caption" color={palette.text.tertiary}>
            Авто без госномера (например, после ДТП или новое)
          </Text>
        </View>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing[3] },
  switcherRow: { alignItems: 'flex-start' },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxLabel: { fontWeight: '600' },
});
