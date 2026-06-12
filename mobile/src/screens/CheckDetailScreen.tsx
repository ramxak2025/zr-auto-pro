import React, { useRef, useEffect, useState, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Alert,
  Animated,
  Modal as RNModal,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRoute, useNavigation } from '@react-navigation/native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as ImagePicker from 'expo-image-picker';
import { checksApi, myCompanyApi, checkPhotosApi, returnsApi, knowledgeApi } from '../api/services';
import { openClient, openCarOwner, openEmployee } from '../navigation/entityLinks';
import { useAuth } from '../contexts/AuthContext';
import LoadingSpinner from '../components/LoadingSpinner';
import FeatureGate from '../components/FeatureGate';
import Modal from '../components/Modal';
import { haptic } from '../platform/haptics';
import { useColors } from '../contexts/ThemeContext';
import { useTabBarHeight } from '../hooks/useTabBarHeight';
import { colors, fontSize, fontWeight, borderRadius, spacing, badgeColors, paymentMethodBadgeColor } from '../theme';
import type { Check, Tenant, KnowledgeForCar, KnowledgeArticle } from '../../../shared/types';

type ReturnDestination = 'warehouse' | 'defect';
type ReturnScope = 'full' | 'partial';

function formatMoney(v: number) {
  return (
    Math.round(v)
      .toString()
      .replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' ₽'
  );
}

// Экранируем любое свободное текстовое значение перед вставкой в HTML чека/PDF.
// Имена клиента/компании/авто с символами < > & " ' иначе ломают разметку
// или «съедают» текст в сгенерированном PDF. Применять ко ВСЕМ значениям из
// данных; числа/даты, которые мы форматируем сами, экранировать не нужно.
function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function formatDate(d: string) {
  return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });
}
function formatDateTime(d: string) {
  const dt = new Date(d);
  return formatDate(d) + ', ' + dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}
function formatShortDate(d: string) {
  return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
function formatTime(d: string) {
  return new Date(d).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

const paymentLabels: Record<string, string> = {
  cash: 'Наличные',
  card: 'Карта',
  warranty: 'Гарантия',
  cash_card: 'Нал/Карта',
};
const paymentIcons: Record<string, keyof typeof Ionicons.glyphMap> = {
  cash: 'cash-outline',
  card: 'card-outline',
  warranty: 'shield-checkmark-outline',
  cash_card: 'swap-horizontal-outline',
};

/** Parse the car make (first token) from a "make model" string, e.g.
 *  "Lada Priora" → "Lada". Empty when no usable text. */
function parseCarMake(makeModel?: string | null): string {
  if (!makeModel) return '';
  return makeModel.trim().split(/\s+/)[0] || '';
}

/**
 * KnowledgeForCarRow — additive, below-the-main-content affordance on the
 * check detail. Surfaces the contextual Knowledge Base for the check's car
 * make (regulations + typical works) and, when present, intake/handover
 * checklists. Renders NOTHING when there's nothing relevant. Crash-safe
 * deep-nav via the `MoreTab` nested route (KB screens live in MoreStack).
 */
function KnowledgeForCarRow({
  makeModel,
  navigation,
  palette,
}: {
  makeModel?: string | null;
  navigation: any;
  palette: ReturnType<typeof useColors>;
}) {
  const [open, setOpen] = useState(false);
  const make = useMemo(() => parseCarMake(makeModel), [makeModel]);

  const { data: forCar } = useQuery<KnowledgeForCar>({
    queryKey: ['knowledge-for-car', make],
    queryFn: async () => (await knowledgeApi.forCar({ make })).data,
    enabled: !!make,
    staleTime: 10 * 60_000,
    placeholderData: (prev) => prev,
  });
  // Checklists are make-agnostic — only fetched once the sheet is opened
  // so we never spend a request on a screen the user doesn't expand.
  const { data: checklists } = useQuery<KnowledgeArticle[]>({
    queryKey: ['knowledge-checklists'],
    queryFn: async () => (await knowledgeApi.listChecklists()).data,
    enabled: open,
    staleTime: 10 * 60_000,
    placeholderData: (prev) => prev,
  });

  const articles = forCar?.articles ?? [];
  const troubleshooting = forCar?.troubleshooting ?? [];
  const lists = checklists ?? [];
  const hasContent = articles.length > 0 || troubleshooting.length > 0;

  const openArticle = (articleId: string) => {
    setOpen(false);
    navigation.navigate('MoreTab', { screen: 'KnowledgeArticle', params: { id: articleId } });
  };
  const openTrouble = (id: string) => {
    setOpen(false);
    navigation.navigate('MoreTab', { screen: 'KnowledgeTroubleshootingDetail', params: { id } });
  };

  if (!make || !hasContent) return null;

  return (
    <>
      <TouchableOpacity
        onPress={() => setOpen(true)}
        activeOpacity={0.7}
        style={[styles.kbRow, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}
        accessibilityLabel={`Регламенты и типовые работы для ${make}`}
      >
        <View style={[styles.kbRowIcon, { backgroundColor: colors.indigo[50] }]}>
          <Ionicons name="book" size={16} color={colors.indigo[600]} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.kbRowTitle, { color: palette.text.primary }]} numberOfLines={1}>
            Регламенты и типовые работы
          </Text>
          <Text style={[styles.kbRowSub, { color: palette.text.tertiary }]} numberOfLines={1}>
            для марки {make}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} />
      </TouchableOpacity>

      <Modal visible={open} onClose={() => setOpen(false)} title={`База знаний · ${make}`}>
        {articles.length > 0 && (
          <View style={styles.kbSheetGroup}>
            <Text style={[styles.kbSheetGroupLabel, { color: palette.text.tertiary }]}>РЕГЛАМЕНТЫ И СТАТЬИ</Text>
            {articles.map((a) => (
              <TouchableOpacity
                key={a.id}
                onPress={() => openArticle(a.id)}
                activeOpacity={0.7}
                style={[styles.kbSheetRow, { borderBottomColor: palette.border.subtle }]}
              >
                <Ionicons
                  name={a.type === 'regulation' ? 'shield-checkmark-outline' : 'document-text-outline'}
                  size={16}
                  color={colors.indigo[600]}
                />
                <Text style={[styles.kbSheetRowText, { color: palette.text.primary }]} numberOfLines={2}>
                  {a.title}
                </Text>
                <Ionicons name="chevron-forward" size={14} color={palette.text.tertiary} />
              </TouchableOpacity>
            ))}
          </View>
        )}
        {troubleshooting.length > 0 && (
          <View style={styles.kbSheetGroup}>
            <Text style={[styles.kbSheetGroupLabel, { color: palette.text.tertiary }]}>ТИПОВЫЕ НЕИСПРАВНОСТИ</Text>
            {troubleshooting.map((t) => (
              <TouchableOpacity
                key={t.id}
                onPress={() => openTrouble(t.id)}
                activeOpacity={0.7}
                style={[styles.kbSheetRow, { borderBottomColor: palette.border.subtle }]}
              >
                <Ionicons name="construct-outline" size={16} color={colors.orange[500]} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.kbSheetRowText, { color: palette.text.primary }]} numberOfLines={2}>
                    {t.title}
                  </Text>
                  {!!t.system && (
                    <Text style={[styles.kbSheetRowSub, { color: palette.text.tertiary }]} numberOfLines={1}>
                      {t.system}
                    </Text>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={14} color={palette.text.tertiary} />
              </TouchableOpacity>
            ))}
          </View>
        )}
        {lists.length > 0 && (
          <View style={styles.kbSheetGroup}>
            <Text style={[styles.kbSheetGroupLabel, { color: palette.text.tertiary }]}>ЧЕК-ЛИСТЫ ПРИЁМКИ/ВЫДАЧИ</Text>
            {lists.map((a) => (
              <TouchableOpacity
                key={a.id}
                onPress={() => openArticle(a.id)}
                activeOpacity={0.7}
                style={[styles.kbSheetRow, { borderBottomColor: palette.border.subtle }]}
              >
                <Ionicons name="checkbox-outline" size={16} color={colors.teal[600]} />
                <Text style={[styles.kbSheetRowText, { color: palette.text.primary }]} numberOfLines={2}>
                  {a.title}
                </Text>
                <Ionicons name="chevron-forward" size={14} color={palette.text.tertiary} />
              </TouchableOpacity>
            ))}
          </View>
        )}
      </Modal>
    </>
  );
}

export default function CheckDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const { hasPermission, user } = useAuth();
  const palette = useColors();
  const { id } = route.params;
  // ── Возврат заказ-наряда ────────────────────────────────────────────
  // Видна только для директора / администратора / superadmin: оформление
  // возврата — финансово ответственное действие, мастер не должен иметь
  // к нему доступ. Mapping роли на permission — собственно роли (бэк
  // PermissionGuard не проверяет наш новый endpoint, но UI-уровень
  // отрезает мастеров сразу).
  const canFileReturn = user?.role === 'director' || user?.role === 'admin' || user?.role === 'superadmin';
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [returnScope, setReturnScope] = useState<ReturnScope>('full');
  const [returnDestination, setReturnDestination] = useState<ReturnDestination>('warehouse');
  const [returnReason, setReturnReason] = useState('');
  const [returnRefundAmount, setReturnRefundAmount] = useState('');
  // Map: stable line key → { selected, qty } для partial-режима. Ключ —
  // `s-<id>` для услуг, `p-<id>` для товаров, чтобы не было коллизий.
  const [returnLines, setReturnLines] = useState<Record<string, { selected: boolean; qty: number }>>({});
  // Floating tab bar covers the bottom edge (CheckDetail lives inside the
  // tab navigator's stack, so the bar IS visible). Reserve its height so
  // the last block can scroll fully into view + leaves a small breathing
  // gap above the icon row.
  const tabBarHeight = useTabBarHeight();

  // Entrance animation
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(30)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 350, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 350, useNativeDriver: true }),
    ]).start();
  }, []);

  // placeholderData выполняет lookup в кеше журнала (`['checks-infinite', ...]`)
  // безопасно: если row найдена — возвращаем её ТОЛЬКО как visual placeholder,
  // в каноничный кеш не пишем. Это значит, что full payload, придя с сервера,
  // полностью заменит её без mutation-клина. Раньше ChecksScreen делал
  // queryClient.setQueryData(...), что приводило к крэшу: list-payload не
  // содержит services/products, а CheckDetailScreen обращался к ним через
  // .length. Теперь даже если placeholder неполный — guards ниже спасают,
  // и реальные данные подъезжают через queryFn.
  const { data: check, isLoading } = useQuery<Check>({
    queryKey: ['check', id],
    queryFn: async () => {
      const res = await checksApi.getById(id);
      return res.data;
    },
    // CRITICAL screen for an ACTIVE check — payment status must
    // never be stale. Refetch on every mount so the owner can never
    // mark a check as "paid" twice while looking at last week's
    // cached payment row. The list-payload placeholder below still
    // gives an instant visual transition from journal → detail, but
    // the canonical query refetches in the background.
    refetchOnMount: 'always',
    staleTime: 30_000,
    placeholderData: (prev) => {
      if (prev) return prev;
      try {
        const queries = queryClient.getQueriesData<{ pages?: { data?: Check[] }[] }>({
          queryKey: ['checks-infinite'],
        });
        for (const [, data] of queries) {
          for (const page of data?.pages ?? []) {
            const found = page?.data?.find((c) => c.id === id);
            if (found) return found;
          }
        }
      } catch {
        /* swallow — placeholder is best-effort */
      }
      return undefined;
    },
  });

  // Безопасные локальные ссылки на массивы (list-payload может вернуть undefined).
  const services = check?.services ?? [];
  const products = check?.products ?? [];
  // Выданные гарантии — берём из полного payload'а GET /checks/:id. List
  // payload их не отдаёт, поэтому placeholder из ['checks-infinite'] не
  // покажет секцию до подъезда детального запроса.
  const warrantyClaims = check?.warrantyClaims ?? [];

  const { data: company } = useQuery<Tenant>({
    queryKey: ['my-company'],
    queryFn: async () => (await myCompanyApi.get()).data,
    staleTime: 5 * 60_000,
  });

  // ── Photo attachments ──────────────────────────────────────────────────────
  const { data: photos = [], refetch: refetchPhotos } = useQuery<
    Array<{ id: string; checkId: string; photoUrl: string; createdAt: string; createdBy: string }>
  >({
    queryKey: ['check-photos', id],
    queryFn: async () => {
      const res = await checkPhotosApi.getByCheck(id);
      return res.data;
    },
    staleTime: 30_000,
  });

  const uploadPhotoMutation = useMutation({
    mutationFn: async () => {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      const uri = asset.uri;
      const filename = uri.split('/').pop() || 'photo.jpg';
      const formData = new FormData();
      formData.append('photo', { uri, name: filename, type: 'image/jpeg' } as any);
      await checkPhotosApi.upload(id, formData);
    },
    onSuccess: () => refetchPhotos(),
    onError: () => Alert.alert('Ошибка', 'Не удалось загрузить фото'),
  });

  const deletePhotoMutation = useMutation({
    mutationFn: (photoId: string) => checkPhotosApi.remove(photoId),
    onSuccess: () => refetchPhotos(),
    onError: () => Alert.alert('Ошибка', 'Не удалось удалить фото'),
  });

  const handleDeletePhoto = (photoId: string) => {
    Alert.alert('Удалить фото?', 'Это действие необратимо', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => deletePhotoMutation.mutate(photoId) },
    ]);
  };

  const generatePdf = async () => {
    if (!check) return;
    const c = company;
    // Все строковые значения ниже — свободный текст из данных; экранируем их
    // через escapeHtml перед вставкой в HTML, иначе символы < > & " ' ломают
    // верстку чека/PDF. Числа и даты форматируем сами — их не экранируем.
    const companyName = escapeHtml(c?.legalName || c?.name || 'Автосервис');
    const inn = c?.inn ? `ИНН ${escapeHtml(c.inn)}` : '';
    const addr = escapeHtml(c?.address || '');
    const phone = escapeHtml(c?.phone || '');
    const footer = escapeHtml(c?.receiptFooter || '');
    const date = formatShortDate(check.date) + ' ' + formatTime(check.date);
    const safeServices = check.services ?? [];
    const safeProducts = check.products ?? [];
    const servicesHtml = safeServices
      .map(
        (s) =>
          `<tr><td>${escapeHtml(s.name)}</td><td style="text-align:right">${s.quantity}</td><td style="text-align:right">${formatMoney(s.total)}</td></tr>`,
      )
      .join('');
    const productsHtml = safeProducts
      .map(
        (p) =>
          `<tr><td>${escapeHtml(p.name)}</td><td style="text-align:right">${p.quantity}</td><td style="text-align:right">${formatMoney(p.totalSell)}</td></tr>`,
      )
      .join('');
    const html = `
      <html><head><meta charset="utf-8"/><style>
        body { font-family: sans-serif; font-size: 12px; padding: 16px; }
        h2 { margin: 0 0 4px; font-size: 16px; }
        .meta { color: #666; font-size: 11px; margin-bottom: 12px; }
        table { width: 100%; border-collapse: collapse; margin: 8px 0; }
        th, td { padding: 4px 0; border-bottom: 1px solid #eee; text-align: left; font-size: 11px; }
        th { font-weight: 600; color: #333; }
        .total { font-size: 14px; font-weight: bold; text-align: right; margin-top: 8px; }
        .footer { text-align: center; margin-top: 16px; font-size: 10px; color: #999; }
        hr { border: none; border-top: 1px dashed #ccc; margin: 8px 0; }
      </style></head><body>
        <h2>${companyName}</h2>
        <div class="meta">${[inn, addr, phone].filter(Boolean).join(' | ')}</div>
        <hr/>
        <div><strong>Чек #${check.number}</strong> от ${date}</div>
        ${check.client ? `<div>Клиент: ${escapeHtml(check.client.fullName)}</div>` : '<div>Клиент: Розничный покупатель</div>'}
        ${check.car ? `<div>Авто: ${escapeHtml(check.car.makeModel)} ${escapeHtml(check.car.plateNumber || '')}</div>` : ''}
        ${check.master ? `<div>Мастер: ${escapeHtml(check.master.fullName)}</div>` : ''}
        ${
          safeServices.length > 0
            ? `
          <h3 style="margin:12px 0 4px">Услуги</h3>
          <table><thead><tr><th>Название</th><th style="text-align:right">Кол.</th><th style="text-align:right">Сумма</th></tr></thead>
          <tbody>${servicesHtml}</tbody></table>
        `
            : ''
        }
        ${
          safeProducts.length > 0
            ? `
          <h3 style="margin:12px 0 4px">Товары</h3>
          <table><thead><tr><th>Название</th><th style="text-align:right">Кол.</th><th style="text-align:right">Сумма</th></tr></thead>
          <tbody>${productsHtml}</tbody></table>
        `
            : ''
        }
        <hr/>
        ${(check.discount ?? 0) > 0 ? `<div>Скидка: -${formatMoney(check.discount ?? 0)}</div>` : ''}
        <div class="total">ИТОГО: ${formatMoney(check.totalRevenue)}</div>
        <div style="font-size:11px;color:#666;text-align:right">${escapeHtml(paymentLabels[check.paymentMethod] || check.paymentMethod)}</div>
        ${footer ? `<div class="footer">${footer}</div>` : ''}
      </body></html>
    `;

    try {
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          mimeType: 'application/pdf',
          dialogTitle: `Чек #${check.number}`,
        });
      } else {
        Alert.alert('PDF создан', uri);
      }
    } catch {
      Alert.alert('Ошибка', 'Не удалось создать PDF');
    }
  };

  const deleteMutation = useMutation({
    mutationFn: () => checksApi.remove(id),
    onSuccess: () => {
      haptic('success');
      // Журнал живёт на ['checks-infinite'], дашборд и касса — на своих
      // ключах. Инвалидируем все потребители, иначе удалённый чек
      // продолжает висеть в списках до ручного pull-to-refresh.
      // ['products'] / ['low-stock'] сознательно НЕ трогаем: бэкенд при
      // удалении чека остатки на склад не возвращает.
      queryClient.invalidateQueries({ queryKey: ['checks'] });
      queryClient.invalidateQueries({ queryKey: ['checks-infinite'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-v2'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-chart'] });
      queryClient.invalidateQueries({ queryKey: ['checks-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['cashflow'] });
      // Чека больше нет — выкидываем его деталку из кеша, чтобы повторное
      // открытие по stale-ссылке не отрисовало удалённые данные.
      queryClient.removeQueries({ queryKey: ['check', id] });
      navigation.goBack();
    },
    onError: (err: any) => {
      haptic('error');
      Alert.alert('Ошибка', err?.response?.data?.message || 'Не удалось удалить чек');
    },
  });

  // ── «Принять оплату» по отложенному чеку ─────────────────────────
  // Web-parity: frontend CheckDetailPage делает PATCH { isDeferred: false }
  // — чек закрывается и попадает в выручку. paymentStatus НЕ шлём:
  // бэкенд сам выводит статус из isDeferred. Доступно только с
  // permission checks_edit (та же гейтовка, что и у кнопки «Изменить»).
  const acceptPaymentMutation = useMutation({
    mutationFn: () => checksApi.update(id, { isDeferred: false }),
    onSuccess: () => {
      haptic('success');
      queryClient.invalidateQueries({ queryKey: ['check', id] });
      queryClient.invalidateQueries({ queryKey: ['checks'] });
      queryClient.invalidateQueries({ queryKey: ['checks-infinite'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-v2'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-chart'] });
      queryClient.invalidateQueries({ queryKey: ['checks-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['cashflow'] });
    },
    onError: (err: any) => {
      haptic('error');
      Alert.alert('Ошибка', err?.response?.data?.message || 'Не удалось принять оплату');
    },
  });

  const handleAcceptPayment = () => {
    if (!check) return;
    haptic('select');
    Alert.alert('Принять оплату по чеку?', `Чек #${check.number} на ${formatMoney(check.totalRevenue)} будет закрыт.`, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Принять', onPress: () => acceptPaymentMutation.mutate() },
    ]);
  };

  // ── Return mutation ──────────────────────────────────────────────
  // POST /checks/:id/returns. На бэке атомарно:
  //   1. Помечает чек `isReturned=true` + сохраняет reason / returnedAt.
  //   2. По каждой возвращаемой строке товаров пишет stock_movement
  //      типа 'income' (target = main warehouse) или 'defect_transfer'
  //      (target = defect warehouse), в зависимости от destination.
  //   3. Книжит supplier_payment-like запись с отрицательной суммой,
  //      чтобы касса корректно отразила возврат денег клиенту.
  // Мы инвалидируем все журналы, дашборды и продукты — UI обновляется
  // сразу. Никакой optimistic-update: возврат — необратимое событие.
  const returnMutation = useMutation({
    mutationFn: (body: Parameters<typeof returnsApi.create>[1]) => returnsApi.create(id, body),
    onSuccess: () => {
      haptic('success');
      queryClient.invalidateQueries({ queryKey: ['checks'] });
      queryClient.invalidateQueries({ queryKey: ['checks-infinite'] });
      queryClient.invalidateQueries({ queryKey: ['check', id] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['stock-movements'] });
      // Real dashboard/journal keys (the legacy `['dashboard']` slug
      // didn't match any active query — see commit fixing CheckCreate).
      queryClient.invalidateQueries({ queryKey: ['dashboard-v2'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-chart'] });
      queryClient.invalidateQueries({ queryKey: ['checks-dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['low-stock'] });
      queryClient.invalidateQueries({ queryKey: ['warehouse-analytics'] });
      queryClient.invalidateQueries({ queryKey: ['cashflow'] });
      setReturnModalOpen(false);
      Alert.alert('Возврат оформлен', 'Чек помечен как возвращённый.');
    },
    onError: (err: any) => {
      haptic('error');
      Alert.alert('Ошибка', err?.response?.data?.message || 'Не удалось оформить возврат');
    },
  });

  // ── Открытие модалки возврата ────────────────────────────────────
  // Перезаполняем форму при каждом открытии: полный возврат, склад как
  // дефолтное направление, refund = totalRevenue. Карту строк строим
  // здесь же чтобы пользователь сразу мог переключиться в «частичный»
  // и видеть актуальные строки чека.
  const openReturnModal = () => {
    if (!check) return;
    haptic('select');
    setReturnScope('full');
    setReturnDestination('warehouse');
    setReturnReason('');
    setReturnRefundAmount(String(Math.round(check.totalRevenue)));
    const lineMap: Record<string, { selected: boolean; qty: number }> = {};
    (check.services ?? []).forEach((s, i) => {
      const key = `s-${s.id ?? i}`;
      lineMap[key] = { selected: false, qty: s.quantity };
    });
    (check.products ?? []).forEach((p, i) => {
      const key = `p-${p.id ?? i}`;
      lineMap[key] = { selected: false, qty: p.quantity };
    });
    setReturnLines(lineMap);
    setReturnModalOpen(true);
  };

  // ── Авторасчёт refund для «частичного» режима ────────────────────
  // Считаем только выбранные строки и пропорционально их qty. В full —
  // показываем total чека. Пользователь всегда может отредактировать.
  const partialRefundAuto = useMemo(() => {
    if (!check || returnScope !== 'partial') return 0;
    let sum = 0;
    (check.services ?? []).forEach((s, i) => {
      const key = `s-${s.id ?? i}`;
      const row = returnLines[key];
      if (row?.selected && s.quantity > 0) {
        sum += (row.qty / s.quantity) * s.total;
      }
    });
    (check.products ?? []).forEach((p, i) => {
      const key = `p-${p.id ?? i}`;
      const row = returnLines[key];
      if (row?.selected && p.quantity > 0) {
        sum += (row.qty / p.quantity) * p.totalSell;
      }
    });
    return Math.round(sum);
  }, [check, returnScope, returnLines]);

  // Когда пользователь меняет состав строк в режиме partial — обновляем
  // подсказку. В full — refund фиксирован = total. Авто-prefill отделён
  // от ручного override: если пользователь начал править поле, мы его
  // не топчем.
  const refundAutoPrefillRef = useRef<string>('');
  useEffect(() => {
    if (!returnModalOpen) return;
    const next = returnScope === 'full' ? String(Math.round(check?.totalRevenue ?? 0)) : String(partialRefundAuto);
    // Топчем поле только когда оно ещё равно прошлому auto-значению —
    // т.е. пользователь не вводил руками. Это разрешает менять чек-боксы
    // и видеть пересчёт, но защищает от тёрки введённой вручную суммы.
    if (returnRefundAmount === '' || returnRefundAmount === refundAutoPrefillRef.current) {
      setReturnRefundAmount(next);
    }
    refundAutoPrefillRef.current = next;
  }, [returnModalOpen, returnScope, partialRefundAuto, check?.totalRevenue]);

  const toggleReturnLine = (key: string) => {
    setReturnLines((prev) => {
      const row = prev[key];
      if (!row) return prev;
      return { ...prev, [key]: { ...row, selected: !row.selected } };
    });
  };

  const updateReturnLineQty = (key: string, delta: number, max: number) => {
    setReturnLines((prev) => {
      const row = prev[key];
      if (!row) return prev;
      const nextQty = Math.max(1, Math.min(max, row.qty + delta));
      return { ...prev, [key]: { ...row, qty: nextQty } };
    });
  };

  const handleSubmitReturn = () => {
    if (!check) return;
    if (returnDestination === 'defect' && !returnReason.trim()) {
      haptic('warning');
      Alert.alert('Ошибка', 'Укажите причину возврата в брак.');
      return;
    }
    const refund = Number(returnRefundAmount);
    if (!isFinite(refund) || refund < 0) {
      haptic('warning');
      Alert.alert('Ошибка', 'Сумма возврата должна быть положительной.');
      return;
    }
    const body: Parameters<typeof returnsApi.create>[1] = {
      destination: returnDestination,
      scope: returnScope,
      refundAmount: refund,
      ...(returnReason.trim() ? { reason: returnReason.trim() } : {}),
    };
    if (returnScope === 'partial') {
      const lines: NonNullable<Parameters<typeof returnsApi.create>[1]['lines']> = [];
      (check.services ?? []).forEach((s, i) => {
        const key = `s-${s.id ?? i}`;
        const row = returnLines[key];
        if (row?.selected && s.id) lines.push({ serviceLineId: s.id, quantity: row.qty });
      });
      (check.products ?? []).forEach((p, i) => {
        const key = `p-${p.id ?? i}`;
        const row = returnLines[key];
        if (row?.selected && p.id) lines.push({ productLineId: p.id, quantity: row.qty });
      });
      if (lines.length === 0) {
        haptic('warning');
        Alert.alert('Ошибка', 'Выберите хотя бы одну позицию для возврата.');
        return;
      }
      body.lines = lines;
    }
    returnMutation.mutate(body);
  };

  if (isLoading) return <LoadingSpinner />;
  if (!check) return <Text style={{ padding: 20, textAlign: 'center' }}>{'Чек не найден'}</Text>;

  // Возвращённые чеки заморожены: ни редактировать, ни удалять, ни
  // оформлять второй возврат. Permission остаётся, но UI его подавляет —
  // защищает от случайной операции и совпадает с состоянием бэка
  // (PATCH /checks/:id вернёт 409 на returned-чек).
  const isReturned = !!check.isReturned;
  const canEdit = hasPermission('checks_edit') && !isReturned;
  const canDelete = hasPermission('checks_delete') && !isReturned;
  const canViewProfit = hasPermission('profit_view');
  const badgeKey = paymentMethodBadgeColor[check.paymentMethod] || 'gray';
  const badge = badgeColors[badgeKey];
  const isDeferred = !!check.isDeferred;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.bg.canvas }]} edges={['top']}>
      {/* Modern header with gradient accent */}
      <View style={[styles.header, { backgroundColor: palette.bg.card, borderBottomColor: palette.border.subtle }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={20} color={colors.primary[600]} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[1.5], flexWrap: 'wrap' }}>
            <Text style={[styles.headerTitle, { color: palette.text.primary }]}>
              {'Чек'} #{check.number}
            </Text>
            {isReturned && (
              <View style={styles.returnedHeaderBadge}>
                <Ionicons name="arrow-undo" size={11} color={colors.white} />
                <Text style={styles.returnedHeaderBadgeText}>ВОЗВРАЩЁН</Text>
              </View>
            )}
          </View>
          <Text style={[styles.headerDate, { color: palette.text.tertiary }]}>{formatShortDate(check.date)}</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={generatePdf} style={[styles.actionBtn, { backgroundColor: palette.bg.muted }]}>
            <Ionicons name="document-text-outline" size={17} color={colors.violet[600]} />
          </TouchableOpacity>
          {/* Возврат заказ-наряда — компактная trailing-иконка в шапке.
              Видна только директору/админу/superadmin. На уже возвращённом
              чеке остаётся, но в disabled-состоянии (приглушённая, без
              нажатия) — пользователь видит, что возврат уже оформлен, и
              понимает почему действие недоступно. */}
          {canFileReturn && (
            <TouchableOpacity
              onPress={openReturnModal}
              disabled={isReturned}
              style={[styles.actionBtn, { backgroundColor: isReturned ? palette.bg.muted : colors.red[50] }]}
              accessibilityRole="button"
              accessibilityLabel={isReturned ? 'Возврат уже оформлен' : 'Оформить возврат'}
              accessibilityState={{ disabled: isReturned }}
              hitSlop={6}
            >
              <Ionicons
                name="arrow-undo-outline"
                size={17}
                color={isReturned ? palette.text.tertiary : colors.red[600]}
              />
            </TouchableOpacity>
          )}
          {canEdit && (
            <TouchableOpacity
              onPress={() => navigation.navigate('CheckCreate', { id: check.id })}
              style={[styles.actionBtn, { backgroundColor: palette.bg.muted }]}
            >
              <Ionicons name="create-outline" size={17} color={colors.primary[600]} />
            </TouchableOpacity>
          )}
          {canDelete && (
            <TouchableOpacity
              onPress={() => {
                Alert.alert('Удалить?', 'Это действие необратимо', [
                  { text: 'Отмена', style: 'cancel' },
                  {
                    text: 'Удалить',
                    style: 'destructive',
                    onPress: () => deleteMutation.mutate(),
                  },
                ]);
              }}
              style={[styles.actionBtn, { backgroundColor: colors.red[50] }]}
            >
              <Ionicons name="trash-outline" size={17} color={colors.red[500]} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <Animated.ScrollView
        style={[styles.scroll, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarHeight + spacing[4] }]}
        scrollIndicatorInsets={{ bottom: tabBarHeight }}
        contentInset={{ bottom: tabBarHeight }}
        automaticallyAdjustContentInsets={false}
        showsVerticalScrollIndicator={false}
      >
        {/* Status chip row */}
        <View style={styles.chipRow}>
          <View
            style={[
              styles.statusChip,
              isDeferred
                ? { backgroundColor: colors.amber[50], borderColor: colors.amber[200] }
                : { backgroundColor: colors.green[50], borderColor: colors.green[200] },
            ]}
          >
            <View
              style={[
                styles.statusDot,
                isDeferred ? { backgroundColor: colors.amber[600] } : { backgroundColor: colors.green[500] },
              ]}
            />
            <Text
              style={[styles.statusChipText, isDeferred ? { color: colors.amber[600] } : { color: colors.green[700] }]}
            >
              {isDeferred ? 'Отложен' : 'Закрыт'}
            </Text>
          </View>
          <View style={[styles.paymentChip, { backgroundColor: badge.bg, borderColor: badge.bg }]}>
            <Ionicons name={paymentIcons[check.paymentMethod] || 'cash-outline'} size={13} color={badge.text} />
            <Text style={[styles.paymentChipText, { color: badge.text }]}>
              {paymentLabels[check.paymentMethod] ?? check.paymentMethod}
            </Text>
          </View>
          {check.paymentMethod === 'cash_card' && (check.cashAmount || check.cardAmount) && (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[1.5] }}>
              <Ionicons name="cash-outline" size={12} color={colors.green[600]} />
              <Text style={{ fontSize: 11, color: colors.green[600], fontWeight: fontWeight.semibold }}>
                {formatMoney(check.cashAmount || 0)}
              </Text>
              <Text style={{ fontSize: 11, color: palette.text.tertiary }}>/</Text>
              <Ionicons name="card-outline" size={12} color={colors.blue[600]} />
              <Text style={{ fontSize: 11, color: colors.blue[600], fontWeight: fontWeight.semibold }}>
                {formatMoney(check.cardAmount || 0)}
              </Text>
            </View>
          )}
          <Text style={[styles.timeChip, { color: palette.text.tertiary }]}>{formatTime(check.date)}</Text>
        </View>

        {/* «Принять оплату» — one-tap закрытие отложенного чека.
            Видна только при isDeferred и только с permission checks_edit
            (canEdit уже включает !isReturned — возвращённый чек заморожен).
            Web-parity: PATCH { isDeferred: false }, как на сайте. */}
        {canEdit && isDeferred && (
          <TouchableOpacity
            style={styles.acceptPaymentBtn}
            onPress={handleAcceptPayment}
            disabled={acceptPaymentMutation.isPending}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Принять оплату"
            accessibilityState={{ disabled: acceptPaymentMutation.isPending }}
          >
            {acceptPaymentMutation.isPending ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <>
                <Ionicons name="cash-outline" size={17} color={colors.white} />
                <Text style={styles.acceptPaymentBtnText}>Принять оплату</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {/* Client & info — modern glassmorphism style card */}
        <View style={[styles.infoCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
          <TouchableOpacity
            style={styles.infoRow}
            activeOpacity={check.clientId ? 0.6 : 1}
            disabled={!check.clientId}
            onPress={() => openClient(navigation, check.clientId)}
          >
            <View style={[styles.infoIconCircle, { backgroundColor: colors.blue[50] }]}>
              <Ionicons name="person" size={16} color={colors.blue[600]} />
            </View>
            <View style={styles.infoContent}>
              <Text style={[styles.infoLabel, { color: palette.text.tertiary }]}>Клиент</Text>
              <Text style={[styles.infoValue, { color: palette.text.primary }]}>
                {check.client?.fullName ?? 'Розничный покупатель'}
              </Text>
            </View>
            {check.clientId ? <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} /> : null}
          </TouchableOpacity>

          {check.car && (
            <>
              <View style={[styles.infoDivider, { backgroundColor: palette.border.subtle }]} />
              <TouchableOpacity
                style={styles.infoRow}
                activeOpacity={check.clientId ? 0.6 : 1}
                disabled={!check.clientId}
                onPress={() => openCarOwner(navigation, check.clientId)}
              >
                <View style={[styles.infoIconCircle, { backgroundColor: colors.indigo[50] }]}>
                  <Ionicons name="car-sport" size={16} color={colors.indigo[600]} />
                </View>
                <View style={styles.infoContent}>
                  <Text style={[styles.infoLabel, { color: palette.text.tertiary }]}>Автомобиль</Text>
                  <View style={styles.carRow}>
                    <Text style={[styles.infoValue, { color: palette.text.primary }]}>{check.car.makeModel}</Text>
                    {check.car.plateNumber && (
                      <View style={styles.plateTag}>
                        <Text style={styles.plateTagText}>{check.car.plateNumber}</Text>
                      </View>
                    )}
                  </View>
                </View>
                {check.clientId ? <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} /> : null}
              </TouchableOpacity>
            </>
          )}

          {check.master && (
            <>
              <View style={[styles.infoDivider, { backgroundColor: palette.border.subtle }]} />
              <TouchableOpacity
                style={styles.infoRow}
                activeOpacity={check.masterId ? 0.6 : 1}
                disabled={!check.masterId}
                onPress={() => openEmployee(navigation, check.masterId)}
              >
                <View style={[styles.infoIconCircle, { backgroundColor: colors.orange[50] }]}>
                  <Ionicons name="build" size={16} color={colors.orange[500]} />
                </View>
                <View style={styles.infoContent}>
                  <Text style={[styles.infoLabel, { color: palette.text.tertiary }]}>Мастер</Text>
                  <Text style={[styles.infoValue, { color: palette.text.primary }]}>{check.master.fullName}</Text>
                </View>
                {check.masterId ? <Ionicons name="chevron-forward" size={16} color={palette.text.tertiary} /> : null}
              </TouchableOpacity>
            </>
          )}

          {check.mileage ? (
            <>
              <View style={[styles.infoDivider, { backgroundColor: palette.border.subtle }]} />
              <View style={styles.infoRow}>
                <View style={[styles.infoIconCircle, { backgroundColor: colors.teal[50] }]}>
                  <Ionicons name="speedometer" size={16} color={colors.teal[600]} />
                </View>
                <View style={styles.infoContent}>
                  <Text style={[styles.infoLabel, { color: palette.text.tertiary }]}>Пробег</Text>
                  <Text style={[styles.infoValue, { color: palette.text.primary }]}>
                    {check.mileage.toLocaleString()} км
                  </Text>
                </View>
              </View>
            </>
          ) : null}
        </View>

        {/* Contextual Knowledge Base — regulations / typical works for this
            car make + intake-handover checklists. Self-hides when empty. */}
        {check.car && <KnowledgeForCarRow makeModel={check.car.makeModel} navigation={navigation} palette={palette} />}

        {/* Comment */}
        {check.comment && (
          <View style={[styles.commentCard, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}>
            <Ionicons name="chatbubble-ellipses" size={15} color={colors.primary[400]} />
            <Text style={[styles.commentText, { color: palette.text.secondary }]}>{check.comment}</Text>
          </View>
        )}

        {/* Services — services может быть undefined в placeholder-данных
            из journal cache; используем безопасную локальную ссылку. */}
        {services.length > 0 && (
          <View style={[styles.sectionCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
            <View style={styles.sectionHeader}>
              <LinearGradient
                colors={[colors.orange[50], palette.bg.card]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.sectionGradient}
              >
                <Ionicons name="build" size={15} color={colors.orange[500]} />
                <Text style={[styles.sectionTitle, { color: palette.text.primary }]}>Услуги</Text>
              </LinearGradient>
              <View style={[styles.sectionBadge, { backgroundColor: palette.bg.muted }]}>
                <Text style={[styles.sectionBadgeText, { color: palette.text.secondary }]}>{services.length}</Text>
              </View>
            </View>
            {services.map((line, idx) => (
              <View
                key={idx}
                style={[styles.lineItem, idx > 0 && [styles.lineItemBorder, { borderTopColor: palette.border.subtle }]]}
              >
                <View style={styles.lineItemLeft}>
                  <Text style={[styles.lineItemName, { color: palette.text.primary }]}>{line.name}</Text>
                  <View style={styles.lineItemMeta}>
                    {line.master && (
                      <Text style={[styles.lineItemMetaText, { color: palette.text.tertiary }]}>
                        {line.master.fullName}
                      </Text>
                    )}
                    {line.quantity > 1 && (
                      <Text style={[styles.lineItemMetaText, { color: palette.text.tertiary }]}>
                        {line.quantity} x {formatMoney(line.price)}
                      </Text>
                    )}
                  </View>
                </View>
                <Text style={[styles.lineItemPrice, { color: palette.text.primary }]}>{formatMoney(line.total)}</Text>
              </View>
            ))}
            <View
              style={[
                styles.sectionSubtotal,
                { backgroundColor: palette.bg.muted, borderTopColor: palette.border.subtle },
              ]}
            >
              <Text style={[styles.subtotalLabel, { color: palette.text.secondary }]}>Итого услуги</Text>
              <Text style={[styles.subtotalValue, { color: palette.text.primary }]}>
                {formatMoney(check.serviceTotal)}
              </Text>
            </View>
          </View>
        )}

        {/* Products — same defensive pattern as services. */}
        {products.length > 0 && (
          <View style={[styles.sectionCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
            <View style={styles.sectionHeader}>
              <LinearGradient
                colors={[colors.blue[50], palette.bg.card]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.sectionGradient}
              >
                <Ionicons name="cube" size={15} color={colors.blue[600]} />
                <Text style={[styles.sectionTitle, { color: palette.text.primary }]}>Товары</Text>
              </LinearGradient>
              <View style={[styles.sectionBadge, { backgroundColor: palette.bg.muted }]}>
                <Text style={[styles.sectionBadgeText, { color: palette.text.secondary }]}>{products.length}</Text>
              </View>
            </View>
            {products.map((line, idx) => (
              <View
                key={idx}
                style={[styles.lineItem, idx > 0 && [styles.lineItemBorder, { borderTopColor: palette.border.subtle }]]}
              >
                <View style={styles.lineItemLeft}>
                  <Text style={[styles.lineItemName, { color: palette.text.primary }]}>{line.name}</Text>
                  {line.quantity > 1 && (
                    <View style={styles.lineItemMeta}>
                      <Text style={[styles.lineItemMetaText, { color: palette.text.tertiary }]}>
                        {line.quantity} x {formatMoney(line.sellPrice)}
                      </Text>
                    </View>
                  )}
                </View>
                <Text style={[styles.lineItemPrice, { color: palette.text.primary }]}>
                  {formatMoney(line.totalSell)}
                </Text>
              </View>
            ))}
            <View
              style={[
                styles.sectionSubtotal,
                { backgroundColor: palette.bg.muted, borderTopColor: palette.border.subtle },
              ]}
            >
              <Text style={[styles.subtotalLabel, { color: palette.text.secondary }]}>Итого товары</Text>
              <Text style={[styles.subtotalValue, { color: palette.text.primary }]}>
                {formatMoney(check.productTotal)}
              </Text>
            </View>
          </View>
        )}

        {/* Выданные гарантии — секция отображается только если бэкенд
            прислал warrantyClaims (полный GET /checks/:id). Имя позиции
            берём из самого claim'а (itemName), fallback'имся на product /
            service line из чека, если бэкенд имени не выдал. */}
        {warrantyClaims.length > 0 && (
          <View style={[styles.warrantyCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
            <View style={styles.warrantyHeader}>
              <View style={styles.warrantyHeaderIcon}>
                <Ionicons name="shield-checkmark" size={15} color={colors.green[600]} />
              </View>
              <Text style={[styles.warrantyTitle, { color: palette.text.primary }]}>Гарантия выдана</Text>
              <View style={styles.warrantyBadge}>
                <Text style={styles.warrantyBadgeText}>{warrantyClaims.length}</Text>
              </View>
            </View>
            {warrantyClaims.map((claim, idx) => {
              // Резолвим название позиции в порядке: itemName с бэка →
              // совпадение по productId/serviceId среди строк чека →
              // дефолтная подпись по kind.
              let displayName: string = claim.itemName || '';
              if (!displayName) {
                if (claim.kind === 'product' && claim.productId) {
                  const match = products.find((p) => p.productId === claim.productId);
                  if (match) displayName = match.name;
                } else if (claim.kind === 'service' && claim.serviceId) {
                  const match = services.find((s) => s.serviceId === claim.serviceId);
                  if (match) displayName = match.name;
                }
              }
              if (!displayName) {
                displayName = claim.kind === 'product' ? 'Товар' : 'Услуга';
              }
              const expiry = new Date(claim.expiresAt);
              const expiryLabel = `${String(expiry.getDate()).padStart(2, '0')}.${String(expiry.getMonth() + 1).padStart(2, '0')}.${expiry.getFullYear()}`;
              return (
                <View
                  key={claim.id ?? idx}
                  style={[
                    styles.warrantyRow,
                    idx > 0 && [styles.warrantyRowBorder, { borderTopColor: palette.border.subtle }],
                  ]}
                >
                  <View style={styles.warrantyRowLeft}>
                    <Ionicons
                      name={claim.kind === 'product' ? 'cube-outline' : 'build-outline'}
                      size={14}
                      color={palette.text.tertiary}
                    />
                    <Text style={[styles.warrantyItemName, { color: palette.text.primary }]} numberOfLines={1}>
                      {displayName}
                    </Text>
                  </View>
                  <Text style={[styles.warrantyMeta, { color: palette.text.tertiary }]}>
                    {claim.warrantyDays} дней — до {expiryLabel}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        {/* Photo Attachments — premium feature */}
        <FeatureGate
          featureKey="check_photos"
          title="Фото к чеку"
          description="Прикрепляйте фото повреждений, до/после ремонта"
          benefits={['Документирование работ', 'Защита от споров', 'История ремонта']}
        >
          <View style={[styles.sectionCard, { backgroundColor: palette.bg.card, borderColor: palette.border.subtle }]}>
            <View style={styles.sectionHeader}>
              <LinearGradient
                colors={[colors.teal[50], palette.bg.card]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.sectionGradient}
              >
                <Ionicons name="camera" size={15} color={colors.teal[600]} />
                <Text style={[styles.sectionTitle, { color: palette.text.primary }]}>Фото</Text>
              </LinearGradient>
              <TouchableOpacity
                onPress={() => uploadPhotoMutation.mutate()}
                disabled={uploadPhotoMutation.isPending}
                style={[styles.photoAddBtn, { backgroundColor: palette.bg.muted }]}
                hitSlop={8}
                accessibilityLabel="Добавить фото"
              >
                <Ionicons name="add" size={18} color={colors.primary[600]} />
              </TouchableOpacity>
            </View>
            {photos.length === 0 ? (
              <View style={styles.photoEmpty}>
                <Ionicons name="images-outline" size={28} color={palette.text.tertiary} />
                <Text style={[styles.photoEmptyText, { color: palette.text.tertiary }]}>
                  Нет фото. Нажмите «+» чтобы добавить.
                </Text>
              </View>
            ) : (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.photoScrollContent}
              >
                {photos.map((photo) => (
                  <TouchableOpacity
                    key={photo.id}
                    onLongPress={() => handleDeletePhoto(photo.id)}
                    delayLongPress={500}
                    activeOpacity={0.85}
                  >
                    <Image
                      source={{ uri: photo.photoUrl }}
                      style={styles.photoThumb}
                      contentFit="cover"
                      transition={200}
                      placeholder={{ blurhash: 'L4SY{q?b00?b~q?b?b?b?b?b?b?b' }}
                      placeholderContentFit="cover"
                      cachePolicy="memory-disk"
                    />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        </FeatureGate>

        {/* Grand total — hero card */}
        <View style={styles.totalCard}>
          <LinearGradient
            colors={[colors.primary[600], colors.primary[800]]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.totalGradient}
          >
            {/* Decorative circles */}
            <View style={styles.totalDecoCircle1} />
            <View style={styles.totalDecoCircle2} />

            {(check.discount ?? 0) > 0 && (
              <View style={styles.totalDiscountRow}>
                <Text style={styles.totalDiscountLabel}>Скидка</Text>
                <Text style={styles.totalDiscountValue}>-{formatMoney(check.discount ?? 0)}</Text>
              </View>
            )}
            <View style={styles.totalMainRow}>
              <Text style={styles.totalMainLabel}>ИТОГО</Text>
              <Text style={styles.totalMainValue}>{formatMoney(check.totalRevenue)}</Text>
            </View>
          </LinearGradient>

          {canViewProfit && (
            <View style={[styles.profitRow, { backgroundColor: palette.bg.card }]}>
              <View style={styles.profitLeft}>
                <Ionicons
                  name="trending-up"
                  size={16}
                  color={check.profit >= 0 ? colors.green[600] : colors.red[500]}
                />
                <Text style={[styles.profitLabel, { color: palette.text.secondary }]}>Прибыль</Text>
              </View>
              <Text
                style={[
                  styles.profitValue,
                  check.profit >= 0 ? { color: colors.green[600] } : { color: colors.red[500] },
                ]}
              >
                {check.profit >= 0 ? '+' : ''}
                {formatMoney(check.profit)}
              </Text>
            </View>
          )}
        </View>

        {/* Триггер возврата перенесён в trailing-иконку шапки (см. header).
            Уже возвращённый чек дополнительно помечен бейджем «ВОЗВРАЩЁН»
            рядом с номером чека. */}
      </Animated.ScrollView>

      {/* Return modal — единый поток для full / partial.
          Дизайн ориентируется на iOS sheet с сегментным переключателем
          вверху, картами выбора направления и валидируемой формой. */}
      <Modal visible={returnModalOpen} onClose={() => setReturnModalOpen(false)} title="Оформить возврат">
        {/* Сегментный переключатель Полный / Частичный */}
        <View style={[styles.returnScopeRow, { backgroundColor: palette.bg.muted }]}>
          <TouchableOpacity
            style={[
              styles.returnScopeBtn,
              returnScope === 'full' && [styles.returnScopeBtnActive, { backgroundColor: palette.bg.card }],
            ]}
            onPress={() => {
              haptic('select');
              setReturnScope('full');
            }}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.returnScopeText,
                { color: palette.text.secondary },
                returnScope === 'full' && { color: palette.text.primary, fontWeight: fontWeight.semibold },
              ]}
            >
              Полный возврат
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.returnScopeBtn,
              returnScope === 'partial' && [styles.returnScopeBtnActive, { backgroundColor: palette.bg.card }],
            ]}
            onPress={() => {
              haptic('select');
              setReturnScope('partial');
            }}
            activeOpacity={0.7}
          >
            <Text
              style={[
                styles.returnScopeText,
                { color: palette.text.secondary },
                returnScope === 'partial' && { color: palette.text.primary, fontWeight: fontWeight.semibold },
              ]}
            >
              Частичный
            </Text>
          </TouchableOpacity>
        </View>

        {/* Список строк (partial only). Каждая строка — тоггл + степпер */}
        {returnScope === 'partial' && (
          <View style={{ marginBottom: spacing[3] }}>
            {(check.services ?? []).map((s, i) => {
              const key = `s-${s.id ?? i}`;
              const row = returnLines[key];
              if (!row || !s.id) return null;
              const max = s.quantity;
              return (
                <View
                  key={key}
                  style={[
                    styles.returnLineRow,
                    { borderBottomColor: palette.border.subtle, backgroundColor: palette.bg.card },
                  ]}
                >
                  <TouchableOpacity
                    style={styles.returnLineCheckRow}
                    onPress={() => toggleReturnLine(key)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.returnLineCheckbox, row.selected && styles.returnLineCheckboxOn]}>
                      {row.selected && <Ionicons name="checkmark" size={14} color={colors.white} />}
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.returnLineName, { color: palette.text.primary }]} numberOfLines={1}>
                        {s.name}
                      </Text>
                      <Text style={[styles.returnLineSub, { color: palette.text.tertiary }]}>Услуга · из {max}</Text>
                    </View>
                  </TouchableOpacity>
                  {row.selected && (
                    <View style={styles.returnLineStepper}>
                      <TouchableOpacity
                        onPress={() => updateReturnLineQty(key, -1, max)}
                        style={[styles.stepperBtn, { backgroundColor: palette.bg.muted }]}
                        hitSlop={6}
                      >
                        <Ionicons name="remove" size={14} color={palette.text.secondary} />
                      </TouchableOpacity>
                      <Text style={[styles.stepperValue, { color: palette.text.primary }]}>{row.qty}</Text>
                      <TouchableOpacity
                        onPress={() => updateReturnLineQty(key, 1, max)}
                        style={[styles.stepperBtn, { backgroundColor: palette.bg.muted }]}
                        hitSlop={6}
                      >
                        <Ionicons name="add" size={14} color={palette.text.secondary} />
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })}
            {(check.products ?? []).map((p, i) => {
              const key = `p-${p.id ?? i}`;
              const row = returnLines[key];
              if (!row || !p.id) return null;
              const max = p.quantity;
              return (
                <View
                  key={key}
                  style={[
                    styles.returnLineRow,
                    { borderBottomColor: palette.border.subtle, backgroundColor: palette.bg.card },
                  ]}
                >
                  <TouchableOpacity
                    style={styles.returnLineCheckRow}
                    onPress={() => toggleReturnLine(key)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.returnLineCheckbox, row.selected && styles.returnLineCheckboxOn]}>
                      {row.selected && <Ionicons name="checkmark" size={14} color={colors.white} />}
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={[styles.returnLineName, { color: palette.text.primary }]} numberOfLines={1}>
                        {p.name}
                      </Text>
                      <Text style={[styles.returnLineSub, { color: palette.text.tertiary }]}>Товар · из {max}</Text>
                    </View>
                  </TouchableOpacity>
                  {row.selected && (
                    <View style={styles.returnLineStepper}>
                      <TouchableOpacity
                        onPress={() => updateReturnLineQty(key, -1, max)}
                        style={[styles.stepperBtn, { backgroundColor: palette.bg.muted }]}
                        hitSlop={6}
                      >
                        <Ionicons name="remove" size={14} color={palette.text.secondary} />
                      </TouchableOpacity>
                      <Text style={[styles.stepperValue, { color: palette.text.primary }]}>{row.qty}</Text>
                      <TouchableOpacity
                        onPress={() => updateReturnLineQty(key, 1, max)}
                        style={[styles.stepperBtn, { backgroundColor: palette.bg.muted }]}
                        hitSlop={6}
                      >
                        <Ionicons name="add" size={14} color={palette.text.secondary} />
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })}
            {(check.services?.length ?? 0) + (check.products?.length ?? 0) === 0 && (
              <Text style={{ textAlign: 'center', color: palette.text.tertiary, paddingVertical: spacing[3] }}>
                Нет позиций для частичного возврата.
              </Text>
            )}
          </View>
        )}

        {/* Destination chooser — две карты «На склад / В брак» */}
        <Text style={[styles.returnSectionLabel, { color: palette.text.secondary }]}>Куда вернуть товары</Text>
        <View style={styles.returnDestRow}>
          <TouchableOpacity
            style={[
              styles.returnDestCard,
              { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
              returnDestination === 'warehouse' && {
                borderColor: colors.primary[500],
                backgroundColor: colors.primary[50],
              },
            ]}
            onPress={() => {
              haptic('tap');
              setReturnDestination('warehouse');
            }}
            activeOpacity={0.85}
          >
            <Ionicons
              name="archive-outline"
              size={24}
              color={returnDestination === 'warehouse' ? colors.primary[600] : palette.text.tertiary}
            />
            <Text
              style={[
                styles.returnDestTitle,
                { color: returnDestination === 'warehouse' ? colors.primary[700] : palette.text.primary },
              ]}
            >
              На склад
            </Text>
            <Text style={[styles.returnDestSub, { color: palette.text.tertiary }]}>Товар как новый</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.returnDestCard,
              { backgroundColor: palette.bg.card, borderColor: palette.border.subtle },
              returnDestination === 'defect' && {
                borderColor: colors.red[400],
                backgroundColor: colors.red[50],
              },
            ]}
            onPress={() => {
              haptic('tap');
              setReturnDestination('defect');
            }}
            activeOpacity={0.85}
          >
            <Ionicons
              name="warning-outline"
              size={24}
              color={returnDestination === 'defect' ? colors.red[600] : palette.text.tertiary}
            />
            <Text
              style={[
                styles.returnDestTitle,
                { color: returnDestination === 'defect' ? colors.red[700] : palette.text.primary },
              ]}
            >
              В брак
            </Text>
            <Text style={[styles.returnDestSub, { color: palette.text.tertiary }]}>Нужна причина</Text>
          </TouchableOpacity>
        </View>

        {/* Reason — обязательно для брака. */}
        <View style={{ marginBottom: spacing[3] }}>
          <Text style={[styles.returnSectionLabel, { color: palette.text.secondary }]}>
            {returnDestination === 'defect' ? 'Причина возврата в брак *' : 'Комментарий'}
          </Text>
          <TextInput
            value={returnReason}
            onChangeText={setReturnReason}
            style={[
              styles.returnReasonInput,
              {
                backgroundColor: palette.bg.muted,
                borderColor: palette.border.subtle,
                color: palette.text.primary,
              },
            ]}
            multiline
            placeholder={returnDestination === 'defect' ? 'Например: треснул корпус' : 'Необязательно'}
            placeholderTextColor={palette.text.tertiary}
          />
        </View>

        {/* Refund amount — авто-prefill, редактируемое */}
        <View style={{ marginBottom: spacing[3] }}>
          <Text style={[styles.returnSectionLabel, { color: palette.text.secondary }]}>Сумма возврата, ₽</Text>
          <TextInput
            value={returnRefundAmount}
            onChangeText={setReturnRefundAmount}
            style={[
              styles.returnReasonInput,
              {
                height: 44,
                textAlignVertical: 'center',
                backgroundColor: palette.bg.muted,
                borderColor: palette.border.subtle,
                color: palette.text.primary,
              },
            ]}
            keyboardType="numeric"
            placeholder="0"
            placeholderTextColor={palette.text.tertiary}
          />
        </View>

        <View style={[styles.returnFormActions, { borderTopColor: palette.border.subtle }]}>
          <TouchableOpacity
            style={[styles.returnCancelBtn, { borderColor: palette.border.strong }]}
            onPress={() => setReturnModalOpen(false)}
          >
            <Text style={[styles.returnCancelBtnText, { color: palette.text.secondary }]}>Отмена</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.returnSubmitBtn} onPress={handleSubmitReturn} activeOpacity={0.85}>
            {returnMutation.isPending ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <Text style={styles.returnSubmitBtnText}>Подтвердить возврат</Text>
            )}
          </TouchableOpacity>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderBottomWidth: 1,
  },
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primary[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerCenter: { flex: 1, marginHorizontal: spacing[3] },
  headerTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  headerDate: { fontSize: 11, marginTop: 1 },
  headerActions: { flexDirection: 'row', gap: spacing[1.5], alignItems: 'center' },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Scroll
  scroll: { flex: 1 },
  scrollContent: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[10] },

  // Status chips row
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], flexWrap: 'wrap' },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1.5],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1.5],
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  statusDot: { width: 7, height: 7, borderRadius: 3.5 },
  statusChipText: { fontSize: 12, fontWeight: fontWeight.semibold },
  paymentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[2.5],
    paddingVertical: spacing[1.5],
    borderRadius: borderRadius.full,
    borderWidth: 1,
  },
  paymentChipText: { fontSize: 12, fontWeight: fontWeight.medium },
  timeChip: { fontSize: 12, marginLeft: 'auto' },

  // «Принять оплату» — primary CTA для отложенного чека. Зелёная,
  // во всю ширину, в стиле существующих primary-кнопок экрана
  // (returnSubmitBtn): сплошная заливка + белый semibold текст +
  // ActivityIndicator на время запроса.
  acceptPaymentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    backgroundColor: colors.green[600],
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[3],
    shadowColor: colors.green[700],
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  acceptPaymentBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.white },

  // Info card
  infoCard: {
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    padding: spacing[4],
    shadowColor: colors.black,
    shadowOpacity: 0.03,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  infoIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  infoContent: { flex: 1 },
  infoLabel: { fontSize: 11, marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  infoValue: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  infoDivider: { height: 1, marginVertical: spacing[3], marginLeft: spacing[4] + 40 },
  carRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], flexWrap: 'wrap' },
  plateTag: {
    backgroundColor: colors.primary[50],
    borderRadius: borderRadius.md,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: colors.primary[200],
  },
  plateTagText: { fontSize: 11, fontWeight: fontWeight.bold, color: colors.primary[700], letterSpacing: 0.5 },

  // ── Contextual Knowledge-Base affordance ────────────────────────────────
  kbRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing[3],
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
  },
  kbRowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  kbRowTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, letterSpacing: -0.1 },
  kbRowSub: { fontSize: 12, marginTop: 1 },
  kbSheetGroup: { marginBottom: spacing[2] },
  kbSheetGroupLabel: {
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 1,
    textTransform: 'uppercase' as const,
    marginBottom: spacing[1],
  },
  kbSheetRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: spacing[2.5],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  kbSheetRowText: { flex: 1, fontSize: 14, fontWeight: '500' as const, letterSpacing: -0.1 },
  kbSheetRowSub: { fontSize: 12, marginTop: 2 },

  // Comment
  commentCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing[2.5],
    backgroundColor: colors.primary[50],
    borderRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.primary[100],
    padding: spacing[3.5],
  },
  commentText: { fontSize: fontSize.sm, flex: 1, lineHeight: 20 },

  // Section card
  sectionCard: {
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: colors.black,
    shadowOpacity: 0.03,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingRight: spacing[4],
  },
  sectionGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    flex: 1,
  },
  sectionTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  sectionBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    minWidth: 24,
    alignItems: 'center',
  },
  sectionBadgeText: { fontSize: 11, fontWeight: fontWeight.bold },

  // Photo attachments
  photoAddBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
  },
  photoEmptyText: { fontSize: 12, flex: 1 },
  photoScrollContent: {
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
    gap: spacing[2],
  },
  photoThumb: {
    width: 80,
    height: 80,
    borderRadius: 10,
    backgroundColor: colors.gray[100],
  },

  // Line items
  lineItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  lineItemBorder: { borderTopWidth: 1 },
  lineItemLeft: { flex: 1, marginRight: spacing[3] },
  lineItemName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  lineItemMeta: { flexDirection: 'row', gap: spacing[2], marginTop: 3 },
  lineItemMetaText: { fontSize: 11 },
  lineItemPrice: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },

  // Subtotal
  sectionSubtotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderTopWidth: 1,
  },
  subtotalLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  subtotalValue: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },

  // Warranty issued card — compact iosCard style (matches other section
  // cards on the screen). No gradient header; the green shield icon is
  // enough signal that this is a guarantee block.
  warrantyCard: {
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    overflow: 'hidden',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  warrantyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingBottom: spacing[2],
  },
  warrantyHeaderIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.green[50],
    alignItems: 'center',
    justifyContent: 'center',
  },
  warrantyTitle: { flex: 1, fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  warrantyBadge: {
    backgroundColor: colors.green[50],
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    minWidth: 24,
    alignItems: 'center',
  },
  warrantyBadgeText: { fontSize: 11, fontWeight: fontWeight.bold, color: colors.green[700] },
  warrantyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing[2],
    gap: spacing[2],
  },
  warrantyRowBorder: { borderTopWidth: 1 },
  warrantyRowLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5], flex: 1, minWidth: 0 },
  warrantyItemName: { fontSize: 13, fontWeight: fontWeight.medium, flexShrink: 1 },
  warrantyMeta: { fontSize: 11, fontWeight: fontWeight.medium },

  // Total card
  totalCard: {
    borderRadius: borderRadius['2xl'],
    overflow: 'hidden',
    shadowColor: colors.primary[700],
    shadowOpacity: 0.15,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  totalGradient: {
    padding: spacing[5],
    position: 'relative',
    overflow: 'hidden',
  },
  totalDecoCircle1: {
    position: 'absolute',
    top: -20,
    right: -20,
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  totalDecoCircle2: {
    position: 'absolute',
    bottom: -10,
    left: -10,
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  totalDiscountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing[2],
  },
  totalDiscountLabel: { fontSize: fontSize.sm, color: 'rgba(255,255,255,0.7)' },
  totalDiscountValue: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.amber[200] },
  totalMainRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  totalMainLabel: {
    fontSize: fontSize.base,
    fontWeight: fontWeight.bold,
    color: 'rgba(255,255,255,0.85)',
    letterSpacing: 2,
  },
  totalMainValue: {
    fontSize: fontSize['2xl'],
    fontWeight: fontWeight.bold,
    color: colors.white,
  },
  profitRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[3.5],
  },
  profitLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  profitLabel: { fontSize: fontSize.sm },
  profitValue: { fontSize: fontSize.base, fontWeight: fontWeight.bold },

  // ── Return: header badge + bottom CTA + done banner ───────────────
  // Тёмно-красный pill в шапке — мгновенный сигнал «чек возвращён»;
  // дублируется на карточке журнала, чтобы не приходилось открывать
  // деталку для проверки статуса.
  returnedHeaderBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.red[500],
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
  },
  returnedHeaderBadgeText: {
    fontSize: 10,
    fontWeight: fontWeight.bold,
    color: colors.white,
    letterSpacing: 0.4,
  },
  // ── Return modal styles ───────────────────────────────────────────
  returnScopeRow: {
    flexDirection: 'row',
    backgroundColor: colors.gray[100],
    borderRadius: borderRadius.xl,
    padding: 3,
    marginBottom: spacing[4],
  },
  returnScopeBtn: {
    flex: 1,
    paddingVertical: spacing[2],
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: borderRadius.lg,
  },
  returnScopeBtnActive: {
    shadowColor: colors.black,
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  returnScopeText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  returnSectionLabel: {
    fontSize: 11,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: spacing[1.5],
  },
  returnDestRow: {
    flexDirection: 'row',
    gap: spacing[2],
    marginBottom: spacing[4],
  },
  returnDestCard: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: borderRadius.xl,
    padding: spacing[3],
    alignItems: 'center',
    gap: 6,
  },
  returnDestTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold },
  returnDestSub: { fontSize: 11 },
  returnLineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing[2],
    paddingVertical: spacing[2.5],
    paddingHorizontal: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  returnLineCheckRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2.5], flex: 1, minWidth: 0 },
  returnLineCheckbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: colors.gray[300],
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  returnLineCheckboxOn: {
    backgroundColor: colors.primary[600],
    borderColor: colors.primary[600],
  },
  returnLineName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  returnLineSub: { fontSize: 11, marginTop: 1 },
  returnLineStepper: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  stepperBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, minWidth: 20, textAlign: 'center' },
  returnReasonInput: {
    backgroundColor: colors.gray[50],
    borderWidth: 1,
    borderColor: colors.gray[300],
    borderRadius: borderRadius.lg,
    paddingHorizontal: spacing[3.5],
    paddingVertical: spacing[2.5],
    fontSize: fontSize.sm,
    color: colors.gray[900],
    minHeight: 60,
    textAlignVertical: 'top',
  },
  returnFormActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing[3],
    paddingTop: spacing[4],
    borderTopWidth: 1,
  },
  returnCancelBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    borderWidth: 1,
  },
  returnCancelBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.medium },
  returnSubmitBtn: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    borderRadius: borderRadius.lg,
    backgroundColor: colors.red[600],
    minWidth: 180,
    alignItems: 'center',
    justifyContent: 'center',
  },
  returnSubmitBtnText: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.white },
});
