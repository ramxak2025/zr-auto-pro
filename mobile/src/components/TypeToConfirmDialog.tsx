/**
 * TypeToConfirmDialog — деструктивный «шлюз с набором слова».
 *
 * Для необратимо-выглядящих массовых действий (удалить выбранное / удалить весь
 * товар) одного тапа мало: владелец должен НАБРАТЬ подтверждающее слово (по
 * умолчанию «согласен»), и только тогда кнопка подтверждения разблокируется.
 * Это осознанная пауза перед тем, как N товаров/папок уедут в Корзину.
 *
 * Построен на общем `./Modal` (уже keyboard-aware: активное поле держится над
 * клавиатурой, тап по фону закрывает). Ничего платформо-специфичного —
 * одинаково работает на iOS и Android.
 *
 * Сравнение регистронезависимое и по trim: «Согласен», « согласен » — годятся.
 */
import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import Modal from './Modal';
import { useColors } from '../contexts/ThemeContext';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';

interface TypeToConfirmDialogProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  /** Слово, которое нужно набрать для разблокировки. По умолчанию «согласен». */
  confirmWord?: string;
  /** Подпись кнопки подтверждения. */
  confirmText?: string;
  /** Опциональный счётчик — сколько будет удалено (для «Удалить (N)»). */
  count?: number;
}

export default function TypeToConfirmDialog({
  visible,
  onClose,
  onConfirm,
  title,
  message,
  confirmWord = 'согласен',
  confirmText = 'Удалить',
  count,
}: TypeToConfirmDialogProps) {
  const palette = useColors();
  const [value, setValue] = useState('');

  // Каждое открытие — чистое поле, чтобы предыдущее набранное слово не
  // разблокировало кнопку на новом диалоге.
  useEffect(() => {
    if (visible) setValue('');
  }, [visible]);

  const matched = value.trim().toLowerCase() === confirmWord.trim().toLowerCase();

  return (
    <Modal visible={visible} onClose={onClose} title={title}>
      <Text style={[styles.message, { color: palette.text.secondary }]}>{message}</Text>

      <Text style={[styles.hint, { color: palette.text.tertiary }]}>
        {'Для подтверждения введите слово '}
        <Text style={[styles.hintWord, { color: palette.text.primary }]}>{confirmWord}</Text>
      </Text>
      <TextInput
        value={value}
        onChangeText={setValue}
        style={[
          styles.input,
          { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
        ]}
        placeholder={confirmWord}
        placeholderTextColor={palette.text.tertiary}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
      />

      <View style={[styles.actions, { borderTopColor: palette.border.subtle }]}>
        <TouchableOpacity
          style={[styles.cancelBtn, { borderColor: palette.border.strong, backgroundColor: palette.bg.elevated }]}
          onPress={onClose}
        >
          <Text style={[styles.cancelText, { color: palette.text.secondary }]}>Отмена</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.confirmBtn, !matched && styles.confirmBtnDisabled]}
          disabled={!matched}
          onPress={() => {
            if (!matched) return;
            onConfirm();
            onClose();
          }}
        >
          <Text style={styles.confirmText}>
            {confirmText}
            {typeof count === 'number' && count > 0 ? ` (${count})` : ''}
          </Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  message: {
    fontSize: fontSize.sm,
    marginBottom: spacing[4],
    lineHeight: 20,
  },
  hint: {
    fontSize: fontSize.xs,
    marginBottom: spacing[1.5],
  },
  hintWord: {
    fontWeight: fontWeight.bold,
  },
  input: {
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[2.5],
    fontSize: fontSize.sm,
    marginBottom: spacing[6],
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[3],
    paddingTop: spacing[4],
    borderTopWidth: 1,
  },
  cancelBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },
  cancelText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
  },
  confirmBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.red[600],
  },
  confirmBtnDisabled: {
    backgroundColor: colors.gray[300],
  },
  confirmText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.white,
  },
});
