/**
 * ClientPhonePickerSheet — выбор владельца по ТЕЛЕФОНУ для «Сменить владельца».
 *
 * Отдельный от QuickClientCreateSheet пикер: при смене владельца авто владельцу
 * НЕ нужен ввод госномера / марки — авто и так уже выбрано, переносим только
 * владельца. Поэтому здесь только:
 *   • поле телефона (live-поиск по подстроке — бэкенд match'ит по номеру),
 *   • список найденных клиентов → тап выбирает существующего владельца,
 *   • «Создать нового клиента» → имя + телефон (без номера/марки) → создаём и
 *     сразу отдаём как выбранного владельца.
 *
 * Построен на общем `BottomSheet` (keyboard-aware + backdrop-tap-to-close).
 * Ничего платформо-специфичного — работает одинаково на iOS и Android.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { clientsApi } from '../api/services';
import { BottomSheet } from './BottomSheet';
import { formatPhone } from '../../../shared/validation/phone';
import { otherPointPhoneConflictMessage } from '../../../shared/utils/apiError';
import { haptic } from '../platform/haptics';
import { useColors } from '../contexts/ThemeContext';
import { colors, fontSize, fontWeight, borderRadius, spacing } from '../theme';
import type { Client } from '../../../shared/types';

interface ClientPhonePickerSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Владелец выбран/создан — родитель уводит его в поток подтверждения переноса. */
  onPicked: (clientId: string, clientName: string) => void;
  /** id текущего владельца — прячем его из результатов (переносить самому себе нечего). */
  excludeClientId?: string;
}

export default function ClientPhonePickerSheet({
  visible,
  onClose,
  onPicked,
  excludeClientId,
}: ClientPhonePickerSheetProps) {
  const palette = useColors();
  const queryClient = useQueryClient();

  // Режим: поиск существующего (search) vs создание нового (create).
  const [mode, setMode] = useState<'search' | 'create'>('search');
  const [phone, setPhone] = useState('');
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [creating, setCreating] = useState(false);

  // Чистое состояние на каждое открытие.
  useEffect(() => {
    if (!visible) return;
    setMode('search');
    setPhone('');
    setNewName('');
    setNewPhone('');
    setCreating(false);
  }, [visible]);

  // Live-поиск по телефону. Ищем только когда набрано ≥3 цифр, чтобы не
  // тянуть весь список на первый символ; бэкенд match'ит по подстроке.
  const searchDigits = phone.replace(/\D/g, '');
  const enabled = visible && mode === 'search' && searchDigits.length >= 3;
  const { data, isFetching } = useQuery({
    queryKey: ['clients-reassign-search', searchDigits],
    queryFn: async () => {
      const res = await clientsApi.getAll({ search: searchDigits, limit: 20 });
      return Array.isArray(res.data?.data) ? res.data.data : [];
    },
    enabled,
    placeholderData: (prev) => prev,
  });

  const results = useMemo(() => {
    const list = data ?? [];
    return excludeClientId ? list.filter((c) => c.id !== excludeClientId) : list;
  }, [data, excludeClientId]);

  const pickExisting = (client: Client) => {
    haptic('select');
    onPicked(client.id, client.fullName);
  };

  const handleCreate = async () => {
    if (!newName.trim()) {
      Alert.alert('Ошибка', 'Укажите имя клиента');
      return;
    }
    if (!newPhone.trim()) {
      Alert.alert('Ошибка', 'Укажите телефон клиента');
      return;
    }
    setCreating(true);
    try {
      const res = await clientsApi.create({ fullName: newName.trim(), phone: newPhone });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['clients-infinite'] });
      haptic('success');
      onPicked(res.data.id, res.data.fullName);
    } catch (err: any) {
      const status = err?.response?.status;
      const d = err?.response?.data;
      // 409 — клиент с этим телефоном уже есть → сразу берём его как владельца.
      if (status === 409 && d?.code === 'CLIENT_PHONE_EXISTS' && d?.clientId) {
        const existingName =
          (d?.client && typeof d.client.fullName === 'string' && d.client.fullName) || newName.trim();
        haptic('success');
        onPicked(String(d.clientId), existingName);
        return;
      }
      // 161 — номер занят карточкой ДРУГОГО ФИЛИАЛА: сервер намеренно не даёт
      // ни имени, ни id (это чужая база), поэтому подставить владельца в чек
      // нельзя, а «Перейти к клиенту» привело бы в 404. Показываем текст
      // сервера — он объясняет, что делать.
      const otherPoint = otherPointPhoneConflictMessage(err);
      if (otherPoint) {
        Alert.alert('Номер занят другим филиалом', otherPoint);
        return;
      }
      const friendly =
        (d && typeof d.message === 'string' && d.message) ||
        (d && typeof d.error === 'string' && d.error) ||
        'Не удалось создать клиента';
      Alert.alert('Ошибка', String(friendly));
    } finally {
      setCreating(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={mode === 'create' ? 'Новый владелец' : 'Сменить владельца'}
      heightRatio={0.82}
    >
      {mode === 'search' ? (
        <>
          <Text style={[styles.label, { color: palette.text.secondary }]}>Телефон нового владельца</Text>
          <TextInput
            value={phone}
            onChangeText={(t) => setPhone(formatPhone(t.replace(/\D/g, '')))}
            style={[
              styles.input,
              { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
            ]}
            placeholder="+7 (___) ___-__-__"
            keyboardType="phone-pad"
            autoComplete="tel"
            placeholderTextColor={palette.text.tertiary}
            autoFocus
          />

          {/* Результаты поиска — тап выбирает существующего клиента. */}
          <View style={styles.results}>
            {enabled && isFetching && results.length === 0 ? (
              <View style={styles.stateRow}>
                <ActivityIndicator size="small" color={palette.accent.primary} />
                <Text style={[styles.stateText, { color: palette.text.tertiary }]}>Поиск…</Text>
              </View>
            ) : !enabled ? (
              <Text style={[styles.stateText, { color: palette.text.tertiary }]}>
                Введите телефон, чтобы найти клиента
              </Text>
            ) : results.length === 0 ? (
              <Text style={[styles.stateText, { color: palette.text.tertiary }]}>Клиент не найден</Text>
            ) : (
              results.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.resultRow, { borderBottomColor: palette.border.subtle }]}
                  onPress={() => pickExisting(c)}
                  activeOpacity={0.6}
                >
                  <View style={[styles.avatar, { backgroundColor: palette.accent.primarySoft }]}>
                    <Ionicons name="person-outline" size={18} color={palette.accent.primary} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.resultName, { color: palette.text.primary }]} numberOfLines={1}>
                      {c.fullName}
                    </Text>
                    {!!c.phone && (
                      <Text style={[styles.resultPhone, { color: palette.text.tertiary }]}>{formatPhone(c.phone)}</Text>
                    )}
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
                </TouchableOpacity>
              ))
            )}
          </View>

          {/* «Создать нового клиента» — только имя + телефон. */}
          <TouchableOpacity
            style={[styles.createLink, { borderColor: palette.border.strong }]}
            onPress={() => {
              haptic('tap');
              // Предзаполняем телефон тем, что уже набрано в поиске.
              setNewPhone(phone);
              setMode('create');
            }}
          >
            <Ionicons name="person-add-outline" size={16} color={palette.accent.primary} />
            <Text style={[styles.createLinkText, { color: palette.accent.primary }]}>Создать нового клиента</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={[styles.label, { color: palette.text.secondary }]}>ФИО *</Text>
          <TextInput
            value={newName}
            onChangeText={setNewName}
            style={[
              styles.input,
              { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
            ]}
            placeholder="Введите ФИО клиента"
            placeholderTextColor={palette.text.tertiary}
            autoFocus
          />

          <Text style={[styles.label, { color: palette.text.secondary, marginTop: spacing[3] }]}>Телефон *</Text>
          <TextInput
            value={newPhone}
            onChangeText={(t) => setNewPhone(formatPhone(t.replace(/\D/g, '')))}
            style={[
              styles.input,
              { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
            ]}
            placeholder="+7 (___) ___-__-__"
            keyboardType="phone-pad"
            autoComplete="tel"
            placeholderTextColor={palette.text.tertiary}
          />

          <View style={[styles.actions, { borderTopColor: palette.border.subtle }]}>
            <TouchableOpacity
              style={[styles.cancelBtn, { borderColor: palette.border.strong }]}
              onPress={() => setMode('search')}
            >
              <Text style={[styles.cancelBtnText, { color: palette.text.secondary }]}>Назад</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.submitBtn, { backgroundColor: palette.accent.primary }]}
              onPress={handleCreate}
              disabled={creating}
            >
              {creating ? (
                <ActivityIndicator color={colors.white} size="small" />
              ) : (
                <View style={styles.submitInner}>
                  <Ionicons name="person-add-outline" size={16} color={colors.white} />
                  <Text style={styles.submitBtnText}>Создать</Text>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.medium,
    marginBottom: spacing[1.5],
  },
  input: {
    borderWidth: 1,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[2.5],
    fontSize: fontSize.sm,
  },
  results: {
    marginTop: spacing[3],
    minHeight: 60,
  },
  stateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3],
  },
  stateText: {
    fontSize: fontSize.sm,
    paddingVertical: spacing[3],
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[2.5],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resultName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  resultPhone: { fontSize: fontSize.xs, marginTop: 1 },
  createLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    marginTop: spacing[4],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },
  createLinkText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  actions: {
    flexDirection: 'row',
    gap: spacing[2],
    paddingTop: spacing[4],
    marginTop: spacing[4],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  cancelBtn: {
    flex: 1,
    paddingVertical: spacing[3],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  submitBtn: {
    flex: 1,
    paddingVertical: spacing[3],
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitInner: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5] },
  submitBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.white },
});
