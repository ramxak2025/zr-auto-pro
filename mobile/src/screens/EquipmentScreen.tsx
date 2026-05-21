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
 * canEdit role gating preserved: only director / admin / superadmin
 * see the issue button, the FABs and the trash icon.
 */
import React, { useMemo, useState } from 'react';
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
  useWindowDimensions,
  KeyboardAvoidingView,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';

import CachedImage from '../components/CachedImage';
import IosScreenHeader from '../components/IosScreenHeader';
import { equipmentApi, uploadsApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import { colors, spacing, fontSize, fontWeight, borderRadius } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { PressableScale } from '../platform/PressableScale';
import { haptic } from '../platform/haptics';

type Tab = 'employees' | 'storage';
type CategoryType = 'tools' | 'uniform' | 'other';

// Card geometry — premium 2-column grid, computed at runtime so it fits any iPhone.
const SCREEN_PADDING = spacing[4]; // 16pt
const CARD_GUTTER = spacing[3];    // 12pt
const CARD_RADIUS = 22;            // squircle-like, between borderRadius['2xl'] and ['3xl']
const CARD_ASPECT = 1.18;          // 4:5-ish — premium portrait card

function formatMoney(v: number) {
  return (
    Math.round(v)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
  );
}

function getInitials(fullName?: string | null): string {
  if (!fullName) return '?';
  return fullName
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('') || '?';
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
  return (
    <RNModal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* The scrim is itself pressable: tap-outside-to-close. The inner card
          stops propagation so taps on it never close the dialog. */}
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={dialogStyles.kavRoot}
      >
        <TouchableOpacity activeOpacity={1} style={dialogStyles.scrim} onPress={onClose}>
          <TouchableOpacity activeOpacity={1} style={dialogStyles.card} onPress={() => {}}>
            <View style={dialogStyles.header}>
              <View style={dialogStyles.headerSpacer} />
              <Text style={dialogStyles.headerTitle} numberOfLines={1}>
                {title}
              </Text>
              <TouchableOpacity
                onPress={onClose}
                hitSlop={12}
                accessibilityRole="button"
                accessibilityLabel="Закрыть"
                style={dialogStyles.closeBtn}
              >
                <Ionicons name="close" size={20} color={colors.gray[600]} />
              </TouchableOpacity>
            </View>

            <ScrollView
              style={dialogStyles.bodyScroll}
              contentContainerStyle={dialogStyles.bodyContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {children}
            </ScrollView>

            {primaryText && (
              <View style={dialogStyles.footer}>
                {showCancel && (
                  <TouchableOpacity
                    onPress={onClose}
                    style={[dialogStyles.btn, dialogStyles.btnSecondary]}
                    activeOpacity={0.85}
                  >
                    <Text style={dialogStyles.btnSecondaryText}>Отменить</Text>
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
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </RNModal>
  );
}

const dialogStyles = StyleSheet.create({
  kavRoot: {
    flex: 1,
  },
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
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
function FrostedPill({ icon, label }: { icon: string; label: string | number }) {
  if (Platform.OS === 'ios') {
    return (
      <View style={styles.pillWrap}>
        <BlurView intensity={28} tint="dark" style={StyleSheet.absoluteFill} />
        <View style={styles.pillTint} />
        <Text style={styles.pillIcon}>{icon}</Text>
        <Text style={styles.pillLabel}>{label}</Text>
      </View>
    );
  }
  return (
    <View style={[styles.pillWrap, styles.pillAndroid]}>
      <Text style={styles.pillIcon}>{icon}</Text>
      <Text style={styles.pillLabel}>{label}</Text>
    </View>
  );
}

// ─── iOS segmented control (2 segments) ────────────────────────────────────
// Pill-shaped gray track + a white pill for the active segment with a soft
// shadow. Mirrors UISegmentedControl from iOS 13+. ~28pt segment height.
function SegmentedTabs({
  value,
  onChange,
}: {
  value: Tab;
  onChange: (v: Tab) => void;
}) {
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
function EmployeeCard({
  emp,
  cardWidth,
  onPress,
}: {
  emp: any;
  cardWidth: number;
  onPress: () => void;
}) {
  const initials = getInitials(emp.fullName);
  const otherCount = Math.max(
    0,
    (emp.activeCount || 0) - (emp.toolsCount || 0) - (emp.uniformCount || 0),
  );

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
        <CachedImage
          source={{ uri: emp.avatar }}
          style={StyleSheet.absoluteFillObject as any}
          resizeMode="cover"
        />
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
        colors={[
          'rgba(29,78,216,0.30)',
          'rgba(0,0,0,0.00)',
        ]}
        locations={[0, 0.45]}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />

      <LinearGradient
        colors={[
          'rgba(0,0,0,0.00)',
          'rgba(0,0,0,0.55)',
          'rgba(0,0,0,0.86)',
        ]}
        locations={[0.40, 0.72, 1]}
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
          {emp.activeCount || 0} {(emp.activeCount === 1 ? 'предмет' : 'предметов')}
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
  });
  const returnMut = useMutation({
    mutationFn: (id: string) => equipmentApi.returnToStorage(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['eq-user', emp.userId] });
      qc.invalidateQueries({ queryKey: ['eq-summary'] });
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
        {list.map((item: any) => (
          <View
            key={item.id}
            style={[styles.equipItem, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
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
                <Text style={[styles.equipMeta, { color: palette.text.tertiary }]}>Срок: {item.serviceLifeMonths} мес.</Text>
              )}
            </View>
            {canEdit && (
              <View style={{ flexDirection: 'row', gap: spacing[1] }}>
                <TouchableOpacity
                  onPress={() => returnMut.mutate(item.id)}
                  style={[styles.equipBtn, { backgroundColor: palette.bg.muted }]}
                >
                  <Ionicons name="arrow-undo" size={14} color={colors.blue[500]} />
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => trashMut.mutate(item.id)}
                  style={[styles.equipBtn, { backgroundColor: palette.bg.muted }]}
                >
                  <Ionicons name="trash-outline" size={14} color={colors.red[400]} />
                </TouchableOpacity>
              </View>
            )}
          </View>
        ))}
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
              { backgroundColor: colors.primary[100], alignItems: 'center', justifyContent: 'center' },
            ]}
          >
            <Text style={{ fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.primary[700] }}>
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
      <IssueModal
        visible={showIssue}
        userId={emp.userId}
        onClose={() => setShowIssue(false)}
        qc={qc}
      />
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
    onError: () => haptic('error'),
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
          <Text style={styles.fieldLabel}>Со склада (подсобки)</Text>
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
                  style={styles.storageChip}
                >
                  <Text style={styles.storageChipName} numberOfLines={1}>
                    {s.name}
                  </Text>
                  <Text style={styles.storageChipMeta}>
                    {formatMoney(s.purchasePrice)} · {s.quantity} шт
                  </Text>
                </TouchableOpacity>
              ))}
          </ScrollView>
        </View>
      )}

      <Text style={styles.fieldLabel}>Название</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        style={styles.input}
        placeholder="Набор ключей"
        placeholderTextColor={colors.gray[400]}
      />

      <View style={styles.row2}>
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldLabel}>Стоимость, ₽</Text>
          <TextInput
            value={cost}
            onChangeText={setCost}
            style={styles.input}
            placeholder="0"
            placeholderTextColor={colors.gray[400]}
            keyboardType="numeric"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldLabel}>Срок, мес.</Text>
          <TextInput
            value={serviceLife}
            onChangeText={setServiceLife}
            style={styles.input}
            placeholder="12"
            placeholderTextColor={colors.gray[400]}
            keyboardType="numeric"
          />
        </View>
      </View>

      <Text style={styles.fieldLabel}>Категория</Text>
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
            style={[styles.catBtn, categoryType === ct.k && styles.catBtnActive]}
          >
            <Text
              style={[
                styles.catBtnText,
                categoryType === ct.k && { color: colors.primary[700] },
              ]}
            >
              {ct.l}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.fieldLabel}>Фото</Text>
      <TouchableOpacity onPress={pickPhoto} style={styles.photoPickBtn} activeOpacity={0.85}>
        {photo ? (
          <CachedImage source={{ uri: photo }} style={styles.photoPickImg} />
        ) : (
          <>
            <Ionicons name="camera-outline" size={22} color={colors.gray[400]} />
            <Text style={styles.photoPickHint}>Выбрать</Text>
          </>
        )}
      </TouchableOpacity>
    </CenteredDialog>
  );
}

// ─── Create-folder dialog (Storage root FAB) ───────────────────────────────
function CreateFolderDialog({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState('');

  const createMut = useMutation({
    mutationFn: (n: string) => equipmentApi.createCategory({ name: n }),
    onSuccess: () => {
      haptic('success');
      qc.invalidateQueries({ queryKey: ['eq-cats'] });
      setName('');
      onClose();
    },
    onError: () => haptic('error'),
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
      <Text style={styles.fieldLabel}>Название</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        style={styles.input}
        placeholder="Инструменты"
        placeholderTextColor={colors.gray[400]}
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
    onError: () => haptic('error'),
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
      <Text style={styles.fieldLabel}>Название</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        style={styles.input}
        placeholder="Набор ключей"
        placeholderTextColor={colors.gray[400]}
      />

      <View style={styles.row2}>
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldLabel}>Цена, ₽</Text>
          <TextInput
            value={purchasePrice}
            onChangeText={setPurchasePrice}
            style={styles.input}
            placeholder="0"
            placeholderTextColor={colors.gray[400]}
            keyboardType="numeric"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldLabel}>Срок, мес.</Text>
          <TextInput
            value={serviceLife}
            onChangeText={setServiceLife}
            style={styles.input}
            placeholder="12"
            placeholderTextColor={colors.gray[400]}
            keyboardType="numeric"
          />
        </View>
      </View>

      <View style={styles.row2}>
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldLabel}>Количество</Text>
          <TextInput
            value={quantity}
            onChangeText={setQuantity}
            style={styles.input}
            placeholder="1"
            placeholderTextColor={colors.gray[400]}
            keyboardType="numeric"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.fieldLabel}>Единица</Text>
          <TextInput
            value={unit}
            onChangeText={setUnit}
            style={styles.input}
            placeholder="шт"
            placeholderTextColor={colors.gray[400]}
          />
        </View>
      </View>

      <Text style={styles.fieldLabel}>Фото</Text>
      <TouchableOpacity onPress={pickPhoto} style={styles.photoPickBtn} activeOpacity={0.85}>
        {photo ? (
          <CachedImage source={{ uri: photo }} style={styles.photoPickImg} />
        ) : (
          <>
            <Ionicons name="camera-outline" size={22} color={colors.gray[400]} />
            <Text style={styles.photoPickHint}>Выбрать</Text>
          </>
        )}
      </TouchableOpacity>
    </CenteredDialog>
  );
}

// ─── Trash dialog (opened from header trailing icon) ───────────────────────
function TrashDialog({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const qc = useQueryClient();
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
  });

  return (
    <CenteredDialog visible={visible} title="Корзина" onClose={onClose}>
      {items.length === 0 ? (
        <Text style={styles.emptyText}>Корзина пуста</Text>
      ) : (
        <View style={{ gap: spacing[2] }}>
          {items.map((item: any) => {
            const daysLeft = item.trashExpiresAt
              ? Math.max(0, Math.ceil((new Date(item.trashExpiresAt).getTime() - Date.now()) / 86400000))
              : '?';
            return (
              <View key={item.id} style={[styles.equipItem, { opacity: 0.85 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.equipName}>{item.name}</Text>
                  <Text style={styles.equipMeta}>
                    {item.userName} · {formatMoney(item.cost)} · {daysLeft}д
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => {
                    haptic('tap');
                    restoreMut.mutate(item.id);
                  }}
                  style={styles.equipBtn}
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

// ─── Storage tab ───────────────────────────────────────────────────────────
function StorageTab({
  canEdit,
  fabOffsetBottom,
}: {
  canEdit: boolean;
  fabOffsetBottom: number;
}) {
  const palette = useColors();
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [showCreateItem, setShowCreateItem] = useState(false);

  const { data: categories = [] } = useQuery({
    queryKey: ['eq-cats'],
    queryFn: async () => (await equipmentApi.getCategories()).data,
  });
  const { data: items = [] } = useQuery({
    queryKey: ['eq-storage', selectedCat],
    queryFn: async () =>
      (await equipmentApi.getStorageItems(selectedCat ? { categoryId: selectedCat } : {})).data,
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
      <View
        style={[
          styles.fabWrap,
          { bottom: fabOffsetBottom },
        ]}
        pointerEvents="box-none"
      >
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
                <View style={styles.folderIcon}>
                  <Ionicons name="folder" size={20} color={colors.amber[600]} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.folderName, { color: palette.text.primary }]}>{c.name}</Text>
                  <Text style={[styles.folderCount, { color: palette.text.tertiary }]}>{catCounts[c.id] || 0} предметов</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
              </TouchableOpacity>
            ))
          )}
        </View>
        {renderFab()}
        <CreateFolderDialog
          visible={showCreateFolder}
          onClose={() => setShowCreateFolder(false)}
        />
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
            <Text style={{ fontSize: fontSize.sm, color: palette.text.tertiary, marginTop: spacing[2] }}>
              Пусто
            </Text>
            {canEdit && (
              <Text style={{ fontSize: fontSize.xs, color: palette.text.tertiary, marginTop: 4 }}>
                Нажмите «+» внизу, чтобы добавить предмет
              </Text>
            )}
          </View>
        ) : (
          items.map((item: any) => (
            <View
              key={item.id}
              style={[styles.equipItem, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
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
              </View>
            </View>
          ))
        )}
        {photoUrl && <PhotoViewer url={photoUrl} onClose={() => setPhotoUrl(null)} />}
      </View>
      {renderFab()}
      <CreateStorageItemDialog
        visible={showCreateItem}
        categoryId={selectedCat}
        onClose={() => setShowCreateItem(false)}
      />
    </>
  );
}

// ─── Main Equipment screen ─────────────────────────────────────────────────
export default function EquipmentScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const tabBarHeight = useTabBarHeight();
  const { width: screenWidth } = useWindowDimensions();
  const palette = useColors();
  const [tab, setTab] = useState<Tab>('employees');
  const [showTrash, setShowTrash] = useState(false);

  const canEdit = user?.role === 'director' || user?.role === 'admin' || user?.role === 'superadmin';
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
        >
          <Text style={{ fontSize: fontSize.xs, color: palette.text.tertiary, marginBottom: spacing[3] }}>
            {myEquipment.length} предметов на {formatMoney(total)}
          </Text>
          {myEquipment.map((item: any) => (
            <View
              key={item.id}
              style={[styles.equipItem, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
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
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }

  // ── Main: segments + grid ──
  // Employee deтail lives in a separate stack screen (EquipmentEmployeeScreen
  // below + AppNavigator entry) — iOS edge-swipe slides back to the grid.
  return (
    <View style={{ flex: 1, backgroundColor: palette.bg.canvas }}>
      <IosScreenHeader
        title="Имущество"
        onBack={() => navigation.goBack()}
        trailing={headerTrailing}
      />

      <View style={styles.segmentWrap}>
        <SegmentedTabs value={tab} onChange={setTab} />
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: SCREEN_PADDING,
          paddingBottom: tabBarHeight + spacing[10], // give FAB room to sit above the last row
        }}
        showsVerticalScrollIndicator={false}
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
        {tab === 'storage' && (
          <StorageTab canEdit={canEdit} fabOffsetBottom={fabOffsetBottom} />
        )}
      </ScrollView>

      <TrashDialog visible={showTrash} onClose={() => setShowTrash(false)} />
    </View>
  );
}

// ─── Employee detail screen (отдельный экран в EquipmentStack) ─────────────
export function EquipmentEmployeeScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const palette = useColors();
  const emp = route.params?.emp;
  const canEdit = user?.role === 'director' || user?.role === 'admin' || user?.role === 'superadmin';

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
  pillTint: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  pillAndroid: {
    backgroundColor: 'rgba(0,0,0,0.42)',
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

