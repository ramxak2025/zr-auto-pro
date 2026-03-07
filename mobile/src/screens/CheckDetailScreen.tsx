import React, { useRef, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRoute, useNavigation } from '@react-navigation/native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { checksApi, myCompanyApi } from '../api/services';
import { useAuth } from '../contexts/AuthContext';
import LoadingSpinner from '../components/LoadingSpinner';
import { colors, fontSize, fontWeight, borderRadius, spacing, badgeColors, paymentMethodBadgeColor } from '../theme';
import type { Check, Tenant } from '../../../shared/types';

function formatMoney(v: number) { return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' \u20BD'; }
function formatDate(d: string) { return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' }); }
function formatDateTime(d: string) { const dt = new Date(d); return formatDate(d) + ', ' + dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); }
function formatShortDate(d: string) { return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
function formatTime(d: string) { return new Date(d).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); }

const paymentLabels: Record<string, string> = { cash: 'Наличные', card: 'Карта', warranty: 'Гарантия', cash_card: 'Нал/Карта' };
const paymentIcons: Record<string, keyof typeof Ionicons.glyphMap> = { cash: 'cash-outline', card: 'card-outline', warranty: 'shield-checkmark-outline', cash_card: 'swap-horizontal-outline' };

export default function CheckDetailScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const { id } = route.params;

  // Entrance animation
  const fadeAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 250, useNativeDriver: true }).start();
  }, []);

  const { data: check, isLoading } = useQuery<Check>({
    queryKey: ['check', id],
    queryFn: async () => { const res = await checksApi.getById(id); return res.data; },
    staleTime: 30_000,
  });

  const { data: company } = useQuery<Tenant>({
    queryKey: ['my-company'],
    queryFn: async () => (await myCompanyApi.get()).data,
    staleTime: 5 * 60_000,
  });

  const generatePdf = async () => {
    if (!check) return;
    const c = company;
    const companyName = c?.legalName || c?.name || '\u0410\u0432\u0442\u043E\u0441\u0435\u0440\u0432\u0438\u0441';
    const inn = c?.inn ? `\u0418\u041D\u041D ${c.inn}` : '';
    const addr = c?.address || '';
    const phone = c?.phone || '';
    const footer = c?.receiptFooter || '';
    const date = formatShortDate(check.date) + ' ' + formatTime(check.date);
    const servicesHtml = (check.services || []).map(s =>
      `<tr><td>${s.name}</td><td style="text-align:right">${s.quantity}</td><td style="text-align:right">${formatMoney(s.total)}</td></tr>`
    ).join('');
    const productsHtml = (check.products || []).map(p =>
      `<tr><td>${p.name}</td><td style="text-align:right">${p.quantity}</td><td style="text-align:right">${formatMoney(p.totalSell)}</td></tr>`
    ).join('');
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
        <div><strong>\u0427\u0435\u043A #${check.number}</strong> \u043E\u0442 ${date}</div>
        ${check.client ? `<div>\u041A\u043B\u0438\u0435\u043D\u0442: ${check.client.fullName}</div>` : ''}
        ${check.car ? `<div>\u0410\u0432\u0442\u043E: ${check.car.makeModel} ${check.car.plateNumber || ''}</div>` : ''}
        ${check.master ? `<div>\u041C\u0430\u0441\u0442\u0435\u0440: ${check.master.fullName}</div>` : ''}
        ${check.services.length > 0 ? `
          <h3 style="margin:12px 0 4px">\u0423\u0441\u043B\u0443\u0433\u0438</h3>
          <table><thead><tr><th>\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435</th><th style="text-align:right">\u041A\u043E\u043B.</th><th style="text-align:right">\u0421\u0443\u043C\u043C\u0430</th></tr></thead>
          <tbody>${servicesHtml}</tbody></table>
        ` : ''}
        ${check.products.length > 0 ? `
          <h3 style="margin:12px 0 4px">\u0422\u043E\u0432\u0430\u0440\u044B</h3>
          <table><thead><tr><th>\u041D\u0430\u0437\u0432\u0430\u043D\u0438\u0435</th><th style="text-align:right">\u041A\u043E\u043B.</th><th style="text-align:right">\u0421\u0443\u043C\u043C\u0430</th></tr></thead>
          <tbody>${productsHtml}</tbody></table>
        ` : ''}
        <hr/>
        ${(check.discount ?? 0) > 0 ? `<div>\u0421\u043A\u0438\u0434\u043A\u0430: -${formatMoney(check.discount ?? 0)}</div>` : ''}
        <div class="total">\u0418\u0422\u041E\u0413\u041E: ${formatMoney(check.totalRevenue)}</div>
        <div style="font-size:11px;color:#666;text-align:right">${paymentLabels[check.paymentMethod] || check.paymentMethod}</div>
        ${footer ? `<div class="footer">${footer}</div>` : ''}
      </body></html>
    `;

    try {
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `\u0427\u0435\u043A #${check.number}` });
      } else {
        Alert.alert('PDF \u0441\u043E\u0437\u0434\u0430\u043D', uri);
      }
    } catch {
      Alert.alert('\u041E\u0448\u0438\u0431\u043A\u0430', '\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043E\u0437\u0434\u0430\u0442\u044C PDF');
    }
  };

  const deleteMutation = useMutation({
    mutationFn: () => checksApi.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checks'] });
      navigation.goBack();
    },
  });

  if (isLoading) return <LoadingSpinner />;
  if (!check) return <Text style={{ padding: 20, textAlign: 'center' }}>{'\u0427\u0435\u043A \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D'}</Text>;

  const canEdit = hasPermission('checks_edit');
  const canDelete = hasPermission('checks_delete');
  const canViewProfit = hasPermission('profit_view');
  const badgeKey = paymentMethodBadgeColor[check.paymentMethod] || 'gray';
  const badge = badgeColors[badgeKey];
  const isDeferred = (check as any).isDeferred;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      {/* Modern glassmorphism-style header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={20} color={colors.primary[600]} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>Чек #{check.number}</Text>
          <View style={[styles.headerStatusDot, isDeferred ? { backgroundColor: colors.amber[600] } : { backgroundColor: colors.green[500] }]} />
        </View>
        <View style={{ flexDirection: 'row', gap: spacing[2], alignItems: 'center' }}>
          <TouchableOpacity onPress={generatePdf} style={styles.actionBtn}>
            <Ionicons name="share-outline" size={17} color={colors.violet[600]} />
          </TouchableOpacity>
          {canEdit && (
            <TouchableOpacity onPress={() => navigation.navigate('CheckCreate', { id: check.id })} style={styles.actionBtn}>
              <Ionicons name="create-outline" size={17} color={colors.primary[600]} />
            </TouchableOpacity>
          )}
          {canDelete && (
            <TouchableOpacity onPress={() => {
              Alert.alert('Удалить?', 'Это действие необратимо', [
                { text: 'Отмена', style: 'cancel' },
                { text: 'Удалить', style: 'destructive', onPress: () => deleteMutation.mutate() },
              ]);
            }} style={[styles.actionBtn, { backgroundColor: colors.red[50] }]}>
              <Ionicons name="trash-outline" size={17} color={colors.red[500]} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <Animated.ScrollView style={[styles.scroll, { opacity: fadeAnim }]} contentContainerStyle={styles.scrollContent}>
        {/* Hero status card with gradient */}
        <LinearGradient
          colors={isDeferred ? ['#fffbeb', '#fef3c7'] : ['#f0fdf4', '#dcfce7']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.statusCard}
        >
          <View style={styles.statusCardLeft}>
            <View style={[styles.statusIconWrap, isDeferred ? { backgroundColor: colors.amber[200] } : { backgroundColor: colors.green[200] }]}>
              <Ionicons name={isDeferred ? 'time-outline' : 'checkmark-circle'} size={20} color={isDeferred ? colors.amber[600] : colors.green[600]} />
            </View>
            <View>
              <Text style={[styles.statusLabel, isDeferred ? { color: colors.amber[600] } : { color: colors.green[600] }]}>
                {isDeferred ? 'Отложен' : 'Закрыт'}
              </Text>
              <Text style={styles.statusDate}>{formatDateTime(check.date)}</Text>
            </View>
          </View>
          <View style={[styles.paymentChip, { backgroundColor: badge.bg }]}>
            <Ionicons name={paymentIcons[check.paymentMethod] || 'cash-outline'} size={13} color={badge.text} />
            <Text style={[styles.paymentChipText, { color: badge.text }]}>{paymentLabels[check.paymentMethod] ?? check.paymentMethod}</Text>
          </View>
        </LinearGradient>

        {/* Client & Car — modern horizontal layout */}
        <View style={styles.card}>
          <View style={styles.cardRow}>
            <View style={[styles.cardIconCircle, { backgroundColor: colors.blue[50] }]}>
              <Ionicons name="person" size={18} color={colors.blue[600]} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardLabel}>Клиент</Text>
              <Text style={styles.cardValue}>{check.client?.fullName ?? 'Розничный покупатель'}</Text>
            </View>
          </View>

          {check.car && (
            <View style={styles.cardRow}>
              <View style={[styles.cardIconCircle, { backgroundColor: colors.indigo[50] }]}>
                <Ionicons name="car-sport" size={18} color={colors.indigo[600]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardLabel}>Автомобиль</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2] }}>
                  <Text style={styles.cardValue}>{check.car.makeModel}</Text>
                  {check.car.plateNumber && (
                    <View style={styles.plateChip}>
                      <Text style={styles.plateChipText}>{check.car.plateNumber}</Text>
                    </View>
                  )}
                </View>
              </View>
            </View>
          )}

          <View style={styles.cardRow}>
            <View style={[styles.cardIconCircle, { backgroundColor: colors.orange[50] }]}>
              <Ionicons name="construct" size={18} color={colors.orange[500]} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardLabel}>Мастер</Text>
              <Text style={styles.cardValue}>{check.master?.fullName ?? '—'}</Text>
            </View>
          </View>

          {check.mileage ? (
            <View style={styles.cardRow}>
              <View style={[styles.cardIconCircle, { backgroundColor: colors.teal[50] }]}>
                <Ionicons name="speedometer" size={18} color={colors.teal[600]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardLabel}>Пробег</Text>
                <Text style={styles.cardValue}>{check.mileage.toLocaleString()} км</Text>
              </View>
            </View>
          ) : null}
        </View>

        {/* Comment */}
        {check.comment && (
          <View style={styles.commentCard}>
            <View style={[styles.cardIconCircle, { backgroundColor: colors.gray[100], width: 32, height: 32 }]}>
              <Ionicons name="chatbubble-ellipses" size={15} color={colors.gray[500]} />
            </View>
            <Text style={styles.commentText}>{check.comment}</Text>
          </View>
        )}

        {/* Services — modern list */}
        {check.services.length > 0 && (
          <View style={styles.card}>
            <View style={styles.sectionHeader}>
              <LinearGradient colors={[colors.orange[50], '#fff7ed']} style={styles.sectionIconGrad}>
                <Ionicons name="build" size={15} color={colors.orange[500]} />
              </LinearGradient>
              <Text style={styles.sectionTitle}>Услуги</Text>
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{check.services.length}</Text>
              </View>
            </View>
            {check.services.map((line, idx) => (
              <View key={idx} style={[styles.lineRow, idx === 0 && { borderTopWidth: 0 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lineName}>{line.name}</Text>
                  <View style={{ flexDirection: 'row', gap: spacing[2], marginTop: 3 }}>
                    {line.master && (
                      <View style={styles.lineTag}>
                        <Ionicons name="person-outline" size={10} color={colors.primary[600]} />
                        <Text style={styles.lineTagText}>{line.master.fullName}</Text>
                      </View>
                    )}
                    {line.quantity > 1 && (
                      <Text style={styles.lineSub}>{line.quantity} × {formatMoney(line.price)}</Text>
                    )}
                  </View>
                </View>
                <Text style={styles.linePrice}>{formatMoney(line.total)}</Text>
              </View>
            ))}
            <View style={styles.subtotalRow}>
              <Text style={styles.subtotalLabel}>Итого услуги</Text>
              <Text style={styles.subtotalValue}>{formatMoney(check.serviceTotal)}</Text>
            </View>
          </View>
        )}

        {/* Products — modern list */}
        {check.products.length > 0 && (
          <View style={styles.card}>
            <View style={styles.sectionHeader}>
              <LinearGradient colors={[colors.blue[50], '#eff6ff']} style={styles.sectionIconGrad}>
                <Ionicons name="cube" size={15} color={colors.blue[600]} />
              </LinearGradient>
              <Text style={styles.sectionTitle}>Товары</Text>
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{check.products.length}</Text>
              </View>
            </View>
            {check.products.map((line, idx) => (
              <View key={idx} style={[styles.lineRow, idx === 0 && { borderTopWidth: 0 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lineName}>{line.name}</Text>
                  {line.quantity > 1 && <Text style={styles.lineSub}>{line.quantity} × {formatMoney(line.sellPrice)}</Text>}
                </View>
                <Text style={styles.linePrice}>{formatMoney(line.totalSell)}</Text>
              </View>
            ))}
            <View style={styles.subtotalRow}>
              <Text style={styles.subtotalLabel}>Итого товары</Text>
              <Text style={styles.subtotalValue}>{formatMoney(check.productTotal)}</Text>
            </View>
          </View>
        )}

        {/* Total summary — premium gradient card */}
        <LinearGradient
          colors={[colors.primary[50], '#ffffff', colors.primary[50]]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.totalCard}
        >
          {(check.discount ?? 0) > 0 && (
            <View style={styles.totalRow}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[1.5] }}>
                <Ionicons name="pricetag" size={14} color={colors.orange[500]} />
                <Text style={styles.totalLabel}>Скидка</Text>
              </View>
              <Text style={[styles.totalValue, { color: colors.orange[500] }]}>-{formatMoney(check.discount ?? 0)}</Text>
            </View>
          )}
          <View style={styles.totalMainRow}>
            <Text style={styles.totalMainLabel}>Итого</Text>
            <Text style={styles.totalMainValue}>{formatMoney(check.totalRevenue)}</Text>
          </View>
          {canViewProfit && (
            <>
              <View style={styles.totalDivider} />
              <View style={styles.totalRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[1.5] }}>
                  <View style={[styles.profitDot, { backgroundColor: check.profit >= 0 ? colors.green[500] : colors.red[500] }]} />
                  <Text style={styles.totalLabel}>Прибыль</Text>
                </View>
                <Text style={[styles.totalProfitValue, check.profit >= 0 ? { color: colors.green[600] } : { color: colors.red[500] }]}>
                  {check.profit >= 0 ? '+' : ''}{formatMoney(check.profit)}
                </Text>
              </View>
            </>
          )}
        </LinearGradient>
      </Animated.ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },
  // Header
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing[4], paddingVertical: spacing[3], backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.gray[100] },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.primary[50], alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  headerTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.gray[900] },
  headerStatusDot: { width: 8, height: 8, borderRadius: 4 },
  actionBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.gray[50], alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[8] },
  // Status card
  statusCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: spacing[4], borderRadius: borderRadius['2xl'], borderWidth: 1, borderColor: 'rgba(0,0,0,0.04)' },
  statusCardLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  statusIconWrap: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  statusLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.bold },
  statusDate: { fontSize: fontSize.xs, color: colors.gray[500], marginTop: 2 },
  paymentChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: spacing[3], paddingVertical: spacing[1.5], borderRadius: borderRadius.full },
  paymentChipText: { fontSize: 11, fontWeight: fontWeight.semibold },
  // Card
  card: { backgroundColor: colors.white, borderRadius: borderRadius['2xl'], padding: spacing[4], shadowColor: colors.black, shadowOpacity: 0.06, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 3, borderWidth: 1, borderColor: 'rgba(0,0,0,0.03)' },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingVertical: spacing[2.5] },
  cardIconCircle: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  cardLabel: { fontSize: 11, color: colors.gray[400], letterSpacing: 0.5, marginBottom: 1 },
  cardValue: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  plateChip: { backgroundColor: colors.primary[50], borderRadius: borderRadius.md, paddingHorizontal: spacing[2], paddingVertical: 2, borderWidth: 1, borderColor: colors.primary[200] },
  plateChipText: { fontSize: 11, fontWeight: fontWeight.bold, color: colors.primary[700] },
  // Comment
  commentCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[3], backgroundColor: colors.white, borderRadius: borderRadius['2xl'], padding: spacing[4], shadowColor: colors.black, shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  commentText: { fontSize: fontSize.sm, color: colors.gray[600], flex: 1, lineHeight: 20 },
  // Section header
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginBottom: spacing[3] },
  sectionIconGrad: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900], flex: 1 },
  countBadge: { backgroundColor: colors.gray[100], paddingHorizontal: 10, paddingVertical: 3, borderRadius: borderRadius.full },
  countBadgeText: { fontSize: 11, fontWeight: fontWeight.bold, color: colors.gray[500] },
  // Lines
  lineRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing[3], borderTopWidth: 1, borderTopColor: colors.gray[50] },
  lineName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900] },
  lineSub: { fontSize: fontSize.xs, color: colors.gray[400] },
  lineTag: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.primary[50], paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: borderRadius.sm },
  lineTagText: { fontSize: 10, color: colors.primary[600], fontWeight: fontWeight.medium },
  linePrice: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900], marginLeft: spacing[3] },
  subtotalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing[3], marginTop: spacing[2], borderTopWidth: 1, borderTopColor: colors.gray[200] },
  subtotalLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[500] },
  subtotalValue: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[800] },
  // Total card
  totalCard: { borderRadius: borderRadius['2xl'], borderWidth: 2, borderColor: colors.primary[200], padding: spacing[5], shadowColor: colors.primary[600], shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing[1.5] },
  totalLabel: { fontSize: fontSize.sm, color: colors.gray[500] },
  totalValue: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  totalMainRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing[3] },
  totalMainLabel: { fontSize: fontSize.xl, fontWeight: fontWeight.bold, color: colors.gray[900] },
  totalMainValue: { fontSize: fontSize['2xl'], fontWeight: fontWeight.bold, color: colors.primary[600] },
  totalDivider: { height: 1, backgroundColor: colors.primary[100], marginVertical: spacing[2] },
  profitDot: { width: 8, height: 8, borderRadius: 4 },
  totalProfitValue: { fontSize: fontSize.base, fontWeight: fontWeight.bold },
});
