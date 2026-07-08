/**
 * LoyaltyScreen — «Лояльность» (бонусы / кешбэк).
 *
 * Surfaces the loyalty config that already exists server-side (loyalty/,
 * migration 083) but had no home in the app: master switch, % начисления
 * с чека и максимальный % оплаты бонусами. Reached from the Маркетинг hub.
 *
 * Reads are open to any tenant user; the PATCH is owner-class server-side, so
 * the screen self-gates the editor to director / admin / superadmin (the hub
 * row is roles-filtered too).
 */
import React, { useRef, useState } from 'react';
import { View, ScrollView, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useColors } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { loyaltyApi } from '../api/services';
import { colors, fontSize, fontWeight, borderRadius, spacing, softTint } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import IosScreenHeader from '../components/IosScreenHeader';
import { Text } from '../platform/Typography';
import { haptic } from '../platform/haptics';
import { UserRole } from '../../../shared/types';

function clampPercent(raw: string): number {
  const n = parseInt(raw.replace(/[^0-9]/g, ''), 10);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

export default function LoyaltyScreen() {
  const navigation = useNavigation<any>();
  const palette = useColors();
  const tabBarHeight = useTabBarHeight();
  const queryClient = useQueryClient();
  const { isRole } = useAuth();
  const canEdit = isRole(UserRole.DIRECTOR, UserRole.ADMIN, UserRole.SUPERADMIN);

  const [enabled, setEnabled] = useState(false);
  const [accrual, setAccrual] = useState('0');
  const [redeemMax, setRedeemMax] = useState('0');
  const hydrated = useRef(false);

  const settingsQuery = useQuery({
    queryKey: ['loyalty-settings'],
    queryFn: async () => (await loyaltyApi.getSettings()).data,
    staleTime: 60_000,
  });

  React.useEffect(() => {
    if (settingsQuery.data && !hydrated.current) {
      hydrated.current = true;
      setEnabled(!!settingsQuery.data.enabled);
      setAccrual(String(settingsQuery.data.accrualPercent ?? 0));
      setRedeemMax(String(settingsQuery.data.redeemMaxPercent ?? 0));
    }
  }, [settingsQuery.data]);

  const save = useMutation({
    mutationFn: () =>
      loyaltyApi.updateSettings({
        enabled,
        accrualPercent: clampPercent(accrual),
        redeemMaxPercent: clampPercent(redeemMax),
      }),
    onSuccess: () => {
      haptic('success');
      queryClient.invalidateQueries({ queryKey: ['loyalty-settings'] });
      Alert.alert('Готово', 'Настройки лояльности сохранены');
    },
    onError: (e: any) => {
      haptic('error');
      Alert.alert('Ошибка', e?.response?.data?.message || 'Не удалось сохранить');
    },
  });

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title="Лояльность" onBack={() => navigation.goBack()} />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + spacing[4] }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.intro, { color: palette.text.secondary }]}>
          Бонусы за визиты: клиент копит кешбэк с чека и оплачивает им часть следующего заказа.
        </Text>

        {/* Master switch */}
        <View style={[styles.card, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
          <View style={styles.switchRow}>
            <View
              style={[
                styles.iconTile,
                {
                  backgroundColor: enabled
                    ? palette.mode === 'dark'
                      ? softTint(colors.emerald[700], 'dark')
                      : colors.emerald[50]
                    : palette.bg.muted,
                },
              ]}
            >
              <Ionicons name="ribbon-outline" size={20} color={enabled ? colors.emerald[700] : palette.text.tertiary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.cardTitle, { color: palette.text.primary }]}>Программа лояльности</Text>
              <Text style={[styles.cardSub, { color: palette.text.tertiary }]}>
                {enabled ? 'Включена — бонусы начисляются с продаж' : 'Выключена — новые бонусы не начисляются'}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => {
                if (!canEdit) return;
                haptic('select');
                setEnabled((v) => !v);
              }}
              disabled={!canEdit}
              hitSlop={8}
              accessibilityRole="switch"
              accessibilityState={{ checked: enabled }}
            >
              <View
                style={[
                  styles.switchTrack,
                  { backgroundColor: enabled ? palette.accent.primary : palette.border.strong },
                ]}
              >
                <View style={[styles.switchThumb, { transform: [{ translateX: enabled ? 20 : 2 }] }]} />
              </View>
            </TouchableOpacity>
          </View>
        </View>

        {/* Percent fields */}
        <View
          style={[
            styles.card,
            { backgroundColor: palette.bg.card, borderColor: palette.border.subtle, marginTop: spacing[3] },
          ]}
        >
          <PercentField
            label="Начисление с чека"
            hint="Сколько % от суммы чека вернётся бонусами"
            value={accrual}
            onChange={setAccrual}
            editable={canEdit}
          />
          <View style={[styles.divider, { backgroundColor: palette.border.subtle }]} />
          <PercentField
            label="Оплата бонусами"
            hint="Каким максимум % чека можно оплатить бонусами"
            value={redeemMax}
            onChange={setRedeemMax}
            editable={canEdit}
          />
        </View>

        {canEdit ? (
          <TouchableOpacity
            style={[styles.saveBtn, { backgroundColor: palette.accent.primary }, save.isPending && { opacity: 0.6 }]}
            onPress={() => save.mutate()}
            disabled={save.isPending || settingsQuery.isLoading}
          >
            {save.isPending ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <>
                <Ionicons name="checkmark" size={16} color={colors.white} />
                <Text style={styles.saveBtnText}>Сохранить</Text>
              </>
            )}
          </TouchableOpacity>
        ) : (
          <View
            style={[styles.readOnlyNote, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
          >
            <Ionicons name="lock-closed-outline" size={15} color={palette.text.tertiary} />
            <Text style={[styles.readOnlyText, { color: palette.text.tertiary }]}>
              Настройку лояльности меняет владелец или администратор.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function PercentField({
  label,
  hint,
  value,
  onChange,
  editable,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (t: string) => void;
  editable: boolean;
}) {
  const palette = useColors();
  return (
    <View style={styles.percentRow}>
      <View style={{ flex: 1, paddingRight: spacing[3] }}>
        <Text style={[styles.percentLabel, { color: palette.text.primary }]}>{label}</Text>
        <Text style={[styles.percentHint, { color: palette.text.tertiary }]}>{hint}</Text>
      </View>
      <View
        style={[styles.percentInputWrap, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
      >
        <TextInput
          value={value}
          onChangeText={(t) => onChange(t.replace(/[^0-9]/g, '').slice(0, 3))}
          editable={editable}
          keyboardType="number-pad"
          style={[styles.percentInput, { color: palette.text.primary }]}
          maxLength={3}
        />
        <Text style={[styles.percentSign, { color: palette.text.tertiary }]}>%</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing[4] },
  intro: { fontSize: fontSize.sm, lineHeight: 20, marginBottom: spacing[4] },

  card: { borderRadius: borderRadius['2xl'], borderWidth: 1, padding: spacing[4] },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  iconTile: { width: 44, height: 44, borderRadius: borderRadius.xl, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, letterSpacing: -0.2 },
  cardSub: { fontSize: 12, marginTop: 2, lineHeight: 16 },

  switchTrack: { width: 44, height: 26, borderRadius: 13, justifyContent: 'center' },
  switchThumb: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },

  percentRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing[1] },
  percentLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  percentHint: { fontSize: 11, marginTop: 2, lineHeight: 15 },
  percentInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    paddingHorizontal: spacing[3],
    minWidth: 74,
  },
  percentInput: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    paddingVertical: spacing[2.5],
    minWidth: 34,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  percentSign: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, marginLeft: 2 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: spacing[2] },

  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[4],
    marginTop: spacing[4],
  },
  saveBtnText: { color: colors.white, fontSize: fontSize.base, fontWeight: fontWeight.bold },

  readOnlyNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    padding: spacing[3.5],
    marginTop: spacing[4],
  },
  readOnlyText: { flex: 1, fontSize: fontSize.xs, lineHeight: 16 },
});
