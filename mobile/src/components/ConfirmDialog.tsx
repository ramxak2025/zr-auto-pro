import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import Modal from './Modal';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import { useColors } from '../contexts/ThemeContext';

interface ConfirmDialogProps {
  visible: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  variant?: 'danger' | 'primary';
}

export default function ConfirmDialog({
  visible,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Подтвердить',
  variant = 'primary',
}: ConfirmDialogProps) {
  const isDanger = variant === 'danger';
  const palette = useColors();

  return (
    <Modal visible={visible} onClose={onClose} title={title}>
      <Text style={[styles.message, { color: palette.text.secondary }]}>{message}</Text>
      <View style={[styles.actions, { borderTopColor: palette.border.subtle }]}>
        <TouchableOpacity
          style={[styles.cancelBtn, { borderColor: palette.border.strong, backgroundColor: palette.bg.elevated }]}
          onPress={onClose}
        >
          <Text style={[styles.cancelText, { color: palette.text.secondary }]}>Отмена</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.confirmBtn, isDanger && styles.dangerBtn]}
          onPress={() => {
            onConfirm();
            onClose();
          }}
        >
          <Text style={styles.confirmText}>{confirmText}</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  message: {
    fontSize: fontSize.sm,
    // color comes from palette.text.secondary (theme-aware) inline.
    marginBottom: spacing[6],
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[3],
    paddingTop: spacing[4],
    borderTopWidth: 1,
    // borderTopColor from palette.border.subtle inline.
  },
  cancelBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    // M3 buttons are pill-shaped; iOS prefers a softer squircle. Branch
    // so each platform reads as native.
    borderRadius: Platform.OS === 'android' ? 999 : borderRadius.lg,
    borderWidth: 1,
    // borderColor + backgroundColor from palette inline (theme-aware).
  },
  cancelText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    // color from palette.text.secondary inline.
  },
  confirmBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderRadius: Platform.OS === 'android' ? 999 : borderRadius.lg,
    backgroundColor: colors.primary[600],
  },
  dangerBtn: {
    backgroundColor: colors.red[600],
  },
  confirmText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.white,
  },
});
