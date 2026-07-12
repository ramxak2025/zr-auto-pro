/**
 * EquipmentScreen — refined iOS look.
 *
 * Top of screen:
 *   • Two-segment iOS-style segmented control: «Сотрудники / Подсобка».
 *     Pill-shaped gray-200 track + white pill for the active segment with a
 *     soft shadow. ~28pt segment height. Mirrors UISegmentedControl.
 *   • Trash bin lives as a top-right trailing icon button inside
 *     IosScreenHeader (no longer a tab). Opens a centered dialog that
 *     shows the deleted-equipment list with one-tap restore. Visual style
 *     of rows matches the storage / employee-detail item rows.
 *
 * Employees tab: premium 2-column "game-card" grid (unchanged).
 *   • full-bleed employee photo or a primary-tinted gradient with initials;
 *   • a two-stop tinted gradient overlay (primary-900 → black);
 *   • cost is hero, name beneath, frosted glass counter pills bottom-left;
 *   • expired-items warning sits as a top-right amber pill;
 *   • press uses PressableScale (iOS spring scale + light haptic).
 *   Tap → navigation.push('EquipmentEmployee', { emp }) — slide-in stack.
 *
 * Storage tab: folder list at root, items inside a folder.
 *   • Root view shows a FAB (bottom-right, 56pt primary-600 circle, soft
 *     shadow) that opens a centered dialog "Новая папка" with one text
 *     field → equipmentApi.createCategory().
 *   • Inside a folder, the same-positioned FAB opens a centered dialog
 *     "Новый предмет на склад" → equipmentApi.createStorageItem().
 *
 * Issue modal (выдать имущество): centered iOS dialog with dark scrim,
 * NOT a pageSheet. White rounded card, ~88% width, max ~520pt tall,
 * vertically centered. Header inside the card (title 17pt 700 centered,
 * × top-right). Body scrolls if it overflows the card. Primary "Выдать"
 * button is full-width at the bottom of the card.
 *
 * canEdit permission gating: owner-class roles (superadmin / director / admin)
 * OR the `equipment_manage` permission see the issue button, the FABs and the
 * trash icon. Without it, only the reference view is available (no dead buttons).
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Modal as RNModal,
  Alert,
  Platform,
  RefreshControl,
  useWindowDimensions,
} from 'react-native';
import { KeyboardAvoidingView, KeyboardAwareScrollView, KeyboardProvider } from 'react-native-keyboard-controller';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';

import CachedImage from '../components/CachedImage';
import IosScreenHeader from '../components/IosScreenHeader';
import ModalBlurBackdrop from '../components/ModalBlurBackdrop';
import { equipmentApi, uploadsApi } from '../api/services';
import { UserRole } from '../../../shared/types';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import { colors, spacing, fontSize, fontWeight, borderRadius, softTint } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { PressableScale } from '../platform/PressableScale';
import { haptic } from '../platform/haptics';

type Tab = 'employees' | 'storage';
type CategoryType = 'tools' | 'uniform' | 'other';

// Card geometry — premium 2-column grid, computed at runtime so it fits any iPhone.
const SCREEN_PADDING = spacing[4]; // 16pt
const CARD_GUTTER = spacing[3]; // 12pt
const CARD_RADIUS = 22; // squircle-like, between borderRadius['2xl'] and ['3xl']
const CARD_ASPECT = 1.18; // 4:5-ish — premium portrait card

function formatMoney(v: number) {
  return (
    Math.round(v)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
  );
}

// #14.3 — An item whose service life has run out (its `expiresAt` is in the
// past) is NEVER auto-deleted. It just turns reddish in every list it appears
// in. Storage-room items don't carry `expiresAt` (they have no issue date),
// so this is defensive: it only fires for issued items that have one.
function isExpired(item: { expiresAt?: string | null }): boolean {
  if (!item?.expiresAt) return false;
  const t = new Date(item.expiresAt).getTime();
  return Number.isFinite(t) && t < Date.now();
}

function getInitials(fullName?: string | null): string {
  if (!fullName) return '?';
  return (
    fullName
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() || '')
      .join('') || '?'
  );
}

// ─── Centered iOS dialog primitive (used by Issue / Trash / FAB dialogs) ───
// A reusable container: dark scrim + centered white card with rounded corners,
// header strip (title centered + close ×), scrollable body, primary action
// pinned at the bottom. The card is capped at 88% width and ~520pt tall so it
// stays a "dialog" — not a full screen — on every iPhone.
interface CenteredDialogProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  /** Primary footer button text. If undefined no footer is rendered. */
  primaryText?: string;
  /** Disable primary while a mutation is running etc. */
  primaryDisabled?: boolean;
  /** Render a secondary "Отменить" button next to the primary. */
  showCancel?: boolean;
  onPrimaryPress?: () => void;
  /** Tone the primary CTA red instead of brand blue (used for danger flows). */
  danger?: boolean;
  children: React.ReactNode;
}

function CenteredDialog({
  visible,
  title,
  onClose,
  primaryText,
  primaryDisabled,
  showCancel,
  onPrimaryPress,
  danger,
  children,
}: CenteredDialogProps) {
  const palette = useColors();
  return (
    // Клавиатура (Round 11 D, переделано). RN <Modal> — отдельное нативное
    // окно, нужен вложенный KeyboardProvider. KeyboardAvoidingView 'padding'
    // (keyboard-controller, одинаково iOS+Android) поднимает центрированную
    // карточку целиком, чтобы её низ (кнопка «Выдать») вышел из-под клавиатуры;
    // тело — KeyboardAwareScrollView, который авто-скроллит активный TextInput
    // (стоимость, срок службы), удерживая его ВИДИМЫМ над клавиатурой
    // (WhatsApp/Telegram). Свернуть клавиатуру — тап по пустому месту
    // (keyboardShouldPersistTaps="handled") или потянуть вниз
    // (keyboardDismissMode="interactive"). Отдельная кнопка «Готово» не нужна.
    <RNModal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardProvider>
        {/* Frosted blur backdrop (replaces the old rgba(0,0,0,0.45) dark scrim).
            Tapping it closes the dialog; the inner card stops propagation so
            taps on the card never close it. */}
        <KeyboardAvoidingView behavior="padding" style={dialogStyles.kavRoot}>
          <ModalBlurBackdrop onPress={onClose} />
          <View style={dialogStyles.scrim} pointerEvents="box-none">
            <TouchableOpacity
              activeOpacity={1}
              style={[dialogStyles.card, { backgroundColor: palette.bg.elevated }]}
              onPress={() => {}}
            >
              <View style={dialogStyles.header}>
                <View style={dialogStyles.headerSpacer} />
                <Text style={[dialogStyles.headerTitle, { color: palette.text.primary }]} numberOfLines={1}>
                  {title}
                </Text>
                <TouchableOpacity
                  onPress={onClose}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel="Закрыть"
                  style={[dialogStyles.closeBtn, { backgroundColor: palette.bg.muted }]}
                >
                  <Ionicons name="close" size={20} color={palette.text.secondary} />
                </TouchableOpacity>
              </View>

              <KeyboardAwareScrollView
                style={dialogStyles.bodyScroll}
                contentContainerStyle={dialogStyles.bodyContent}
                bottomOffset={spacing[6]}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                showsVerticalScrollIndicator={false}
              >
                {children}
              </KeyboardAwareScrollView>

              {primaryText && (
                <View style={[dialogStyles.footer, { borderTopColor: palette.border.subtle }]}>
                  {showCancel && (
                    <TouchableOpacity
                      onPress={onClose}
                      style={[dialogStyles.btn, dialogStyles.btnSecondary, { backgroundColor: palette.bg.muted }]}
                      activeOpacity={0.85}
                    >
                      <Text style={[dialogStyles.btnSecondaryText, { color: palette.text.primary }]}>Отменить</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    onPress={onPrimaryPress}
                    disabled={primaryDisabled}
                    style={[
                      dialogStyles.btn,
                      dialogStyles.btnPrimary,
                      danger && dialogStyles.btnDanger,
                      primaryDisabled && dialogStyles.btnDisabled,
                    ]}
                    activeOpacity={0.85}
                  >
                    <Text style={dialogStyles.btnPrimaryText}>{primaryText}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </KeyboardProvider>
    </RNModal>
  );
}

// Dark-mode overrides for the «expired service-life» status look. The static
// styles below keep their light red[50]/red[100] wash byte-identical; in dark
// we swap to a muted red softTint so the row/pill reads as attention without a
// bright pastel patch. Applied conditionally at the call sites.
const darkEquipExpired = {
  backgroundColor: softTint(colors.red[600], 'dark'),
  borderColor: 'rgba(239, 68, 68, 0.22)',
};
const darkExpiredPill = { backgroundColor: softTint(colors.red[600], 'dark') };

const dialogStyles = StyleSheet.create({
  kavRoot: {
    flex: 1,
  },
  scrim: {
    // Layout container that centres the card. The dark dim is gone — the
    // frosted ModalBlurBackdrop behind it does the separation now (#14 blur).
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[4],
  },
  card: {
    width: '88%',
    maxWidth: 460,
    maxHeight: 520,
    backgroundColor: colors.white,
    // M3 Alert Dialog uses a 28pt extra-large container corner; iOS HIG
    // uses ~20pt. Branch so each platform reads as native.
    borderRadius: Platform.OS === 'android' ? 28 : 20,
    overflow: 'hidden',
    // Soft elevation so the card feels lifted off the scrim.
    shadowColor: colors.black,
    shadowOpacity: 0.25,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[3],
    paddingTop: spacing[3.5],
    paddingBottom: spacing[2],
  },
  headerSpacer: {
    width: 32,
    height: 32,
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
    fontWeight: '700',
    color: colors.gray[900],
    letterSpacing: -0.2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  bodyScroll: {
    // Keep the card a dialog — ScrollView fills only as much vertical room
    // as it needs, but never overruns the maxHeight set on .card.
    flexGrow: 0,
  },
  bodyContent: {
    paddingHorizontal: spacing[5],
    paddingTop: spacing[2],
    paddingBottom: spacing[3],
  },
  footer: {
    flexDirection: 'row',
    gap: spacing[2],
    paddingHorizontal: spacing[5],
    paddingTop: spacing[3],
    paddingBottom: spacing[4],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.gray[200],
  },
  btn: {
    flex: 1,
    height: Platform.OS === 'android' ? 40 : 48,
    // M3 buttons are pill-shaped (radius = height / 2 = 20pt at 40pt
    // tall). iOS gets a softer ~14pt squircle.
    borderRadius: Platform.OS === 'android' ? 20 : 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimary: {
    backgroundColor: colors.primary[600],
  },
  btnSecondary: {
    backgroundColor: colors.gray[100],
  },
  btnDanger: {
    backgroundColor: colors.red[600],
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnPrimaryText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  btnSecondaryText: {
    color: colors.gray[800],
    fontSize: 15,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
});

// ─── Photo viewer (fullscreen lightbox — NOT a pageSheet) ──────────────────
function PhotoViewer({ url, onClose }: { url: string; onClose: () => void }) {
  return (
    <RNModal visible transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={styles.photoViewer} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={styles.photoClose} onPress={onClose}>
          <Ionicons name="close" size={24} color={colors.white} />
        </TouchableOpacity>
        <CachedImage source={{ uri: url }} style={styles.photoImage} resizeMode="contain" />
      </TouchableOpacity>
    </RNModal>
  );
}

// ─── Per-card frosted pill (counters at bottom of game card) ───────────────
// PERF: NO per-card BlurView here. These pills live inside a scrolling card
// grid; a per-pill UIVisualEffectView meant many live blur surfaces while
// scrolling, on top of the always-on native Liquid Glass tab bar — jank +
// jetsam memory pressure on device. A solid translucent scrim reads as
// "frosted" against the dark card art at a fraction of the cost. Same cheap
// path on both platforms.
function FrostedPill({ icon, label }: { icon: string; label: string | number }) {
  return (
    <View style={[styles.pillWrap, styles.pillFrost]}>
      <Text style={styles.pillIcon}>{icon}</Text>
      <Text style={styles.pillLabel}>{label}</Text>
    </View>
  );
}

// ─── iOS segmented control (2 segments) ────────────────────────────────────
// Pill-shaped gray track + a white pill for the active segment with a soft
// shadow. Mirrors UISegmentedControl from iOS 13+. ~28pt segment height.
function SegmentedTabs({ value, onChange }: { value: Tab; onChange: (v: Tab) => void }) {
  const palette = useColors();
  const items: { k: Tab; l: string }[] = [
    { k: 'employees', l: 'Сотрудники' },
    { k: 'storage', l: 'Подсобка' },
  ];
  return (
    <View style={[styles.segmentTrack, { backgroundColor: palette.bg.muted }]}>
      {items.map((it) => {
        const active = value === it.k;
        return (
          <TouchableOpacity
            key={it.k}
            onPress={() => {
              haptic('select');
              onChange(it.k);
            }}
            activeOpacity={0.85}
            style={[styles.segmentBtn, active && [styles.segmentBtnActive, { backgroundColor: palette.bg.card }]]}
          >
            <Text
              style={[
                styles.segmentText,
                { color: palette.text.secondary },
                active && [styles.segmentTextActive, { color: palette.text.primary }],
              ]}
              numberOfLines={1}
            >
              {it.l}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ─── Premium employee card (2-col grid) ────────────────────────────────────
function EmployeeCard({ emp, cardWidth, onPress }: { emp: any; cardWidth: number; onPress: () => void }) {
  const initials = getInitials(emp.fullName);
  const otherCount = Math.max(0, (emp.activeCount || 0) - (emp.toolsCount || 0) - (emp.uniformCount || 0));

  return (
    <PressableScale
      onPress={onPress}
      scaleTo={0.965}
      hapticIntent="tap"
      style={[
        styles.gridCard,
        {
          width: cardWidth,
          height: cardWidth * CARD_ASPECT,
        },
      ]}
    >
      {emp.avatar ? (
        <CachedImage source={{ uri: emp.avatar }} style={StyleSheet.absoluteFillObject as any} resizeMode="cover" />
      ) : (
        <LinearGradient
          colors={[colors.primary[500], colors.primary[700]] as [string, string]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        >
          <View style={styles.initialsWrap}>
            <Text style={styles.initialsText}>{initials}</Text>
          </View>
        </LinearGradient>
      )}

      <LinearGradient
        colors={['rgba(29,78,216,0.30)', 'rgba(0,0,0,0.00)']}
        locations={[0, 0.45]}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />

      <LinearGradient
        colors={['rgba(0,0,0,0.00)', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0.86)']}
        locations={[0.4, 0.72, 1]}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />

      {emp.expiredCount > 0 && (
        <View style={styles.warnPill}>
          <Ionicons name="warning" size={11} color={colors.white} />
          <Text style={styles.warnPillText}>{emp.expiredCount}</Text>
        </View>
      )}

      <View style={styles.countersRow}>
        {emp.toolsCount > 0 && <FrostedPill icon="🔧" label={emp.toolsCount} />}
        {emp.uniformCount > 0 && <FrostedPill icon="👕" label={emp.uniformCount} />}
        {otherCount > 0 && <FrostedPill icon="📦" label={otherCount} />}
      </View>

      <View style={styles.heroBlock}>
        <Text style={styles.heroCost} numberOfLines={1}>
          {formatMoney(emp.totalCost || 0)}
        </Text>
        <Text style={styles.heroName} numberOfLines={1}>
          {emp.fullName || '—'}
        </Text>
        <Text style={styles.heroMeta} numberOfLines={1}>
          {emp.activeCount || 0} {emp.activeCount === 1 ? 'предмет' : 'предметов'}
        </Text>
      </View>
    </PressableScale>
  );
}

// ─── Employee detail (inside Equipment, with IssueModal access) ────────────
function EmployeeDetail({ emp, canEdit }: { emp: any; canEdit: boolean }) {
  const qc = useQueryClient();
  const tabBarHeight = useTabBarHeight();
  const palette = useColors();
  const [showIssue, setShowIssue] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  const { data: items = [] } = useQuery({
    queryKey: ['eq-user', emp.userId],
    queryFn: async () => (await equipmentApi.getByUser(emp.userId, true)).data,
  });

  const trashMut = useMutation({
    mutationFn: (id: string) => equipmentApi.trash(id, 'Списание'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['eq-user', emp.userId] });
      qc.invalidateQueries({ queryKey: ['eq-summary'] });
      qc.invalidateQueries({ queryKey: ['eq-trash'] });
    },
    // Кнопка остаётся активной — после ошибки можно сразу повторить.
    onError: (err: unknown) => {
      haptic('error');
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      Alert.alert('Ошибка', e?.response?.data?.message || e?.message || 'Не удалось списать инструмент');
    },
  });
  const returnMut = useMutation({
    mutationFn: (id: string) => equipmentApi.returnToStorage(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['eq-user', emp.userId] });
      qc.invalidateQueries({ queryKey: ['eq-summary'] });
    },
    onError: (err: unknown) => {
      haptic('error');
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      Alert.alert('Ошибка', e?.response?.data?.message || e?.message || 'Не удалось вернуть предмет в подсобку');
    },
  });

  const active = items.filter((i: any) => i.status === 'active');
  const tools = active.filter((i: any) => i.categoryType === 'tools');
  const uniforms = active.filter((i: any) => i.categoryType === 'uniform');
  const other = active.filter((i: any) => i.categoryType === 'other');
  const total = active.reduce((s: number, i: any) => s + i.cost, 0);

  const renderSection = (title: string, iconName: any, color: string, list: any[]) => {
    if (list.length === 0) return null;
    return (
      <View style={{ marginBottom: spacing[4] }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: spacing[2],
            marginBottom: spacing[2],
          }}
        >
          <Ionicons name={iconName} size={14} color={color} />
          <Text style={{ fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: palette.text.primary }}>
            {title}
          </Text>
          <Text style={{ fontSize: fontSize.xs, color: palette.text.tertiary }}>{list.length}</Text>
        </View>
        {list.map((item: any) => {
          const expired = isExpired(item);
          return (
            <View
              key={item.id}
              style={[
                styles.equipItem,
                { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
                expired && (palette.mode === 'dark' ? darkEquipExpired : styles.equipItemExpired),
              ]}
            >
              {item.photo ? (
                <TouchableOpacity onPress={() => setPhotoUrl(item.photo)}>
                  <CachedImage source={{ uri: item.photo }} style={styles.equipPhoto} />
                </TouchableOpacity>
              ) : (
                <View
                  style={[
                    styles.equipPhoto,
                    { backgroundColor: palette.bg.muted, alignItems: 'center', justifyContent: 'center' },
                  ]}
                >
                  <Ionicons name="cube-outline" size={18} color={palette.text.tertiary} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={[styles.equipName, { color: palette.text.primary }]} numberOfLines={1}>
                  {item.name}
                </Text>
                <Text style={styles.equipCost}>{formatMoney(item.cost)}</Text>
                {item.serviceLifeMonths && (
                  <Text style={[styles.equipMeta, { color: palette.text.tertiary }]}>
                    Срок: {item.serviceLifeMonths} мес.
                  </Text>
                )}
                {expired && (
                  <View style={[styles.expiredPill, palette.mode === 'dark' && darkExpiredPill]}>
                    <Ionicons
                      name="alert-circle"
                      size={11}
                      color={palette.mode === 'dark' ? colors.red[300] : colors.red[600]}
                    />
                    <Text style={[styles.expiredPillText, palette.mode === 'dark' && { color: colors.red[300] }]}>
                      Срок истёк
                    </Text>
                  </View>
                )}
              </View>
              {canEdit && (
                <View style={{ flexDirection: 'row', gap: spacing[1] }}>
                  <TouchableOpacity
                    onPress={() => {
                      haptic('tap');
                      returnMut.mutate(item.id);
                    }}
                    style={[styles.equipBtn, { backgroundColor: palette.bg.muted }]}
                    accessibilityRole="button"
                    accessibilityLabel="Вернуть в подсобку"
                  >
                    <Ionicons name="arrow-undo" size={14} color={colors.blue[500]} />
                  </TouchableOpacity>
                  {/* Списание — деструктив с маленькой иконки-мишени, поэтому
                    обязательный confirm (паттерн CheckDetailScreen). */}
                  <TouchableOpacity
                    onPress={() => {
                      haptic('tap');
                      Alert.alert('Списать инструмент?', `«${item.name}» будет перемещён в корзину (хранится 7 дней)`, [
                        { text: 'Отмена', style: 'cancel' },
                        { text: 'Списать', style: 'destructive', onPress: () => trashMut.mutate(item.id) },
                      ]);
                    }}
                    style={[styles.equipBtn, { backgroundColor: palette.bg.muted }]}
                    accessibilityRole="button"
                    accessibilityLabel="Списать в корзину"
                  >
                    <Ionicons name="trash-outline" size={14} color={colors.red[400]} />
                  </TouchableOpacity>
                </View>
              )}
            </View>
          );
        })}
      </View>
    );
  };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.bg.canvas }}
      contentContainerStyle={{
        padding: spacing[4],
        paddingBottom: tabBarHeight + spacing[4],
      }}
    >
      <View style={[styles.empHeader, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
        {emp.avatar ? (
          <CachedImage source={{ uri: emp.avatar }} style={styles.empAvatar} />
        ) : (
          <View
            style={[
              styles.empAvatar,
              {
                backgroundColor: palette.mode === 'dark' ? palette.accent.primarySoft : colors.primary[100],
                alignItems: 'center',
                justifyContent: 'center',
              },
            ]}
          >
            <Text
              style={{
                fontSize: fontSize.xl,
                fontWeight: fontWeight.bold,
                color: palette.mode === 'dark' ? palette.accent.primaryText : colors.primary[700],
              }}
            >
              {getInitials(emp.fullName)}
            </Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={[styles.empName, { color: palette.text.primary }]}>{emp.fullName}</Text>
          <Text style={[styles.empStats, { color: palette.text.secondary }]}>
            {active.length} предметов · {formatMoney(total)}
          </Text>
        </View>
        {canEdit && (
          <TouchableOpacity
            onPress={() => {
              haptic('tap');
              setShowIssue(true);
            }}
            style={styles.addBtn}
          >
            <Ionicons name="add" size={20} color={colors.white} />
          </TouchableOpacity>
        )}
      </View>

      {active.length === 0 ? (
        <View style={{ alignItems: 'center', paddingVertical: spacing[12] }}>
          <Ionicons name="cube-outline" size={40} color={palette.text.tertiary} />
          <Text style={{ fontSize: fontSize.sm, color: palette.text.tertiary, marginTop: spacing[2] }}>
            Нет выданного имущества
          </Text>
        </View>
      ) : (
        <>
          {renderSection('Инструменты', 'construct', colors.blue[600], tools)}
          {renderSection('Форма', 'shirt-outline', colors.purple[600], uniforms)}
          {renderSection('Прочее', 'cube-outline', colors.gray[600], other)}
        </>
      )}

      {photoUrl && <PhotoViewer url={photoUrl} onClose={() => setPhotoUrl(null)} />}
      <IssueModal visible={showIssue} userId={emp.userId} onClose={() => setShowIssue(false)} qc={qc} />
    </ScrollView>
  );
}

// ─── Issue modal — CENTERED iOS dialog (white card, dark scrim) ────────────
function IssueModal({
  visible,
  userId,
  onClose,
  qc,
}: {
  visible: boolean;
  userId: string;
  onClose: () => void;
  qc: any;
}) {
  const palette = useColors();
  const [name, setName] = useState('');
  const [cost, setCost] = useState('');
  const [categoryType, setCategoryType] = useState<CategoryType>('tools');
  const [serviceLife, setServiceLife] = useState('');
  const [photo, setPhoto] = useState('');

  const { data: storageItems = [] } = useQuery({
    queryKey: ['eq-storage-list'],
    queryFn: async () => (await equipmentApi.getStorageItems()).data,
    enabled: visible,
  });

  const issueMut = useMutation({
    mutationFn: (data: any) => equipmentApi.issue(data),
    onSuccess: () => {
      haptic('success');
      qc.invalidateQueries({ queryKey: ['eq-user', userId] });
      qc.invalidateQueries({ queryKey: ['eq-summary'] });
      // Reset for next open.
      setName('');
      setCost('');
      setServiceLife('');
      setPhoto('');
      setCategoryType('tools');
      onClose();
    },
    // Без локального onError срабатывает глобальный fallback из App.tsx —
    // haptic('error') + Alert с текстом ошибки сервера. Локальный хендлер
    // только с хаптикой ПЕРЕКРЫВАЛ бы его и глотал сообщение.
  });

  const pickFromStorage = (item: any) => {
    setName(item.name);
    setCost(String(item.purchasePrice));
    if (item.photo) setPhoto(item.photo);
    if (item.serviceLifeMonths) setServiceLife(String(item.serviceLifeMonths));
    haptic('select');
  };

  const pickPhoto = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
      });
      if (!result.canceled && result.assets[0]) {
        const uploaded = await uploadsApi.upload(result.assets[0].uri, 'equipment.jpg');
        setPhoto(uploaded.data.url);
      }
    } catch {
      // Upload can fail on flaky connections; surface the error instead
      // of letting it bubble as an unhandled-promise rejection (which
      // would show the yellow box but no message to the user).
      Alert.alert('Ошибка', 'Не удалось загрузить фото');
    }
  };

  const handleSubmit = () => {
    if (!name.trim()) {
      Alert.alert('Ошибка', 'Введите название');
      return;
    }
    issueMut.mutate({
      userId,
      name: name.trim(),
      cost: parseFloat(cost) || 0,
      categoryType,
      serviceLifeMonths: parseInt(serviceLife, 10) || undefined,
      photo: photo || undefined,
    });
  };

  return (
    <CenteredDialog
      visible={visible}
      title="Выдать имущество"
      onClose={onClose}
      primaryText={issueMut.isPending ? 'Выдача…' : 'Выдать'}
      primaryDisabled={issueMut.isPending}
      onPrimaryPress={handleSubmit}
      showCancel
    >
      {storageItems.length > 0 && (
        <View style={{ marginBottom: spacing[3] }}>
          <Text style={[styles.fieldLabel, { color: palette.text.secondary }]}>Со склада (подсобки)</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: spacing[2], paddingRight: spacing[2] }}
          >
            {storageItems
              .filter((s: any) => s.quantity > 0)
              .map((s: any) => (
                <TouchableOpacity
                  key={s.id}
                  onPress={() => pickFromStorage(s)}
                  style={[styles.storageChip, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
                >
                  <Text style={[styles.storageChipName, { color: palette.text.primary }]} numberOfLines={1}>
                    {s.name}
                  </Text>
                  <Text style={[styles.storageChipMeta, { color: palette.text.tertiary }]}>
                    {formatMoney(s.purchasePrice)} · {s.quantity} шт
                  </Text>
                </TouchableOpacity>
              ))}
          </ScrollView>
        </View>
      )}

      <Text style={[styles.fieldLabel, { color: palette.text.secondary }]}>Название</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        style={[
          styles.input,
          { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
        ]}
        placeholder="Набор ключей"
        placeholderTextColor={palette.text.tertiary}
      />

      <View style={styles.row2}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.fieldLabel, { color: palette.text.secondary }]}>Стоимость, ₽</Text>
          <TextInput
            value={cost}
            onChangeText={setCost}
            style={[
              styles.input,
              { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
            ]}
            placeholder="0"
            placeholderTextColor={palette.text.tertiary}
            keyboardType="numeric"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.fieldLabel, { color: palette.text.secondary }]}>Срок, мес.</Text>
          <TextInput
            value={serviceLife}
            onChangeText={setServiceLife}
            style={[
              styles.input,
              { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
            ]}
            placeholder="12"
            placeholderTextColor={palette.text.tertiary}
            keyboardType="numeric"
          />
        </View>
      </View>

      <Text style={[styles.fieldLabel, { color: palette.text.secondary }]}>Категория</Text>
      <View style={styles.catRow}>
        {(
          [
            { k: 'tools', l: 'Инструменты' },
            { k: 'uniform', l: 'Форма' },
            { k: 'other', l: 'Прочее' },
          ] as { k: CategoryType; l: string }[]
        ).map((ct) => (
          <TouchableOpacity
            key={ct.k}
            onPress={() => {
              haptic('select');
              setCategoryType(ct.k);
            }}
            style={[
              styles.catBtn,
              { backgroundColor: palette.bg.muted },
              categoryType === ct.k &&
                (palette.mode === 'dark'
                  ? { backgroundColor: palette.accent.primarySoft, borderColor: palette.border.strong }
                  : styles.catBtnActive),
            ]}
          >
            <Text
              style={[
                styles.catBtnText,
                { color: palette.text.secondary },
                categoryType === ct.k && {
                  color: palette.mode === 'dark' ? palette.accent.primaryText : colors.primary[700],
                },
              ]}
            >
              {ct.l}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={[styles.fieldLabel, { color: palette.text.secondary }]}>Фото</Text>
      <TouchableOpacity
        onPress={pickPhoto}
        style={[styles.photoPickBtn, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
        activeOpacity={0.85}
      >
        {photo ? (
          <CachedImage source={{ uri: photo }} style={styles.photoPickImg} />
        ) : (
          <>
            <Ionicons name="camera-outline" size={22} color={palette.text.tertiary} />
            <Text style={[styles.photoPickHint, { color: palette.text.tertiary }]}>Выбрать</Text>
          </>
        )}
      </TouchableOpacity>
    </CenteredDialog>
  );
}

// ─── Create-folder dialog (Storage root FAB) ───────────────────────────────
function CreateFolderDialog({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const palette = useColors();
  const [name, setName] = useState('');

  const createMut = useMutation({
    mutationFn: (n: string) => equipmentApi.createCategory({ name: n }),
    onSuccess: () => {
      haptic('success');
      qc.invalidateQueries({ queryKey: ['eq-cats'] });
      setName('');
      onClose();
    },
    // Без локального onError срабатывает глобальный fallback из App.tsx —
    // haptic('error') + Alert с текстом ошибки сервера. Локальный хендлер
    // только с хаптикой ПЕРЕКРЫВАЛ бы его и глотал сообщение.
  });

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert('Ошибка', 'Введите название папки');
      return;
    }
    createMut.mutate(trimmed);
  };

  return (
    <CenteredDialog
      visible={visible}
      title="Новая папка"
      onClose={() => {
        setName('');
        onClose();
      }}
      primaryText={createMut.isPending ? 'Создание…' : 'Создать'}
      primaryDisabled={createMut.isPending}
      onPrimaryPress={submit}
      showCancel
    >
      <Text style={[styles.fieldLabel, { color: palette.text.secondary }]}>Название</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        style={[
          styles.input,
          { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
        ]}
        placeholder="Инструменты"
        placeholderTextColor={palette.text.tertiary}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={submit}
      />
    </CenteredDialog>
  );
}

// ─── Create-storage-item dialog (Storage folder FAB) ───────────────────────
function CreateStorageItemDialog({
  visible,
  categoryId,
  onClose,
}: {
  visible: boolean;
  categoryId: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const palette = useColors();
  const [name, setName] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [unit, setUnit] = useState('шт');
  const [serviceLife, setServiceLife] = useState('');
  const [photo, setPhoto] = useState('');

  const createMut = useMutation({
    mutationFn: (data: any) => equipmentApi.createStorageItem(data),
    onSuccess: () => {
      haptic('success');
      qc.invalidateQueries({ queryKey: ['eq-storage'] });
      qc.invalidateQueries({ queryKey: ['eq-storage-list'] });
      setName('');
      setPurchasePrice('');
      setQuantity('1');
      setUnit('шт');
      setServiceLife('');
      setPhoto('');
      onClose();
    },
    // Без локального onError срабатывает глобальный fallback из App.tsx —
    // haptic('error') + Alert с текстом ошибки сервера. Локальный хендлер
    // только с хаптикой ПЕРЕКРЫВАЛ бы его и глотал сообщение.
  });

  const pickPhoto = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
      });
      if (!result.canceled && result.assets[0]) {
        const uploaded = await uploadsApi.upload(result.assets[0].uri, 'equipment.jpg');
        setPhoto(uploaded.data.url);
      }
    } catch {
      Alert.alert('Ошибка', 'Не удалось загрузить фото');
    }
  };

  const submit = () => {
    if (!name.trim()) {
      Alert.alert('Ошибка', 'Введите название');
      return;
    }
    createMut.mutate({
      name: name.trim(),
      categoryId: categoryId || undefined,
      purchasePrice: parseFloat(purchasePrice) || 0,
      quantity: parseFloat(quantity) || 0,
      unit: unit.trim() || 'шт',
      serviceLifeMonths: parseInt(serviceLife, 10) || undefined,
      photo: photo || undefined,
    });
  };

  return (
    <CenteredDialog
      visible={visible}
      title="Новый предмет"
      onClose={() => {
        setName('');
        setPurchasePrice('');
        setQuantity('1');
        setUnit('шт');
        setServiceLife('');
        setPhoto('');
        onClose();
      }}
      primaryText={createMut.isPending ? 'Создание…' : 'Создать'}
      primaryDisabled={createMut.isPending}
      onPrimaryPress={submit}
      showCancel
    >
      <Text style={[styles.fieldLabel, { color: palette.text.secondary }]}>Название</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        style={[
          styles.input,
          { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
        ]}
        placeholder="Набор ключей"
        placeholderTextColor={palette.text.tertiary}
      />

      <View style={styles.row2}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.fieldLabel, { color: palette.text.secondary }]}>Цена, ₽</Text>
          <TextInput
            value={purchasePrice}
            onChangeText={setPurchasePrice}
            style={[
              styles.input,
              { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
            ]}
            placeholder="0"
            placeholderTextColor={palette.text.tertiary}
            keyboardType="numeric"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.fieldLabel, { color: palette.text.secondary }]}>Срок, мес.</Text>
          <TextInput
            value={serviceLife}
            onChangeText={setServiceLife}
            style={[
              styles.input,
              { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
            ]}
            placeholder="12"
            placeholderTextColor={palette.text.tertiary}
            keyboardType="numeric"
          />
        </View>
      </View>

      <View style={styles.row2}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.fieldLabel, { color: palette.text.secondary }]}>Количество</Text>
          <TextInput
            value={quantity}
            onChangeText={setQuantity}
            style={[
              styles.input,
              { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
            ]}
            placeholder="1"
            placeholderTextColor={palette.text.tertiary}
            keyboardType="numeric"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.fieldLabel, { color: palette.text.secondary }]}>Единица</Text>
          <TextInput
            value={unit}
            onChangeText={setUnit}
            style={[
              styles.input,
              { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
            ]}
            placeholder="шт"
            placeholderTextColor={palette.text.tertiary}
          />
        </View>
      </View>

      <Text style={[styles.fieldLabel, { color: palette.text.secondary }]}>Фото</Text>
      <TouchableOpacity
        onPress={pickPhoto}
        style={[styles.photoPickBtn, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
        activeOpacity={0.85}
      >
        {photo ? (
          <CachedImage source={{ uri: photo }} style={styles.photoPickImg} />
        ) : (
          <>
            <Ionicons name="camera-outline" size={22} color={palette.text.tertiary} />
            <Text style={[styles.photoPickHint, { color: palette.text.tertiary }]}>Выбрать</Text>
          </>
        )}
      </TouchableOpacity>
    </CenteredDialog>
  );
}

// ─── Trash dialog (opened from header trailing icon) ───────────────────────
function TrashDialog({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const palette = useColors();
  const { data: items = [] } = useQuery({
    queryKey: ['eq-trash'],
    queryFn: async () => (await equipmentApi.getTrash()).data,
    enabled: visible,
  });

  const restoreMut = useMutation({
    mutationFn: (id: string) => equipmentApi.restore(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['eq-trash'] });
      qc.invalidateQueries({ queryKey: ['eq-summary'] });
    },
    onError: (err: unknown) => {
      haptic('error');
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      Alert.alert('Ошибка', e?.response?.data?.message || e?.message || 'Не удалось восстановить предмет');
    },
  });

  return (
    <CenteredDialog visible={visible} title="Корзина" onClose={onClose}>
      {items.length === 0 ? (
        <Text style={[styles.emptyText, { color: palette.text.tertiary }]}>Корзина пуста</Text>
      ) : (
        <View style={{ gap: spacing[2] }}>
          {items.map((item: any) => {
            const daysLeft = item.trashExpiresAt
              ? Math.max(0, Math.ceil((new Date(item.trashExpiresAt).getTime() - Date.now()) / 86400000))
              : '?';
            return (
              <View
                key={item.id}
                style={[
                  styles.equipItem,
                  { backgroundColor: palette.bg.card, borderColor: palette.border.subtle, opacity: 0.85 },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.equipName, { color: palette.text.primary }]}>{item.name}</Text>
                  <Text style={[styles.equipMeta, { color: palette.text.tertiary }]}>
                    {item.userName} · {formatMoney(item.cost)} · {daysLeft}д
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => {
                    haptic('tap');
                    restoreMut.mutate(item.id);
                  }}
                  style={[styles.equipBtn, palette.mode === 'dark' && { backgroundColor: palette.bg.muted }]}
                >
                  <Ionicons name="arrow-undo" size={14} color={colors.green[500]} />
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      )}
    </CenteredDialog>
  );
}

// ─── Delete-storage-item choice dialog (#14.4) ─────────────────────────────
// When a STORAGE item is deleted, the linked «Имущество» auto-expense can
// either stay ("сервис понёс расход") or be reversed ("вернули деньги в
// оборот"). Centered iOS dialog on a frosted ModalBlurBackdrop with two
// explicit, full-width choice buttons + a cancel.
function DeleteStorageItemDialog({
  item,
  pending,
  onClose,
  onChoose,
}: {
  item: any | null;
  pending: boolean;
  onClose: () => void;
  onChoose: (reverseExpense: boolean) => void;
}) {
  const palette = useColors();
  const visible = !!item;
  return (
    <RNModal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={dialogStyles.kavRoot}>
        <ModalBlurBackdrop onPress={onClose} />
        <View style={dialogStyles.scrim} pointerEvents="box-none">
          <View style={[deleteStyles.card, { backgroundColor: palette.bg.elevated }]}>
            <View
              style={[
                deleteStyles.iconBadge,
                { backgroundColor: palette.mode === 'dark' ? softTint(colors.red[600], 'dark') : colors.red[50] },
              ]}
            >
              <Ionicons name="trash-outline" size={24} color={colors.red[600]} />
            </View>
            <Text style={[deleteStyles.title, { color: palette.text.primary }]} numberOfLines={2}>
              Удалить «{item?.name ?? ''}»?
            </Text>
            <Text style={[deleteStyles.subtitle, { color: palette.text.secondary }]}>
              Что сделать с расходом за покупку этого имущества?
            </Text>

            {/* Choice 1 — keep the expense (default contract). */}
            <TouchableOpacity
              onPress={() => onChoose(false)}
              disabled={pending}
              activeOpacity={0.85}
              style={[deleteStyles.choiceBtn, { backgroundColor: palette.bg.muted }, pending && { opacity: 0.5 }]}
            >
              <Ionicons name="receipt-outline" size={18} color={palette.text.primary} />
              <View style={{ flex: 1 }}>
                <Text style={[deleteStyles.choiceTitle, { color: palette.text.primary }]}>Расход остаётся</Text>
                <Text style={[deleteStyles.choiceHint, { color: palette.text.tertiary }]}>
                  Деньги уже потрачены — запись в Расходах сохранится
                </Text>
              </View>
            </TouchableOpacity>

            {/* Choice 2 — reverse the expense (money back into circulation). */}
            <TouchableOpacity
              onPress={() => onChoose(true)}
              disabled={pending}
              activeOpacity={0.85}
              style={[
                deleteStyles.choiceBtn,
                palette.mode === 'dark'
                  ? { backgroundColor: palette.accent.primarySoft, borderWidth: 1, borderColor: palette.border.strong }
                  : deleteStyles.choiceBtnPrimary,
                pending && { opacity: 0.5 },
              ]}
            >
              <Ionicons name="arrow-undo-outline" size={18} color={colors.primary[700]} />
              <View style={{ flex: 1 }}>
                <Text style={[deleteStyles.choiceTitle, { color: colors.primary[700] }]}>Вернуть деньги в оборот</Text>
                <Text style={[deleteStyles.choiceHint, { color: colors.primary[600] }]}>
                  Возврат — расход в категории «Имущество» отменится
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity onPress={onClose} disabled={pending} style={deleteStyles.cancelBtn} activeOpacity={0.7}>
              <Text style={[deleteStyles.cancelText, { color: palette.text.secondary }]}>Отменить</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </RNModal>
  );
}

const deleteStyles = StyleSheet.create({
  card: {
    width: '88%',
    maxWidth: 420,
    borderRadius: Platform.OS === 'android' ? 28 : 20,
    paddingHorizontal: spacing[5],
    paddingTop: spacing[5],
    paddingBottom: spacing[3],
    alignItems: 'center',
    shadowColor: colors.black,
    shadowOpacity: 0.25,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 12 },
    elevation: 12,
  },
  iconBadge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[3],
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: -0.2,
  },
  subtitle: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: spacing[1],
    marginBottom: spacing[4],
    lineHeight: 18,
  },
  choiceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    width: '100%',
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[3.5],
    borderRadius: borderRadius.xl,
    marginBottom: spacing[2],
  },
  choiceBtnPrimary: {
    backgroundColor: colors.primary[50],
    borderWidth: 1,
    borderColor: colors.primary[200],
  },
  choiceTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
  },
  choiceHint: {
    fontSize: 11,
    marginTop: 2,
    lineHeight: 15,
  },
  cancelBtn: {
    paddingVertical: spacing[3],
    marginTop: spacing[1],
  },
  cancelText: {
    fontSize: 15,
    fontWeight: '600',
  },
});

// ─── Storage tab ───────────────────────────────────────────────────────────
function StorageTab({ canEdit, fabOffsetBottom }: { canEdit: boolean; fabOffsetBottom: number }) {
  const palette = useColors();
  const qc = useQueryClient();
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [showCreateItem, setShowCreateItem] = useState(false);
  // #14.4 — the storage item the user tapped to delete; while set, the
  // reverse-vs-keep-expense choice dialog is shown.
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);

  const { data: categories = [] } = useQuery({
    queryKey: ['eq-cats'],
    queryFn: async () => (await equipmentApi.getCategories()).data,
  });
  const { data: items = [] } = useQuery({
    queryKey: ['eq-storage', selectedCat],
    queryFn: async () => (await equipmentApi.getStorageItems(selectedCat ? { categoryId: selectedCat } : {})).data,
  });

  // #14.4 — delete a storage item. `reverseExpense` decides whether the linked
  // «Имущество» auto-expense is also removed (money returned to circulation) or
  // kept (the service really spent the money). Default contract = keep.
  const removeMut = useMutation({
    mutationFn: ({ id, reverseExpense }: { id: string; reverseExpense: boolean }) =>
      equipmentApi.removeStorageItem(id, { reverseExpense }),
    onSuccess: () => {
      haptic('success');
      qc.invalidateQueries({ queryKey: ['eq-storage'] });
      qc.invalidateQueries({ queryKey: ['eq-storage-list'] });
      qc.invalidateQueries({ queryKey: ['expenses'] });
      setDeleteTarget(null);
    },
    // Без локального onError срабатывает глобальный fallback из App.tsx —
    // haptic('error') + Alert с текстом ошибки сервера. Локальный хендлер
    // только с хаптикой ПЕРЕКРЫВАЛ бы его и глотал сообщение.
  });

  const catCounts: Record<string, number> = {};
  items.forEach((i: any) => {
    if (i.categoryId) catCounts[i.categoryId] = (catCounts[i.categoryId] || 0) + 1;
  });

  // Both views share a single FAB. Its onPress depends on whether we're
  // looking at the root folder list or have a folder open.
  const renderFab = () => {
    if (!canEdit) return null;
    return (
      <View style={[styles.fabWrap, { bottom: fabOffsetBottom }]} pointerEvents="box-none">
        <PressableScale
          onPress={() => {
            haptic('impact');
            if (selectedCat) setShowCreateItem(true);
            else setShowCreateFolder(true);
          }}
          scaleTo={0.92}
          hapticIntent={null}
          style={styles.fab}
        >
          <Ionicons name="add" size={28} color={colors.white} />
        </PressableScale>
      </View>
    );
  };

  if (!selectedCat) {
    return (
      <>
        <View style={{ gap: spacing[2] }}>
          {categories.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: spacing[10] }}>
              <Ionicons name="folder-open-outline" size={40} color={palette.text.tertiary} />
              <Text style={{ fontSize: fontSize.sm, color: palette.text.tertiary, marginTop: spacing[2] }}>
                Нет папок
              </Text>
              {canEdit && (
                <Text style={{ fontSize: fontSize.xs, color: palette.text.tertiary, marginTop: 4 }}>
                  Нажмите «+» внизу, чтобы создать первую
                </Text>
              )}
            </View>
          ) : (
            categories.map((c: any) => (
              <TouchableOpacity
                key={c.id}
                onPress={() => {
                  haptic('tap');
                  setSelectedCat(c.id);
                }}
                style={[styles.folderCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
              >
                <View
                  style={[
                    styles.folderIcon,
                    palette.mode === 'dark' && { backgroundColor: softTint(colors.amber[600], 'dark') },
                  ]}
                >
                  <Ionicons name="folder" size={20} color={colors.amber[600]} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.folderName, { color: palette.text.primary }]}>{c.name}</Text>
                  <Text style={[styles.folderCount, { color: palette.text.tertiary }]}>
                    {catCounts[c.id] || 0} предметов
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
              </TouchableOpacity>
            ))
          )}

          {/* #14.1 — clean "add folder" affordance directly under the last
              folder. Visible only to users who can edit. The FAB stays too,
              but this reads as the primary, discoverable way to add a folder
              at the подсобка root. */}
          {canEdit && categories.length > 0 && (
            <TouchableOpacity
              onPress={() => {
                haptic('tap');
                setShowCreateFolder(true);
              }}
              activeOpacity={0.85}
              style={[styles.addFolderCard, { borderColor: palette.border.subtle }]}
              accessibilityRole="button"
              accessibilityLabel="Новая папка"
            >
              <View style={[styles.addFolderIcon, { backgroundColor: palette.bg.muted }]}>
                <Ionicons name="add" size={20} color={colors.primary[600]} />
              </View>
              <Text style={[styles.addFolderText, { color: colors.primary[600] }]}>Новая папка</Text>
            </TouchableOpacity>
          )}
        </View>
        {renderFab()}
        <CreateFolderDialog visible={showCreateFolder} onClose={() => setShowCreateFolder(false)} />
      </>
    );
  }

  return (
    <>
      <View>
        <TouchableOpacity
          onPress={() => setSelectedCat(null)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[1], marginBottom: spacing[3] }}
        >
          <Ionicons name="chevron-back" size={16} color={palette.text.secondary} />
          <Text style={{ fontSize: fontSize.xs, color: palette.text.secondary }}>Назад к папкам</Text>
        </TouchableOpacity>
        {items.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: spacing[10] }}>
            <Ionicons name="cube-outline" size={40} color={palette.text.tertiary} />
            <Text style={{ fontSize: fontSize.sm, color: palette.text.tertiary, marginTop: spacing[2] }}>Пусто</Text>
            {canEdit && (
              <Text style={{ fontSize: fontSize.xs, color: palette.text.tertiary, marginTop: 4 }}>
                Нажмите «+» внизу, чтобы добавить предмет
              </Text>
            )}
          </View>
        ) : (
          items.map((item: any) => {
            const expired = isExpired(item);
            return (
              <View
                key={item.id}
                style={[
                  styles.equipItem,
                  { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
                  expired && (palette.mode === 'dark' ? darkEquipExpired : styles.equipItemExpired),
                ]}
              >
                {item.photo ? (
                  <TouchableOpacity onPress={() => setPhotoUrl(item.photo)}>
                    <CachedImage source={{ uri: item.photo }} style={styles.equipPhoto} />
                  </TouchableOpacity>
                ) : (
                  <View
                    style={[
                      styles.equipPhoto,
                      { backgroundColor: palette.bg.muted, alignItems: 'center', justifyContent: 'center' },
                    ]}
                  >
                    <Ionicons name="cube-outline" size={18} color={palette.text.tertiary} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={[styles.equipName, { color: palette.text.primary }]}>{item.name}</Text>
                  <Text style={styles.equipCost}>{formatMoney(item.purchasePrice)}</Text>
                  <Text style={[styles.equipMeta, { color: palette.text.tertiary }]}>
                    В наличии: {item.quantity} {item.unit}
                  </Text>
                  {expired && (
                    <View style={[styles.expiredPill, palette.mode === 'dark' && darkExpiredPill]}>
                      <Ionicons
                        name="alert-circle"
                        size={11}
                        color={palette.mode === 'dark' ? colors.red[300] : colors.red[600]}
                      />
                      <Text style={[styles.expiredPillText, palette.mode === 'dark' && { color: colors.red[300] }]}>
                        Срок истёк
                      </Text>
                    </View>
                  )}
                </View>
                {canEdit && (
                  <TouchableOpacity
                    onPress={() => {
                      haptic('tap');
                      setDeleteTarget(item);
                    }}
                    style={[styles.equipBtn, { backgroundColor: palette.bg.muted }]}
                    accessibilityRole="button"
                    accessibilityLabel="Удалить предмет"
                  >
                    <Ionicons name="trash-outline" size={14} color={colors.red[500]} />
                  </TouchableOpacity>
                )}
              </View>
            );
          })
        )}
        {photoUrl && <PhotoViewer url={photoUrl} onClose={() => setPhotoUrl(null)} />}
      </View>
      {renderFab()}
      <CreateStorageItemDialog
        visible={showCreateItem}
        categoryId={selectedCat}
        onClose={() => setShowCreateItem(false)}
      />
      <DeleteStorageItemDialog
        item={deleteTarget}
        pending={removeMut.isPending}
        onClose={() => {
          if (!removeMut.isPending) setDeleteTarget(null);
        }}
        onChoose={(reverseExpense) => {
          if (deleteTarget) removeMut.mutate({ id: deleteTarget.id, reverseExpense });
        }}
      />
    </>
  );
}

// ─── Main Equipment screen ─────────────────────────────────────────────────
export default function EquipmentScreen() {
  const navigation = useNavigation<any>();
  const { user, hasPermission, isRole } = useAuth();
  const tabBarHeight = useTabBarHeight();
  const { width: screenWidth } = useWindowDimensions();
  const palette = useColors();
  const [tab, setTab] = useState<Tab>('employees');
  const [showTrash, setShowTrash] = useState(false);

  const canEdit = isRole(UserRole.SUPERADMIN, UserRole.DIRECTOR, UserRole.ADMIN) || hasPermission('equipment_manage');
  const isMaster = user?.role === 'master';

  // 2-column card width: (screen - left/right padding - gutter) / 2
  const cardWidth = Math.floor((screenWidth - SCREEN_PADDING * 2 - CARD_GUTTER) / 2);

  // The storage-tab FAB needs to sit 16pt above the floating tab bar.
  const fabOffsetBottom = tabBarHeight + spacing[4];

  const { data: summary = [] } = useQuery({
    queryKey: ['eq-summary'],
    queryFn: async () => (await equipmentApi.getSummary()).data,
    enabled: !isMaster,
  });

  const { data: myEquipment = [] } = useQuery({
    queryKey: ['eq-my'],
    queryFn: async () => (await equipmentApi.getMyEquipment()).data,
    enabled: isMaster,
  });

  // Pull-to-refresh — invalidate every equipment slot this screen (and the
  // nested StorageTab) reads; inactive ones are just marked stale. Local
  // `refreshing` state, same pattern as ChecksScreen.
  const qcRefresh = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.allSettled([
        qcRefresh.invalidateQueries({ queryKey: ['eq-summary'] }),
        qcRefresh.invalidateQueries({ queryKey: ['eq-cats'] }),
        qcRefresh.invalidateQueries({ queryKey: ['eq-storage'] }),
        qcRefresh.invalidateQueries({ queryKey: ['eq-my'] }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, [qcRefresh]);

  const headerTrailing = useMemo(() => {
    if (!canEdit) return undefined;
    return (
      <TouchableOpacity
        onPress={() => {
          haptic('tap');
          setShowTrash(true);
        }}
        hitSlop={10}
        style={[styles.headerTrailingBtn, { backgroundColor: palette.bg.muted }]}
        accessibilityRole="button"
        accessibilityLabel="Корзина"
      >
        <Ionicons name="trash-outline" size={22} color={palette.text.primary} />
      </TouchableOpacity>
    );
  }, [canEdit, palette.bg.muted, palette.text.primary]);

  // ── Master view ──
  if (isMaster) {
    const total = myEquipment.reduce((s: number, i: any) => s + i.cost, 0);
    return (
      <View style={{ flex: 1, backgroundColor: palette.bg.canvas }}>
        <IosScreenHeader title="Моё имущество" onBack={() => navigation.goBack()} />
        <ScrollView
          contentContainerStyle={{ padding: spacing[4], paddingBottom: tabBarHeight + spacing[4] }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
          }
        >
          <Text style={{ fontSize: fontSize.xs, color: palette.text.tertiary, marginBottom: spacing[3] }}>
            {myEquipment.length} предметов на {formatMoney(total)}
          </Text>
          {myEquipment.map((item: any) => {
            const expired = isExpired(item);
            return (
              <View
                key={item.id}
                style={[
                  styles.equipItem,
                  { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
                  expired && (palette.mode === 'dark' ? darkEquipExpired : styles.equipItemExpired),
                ]}
              >
                {item.photo ? (
                  <CachedImage source={{ uri: item.photo }} style={styles.equipPhoto} />
                ) : (
                  <View
                    style={[
                      styles.equipPhoto,
                      { backgroundColor: palette.bg.muted, alignItems: 'center', justifyContent: 'center' },
                    ]}
                  >
                    <Ionicons name="cube-outline" size={18} color={palette.text.tertiary} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={[styles.equipName, { color: palette.text.primary }]}>{item.name}</Text>
                  <Text style={styles.equipCost}>{formatMoney(item.cost)}</Text>
                  {expired && (
                    <View style={[styles.expiredPill, palette.mode === 'dark' && darkExpiredPill]}>
                      <Ionicons
                        name="alert-circle"
                        size={11}
                        color={palette.mode === 'dark' ? colors.red[300] : colors.red[600]}
                      />
                      <Text style={[styles.expiredPillText, palette.mode === 'dark' && { color: colors.red[300] }]}>
                        Срок истёк
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            );
          })}
        </ScrollView>
      </View>
    );
  }

  // ── Main: segments + grid ──
  // Employee deтail lives in a separate stack screen (EquipmentEmployeeScreen
  // below + AppNavigator entry) — iOS edge-swipe slides back to the grid.
  return (
    <View style={{ flex: 1, backgroundColor: palette.bg.canvas }}>
      <IosScreenHeader title="Имущество" onBack={() => navigation.goBack()} trailing={headerTrailing} />

      <View style={styles.segmentWrap}>
        <SegmentedTabs value={tab} onChange={setTab} />
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: SCREEN_PADDING,
          paddingBottom: tabBarHeight + spacing[10], // give FAB room to sit above the last row
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
        }
      >
        {tab === 'employees' && (
          <View style={styles.grid}>
            {summary.length === 0 ? (
              <Text style={[styles.emptyText, { width: '100%', color: palette.text.tertiary }]}>Нет сотрудников</Text>
            ) : (
              summary.map((emp: any) => (
                <EmployeeCard
                  key={emp.userId}
                  emp={emp}
                  cardWidth={cardWidth}
                  onPress={() => navigation.push('EquipmentEmployee', { emp })}
                />
              ))
            )}
          </View>
        )}
        {tab === 'storage' && <StorageTab canEdit={canEdit} fabOffsetBottom={fabOffsetBottom} />}
      </ScrollView>

      <TrashDialog visible={showTrash} onClose={() => setShowTrash(false)} />
    </View>
  );
}

// ─── Employee detail screen (отдельный экран в EquipmentStack) ─────────────
export function EquipmentEmployeeScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { hasPermission, isRole } = useAuth();
  const palette = useColors();
  const emp = route.params?.emp;
  const canEdit = isRole(UserRole.SUPERADMIN, UserRole.DIRECTOR, UserRole.ADMIN) || hasPermission('equipment_manage');

  if (!emp) {
    return (
      <View style={{ flex: 1, backgroundColor: palette.bg.canvas }}>
        <IosScreenHeader title="Сотрудник" onBack={() => navigation.goBack()} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: palette.bg.canvas }}>
      <IosScreenHeader title={emp.fullName || 'Сотрудник'} onBack={() => navigation.goBack()} />
      <EmployeeDetail emp={emp} canEdit={canEdit} />
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  // ── Segmented control ──
  segmentWrap: {
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
    paddingTop: spacing[1],
    backgroundColor: 'transparent',
  },
  segmentTrack: {
    flexDirection: 'row',
    backgroundColor: colors.gray[200],
    borderRadius: 10,
    padding: 2,
    height: 32,
  },
  segmentBtn: {
    flex: 1,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[2],
  },
  segmentBtnActive: {
    backgroundColor: colors.white,
    shadowColor: colors.black,
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  segmentText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.gray[600],
    letterSpacing: -0.1,
  },
  segmentTextActive: {
    color: colors.gray[900],
    fontWeight: '600',
  },

  // ── Header trailing button (trash icon) ──
  headerTrailingBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Premium 2-col employee grid ──
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: CARD_GUTTER,
  },
  gridCard: {
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
    backgroundColor: colors.gray[200],
    shadowColor: colors.black,
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  initialsWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initialsText: {
    color: colors.white,
    fontSize: 48,
    fontWeight: '800',
    letterSpacing: -1,
    opacity: 0.92,
  },
  warnPill: {
    position: 'absolute',
    top: 10,
    right: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: colors.orange[500],
    shadowColor: colors.orange[700],
    shadowOpacity: 0.4,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  warnPillText: {
    color: colors.white,
    fontSize: 10,
    fontWeight: '700',
  },
  countersRow: {
    position: 'absolute',
    left: 10,
    bottom: 78,
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
    maxWidth: '85%',
  },
  pillWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: 'hidden',
  },
  // Solid frosted scrim replacing the per-card BlurView (see FrostedPill).
  pillFrost: {
    backgroundColor: 'rgba(17,24,39,0.46)',
  },
  pillIcon: { fontSize: 11 },
  pillLabel: {
    color: colors.white,
    fontSize: 11,
    fontWeight: '700',
  },
  heroBlock: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
  },
  heroCost: {
    color: colors.white,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.7,
  },
  heroName: {
    color: 'rgba(255,255,255,0.95)',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.1,
    marginTop: 2,
  },
  heroMeta: {
    color: 'rgba(255,255,255,0.72)',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 2,
  },

  // ── Employee detail header ──
  empHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    backgroundColor: colors.white,
    padding: spacing[4],
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: colors.gray[100],
    marginBottom: spacing[4],
  },
  empAvatar: { width: 56, height: 56, borderRadius: 28 },
  empName: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.gray[900] },
  empStats: { fontSize: fontSize.xs, color: colors.gray[500], marginTop: 2 },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary[600],
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Per-item row (issued, storage, trash) ──
  equipItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    backgroundColor: colors.white,
    padding: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.gray[100],
    marginBottom: spacing[2],
  },
  // #14.3 — expired service-life look: soft red wash + red hairline border.
  // Item is never auto-deleted, it just reads as "attention / overdue".
  equipItemExpired: {
    backgroundColor: colors.red[50],
    borderColor: colors.red[200],
  },
  expiredPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginTop: 4,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.red[100],
  },
  expiredPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.red[700],
  },
  equipPhoto: { width: 48, height: 48, borderRadius: borderRadius.lg },
  equipName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  equipCost: { fontSize: fontSize.xs, fontWeight: fontWeight.bold, color: colors.primary[600], marginTop: 2 },
  equipMeta: { fontSize: 10, color: colors.gray[400], marginTop: 1 },
  equipBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.gray[50],
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ── Storage folders ──
  folderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    backgroundColor: colors.white,
    padding: spacing[3.5],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.gray[100],
  },
  folderIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.lg,
    backgroundColor: colors.amber[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  folderName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  folderCount: { fontSize: fontSize.xs, color: colors.gray[400], marginTop: 2 },

  // #14.1 — "add folder" card under the last folder (dashed, low-emphasis,
  // brand-tinted) — distinct from a real folder so it reads as an action.
  addFolderCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[3.5],
    borderRadius: borderRadius.xl,
    borderWidth: 1.5,
    borderStyle: 'dashed' as const,
    backgroundColor: 'transparent',
  },
  addFolderIcon: {
    width: 40,
    height: 40,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addFolderText: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },

  // ── FAB (bottom-right) ──
  fabWrap: {
    position: 'absolute',
    right: spacing[4],
    // bottom set inline (depends on tabBarHeight from the parent)
    zIndex: 5,
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary[600],
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary[700],
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },

  // ── Form fields (used in centered dialogs) ──
  fieldLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.gray[600],
    marginBottom: spacing[1],
    marginTop: spacing[2],
  },
  input: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray[200],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    fontSize: fontSize.sm,
    color: colors.gray[900],
    marginBottom: spacing[1],
  },
  row2: {
    flexDirection: 'row',
    gap: spacing[3],
  },
  catRow: {
    flexDirection: 'row',
    gap: spacing[2],
    marginBottom: spacing[2],
  },
  catBtn: {
    flex: 1,
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.gray[50],
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
  },
  catBtnActive: {
    backgroundColor: colors.primary[50],
    borderColor: colors.primary[200],
  },
  catBtnText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.gray[600],
  },
  photoPickBtn: {
    width: 88,
    height: 88,
    borderRadius: borderRadius.xl,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray[200],
    borderStyle: 'dashed' as const,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  photoPickImg: {
    width: '100%',
    height: '100%',
  },
  photoPickHint: {
    color: colors.gray[400],
    fontSize: fontSize.xs,
    marginTop: 4,
  },

  // ── Storage chips (horizontal scroll inside issue dialog) ──
  storageChip: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray[200],
    borderRadius: borderRadius.lg,
    padding: spacing[2.5],
    minWidth: 140,
    maxWidth: 180,
  },
  storageChipName: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.gray[900],
  },
  storageChipMeta: {
    fontSize: 10,
    color: colors.gray[400],
    marginTop: 2,
  },

  // ── Empty state ──
  emptyText: {
    textAlign: 'center',
    color: colors.gray[400],
    paddingVertical: spacing[8],
    fontSize: fontSize.sm,
  },

  // ── Photo viewer (fullscreen lightbox) ──
  photoViewer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoClose: {
    position: 'absolute',
    top: 44,
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  photoImage: { width: '90%', height: '85%' },
});
