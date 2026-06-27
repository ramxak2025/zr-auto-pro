/**
 * SupplierRequestSheet — «Сформировать запрос поставщику».
 *
 * Bottom-sheet that turns a purchase-order draft into a plain-text price
 * request: each line «• <название как на складе> — <кол-во> шт», без цен и
 * без итогов, обёрнутое дружелюбным приветствием и просьбой прислать счёт с
 * актуальными ценами.
 *
 * Две кнопки:
 *   • «Скопировать»     — системный share-лист (в проекте нет expo-clipboard;
 *                         тот же приём, что и в IntegrationsScreen: Share
 *                         даёт пункт «Скопировать»).
 *   • «Открыть WhatsApp» — deep-link `whatsapp://send?phone=<цифры>&text=…`.
 *                         Работает БЕЗ WhatsApp Business API. Если у поставщика
 *                         нет телефона — открывается выбор контакта с уже
 *                         подставленным текстом.
 *
 * Android-safe: только Share + Linking из react-native, без iOS-only API.
 */
import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Share, Linking, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from '../../components/BottomSheet';
import { useColors } from '../../contexts/ThemeContext';
import { haptic } from '../../platform/haptics';
import { colors, borderRadius, spacing } from '../../theme';
import { buildSupplierRequestText, buildWhatsappLink, type SupplierRequestLine } from './purchaseOrderHelpers';

interface SupplierRequestSheetProps {
  visible: boolean;
  onClose: () => void;
  supplierName?: string | null;
  supplierPhone?: string | null;
  lines: SupplierRequestLine[];
}

export default function SupplierRequestSheet({
  visible,
  onClose,
  supplierName,
  supplierPhone,
  lines,
}: SupplierRequestSheetProps) {
  const palette = useColors();

  const text = useMemo(() => buildSupplierRequestText(lines, supplierName), [lines, supplierName]);

  const handleCopy = async () => {
    haptic('tap');
    try {
      // В проекте нет expo-clipboard — системный share-лист содержит пункт
      // «Скопировать» и заодно позволяет сразу отправить текст в любой
      // мессенджер. Тот же приём используется в IntegrationsScreen.
      await Share.share({ message: text });
      haptic('success');
    } catch {
      // Пользователь закрыл лист — это не ошибка.
    }
  };

  const handleWhatsapp = async () => {
    haptic('tap');
    const link = buildWhatsappLink(text, supplierPhone);
    try {
      const ok = await Linking.canOpenURL(link);
      if (!ok) throw new Error('whatsapp-unavailable');
      await Linking.openURL(link);
    } catch {
      haptic('error');
      Alert.alert(
        'WhatsApp недоступен',
        'Похоже, WhatsApp не установлен. Текст запроса можно скопировать и отправить вручную.',
      );
    }
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="Запрос поставщику" heightRatio={0.7}>
      <Text style={[styles.hint, { color: palette.text.tertiary }]}>
        Сообщение без цен — поставщик пришлёт актуальные цены в ответ.
      </Text>

      <ScrollView
        style={[styles.preview, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }]}
        contentContainerStyle={styles.previewContent}
      >
        <Text style={[styles.previewText, { color: palette.text.primary }]} selectable>
          {text}
        </Text>
      </ScrollView>

      <View style={styles.actions}>
        <TouchableOpacity
          style={[styles.secondaryBtn, { borderColor: palette.border.strong }]}
          onPress={handleCopy}
          activeOpacity={0.85}
        >
          <Ionicons name="copy-outline" size={18} color={palette.text.primary} />
          <Text style={[styles.secondaryBtnText, { color: palette.text.primary }]}>Скопировать</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.whatsappBtn} onPress={handleWhatsapp} activeOpacity={0.85}>
          <Ionicons name="logo-whatsapp" size={18} color={colors.white} />
          <Text style={styles.whatsappBtnText}>Открыть WhatsApp</Text>
        </TouchableOpacity>
      </View>
    </BottomSheet>
  );
}

const WHATSAPP_GREEN = '#25D366';

const styles = StyleSheet.create({
  hint: { fontSize: 13, lineHeight: 18, marginBottom: spacing[2] },
  preview: {
    maxHeight: 260,
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  previewContent: { padding: spacing[3.5] },
  previewText: { fontSize: 14, lineHeight: 21 },
  actions: { flexDirection: 'row', gap: spacing[2.5], marginTop: spacing[4] },
  secondaryBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3.5],
    borderRadius: borderRadius.xl,
    borderWidth: StyleSheet.hairlineWidth,
  },
  secondaryBtnText: { fontSize: 15, fontWeight: '700', letterSpacing: -0.2 },
  whatsappBtn: {
    flex: 1.3,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    paddingVertical: spacing[3.5],
    borderRadius: borderRadius.xl,
    backgroundColor: WHATSAPP_GREEN,
  },
  whatsappBtnText: { fontSize: 15, fontWeight: '700', color: colors.white, letterSpacing: -0.2 },
});
