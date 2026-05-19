/**
 * EquipmentScreen — has three tabs ("Сотрудники / Подсобка / Корзина").
 *
 * Employees tab uses a premium 2-column "game-card" grid:
 *   • full-bleed employee photo or a primary-tinted gradient with initials;
 *   • a two-stop tinted gradient overlay (primary-900 → black) for readable text;
 *   • cost is the hero (large bold ₽ number) with the name beneath it;
 *   • frosted-glass pills at the bottom-left show per-category counters
 *     (tools / uniform / other); on iOS each pill is a BlurView tinted dark,
 *     on Android a translucent black surface;
 *   • expired-items warning sits as a top-right amber pill;
 *   • press uses PressableScale (iOS spring scale + light haptic), Android ripple.
 *
 * Issue modal is a real iOS pageSheet — never full-screen. SafeAreaView with
 * `top` and `bottom` edges keeps the close button clear of the Dynamic Island
 * and the primary action clear of the home indicator. Storage chips, photo
 * picker and the photo viewer modal all keep their original behaviour.
 */
import React, { useState } from 'react';
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
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';

import CachedImage from '../components/CachedImage';
import IosScreenHeader from '../components/IosScreenHeader';
import { equipmentApi, uploadsApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { colors, spacing, fontSize, fontWeight, borderRadius } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { PressableScale } from '../platform/PressableScale';
import { haptic } from '../platform/haptics';

type Tab = 'employees' | 'storage' | 'trash';
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
  // iOS — BlurView dark material; Android — translucent black surface.
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
      {/* Layer 1 — backdrop: photo if available, else brand gradient with initials. */}
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

      {/* Layer 2 — primary-tinted overlay at the top (subtle brand wash). */}
      <LinearGradient
        colors={[
          'rgba(29,78,216,0.30)', // primary-700 alpha 0.30
          'rgba(0,0,0,0.00)',
        ]}
        locations={[0, 0.45]}
        style={StyleSheet.absoluteFillObject}
        pointerEvents="none"
      />

      {/* Layer 3 — darken at the bottom for hero text readability. */}
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

      {/* Top-right — expired warning pill (kept in the new visual language). */}
      {emp.expiredCount > 0 && (
        <View style={styles.warnPill}>
          <Ionicons name="warning" size={11} color={colors.white} />
          <Text style={styles.warnPillText}>{emp.expiredCount}</Text>
        </View>
      )}

      {/* Bottom — counters row (frosted pills). */}
      <View style={styles.countersRow}>
        {emp.toolsCount > 0 && <FrostedPill icon="🔧" label={emp.toolsCount} />}
        {emp.uniformCount > 0 && <FrostedPill icon="👕" label={emp.uniformCount} />}
        {otherCount > 0 && <FrostedPill icon="📦" label={otherCount} />}
      </View>

      {/* Bottom — hero block (cost + name). */}
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
          <Text style={{ fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] }}>
            {title}
          </Text>
          <Text style={{ fontSize: fontSize.xs, color: colors.gray[400] }}>{list.length}</Text>
        </View>
        {list.map((item: any) => (
          <View key={item.id} style={styles.equipItem}>
            {item.photo ? (
              <TouchableOpacity onPress={() => setPhotoUrl(item.photo)}>
                <CachedImage source={{ uri: item.photo }} style={styles.equipPhoto} />
              </TouchableOpacity>
            ) : (
              <View
                style={[
                  styles.equipPhoto,
                  { backgroundColor: colors.gray[100], alignItems: 'center', justifyContent: 'center' },
                ]}
              >
                <Ionicons name="cube-outline" size={18} color={colors.gray[300]} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.equipName} numberOfLines={1}>
                {item.name}
              </Text>
              <Text style={styles.equipCost}>{formatMoney(item.cost)}</Text>
              {item.serviceLifeMonths && (
                <Text style={styles.equipMeta}>Срок: {item.serviceLifeMonths} мес.</Text>
              )}
            </View>
            {canEdit && (
              <View style={{ flexDirection: 'row', gap: spacing[1] }}>
                <TouchableOpacity onPress={() => returnMut.mutate(item.id)} style={styles.equipBtn}>
                  <Ionicons name="arrow-undo" size={14} color={colors.blue[500]} />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => trashMut.mutate(item.id)} style={styles.equipBtn}>
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
      style={{ flex: 1, backgroundColor: colors.gray[50] }}
      contentContainerStyle={{
        padding: spacing[4],
        paddingBottom: tabBarHeight + spacing[4],
      }}
    >
      <View style={styles.empHeader}>
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
          <Text style={styles.empName}>{emp.fullName}</Text>
          <Text style={styles.empStats}>
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
          <Ionicons name="cube-outline" size={40} color={colors.gray[200]} />
          <Text style={{ fontSize: fontSize.sm, color: colors.gray[400], marginTop: spacing[2] }}>
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
      {showIssue && (
        <IssueModal userId={emp.userId} onClose={() => setShowIssue(false)} qc={qc} />
      )}
    </ScrollView>
  );
}

// ─── Issue modal (compact pageSheet — NOT fullscreen) ──────────────────────
function IssueModal({ userId, onClose, qc }: { userId: string; onClose: () => void; qc: any }) {
  const [name, setName] = useState('');
  const [cost, setCost] = useState('');
  const [categoryType, setCategoryType] = useState<CategoryType>('tools');
  const [serviceLife, setServiceLife] = useState('');
  const [photo, setPhoto] = useState('');

  const { data: storageItems = [] } = useQuery({
    queryKey: ['eq-storage-list'],
    queryFn: async () => (await equipmentApi.getStorageItems()).data,
  });

  const issueMut = useMutation({
    mutationFn: (data: any) => equipmentApi.issue(data),
    onSuccess: () => {
      haptic('success');
      qc.invalidateQueries({ queryKey: ['eq-user', userId] });
      qc.invalidateQueries({ queryKey: ['eq-summary'] });
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
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) {
      const uploaded = await uploadsApi.upload(result.assets[0].uri, 'equipment.jpg');
      setPhoto(uploaded.data.url);
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
    <RNModal
      visible
      animationType="slide"
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : 'formSheet'}
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.sheetRoot} edges={['top', 'bottom']}>
        {/* Header — close (X) left, title centered, primary action right.
            All three sit BELOW the system status area inside the sheet itself,
            so nothing slides under the Dynamic Island. */}
        <View style={styles.sheetHeader}>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={12}
            style={styles.sheetIconBtn}
            accessibilityRole="button"
            accessibilityLabel="Закрыть"
          >
            <Ionicons name="close" size={20} color={colors.gray[700]} />
          </TouchableOpacity>
          <Text style={styles.sheetTitle}>Выдать имущество</Text>
          <TouchableOpacity
            onPress={handleSubmit}
            disabled={issueMut.isPending}
            hitSlop={12}
            style={styles.sheetPrimaryBtn}
          >
            <Text style={styles.sheetPrimaryText}>{issueMut.isPending ? '...' : 'Выдать'}</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.sheetBody}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
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
        </ScrollView>
      </SafeAreaView>
    </RNModal>
  );
}

// ─── Storage tab ───────────────────────────────────────────────────────────
function StorageTab() {
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

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

  if (!selectedCat) {
    return (
      <View style={{ gap: spacing[2] }}>
        {categories.length === 0 ? (
          <Text style={styles.emptyText}>Нет папок</Text>
        ) : (
          categories.map((c: any) => (
            <TouchableOpacity
              key={c.id}
              onPress={() => setSelectedCat(c.id)}
              style={styles.folderCard}
            >
              <View style={styles.folderIcon}>
                <Ionicons name="folder" size={20} color={colors.amber[600]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.folderName}>{c.name}</Text>
                <Text style={styles.folderCount}>{catCounts[c.id] || 0} предметов</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.gray[300]} />
            </TouchableOpacity>
          ))
        )}
      </View>
    );
  }

  return (
    <View>
      <TouchableOpacity
        onPress={() => setSelectedCat(null)}
        style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[1], marginBottom: spacing[3] }}
      >
        <Ionicons name="chevron-back" size={16} color={colors.gray[500]} />
        <Text style={{ fontSize: fontSize.xs, color: colors.gray[500] }}>Назад к папкам</Text>
      </TouchableOpacity>
      {items.length === 0 ? (
        <Text style={styles.emptyText}>Пусто</Text>
      ) : (
        items.map((item: any) => (
          <View key={item.id} style={styles.equipItem}>
            {item.photo ? (
              <TouchableOpacity onPress={() => setPhotoUrl(item.photo)}>
                <CachedImage source={{ uri: item.photo }} style={styles.equipPhoto} />
              </TouchableOpacity>
            ) : (
              <View
                style={[
                  styles.equipPhoto,
                  { backgroundColor: colors.gray[100], alignItems: 'center', justifyContent: 'center' },
                ]}
              >
                <Ionicons name="cube-outline" size={18} color={colors.gray[300]} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Text style={styles.equipName}>{item.name}</Text>
              <Text style={styles.equipCost}>{formatMoney(item.purchasePrice)}</Text>
              <Text style={styles.equipMeta}>
                В наличии: {item.quantity} {item.unit}
              </Text>
            </View>
          </View>
        ))
      )}
      {photoUrl && <PhotoViewer url={photoUrl} onClose={() => setPhotoUrl(null)} />}
    </View>
  );
}

// ─── Trash tab ─────────────────────────────────────────────────────────────
function TrashTab() {
  const qc = useQueryClient();
  const { data: items = [] } = useQuery({
    queryKey: ['eq-trash'],
    queryFn: async () => (await equipmentApi.getTrash()).data,
  });

  const restoreMut = useMutation({
    mutationFn: (id: string) => equipmentApi.restore(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['eq-trash'] });
      qc.invalidateQueries({ queryKey: ['eq-summary'] });
    },
  });

  if (items.length === 0) {
    return <Text style={styles.emptyText}>Корзина пуста</Text>;
  }

  return (
    <View style={{ gap: spacing[2] }}>
      {items.map((item: any) => {
        const daysLeft = item.trashExpiresAt
          ? Math.max(0, Math.ceil((new Date(item.trashExpiresAt).getTime() - Date.now()) / 86400000))
          : '?';
        return (
          <View key={item.id} style={[styles.equipItem, { opacity: 0.7 }]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.equipName}>{item.name}</Text>
              <Text style={styles.equipMeta}>
                {item.userName} · {formatMoney(item.cost)} · {daysLeft}д
              </Text>
            </View>
            <TouchableOpacity onPress={() => restoreMut.mutate(item.id)} style={styles.equipBtn}>
              <Ionicons name="arrow-undo" size={14} color={colors.green[500]} />
            </TouchableOpacity>
          </View>
        );
      })}
    </View>
  );
}

// ─── Main Equipment screen ─────────────────────────────────────────────────
export default function EquipmentScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const tabBarHeight = useTabBarHeight();
  const { width: screenWidth } = useWindowDimensions();
  const [tab, setTab] = useState<Tab>('employees');

  const canEdit = user?.role === 'director' || user?.role === 'admin' || user?.role === 'superadmin';
  const isMaster = user?.role === 'master';

  // 2-column card width: (screen - left/right padding - gutter) / 2
  const cardWidth = Math.floor((screenWidth - SCREEN_PADDING * 2 - CARD_GUTTER) / 2);

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

  // ── Master view ──
  if (isMaster) {
    const total = myEquipment.reduce((s: number, i: any) => s + i.cost, 0);
    return (
      <View style={{ flex: 1, backgroundColor: colors.gray[50] }}>
        <IosScreenHeader title="Моё имущество" onBack={() => navigation.goBack()} />
        <ScrollView
          contentContainerStyle={{ padding: spacing[4], paddingBottom: tabBarHeight + spacing[4] }}
        >
          <Text style={{ fontSize: fontSize.xs, color: colors.gray[400], marginBottom: spacing[3] }}>
            {myEquipment.length} предметов на {formatMoney(total)}
          </Text>
          {myEquipment.map((item: any) => (
            <View key={item.id} style={styles.equipItem}>
              {item.photo ? (
                <CachedImage source={{ uri: item.photo }} style={styles.equipPhoto} />
              ) : (
                <View
                  style={[
                    styles.equipPhoto,
                    { backgroundColor: colors.gray[100], alignItems: 'center', justifyContent: 'center' },
                  ]}
                >
                  <Ionicons name="cube-outline" size={18} color={colors.gray[300]} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.equipName}>{item.name}</Text>
                <Text style={styles.equipCost}>{formatMoney(item.cost)}</Text>
              </View>
            </View>
          ))}
        </ScrollView>
      </View>
    );
  }

  // ── Main: tabs + grid ──
  // Сотрудник-детали раньше открывались через локальный `selectedEmp`
  // state и рендерились inline. Теперь это отдельный экран в
  // EquipmentStack (см. EquipmentEmployeeScreen ниже + AppNavigator),
  // что даёт iOS edge-swipe slide-back назад к сетке. push() вместо
  // navigate() чтобы каждое открытие создавало новый кадр стека.
  return (
    <View style={{ flex: 1, backgroundColor: colors.gray[50] }}>
      <IosScreenHeader title="Имущество" onBack={() => navigation.goBack()} />

      <View style={styles.tabs}>
        {(
          [
            { k: 'employees', l: 'Сотрудники', i: 'people' },
            { k: 'storage', l: 'Подсобка', i: 'cube' },
            { k: 'trash', l: 'Корзина', i: 'trash' },
          ] as { k: Tab; l: string; i: any }[]
        ).map((t) => (
          <TouchableOpacity
            key={t.k}
            onPress={() => {
              haptic('select');
              setTab(t.k);
            }}
            style={[styles.tabBtn, tab === t.k && styles.tabBtnActive]}
          >
            <Ionicons name={t.i} size={14} color={tab === t.k ? colors.primary[600] : colors.gray[400]} />
            <Text style={[styles.tabText, tab === t.k && { color: colors.primary[600] }]}>{t.l}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: SCREEN_PADDING,
          paddingBottom: tabBarHeight + spacing[4],
        }}
        showsVerticalScrollIndicator={false}
      >
        {tab === 'employees' && (
          <View style={styles.grid}>
            {summary.length === 0 ? (
              <Text style={[styles.emptyText, { width: '100%' }]}>Нет сотрудников</Text>
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
        {tab === 'storage' && <StorageTab />}
        {tab === 'trash' && <TrashTab />}
      </ScrollView>
    </View>
  );
}

// ─── Employee detail screen (отдельный экран в EquipmentStack) ─────────────
// Раньше эта детальная карточка рендерилась inline внутри EquipmentScreen
// при наличии selectedEmp. Перенесли в отдельный экран навигатора —
// теперь iOS edge-swipe слева возвращает к сетке сотрудников, как
// привычно в любом нативном iOS-приложении. emp читается из route.params,
// header кнопкой "Назад" зовёт navigation.goBack().
export function EquipmentEmployeeScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const emp = route.params?.emp;
  const canEdit = user?.role === 'director' || user?.role === 'admin' || user?.role === 'superadmin';

  if (!emp) {
    // Защита от случая, когда экран получили без params (deep-link и т.п.).
    // На корне стека `goBack()` всё равно не пустой — выкинет на grid.
    return (
      <View style={{ flex: 1, backgroundColor: colors.gray[50] }}>
        <IosScreenHeader title="Сотрудник" onBack={() => navigation.goBack()} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.gray[50] }}>
      <IosScreenHeader title={emp.fullName || 'Сотрудник'} onBack={() => navigation.goBack()} />
      <EmployeeDetail emp={emp} canEdit={canEdit} />
    </View>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    paddingHorizontal: spacing[3],
    paddingBottom: spacing[2],
    gap: spacing[1.5],
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[100],
  },
  tabBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: spacing[2],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.gray[50],
  },
  tabBtnActive: { backgroundColor: colors.primary[50], borderWidth: 1, borderColor: colors.primary[200] },
  tabText: { fontSize: 11, fontWeight: fontWeight.semibold, color: colors.gray[400] },

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
    // Soft shadow — readable elevation without being heavy.
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
  // Top-right amber pill — expired-items warning, kept in the new visual language.
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
  // Frosted counter pills sit at the bottom-left, above the hero block.
  countersRow: {
    position: 'absolute',
    left: 10,
    bottom: 78, // sits ABOVE the hero block (~hero height + gutter)
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
    backgroundColor: 'rgba(0,0,0,0.18)', // tone the iOS dark blur a touch
  },
  pillAndroid: {
    backgroundColor: 'rgba(0,0,0,0.42)', // translucent black on Android
  },
  pillIcon: { fontSize: 11 },
  pillLabel: {
    color: colors.white,
    fontSize: 11,
    fontWeight: '700',
  },
  // Hero text block.
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

  // ── Modal (pageSheet) ──
  sheetRoot: {
    flex: 1,
    backgroundColor: colors.gray[50],
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    backgroundColor: colors.white,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.gray[200],
  },
  sheetIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: fontWeight.bold,
    color: colors.gray[900],
    letterSpacing: -0.2,
  },
  sheetPrimaryBtn: {
    paddingHorizontal: spacing[3],
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: colors.primary[600],
  },
  sheetPrimaryText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: fontWeight.bold,
    letterSpacing: -0.1,
  },
  sheetBody: {
    padding: spacing[4],
    paddingBottom: spacing[6],
  },

  // ── Modal form fields ──
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

  // ── Storage chips (horizontal scroll inside modal) ──
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
