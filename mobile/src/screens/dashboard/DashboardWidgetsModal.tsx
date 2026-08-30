/**
 * DashboardWidgetsModal — модалка настройки видимости виджетов дашборда.
 *
 * Чистый presentational-компонент: получает список определений виджетов,
 * текущую карту видимости и колбэки. Состояние/AsyncStorage живут выше
 * (в DashboardScreen через usePreference) — здесь только UI.
 *
 * iOS-паттерн «Настройки»: тумблер на каждую строку (мгновенное применение,
 * без кнопки «Сохранить»), кнопка «Сбросить» внизу возвращает все виджеты
 * к дефолту (всё включено). Android-safe: Switch кроссплатформенный.
 */
import React from 'react';
import { Modal, View, ScrollView, StyleSheet, Switch, Pressable, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../../platform/Typography';
import { useColors } from '../../contexts/ThemeContext';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../../theme';
import { iosSectionLabel } from '../../platform/iosSurface';
import { haptic } from '../../platform/haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { DashboardWidgetDef, WidgetVisibility } from './dashboardWidgets';
import { isWidgetVisible } from './dashboardWidgets';

interface Props {
  visible: boolean;
  /** Уже в пользовательском порядке — модалка рендерит как есть. */
  widgets: DashboardWidgetDef[];
  visibility: WidgetVisibility;
  onToggle: (id: string, next: boolean) => void;
  /** Сдвиг виджета на одну позицию: dir −1 вверх, +1 вниз. */
  onMove: (id: string, dir: -1 | 1) => void;
  onReset: () => void;
  onClose: () => void;
}

export default function DashboardWidgetsModal({
  visible,
  widgets,
  visibility,
  onToggle,
  onMove,
  onReset,
  onClose,
}: Props) {
  const palette = useColors();
  const insets = useSafeAreaInsets();

  const handleToggle = (id: string, next: boolean) => {
    haptic('tap');
    onToggle(id, next);
  };

  const handleMove = (id: string, dir: -1 | 1) => {
    haptic('select');
    onMove(id, dir);
  };

  const handleReset = () => {
    haptic('tap');
    onReset();
  };

  const visibleCount = widgets.filter((w) => isWidgetVisible(visibility, w.id)).length;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      transparent={false}
    >
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        {/* Header — sheet-style: заголовок + «Готово» справа. */}
        <View style={[styles.header, { paddingTop: insets.top + spacing[3] }]}>
          <View style={styles.headerSide} />
          <View style={styles.headerCenter}>
            <Text variant="bodyEmph" style={[styles.headerTitle, { color: palette.text.primary }]} numberOfLines={1}>
              Виджеты
            </Text>
            <Text style={[styles.headerSub, { color: palette.text.tertiary }]} numberOfLines={1}>
              {visibleCount} из {widgets.length} показаны
            </Text>
          </View>
          <Pressable
            onPress={onClose}
            hitSlop={10}
            style={styles.headerSide}
            accessibilityRole="button"
            accessibilityLabel="Готово"
          >
            <Text style={[styles.doneBtn, { color: palette.accent.primary }]}>Готово</Text>
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + spacing[8] }]}
          showsVerticalScrollIndicator={false}
        >
          <Text style={[iosSectionLabel, styles.sectionTitle, { color: palette.text.secondary }]}>
            ПОРЯДОК И ВИДИМОСТЬ
          </Text>
          <View style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
            {widgets.map((w, idx) => (
              <React.Fragment key={w.id}>
                <View style={styles.row}>
                  <Text style={[styles.rowLabel, { color: palette.text.primary }]} numberOfLines={2}>
                    {w.label}
                  </Text>
                  <Pressable
                    onPress={() => handleMove(w.id, -1)}
                    disabled={idx === 0}
                    hitSlop={6}
                    style={[styles.moveBtn, { backgroundColor: palette.bg.muted }, idx === 0 && styles.moveBtnOff]}
                    accessibilityRole="button"
                    accessibilityLabel={`Поднять «${w.label}» выше`}
                  >
                    <Ionicons name="chevron-up" size={16} color={palette.text.secondary} />
                  </Pressable>
                  <Pressable
                    onPress={() => handleMove(w.id, 1)}
                    disabled={idx === widgets.length - 1}
                    hitSlop={6}
                    style={[
                      styles.moveBtn,
                      { backgroundColor: palette.bg.muted },
                      idx === widgets.length - 1 && styles.moveBtnOff,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={`Опустить «${w.label}» ниже`}
                  >
                    <Ionicons name="chevron-down" size={16} color={palette.text.secondary} />
                  </Pressable>
                  <Switch
                    value={isWidgetVisible(visibility, w.id)}
                    onValueChange={(next) => handleToggle(w.id, next)}
                    trackColor={{ false: palette.border.subtle, true: palette.accent.primary }}
                    thumbColor={Platform.OS === 'android' ? colors.white : undefined}
                    ios_backgroundColor={palette.border.subtle}
                  />
                </View>
                {idx < widgets.length - 1 && (
                  <View style={[styles.separator, { backgroundColor: palette.border.subtle }]} />
                )}
              </React.Fragment>
            ))}
          </View>

          <Pressable
            onPress={handleReset}
            style={({ pressed }) => [
              styles.resetBtn,
              { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
              pressed && { opacity: 0.6 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Сбросить настройки виджетов"
          >
            <Ionicons name="refresh-outline" size={18} color={palette.accent.primary} />
            <Text style={[styles.resetBtnText, { color: palette.accent.primary }]}>Сбросить (порядок и видимость)</Text>
          </Pressable>

          <Text style={[styles.footer, { color: palette.text.tertiary }]}>
            Порядок и видимость виджетов хранятся только на этом устройстве.
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
  },
  headerSide: { minWidth: 64, justifyContent: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  headerTitle: { fontSize: 17, fontWeight: '600', letterSpacing: -0.4 },
  headerSub: { fontSize: 12, marginTop: 1 },
  doneBtn: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, textAlign: 'right' },

  scrollContent: { paddingHorizontal: spacing[4], paddingTop: spacing[2], gap: spacing[4] },
  sectionTitle: { marginLeft: spacing[3], marginBottom: spacing[1.5] },

  card: {
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    shadowColor: colors.black,
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
    ...(Platform.OS === 'android' ? { elevation: 1 } : null),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    minHeight: 54,
  },
  rowLabel: { flex: 1, fontSize: 16, fontWeight: '500', letterSpacing: -0.2 },
  moveBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moveBtnOff: { opacity: 0.35 },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: spacing[4] },

  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: spacing[4],
  },
  resetBtnText: { fontSize: fontSize.base, fontWeight: fontWeight.semibold },

  footer: {
    fontSize: fontSize.xs,
    lineHeight: 18,
    marginTop: spacing[1],
    marginLeft: spacing[3],
    marginRight: spacing[3],
  },
});
