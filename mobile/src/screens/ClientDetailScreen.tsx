import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  ActivityIndicator,
  RefreshControl,
  Linking,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRoute, useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import { clientsApi, carsApi, checksApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import DuplicateWarningDialog from '../components/DuplicateWarningDialog';
import LoadingSpinner from '../components/LoadingSpinner';
import AnimatedCard from '../components/AnimatedCard';
import IosScreenHeader from '../components/IosScreenHeader';
import SourcePickerSheet from '../components/SourcePickerSheet';
import { UserRole } from '../../../shared/types';
import { colors, fontSize, fontWeight, borderRadius, spacing, badgeColors, paymentMethodBadgeColor } from '../theme';
import type { Client, Car, Check, PerCarChecks } from '../../../shared/types';
import { formatPhone } from '../../../shared/validation/phone';
import { haptic } from '../platform/haptics';
import { processPlateMainInput } from '../utils/plateMask';

const paymentLabels: Record<string, string> = {
  cash: 'Наличные',
  card: 'Карта',
  warranty: 'Гарантия',
  cash_card: 'Нал/Карта',
};

function formatMoney(v: number): string {
  return (
    Math.round(v)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
  );
}
function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function formatDateGroup(d: string): string {
  const dt = new Date(d);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  if (dt.toDateString() === today.toDateString()) return 'Сегодня';
  if (dt.toDateString() === yesterday.toDateString()) return 'Вчера';
  return dt.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0]?.[0] || '?').toUpperCase();
}

const avatarColors = [
  colors.primary[500],
  colors.green[600],
  colors.orange[500],
  colors.purple[700],
  colors.teal[600],
  colors.rose[500],
  colors.indigo[600],
  colors.yellow[600],
];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return avatarColors[Math.abs(hash) % avatarColors.length];
}

const carIconColors = [
  colors.primary[500],
  colors.green[600],
  colors.orange[500],
  colors.purple[700],
  colors.teal[600],
  colors.rose[500],
];

function getCarColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return carIconColors[Math.abs(hash) % carIconColors.length];
}

/**
 * Strip "+" / spaces / dashes from a phone string for tel: / sms: / wa.me URLs.
 * Keeps a single leading "+" so the system dialer recognises the
 * international format on iOS. wa.me needs only digits.
 */
function rawPhoneDigits(phone: string): string {
  return (phone || '').replace(/[^\d]/g, '');
}
function telHref(phone: string): string {
  const digits = rawPhoneDigits(phone);
  return `tel:${digits.length > 0 ? '+' + digits : ''}`;
}
function smsHref(phone: string): string {
  const digits = rawPhoneDigits(phone);
  return `sms:${digits.length > 0 ? '+' + digits : ''}`;
}
function whatsappHref(phone: string): string {
  const digits = rawPhoneDigits(phone);
  return `https://wa.me/${digits}`;
}

/** Compact sparkline drawn with overlapping bars — no SVG dep needed. */
function MonthlySparkline({
  months,
  height = 36,
  bar = 6,
  gap = 4,
  color,
}: {
  months: number[];
  height?: number;
  bar?: number;
  gap?: number;
  color: string;
}) {
  const max = Math.max(1, ...months);
  return (
    <View style={[sparkStyles.row, { height, gap }]}>
      {months.map((v, i) => {
        const ratio = Math.max(0.06, v / max);
        return (
          <View
            key={i}
            style={[
              sparkStyles.bar,
              { width: bar, height: Math.max(2, height * ratio), backgroundColor: color, opacity: 0.4 + 0.6 * ratio },
            ]}
          />
        );
      })}
    </View>
  );
}

const sparkStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end' },
  bar: { borderRadius: 2 },
});

export default function ClientDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const { hasPermission, isRole } = useAuth();
  const palette = useColors();
  const canViewProfit = hasPermission('profit_view');
  // Notes / source — owner-only. We still render the section for
  // director (a workshop boss can want to tag a client too) and for
  // superadmin (test/debug).
  const canEditMeta = isRole(UserRole.SUPERADMIN, UserRole.DIRECTOR) || hasPermission('clients_edit');
  const { id, focusCarId } = route.params as { id: string; focusCarId?: string };
  const isRetail = id === '__retail__';
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCarId, setSelectedCarId] = useState<string | null>(null);

  // Scroll target — referenced when we arrive from the unified Clients
  // screen "Авто" tab. We track Y per car row in `carRowYs` and call
  // scrollTo() once the layout has settled. Guarded by `focusHandled`
  // so a re-render doesn't re-jump after the user has already scrolled
  // elsewhere.
  const scrollRef = useRef<ScrollView | null>(null);
  const carRowYs = useRef<Record<string, number>>({});
  const focusHandled = useRef(false);

  // Car modal state
  const [carModalOpen, setCarModalOpen] = useState(false);
  const [editingCar, setEditingCar] = useState<Car | null>(null);
  const [plateNumber, setPlateNumber] = useState('');
  const [makeModel, setMakeModel] = useState('');
  const [carComment, setCarComment] = useState('');
  const [deleteCarId, setDeleteCarId] = useState<string | null>(null);
  // Notes editor (owner-only) state — local copy until "Сохранить".
  const [notesModalOpen, setNotesModalOpen] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  // Source picker visibility.
  const [sourceOpen, setSourceOpen] = useState(false);
  const [duplicateCar, setDuplicateCar] = useState<{
    id: string;
    plateNumber: string;
    makeModel: string;
    clientId: string | null;
    client: { id: string; fullName: string; phone: string } | null;
  } | null>(null);
  const [carSubmitting, setCarSubmitting] = useState(false);

  const { data: client, isLoading } = useQuery<Client>({
    queryKey: ['client', id],
    queryFn: async () => {
      const res = await clientsApi.getById(id);
      return res.data;
    },
    enabled: !isRetail,
  });

  // Fall back to legacy `client-checks` shape (flat list) when we use
  // it as the primary source for analytics + history rendering.
  const { data: checks } = useQuery<Check[]>({
    queryKey: isRetail ? ['retail-checks'] : ['client-checks', id],
    queryFn: async () => {
      const res = isRetail
        ? await checksApi.getAll({ retail: 'true', limit: 200 })
        : await checksApi.getAll({ clientId: id, limit: 200 });
      const raw = res.data as { data?: Check[] } | Check[];
      return Array.isArray(raw) ? raw : raw.data || [];
    },
  });

  // Per-car aggregation — pre-grouped by backend so we don't repeat
  // the work in JS. Used for the "Авто клиента" inline-expansion.
  const { data: checksByCar } = useQuery<PerCarChecks[]>({
    queryKey: ['client-checks-by-car', id],
    queryFn: async () => {
      const res = await clientsApi.checksByCar(id);
      return res.data;
    },
    enabled: !isRetail,
    staleTime: 60_000,
  });

  // ── Derived analytics (memoised) ──────────────────────────────────
  // Numbers we surface in the hero / analytics sections. Avoid
  // recomputing on every render so the rich detail screen feels
  // instant when the user scrolls or expands a section.
  const stats = useMemo(() => {
    const list = checks || [];
    const total = list.reduce((sum, c) => sum + (c.totalRevenue || 0), 0);
    const count = list.length;
    const avg = count > 0 ? total / count : 0;
    // Last visit date — checks come ordered DESC by date from
    // backend, but never trust ordering on the wire.
    let lastVisit: Date | null = null;
    for (const c of list) {
      const t = new Date(c.date);
      if (!lastVisit || t > lastVisit) lastVisit = t;
    }
    // Risk: more than 6 months without a visit, or never.
    const sixMo = 6 * 30 * 24 * 60 * 60 * 1000;
    const fourMo = 4 * 30 * 24 * 60 * 60 * 1000;
    const sinceLast = lastVisit ? Date.now() - lastVisit.getTime() : Infinity;
    const risk: 'lost' | 'fade' | 'ok' = sinceLast > sixMo ? 'lost' : sinceLast > fourMo ? 'fade' : 'ok';

    // Average interval between visits (used to estimate "следующий визит").
    const sortedDates = list
      .map((c) => new Date(c.date).getTime())
      .filter(Boolean)
      .sort((a, b) => a - b);
    let avgIntervalDays: number | null = null;
    if (sortedDates.length >= 2) {
      const span = sortedDates[sortedDates.length - 1] - sortedDates[0];
      avgIntervalDays = span / (sortedDates.length - 1) / (24 * 60 * 60 * 1000);
    }
    const nextVisitEta = lastVisit && avgIntervalDays
      ? new Date(lastVisit.getTime() + avgIntervalDays * 24 * 60 * 60 * 1000)
      : null;

    // Top services — name → total revenue, top 3.
    const svcMap = new Map<string, number>();
    for (const c of list) {
      for (const s of c.services || []) {
        if (!s.name) continue;
        svcMap.set(s.name, (svcMap.get(s.name) || 0) + (s.total || s.price * s.quantity || 0));
      }
    }
    const topServices = Array.from(svcMap.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    // Favourite master — name → count.
    const masterMap = new Map<string, { name: string; count: number }>();
    for (const c of list) {
      const name = c.master?.fullName;
      if (!name) continue;
      const cur = masterMap.get(name) ?? { name, count: 0 };
      cur.count += 1;
      masterMap.set(name, cur);
    }
    const favoriteMaster = Array.from(masterMap.values()).sort((a, b) => b.count - a.count)[0];

    // Monthly revenue for the last 12 months — used by sparkline.
    const months: number[] = Array(12).fill(0);
    const now = new Date();
    for (const c of list) {
      const d = new Date(c.date);
      const monthsAgo =
        (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
      if (monthsAgo >= 0 && monthsAgo < 12) {
        months[11 - monthsAgo] += c.totalRevenue || 0;
      }
    }

    return {
      total,
      count,
      avg,
      lastVisit,
      risk,
      avgIntervalDays,
      nextVisitEta,
      topServices,
      favoriteMaster,
      months,
    };
  }, [checks]);

  const filteredChecks = useMemo(() => {
    if (!checks) return [];
    if (!selectedCarId) return checks;
    return checks.filter((c) => c.car?.id === selectedCarId);
  }, [checks, selectedCarId]);

  const createCarMutation = useMutation({
    mutationFn: (d: any) => carsApi.create(d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client', id] });
      queryClient.invalidateQueries({ queryKey: ['client-checks-by-car', id] });
      closeCarModal();
    },
    onError: () => Alert.alert('Ошибка', 'Ошибка при создании авто'),
  });

  const updateCarMutation = useMutation({
    mutationFn: ({ carId, data }: { carId: string; data: any }) => carsApi.update(carId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client', id] });
      closeCarModal();
    },
    onError: () => Alert.alert('Ошибка', 'Ошибка при обновлении авто'),
  });

  const deleteCarMutation = useMutation({
    mutationFn: (carId: string) => carsApi.remove(carId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['client', id] }),
    onError: () => Alert.alert('Ошибка', 'Ошибка при удалении авто'),
  });

  // Notes save — owner-only. Fires the dedicated endpoint so we don't
  // pay the cost of revalidating other fields on the server.
  const notesMutation = useMutation({
    mutationFn: (notes: string | null) => clientsApi.updateNotes(id, notes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client', id] });
      setNotesModalOpen(false);
      haptic('success');
    },
    onError: () => Alert.alert('Ошибка', 'Не удалось сохранить заметки'),
  });

  const sourceMutation = useMutation({
    mutationFn: (source: string | null) => clientsApi.updateSource(id, source),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client', id] });
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      haptic('success');
    },
    onError: () => Alert.alert('Ошибка', 'Не удалось сохранить источник'),
  });

  const closeCarModal = () => {
    setCarModalOpen(false);
    setEditingCar(null);
  };

  const openAddCar = () => {
    setEditingCar(null);
    setPlateNumber('');
    setMakeModel('');
    setCarComment('');
    setCarModalOpen(true);
  };

  const openEditCar = (car: Car) => {
    setEditingCar(car);
    setPlateNumber(car.plateNumber);
    setMakeModel(car.makeModel);
    setCarComment(car.comment || '');
    setCarModalOpen(true);
  };

  const handleCarSubmit = async () => {
    const payload = { plateNumber, makeModel, comment: carComment || undefined, clientId: id };
    if (editingCar) {
      updateCarMutation.mutate({ carId: editingCar.id, data: payload });
      return;
    }
    setCarSubmitting(true);
    try {
      const res = await carsApi.lookupByPlate(plateNumber);
      const existing = res.data;
      if (existing) {
        setDuplicateCar(existing);
        return;
      }
      createCarMutation.mutate(payload);
    } catch {
      createCarMutation.mutate(payload);
    } finally {
      setCarSubmitting(false);
    }
  };

  const handleCreateCarAnyway = () => {
    setDuplicateCar(null);
    createCarMutation.mutate({ plateNumber, makeModel, comment: carComment || undefined, clientId: id });
  };

  const handleOpenExistingCar = () => {
    if (!duplicateCar) return;
    const ownerId = duplicateCar.clientId;
    setDuplicateCar(null);
    setCarModalOpen(false);
    if (ownerId && ownerId !== id) {
      (navigation as any).navigate('ClientDetail', { id: ownerId });
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['client', id] });
    await queryClient.invalidateQueries({ queryKey: ['client-checks', id] });
    await queryClient.invalidateQueries({ queryKey: ['client-checks-by-car', id] });
    setRefreshing(false);
  };

  // Sync notes draft when the underlying client loads so opening the
  // editor for the first time shows the saved value, not the empty
  // string we initialised with.
  useEffect(() => {
    if (client?.ownerNotes) setNotesDraft(client.ownerNotes);
    else setNotesDraft('');
  }, [client?.ownerNotes]);

  // Auto-expand + scroll to the focused car when arriving from the
  // Авто tab of ClientsScreen. We wait for both the client (so the
  // car exists in client.cars) AND the per-car checks (so the inline
  // panel renders correctly when expanded). Layout-measured Y is the
  // single source of truth — RN doesn't expose a "scroll to mounted
  // child" primitive, so we collect Y per row in onLayout, then jump.
  useEffect(() => {
    if (!focusCarId || focusHandled.current) return;
    if (!client) return;
    const car = (client.cars || []).find((c) => c.id === focusCarId);
    if (!car) return;
    setSelectedCarId(focusCarId);
    // Defer the actual scroll until the next frame so onLayout has
    // populated carRowYs for the (now visible) car row. Two frames
    // is enough on iOS to absorb both the state update and the
    // expansion layout pass.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const y = carRowYs.current[focusCarId];
        if (typeof y === 'number' && scrollRef.current) {
          scrollRef.current.scrollTo({ y: Math.max(0, y - 12), animated: true });
          focusHandled.current = true;
        }
      });
    });
  }, [focusCarId, client, checksByCar]);

  // ── RETAIL BUYER VIEW (virtual) ────────────────────────────────────
  if (isRetail) {
    const retailTotal = (checks || []).reduce((sum, c) => sum + (c.totalRevenue || 0), 0);
    const retailGrouped: { label: string; checks: Check[] }[] = [];
    let retailLast = '';
    for (const check of checks || []) {
      const group = formatDateGroup(check.date);
      if (group !== retailLast) {
        retailGrouped.push({ label: group, checks: [check] });
        retailLast = group;
      } else {
        retailGrouped[retailGrouped.length - 1].checks.push(check);
      }
    }
    return (
      <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
        <IosScreenHeader title="Розничный покупатель" onBack={() => navigation.goBack()} centerTitle />
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await queryClient.invalidateQueries({ queryKey: ['retail-checks'] });
                setRefreshing(false);
              }}
              tintColor={colors.primary[600]}
            />
          }
        >
          <LinearGradient
            colors={[colors.primary[500], colors.primary[700]]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.retailHero}
          >
            <View style={styles.retailHeroIcon}>
              <Ionicons name="cart-outline" size={28} color={colors.white} />
            </View>
            <Text style={styles.retailHeroTitle}>Розничный покупатель</Text>
            <Text style={styles.retailHeroSub}>Все чеки без клиента</Text>
            <View style={styles.retailStatsRow}>
              <View style={styles.retailStatItem}>
                <Text style={styles.retailStatValue}>{checks?.length || 0}</Text>
                <Text style={styles.retailStatLabel}>чеков</Text>
              </View>
              <View style={styles.retailStatDivider} />
              <View style={styles.retailStatItem}>
                <Text style={styles.retailStatValue}>{formatMoney(retailTotal)}</Text>
                <Text style={styles.retailStatLabel}>выручка</Text>
              </View>
            </View>
          </LinearGradient>

          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: palette.text.primary }]}>Чеки ({checks?.length || 0})</Text>
          </View>

          {!checks || checks.length === 0 ? (
            <View style={styles.emptyChecks}>
              <Ionicons name="receipt-outline" size={32} color={palette.text.tertiary} />
              <Text style={[styles.emptyChecksText, { color: palette.text.tertiary }]}>Нет чеков</Text>
            </View>
          ) : (
            retailGrouped.map((group, gi) => (
              <View key={group.label + gi}>
                <View style={styles.dateGroupHeader}>
                  <View style={[styles.dateGroupLine, { backgroundColor: palette.border.subtle }]} />
                  <Text style={[styles.dateGroupText, { color: palette.text.tertiary }]}>{group.label}</Text>
                  <View style={[styles.dateGroupLine, { backgroundColor: palette.border.subtle }]} />
                </View>
                {group.checks.map((check) => (
                  <CheckRow
                    key={check.id}
                    check={check}
                    palette={palette}
                    canViewProfit={canViewProfit}
                    onPress={() =>
                      navigation.navigate('Main', {
                        screen: 'Checks',
                        params: { screen: 'CheckDetail', params: { id: check.id } },
                      })
                    }
                  />
                ))}
              </View>
            ))
          )}
        </ScrollView>
      </View>
    );
  }

  if (isLoading) return <LoadingSpinner />;
  if (!client)
    return <Text style={{ padding: 20, textAlign: 'center', color: palette.text.secondary }}>Клиент не найден</Text>;

  // Group filtered checks by date for the history section.
  const groupedChecks: { label: string; checks: Check[] }[] = [];
  let lastGroup = '';
  for (const check of filteredChecks) {
    const group = formatDateGroup(check.date);
    if (group !== lastGroup) {
      groupedChecks.push({ label: group, checks: [check] });
      lastGroup = group;
    } else {
      groupedChecks[groupedChecks.length - 1].checks.push(check);
    }
  }

  const initials = getInitials(client.fullName);
  const avatarColor = getAvatarColor(client.fullName);
  const cars = client.cars || [];

  return (
    <View style={[styles.safe, { backgroundColor: palette.bg.canvas }]}>
      <IosScreenHeader title={client.fullName} onBack={() => navigation.goBack()} centerTitle />

      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />}
      >
        {/* HERO — avatar, source badge, first-visit date + 3 stat tiles. */}
        <AnimatedCard
          style={[styles.heroCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
          index={0}
        >
          <View style={styles.heroTop}>
            <View style={[styles.avatar, { backgroundColor: avatarColor }]}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
            <View style={styles.heroInfo}>
              <Text style={[styles.clientName, { color: palette.text.primary }]} numberOfLines={1}>
                {client.fullName}
              </Text>
              <View style={styles.heroBadgesRow}>
                {client.source ? (
                  <TouchableOpacity
                    onPress={() => canEditMeta && setSourceOpen(true)}
                    activeOpacity={canEditMeta ? 0.7 : 1}
                    style={[styles.sourceBadge, { backgroundColor: palette.accent.primarySoft }]}
                  >
                    <Ionicons name="pricetag" size={11} color={palette.accent.primaryText} />
                    <Text style={[styles.sourceBadgeText, { color: palette.accent.primaryText }]}>
                      {client.source}
                    </Text>
                  </TouchableOpacity>
                ) : canEditMeta ? (
                  <TouchableOpacity
                    onPress={() => setSourceOpen(true)}
                    activeOpacity={0.7}
                    style={[styles.sourceBadgeEmpty, { borderColor: palette.border.strong }]}
                  >
                    <Ionicons name="add" size={12} color={palette.text.tertiary} />
                    <Text style={[styles.sourceBadgeEmptyText, { color: palette.text.tertiary }]}>
                      Источник
                    </Text>
                  </TouchableOpacity>
                ) : null}
                <Text style={[styles.heroDate, { color: palette.text.tertiary }]}>
                  Клиент с {formatDate(client.createdAt)}
                </Text>
              </View>
            </View>
          </View>

          <View style={[styles.statTilesRow]}>
            <StatTile label="Чеков" value={String(stats.count)} palette={palette} />
            <StatTile label="LTV" value={formatMoney(stats.total)} palette={palette} />
            <StatTile
              label="Средний"
              value={stats.count > 0 ? formatMoney(stats.avg) : '—'}
              palette={palette}
            />
          </View>
        </AnimatedCard>

        {/* QUICK ACTIONS — call / WhatsApp / SMS / history */}
        <View style={styles.quickActionsRow}>
          <QuickAction
            icon="call-outline"
            label="Позвонить"
            color={colors.green[600]}
            disabled={!client.phone}
            onPress={() => {
              haptic('tap');
              Linking.openURL(telHref(client.phone)).catch(() => Alert.alert('Не удалось открыть телефон'));
            }}
            palette={palette}
          />
          <QuickAction
            icon="logo-whatsapp"
            label="WhatsApp"
            color="#25D366"
            disabled={!client.phone}
            onPress={() => {
              haptic('tap');
              Linking.openURL(whatsappHref(client.phone)).catch(() =>
                Alert.alert('WhatsApp не установлен'),
              );
            }}
            palette={palette}
          />
          <QuickAction
            icon="chatbox-outline"
            label="SMS"
            color={colors.blue[600]}
            disabled={!client.phone}
            onPress={() => {
              haptic('tap');
              Linking.openURL(smsHref(client.phone)).catch(() => Alert.alert('Не удалось открыть SMS'));
            }}
            palette={palette}
          />
          <QuickAction
            icon="time-outline"
            label="История"
            color={colors.purple[700]}
            onPress={() => {
              haptic('tap');
              setSelectedCarId(null);
            }}
            palette={palette}
          />
        </View>

        {/* OWNER-ONLY: notes + source */}
        {canEditMeta && (
          <AnimatedCard
            style={[styles.metaCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
            index={1}
          >
            <View style={styles.metaHeader}>
              <Ionicons name="lock-closed-outline" size={14} color={palette.text.tertiary} />
              <Text style={[styles.metaHeaderText, { color: palette.text.tertiary }]}>Только для владельца</Text>
            </View>
            <TouchableOpacity
              style={[styles.metaRow, { borderBottomColor: palette.border.subtle }]}
              activeOpacity={0.7}
              onPress={() => setNotesModalOpen(true)}
            >
              <Ionicons name="document-text-outline" size={16} color={palette.text.tertiary} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.metaLabel, { color: palette.text.secondary }]}>Заметки владельца</Text>
                <Text
                  style={[styles.metaValue, { color: palette.text.primary }]}
                  numberOfLines={2}
                >
                  {client.ownerNotes || 'Нажмите, чтобы добавить'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={14} color={palette.text.tertiary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.metaRow, { borderBottomWidth: 0 }]}
              activeOpacity={0.7}
              onPress={() => setSourceOpen(true)}
            >
              <Ionicons name="pricetag-outline" size={16} color={palette.text.tertiary} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.metaLabel, { color: palette.text.secondary }]}>Источник</Text>
                <Text style={[styles.metaValue, { color: palette.text.primary }]}>
                  {client.source || 'Не указан'}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={14} color={palette.text.tertiary} />
            </TouchableOpacity>
          </AnimatedCard>
        )}

        {/* INFO ROW — phone + comment */}
        <AnimatedCard
          style={[styles.infoCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
          index={2}
        >
          <View style={[styles.infoRow, { borderBottomColor: palette.border.subtle }]}>
            <Ionicons name="call-outline" size={15} color={palette.text.tertiary} />
            <Text style={[styles.infoLabel, { color: palette.text.secondary }]}>Телефон</Text>
            <Text style={[styles.infoValue, { color: palette.text.primary }]}>{formatPhone(client.phone)}</Text>
          </View>
          {client.comment ? (
            <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
              <Ionicons name="chatbubble-outline" size={15} color={palette.text.tertiary} />
              <Text style={[styles.infoLabel, { color: palette.text.secondary }]}>Комментарий</Text>
              <Text style={[styles.infoValue, { color: palette.text.primary }]}>{client.comment}</Text>
            </View>
          ) : null}
        </AnimatedCard>

        {/* CARS — expandable rows showing inline checks per car */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: palette.text.primary }]}>Автомобили ({cars.length})</Text>
          <TouchableOpacity style={[styles.smallBtn, { backgroundColor: palette.accent.primary }]} onPress={openAddCar}>
            <Text style={styles.smallBtnText}>+ Добавить</Text>
          </TouchableOpacity>
        </View>

        {cars.length === 0 ? (
          <View style={[styles.emptyCars, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
            <Ionicons name="car-sport-outline" size={24} color={palette.text.tertiary} />
            <Text style={[styles.emptyCarsText, { color: palette.text.secondary }]}>
              У клиента ещё нет автомобилей
            </Text>
          </View>
        ) : (
          cars.map((car, idx) => (
            <View
              key={car.id}
              onLayout={(e) => {
                carRowYs.current[car.id] = e.nativeEvent.layout.y;
              }}
            >
              <CarRow
                car={car}
                palette={palette}
                index={idx}
                checks={(checksByCar || []).find((g) => g.carId === car.id)?.checks || []}
                expanded={selectedCarId === car.id}
                onToggle={() => {
                  haptic('select');
                  setSelectedCarId((prev) => (prev === car.id ? null : car.id));
                }}
                onEdit={() => openEditCar(car)}
                onDelete={() => setDeleteCarId(car.id)}
                canEdit={canEditMeta}
                onOpenCheck={(checkId) =>
                  navigation.navigate('Main', {
                    screen: 'Checks',
                    params: { screen: 'CheckDetail', params: { id: checkId } },
                  })
                }
              />
            </View>
          ))
        )}

        {/* ANALYTICS — sparkline + insights */}
        {stats.count > 0 && (
          <AnimatedCard
            style={[styles.analyticsCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
            index={3}
          >
            <View style={styles.analyticsHeader}>
              <Text style={[styles.sectionTitle, { color: palette.text.primary }]}>Аналитика</Text>
              <View
                style={[
                  styles.riskBadge,
                  {
                    backgroundColor:
                      stats.risk === 'lost'
                        ? colors.red[50]
                        : stats.risk === 'fade'
                          ? colors.amber[50]
                          : colors.green[50],
                  },
                ]}
              >
                <Ionicons
                  name={stats.risk === 'ok' ? 'checkmark-circle' : 'alert-circle'}
                  size={12}
                  color={
                    stats.risk === 'lost'
                      ? colors.red[600]
                      : stats.risk === 'fade'
                        ? colors.amber[600]
                        : colors.green[600]
                  }
                />
                <Text
                  style={[
                    styles.riskBadgeText,
                    {
                      color:
                        stats.risk === 'lost'
                          ? colors.red[700]
                          : stats.risk === 'fade'
                            ? colors.amber[700]
                            : colors.green[700],
                    },
                  ]}
                >
                  {stats.risk === 'lost'
                    ? 'Не был более 6 мес'
                    : stats.risk === 'fade'
                      ? 'Не был 4+ мес'
                      : 'Активный'}
                </Text>
              </View>
            </View>

            <Text style={[styles.analyticsCaption, { color: palette.text.tertiary }]}>
              Выручка по месяцам (12 мес)
            </Text>
            <MonthlySparkline months={stats.months} color={palette.accent.primary} />

            <View style={styles.analyticsRow}>
              <View style={{ flex: 1 }}>
                <Text style={[styles.analyticsLabel, { color: palette.text.tertiary }]}>Последний визит</Text>
                <Text style={[styles.analyticsValue, { color: palette.text.primary }]}>
                  {stats.lastVisit ? formatDate(stats.lastVisit.toISOString()) : '—'}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.analyticsLabel, { color: palette.text.tertiary }]}>Следующий визит (≈)</Text>
                <Text style={[styles.analyticsValue, { color: palette.text.primary }]}>
                  {stats.nextVisitEta ? formatDate(stats.nextVisitEta.toISOString()) : '—'}
                </Text>
              </View>
            </View>

            {stats.topServices.length > 0 && (
              <View style={styles.analyticsBlock}>
                <Text style={[styles.analyticsLabel, { color: palette.text.tertiary }]}>Что заказывает чаще всего</Text>
                {stats.topServices.map(([name, revenue]) => (
                  <View key={name} style={[styles.serviceRow, { borderBottomColor: palette.border.subtle }]}>
                    <Text style={[styles.serviceName, { color: palette.text.primary }]} numberOfLines={1}>
                      {name}
                    </Text>
                    <Text style={[styles.serviceRevenue, { color: palette.text.secondary }]}>
                      {formatMoney(revenue)}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            {stats.favoriteMaster && (
              <View style={styles.analyticsBlock}>
                <Text style={[styles.analyticsLabel, { color: palette.text.tertiary }]}>Любимый мастер</Text>
                <View style={styles.favMasterRow}>
                  <Ionicons name="person-circle-outline" size={18} color={palette.text.secondary} />
                  <Text style={[styles.analyticsValue, { color: palette.text.primary }]}>
                    {stats.favoriteMaster.name}
                  </Text>
                  <Text style={[styles.analyticsLabel, { color: palette.text.tertiary }]}>
                    {stats.favoriteMaster.count} раз
                  </Text>
                </View>
              </View>
            )}
          </AnimatedCard>
        )}

        {/* HISTORY — toggle (all / per-car) then a grouped list */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionTitle, { color: palette.text.primary }]}>
            История чеков ({filteredChecks.length})
          </Text>
        </View>

        {cars.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.carChipsScroll}>
            <View style={styles.carChipsRow}>
              <TouchableOpacity
                style={[
                  styles.carChip,
                  { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
                  !selectedCarId && styles.carChipActive,
                ]}
                onPress={() => setSelectedCarId(null)}
              >
                <Text
                  style={[
                    styles.carChipText,
                    { color: palette.text.secondary },
                    !selectedCarId && styles.carChipTextActive,
                  ]}
                >
                  Все авто
                </Text>
              </TouchableOpacity>
              {cars.map((car) => (
                <TouchableOpacity
                  key={car.id}
                  style={[
                    styles.carChip,
                    { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
                    selectedCarId === car.id && styles.carChipActive,
                  ]}
                  onPress={() => setSelectedCarId(selectedCarId === car.id ? null : car.id)}
                >
                  <Text
                    style={[
                      styles.carChipText,
                      { color: palette.text.secondary },
                      selectedCarId === car.id && styles.carChipTextActive,
                    ]}
                    numberOfLines={1}
                  >
                    {car.makeModel} · {car.plateNumber}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        )}

        {filteredChecks.length === 0 ? (
          <View style={styles.emptyChecks}>
            <Ionicons name="receipt-outline" size={32} color={palette.text.tertiary} />
            <Text style={[styles.emptyChecksText, { color: palette.text.tertiary }]}>Нет чеков</Text>
          </View>
        ) : (
          groupedChecks.map((group, gi) => (
            <View key={group.label + gi}>
              <View style={styles.dateGroupHeader}>
                <View style={[styles.dateGroupLine, { backgroundColor: palette.border.subtle }]} />
                <Text style={[styles.dateGroupText, { color: palette.text.tertiary }]}>{group.label}</Text>
                <View style={[styles.dateGroupLine, { backgroundColor: palette.border.subtle }]} />
              </View>
              {group.checks.map((check) => (
                <CheckRow
                  key={check.id}
                  check={check}
                  palette={palette}
                  canViewProfit={canViewProfit}
                  onPress={() =>
                    navigation.navigate('Main', {
                      screen: 'Checks',
                      params: { screen: 'CheckDetail', params: { id: check.id } },
                    })
                  }
                />
              ))}
            </View>
          ))
        )}
      </ScrollView>

      {/* Car Modal */}
      <Modal visible={carModalOpen} onClose={closeCarModal} title={editingCar ? 'Редактировать авто' : 'Добавить авто'}>
        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Гос. номер</Text>
          <TextInput
            value={plateNumber}
            onChangeText={(t) => setPlateNumber(processPlateMainInput(t.replace(/\s/g, '')))}
            style={[
              styles.formInput,
              { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
            ]}
            placeholder="А000АА"
            autoCapitalize="characters"
            placeholderTextColor={palette.text.tertiary}
          />
        </View>
        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Марка и модель</Text>
          <TextInput
            value={makeModel}
            onChangeText={setMakeModel}
            style={[
              styles.formInput,
              { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle, color: palette.text.primary },
            ]}
            placeholder="Toyota Camry"
            placeholderTextColor={palette.text.tertiary}
          />
        </View>
        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Комментарий</Text>
          <TextInput
            value={carComment}
            onChangeText={setCarComment}
            style={[
              styles.formInput,
              {
                height: 80,
                textAlignVertical: 'top',
                backgroundColor: palette.bg.muted,
                borderColor: palette.border.subtle,
                color: palette.text.primary,
              },
            ]}
            multiline
            placeholder="Необязательно"
            placeholderTextColor={palette.text.tertiary}
          />
        </View>
        <View style={[styles.formActions, { borderTopColor: palette.border.subtle }]}>
          <TouchableOpacity style={[styles.cancelBtn, { borderColor: palette.border.strong }]} onPress={closeCarModal}>
            <Text style={[styles.cancelBtnText, { color: palette.text.secondary }]}>Отмена</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.submitBtn, { backgroundColor: palette.accent.primary }]}
            onPress={handleCarSubmit}
            disabled={carSubmitting || createCarMutation.isPending || updateCarMutation.isPending}
          >
            {carSubmitting || createCarMutation.isPending || updateCarMutation.isPending ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={styles.submitBtnText}>{editingCar ? 'Сохранить' : 'Добавить'}</Text>
            )}
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Notes editor — owner only. */}
      <Modal visible={notesModalOpen} onClose={() => setNotesModalOpen(false)} title="Заметки владельца">
        <View style={styles.formField}>
          <Text style={[styles.formLabel, { color: palette.text.secondary }]}>
            Внутренние заметки (видны только владельцу)
          </Text>
          <TextInput
            value={notesDraft}
            onChangeText={setNotesDraft}
            style={[
              styles.formInput,
              {
                height: 140,
                textAlignVertical: 'top',
                backgroundColor: palette.bg.muted,
                borderColor: palette.border.subtle,
                color: palette.text.primary,
              },
            ]}
            multiline
            maxLength={4000}
            placeholder="Например: предпочитает Mobil 1, обычно платит картой..."
            placeholderTextColor={palette.text.tertiary}
          />
          <Text style={[styles.helperText, { color: palette.text.tertiary }]}>
            {notesDraft.length}/4000
          </Text>
        </View>
        <View style={[styles.formActions, { borderTopColor: palette.border.subtle }]}>
          <TouchableOpacity
            style={[styles.cancelBtn, { borderColor: palette.border.strong }]}
            onPress={() => setNotesModalOpen(false)}
            disabled={notesMutation.isPending}
          >
            <Text style={[styles.cancelBtnText, { color: palette.text.secondary }]}>Отмена</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.submitBtn, { backgroundColor: palette.accent.primary }]}
            onPress={() => notesMutation.mutate(notesDraft.trim() ? notesDraft.trim() : null)}
            disabled={notesMutation.isPending}
          >
            {notesMutation.isPending ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={styles.submitBtnText}>Сохранить</Text>
            )}
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Source picker */}
      <SourcePickerSheet
        visible={sourceOpen}
        onClose={() => setSourceOpen(false)}
        selected={client.source ?? null}
        onPick={(value) => sourceMutation.mutate(value)}
        title="Источник клиента"
      />

      <ConfirmDialog
        visible={!!deleteCarId}
        onClose={() => setDeleteCarId(null)}
        onConfirm={() => {
          if (deleteCarId) deleteCarMutation.mutate(deleteCarId);
          setDeleteCarId(null);
        }}
        title="Удалить авто"
        message="Вы уверены?"
        confirmText="Удалить"
        variant="danger"
      />

      <DuplicateWarningDialog
        visible={!!duplicateCar}
        onClose={() => setDuplicateCar(null)}
        onCreateAnyway={handleCreateCarAnyway}
        onOpenExisting={handleOpenExistingCar}
        title="Такой автомобиль уже есть"
        description={
          duplicateCar?.clientId === id
            ? `Госномер ${duplicateCar?.plateNumber} уже привязан к этому клиенту. Создать дубликат?`
            : `Госномер ${duplicateCar?.plateNumber || plateNumber} уже привязан к другому клиенту.`
        }
        existingLabel={duplicateCar?.makeModel || ''}
        existingSubtitle={duplicateCar?.client ? `Клиент: ${duplicateCar.client.fullName}` : duplicateCar?.plateNumber}
        openExistingLabel={duplicateCar?.clientId === id ? 'Закрыть' : 'Открыть владельца'}
      />
    </View>
  );
}

// ── Sub-components ────────────────────────────────────────────────────

interface StatTileProps {
  label: string;
  value: string;
  palette: ReturnType<typeof useColors>;
}
function StatTile({ label, value, palette }: StatTileProps) {
  return (
    <View style={[styles.statTile, { backgroundColor: palette.bg.muted }]}>
      <Text style={[styles.statTileValue, { color: palette.text.primary }]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={[styles.statTileLabel, { color: palette.text.tertiary }]}>{label}</Text>
    </View>
  );
}

interface QuickActionProps {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  disabled?: boolean;
  onPress: () => void;
  palette: ReturnType<typeof useColors>;
}
function QuickAction({ icon, label, color, disabled, onPress, palette }: QuickActionProps) {
  return (
    <TouchableOpacity
      style={[styles.quickAction, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
      onPress={onPress}
      activeOpacity={0.7}
      disabled={disabled}
    >
      <View
        style={[
          styles.quickActionIcon,
          { backgroundColor: disabled ? palette.bg.muted : color + '18' },
        ]}
      >
        <Ionicons name={icon} size={18} color={disabled ? palette.text.tertiary : color} />
      </View>
      <Text
        style={[
          styles.quickActionLabel,
          { color: disabled ? palette.text.tertiary : palette.text.primary },
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

interface CarRowProps {
  car: Car;
  palette: ReturnType<typeof useColors>;
  index: number;
  checks: PerCarChecks['checks'];
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  canEdit: boolean;
  onOpenCheck: (checkId: string) => void;
}
function CarRow({ car, palette, index, checks, expanded, onToggle, onEdit, onDelete, canEdit, onOpenCheck }: CarRowProps) {
  const carColor = getCarColor(car.id);
  return (
    <AnimatedCard
      style={[styles.carCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
      index={index + 1}
    >
      <TouchableOpacity onPress={onToggle} activeOpacity={0.7} style={styles.carTop}>
        <View style={styles.carInfo}>
          <View style={[styles.carIconWrap, { backgroundColor: carColor + '18' }]}>
            <Ionicons name="car-sport" size={16} color={carColor} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.carModel, { color: palette.text.primary }]} numberOfLines={1}>
              {car.makeModel || '—'}
            </Text>
            <View style={[styles.plateBadgeRow, { backgroundColor: palette.bg.muted }]}>
              <Text style={[styles.plateBadgeText, { color: palette.text.primary }]}>{car.plateNumber}</Text>
            </View>
          </View>
        </View>
        <View style={styles.carActions}>
          {canEdit ? (
            <>
              <TouchableOpacity onPress={onEdit} style={styles.iconBtn} hitSlop={8}>
                <Ionicons name="create-outline" size={15} color={palette.text.tertiary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={onDelete} style={styles.iconBtn} hitSlop={8}>
                <Ionicons name="trash-outline" size={15} color={colors.red[400]} />
              </TouchableOpacity>
            </>
          ) : null}
          <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={palette.text.tertiary} />
        </View>
      </TouchableOpacity>
      {car.comment ? (
        <Text style={[styles.carComment, { color: palette.text.tertiary }]}>{car.comment}</Text>
      ) : null}
      {expanded && (
        <View style={[styles.carInlineChecks, { borderTopColor: palette.border.subtle }]}>
          {checks.length === 0 ? (
            <Text style={[styles.carInlineEmpty, { color: palette.text.tertiary }]}>Нет чеков для этого авто</Text>
          ) : (
            <>
              {checks.slice(0, 5).map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.carCheckLine, { borderBottomColor: palette.border.subtle }]}
                  activeOpacity={0.7}
                  onPress={() => onOpenCheck(c.id)}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.carCheckTop, { color: palette.text.primary }]} numberOfLines={1}>
                      #{c.number} · {formatDate(c.date)}
                    </Text>
                    <Text style={[styles.carCheckSub, { color: palette.text.secondary }]} numberOfLines={1}>
                      {c.masterName || 'Без мастера'}
                    </Text>
                  </View>
                  <Text style={[styles.carCheckAmount, { color: palette.text.primary }]}>
                    {formatMoney(c.totalRevenue)}
                  </Text>
                </TouchableOpacity>
              ))}
              {checks.length > 5 ? (
                <Text style={[styles.carInlineMore, { color: palette.text.tertiary }]}>
                  Ещё {checks.length - 5} чек(ов) ниже в полной истории
                </Text>
              ) : null}
            </>
          )}
        </View>
      )}
    </AnimatedCard>
  );
}

interface CheckRowProps {
  check: Check;
  palette: ReturnType<typeof useColors>;
  canViewProfit: boolean;
  onPress: () => void;
}
function CheckRow({ check, palette, canViewProfit, onPress }: CheckRowProps) {
  const badgeKey = paymentMethodBadgeColor[check.paymentMethod] || 'gray';
  const badge = badgeColors[badgeKey];
  return (
    <TouchableOpacity
      style={[
        styles.checkCard,
        { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
        check.isDeferred && styles.checkCardDeferred,
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View
        style={[
          styles.accentBar,
          check.isDeferred ? { backgroundColor: colors.red[400] } : { backgroundColor: colors.primary[400] },
        ]}
      />
      <View style={styles.checkContent}>
        <View style={styles.checkHeader}>
          <View style={styles.checkHeaderLeft}>
            <Text style={[styles.checkNumber, { color: palette.text.primary }]}>#{check.number}</Text>
            {check.isDeferred && (
              <View style={styles.deferredBadge}>
                <Text style={styles.deferredText}>Отложен</Text>
              </View>
            )}
            <View style={[styles.paymentBadge, { backgroundColor: badge.bg }]}>
              <Text style={[styles.paymentBadgeText, { color: badge.text }]}>
                {paymentLabels[check.paymentMethod] ?? check.paymentMethod}
              </Text>
            </View>
          </View>
          <Text style={[styles.checkTotal, { color: palette.text.primary }]}>{formatMoney(check.totalRevenue)}</Text>
        </View>
        {check.car && (
          <View style={styles.checkInfoRow}>
            <View style={styles.infoChip}>
              <Ionicons name="car-outline" size={11} color={palette.text.tertiary} />
              <Text style={[styles.infoChipText, { color: palette.text.secondary }]} numberOfLines={1}>
                {check.car.makeModel}
              </Text>
              {check.car.plateNumber ? <Text style={styles.plateTag}>{check.car.plateNumber}</Text> : null}
            </View>
          </View>
        )}
        {check.comment ? (
          <Text style={styles.commentText} numberOfLines={1}>
            {check.comment}
          </Text>
        ) : null}
        <View style={styles.checkFooter}>
          <Text style={[styles.footerTime, { color: palette.text.tertiary }]}>
            {new Date(check.date).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
          </Text>
          {check.master ? (
            <Text style={[styles.footerMaster, { color: palette.text.tertiary }]}>{check.master.fullName}</Text>
          ) : null}
          {canViewProfit && check.profit !== undefined ? (
            <Text
              style={[styles.footerProfit, check.profit >= 0 ? styles.profitPositive : styles.profitNegative]}
            >
              {check.profit >= 0 ? '+' : ''}
              {formatMoney(check.profit)}
            </Text>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[8] },

  // Retail hero — gradient card on the virtual retail screen.
  retailHero: {
    borderRadius: borderRadius['2xl'],
    paddingVertical: spacing[5],
    paddingHorizontal: spacing[5],
    alignItems: 'center',
    gap: spacing[2],
    shadowColor: colors.primary[700],
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  retailHeroIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing[2],
  },
  retailHeroTitle: { color: colors.white, fontSize: 18, fontWeight: '700' },
  retailHeroSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginBottom: spacing[2] },
  retailStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[2.5],
  },
  retailStatItem: { flex: 1, alignItems: 'center' },
  retailStatDivider: { width: 1, height: 28, backgroundColor: 'rgba(255,255,255,0.24)' },
  retailStatValue: { color: colors.white, fontSize: 14, fontWeight: '700' },
  retailStatLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 11, marginTop: 2 },

  // Hero
  heroCard: {
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
    gap: spacing[3],
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  heroInfo: { flex: 1, minWidth: 0 },
  heroBadgesRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap' },
  heroDate: { fontSize: 11 },
  sourceBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  sourceBadgeText: { fontSize: 11, fontWeight: '600' },
  sourceBadgeEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderStyle: 'dashed',
  },
  sourceBadgeEmptyText: { fontSize: 10, fontWeight: '500' },

  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 18, fontWeight: '700', color: colors.white },
  clientName: { fontSize: 17, fontWeight: '700', letterSpacing: -0.3, color: colors.gray[900] },

  // Stat tiles row
  statTilesRow: { flexDirection: 'row', gap: spacing[2] },
  statTile: {
    flex: 1,
    paddingHorizontal: spacing[2.5],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    gap: 2,
  },
  statTileValue: { fontSize: 14, fontWeight: '700', letterSpacing: -0.2 },
  statTileLabel: { fontSize: 11 },

  // Quick action row
  quickActionsRow: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  quickAction: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[1],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    gap: 6,
    ...Platform.select({
      ios: { shadowColor: colors.black, shadowOpacity: 0.04, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
      android: { elevation: 1 },
    }),
  },
  quickActionIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickActionLabel: { fontSize: 11, fontWeight: '600' },

  // Meta (owner-only)
  metaCard: {
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    gap: spacing[2],
  },
  metaHeader: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaHeaderText: { fontSize: 11, fontWeight: '600', letterSpacing: 0.2, textTransform: 'uppercase' },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[2.5],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  metaLabel: { fontSize: 11, fontWeight: '600' },
  metaValue: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, marginTop: 2 },

  // Info card
  infoCard: {
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[2.5],
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[100],
  },
  infoLabel: { fontSize: fontSize.sm, color: colors.gray[500] },
  infoValue: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.medium,
    color: colors.gray[900],
    flex: 1,
    textAlign: 'right',
  },

  // Section
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing[2] },
  sectionTitle: { fontSize: fontSize.base, fontWeight: fontWeight.bold, color: colors.gray[900] },
  smallBtn: {
    backgroundColor: colors.primary[600],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
    borderRadius: borderRadius.lg,
  },
  smallBtnText: { color: colors.white, fontSize: fontSize.xs, fontWeight: fontWeight.semibold },

  // Empty cars
  emptyCars: {
    alignItems: 'center',
    paddingVertical: spacing[5],
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    gap: spacing[2],
  },
  emptyCarsText: { fontSize: fontSize.sm },

  // Car cards
  carCard: {
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.gray[100],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2.5],
    marginTop: spacing[2],
  },
  carTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  carInfo: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], flex: 1 },
  carIconWrap: { width: 32, height: 32, borderRadius: borderRadius.lg, alignItems: 'center', justifyContent: 'center' },
  carModel: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  plateBadgeRow: {
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    backgroundColor: colors.gray[100],
    marginTop: 3,
  },
  plateBadgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  carActions: { flexDirection: 'row', alignItems: 'center', gap: spacing[0.5] },
  iconBtn: { padding: spacing[1.5], borderRadius: borderRadius.md },
  carComment: { fontSize: fontSize.xs, color: colors.gray[400], marginTop: spacing[1.5], marginLeft: spacing[10] },

  // Inline checks inside a car row
  carInlineChecks: {
    marginTop: spacing[2],
    paddingTop: spacing[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing[1],
  },
  carInlineEmpty: { fontSize: 12, paddingVertical: spacing[2] },
  carInlineMore: { fontSize: 11, marginTop: spacing[1] },
  carCheckLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  carCheckTop: { fontSize: 13, fontWeight: '600' },
  carCheckSub: { fontSize: 11, marginTop: 2 },
  carCheckAmount: { fontSize: 13, fontWeight: '700' },

  // Analytics
  analyticsCard: {
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
    gap: spacing[3],
  },
  analyticsHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  analyticsCaption: { fontSize: 11, marginTop: -spacing[1] },
  analyticsRow: { flexDirection: 'row', gap: spacing[3], marginTop: spacing[2] },
  analyticsLabel: { fontSize: 11, fontWeight: '500' },
  analyticsValue: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, marginTop: 2 },
  analyticsBlock: { gap: spacing[1] },
  riskBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  riskBadgeText: { fontSize: 10, fontWeight: '700' },
  serviceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing[1.5],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  serviceName: { fontSize: fontSize.sm, flex: 1 },
  serviceRevenue: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  favMasterRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  // Car filter chips
  carChipsScroll: { marginTop: spacing[2] },
  carChipsRow: { flexDirection: 'row', gap: spacing[1.5] },
  carChip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: borderRadius.full,
    backgroundColor: colors.gray[100],
    borderWidth: 1,
    borderColor: colors.gray[200],
  },
  carChipActive: { backgroundColor: colors.primary[50], borderColor: colors.primary[500] },
  carChipText: { fontSize: fontSize.xs, fontWeight: fontWeight.medium, color: colors.gray[600], maxWidth: 160 },
  carChipTextActive: { color: colors.primary[700], fontWeight: fontWeight.semibold },

  // Date group headers
  dateGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[2.5],
    marginTop: spacing[1],
  },
  dateGroupLine: { flex: 1, height: 1, backgroundColor: colors.gray[200] },
  dateGroupText: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.gray[400],
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // Check card
  checkCard: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderRadius: borderRadius.xl,
    overflow: 'hidden',
    shadowColor: colors.black,
    shadowOpacity: 0.04,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
    borderWidth: 1,
    borderColor: colors.gray[100],
    marginTop: spacing[2],
  },
  checkCardDeferred: { backgroundColor: '#fef8f8', borderColor: colors.red[100] },
  accentBar: { width: 3.5 },
  checkContent: { flex: 1, paddingHorizontal: spacing[3], paddingVertical: spacing[2.5] },
  checkHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing[1.5],
  },
  checkHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5], flex: 1 },
  checkNumber: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  deferredBadge: {
    backgroundColor: colors.red[100],
    paddingHorizontal: spacing[1.5],
    paddingVertical: 1,
    borderRadius: borderRadius.full,
  },
  deferredText: { fontSize: 9, fontWeight: fontWeight.bold, color: colors.red[700] },
  paymentBadge: { paddingHorizontal: spacing[1.5], paddingVertical: 1, borderRadius: borderRadius.full },
  paymentBadgeText: { fontSize: 10, fontWeight: fontWeight.medium },
  checkTotal: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },

  checkInfoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing[1.5], marginBottom: spacing[1] },
  infoChip: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  infoChipText: { fontSize: 12, color: colors.gray[600], maxWidth: 120 },
  plateTag: {
    fontSize: 9,
    fontWeight: fontWeight.bold,
    color: colors.primary[700],
    backgroundColor: colors.primary[50],
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
    overflow: 'hidden',
    marginLeft: 2,
  },
  commentText: { fontSize: 11, color: colors.amber[600], fontStyle: 'italic', marginBottom: spacing[1] },
  checkFooter: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  footerTime: { fontSize: 11 },
  footerMaster: { fontSize: 11, flex: 1 },
  footerProfit: { fontSize: 11, fontWeight: fontWeight.bold },
  profitPositive: { color: colors.green[600] },
  profitNegative: { color: colors.red[500] },

  emptyChecks: { alignItems: 'center', paddingVertical: spacing[8] },
  emptyChecksText: { fontSize: fontSize.sm, marginTop: spacing[2] },

  // Form
  formField: { marginBottom: spacing[4] },
  formLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, marginBottom: spacing[1.5] },
  formInput: {
    backgroundColor: colors.gray[50],
    borderWidth: 1,
    borderColor: colors.gray[300],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[2.5],
    fontSize: fontSize.sm,
    color: colors.gray[900],
  },
  helperText: { fontSize: 10, textAlign: 'right', marginTop: 4 },
  formActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[3],
    paddingTop: spacing[4],
    borderTopWidth: 1,
    borderTopColor: colors.gray[200],
  },
  cancelBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
    borderColor: colors.gray[300],
  },
  cancelBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  submitBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.primary[600],
  },
  submitBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.white },
});
