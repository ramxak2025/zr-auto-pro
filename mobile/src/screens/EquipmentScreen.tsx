import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  RefreshControl,
  Modal as RNModal,
  Alert,
  ActivityIndicator,
} from 'react-native';
import CachedImage from '../components/CachedImage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { equipmentApi, uploadsApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import IosScreenHeader from '../components/IosScreenHeader';
import { colors, spacing, fontSize, fontWeight, borderRadius } from '../theme';
import { useTabBarHeight } from '../hooks/useTabBarHeight';

type Tab = 'employees' | 'storage' | 'trash';

function formatMoney(v: number) {
  return (
    Math.round(v)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
  );
}

// ── Photo viewer modal ──
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

// ── Employee detail screen (within Equipment) ──
function EmployeeDetail({ emp, canEdit }: { emp: any; onBack: () => void; canEdit: boolean }) {
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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginBottom: spacing[2] }}>
          <Ionicons name={iconName} size={14} color={color} />
          <Text style={{ fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] }}>{title}</Text>
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
              {item.serviceLifeMonths && <Text style={styles.equipMeta}>Срок: {item.serviceLifeMonths} мес.</Text>}
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
    <ScrollView style={{ flex: 1, backgroundColor: colors.gray[50] }} contentContainerStyle={{ padding: spacing[4], paddingBottom: tabBarHeight + spacing[4] }}>
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
              {emp.fullName
                ?.split(' ')
                .map((w: string) => w[0])
                .join('')
                .slice(0, 2)}
            </Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.empName}>{emp.fullName}</Text>
          <Text style={styles.empStats}>
            {active.length} предметов • {formatMoney(total)}
          </Text>
        </View>
        {canEdit && (
          <TouchableOpacity onPress={() => setShowIssue(true)} style={styles.addBtn}>
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
      {showIssue && <IssueModal userId={emp.userId} onClose={() => setShowIssue(false)} qc={qc} />}
    </ScrollView>
  );
}

// ── Issue modal ──
function IssueModal({ userId, onClose, qc }: { userId: string; onClose: () => void; qc: any }) {
  const [name, setName] = useState('');
  const [cost, setCost] = useState('');
  const [categoryType, setCategoryType] = useState<'tools' | 'uniform' | 'other'>('tools');
  const [serviceLife, setServiceLife] = useState('');
  const [photo, setPhoto] = useState('');

  const { data: storageItems = [] } = useQuery({
    queryKey: ['eq-storage-list'],
    queryFn: async () => (await equipmentApi.getStorageItems()).data,
  });

  const issueMut = useMutation({
    mutationFn: (data: any) => equipmentApi.issue(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['eq-user', userId] });
      qc.invalidateQueries({ queryKey: ['eq-summary'] });
      onClose();
    },
  });

  const pickFromStorage = (item: any) => {
    setName(item.name);
    setCost(String(item.purchasePrice));
    if (item.photo) setPhoto(item.photo);
    if (item.serviceLifeMonths) setServiceLife(String(item.serviceLifeMonths));
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
      serviceLifeMonths: parseInt(serviceLife) || undefined,
      photo: photo || undefined,
    });
  };

  return (
    <RNModal visible animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.gray[50] }}>
        <View style={styles.modalHeader}>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={24} color={colors.gray[500]} />
          </TouchableOpacity>
          <Text style={styles.modalTitle}>Выдать имущество</Text>
          <TouchableOpacity onPress={handleSubmit} disabled={issueMut.isPending}>
            <Text style={{ color: colors.primary[600], fontWeight: fontWeight.bold }}>
              {issueMut.isPending ? '...' : 'Выдать'}
            </Text>
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: spacing[4] }}>
          {storageItems.length > 0 && (
            <View style={{ marginBottom: spacing[4] }}>
              <Text style={styles.fieldLabel}>Со склада (подсобки)</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing[2] }}>
                {storageItems
                  .filter((s: any) => s.quantity > 0)
                  .map((s: any) => (
                    <TouchableOpacity key={s.id} onPress={() => pickFromStorage(s)} style={styles.storageChip}>
                      <Text style={styles.storageChipName}>{s.name}</Text>
                      <Text style={styles.storageChipMeta}>
                        {formatMoney(s.purchasePrice)} • {s.quantity} шт
                      </Text>
                    </TouchableOpacity>
                  ))}
              </ScrollView>
            </View>
          )}

          <Text style={styles.fieldLabel}>Название</Text>
          <TextInput value={name} onChangeText={setName} style={styles.input} placeholder="Набор ключей" />

          <Text style={styles.fieldLabel}>Стоимость, ₽</Text>
          <TextInput value={cost} onChangeText={setCost} style={styles.input} placeholder="0" keyboardType="numeric" />

          <Text style={styles.fieldLabel}>Категория</Text>
          <View style={{ flexDirection: 'row', gap: spacing[2], marginBottom: spacing[3] }}>
            {[
              { k: 'tools', l: 'Инструменты' },
              { k: 'uniform', l: 'Форма' },
              { k: 'other', l: 'Прочее' },
            ].map((ct) => (
              <TouchableOpacity
                key={ct.k}
                onPress={() => setCategoryType(ct.k as any)}
                style={[styles.catBtn, categoryType === ct.k && styles.catBtnActive]}
              >
                <Text style={[styles.catBtnText, categoryType === ct.k && { color: colors.primary[700] }]}>{ct.l}</Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.fieldLabel}>Срок службы (мес.)</Text>
          <TextInput
            value={serviceLife}
            onChangeText={setServiceLife}
            style={styles.input}
            placeholder="12"
            keyboardType="numeric"
          />

          <Text style={styles.fieldLabel}>Фото</Text>
          <TouchableOpacity onPress={pickPhoto} style={styles.photoPickBtn}>
            {photo ? (
              <CachedImage source={{ uri: photo }} style={{ width: 80, height: 80, borderRadius: 12 }} />
            ) : (
              <>
                <Ionicons name="camera-outline" size={24} color={colors.gray[400]} />
                <Text style={{ color: colors.gray[400], fontSize: fontSize.xs, marginTop: 4 }}>Выбрать</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    </RNModal>
  );
}

// ── Main Equipment screen ──
export default function EquipmentScreen() {
  const navigation = useNavigation<any>();
  const { user } = useAuth();
  const qc = useQueryClient();
  const tabBarHeight = useTabBarHeight();
  const [tab, setTab] = useState<Tab>('employees');
  const [selectedEmp, setSelectedEmp] = useState<any>(null);
  const canEdit = user?.role === 'director' || user?.role === 'admin' || user?.role === 'superadmin';
  const isMaster = user?.role === 'master';

  const { data: summary = [], refetch: refetchSummary } = useQuery({
    queryKey: ['eq-summary'],
    queryFn: async () => (await equipmentApi.getSummary()).data,
    enabled: !isMaster,
  });

  const { data: myEquipment = [] } = useQuery({
    queryKey: ['eq-my'],
    queryFn: async () => (await equipmentApi.getMyEquipment()).data,
    enabled: isMaster,
  });

  // Master view
  if (isMaster) {
    const total = myEquipment.reduce((s: number, i: any) => s + i.cost, 0);
    return (
      <View style={{ flex: 1, backgroundColor: colors.gray[50] }}>
        <IosScreenHeader title="Моё имущество" onBack={() => navigation.goBack()} />
        <ScrollView contentContainerStyle={{ padding: spacing[4], paddingBottom: tabBarHeight + spacing[4] }}>
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

  if (selectedEmp) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.gray[50] }}>
        <IosScreenHeader title={selectedEmp.fullName || 'Сотрудник'} onBack={() => setSelectedEmp(null)} />
        <EmployeeDetail emp={selectedEmp} onBack={() => setSelectedEmp(null)} canEdit={canEdit} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.gray[50] }}>
      <IosScreenHeader title="Имущество" onBack={() => navigation.goBack()} />

      <View style={styles.tabs}>
        {[
          { k: 'employees' as const, l: 'Сотрудники', i: 'people' as const },
          { k: 'storage' as const, l: 'Подсобка', i: 'cube' as const },
          { k: 'trash' as const, l: 'Корзина', i: 'trash' as const },
        ].map((t) => (
          <TouchableOpacity
            key={t.k}
            onPress={() => setTab(t.k)}
            style={[styles.tabBtn, tab === t.k && styles.tabBtnActive]}
          >
            <Ionicons name={t.i} size={14} color={tab === t.k ? colors.primary[600] : colors.gray[400]} />
            <Text style={[styles.tabText, tab === t.k && { color: colors.primary[600] }]}>{t.l}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing[4], paddingBottom: tabBarHeight + spacing[4] }}>
        {tab === 'employees' && (
          <View style={{ gap: spacing[2] }}>
            {summary.map((emp: any) => (
              <TouchableOpacity key={emp.userId} onPress={() => setSelectedEmp(emp)} style={styles.empCard}>
                {emp.avatar ? (
                  <CachedImage source={{ uri: emp.avatar }} style={styles.empAvatarSmall} />
                ) : (
                  <View
                    style={[
                      styles.empAvatarSmall,
                      { backgroundColor: colors.primary[100], alignItems: 'center', justifyContent: 'center' },
                    ]}
                  >
                    <Text style={{ color: colors.primary[700], fontWeight: fontWeight.bold }}>
                      {emp.fullName?.charAt(0)}
                    </Text>
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={styles.empCardName}>{emp.fullName}</Text>
                  <View style={{ flexDirection: 'row', gap: spacing[2], marginTop: 2 }}>
                    {emp.toolsCount > 0 && <Text style={styles.empBadge}>🔧 {emp.toolsCount}</Text>}
                    {emp.uniformCount > 0 && <Text style={styles.empBadge}>👕 {emp.uniformCount}</Text>}
                    {emp.expiredCount > 0 && (
                      <Text style={[styles.empBadge, { color: colors.orange[600] }]}>⚠ {emp.expiredCount}</Text>
                    )}
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.primary[600] }}>
                    {formatMoney(emp.totalCost)}
                  </Text>
                  <Text style={{ fontSize: 10, color: colors.gray[400] }}>{emp.activeCount} предм.</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={colors.gray[300]} />
              </TouchableOpacity>
            ))}
          </View>
        )}
        {tab === 'storage' && <StorageTab />}
        {tab === 'trash' && <TrashTab />}
      </ScrollView>
    </View>
  );
}

// ── Storage tab ──
function StorageTab() {
  const qc = useQueryClient();
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  const { data: categories = [] } = useQuery({
    queryKey: ['eq-cats'],
    queryFn: async () => (await equipmentApi.getCategories()).data,
  });
  const { data: items = [] } = useQuery({
    queryKey: ['eq-storage', selectedCat],
    queryFn: async () => (await equipmentApi.getStorageItems(selectedCat ? { categoryId: selectedCat } : {})).data,
  });

  const catCounts: Record<string, number> = {};
  items.forEach((i: any) => {
    if (i.categoryId) catCounts[i.categoryId] = (catCounts[i.categoryId] || 0) + 1;
  });

  if (!selectedCat) {
    return (
      <View style={{ gap: spacing[2] }}>
        {categories.length === 0 ? (
          <Text style={{ textAlign: 'center', color: colors.gray[400], paddingVertical: spacing[8] }}>Нет папок</Text>
        ) : (
          categories.map((c: any) => (
            <TouchableOpacity key={c.id} onPress={() => setSelectedCat(c.id)} style={styles.folderCard}>
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
        <Text style={{ textAlign: 'center', color: colors.gray[400], paddingVertical: spacing[8] }}>Пусто</Text>
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

// ── Trash tab ──
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

  return items.length === 0 ? (
    <Text style={{ textAlign: 'center', color: colors.gray[400], paddingVertical: spacing[8] }}>Корзина пуста</Text>
  ) : (
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
                {item.userName} • {formatMoney(item.cost)} • {daysLeft}д
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

  empCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    backgroundColor: colors.white,
    padding: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.gray[100],
  },
  empAvatarSmall: { width: 40, height: 40, borderRadius: 20 },
  empCardName: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  empBadge: { fontSize: 10, color: colors.gray[500] },

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

  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing[4],
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[100],
  },
  modalTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.gray[900] },
  fieldLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.gray[500],
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
    marginBottom: spacing[2],
  },
  catBtn: {
    flex: 1,
    paddingVertical: spacing[2],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.gray[50],
    alignItems: 'center',
  },
  catBtnActive: { backgroundColor: colors.primary[50], borderWidth: 1, borderColor: colors.primary[200] },
  catBtnText: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: colors.gray[500] },
  photoPickBtn: {
    width: 80,
    height: 80,
    borderRadius: 12,
    backgroundColor: colors.gray[50],
    borderWidth: 1,
    borderColor: colors.gray[200],
    borderStyle: 'dashed' as const,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storageChip: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.gray[200],
    borderRadius: borderRadius.lg,
    padding: spacing[2.5],
    minWidth: 140,
  },
  storageChipName: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  storageChipMeta: { fontSize: 10, color: colors.gray[400], marginTop: 2 },

  photoViewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', alignItems: 'center', justifyContent: 'center' },
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
