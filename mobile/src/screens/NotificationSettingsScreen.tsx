/**
 * NotificationSettingsScreen — per-user «Уведомления» preferences.
 *
 * Opt-out model (matches the frozen backend contract):
 *   • The server stores a `muted` array — the categories the user turned OFF.
 *   • An empty `muted` ⇒ everything is ON (default).
 *   • A category row's Switch is ON when the category is NOT in `muted`.
 *
 * Toggling a row optimistically rewrites the React-Query cache, fires
 * `notificationsApi.updatePreferences(newMuted)`, and rolls back the cache
 * on error. No save button — each toggle is its own atomic write, the
 * familiar iOS Settings behaviour.
 *
 * Broadcasts (важные объявления от поддержки) are intentionally NOT a row
 * here — they are non-mutable by design, so the footer note says so.
 */
import React from 'react';
import { View, ScrollView, StyleSheet, Switch, ActivityIndicator, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import IosScreenHeader from '../components/IosScreenHeader';
import { showMutationErrorToast } from '../components/Toast';
import { Text } from '../platform/Typography';
import { useColors } from '../contexts/ThemeContext';
import { colors, fontSize, fontWeight, borderRadius, spacing, softTint } from '../theme';
import { iosSectionLabel, useShadow } from '../platform/iosSurface';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { haptic } from '../platform/haptics';
import { notificationsApi } from '../api/services';
import type { NotificationCategory, NotificationPreferences } from '../../../shared/types';

const QK = ['notification-preferences'] as const;

interface CategoryRow {
  key: NotificationCategory;
  label: string;
  sublabel: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconBg: string;
  iconColor: string;
}

// Order + Russian copy come straight from the owner spec.
const CATEGORY_ROWS: CategoryRow[] = [
  {
    key: 'salary',
    label: 'Начисления зарплаты',
    sublabel: 'Зарплата, аванс, премия',
    icon: 'wallet-outline',
    iconBg: colors.green[50],
    iconColor: colors.green[600],
  },
  {
    key: 'penalty',
    label: 'Штрафы',
    sublabel: 'Когда вам начислен штраф',
    icon: 'alert-circle-outline',
    iconBg: colors.rose[50],
    iconColor: colors.rose[600],
  },
  {
    key: 'check_assigned',
    label: 'Новые заказ-наряды',
    sublabel: 'Когда на вас назначен заказ-наряд',
    icon: 'document-text-outline',
    iconBg: colors.blue[50],
    iconColor: colors.blue[600],
  },
  {
    key: 'check_closed',
    label: 'Закрытые чеки',
    sublabel: 'Когда чек закрыт и оплачен',
    icon: 'checkmark-done-outline',
    iconBg: colors.teal[50],
    iconColor: colors.teal[600],
  },
  {
    key: 'knowledge',
    label: 'Обязательные регламенты',
    sublabel: 'Новые регламенты для ознакомления',
    icon: 'book-outline',
    iconBg: colors.indigo[50],
    iconColor: colors.indigo[600],
  },
];

interface PrefRowProps {
  row: CategoryRow;
  enabled: boolean;
  saving: boolean;
  onToggle: (key: NotificationCategory, nextEnabled: boolean) => void;
  showDivider: boolean;
  labelColor: string;
  descColor: string;
  separatorColor: string;
  trackOn: string;
  /** Theme-resolved icon-tile fill — light keeps the catalogue's pale
   *  `[50]` tint, dark gets a muted translucent tint of the same accent. */
  iconBg: string;
}

const PrefRow = React.memo(function PrefRow({
  row,
  enabled,
  saving,
  onToggle,
  showDivider,
  labelColor,
  descColor,
  separatorColor,
  trackOn,
  iconBg,
}: PrefRowProps) {
  return (
    <>
      <View style={styles.row}>
        <View style={[styles.rowIcon, { backgroundColor: iconBg }]}>
          <Ionicons name={row.icon} size={20} color={row.iconColor} />
        </View>
        <View style={styles.rowTextWrap}>
          <Text style={[styles.rowLabel, { color: labelColor }]} numberOfLines={1}>
            {row.label}
          </Text>
          <Text style={[styles.rowDesc, { color: descColor }]} numberOfLines={2}>
            {row.sublabel}
          </Text>
        </View>
        <Switch
          value={enabled}
          disabled={saving}
          onValueChange={(next) => onToggle(row.key, next)}
          trackColor={{ false: separatorColor, true: trackOn }}
          // iOS uses the system green track; Android tints the thumb.
          thumbColor={Platform.OS === 'android' ? colors.white : undefined}
          ios_backgroundColor={separatorColor}
        />
      </View>
      {showDivider && <View style={[styles.separator, { backgroundColor: separatorColor }]} />}
    </>
  );
});

export default function NotificationSettingsScreen() {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const shadow = useShadow();
  const queryClient = useQueryClient();
  const tabBarHeight = useTabBarHeight();

  const { data, isLoading, isError } = useQuery<NotificationPreferences>({
    queryKey: QK,
    queryFn: async () => (await notificationsApi.getPreferences()).data,
    staleTime: 5 * 60 * 1000,
  });

  const muted = data?.muted ?? [];

  const mutation = useMutation<
    NotificationPreferences,
    unknown,
    NotificationCategory[],
    { previous: NotificationPreferences | undefined }
  >({
    mutationFn: async (newMuted) => (await notificationsApi.updatePreferences(newMuted)).data,
    // Optimistic update: rewrite the cache immediately so the Switch reflects
    // the new state without waiting for the round-trip.
    onMutate: async (newMuted) => {
      await queryClient.cancelQueries({ queryKey: QK });
      const previous = queryClient.getQueryData<NotificationPreferences>(QK);
      queryClient.setQueryData<NotificationPreferences>(QK, { muted: newMuted });
      return { previous };
    },
    onError: (err, _newMuted, context) => {
      // Roll back to the pre-toggle snapshot + видимый фидбек (волна C):
      // тумблер молча прыгал обратно — пользователь думал, что сохранил.
      if (context?.previous) {
        queryClient.setQueryData(QK, context.previous);
      }
      haptic('error');
      showMutationErrorToast(err);
    },
    onSuccess: (server) => {
      // Trust the server's canonical `muted` set.
      queryClient.setQueryData<NotificationPreferences>(QK, server);
    },
  });

  const onToggle = React.useCallback(
    (key: NotificationCategory, nextEnabled: boolean) => {
      haptic('tap');
      // Switch ON  ⇒ remove from muted. Switch OFF ⇒ add to muted.
      const current = queryClient.getQueryData<NotificationPreferences>(QK)?.muted ?? [];
      const set = new Set(current);
      if (nextEnabled) set.delete(key);
      else set.add(key);
      mutation.mutate(Array.from(set));
    },
    [queryClient, mutation],
  );

  const isMuted = (key: NotificationCategory) => muted.includes(key);

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Уведомления" onBack={() => navigation.goBack()} />

      {isLoading ? (
        <ActivityIndicator style={{ marginTop: spacing[10] }} color={palette.accent.primary} />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + spacing[6] }]}
          contentInset={{ bottom: tabBarHeight }}
          scrollIndicatorInsets={{ bottom: tabBarHeight }}
          automaticallyAdjustContentInsets={false}
        >
          {isError && !data ? (
            <View style={[styles.errorCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
              <Ionicons name="cloud-offline-outline" size={20} color={palette.text.tertiary} />
              <Text style={[styles.errorText, { color: palette.text.secondary }]}>
                Не удалось загрузить настройки. Потяните вниз, чтобы повторить.
              </Text>
            </View>
          ) : null}

          <View style={styles.section}>
            <Text style={[iosSectionLabel, styles.sectionTitle, { color: palette.text.secondary }]}>КАТЕГОРИИ</Text>
            <View
              style={[styles.card, shadow, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
            >
              {CATEGORY_ROWS.map((row, idx) => (
                <PrefRow
                  key={row.key}
                  row={row}
                  enabled={!isMuted(row.key)}
                  saving={mutation.isPending}
                  onToggle={onToggle}
                  showDivider={idx < CATEGORY_ROWS.length - 1}
                  labelColor={palette.text.primary}
                  descColor={palette.text.secondary}
                  separatorColor={palette.border.subtle}
                  trackOn={palette.accent.primary}
                  iconBg={palette.mode === 'dark' ? softTint(row.iconColor, 'dark') : row.iconBg}
                />
              ))}
            </View>
          </View>

          <Text style={[styles.footer, { color: palette.text.tertiary }]}>
            Важные объявления от поддержки приходят всегда.
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scrollContent: { paddingHorizontal: spacing[4], paddingTop: spacing[2], gap: spacing[4] },

  section: { gap: spacing[1.5] },
  sectionTitle: { marginLeft: spacing[3], marginBottom: spacing[1.5] },

  card: {
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    shadowColor: colors.black,
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 1 },
    ...(Platform.OS === 'android' ? { elevation: 1 } : null),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3.5],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    minHeight: 60,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    marginLeft: spacing[4] + 40 + spacing[3.5], // align under text (skip icon + gap)
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTextWrap: { flex: 1, minWidth: 0 },
  rowLabel: { fontSize: 16, fontWeight: '600', letterSpacing: -0.2 },
  rowDesc: { fontSize: 12, marginTop: 1 },

  footer: {
    fontSize: fontSize.xs,
    lineHeight: 18,
    marginTop: spacing[1],
    marginLeft: spacing[3],
    marginRight: spacing[3],
  },

  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    borderRadius: borderRadius['2xl'],
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3.5],
  },
  errorText: { flex: 1, fontSize: fontSize.sm, fontWeight: fontWeight.medium, lineHeight: 18 },
});
