import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, Modal as RNModal, StyleSheet, Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';

interface Props {
  visible: boolean;
  value: Date;
  mode: 'date' | 'time';
  onConfirm: (date: Date) => void;
  onCancel: () => void;
}

export default function DateTimePickerModal({ visible, value, mode, onConfirm, onCancel }: Props) {
  const [tempDate, setTempDate] = useState(value);

  useEffect(() => {
    if (visible) setTempDate(value);
  }, [visible, value]);

  // On Android, DateTimePicker is already a native modal dialog
  if (Platform.OS === 'android') {
    if (!visible) return null;
    return (
      <DateTimePicker
        value={value}
        mode={mode}
        display="default"
        is24Hour
        onChange={(_, d) => {
          if (d) onConfirm(d);
          else onCancel();
        }}
      />
    );
  }

  // On iOS, wrap in a custom modal with confirm/cancel
  return (
    <RNModal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onCancel} />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <TouchableOpacity onPress={onCancel} style={styles.headerBtn}>
              <Text style={styles.cancelText}>Отмена</Text>
            </TouchableOpacity>
            <Text style={styles.title}>{mode === 'date' ? 'Выберите дату' : 'Выберите время'}</Text>
            <TouchableOpacity onPress={() => onConfirm(tempDate)} style={styles.headerBtn}>
              <Text style={styles.doneText}>Готово</Text>
            </TouchableOpacity>
          </View>
          <DateTimePicker
            value={tempDate}
            mode={mode}
            display="spinner"
            is24Hour
            onChange={(_, d) => { if (d) setTempDate(d); }}
            style={{ height: 200 }}
          />
        </View>
      </View>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    width: '100%',
    overflow: 'hidden',
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[100],
  },
  headerBtn: {
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
  },
  title: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
  },
  cancelText: {
    fontSize: fontSize.sm,
    color: colors.gray[500],
    fontWeight: fontWeight.medium,
  },
  doneText: {
    fontSize: fontSize.sm,
    color: colors.primary[600],
    fontWeight: fontWeight.bold,
  },
});
