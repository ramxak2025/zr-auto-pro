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
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={20} color={colors.primary[600]} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{'\u0427\u0435\u043A'} #{check.number}</Text>
        <View style={{ flexDirection: 'row', gap: spacing[1.5], alignItems: 'center' }}>
          <TouchableOpacity onPress={generatePdf} style={styles.actionBtn}>
            <Ionicons name="document-text-outline" size={16} color={colors.violet[600]} />
          </TouchableOpacity>
          {canEdit && (
            <TouchableOpacity onPress={() => navigation.navigate('CheckCreate', { id: check.id })} style={styles.actionBtn}>
              <Ionicons name="create-outline" size={16} color={colors.primary[600]} />
            </TouchableOpacity>
          )}
          {canDelete && (
            <TouchableOpacity onPress={() => {
              Alert.alert('\u0423\u0434\u0430\u043B\u0438\u0442\u044C?', '\u042D\u0442\u043E \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u043D\u0435\u043E\u0431\u0440\u0430\u0442\u0438\u043C\u043E', [
                { text: '\u041E\u0442\u043C\u0435\u043D\u0430', style: 'cancel' },
                { text: '\u0423\u0434\u0430\u043B\u0438\u0442\u044C', style: 'destructive', onPress: () => deleteMutation.mutate() },
              ]);
            }} style={[styles.actionBtn, { backgroundColor: colors.red[50] }]}>
              <Ionicons name="trash-outline" size={16} color={colors.red[500]} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <Animated.ScrollView style={[styles.scroll, { opacity: fadeAnim }]} contentContainerStyle={styles.scrollContent}>
        {/* Status and date header */}
        <View style={styles.statusRow}>
          <View style={[styles.statusBadge, isDeferred ? { backgroundColor: colors.amber[50] } : { backgroundColor: colors.green[50] }]}>
            <Ionicons name={isDeferred ? 'time-outline' : 'checkmark-circle'} size={14} color={isDeferred ? colors.amber[600] : colors.green[600]} />
            <Text style={[styles.statusText, isDeferred ? { color: colors.amber[600] } : { color: colors.green[600] }]}>
              {isDeferred ? '\u041E\u0442\u043B\u043E\u0436\u0435\u043D' : '\u0417\u0430\u043A\u0440\u044B\u0442'}
            </Text>
          </View>
          <Text style={styles.dateText}>{formatDateTime(check.date)}</Text>
        </View>

        {/* Client & Car info card */}
        <View style={styles.card}>
          {/* Client */}
          <View style={styles.infoBlock}>
            <View style={[styles.infoIcon, { backgroundColor: colors.blue[50] }]}>
              <Ionicons name="person-outline" size={16} color={colors.blue[600]} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.infoBlockLabel}>{'\u041A\u043B\u0438\u0435\u043D\u0442'}</Text>
              <Text style={styles.infoBlockValue}>{check.client?.fullName ?? '\u0420\u043E\u0437\u043D\u0438\u0447\u043D\u044B\u0439 \u043F\u043E\u043A\u0443\u043F\u0430\u0442\u0435\u043B\u044C'}</Text>
            </View>
          </View>

          {/* Car */}
          {check.car && (
            <>
              <View style={styles.infoSeparator} />
              <View style={styles.infoBlock}>
                <View style={[styles.infoIcon, { backgroundColor: colors.indigo[50] }]}>
                  <Ionicons name="car-outline" size={16} color={colors.indigo[600]} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.infoBlockLabel}>{'\u0410\u0432\u0442\u043E\u043C\u043E\u0431\u0438\u043B\u044C'}</Text>
                  <Text style={styles.infoBlockValue}>{check.car.makeModel}</Text>
                  {check.car.plateNumber && (
                    <View style={styles.plateChip}>
                      <Text style={styles.plateChipText}>{check.car.plateNumber}</Text>
                    </View>
                  )}
                </View>
              </View>
            </>
          )}

          {/* Master */}
          <View style={styles.infoSeparator} />
          <View style={styles.infoBlock}>
            <View style={[styles.infoIcon, { backgroundColor: colors.orange[50] }]}>
              <Ionicons name="build-outline" size={16} color={colors.orange[500]} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.infoBlockLabel}>{'\u041C\u0430\u0441\u0442\u0435\u0440'}</Text>
              <Text style={styles.infoBlockValue}>{check.master?.fullName ?? '\u2014'}</Text>
            </View>
          </View>

          {/* Payment */}
          <View style={styles.infoSeparator} />
          <View style={styles.infoBlock}>
            <View style={[styles.infoIcon, { backgroundColor: badge.bg }]}>
              <Ionicons name={paymentIcons[check.paymentMethod] || 'cash-outline'} size={16} color={badge.text} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.infoBlockLabel}>{'\u041E\u043F\u043B\u0430\u0442\u0430'}</Text>
              <Text style={styles.infoBlockValue}>{paymentLabels[check.paymentMethod] ?? check.paymentMethod}</Text>
            </View>
          </View>

          {/* Mileage */}
          {check.mileage ? (
            <>
              <View style={styles.infoSeparator} />
              <View style={styles.infoBlock}>
                <View style={[styles.infoIcon, { backgroundColor: colors.teal[50] }]}>
                  <Ionicons name="speedometer-outline" size={16} color={colors.teal[600]} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.infoBlockLabel}>{'\u041F\u0440\u043E\u0431\u0435\u0433'}</Text>
                  <Text style={styles.infoBlockValue}>{check.mileage.toLocaleString()} {'\u043A\u043C'}</Text>
                </View>
              </View>
            </>
          ) : null}
        </View>

        {/* Comment */}
        {check.comment && (
          <View style={styles.commentCard}>
            <Ionicons name="chatbubble-outline" size={14} color={colors.gray[400]} />
            <Text style={styles.commentText}>{check.comment}</Text>
          </View>
        )}

        {/* Services */}
        {check.services.length > 0 && (
          <View style={styles.card}>
            <View style={styles.sectionHeader}>
              <View style={[styles.sectionIcon, { backgroundColor: colors.orange[50] }]}>
                <Ionicons name="build-outline" size={14} color={colors.orange[500]} />
              </View>
              <Text style={styles.sectionTitle}>{'\u0423\u0441\u043B\u0443\u0433\u0438'}</Text>
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{(check.services || []).length}</Text>
              </View>
            </View>
            {(check.services || []).map((line, idx) => (
              <View key={idx} style={[styles.lineRow, idx === 0 && { borderTopWidth: 0 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lineName}>{line.name}</Text>
                  {line.master && <Text style={styles.lineSub}>{line.master.fullName}</Text>}
                  {line.quantity > 1 && <Text style={styles.lineSub}>{line.quantity} x {formatMoney(line.price)}</Text>}
                </View>
                <Text style={styles.linePrice}>{formatMoney(line.total)}</Text>
              </View>
            ))}
            <View style={styles.subtotalRow}>
              <Text style={styles.subtotalLabel}>{'\u0418\u0442\u043E\u0433\u043E \u0443\u0441\u043B\u0443\u0433\u0438'}</Text>
              <Text style={styles.subtotalValue}>{formatMoney(check.serviceTotal)}</Text>
            </View>
          </View>
        )}

        {/* Products */}
        {check.products.length > 0 && (
          <View style={styles.card}>
            <View style={styles.sectionHeader}>
              <View style={[styles.sectionIcon, { backgroundColor: colors.blue[50] }]}>
                <Ionicons name="cube-outline" size={14} color={colors.blue[600]} />
              </View>
              <Text style={styles.sectionTitle}>{'\u0422\u043E\u0432\u0430\u0440\u044B'}</Text>
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeText}>{(check.products || []).length}</Text>
              </View>
            </View>
            {(check.products || []).map((line, idx) => (
              <View key={idx} style={[styles.lineRow, idx === 0 && { borderTopWidth: 0 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.lineName}>{line.name}</Text>
                  {line.quantity > 1 && <Text style={styles.lineSub}>{line.quantity} x {formatMoney(line.sellPrice)}</Text>}
                </View>
                <Text style={styles.linePrice}>{formatMoney(line.totalSell)}</Text>
              </View>
            ))}
            <View style={styles.subtotalRow}>
              <Text style={styles.subtotalLabel}>{'\u0418\u0442\u043E\u0433\u043E \u0442\u043E\u0432\u0430\u0440\u044B'}</Text>
              <Text style={styles.subtotalValue}>{formatMoney(check.productTotal)}</Text>
            </View>
          </View>
        )}

        {/* Total summary card */}
        <LinearGradient
          colors={['#f8fafc', '#ffffff']}
          style={styles.totalCard}
        >
          {(check.discount ?? 0) > 0 && (
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>{'\u0421\u043A\u0438\u0434\u043A\u0430'}</Text>
              <Text style={[styles.totalValue, { color: colors.orange[500] }]}>-{formatMoney(check.discount ?? 0)}</Text>
            </View>
          )}
          <View style={styles.totalMainRow}>
            <Text style={styles.totalMainLabel}>{'\u0418\u0442\u043E\u0433\u043E'}</Text>
            <Text style={styles.totalMainValue}>{formatMoney(check.totalRevenue)}</Text>
          </View>
          {canViewProfit && (
            <>
              <View style={styles.totalDivider} />
              <View style={styles.totalRow}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[1.5] }}>
                  <Ionicons name="trending-up" size={14} color={check.profit >= 0 ? colors.green[600] : colors.red[500]} />
                  <Text style={styles.totalLabel}>{'\u041F\u0440\u0438\u0431\u044B\u043B\u044C'}</Text>
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
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing[4], paddingVertical: spacing[3], backgroundColor: colors.white, borderBottomWidth: 1, borderBottomColor: colors.gray[100] },
  backBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.primary[50], alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.gray[900] },
  actionBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.gray[50], alignItems: 'center', justifyContent: 'center' },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing[4], gap: spacing[3], paddingBottom: spacing[8] },
  // Status
  statusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: spacing[1.5], paddingHorizontal: spacing[3], paddingVertical: spacing[1.5], borderRadius: borderRadius.full },
  statusText: { fontSize: fontSize.xs, fontWeight: fontWeight.semibold },
  dateText: { fontSize: fontSize.xs, color: colors.gray[400] },
  // Info card
  card: { backgroundColor: colors.white, borderRadius: borderRadius['2xl'], borderWidth: 1, borderColor: colors.gray[100], padding: spacing[4], shadowColor: colors.black, shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  infoBlock: { flexDirection: 'row', alignItems: 'center', gap: spacing[3] },
  infoIcon: { width: 36, height: 36, borderRadius: borderRadius.lg, alignItems: 'center', justifyContent: 'center' },
  infoBlockLabel: { fontSize: 11, color: colors.gray[400], marginBottom: 1 },
  infoBlockValue: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  infoSeparator: { height: 1, backgroundColor: colors.gray[50], marginVertical: spacing[3] },
  plateChip: { alignSelf: 'flex-start', marginTop: 4, backgroundColor: colors.primary[50], borderRadius: borderRadius.md, paddingHorizontal: spacing[2], paddingVertical: 2, borderWidth: 1, borderColor: colors.primary[200] },
  plateChipText: { fontSize: 12, fontWeight: fontWeight.bold, color: colors.primary[700] },
  // Comment
  commentCard: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing[2], backgroundColor: colors.white, borderRadius: borderRadius.xl, borderWidth: 1, borderColor: colors.gray[100], padding: spacing[3.5] },
  commentText: { fontSize: fontSize.sm, color: colors.gray[600], flex: 1, lineHeight: 20 },
  // Section
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginBottom: spacing[3] },
  sectionIcon: { width: 28, height: 28, borderRadius: borderRadius.md, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900], flex: 1 },
  countBadge: { backgroundColor: colors.gray[100], paddingHorizontal: 8, paddingVertical: 2, borderRadius: borderRadius.full },
  countBadgeText: { fontSize: 11, fontWeight: fontWeight.bold, color: colors.gray[500] },
  // Lines
  lineRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing[2.5], borderTopWidth: 1, borderTopColor: colors.gray[50] },
  lineName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900] },
  lineSub: { fontSize: fontSize.xs, color: colors.gray[400], marginTop: 2 },
  linePrice: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  subtotalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingTop: spacing[3], marginTop: spacing[2], borderTopWidth: 1, borderTopColor: colors.gray[200] },
  subtotalLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[600] },
  subtotalValue: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  // Total
  totalCard: { borderRadius: borderRadius['2xl'], borderWidth: 2, borderColor: colors.primary[100], padding: spacing[5], shadowColor: colors.black, shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing[1.5] },
  totalLabel: { fontSize: fontSize.sm, color: colors.gray[500] },
  totalValue: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  totalMainRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing[2] },
  totalMainLabel: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.gray[900] },
  totalMainValue: { fontSize: fontSize['2xl'], fontWeight: fontWeight.bold, color: colors.primary[600] },
  totalDivider: { height: 1, backgroundColor: colors.gray[100], marginVertical: spacing[2] },
  totalProfitValue: { fontSize: fontSize.base, fontWeight: fontWeight.bold },
});
