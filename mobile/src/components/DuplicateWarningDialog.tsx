import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Modal from './Modal';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';

interface DuplicateWarningDialogProps {
  visible: boolean;
  onClose: () => void;
  onCreateAnyway: () => void;
  onOpenExisting: () => void;
  title: string;
  description: string;
  existingLabel: string;
  existingSubtitle?: string;
  openExistingLabel?: string;
  existingCars?: Array<{ plateNumber: string; makeModel: string }>;
}

/**
 * Native mobile mirror of `frontend/src/components/DuplicateWarningDialog`.
 * Shown before creating a client/car that already exists in the tenant.
 * Offers to open the existing record or create a duplicate anyway.
 */
export default function DuplicateWarningDialog({
  visible,
  onClose,
  onCreateAnyway,
  onOpenExisting,
  title,
  description,
  existingLabel,
  existingSubtitle,
  openExistingLabel = 'Открыть существующего',
  existingCars,
}: DuplicateWarningDialogProps) {
  return (
    <Modal visible={visible} onClose={onClose} title={title}>
      <View style={styles.row}>
        <View style={styles.iconBox}>
          <Ionicons name="warning-outline" size={20} color="#D97706" />
        </View>
        <Text style={styles.description}>{description}</Text>
      </View>

      <TouchableOpacity activeOpacity={0.7} onPress={onOpenExisting} style={styles.existingCard}>
        <View style={styles.existingHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.existingLabel} numberOfLines={1}>
              {existingLabel}
            </Text>
            {existingSubtitle ? (
              <Text style={styles.existingSubtitle} numberOfLines={1}>
                {existingSubtitle}
              </Text>
            ) : null}
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.gray[400]} />
        </View>

        {existingCars && existingCars.length > 0 && (
          <View style={styles.carsBox}>
            <Text style={styles.carsHeader}>Уже привязано:</Text>
            <ScrollView style={{ maxHeight: 140 }}>
              {existingCars.slice(0, 5).map((car, i) => (
                <View key={i} style={styles.carRow}>
                  <Ionicons name="car-outline" size={14} color={colors.gray[500]} />
                  <Text style={styles.carPlate}>{car.plateNumber}</Text>
                  <Text style={styles.carModel} numberOfLines={1}>
                    {car.makeModel}
                  </Text>
                </View>
              ))}
              {existingCars.length > 5 && <Text style={styles.carsMore}>… и ещё {existingCars.length - 5}</Text>}
            </ScrollView>
          </View>
        )}
      </TouchableOpacity>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
          <Text style={styles.cancelText}>Отмена</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.confirmBtn} onPress={onOpenExisting}>
          <Text style={styles.confirmText}>{openExistingLabel}</Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity onPress={onCreateAnyway} style={styles.createAnyway}>
        <Text style={styles.createAnywayText}>Всё равно создать</Text>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing[3],
    alignItems: 'flex-start',
    marginBottom: spacing[3],
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.lg,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  description: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.gray[700],
    lineHeight: 20,
  },
  existingCard: {
    backgroundColor: colors.gray[50],
    borderWidth: 1,
    borderColor: colors.gray[200],
    borderRadius: borderRadius.xl,
    padding: spacing[3],
    marginBottom: spacing[3],
  },
  existingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  existingLabel: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.semibold,
    color: colors.gray[900],
  },
  existingSubtitle: {
    fontSize: fontSize.xs,
    color: colors.gray[500],
    marginTop: 2,
  },
  carsBox: {
    marginTop: spacing[2],
    paddingTop: spacing[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.gray[200],
  },
  carsHeader: {
    fontSize: fontSize.xs,
    color: colors.gray[500],
    fontWeight: fontWeight.medium,
    marginBottom: spacing[1.5] || 6,
  },
  carRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 3,
  },
  carPlate: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    fontFamily: 'monospace',
    color: colors.gray[900],
  },
  carModel: {
    flex: 1,
    fontSize: fontSize.xs,
    color: colors.gray[600],
  },
  carsMore: {
    fontSize: fontSize.xs,
    color: colors.gray[400],
    paddingTop: 4,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: spacing[3],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.gray[100],
    alignItems: 'center',
  },
  cancelText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.gray[700],
  },
  confirmBtn: {
    flex: 1,
    paddingVertical: spacing[3],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primary[600],
    alignItems: 'center',
  },
  confirmText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: '#FFFFFF',
  },
  createAnyway: {
    marginTop: spacing[2],
    paddingVertical: spacing[2],
    alignItems: 'center',
  },
  createAnywayText: {
    fontSize: fontSize.xs,
    color: colors.gray[500],
  },
});
