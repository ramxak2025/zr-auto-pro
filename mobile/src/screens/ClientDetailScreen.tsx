import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { clientsApi, carsApi, checksApi, debtsApi, loyaltyApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import { useColors } from '../contexts/ThemeContext';
import Modal from '../components/Modal';
import ConfirmDialog from '../components/ConfirmDialog';
import PlateReassignDialog from '../components/PlateReassignDialog';
import LoadingSpinner from '../components/LoadingSpinner';
import AnimatedCard from '../components/AnimatedCard';
import IosScreenHeader from '../components/IosScreenHeader';
import SourcePickerSheet from '../components/SourcePickerSheet';
import CarPlateField from '../components/CarPlateField';
import type { PlateMode } from '../components/RussianPlateInput';
import ClientCallsSection from '../components/ClientCallsSection';
import LoyaltyBadge from '../components/LoyaltyBadge';
import SectionHeader from '../components/SectionHeader';
import { UserRole } from '../../../shared/types';
import { colors, fontSize, fontWeight, borderRadius, spacing, badgeColors, paymentMethodBadgeColor } from '../theme';
import type { Client, Car, Check, ClientDebtSummary, ClientBonusSummary, BonusType } from '../../../shared/types';
import { formatPhone } from '../../../shared/validation/phone';
import { haptic } from '../platform/haptics';
import { detectPlateMode } from '../utils/plateMask';

const paymentLabels: Record<string, string> = {
  cash: 'Наличные',
  card: 'Карта',
  warranty: 'Гарантия',
  cash_card: 'Нал/Карта',
};

// Incremental history rendering (RNPERF-6): the ScrollView is not
// virtualized, so building 200 CheckRow trees on mount is pure waste —
// render the first page and grow by another page per «Показать ещё» tap.
const HISTORY_PAGE = 30;

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
  // Notes / source EDITING — gated to director / superadmin / clients_edit.
  // The «Только для сотрудников» card itself is now visible to ALL staff
  // (#19.4) — only the ability to CHANGE notes/source stays gated, so a
  // master sees the info read-only but can't reshape it.
  const canEditMeta = isRole(UserRole.SUPERADMIN, UserRole.DIRECTOR) || hasPermission('clients_edit');
  // Дебиторка — начисление долга / приём оплаты внутри карточки клиента.
  // Role-gated to director/admin/superadmin (and enforced server-side); a
  // master sees the balance + ledger read-only without the action buttons.
  const canManageDebt = isRole(UserRole.SUPERADMIN, UserRole.DIRECTOR, UserRole.ADMIN);
  // Бонусы / лояльность — ручное начисление/списание (adjust) внутри карточки.
  // Owner-class (director/admin/superadmin), enforced server-side. A master
  // sees the balance + ledger read-only without the action buttons.
  const canManageLoyalty = isRole(UserRole.SUPERADMIN, UserRole.DIRECTOR, UserRole.ADMIN);
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

  // Lazy-history trigger (audit #8). We record the Y of the «История
  // чеков» header (onLayout) and the scroll viewport height, then flip
  // `historyExpanded` the moment that header crosses into the visible
  // viewport — fetching the full history just-in-time instead of on open.
  const historyY = useRef<number>(Number.POSITIVE_INFINITY);
  const viewportH = useRef<number>(0);

  // Car modal state. Only the open/close flag + which car is being edited
  // live here (RNPERF-6) — the form FIELDS live inside <CarFormModal/> so
  // every keystroke re-renders just the modal, not the whole screen with
  // its hundreds of check rows. The last submitted values are mirrored
  // into `carFormRef` (a ref — no re-render) for the duplicate-plate flow.
  const [carModalOpen, setCarModalOpen] = useState(false);
  const [editingCar, setEditingCar] = useState<Car | null>(null);
  const carFormRef = useRef<CarFormValues | null>(null);
  const [deleteCarId, setDeleteCarId] = useState<string | null>(null);
  // Notes editor (owner-only) — draft state lives inside <NotesEditorModal/>.
  const [notesModalOpen, setNotesModalOpen] = useState(false);
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

  // ── Eager vs lazy check history (audit #8) ─────────────────────────
  // Opening the card must feel instant. The hero (LTV / last visit) and
  // the first screenful of «История чеков» only need a HANDFUL of the
  // most-recent checks — backend returns DESC by date, so the slim eager
  // request already carries the last visit and the first page of history.
  // The full history (used for the 12-month sparkline, per-car spend,
  // top-services etc.) is fetched LAZILY — only after the user reaches /
  // expands the «История чеков» section — so it never blocks first paint.
  const EAGER_LIMIT = 10;
  const FULL_LIMIT = 200;
  // Flipped true when the history section scrolls into view (onLayout
  // measured below) OR the user taps «Показать всю историю». Once true it
  // stays true for the lifetime of the screen — the full query is then
  // the source of truth for analytics + the complete grouped list.
  const [historyExpanded, setHistoryExpanded] = useState(false);
  // How many history rows are actually MOUNTED (RNPERF-6). The data may
  // hold up to FULL_LIMIT checks, but the un-virtualized ScrollView only
  // renders the first page; each «Показать ещё» tap grows it by a page.
  const [visibleHistoryCount, setVisibleHistoryCount] = useState(HISTORY_PAGE);

  // EAGER — the exact key ClientsScreen warms on row press-in. Keep this
  // key + limit in lockstep with ClientsScreen.prefetchClientDetail so a
  // tapped row opens straight from cache.
  const { data: eagerChecks } = useQuery<Check[]>({
    queryKey: isRetail ? ['retail-checks'] : ['client-checks', id],
    queryFn: async () => {
      const res = isRetail
        ? await checksApi.getAll({ retail: 'true', limit: EAGER_LIMIT })
        : await checksApi.getAll({ clientId: id, limit: EAGER_LIMIT });
      const raw = res.data as { data?: Check[] } | Check[];
      return Array.isArray(raw) ? raw : raw.data || [];
    },
  });

  // FULL — heavy history, only fired once the section is reached/expanded.
  const { data: fullChecks } = useQuery<Check[]>({
    queryKey: isRetail ? ['retail-checks-full', id] : ['client-checks-full', id],
    queryFn: async () => {
      const res = isRetail
        ? await checksApi.getAll({ retail: 'true', limit: FULL_LIMIT })
        : await checksApi.getAll({ clientId: id, limit: FULL_LIMIT });
      const raw = res.data as { data?: Check[] } | Check[];
      return Array.isArray(raw) ? raw : raw.data || [];
    },
    enabled: historyExpanded,
  });

  // Full set wins for analytics + the complete list once it lands; until
  // then everything reads off the instant eager slice. Analytics computed
  // off the eager slice are a faithful preview (last visit + recent
  // numbers) and self-correct the moment the full set arrives.
  const checks = historyExpanded && fullChecks ? fullChecks : eagerChecks;
  // True while the full history is still loading after expansion — drives
  // the «Показать всю историю» affordance spinner state.
  const fullPending = historyExpanded && !fullChecks;

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
    const nextVisitEta =
      lastVisit && avgIntervalDays ? new Date(lastVisit.getTime() + avgIntervalDays * 24 * 60 * 60 * 1000) : null;

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
      const monthsAgo = (now.getFullYear() - d.getFullYear()) * 12 + (now.getMonth() - d.getMonth());
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

  // The slice of history rows we actually mount (RNPERF-6). Analytics
  // upstream still read the FULL list — only the rendered tree is capped.
  const visibleChecks = useMemo(
    () => (filteredChecks.length > visibleHistoryCount ? filteredChecks.slice(0, visibleHistoryCount) : filteredChecks),
    [filteredChecks, visibleHistoryCount],
  );
  const hiddenHistoryCount = filteredChecks.length - visibleChecks.length;

  // Group visible checks by date for the history section. Memoised
  // (audit #8) — this used to rebuild on EVERY render (every scroll
  // frame, every state poke), allocating fresh group arrays each time.
  // Now it only recomputes when the underlying visible list changes.
  const groupedChecks = useMemo(() => {
    const groups: { label: string; checks: Check[] }[] = [];
    let last = '';
    for (const check of visibleChecks) {
      const group = formatDateGroup(check.date);
      if (group !== last) {
        groups.push({ label: group, checks: [check] });
        last = group;
      } else {
        groups[groups.length - 1].checks.push(check);
      }
    }
    return groups;
  }, [visibleChecks]);

  // Per-car analytics for the «Автомобили» cards (#19.4):
  //  • lastMileage — mileage of the most-recent check for that car;
  //  • spent       — sum of that car's check totals, net of returns
  //    (a returned check doesn't count toward money spent on the car).
  // Derived from the flat `checks` list we already fetch, so no extra
  // request. Keyed by car id for O(1) lookup in the render loop.
  const carStats = useMemo(() => {
    const map = new Map<string, { spent: number; lastMileage: number | null; lastMileageAt: number }>();
    for (const c of checks || []) {
      const carId = c.car?.id;
      if (!carId) continue;
      const cur = map.get(carId) ?? { spent: 0, lastMileage: null, lastMileageAt: 0 };
      if (!c.isReturned) cur.spent += c.totalRevenue || 0;
      const t = new Date(c.date).getTime();
      // Latest check that actually carries a mileage reading wins.
      if (typeof c.mileage === 'number' && c.mileage > 0 && t >= cur.lastMileageAt) {
        cur.lastMileage = c.mileage;
        cur.lastMileageAt = t;
      }
      map.set(carId, cur);
    }
    return map;
  }, [checks]);

  const createCarMutation = useMutation({
    mutationFn: (d: any) => carsApi.create(d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client', id] });
      queryClient.invalidateQueries({ queryKey: ['client-checks-by-car', id] });
      // A new car shows up in the garage list (CarsScreen) — bust it too.
      queryClient.invalidateQueries({ queryKey: ['cars'] });
      closeCarModal();
    },
    onError: () => Alert.alert('Ошибка', 'Ошибка при создании авто'),
  });

  const updateCarMutation = useMutation({
    mutationFn: ({ carId, data }: { carId: string; data: any }) => carsApi.update(carId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client', id] });
      // Editing a car (esp. its plate) ripples to the garage list, the
      // per-car check history, and the plate badge shown on this client's own
      // check history — refresh all of them so nothing shows the old plate.
      queryClient.invalidateQueries({ queryKey: ['cars'] });
      queryClient.invalidateQueries({ queryKey: ['car-checks'] });
      queryClient.invalidateQueries({ queryKey: ['client-checks', id] });
      queryClient.invalidateQueries({ queryKey: ['client-checks-full', id] });
      closeCarModal();
    },
    onError: () => Alert.alert('Ошибка', 'Ошибка при обновлении авто'),
  });

  const deleteCarMutation = useMutation({
    mutationFn: (carId: string) => carsApi.remove(carId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['client', id] });
      // Deleting a car removes it from the garage and from any check history
      // that referenced it — refresh the same set as edit.
      queryClient.invalidateQueries({ queryKey: ['cars'] });
      queryClient.invalidateQueries({ queryKey: ['car-checks'] });
      queryClient.invalidateQueries({ queryKey: ['client-checks', id] });
      queryClient.invalidateQueries({ queryKey: ['client-checks-full', id] });
    },
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
    setCarModalOpen(true);
  };

  const openEditCar = (car: Car) => {
    setEditingCar(car);
    setCarModalOpen(true);
  };

  // The car payload sent to backend on both create and update — built from
  // the values the modal handed us on submit (mirrored in carFormRef so the
  // duplicate-plate retry flow can rebuild the same payload). Plate is
  // keyed by car_id server-side, so editing make/model OR plate via
  // PATCH /cars/:id never orphans check history (#15.3).
  const buildCarPayload = () => {
    const form = carFormRef.current;
    // Clean stored plate (empty when «без номеров»). CarPlateField already
    // applies the RU mask / foreign normalisation, so no re-masking here.
    const effectivePlate = !form || form.noPlate ? '' : form.plateNumber.trim();
    return {
      plateNumber: effectivePlate,
      makeModel: form?.makeModel ?? '',
      comment: form?.carComment ? form.carComment : undefined,
      clientId: id,
      noPlate: form?.noPlate ?? false,
    };
  };

  const handleCarSubmit = async (values: CarFormValues) => {
    carFormRef.current = values;
    const payload = buildCarPayload();
    const effectivePlate = payload.plateNumber;

    // «Без номеров» or no plate at all → nothing to clash on, save directly.
    if (values.noPlate || effectivePlate.length === 0) {
      if (editingCar) updateCarMutation.mutate({ carId: editingCar.id, data: payload });
      else createCarMutation.mutate(payload);
      return;
    }

    setCarSubmitting(true);
    try {
      const res = await carsApi.lookupByPlate(effectivePlate);
      const existing = res.data;
      // A clash is only real if it's a DIFFERENT car. Editing this same car
      // and keeping its plate must not trip the duplicate dialog.
      if (existing && existing.id !== editingCar?.id) {
        setDuplicateCar(existing);
        return;
      }
      if (editingCar) updateCarMutation.mutate({ carId: editingCar.id, data: payload });
      else createCarMutation.mutate(payload);
    } catch {
      // lookup failed (offline / 5xx) — proceed; backend still enforces.
      if (editingCar) updateCarMutation.mutate({ carId: editingCar.id, data: payload });
      else createCarMutation.mutate(payload);
    } finally {
      setCarSubmitting(false);
    }
  };

  // #15.3 — plate reassignment. The entered plate already lives on ANOTHER
  // car. On confirm we move the plate to THIS car. Check history on both cars
  // is keyed to car_id, so nothing is lost — only the plate moves.
  //
  // No atomic reassign endpoint exists (carsApi only has create/update), so
  // this is necessarily a TWO-step write. Ordering is chosen for crash-safety:
  // we assign the plate HERE first, THEN strip it off the other car. There is
  // NO DB unique constraint on plate_number (only a non-unique idx_cars_plate),
  // so if the strip step fails after the assign succeeded we are left with a
  // harmless DUPLICATE (both cars hold the plate) rather than an ORPHAN (the
  // plate lost from both). The reverse ordering (clear-old-first) would, on a
  // step-2 failure, free the plate from the old car but never land it on the
  // new one → the plate vanishes from BOTH cars and search-by-plate returns
  // nothing. A duplicate is fully recoverable (just retry — both writes are
  // idempotent and converge to the correct single-owner state); an orphan
  // silently destroys the link. So: assign-here → clear-other.
  const handleReassignPlate = async () => {
    if (!duplicateCar) return;
    // Snapshot stable values for the post-await branches. We deliberately do
    // NOT clear `duplicateCar` up front: on a partial failure the dialog must
    // stay open so the user can immediately retry and converge to the correct
    // state. `busy` (carSubmitting) disables the buttons during the in-flight op.
    const otherCarId = duplicateCar.id;
    const otherOwnerId = duplicateCar.clientId;
    setCarSubmitting(true);
    try {
      // 1) Assign the plate HERE first (create or update). If this fails, the
      //    other car still owns the plate — nothing lost.
      const payload = buildCarPayload();
      if (editingCar) {
        await carsApi.update(editingCar.id, payload);
      } else {
        await carsApi.create(payload);
      }
      // 2) Now free the plate on the other car. If THIS fails, we have a
      //    harmless duplicate (no unique constraint), not an orphan — and the
      //    dialog stays open below so the user can retry to finish the move.
      await carsApi.update(otherCarId, { plateNumber: '', noPlate: true });
      // Both steps committed — only THIS car holds the plate now. Safe to close.
      setDuplicateCar(null);
      haptic('success');
      await queryClient.invalidateQueries({ queryKey: ['client', id] });
      await queryClient.invalidateQueries({ queryKey: ['client-checks-by-car', id] });
      // The other car's owner card (if cached) is now stale too.
      if (otherOwnerId && otherOwnerId !== id) {
        queryClient.invalidateQueries({ queryKey: ['client', otherOwnerId] });
      }
      queryClient.invalidateQueries({ queryKey: ['cars'] });
      closeCarModal();
    } catch {
      // Partial failure: the DB may be in either intermediate state (only
      // step 1 applied = recoverable duplicate, or nothing applied). Invalidate
      // the same keys as the success path so the UI re-reads the real DB state
      // instead of a stale optimistic view, and KEEP the reassign dialog open
      // (`duplicateCar` untouched) so «Переназначить» retries the whole flow —
      // both writes are idempotent and converge to a single plate owner.
      haptic('error');
      await queryClient.invalidateQueries({ queryKey: ['client', id] });
      if (otherOwnerId && otherOwnerId !== id) {
        queryClient.invalidateQueries({ queryKey: ['client', otherOwnerId] });
      }
      queryClient.invalidateQueries({ queryKey: ['cars'] });
      Alert.alert('Ошибка', 'Не удалось завершить переназначение — попробуйте снова');
    } finally {
      setCarSubmitting(false);
    }
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
    await queryClient.invalidateQueries({ queryKey: ['client-checks-full', id] });
    setRefreshing(false);
  };

  // Fire the full-history fetch as soon as the «История чеков» header
  // enters the viewport (audit #8). Cheap arithmetic on every scroll
  // frame; once expanded we stop caring. A 200 px lead-in starts the
  // request slightly before the section is actually on screen so the
  // full list is usually ready by the time the user gets there.
  const maybeExpandHistory = (scrollY: number) => {
    if (historyExpanded) return;
    if (scrollY + viewportH.current + 200 >= historyY.current) {
      setHistoryExpanded(true);
    }
  };

  // Prefetch the car's checks the instant the user starts tapping a garage
  // card, so CarDetailScreen opens straight from cache. Key + limit mirror
  // CarDetailScreen's query EXACTLY (['car-checks', carId, 'full'], 200) —
  // diverge and the prefetch silently misses.
  const prefetchCarDetail = useCallback(
    (carId: string) => {
      queryClient.prefetchQuery({
        queryKey: ['car-checks', carId, 'full'],
        queryFn: async (): Promise<Check[]> => {
          const res = await carsApi.checks(carId, { limit: 200 });
          return Array.isArray(res.data) ? res.data : [];
        },
        staleTime: 60_000,
      });
    },
    [queryClient],
  );

  // Stable row-open handler (RNPERF-6) — CheckRow is memoised, so the
  // callback identity must survive re-renders or the memo is useless.
  const openCheck = useCallback(
    (checkId: string) => {
      navigation.navigate('Main', {
        screen: 'Checks',
        params: { screen: 'CheckDetail', params: { id: checkId } },
      });
    },
    [navigation],
  );

  // Switching the car filter collapses the history back to the first
  // page — the freshly filtered list shouldn't inherit a deep expansion.
  useEffect(() => {
    setVisibleHistoryCount(HISTORY_PAGE);
  }, [selectedCarId]);

  // Scroll to + select the focused car when a caller passes `focusCarId`
  // (e.g. a deep link). Selecting filters the unified «История чеков» to
  // that car — there's no per-car expansion anymore (#19.4). Layout-
  // measured Y is the single source of truth — RN doesn't expose a
  // "scroll to mounted child" primitive, so we collect Y per row in
  // onLayout, then jump.
  useEffect(() => {
    if (!focusCarId || focusHandled.current) return;
    if (!client) return;
    const car = (client.cars || []).find((c) => c.id === focusCarId);
    if (!car) return;
    setSelectedCarId(focusCarId);
    // Defer the actual scroll until the next frame so onLayout has
    // populated carRowYs for the (now visible) car row.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const y = carRowYs.current[focusCarId];
        if (typeof y === 'number' && scrollRef.current) {
          scrollRef.current.scrollTo({ y: Math.max(0, y - 12), animated: true });
          focusHandled.current = true;
        }
      });
    });
  }, [focusCarId, client]);

  // The retail buyer view IS the check history — there's no hero/garage
  // to defer behind, so expand immediately to load the full list (audit
  // #8: the eager/lazy split only buys us anything on the rich client
  // card, where the history sits below the fold).
  useEffect(() => {
    if (isRetail) setHistoryExpanded(true);
  }, [isRetail]);

  // ── RETAIL BUYER VIEW (virtual) ────────────────────────────────────
  // No car filter exists here (selectedCarId is never set), so the
  // memoised `groupedChecks` / `stats` computed above ARE the retail
  // data — no per-render regrouping (RNPERF-6).
  if (isRetail) {
    const retailTotal = stats.total;
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
                await queryClient.invalidateQueries({ queryKey: ['retail-checks-full', id] });
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

          <SectionHeader title="Чеки" count={checks?.length || 0} />

          {!checks || checks.length === 0 ? (
            <View
              style={[styles.emptyChecks, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
            >
              <View style={[styles.emptyChecksIcon, { backgroundColor: palette.bg.muted }]}>
                <Ionicons name="receipt-outline" size={22} color={palette.text.tertiary} />
              </View>
              <Text style={[styles.emptyChecksText, { color: palette.text.secondary }]}>Нет чеков</Text>
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
                    onOpen={openCheck}
                  />
                ))}
              </View>
            ))
          )}

          {hiddenHistoryCount > 0 ? (
            <TouchableOpacity
              style={[styles.showAllHistoryBtn, { borderColor: palette.border.subtle }]}
              activeOpacity={0.7}
              onPress={() => {
                haptic('tap');
                setVisibleHistoryCount((c) => c + HISTORY_PAGE);
              }}
            >
              <Ionicons name="chevron-down" size={15} color={palette.accent.primary} />
              <Text style={[styles.showAllHistoryText, { color: palette.accent.primary }]}>
                Показать ещё ({hiddenHistoryCount})
              </Text>
            </TouchableOpacity>
          ) : null}
        </ScrollView>
      </View>
    );
  }

  if (isLoading) return <LoadingSpinner />;
  if (!client)
    return <Text style={{ padding: 20, textAlign: 'center', color: palette.text.secondary }}>Клиент не найден</Text>;

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
        scrollEventThrottle={16}
        onLayout={(e) => {
          viewportH.current = e.nativeEvent.layout.height;
        }}
        onScroll={(e) => maybeExpandHistory(e.nativeEvent.contentOffset.y)}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary[600]} />
        }
      >
        {/* HERO — avatar, name, phone, source badge, first-visit date. */}
        <AnimatedCard
          style={[styles.heroCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
          index={0}
        >
          <View style={[styles.avatarLg, { backgroundColor: avatarColor }]}>
            <Text style={styles.avatarLgText}>{initials}</Text>
          </View>
          <Text style={[styles.clientName, { color: palette.text.primary }]} numberOfLines={2}>
            {client.fullName}
          </Text>
          <Text style={[styles.heroPhone, { color: palette.text.secondary }]}>{formatPhone(client.phone)}</Text>
          <View style={styles.heroBadgesRow}>
            {client.source ? (
              <TouchableOpacity
                onPress={() => canEditMeta && setSourceOpen(true)}
                activeOpacity={canEditMeta ? 0.7 : 1}
                style={[styles.sourceBadge, { backgroundColor: palette.accent.primarySoft }]}
              >
                <Ionicons name="pricetag" size={11} color={palette.accent.primaryText} />
                <Text style={[styles.sourceBadgeText, { color: palette.accent.primaryText }]}>{client.source}</Text>
              </TouchableOpacity>
            ) : canEditMeta ? (
              <TouchableOpacity
                onPress={() => setSourceOpen(true)}
                activeOpacity={0.7}
                style={[styles.sourceBadgeEmpty, { borderColor: palette.border.strong }]}
              >
                <Ionicons name="add" size={12} color={palette.text.tertiary} />
                <Text style={[styles.sourceBadgeEmptyText, { color: palette.text.tertiary }]}>Источник</Text>
              </TouchableOpacity>
            ) : null}
            <View style={[styles.heroDateChip, { backgroundColor: palette.bg.muted }]}>
              <Ionicons name="calendar-outline" size={11} color={palette.text.tertiary} />
              <Text style={[styles.heroDate, { color: palette.text.tertiary }]}>с {formatDate(client.createdAt)}</Text>
            </View>
          </View>

          {/* KEY STATS — tidy three-up row of stat tiles. */}
          <View style={[styles.statTilesRow, { borderTopColor: palette.border.subtle }]}>
            <StatTile label="Чеков" value={String(stats.count)} palette={palette} />
            <View style={[styles.statTileDivider, { backgroundColor: palette.border.subtle }]} />
            <StatTile label="LTV" value={formatMoney(stats.total)} palette={palette} />
            <View style={[styles.statTileDivider, { backgroundColor: palette.border.subtle }]} />
            <StatTile label="Средний" value={stats.count > 0 ? formatMoney(stats.avg) : '—'} palette={palette} />
          </View>
        </AnimatedCard>

        {/* LOYALTY — last satisfaction rating (#15.2 ⭐). Renders nothing
            when the client has never been rated. */}
        <LoyaltyBadge rating={client.lastRating} ratedAt={client.lastRatingAt} />

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
              Linking.openURL(whatsappHref(client.phone)).catch(() => Alert.alert('WhatsApp не установлен'));
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

        {/* ДОЛГИ — per-client receivables ledger (дебиторка). Balance header,
            charge/payment buttons (role-gated), the movements ledger, and a
            read-only «Незакрытые заказ-наряды» list. Self-contained: owns its
            own query + mutations + amount-prompt modal. */}
        <ClientDebtSection clientId={id} canManage={canManageDebt} palette={palette} onOpenCheck={openCheck} />

        {/* БОНУСЫ — программа лояльности. Баланс (крупно), всего начислено /
            списано, и леджер движений (accrual зелёным +, redemption оранжевым
            −). Owner-class «Начислить» / «Списать» — ручная корректировка
            (adjust). Секция сама прячется, если программа выключена И баланс 0
            (см. ClientBonusSection) — чтобы не засорять карточку. */}
        <ClientBonusSection clientId={id} canManage={canManageLoyalty} palette={palette} />

        {/* STAFF-ONLY: notes + source + comment. Visible to EVERY staff
            member (#19.4). Editing notes/source stays gated to canEditMeta —
            a master sees the info read-only (no chevron, no tap). */}
        <SectionHeader title="Информация" />
        <AnimatedCard
          style={[styles.metaCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
          index={1}
        >
          <TouchableOpacity
            style={[styles.metaRow, { borderBottomColor: palette.border.subtle }]}
            activeOpacity={canEditMeta ? 0.7 : 1}
            disabled={!canEditMeta}
            onPress={() => setNotesModalOpen(true)}
          >
            <View style={[styles.metaIcon, { backgroundColor: palette.bg.muted }]}>
              <Ionicons name="document-text-outline" size={15} color={palette.text.secondary} />
            </View>
            <View style={styles.metaText}>
              <Text style={[styles.metaLabel, { color: palette.text.tertiary }]}>Заметки для сотрудников</Text>
              <Text style={[styles.metaValue, { color: palette.text.primary }]} numberOfLines={3}>
                {client.ownerNotes || (canEditMeta ? 'Нажмите, чтобы добавить' : 'Нет заметок')}
              </Text>
            </View>
            {canEditMeta && <Ionicons name="chevron-forward" size={15} color={palette.text.tertiary} />}
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.metaRow,
              client.comment ? { borderBottomColor: palette.border.subtle } : { borderBottomWidth: 0 },
            ]}
            activeOpacity={canEditMeta ? 0.7 : 1}
            disabled={!canEditMeta}
            onPress={() => setSourceOpen(true)}
          >
            <View style={[styles.metaIcon, { backgroundColor: palette.bg.muted }]}>
              <Ionicons name="pricetag-outline" size={15} color={palette.text.secondary} />
            </View>
            <View style={styles.metaText}>
              <Text style={[styles.metaLabel, { color: palette.text.tertiary }]}>Источник</Text>
              <Text style={[styles.metaValue, { color: palette.text.primary }]}>{client.source || 'Не указан'}</Text>
            </View>
            {canEditMeta && <Ionicons name="chevron-forward" size={15} color={palette.text.tertiary} />}
          </TouchableOpacity>
          {client.comment ? (
            <View style={[styles.metaRow, { borderBottomWidth: 0 }]}>
              <View style={[styles.metaIcon, { backgroundColor: palette.bg.muted }]}>
                <Ionicons name="chatbubble-outline" size={15} color={palette.text.secondary} />
              </View>
              <View style={styles.metaText}>
                <Text style={[styles.metaLabel, { color: palette.text.tertiary }]}>Комментарий</Text>
                <Text style={[styles.metaValue, { color: palette.text.primary }]}>{client.comment}</Text>
              </View>
            </View>
          ) : null}
        </AnimatedCard>

        {/* CARS — one beautiful card per car: модель + госномер badge +
            последний пробег + сумма, потраченная на ЭТО авто (#19.4).
            NO per-car checks expansion — tapping a car never opens a
            separate checks list; the unified «История чеков» below covers
            sales + returns. */}
        <SectionHeader
          title="Гараж"
          count={cars.length}
          trailing={
            <TouchableOpacity
              style={[styles.addBtn, { backgroundColor: palette.accent.primarySoft }]}
              onPress={openAddCar}
              activeOpacity={0.7}
            >
              <Ionicons name="add" size={14} color={palette.accent.primaryText} />
              <Text style={[styles.addBtnText, { color: palette.accent.primaryText }]}>Добавить</Text>
            </TouchableOpacity>
          }
        />

        {cars.length === 0 ? (
          <View style={[styles.emptyCars, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
            <View style={[styles.emptyCarsIcon, { backgroundColor: palette.bg.muted }]}>
              <Ionicons name="car-sport-outline" size={22} color={palette.text.tertiary} />
            </View>
            <Text style={[styles.emptyCarsText, { color: palette.text.secondary }]}>У клиента ещё нет автомобилей</Text>
          </View>
        ) : (
          cars.map((car, idx) => {
            const cs = carStats.get(car.id);
            return (
              <View
                key={car.id}
                onLayout={(e) => {
                  carRowYs.current[car.id] = e.nativeEvent.layout.y;
                }}
              >
                <CarCard
                  car={car}
                  palette={palette}
                  index={idx}
                  spent={cs?.spent ?? 0}
                  lastMileage={cs?.lastMileage ?? null}
                  canEdit={canEditMeta}
                  onPress={() => {
                    haptic('select');
                    navigation.navigate('CarDetail', {
                      carId: car.id,
                      clientId: id,
                      clientName: client.fullName,
                      makeModel: car.makeModel,
                      plateNumber: car.plateNumber,
                      noPlate: car.noPlate,
                    });
                  }}
                  onPressIn={() => prefetchCarDetail(car.id)}
                  onEdit={() => openEditCar(car)}
                  onDelete={() => setDeleteCarId(car.id)}
                />
              </View>
            );
          })
        )}

        {/* CALLS — calls with this client + inline recording playback (#15.2). */}
        <ClientCallsSection clientId={id} sectionTitleStyle={styles.callsSectionHeader} />

        {/* ANALYTICS — sparkline + insights */}
        {stats.count > 0 && (
          <>
            <SectionHeader title="Аналитика" />
            <AnimatedCard
              style={[styles.analyticsCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
              index={3}
            >
              <View style={styles.analyticsHeader}>
                <Text style={[styles.cardTitle, { color: palette.text.primary }]}>Активность клиента</Text>
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
                    // ICON-05: ring + inner mark needs ≥13px to stay legible.
                    name={stats.risk === 'ok' ? 'checkmark-circle' : 'alert-circle'}
                    size={13}
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
                  <Text style={[styles.analyticsLabel, { color: palette.text.tertiary }]}>
                    Что заказывает чаще всего
                  </Text>
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
          </>
        )}

        {/* HISTORY — toggle (all / per-car) then a grouped list. The
            onLayout records the section Y so we can lazy-fetch the full
            history the moment it scrolls into view (audit #8). */}
        <View
          onLayout={(e) => {
            historyY.current = e.nativeEvent.layout.y;
          }}
        >
          <SectionHeader
            title="История чеков"
            count={historyExpanded ? filteredChecks.length : null}
            trailing={fullPending ? <ActivityIndicator size="small" color={palette.text.tertiary} /> : null}
          />
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
                  onOpen={openCheck}
                />
              ))}
            </View>
          ))
        )}

        {/* «Показать ещё» (RNPERF-6) — the data may hold up to 200 checks
            but only the first page(s) are mounted; this grows the slice. */}
        {hiddenHistoryCount > 0 ? (
          <TouchableOpacity
            style={[styles.showAllHistoryBtn, { borderColor: palette.border.subtle }]}
            activeOpacity={0.7}
            onPress={() => {
              haptic('tap');
              setVisibleHistoryCount((c) => c + HISTORY_PAGE);
            }}
          >
            <Ionicons name="chevron-down" size={15} color={palette.accent.primary} />
            <Text style={[styles.showAllHistoryText, { color: palette.accent.primary }]}>
              Показать ещё ({hiddenHistoryCount})
            </Text>
          </TouchableOpacity>
        ) : null}

        {/* «Показать всю историю» affordance (audit #8). Until the full
            history is loaded we render only the eager recent slice; this
            button lets the user pull the rest on demand (it also fires
            automatically once the section scrolls into view). Hidden once
            the full set is present OR there's clearly nothing more to load
            (eager returned fewer than its limit). */}
        {!historyExpanded && (eagerChecks?.length ?? 0) >= EAGER_LIMIT ? (
          <TouchableOpacity
            style={[styles.showAllHistoryBtn, { borderColor: palette.border.subtle }]}
            activeOpacity={0.7}
            onPress={() => {
              haptic('tap');
              setHistoryExpanded(true);
            }}
          >
            <Ionicons name="time-outline" size={15} color={palette.accent.primary} />
            <Text style={[styles.showAllHistoryText, { color: palette.accent.primary }]}>Показать всю историю</Text>
          </TouchableOpacity>
        ) : null}
      </ScrollView>

      {/* Car Modal — form state lives INSIDE (RNPERF-6): keystrokes
          re-render the modal only, never the check-history tree. */}
      <CarFormModal
        visible={carModalOpen}
        editingCar={editingCar}
        palette={palette}
        submitting={carSubmitting || createCarMutation.isPending || updateCarMutation.isPending}
        onClose={closeCarModal}
        onSubmit={handleCarSubmit}
      />

      {/* Notes editor — owner only. Draft state lives INSIDE (RNPERF-6). */}
      <NotesEditorModal
        visible={notesModalOpen}
        initialValue={client.ownerNotes || ''}
        palette={palette}
        saving={notesMutation.isPending}
        onClose={() => setNotesModalOpen(false)}
        onSave={(text) => notesMutation.mutate(text.trim() ? text.trim() : null)}
      />

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

      <PlateReassignDialog
        visible={!!duplicateCar}
        onClose={() => setDuplicateCar(null)}
        onReassign={handleReassignPlate}
        onOpenOwner={duplicateCar?.clientId && duplicateCar.clientId !== id ? handleOpenExistingCar : undefined}
        plate={duplicateCar?.plateNumber || carFormRef.current?.plateNumber || ''}
        otherCarLabel={duplicateCar?.makeModel || duplicateCar?.plateNumber || 'Автомобиль'}
        otherOwnerName={duplicateCar?.client?.fullName ?? null}
        busy={carSubmitting}
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
    <View style={styles.statTile}>
      <Text style={[styles.statTileValue, { color: palette.text.primary }]} numberOfLines={1} adjustsFontSizeToFit>
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
      <View style={[styles.quickActionIcon, { backgroundColor: disabled ? palette.bg.muted : color + '18' }]}>
        <Ionicons name={icon} size={18} color={disabled ? palette.text.tertiary : color} />
      </View>
      <Text style={[styles.quickActionLabel, { color: disabled ? palette.text.tertiary : palette.text.primary }]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

interface CarCardProps {
  car: Car;
  palette: ReturnType<typeof useColors>;
  index: number;
  /** Сумма, потраченная на ЭТО авто (net of returns). */
  spent: number;
  /** Последний пробег (из самого свежего чека с пробегом). */
  lastMileage: number | null;
  canEdit: boolean;
  /** Drill-down — open the dedicated car screen (per-car stats + history). */
  onPress: () => void;
  /** Fires on finger-down so the car-history prefetch lands before the push. */
  onPressIn: () => void;
  onEdit: () => void;
  onDelete: () => void;
}
function CarCard({
  car,
  palette,
  index,
  spent,
  lastMileage,
  canEdit,
  onPress,
  onPressIn,
  onEdit,
  onDelete,
}: CarCardProps) {
  const carColor = getCarColor(car.id);
  const plate = (car.plateNumber || '').toUpperCase();
  return (
    <AnimatedCard
      style={[styles.carCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
      index={index + 1}
      onPress={onPress}
      onPressIn={onPressIn}
      activeOpacity={0.7}
    >
      <View style={styles.carTop}>
        <View style={styles.carInfo}>
          <View style={[styles.carIconWrap, { backgroundColor: carColor + '18' }]}>
            <Ionicons name="car-sport" size={18} color={carColor} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[styles.carModel, { color: palette.text.primary }]} numberOfLines={1}>
              {car.makeModel || 'Без модели'}
            </Text>
            {plate ? (
              <View style={[styles.carPlateBadge, { borderColor: palette.border.strong }]}>
                <Text style={styles.carPlateBadgeText}>{plate}</Text>
              </View>
            ) : (
              <View style={[styles.plateBadgeRow, { backgroundColor: palette.bg.muted }]}>
                <Text style={[styles.plateBadgeText, { color: palette.text.tertiary }]}>Без номера</Text>
              </View>
            )}
          </View>
        </View>
        {/* Trailing cluster: edit/delete (gated) + a chevron that signals the
            card is now a navigable drill-down. The icon buttons are their own
            touch targets, so they fire instead of the card's onPress. */}
        <View style={styles.carTopRight}>
          {canEdit ? (
            <View style={styles.carActions}>
              <TouchableOpacity onPress={onEdit} style={styles.iconBtn} hitSlop={8}>
                <Ionicons name="create-outline" size={16} color={palette.text.tertiary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={onDelete} style={styles.iconBtn} hitSlop={8}>
                <Ionicons name="trash-outline" size={16} color={colors.red[400]} />
              </TouchableOpacity>
            </View>
          ) : null}
          <Ionicons name="chevron-forward" size={18} color={palette.text.tertiary} style={styles.carChevron} />
        </View>
      </View>

      {car.comment ? <Text style={[styles.carComment, { color: palette.text.tertiary }]}>{car.comment}</Text> : null}

      {/* Stat strip: последний пробег | потрачено на это авто. */}
      <View style={[styles.carStatRow, { borderTopColor: palette.border.subtle }]}>
        <View style={styles.carStatItem}>
          <Ionicons name="speedometer-outline" size={15} color={palette.text.tertiary} />
          <View style={styles.carStatCol}>
            <Text style={[styles.carStatLabel, { color: palette.text.tertiary }]}>Пробег</Text>
            <Text style={[styles.carStatValue, { color: palette.text.primary }]} numberOfLines={1}>
              {lastMileage != null ? `${lastMileage.toLocaleString('ru-RU')} км` : '—'}
            </Text>
          </View>
        </View>
        <View style={[styles.carStatDivider, { backgroundColor: palette.border.subtle }]} />
        <View style={styles.carStatItem}>
          <Ionicons name="wallet-outline" size={15} color={palette.text.tertiary} />
          <View style={styles.carStatCol}>
            <Text style={[styles.carStatLabel, { color: palette.text.tertiary }]}>Потрачено</Text>
            <Text style={[styles.carStatValue, { color: palette.text.primary }]} numberOfLines={1}>
              {formatMoney(spent)}
            </Text>
          </View>
        </View>
      </View>
    </AnimatedCard>
  );
}

interface CheckRowProps {
  check: Check;
  palette: ReturnType<typeof useColors>;
  canViewProfit: boolean;
  /** Stable (useCallback) opener keyed by check id — keeps the memo intact. */
  onOpen: (checkId: string) => void;
}
// Memoised (RNPERF-6): with up to 200 rows in an un-virtualized ScrollView,
// any parent state poke used to re-render every row. All props are stable
// (`palette` is memoised per theme, `onOpen` is a useCallback, `check`
// objects keep identity inside the React-Query cache between renders).
const CheckRow = React.memo(function CheckRow({ check, palette, canViewProfit, onOpen }: CheckRowProps) {
  const badgeKey = paymentMethodBadgeColor[check.paymentMethod] || 'gray';
  const badge = badgeColors[badgeKey];
  return (
    <TouchableOpacity
      style={[
        styles.checkCard,
        { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
        check.isDeferred && styles.checkCardDeferred,
      ]}
      onPress={() => onOpen(check.id)}
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
            <Text style={[styles.footerProfit, check.profit >= 0 ? styles.profitPositive : styles.profitNegative]}>
              {check.profit >= 0 ? '+' : ''}
              {formatMoney(check.profit)}
            </Text>
          ) : null}
        </View>
      </View>
    </TouchableOpacity>
  );
});

// ── Form modals (RNPERF-6) ───────────────────────────────────────────
// The car/notes form FIELDS live here, not on the screen root: a keystroke
// re-renders only the modal subtree. The screen learns about the values
// once — on submit.

export interface CarFormValues {
  plateNumber: string;
  noPlate: boolean;
  makeModel: string;
  carComment: string;
}

interface CarFormModalProps {
  visible: boolean;
  /** Car being edited, or null when adding a new one. */
  editingCar: Car | null;
  palette: ReturnType<typeof useColors>;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (values: CarFormValues) => void;
}

function CarFormModal({ visible, editingCar, palette, submitting, onClose, onSubmit }: CarFormModalProps) {
  const [plateNumber, setPlateNumber] = useState('');
  const [plateMode, setPlateMode] = useState<PlateMode>('ru');
  const [noPlate, setNoPlate] = useState(false);
  const [makeModel, setMakeModel] = useState('');
  const [carComment, setCarComment] = useState('');

  // Re-seed the form each time the modal opens. Prefill the mode from the
  // stored plate so a foreign plate opens in INT mode (and stays editable
  // as foreign instead of being re-masked).
  useEffect(() => {
    if (!visible) return;
    if (editingCar) {
      setPlateNumber(editingCar.plateNumber);
      setPlateMode(detectPlateMode(editingCar.plateNumber));
      setNoPlate(!!editingCar.noPlate || !editingCar.plateNumber);
      setMakeModel(editingCar.makeModel);
      setCarComment(editingCar.comment || '');
    } else {
      setPlateNumber('');
      setPlateMode('ru');
      setNoPlate(false);
      setMakeModel('');
      setCarComment('');
    }
  }, [visible, editingCar]);

  return (
    <Modal visible={visible} onClose={onClose} title={editingCar ? 'Редактировать авто' : 'Добавить авто'}>
      <View style={styles.formField}>
        <Text style={[styles.formLabel, { color: palette.text.secondary }]}>Гос. номер</Text>
        <CarPlateField
          plate={plateNumber}
          mode={plateMode}
          noPlate={noPlate}
          onChangePlate={setPlateNumber}
          onChangeMode={setPlateMode}
          onChangeNoPlate={setNoPlate}
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
        <TouchableOpacity style={[styles.cancelBtn, { borderColor: palette.border.strong }]} onPress={onClose}>
          <Text style={[styles.cancelBtnText, { color: palette.text.secondary }]}>Отмена</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.submitBtn, { backgroundColor: palette.accent.primary }]}
          onPress={() => onSubmit({ plateNumber, noPlate, makeModel, carComment })}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color={colors.white} size="small" />
          ) : (
            <Text style={styles.submitBtnText}>{editingCar ? 'Сохранить' : 'Добавить'}</Text>
          )}
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

interface NotesEditorModalProps {
  visible: boolean;
  /** Saved notes — seeds the draft each time the editor opens. */
  initialValue: string;
  palette: ReturnType<typeof useColors>;
  saving: boolean;
  onClose: () => void;
  onSave: (text: string) => void;
}

function NotesEditorModal({ visible, initialValue, palette, saving, onClose, onSave }: NotesEditorModalProps) {
  const [draft, setDraft] = useState('');

  // Re-seed from the saved value on every open so a cancelled edit
  // doesn't leak into the next session.
  useEffect(() => {
    if (visible) setDraft(initialValue);
  }, [visible, initialValue]);

  return (
    <Modal visible={visible} onClose={onClose} title="Заметки владельца">
      <View style={styles.formField}>
        <Text style={[styles.formLabel, { color: palette.text.secondary }]}>
          Внутренние заметки (видны только владельцу)
        </Text>
        <TextInput
          value={draft}
          onChangeText={setDraft}
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
        <Text style={[styles.helperText, { color: palette.text.tertiary }]}>{draft.length}/4000</Text>
      </View>
      <View style={[styles.formActions, { borderTopColor: palette.border.subtle }]}>
        <TouchableOpacity
          style={[styles.cancelBtn, { borderColor: palette.border.strong }]}
          onPress={onClose}
          disabled={saving}
        >
          <Text style={[styles.cancelBtnText, { color: palette.text.secondary }]}>Отмена</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.submitBtn, { backgroundColor: palette.accent.primary }]}
          onPress={() => onSave(draft)}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color={colors.white} size="small" />
          ) : (
            <Text style={styles.submitBtnText}>Сохранить</Text>
          )}
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

// ── ClientDebtSection (Дебиторка) ──────────────────────────────────────
// Per-client receivables ledger. Reads GET /debts/client/:id (balance +
// newest-first ledger + read-only deferred-check context). «Добавить долг»
// (charge) and «Принять оплату» (payment) are role-gated to director / admin /
// superadmin (and enforced server-side). Both mutations return the refreshed
// summary, which we write straight into the cache so the balance + ledger
// update instantly, then invalidate the per-client + debtors-overview keys.
interface ClientDebtSectionProps {
  clientId: string;
  canManage: boolean;
  palette: ReturnType<typeof useColors>;
  /** Stable opener — a tap on a deferred check opens its CheckDetail. */
  onOpenCheck: (checkId: string) => void;
}

function ClientDebtSection({ clientId, canManage, palette, onOpenCheck }: ClientDebtSectionProps) {
  const queryClient = useQueryClient();
  const [promptMode, setPromptMode] = useState<'charge' | 'payment' | null>(null);
  const [amountText, setAmountText] = useState('');
  const [reasonText, setReasonText] = useState('');

  const { data: summary, isLoading } = useQuery<ClientDebtSummary>({
    queryKey: ['debts', 'client', clientId],
    queryFn: async () => (await debtsApi.clientLedger(clientId)).data,
  });

  // Instant cache write from the mutation's returned summary, then a
  // background revalidation of THIS client + the debtors overview.
  const applySummary = useCallback(
    (data: ClientDebtSummary) => {
      queryClient.setQueryData(['debts', 'client', clientId], data);
      queryClient.invalidateQueries({ queryKey: ['debts', 'client', clientId] });
      queryClient.invalidateQueries({ queryKey: ['debts', 'debtors'] });
    },
    [queryClient, clientId],
  );

  const closePrompt = useCallback(() => {
    setPromptMode(null);
    setAmountText('');
    setReasonText('');
  }, []);

  const chargeMutation = useMutation({
    mutationFn: (data: { amount: number; reason?: string }) =>
      debtsApi.charge({ clientId, amount: data.amount, reason: data.reason }),
    onSuccess: (res) => {
      applySummary(res.data);
      haptic('success');
      closePrompt();
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось добавить долг');
    },
  });

  const paymentMutation = useMutation({
    mutationFn: (data: { amount: number; reason?: string }) =>
      debtsApi.payment({ clientId, amount: data.amount, reason: data.reason }),
    onSuccess: (res) => {
      applySummary(res.data);
      haptic('success');
      closePrompt();
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось принять оплату');
    },
  });

  const openPrompt = (mode: 'charge' | 'payment') => {
    haptic('tap');
    setAmountText('');
    setReasonText('');
    setPromptMode(mode);
  };

  // Parse "1 200,50" / "1200.5" → number. NaN / ≤0 disables submit.
  const parsedAmount = useMemo(() => {
    const normalized = amountText.replace(/\s/g, '').replace(',', '.');
    const n = Number(normalized);
    return Number.isFinite(n) ? n : NaN;
  }, [amountText]);
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const submitting = chargeMutation.isPending || paymentMutation.isPending;

  const handleSubmit = () => {
    if (!amountValid || submitting) return;
    const reason = reasonText.trim() ? reasonText.trim() : undefined;
    if (promptMode === 'charge') chargeMutation.mutate({ amount: parsedAmount, reason });
    else if (promptMode === 'payment') paymentMutation.mutate({ amount: parsedAmount, reason });
  };

  const balance = summary?.balance ?? 0;
  const owes = balance > 0;
  const credit = balance < 0;
  const balanceColor = owes ? colors.red[600] : credit ? colors.green[600] : palette.text.secondary;
  const balanceLabel = owes ? 'Долг клиента' : credit ? 'Переплата / кредит' : 'Задолженности нет';
  const ledger = summary?.ledger ?? [];
  const deferred = summary?.deferredChecks ?? [];

  return (
    <>
      <SectionHeader title="Долги" />
      <AnimatedCard
        style={[styles.metaCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
        index={2}
      >
        {/* Balance header */}
        <View style={debtStyles.balanceRow}>
          <View
            style={[
              debtStyles.balanceIcon,
              { backgroundColor: owes ? colors.red[50] : credit ? colors.green[50] : palette.bg.muted },
            ]}
          >
            <Ionicons name={owes ? 'arrow-up' : credit ? 'arrow-down' : 'checkmark'} size={18} color={balanceColor} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[debtStyles.balanceLabel, { color: palette.text.tertiary }]}>{balanceLabel}</Text>
            <Text style={[debtStyles.balanceValue, { color: balanceColor }]} numberOfLines={1} adjustsFontSizeToFit>
              {formatMoney(Math.abs(balance))}
            </Text>
          </View>
          {isLoading && !summary ? <ActivityIndicator size="small" color={palette.text.tertiary} /> : null}
        </View>

        {/* Action buttons — role-gated to director/admin/superadmin. */}
        {canManage ? (
          <View style={debtStyles.actionsRow}>
            <TouchableOpacity
              style={[debtStyles.actionBtn, { backgroundColor: colors.red[50] }]}
              onPress={() => openPrompt('charge')}
              activeOpacity={0.7}
            >
              <Ionicons name="add-circle-outline" size={16} color={colors.red[600]} />
              <Text style={[debtStyles.actionBtnText, { color: colors.red[600] }]}>Добавить долг</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[debtStyles.actionBtn, { backgroundColor: colors.green[50] }]}
              onPress={() => openPrompt('payment')}
              activeOpacity={0.7}
            >
              <Ionicons name="cash-outline" size={16} color={colors.green[600]} />
              <Text style={[debtStyles.actionBtnText, { color: colors.green[600] }]}>Принять оплату</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Ledger — newest first. Charge red (+), payment green (−). */}
        {ledger.length > 0 ? (
          <View style={[debtStyles.ledgerWrap, { borderTopColor: palette.border.subtle }]}>
            {ledger.map((entry) => {
              const isCharge = entry.type === 'charge';
              const entryColor = isCharge ? colors.red[600] : colors.green[600];
              const meta = [
                entry.checkNumber ? `Чек №${entry.checkNumber}` : null,
                entry.createdByName || null,
                formatDate(entry.createdAt),
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <View key={entry.id} style={[debtStyles.ledgerRow, { borderBottomColor: palette.border.subtle }]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[debtStyles.ledgerReason, { color: palette.text.primary }]} numberOfLines={1}>
                      {entry.reason || (isCharge ? 'Начисление долга' : 'Оплата')}
                    </Text>
                    {meta ? (
                      <Text style={[debtStyles.ledgerMeta, { color: palette.text.tertiary }]} numberOfLines={1}>
                        {meta}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={[debtStyles.ledgerAmount, { color: entryColor }]}>
                    {isCharge ? '+' : '−'}
                    {formatMoney(entry.amount)}
                  </Text>
                </View>
              );
            })}
          </View>
        ) : !isLoading ? (
          <Text style={[debtStyles.emptyLedger, { color: palette.text.tertiary }]}>Движений по долгу пока нет</Text>
        ) : null}
      </AnimatedCard>

      {/* Read-only «Незакрытые заказ-наряды» — outstanding deferred checks,
          NOT counted in the balance. Tap opens the check. */}
      {deferred.length > 0 ? (
        <>
          <SectionHeader title="Незакрытые заказ-наряды" count={deferred.length} />
          <AnimatedCard
            style={[styles.metaCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
            index={3}
          >
            {deferred.map((dc, i) => (
              <TouchableOpacity
                key={dc.id}
                style={[
                  debtStyles.deferredRow,
                  i < deferred.length - 1
                    ? { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border.subtle }
                    : null,
                ]}
                onPress={() => {
                  haptic('select');
                  onOpenCheck(dc.id);
                }}
                activeOpacity={0.7}
              >
                <View style={[debtStyles.deferredIcon, { backgroundColor: palette.bg.muted }]}>
                  <Ionicons name="document-text-outline" size={15} color={palette.text.secondary} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={[debtStyles.deferredNumber, { color: palette.text.primary }]} numberOfLines={1}>
                    Заказ-наряд №{dc.number}
                  </Text>
                  <Text style={[debtStyles.deferredMeta, { color: palette.text.tertiary }]} numberOfLines={1}>
                    {formatDate(dc.date)}
                  </Text>
                </View>
                <Text style={[debtStyles.deferredTotal, { color: palette.text.secondary }]}>
                  {formatMoney(dc.totalRevenue)}
                </Text>
                <Ionicons name="chevron-forward" size={15} color={palette.text.tertiary} />
              </TouchableOpacity>
            ))}
          </AnimatedCard>
        </>
      ) : null}

      {/* Amount prompt — Modal + TextInput (Android-safe; never Alert.prompt). */}
      <Modal
        visible={promptMode !== null}
        onClose={closePrompt}
        title={promptMode === 'charge' ? 'Добавить долг' : 'Принять оплату'}
      >
        <Text style={[debtStyles.fieldLabel, { color: palette.text.secondary }]}>Сумма, ₽</Text>
        <TextInput
          style={[
            debtStyles.input,
            { backgroundColor: palette.bg.muted, color: palette.text.primary, borderColor: palette.border.subtle },
          ]}
          value={amountText}
          onChangeText={setAmountText}
          placeholder="0"
          placeholderTextColor={palette.text.tertiary}
          keyboardType="decimal-pad"
          autoFocus
          returnKeyType="done"
        />
        <Text style={[debtStyles.fieldLabel, { color: palette.text.secondary, marginTop: spacing[3] }]}>
          Комментарий (необязательно)
        </Text>
        <TextInput
          style={[
            debtStyles.input,
            { backgroundColor: palette.bg.muted, color: palette.text.primary, borderColor: palette.border.subtle },
          ]}
          value={reasonText}
          onChangeText={setReasonText}
          placeholder={promptMode === 'charge' ? 'За что долг' : 'Комментарий к оплате'}
          placeholderTextColor={palette.text.tertiary}
          returnKeyType="done"
        />
        <TouchableOpacity
          style={[
            debtStyles.submitBtn,
            { backgroundColor: promptMode === 'charge' ? colors.red[600] : colors.green[600] },
            (!amountValid || submitting) && debtStyles.submitBtnDisabled,
          ]}
          onPress={handleSubmit}
          disabled={!amountValid || submitting}
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Text style={debtStyles.submitBtnText}>{promptMode === 'charge' ? 'Добавить долг' : 'Принять оплату'}</Text>
          )}
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const debtStyles = StyleSheet.create({
  balanceRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  balanceIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  balanceLabel: { fontSize: 12, fontWeight: fontWeight.medium },
  balanceValue: { fontSize: 22, fontWeight: fontWeight.bold, letterSpacing: -0.4, marginTop: 2 },

  actionsRow: { flexDirection: 'row', gap: spacing[2.5], marginTop: spacing[3.5] },
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[1.5],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
  },
  actionBtnText: { fontSize: 13, fontWeight: fontWeight.semibold },

  ledgerWrap: { marginTop: spacing[3.5], borderTopWidth: StyleSheet.hairlineWidth, paddingTop: spacing[1] },
  ledgerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[2.5],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  ledgerReason: { fontSize: 14, fontWeight: fontWeight.medium },
  ledgerMeta: { fontSize: 12, marginTop: 2 },
  ledgerAmount: { fontSize: 15, fontWeight: fontWeight.bold, letterSpacing: -0.2 },
  emptyLedger: { fontSize: 13, marginTop: spacing[3], textAlign: 'center' },

  deferredRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingVertical: spacing[3] },
  deferredIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deferredNumber: { fontSize: 14, fontWeight: fontWeight.semibold },
  deferredMeta: { fontSize: 12, marginTop: 2 },
  deferredTotal: { fontSize: 14, fontWeight: fontWeight.semibold, letterSpacing: -0.2 },

  fieldLabel: { fontSize: 13, fontWeight: fontWeight.medium, marginBottom: spacing[1.5] },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[3],
    fontSize: 16,
  },
  submitBtn: {
    marginTop: spacing[5],
    paddingVertical: spacing[3.5],
    borderRadius: borderRadius.xl,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
  },
  submitBtnDisabled: { opacity: 0.5 },
  submitBtnText: { color: colors.white, fontSize: 16, fontWeight: fontWeight.semibold },
});

// ── ClientBonusSection (Бонусы / лояльность) ──────────────────────────
// Per-client bonus ledger. Reads GET /loyalty/client/:id (balance + totals +
// newest-first ledger). «Начислить» (adjust accrual) and «Списать» (adjust
// redemption) are owner-class manual corrections — role-gated here and
// enforced server-side — each requiring a reason. Every mutation returns the
// refreshed summary, which we write straight into cache so the balance + ledger
// update instantly, then invalidate ['loyalty','client',id].
//
// The whole section self-hides when the programme is OFF *and* the balance is 0
// — there's simply nothing to show, so we don't clutter the card. A leftover
// balance after a programme is switched off still renders (it stays spendable).
interface ClientBonusSectionProps {
  clientId: string;
  canManage: boolean;
  palette: ReturnType<typeof useColors>;
}

function ClientBonusSection({ clientId, canManage, palette }: ClientBonusSectionProps) {
  const queryClient = useQueryClient();
  const [promptMode, setPromptMode] = useState<BonusType | null>(null);
  const [amountText, setAmountText] = useState('');
  const [reasonText, setReasonText] = useState('');

  const { data: summary } = useQuery<ClientBonusSummary>({
    queryKey: ['loyalty', 'client', clientId],
    queryFn: async () => (await loyaltyApi.clientSummary(clientId)).data,
  });

  const applySummary = useCallback(
    (data: ClientBonusSummary) => {
      queryClient.setQueryData(['loyalty', 'client', clientId], data);
      queryClient.invalidateQueries({ queryKey: ['loyalty', 'client', clientId] });
    },
    [queryClient, clientId],
  );

  const closePrompt = useCallback(() => {
    setPromptMode(null);
    setAmountText('');
    setReasonText('');
  }, []);

  const adjustMutation = useMutation({
    mutationFn: (data: { amount: number; type: BonusType; reason: string }) =>
      loyaltyApi.adjust({ clientId, amount: data.amount, type: data.type, reason: data.reason }),
    onSuccess: (res) => {
      applySummary(res.data);
      haptic('success');
      closePrompt();
    },
    onError: () => {
      haptic('error');
      Alert.alert('Ошибка', 'Не удалось изменить бонусы');
    },
  });

  const openPrompt = (mode: BonusType) => {
    haptic('tap');
    setAmountText('');
    setReasonText('');
    setPromptMode(mode);
  };

  const parsedAmount = useMemo(() => {
    const normalized = amountText.replace(/\s/g, '').replace(',', '.');
    const n = Number(normalized);
    return Number.isFinite(n) ? n : NaN;
  }, [amountText]);
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount > 0;
  const reasonValid = reasonText.trim().length > 0;
  const submitting = adjustMutation.isPending;

  const handleSubmit = () => {
    // adjust requires a reason server-side — both fields gate submit.
    if (!amountValid || !reasonValid || submitting || !promptMode) return;
    adjustMutation.mutate({ amount: parsedAmount, type: promptMode, reason: reasonText.trim() });
  };

  // Hide until the first load lands (no flash of empty), then hide entirely
  // when the programme is off AND there's nothing accumulated.
  const balance = summary?.balance ?? 0;
  if (!summary) return null;
  if (!summary.enabled && balance === 0) return null;

  const ledger = summary.ledger ?? [];

  return (
    <>
      <SectionHeader title="Бонусы" />
      <AnimatedCard
        style={[styles.metaCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
        index={2}
      >
        {/* Balance header — prominent, on-brand accent. */}
        <View style={debtStyles.balanceRow}>
          <View style={[debtStyles.balanceIcon, { backgroundColor: palette.accent.primarySoft }]}>
            <Ionicons name="gift" size={18} color={palette.accent.primaryText} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={[debtStyles.balanceLabel, { color: palette.text.tertiary }]}>Бонусный баланс</Text>
            <Text
              style={[debtStyles.balanceValue, { color: palette.accent.primaryText }]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {formatMoney(balance)}
            </Text>
          </View>
        </View>

        {/* Totals — всего начислено / списано за всё время. */}
        <View style={[bonusStyles.totalsRow, { borderTopColor: palette.border.subtle }]}>
          <View style={bonusStyles.totalItem}>
            <Text style={[bonusStyles.totalLabel, { color: palette.text.tertiary }]}>Начислено всего</Text>
            <Text style={[bonusStyles.totalValue, { color: colors.green[600] }]} numberOfLines={1} adjustsFontSizeToFit>
              {formatMoney(summary.totalAccrued)}
            </Text>
          </View>
          <View style={[bonusStyles.totalDivider, { backgroundColor: palette.border.subtle }]} />
          <View style={bonusStyles.totalItem}>
            <Text style={[bonusStyles.totalLabel, { color: palette.text.tertiary }]}>Списано всего</Text>
            <Text
              style={[bonusStyles.totalValue, { color: colors.orange[600] }]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {formatMoney(summary.totalRedeemed)}
            </Text>
          </View>
        </View>

        {!summary.enabled ? (
          <Text style={[bonusStyles.disabledNote, { color: palette.text.tertiary }]}>
            Программа лояльности выключена — накопленные бонусы можно списать.
          </Text>
        ) : null}

        {/* Action buttons — owner-class manual adjust. «Списать» disabled at 0. */}
        {canManage ? (
          <View style={debtStyles.actionsRow}>
            <TouchableOpacity
              style={[debtStyles.actionBtn, { backgroundColor: colors.green[50] }]}
              onPress={() => openPrompt('accrual')}
              activeOpacity={0.7}
            >
              <Ionicons name="add-circle-outline" size={16} color={colors.green[600]} />
              <Text style={[debtStyles.actionBtnText, { color: colors.green[600] }]}>Начислить</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[debtStyles.actionBtn, { backgroundColor: colors.orange[50] }, balance <= 0 && { opacity: 0.5 }]}
              onPress={() => openPrompt('redemption')}
              activeOpacity={0.7}
              disabled={balance <= 0}
            >
              <Ionicons name="remove-circle-outline" size={16} color={colors.orange[600]} />
              <Text style={[debtStyles.actionBtnText, { color: colors.orange[600] }]}>Списать</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {/* Ledger — newest first. Accrual green (+), redemption orange (−). */}
        {ledger.length > 0 ? (
          <View style={[debtStyles.ledgerWrap, { borderTopColor: palette.border.subtle }]}>
            {ledger.map((entry) => {
              const isAccrual = entry.type === 'accrual';
              const entryColor = isAccrual ? colors.green[600] : colors.orange[600];
              const meta = [
                entry.checkNumber ? `Чек №${entry.checkNumber}` : null,
                entry.createdByName || null,
                formatDate(entry.createdAt),
              ]
                .filter(Boolean)
                .join(' · ');
              return (
                <View key={entry.id} style={[debtStyles.ledgerRow, { borderBottomColor: palette.border.subtle }]}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[debtStyles.ledgerReason, { color: palette.text.primary }]} numberOfLines={1}>
                      {entry.reason || (isAccrual ? 'Начисление бонусов' : 'Списание бонусов')}
                    </Text>
                    {meta ? (
                      <Text style={[debtStyles.ledgerMeta, { color: palette.text.tertiary }]} numberOfLines={1}>
                        {meta}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={[debtStyles.ledgerAmount, { color: entryColor }]}>
                    {isAccrual ? '+' : '−'}
                    {formatMoney(entry.amount)}
                  </Text>
                </View>
              );
            })}
          </View>
        ) : (
          <Text style={[debtStyles.emptyLedger, { color: palette.text.tertiary }]}>Движений по бонусам пока нет</Text>
        )}
      </AnimatedCard>

      {/* Amount + reason prompt — Modal + TextInput (Android-safe). adjust
          requires a reason, so both fields gate the submit. */}
      <Modal
        visible={promptMode !== null}
        onClose={closePrompt}
        title={promptMode === 'accrual' ? 'Начислить бонусы' : 'Списать бонусы'}
      >
        <Text style={[debtStyles.fieldLabel, { color: palette.text.secondary }]}>Сумма бонусов, ₽</Text>
        <TextInput
          style={[
            debtStyles.input,
            { backgroundColor: palette.bg.muted, color: palette.text.primary, borderColor: palette.border.subtle },
          ]}
          value={amountText}
          onChangeText={setAmountText}
          placeholder="0"
          placeholderTextColor={palette.text.tertiary}
          keyboardType="decimal-pad"
          autoFocus
          returnKeyType="done"
        />
        {promptMode === 'redemption' ? (
          <Text style={[bonusStyles.availableHint, { color: palette.text.tertiary }]}>
            Доступно к списанию: {formatMoney(balance)}
          </Text>
        ) : null}
        <Text style={[debtStyles.fieldLabel, { color: palette.text.secondary, marginTop: spacing[3] }]}>Причина</Text>
        <TextInput
          style={[
            debtStyles.input,
            { backgroundColor: palette.bg.muted, color: palette.text.primary, borderColor: palette.border.subtle },
          ]}
          value={reasonText}
          onChangeText={setReasonText}
          placeholder={promptMode === 'accrual' ? 'За что начисление' : 'За что списание'}
          placeholderTextColor={palette.text.tertiary}
          returnKeyType="done"
        />
        <TouchableOpacity
          style={[
            debtStyles.submitBtn,
            { backgroundColor: promptMode === 'accrual' ? colors.green[600] : colors.orange[600] },
            (!amountValid || !reasonValid || submitting) && debtStyles.submitBtnDisabled,
          ]}
          onPress={handleSubmit}
          disabled={!amountValid || !reasonValid || submitting}
          activeOpacity={0.85}
        >
          {submitting ? (
            <ActivityIndicator size="small" color={colors.white} />
          ) : (
            <Text style={debtStyles.submitBtnText}>{promptMode === 'accrual' ? 'Начислить' : 'Списать'}</Text>
          )}
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const bonusStyles = StyleSheet.create({
  totalsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing[3.5],
    paddingTop: spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  totalItem: { flex: 1, alignItems: 'center' },
  totalDivider: { width: StyleSheet.hairlineWidth, height: 30 },
  totalLabel: { fontSize: 12, fontWeight: fontWeight.medium },
  totalValue: { fontSize: 16, fontWeight: fontWeight.bold, letterSpacing: -0.2, marginTop: 3 },
  disabledNote: { fontSize: 12, marginTop: spacing[3], lineHeight: 17 },
  availableHint: { fontSize: 12, marginTop: spacing[1.5] },
});

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

  // Hero — centred avatar / name / phone, then a divided stat row.
  heroCard: {
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[5],
    paddingBottom: spacing[4],
    alignItems: 'center',
  },
  heroBadgesRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    marginTop: spacing[3],
    flexWrap: 'wrap',
  },
  heroDateChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  heroDate: { fontSize: 11, fontWeight: '500' },
  heroPhone: { fontSize: 14, fontWeight: '500', marginTop: spacing[1], fontVariant: ['tabular-nums'] },
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

  avatarLg: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLgText: { fontSize: 24, fontWeight: '700', color: colors.white, letterSpacing: 0.5 },
  clientName: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: -0.4,
    color: colors.gray[900],
    textAlign: 'center',
    marginTop: spacing[3],
  },

  // Stat tiles row — three even columns split by hairline dividers.
  statTilesRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    alignSelf: 'stretch',
    marginTop: spacing[4],
    paddingTop: spacing[3.5],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  statTile: {
    flex: 1,
    paddingHorizontal: spacing[1],
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  statTileDivider: { width: StyleSheet.hairlineWidth, alignSelf: 'stretch', marginVertical: spacing[0.5] },
  statTileValue: { fontSize: 15, fontWeight: '700', letterSpacing: -0.3, fontVariant: ['tabular-nums'] },
  statTileLabel: { fontSize: 11, fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.4 },

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

  // Meta (staff-only info — note / source / comment)
  metaCard: {
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[0.5],
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  metaIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaText: { flex: 1, minWidth: 0, gap: 2 },
  metaLabel: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.3 },
  metaValue: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, lineHeight: 19 },

  // «+ Добавить» affordance in a section header.
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: spacing[2.5],
    paddingVertical: spacing[1.5],
    borderRadius: borderRadius.full,
  },
  addBtnText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold },

  // Empty cars
  emptyCars: {
    alignItems: 'center',
    paddingVertical: spacing[6],
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    gap: spacing[3],
  },
  emptyCarsIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCarsText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },

  // Car cards
  carCard: {
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: colors.gray[100],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3.5],
    paddingBottom: spacing[3],
  },
  carTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  carInfo: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], flex: 1, minWidth: 0 },
  carIconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  carModel: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, color: colors.gray[900], letterSpacing: -0.2 },
  // ГОСТ-style mini plate badge (white plate, black rim) — the plate is
  // the identity anchor of the car card.
  carPlateBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1.5,
    backgroundColor: '#FFFFFF',
    marginTop: 6,
  },
  carPlateBadgeText: { fontSize: 13, fontWeight: '800', letterSpacing: 1.2, color: '#0A0A0A' },
  plateBadgeRow: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: colors.gray[100],
    marginTop: 6,
  },
  plateBadgeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  carTopRight: { flexDirection: 'row', alignItems: 'center', gap: spacing[0.5] },
  carChevron: { marginLeft: spacing[0.5], opacity: 0.9 },
  carActions: { flexDirection: 'row', alignItems: 'center', gap: spacing[0.5] },
  iconBtn: { padding: spacing[2], borderRadius: borderRadius.md },
  carComment: {
    fontSize: fontSize.xs,
    color: colors.gray[400],
    marginTop: spacing[2.5],
    marginLeft: 52,
    lineHeight: 17,
  },

  // Per-car stat strip — последний пробег | потрачено на это авто.
  carStatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing[3],
    paddingTop: spacing[2.5],
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  carStatItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  carStatCol: { flex: 1, minWidth: 0, gap: 1 },
  carStatDivider: { width: StyleSheet.hairlineWidth, height: 30, marginHorizontal: spacing[3] },
  carStatLabel: { fontSize: 10, fontWeight: '600', letterSpacing: 0.3, textTransform: 'uppercase' },
  carStatValue: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, fontVariant: ['tabular-nums'] },

  // Card title — 16pt semibold heading used inside a card body.
  cardTitle: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, letterSpacing: -0.2 },
  // Section-header rhythm forwarded to <ClientCallsSection /> so its own
  // header lines up with the SectionHeader component used elsewhere.
  callsSectionHeader: { marginTop: spacing[2], marginBottom: 0, paddingHorizontal: spacing[1] },

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
  carChipsScroll: { marginTop: spacing[1] },
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

  emptyChecks: {
    alignItems: 'center',
    paddingVertical: spacing[6],
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    gap: spacing[3],
    marginTop: spacing[1],
  },
  emptyChecksIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyChecksText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },

  // «Показать всю историю» — lazy-history affordance (audit #8).
  showAllHistoryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing[3],
    paddingVertical: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  showAllHistoryText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },

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
