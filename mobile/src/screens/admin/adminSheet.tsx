/**
 * adminSheet — общая шторка и поля форм платформенных экранов (менеджеры, расчёты,
 * продление, передача клиента, сброс пароля владельца). Тот же вид и те же отступы,
 * что у шторок сотрудника/филиала в карточке автосервиса.
 *
 * Клавиатура: RN-core <Modal> — отдельное нативное окно, поэтому внутри свой
 * KeyboardProvider, а поля прокручивает KeyboardAwareScroll (правило проекта, см.
 * components/KeyboardAware.tsx).
 */
import React from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  TextInput,
  View,
  useWindowDimensions,
  type TextInputProps,
} from 'react-native';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { KeyboardAwareScroll } from '../../components/KeyboardAware';
import { Text } from '../../platform/Typography';
import { haptic } from '../../platform/haptics';
import { useColors } from '../../contexts/ThemeContext';
import { useIosSurface } from '../../platform/iosSurface';
import { colors, spacing, borderRadius } from '../../theme';
import { genPassword } from './adminShared';

interface AdminSheetProps {
  visible: boolean;
  title: string;
  saveLabel?: string;
  saving?: boolean;
  saveDisabled?: boolean;
  destructive?: boolean;
  onClose: () => void;
  onSave: () => void;
  children: React.ReactNode;
}

/** Нижняя шторка: «Отмена · Заголовок · Действие» + скролл с полями. */
export function AdminSheet({
  visible,
  title,
  saveLabel = 'Сохранить',
  saving = false,
  saveDisabled = false,
  destructive = false,
  onClose,
  onSave,
  children,
}: AdminSheetProps) {
  const palette = useColors();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  return (
    <Modal visible={visible} transparent statusBarTranslucent animationType="slide" onRequestClose={onClose}>
      <KeyboardProvider>
        <View style={[styles.sheetBackdrop, { paddingLeft: insets.left, paddingRight: insets.right }]}>
          <View style={[styles.sheet, { backgroundColor: palette.bg.canvas, maxHeight: height - insets.top - 12 }]}>
            <Text accessibilityRole="header" style={[styles.sheetTitle, { color: palette.text.primary }]}>
              {title}
            </Text>
            <View style={[styles.sheetHandleRow, { borderBottomColor: palette.border.subtle }]}>
              <Pressable onPress={onClose} style={styles.headerButton} accessibilityRole="button">
                <Text style={[styles.sheetCancel, { color: palette.text.secondary }]}>Отмена</Text>
              </Pressable>
              <Pressable
                onPress={onSave}
                disabled={saving || saveDisabled}
                style={styles.headerButton}
                accessibilityRole="button"
                accessibilityLabel={saveLabel}
                accessibilityState={{ disabled: saving || saveDisabled, busy: saving }}
              >
                {saving ? (
                  <ActivityIndicator size="small" color={palette.accent.primary} />
                ) : (
                  <Text
                    style={[
                      styles.sheetSave,
                      {
                        color: saveDisabled
                          ? palette.text.tertiary
                          : destructive
                            ? colors.red[600]
                            : palette.accent.primary,
                      },
                    ]}
                  >
                    {saveLabel}
                  </Text>
                )}
              </Pressable>
            </View>
            <KeyboardAwareScroll
              style={styles.form}
              reserveTabBar={false}
              extraKeyboardBottomOffset={16}
              contentContainerStyle={[styles.sheetScroll, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}
              showsVerticalScrollIndicator={false}
            >
              {children}
            </KeyboardAwareScroll>
          </View>
        </View>
      </KeyboardProvider>
    </Modal>
  );
}

/** Подпись над полем. */
export function SheetLabel({ children }: { children: string }) {
  const palette = useColors();
  return <Text style={[styles.fieldLabel, { color: palette.text.tertiary }]}>{children}</Text>;
}

interface SheetInputProps {
  label?: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: TextInputProps['keyboardType'];
  autoCapitalize?: TextInputProps['autoCapitalize'];
  multiline?: boolean;
  maxLength?: number;
  /** Крупная цифра — для сумм. */
  big?: boolean;
}

/** Текстовое поле шторки (подпись + карточка-обёртка). */
export function SheetInput({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  autoCapitalize,
  multiline,
  maxLength,
  big,
}: SheetInputProps) {
  const palette = useColors();
  const surface = useIosSurface();
  return (
    <>
      {label ? <SheetLabel>{label}</SheetLabel> : null}
      <View style={[styles.inputWrap, surface.cardCompact]}>
        <TextInput
          style={[
            styles.sheetInput,
            big && styles.amountInput,
            multiline && styles.multiline,
            { color: palette.text.primary },
          ]}
          placeholder={placeholder}
          placeholderTextColor={palette.text.tertiary}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          multiline={multiline}
          maxLength={maxLength}
          value={value}
          onChangeText={onChangeText}
        />
      </View>
    </>
  );
}

interface SheetPasswordFieldProps {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
}

/** Пароль: глазок + «Сгенерировать пароль» (без 0/O, 1/l/I — диктуется по телефону). */
export function SheetPasswordField({ label, value, onChangeText, placeholder }: SheetPasswordFieldProps) {
  const palette = useColors();
  const surface = useIosSurface();
  const [visible, setVisible] = React.useState(false);
  return (
    <>
      <SheetLabel>{label}</SheetLabel>
      <View style={[styles.inputWrap, styles.pwRow, surface.cardCompact]}>
        <TextInput
          style={[styles.sheetInput, styles.pwInput, { color: palette.text.primary }]}
          placeholder={placeholder}
          placeholderTextColor={palette.text.tertiary}
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoCorrect={false}
          value={value}
          onChangeText={onChangeText}
        />
        <Pressable onPress={() => setVisible((v) => !v)} hitSlop={8}>
          <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={20} color={palette.text.tertiary} />
        </Pressable>
      </View>
      <Pressable
        onPress={() => {
          haptic('select');
          setVisible(true);
          onChangeText(genPassword());
        }}
        style={styles.genPwBtn}
        hitSlop={4}
      >
        <Ionicons name="sparkles-outline" size={14} color={palette.accent.primary} />
        <Text style={[styles.genPwText, { color: palette.accent.primary }]}>Сгенерировать пароль</Text>
      </Pressable>
    </>
  );
}

interface SheetSegmentedProps<T extends string> {
  options: { value: T; label: string; icon?: keyof typeof Ionicons.glyphMap }[];
  value: T;
  onChange: (v: T) => void;
}

/** Переключатель «Платно / Бесплатно» и подобные. */
export function SheetSegmented<T extends string>({ options, value, onChange }: SheetSegmentedProps<T>) {
  const palette = useColors();
  return (
    <View style={styles.segmented}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <Pressable
            key={o.value}
            onPress={() => {
              haptic('select');
              onChange(o.value);
            }}
            style={[
              styles.segment,
              {
                backgroundColor: on ? palette.accent.primary : palette.bg.card,
                borderColor: on ? palette.accent.primary : palette.border.subtle,
              },
            ]}
          >
            {o.icon ? <Ionicons name={o.icon} size={16} color={on ? colors.white : palette.text.secondary} /> : null}
            <Text style={[styles.segmentText, { color: on ? colors.white : palette.text.secondary }]}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

interface SheetChipsProps {
  chips: { label: string; onPress: () => void; active?: boolean }[];
}

/** Пресеты одной строкой: «7 дн. · 14 дн. · 30 дн.», «+30 дней · +90 дней · +год». */
export function SheetChips({ chips }: SheetChipsProps) {
  const palette = useColors();
  return (
    <View style={styles.presetRow}>
      {chips.map((c) => (
        <Pressable
          key={c.label}
          onPress={c.onPress}
          style={[
            styles.presetChip,
            {
              backgroundColor: c.active ? palette.accent.primary : palette.bg.card,
              borderColor: c.active ? palette.accent.primary : palette.border.subtle,
            },
          ]}
        >
          <Text style={[styles.presetChipText, { color: c.active ? colors.white : palette.text.secondary }]}>
            {c.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

interface SheetSwitchRowProps {
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}

/** Строка-переключатель в карточке. */
export function SheetSwitchRow({ label, value, onValueChange }: SheetSwitchRowProps) {
  const palette = useColors();
  const surface = useIosSurface();
  return (
    <View style={[styles.switchBox, surface.cardCompact]}>
      <Text style={[styles.switchLabel, { color: palette.text.primary }]}>{label}</Text>
      <Switch
        value={value}
        onValueChange={(v) => {
          haptic('select');
          onValueChange(v);
        }}
        trackColor={{ true: palette.accent.primary }}
      />
    </View>
  );
}

interface SheetHintProps {
  icon: keyof typeof Ionicons.glyphMap;
  /** Цвет иконки; по умолчанию приглушённый. */
  tint?: string;
  children: React.ReactNode;
}

/** Подсказка под полем: иконка + текст (доля владельца, лимит дней, ошибка). */
export function SheetHint({ icon, tint, children }: SheetHintProps) {
  const palette = useColors();
  return (
    <View style={styles.hintRow}>
      <Ionicons name={icon} size={15} color={tint ?? palette.text.tertiary} />
      <Text style={[styles.hintText, { color: palette.text.secondary }]}>{children}</Text>
    </View>
  );
}

interface SheetOptionRowProps {
  title: string;
  subtitle?: string;
  selected: boolean;
  onPress: () => void;
}

/** Вариант выбора в списке (менеджер, тариф): отметка справа, выбранный подсвечен. */
export function SheetOptionRow({ title, subtitle, selected, onPress }: SheetOptionRowProps) {
  const palette = useColors();
  const surface = useIosSurface();
  return (
    <Pressable
      onPress={() => {
        haptic('select');
        onPress();
      }}
      style={[
        styles.optionRow,
        surface.cardCompact,
        selected && { borderColor: palette.accent.primary, backgroundColor: palette.accent.primarySoft },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[styles.optionTitle, { color: palette.text.primary }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.optionSubtitle, { color: palette.text.tertiary }]} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <Ionicons
        name={selected ? 'checkmark-circle' : 'ellipse-outline'}
        size={22}
        color={selected ? palette.accent.primary : palette.text.tertiary}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  sheet: {
    flexShrink: 1,
    borderTopLeftRadius: borderRadius['3xl'],
    borderTopRightRadius: borderRadius['3xl'],
    paddingTop: spacing[2],
  },
  sheetHandleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[1],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sheetCancel: { fontSize: 15, fontWeight: '500' },
  sheetTitle: { fontSize: 20, fontWeight: '700', paddingHorizontal: spacing[4], paddingTop: spacing[3] },
  headerButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: spacing[1], flexShrink: 1 },
  form: { flexGrow: 0, flexShrink: 1 },
  sheetSave: { fontSize: 15, fontWeight: '700' },
  sheetScroll: { padding: spacing[4], gap: spacing[2] },
  fieldLabel: { fontSize: 12, fontWeight: '600', marginLeft: spacing[1], marginTop: spacing[2] },
  inputWrap: { paddingHorizontal: spacing[3] },
  sheetInput: { fontSize: 16, paddingVertical: spacing[3] },
  amountInput: { fontSize: 20, fontWeight: '700', fontVariant: ['tabular-nums'] },
  multiline: { minHeight: 72, textAlignVertical: 'top' },
  pwRow: { flexDirection: 'row', alignItems: 'center' },
  pwInput: { flex: 1 },
  genPwBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing[1],
    marginTop: spacing[1.5],
    marginLeft: spacing[1],
  },
  genPwText: { fontSize: 13, fontWeight: '600' },
  segmented: { flexDirection: 'row', gap: spacing[2] },
  segment: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  segmentText: { fontSize: 15, fontWeight: '700' },
  presetRow: { flexDirection: 'row', gap: spacing[2] },
  presetChip: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
  },
  presetChipText: { fontSize: 13, fontWeight: '600' },
  switchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    marginTop: spacing[3],
  },
  switchLabel: { flex: 1, fontSize: 15, fontWeight: '600' },
  hintRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2], marginTop: spacing[3] },
  hintText: { flex: 1, fontSize: 13, lineHeight: 18 },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
  },
  optionTitle: { fontSize: 15, fontWeight: '600' },
  optionSubtitle: { fontSize: 12, marginTop: 2 },
});
