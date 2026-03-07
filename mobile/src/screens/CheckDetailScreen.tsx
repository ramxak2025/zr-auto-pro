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
  const slideAnim = useRef(new Animated.Value(30)).current;
  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 350, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 350, useNativeDriver: true }),
    ]).start();
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
        ${check.client ? `<div>\u041A\u043B\u0438\u0435\u043D\u0442: ${check.client.fullName}</div>` : '<div>\u041A\u043B\u0438\u0435\u043D\u0442: \u0420\u043E\u0437\u043D\u0438\u0447\u043D\u044B\u0439 \u043F\u043E\u043A\u0443\u043F\u0430\u0442\u0435\u043B\u044C</div>'}
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
      {/* Modern header with gradient accent */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={20} color={colors.primary[600]} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{'\u0427\u0435\u043A'} #{check.number}</Text>
          <Text style={styles.headerDate}>{formatShortDate(check.date)}</Text>
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={generatePdf} style={styles.actionBtn}>
            <Ionicons name="document-text-outline" size={17} color={colors.violet[600]} />
          </TouchableOpacity>
          {canEdit && (
            <TouchableOpacity onPress={() => navigation.navigate('CheckCreate', { id: check.id })} style={styles.actionBtn}>
              <Ionicons name="create-outline" size={17} color={colors.primary[600]} />
            </TouchableOpacity>
          )}
          {canDelete && (
            <TouchableOpacity onPress={() => {
              Alert.alert('\u0423\u0434\u0430\u043B\u0438\u0442\u044C?', '\u042D\u0442\u043E \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u043D\u0435\u043E\u0431\u0440\u0430\u0442\u0438\u043C\u043E', [
                { text: '\u041E\u0442\u043C\u0435\u043D\u0430', style: 'cancel' },
                { text: '\u0423\u0434\u0430\u043B\u0438\u0442\u044C', style: 'destructive', onPress: () => deleteMutation.mutate() },
              ]);
            }} style={[styles.actionBtn, { backgroundColor: colors.red[50] }]}>
              <Ionicons name="trash-outline" size={17} color={colors.red[500]} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <Animated.ScrollView
        style={[styles.scroll, { opacity: fadeAnim, transform: [{ translateY: slideAnim }] }]}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Status chip row */}
        <View style={styles.chipRow}>
          <View style={[styles.statusChip, isDeferred ? { backgroundColor: colors.amber[50], borderColor: colors.amber[200] } : { backgroundColor: colors.green[50], borderColor: colors.green[200] }]}>
            <View style={[styles.statusDot, isDeferred ? { backgroundColor: colors.amber[600] } : { backgroundColor: colors.green[500] }]} />
            <Text style={[styles.statusChipText, isDeferred ? { color: colors.amber[600] } : { color: colors.green[700] }]}>
              {isDeferred ? '\u041E\u0442\u043B\u043E\u0436\u0435\u043D' : '\u0417\u0430\u043A\u0440\u044B\u0442'}
            </Text>
          </View>
          <View style={[styles.paymentChip, { backgroundColor: badge.bg, borderColor: badge.bg }]}>
            <Ionicons name={paymentIcons[check.paymentMethod] || 'cash-outline'} size={13} color={badge.text} />
            <Text style={[styles.paymentChipText, { color: badge.text }]}>{paymentLabels[check.paymentMethod] ?? check.paymentMethod}</Text>
          </View>
          <Text style={styles.timeChip}>{formatTime(check.date)}</Text>
        </View>

        {/* Client & info — modern glassmorphism style card */}
        <View style={styles.infoCard}>
          <View style={styles.infoRow}>
            <View style={[styles.infoIconCircle, { backgroundColor: colors.blue[50] }]}>
              <Ionicons name="person" size={16} color={colors.blue[600]} />
            </View>
            <View style={styles.infoContent}>
              <Text style={styles.infoLabel}>Клиент</Text>
              <Text style={styles.infoValue}>{check.client?.fullName ?? '\u0420\u043E\u0437\u043D\u0438\u0447\u043D\u044B\u0439 \u043F\u043E\u043A\u0443\u043F\u0430\u0442\u0435\u043B\u044C'}</Text>
            </View>
          </View>

          {check.car && (
            <>
              <View style={styles.infoDivider} />
              <View style={styles.infoRow}>
                <View style={[styles.infoIconCircle, { backgroundColor: colors.indigo[50] }]}>
                  <Ionicons name="car-sport" size={16} color={colors.indigo[600]} />
                </View>
                <View style={styles.infoContent}>
                  <Text style={styles.infoLabel}>Автомобиль</Text>
                  <View style={styles.carRow}>
                    <Text style={styles.infoValue}>{check.car.makeModel}</Text>
                    {check.car.plateNumber && (
                      <View style={styles.plateTag}>
                        <Text style={styles.plateTagText}>{check.car.plateNumber}</Text>
                      </View>
                    )}
                  </View>
                </View>
              </View>
            </>
          )}

          {check.master && (
            <>
              <View style={styles.infoDivider} />
              <View style={styles.infoRow}>
                <View style={[styles.infoIconCircle, { backgroundColor: colors.orange[50] }]}>
                  <Ionicons name="build" size={16} color={colors.orange[500]} />
                </View>
                <View style={styles.infoContent}>
                  <Text style={styles.infoLabel}>Мастер</Text>
                  <Text style={styles.infoValue}>{check.master.fullName}</Text>
                </View>
              </View>
            </>
          )}

          {check.mileage ? (
            <>
              <View style={styles.infoDivider} />
              <View style={styles.infoRow}>
                <View style={[styles.infoIconCircle, { backgroundColor: colors.teal[50] }]}>
                  <Ionicons name="speedometer" size={16} color={colors.teal[600]} />
                </View>
                <View style={styles.infoContent}>
                  <Text style={styles.infoLabel}>Пробег</Text>
                  <Text style={styles.infoValue}>{check.mileage.toLocaleString()} км</Text>
                </View>
              </View>
            </>
          ) : null}
        </View>

        {/* Comment */}
        {check.comment && (
          <View style={styles.commentCard}>
            <Ionicons name="chatbubble-ellipses" size={15} color={colors.primary[400]} />
            <Text style={styles.commentText}>{check.comment}</Text>
          </View>
        )}

        {/* Services */}
        {check.services.length > 0 && (
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <LinearGradient colors={[colors.orange[50], '#fff']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.sectionGradient}>
                <Ionicons name="build" size={15} color={colors.orange[500]} />
                <Text style={styles.sectionTitle}>Услуги</Text>
              </LinearGradient>
              <View style={styles.sectionBadge}>
                <Text style={styles.sectionBadgeText}>{check.services.length}</Text>
              </View>
            </View>
            {(check.services || []).map((line, idx) => (
              <View key={idx} style={[styles.lineItem, idx > 0 && styles.lineItemBorder]}>
                <View style={styles.lineItemLeft}>
                  <Text style={styles.lineItemName}>{line.name}</Text>
                  <View style={styles.lineItemMeta}>
                    {line.master && <Text style={styles.lineItemMetaText}>{line.master.fullName}</Text>}
                    {line.quantity > 1 && <Text style={styles.lineItemMetaText}>{line.quantity} x {formatMoney(line.price)}</Text>}
                  </View>
                </View>
                <Text style={styles.lineItemPrice}>{formatMoney(line.total)}</Text>
              </View>
            ))}
            <View style={styles.sectionSubtotal}>
              <Text style={styles.subtotalLabel}>Итого услуги</Text>
              <Text style={styles.subtotalValue}>{formatMoney(check.serviceTotal)}</Text>
            </View>
          </View>
        )}

        {/* Products */}
        {check.products.length > 0 && (
          <View style={styles.sectionCard}>
            <View style={styles.sectionHeader}>
              <LinearGradient colors={[colors.blue[50], '#fff']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.sectionGradient}>
                <Ionicons name="cube" size={15} color={colors.blue[600]} />
                <Text style={styles.sectionTitle}>Товары</Text>
              </LinearGradient>
              <View style={styles.sectionBadge}>
                <Text style={styles.sectionBadgeText}>{check.products.length}</Text>
              </View>
            </View>
            {(check.products || []).map((line, idx) => (
              <View key={idx} style={[styles.lineItem, idx > 0 && styles.lineItemBorder]}>
                <View style={styles.lineItemLeft}>
                  <Text style={styles.lineItemName}>{line.name}</Text>
                  {line.quantity > 1 && (
                    <View style={styles.lineItemMeta}>
                      <Text style={styles.lineItemMetaText}>{line.quantity} x {formatMoney(line.sellPrice)}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.lineItemPrice}>{formatMoney(line.totalSell)}</Text>
              </View>
            ))}
            <View style={styles.sectionSubtotal}>
              <Text style={styles.subtotalLabel}>Итого товары</Text>
              <Text style={styles.subtotalValue}>{formatMoney(check.productTotal)}</Text>
            </View>
          </View>
        )}

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
            <View style={styles.profitRow}>
              <View style={styles.profitLeft}>
                <Ionicons name="trending-up" size={16} color={check.profit >= 0 ? colors.green[600] : colors.red[500]} />
                <Text style={styles.profitLabel}>Прибыль</Text>
              </View>
              <Text style={[styles.profitValue, check.profit >= 0 ? { color: colors.green[600] } : { color: colors.red[500] }]}>
                {check.profit >= 0 ? '+' : ''}{formatMoney(check.profit)}
              </Text>
            </View>
          )}
        </View>
      </Animated.ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.gray[50] },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2.5],
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[100],
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
  headerTitle: { fontSize: fontSize.lg, fontWeight: fontWeight.bold, color: colors.gray[900] },
  headerDate: { fontSize: 11, color: colors.gray[400], marginTop: 1 },
  headerActions: { flexDirection: 'row', gap: spacing[1.5], alignItems: 'center' },
  actionBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.gray[50],
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
  timeChip: { fontSize: 12, color: colors.gray[400], marginLeft: 'auto' },

  // Info card
  infoCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: colors.gray[100],
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
  infoLabel: { fontSize: 11, color: colors.gray[400], marginBottom: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  infoValue: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[900] },
  infoDivider: { height: 1, backgroundColor: colors.gray[50], marginVertical: spacing[3], marginLeft: spacing[4] + 40 },
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
  commentText: { fontSize: fontSize.sm, color: colors.gray[700], flex: 1, lineHeight: 20 },

  // Section card
  sectionCard: {
    backgroundColor: colors.white,
    borderRadius: borderRadius['2xl'],
    borderWidth: 1,
    borderColor: colors.gray[100],
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
  sectionTitle: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },
  sectionBadge: {
    backgroundColor: colors.gray[100],
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: borderRadius.full,
    minWidth: 24,
    alignItems: 'center',
  },
  sectionBadgeText: { fontSize: 11, fontWeight: fontWeight.bold, color: colors.gray[500] },

  // Line items
  lineItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  lineItemBorder: { borderTopWidth: 1, borderTopColor: colors.gray[50] },
  lineItemLeft: { flex: 1, marginRight: spacing[3] },
  lineItemName: { fontSize: fontSize.sm, fontWeight: fontWeight.medium, color: colors.gray[900] },
  lineItemMeta: { flexDirection: 'row', gap: spacing[2], marginTop: 3 },
  lineItemMetaText: { fontSize: 11, color: colors.gray[400] },
  lineItemPrice: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },

  // Subtotal
  sectionSubtotal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderTopWidth: 1,
    borderTopColor: colors.gray[100],
    backgroundColor: colors.gray[50],
  },
  subtotalLabel: { fontSize: fontSize.sm, fontWeight: fontWeight.semibold, color: colors.gray[500] },
  subtotalValue: { fontSize: fontSize.sm, fontWeight: fontWeight.bold, color: colors.gray[900] },

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
    backgroundColor: colors.white,
  },
  profitLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  profitLabel: { fontSize: fontSize.sm, color: colors.gray[500] },
  profitValue: { fontSize: fontSize.base, fontWeight: fontWeight.bold },
});
