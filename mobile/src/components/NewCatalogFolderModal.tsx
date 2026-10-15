import React, { useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, TouchableOpacity } from 'react-native';
import Modal from './Modal';
import { useColors } from '../contexts/ThemeContext';
import { borderRadius, colors, fontSize, fontWeight, spacing } from '../theme';
import { newCatalogFolderPath } from '../utils/catalogFolderName';
import { extractApiErrorMessage } from '../utils/apiError';

interface Props {
  parentPath: string;
  rootLabel: string;
  onCreate: (path: string) => Promise<void>;
  onClose: () => void;
}

/** Mounted only while open, so a new location always starts with a fresh form. */
export default function NewCatalogFolderModal({ parentPath, rootLabel, onCreate, onClose }: Props) {
  const palette = useColors();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const save = async () => {
    // A ref also blocks two taps delivered before React commits the busy state.
    if (submitting.current) return;
    let path: string;
    try {
      path = newCatalogFolderPath(parentPath, name);
    } catch (err) {
      setError(extractApiErrorMessage(err, 'Проверьте название папки.'));
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      await onCreate(path);
    } catch (err) {
      setError(extractApiErrorMessage(err, 'Не удалось создать папку. Проверьте соединение и повторите.'));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  return (
    <Modal
      visible
      onClose={() => {
        if (!submitting.current) onClose();
      }}
      title="Новая папка"
    >
      <Text style={[styles.location, { color: palette.text.secondary }]}>
        Расположение: {rootLabel}
        {parentPath ? ` / ${parentPath.split('/').join(' / ')}` : ' · корень'}
      </Text>
      <Text style={[styles.label, { color: palette.text.primary }]}>Название папки</Text>
      <TextInput
        autoFocus
        accessibilityLabel="Название папки"
        value={name}
        editable={!busy}
        onChangeText={(value) => {
          setName(value);
          setError('');
        }}
        placeholder="Например, Расходники"
        placeholderTextColor={palette.text.secondary}
        returnKeyType="done"
        onSubmitEditing={() => void save()}
        style={[
          styles.input,
          {
            color: palette.text.primary,
            backgroundColor: palette.bg.muted,
            borderColor: error ? colors.red[600] : palette.border.subtle,
          },
        ]}
      />
      {!!error && (
        <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.error}>
          {error}
        </Text>
      )}
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Создать папку"
        accessibilityState={{ disabled: busy || !name.trim(), busy }}
        disabled={busy || !name.trim()}
        onPress={() => void save()}
        style={[styles.submit, { backgroundColor: palette.accent.primary, opacity: busy || !name.trim() ? 0.5 : 1 }]}
      >
        {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.submitText}>Создать папку</Text>}
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  location: { fontSize: fontSize.sm, marginBottom: spacing[4] },
  label: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, marginBottom: spacing[2] },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    fontSize: fontSize.base,
  },
  error: { color: colors.red[600], fontSize: fontSize.sm, marginTop: spacing[2] },
  submit: {
    minHeight: 48,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing[4],
  },
  submitText: { color: colors.white, fontSize: fontSize.base, fontWeight: fontWeight.semibold },
});
