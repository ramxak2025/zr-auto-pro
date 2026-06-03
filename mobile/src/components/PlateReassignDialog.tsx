/**
 * PlateReassignDialog — #15.3 data-integrity dialog for changing/assigning a
 * car's plate when that plate already belongs to ANOTHER car.
 *
 * Unlike the generic DuplicateWarningDialog (which offers "create a
 * duplicate"), reassignment must be explicit and safe:
 *   • Отмена            — abort, keep both cars as-is.
 *   • Открыть владельца — jump to the other car's owner card to investigate.
 *   • Переназначить      — strip the plate off the other car («без номеров»)
 *                          and move it here. Check history stays intact on
 *                          both cars (keyed to car_id, not the plate string).
 *
 * Built on the shared <Modal> so it inherits the blur backdrop (ModalBlurBackdrop).
 */
import React from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Modal from './Modal';
import { Text } from '../platform/Typography';
import { useColors } from '../contexts/ThemeContext';
import { colors, spacing, borderRadius } from '../theme';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Strip the plate off the other car and assign it here. */
  onReassign: () => void;
  /** Open the other car's owner card. Hidden when there's no owner. */
  onOpenOwner?: () => void;
  plate: string;
  otherCarLabel: string;
  otherOwnerName?: string | null;
  busy?: boolean;
}

export default function PlateReassignDialog({
  visible,
  onClose,
  onReassign,
  onOpenOwner,
  plate,
  otherCarLabel,
  otherOwnerName,
  busy,
}: Props) {
  const palette = useColors();
  return (
    <Modal visible={visible} onClose={onClose} title="Госномер уже занят">
      <View style={styles.row}>
        <View style={styles.iconBox}>
          <Ionicons name="swap-horizontal" size={20} color="#D97706" />
        </View>
        <Text variant="footnote" color={palette.text.secondary} style={styles.description}>
          Госномер {plate} уже закреплён за другой машиной
          {otherOwnerName ? ` клиента «${otherOwnerName}»` : ''}. Можно перенести его сюда — номер
          уйдёт с той машины (она станет «без номеров»), а вся история чеков сохранится у обеих.
        </Text>
      </View>

      <TouchableOpacity
        activeOpacity={onOpenOwner ? 0.7 : 1}
        onPress={onOpenOwner}
        disabled={!onOpenOwner}
        style={[styles.existingCard, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
      >
        <View style={styles.existingHeader}>
          <Ionicons name="car-outline" size={16} color={palette.text.tertiary} />
          <View style={{ flex: 1 }}>
            <Text variant="body" color={palette.text.primary} numberOfLines={1} style={styles.existingLabel}>
              {otherCarLabel}
            </Text>
            {otherOwnerName ? (
              <Text variant="caption" color={palette.text.tertiary} numberOfLines={1}>
                Клиент: {otherOwnerName}
              </Text>
            ) : null}
          </View>
          {onOpenOwner ? <Ionicons name="chevron-forward" size={18} color={palette.text.tertiary} /> : null}
        </View>
      </TouchableOpacity>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.cancelBtn, { backgroundColor: palette.bg.muted }]}
          onPress={onClose}
          disabled={busy}
        >
          <Text variant="body" color={palette.text.secondary} style={styles.btnText}>
            Отмена
          </Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.confirmBtn} onPress={onReassign} disabled={busy}>
          <Text variant="body" color={colors.white} style={styles.btnText}>
            {busy ? 'Перенос…' : 'Переназначить'}
          </Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing[3], alignItems: 'flex-start', marginBottom: spacing[3] },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: borderRadius.lg,
    backgroundColor: '#FEF3C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  description: { flex: 1, lineHeight: 20 },
  existingCard: {
    borderWidth: 1,
    borderRadius: borderRadius.xl,
    padding: spacing[3],
    marginBottom: spacing[3],
  },
  existingHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  existingLabel: { fontWeight: '600' },
  actions: { flexDirection: 'row', gap: spacing[2] },
  cancelBtn: {
    flex: 1,
    paddingVertical: spacing[3],
    borderRadius: borderRadius.lg,
    alignItems: 'center',
  },
  confirmBtn: {
    flex: 1,
    paddingVertical: spacing[3],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primary[600],
    alignItems: 'center',
  },
  btnText: { fontWeight: '600' },
});
