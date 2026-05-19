import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import Modal from './Modal';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';

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

  return (
    <Modal visible={visible} onClose={onClose} title={title}>
      <Text style={styles.message}>{message}</Text>
      <View style={styles.actions}>
        <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
          <Text style={styles.cancelText}>Отмена</Text>
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
    color: colors.gray[600],
    marginBottom: spacing[6],
    lineHeight: 20,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[3],
    paddingTop: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colors.gray[200],
  },
  cancelBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    // M3 buttons are pill-shaped; iOS prefers a softer squircle. Branch
    // so each platform reads as native.
    borderRadius: Platform.OS === 'android' ? 999 : borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.gray[300],
    backgroundColor: colors.white,
  },
  cancelText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.gray[700],
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
