/**
 * BookingSettingsScreen — «Настройки записей» (owner-facing).
 *
 * Тумблеры (docs/ONLINE_BOOKING_DESIGN.md §8–9):
 *   • notifyClientOnCreate — слать ли клиенту «вы записаны» при создании;
 *   • reminderEnabled + reminderHours — напоминание за N часов до записи.
 * Канал уведомления = провайдер из Маркетинга (отдельного выбора нет —
 * объясняем это подсказкой). Нет провайдера → запись создаётся молча.
 *
 * Wire: bookingsApi.getSettings / updateSettings. Сохранение — оптимистичное
 * (перезаписываем кэш сразу), на ошибку откатываем.
 *
 * Android-safe: только Switch + TouchableOpacity, никаких iOS-only API.
 */
import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Switch,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import IosScreenHeader from '../components/IosScreenHeader';
import QueryErrorState from '../components/QueryErrorState';
import { ListSkeleton } from '../components/Skeleton';
import { useColors } from '../contexts/ThemeContext';
import { bookingsApi } from '../api/services';
import { haptic } from '../platform/haptics';
import { iosSectionLabel } from '../platform/iosSurface';
import { colors, borderRadius, spacing, softTint } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import type { BookingSettings } from '../../../shared/types';
import type { UpdateBookingSettingsRequest } from '../../../shared/api/types';

const REMINDER_HOUR_OPTIONS = [1, 2, 3, 6, 12, 24];

export default function BookingSettingsScreen() {
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();

  const {
    data: settings,
    isError,
    refetch,
  } = useQuery<BookingSettings>({
    queryKey: ['booking-settings'],
    queryFn: async () => (await bookingsApi.getSettings()).data,
  });

  // Локальная копия для мгновенного UI; синхронизируется с сервером раз при
  // загрузке. Сохранение — частичный PATCH (только изменённое поле).
  const [local, setLocal] = useState<BookingSettings | null>(null);
  useEffect(() => {
    if (settings && !local) setLocal(settings);
  }, [settings, local]);

  const updateMutation = useMutation({
    mutationFn: (patch: UpdateBookingSettingsRequest) => bookingsApi.updateSettings(patch),
    onSuccess: (res) => {
      // Сервер вернул финальное состояние — синхронизируем кэш + локалку.
      queryClient.setQueryData(['booking-settings'], res.data);
      setLocal(res.data);
    },
    onError: () => {
      haptic('error');
      // Откат к серверному снимку.
      if (settings) setLocal(settings);
    },
  });

  const apply = (patch: UpdateBookingSettingsRequest) => {
    setLocal((prev) => (prev ? { ...prev, ...patch } : prev));
    updateMutation.mutate(patch);
  };

  // ── States ─────────────────────────────────────────────────────────────
  if (!local) {
    if (isError) {
      return (
        <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
          <IosScreenHeader title="Настройки записей" onBack={() => navigation.goBack()} />
          <QueryErrorState
            title="Не удалось загрузить настройки"
            description="Проверьте подключение к интернету и попробуйте ещё раз"
            onRetry={() => refetch()}
          />
        </View>
      );
    }
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Настройки записей" onBack={() => navigation.goBack()} />
        <ListSkeleton count={3} />
      </View>
    );
  }

  const trackOn = colors.green[500];

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Настройки записей" onBack={() => navigation.goBack()} />

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: tabBarHeight + spacing[8] }]}
        contentInset={{ bottom: tabBarHeight }}
        scrollIndicatorInsets={{ bottom: tabBarHeight }}
      >
        {/* ── Уведомление клиенту ── */}
        <Text style={[iosSectionLabel, styles.sectionLabel, { color: palette.text.secondary }]}>
          УВЕДОМЛЕНИЕ КЛИЕНТУ
        </Text>
        <View style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
          <View style={styles.row}>
            <View
              style={[
                styles.rowIcon,
                { backgroundColor: palette.mode === 'dark' ? softTint(colors.blue[600], 'dark') : colors.blue[50] },
              ]}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={20} color={colors.blue[600]} />
            </View>
            <View style={styles.rowText}>
              <Text style={[styles.rowLabel, { color: palette.text.primary }]}>Сообщать о записи</Text>
              <Text style={[styles.rowDesc, { color: palette.text.tertiary }]}>
                При создании клиенту уйдёт «Вы записаны на …»
              </Text>
            </View>
            <Switch
              value={local.notifyClientOnCreate}
              onValueChange={(next) => {
                haptic('tap');
                apply({ notifyClientOnCreate: next });
              }}
              trackColor={{ false: palette.border.subtle, true: trackOn }}
              thumbColor={Platform.OS === 'android' ? colors.white : undefined}
              ios_backgroundColor={palette.border.subtle}
            />
          </View>
        </View>

        {/* ── Напоминание ── */}
        <Text style={[iosSectionLabel, styles.sectionLabel, { color: palette.text.secondary }]}>НАПОМИНАНИЕ</Text>
        <View style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
          <View style={styles.row}>
            <View
              style={[
                styles.rowIcon,
                { backgroundColor: palette.mode === 'dark' ? softTint(colors.amber[600], 'dark') : colors.amber[50] },
              ]}
            >
              <Ionicons name="alarm-outline" size={20} color={colors.amber[600]} />
            </View>
            <View style={styles.rowText}>
              <Text style={[styles.rowLabel, { color: palette.text.primary }]}>Напоминать клиенту</Text>
              <Text style={[styles.rowDesc, { color: palette.text.tertiary }]}>Перед записью отправим напоминание</Text>
            </View>
            <Switch
              value={local.reminderEnabled}
              onValueChange={(next) => {
                haptic('tap');
                apply({ reminderEnabled: next });
              }}
              trackColor={{ false: palette.border.subtle, true: trackOn }}
              thumbColor={Platform.OS === 'android' ? colors.white : undefined}
              ios_backgroundColor={palette.border.subtle}
            />
          </View>

          {/* «За сколько часов» — доступно только при включённом напоминании. */}
          {local.reminderEnabled ? (
            <View style={[styles.hoursBlock, { borderTopColor: palette.border.subtle }]}>
              <Text style={[styles.hoursLabel, { color: palette.text.secondary }]}>За сколько часов</Text>
              <View style={styles.hoursChips}>
                {REMINDER_HOUR_OPTIONS.map((h) => {
                  const active = local.reminderHours === h;
                  return (
                    <TouchableOpacity
                      key={h}
                      style={[
                        styles.hoursChip,
                        {
                          backgroundColor: active ? colors.primary[600] : palette.bg.muted,
                          borderColor: active ? colors.primary[600] : palette.border.subtle,
                        },
                      ]}
                      onPress={() => {
                        if (active) return;
                        haptic('select');
                        apply({ reminderHours: h });
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.hoursChipText, { color: active ? colors.white : palette.text.primary }]}>
                        {h} ч
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ) : null}
        </View>

        {/* ── Канал (read-only, объяснение) ── */}
        <View style={[styles.infoCard, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
          <Ionicons name="information-circle-outline" size={18} color={palette.text.tertiary} />
          <Text style={[styles.infoText, { color: palette.text.secondary }]}>
            Канал отправки (SMS или WhatsApp) берётся из настроек Маркетинга. Если провайдер не настроен — запись
            создаётся без уведомления.
          </Text>
        </View>

        {/* Тонкий индикатор сохранения. */}
        {updateMutation.isPending ? (
          <View style={styles.savingRow}>
            <ActivityIndicator size="small" color={palette.text.tertiary} />
            <Text style={[styles.savingText, { color: palette.text.tertiary }]}>Сохраняю…</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { paddingHorizontal: spacing[4], paddingTop: spacing[1] },

  sectionLabel: { marginLeft: spacing[1], marginTop: spacing[4], marginBottom: spacing[2] },

  card: {
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], padding: spacing[3.5] },
  rowIcon: { width: 38, height: 38, borderRadius: borderRadius.lg, alignItems: 'center', justifyContent: 'center' },
  rowText: { flex: 1, minWidth: 0 },
  rowLabel: { fontSize: 15, fontWeight: '600', letterSpacing: -0.1 },
  rowDesc: { fontSize: 12, marginTop: 2, lineHeight: 16 },

  hoursBlock: { borderTopWidth: StyleSheet.hairlineWidth, padding: spacing[3.5], gap: spacing[2.5] },
  hoursLabel: { fontSize: 12, fontWeight: '600', letterSpacing: 0.2 },
  hoursChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] },
  hoursChip: {
    minWidth: 52,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
  },
  hoursChipText: { fontSize: 14, fontWeight: '700' },

  infoCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2.5],
    marginTop: spacing[4],
    padding: spacing[3.5],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  infoText: { flex: 1, fontSize: 13, lineHeight: 18 },

  savingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[4],
    justifyContent: 'center',
  },
  savingText: { fontSize: 12 },
});
