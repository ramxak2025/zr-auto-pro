/**
 * PaymentMethodModal — премиальная ЦЕНТРАЛЬНАЯ модалка выбора способа оплаты
 * для кассы. Заменяет инлайновый ряд из четырёх кнопок на одной кнопке
 * «Оплата», открывающей этот выбор крупными карточками.
 *
 * Способы (ключи строго из shared `PaymentMethod` — enum НЕ меняем):
 *   • cash      — Наличные
 *   • card      — Карта
 *   • cash_card — Смешанная (часть наличными, часть на карту)
 *   • warranty  — По гарантии
 *   • installment — Рассрочка (доп. пункт, виден ТОЛЬКО при prop
 *     `showInstallment` — т.е. у пользователей с правом sell_installment на
 *     новом чеке; выбирается тем же тапом, что и остальные способы)
 *
 * Каждая карточка: цветная иконка Ionicons в скруглённом тайле, заголовок,
 * короткое описание; активная подсвечивается цветом способа + галочкой
 * справа. Выбор закрывает модалку немедленно (как нативный picker iOS).
 *
 * Анимация — нежная iOS-премиум: бэкдроп фейдит, карточка появляется
 * spring-масштабом (0.92 → 1) с лёгким fade, без резких переходов. При
 * Reduce Motion анимация выключается (мгновенное появление). На Android —
 * та же RNModal, fade-бэкдроп, спокойный spring.
 *
 * Компонент «глупый»/переиспользуемый: состояние выбора и открытия живёт у
 * родителя (CheckCreateScreen). Здесь — только презентация и onSelect.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Modal as RNModal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  AccessibilityInfo,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ModalBlurBackdrop from './ModalBlurBackdrop';
import { useColors } from '../contexts/ThemeContext';
import { colors, fontSize, fontWeight, borderRadius, spacing, softTint } from '../theme';
import { haptic } from '../platform/haptics';
import type { PaymentMethod } from '../../../shared/types';

/**
 * Презентационное описание одного способа оплаты. `key` строго типизирован
 * значениями enum `PaymentMethod` из shared — никаких сырых строк, чтобы
 * любое расхождение с контрактом ловилось компилятором.
 */
interface PaymentOption {
  key: PaymentMethod;
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  /** Акцентный цвет способа (иконка + рамка/фон активной карточки). */
  color: string;
  /** Мягкий фон тайла иконки. */
  tint: string;
}

// Литералы способов соответствуют значениям `PaymentMethod`
// ('cash' | 'card' | 'cash_card' | 'warranty'). Приведение через
// `as PaymentMethod` сохраняет совместимость с проектом, где enum
// иногда сравнивается со строковыми литералами.
const PAYMENT_OPTIONS: readonly PaymentOption[] = [
  {
    key: 'cash' as PaymentMethod,
    label: 'Наличные',
    description: 'Оплата наличными в кассу',
    icon: 'cash-outline',
    color: colors.green[600],
    tint: colors.green[50],
  },
  {
    key: 'card' as PaymentMethod,
    label: 'Карта',
    description: 'Оплата банковской картой',
    icon: 'card-outline',
    color: colors.blue[600],
    tint: colors.blue[50],
  },
  {
    key: 'cash_card' as PaymentMethod,
    label: 'Смешанная',
    description: 'Часть наличными, часть на карту',
    icon: 'swap-horizontal-outline',
    color: colors.purple[700],
    tint: colors.purple[50],
  },
  {
    key: 'warranty' as PaymentMethod,
    label: 'По гарантии',
    description: 'Бесплатно — гарантийный случай',
    icon: 'shield-checkmark-outline',
    color: colors.amber[600],
    tint: colors.amber[50],
  },
] as const;

// «Рассрочка» — отдельный способ оплаты. Держим ОТДЕЛЬНОЙ константой (а не в
// PAYMENT_OPTIONS), чтобы без явного разрешения родителя (prop `showInstallment`)
// пункт вообще не попадал в список выбора. Amber-идентичность совпадает с
// инлайновым блоком полей рассрочки в кассе; иконка-календарь — чтобы не
// дублировать «карту» из способа «Карта».
const INSTALLMENT_OPTION: PaymentOption = {
  key: 'installment' as PaymentMethod,
  label: 'Рассрочка',
  description: 'Часть сейчас, остаток — частями',
  icon: 'calendar-outline',
  color: colors.amber[600],
  tint: colors.amber[50],
};

// Полный справочник (включая рассрочку) — для подписи/визуала уже ВЫБРАННОГО
// способа на кнопке «Оплата», независимо от того, показан ли пункт в списке.
// Иначе выбранная «Рассрочка» отрисовалась бы как «Наличные».
const ALL_PAYMENT_OPTIONS: readonly PaymentOption[] = [...PAYMENT_OPTIONS, INSTALLMENT_OPTION];

/** Краткая подпись способа для компактного отображения выбранного метода. */
export function paymentMethodLabel(method: PaymentMethod): string {
  return ALL_PAYMENT_OPTIONS.find((o) => o.key === method)?.label ?? 'Наличные';
}

/** Иконка + акцентный цвет выбранного способа — для кнопки «Оплата». */
export function paymentMethodVisual(method: PaymentMethod): {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  tint: string;
} {
  const o = ALL_PAYMENT_OPTIONS.find((opt) => opt.key === method) ?? ALL_PAYMENT_OPTIONS[0];
  return { icon: o.icon, color: o.color, tint: o.tint };
}

interface PaymentMethodModalProps {
  visible: boolean;
  /** Текущий выбранный способ — подсвечивается галочкой. */
  value: PaymentMethod;
  /** Выбор способа. Родитель закрывает модалку. */
  onSelect: (method: PaymentMethod) => void;
  onClose: () => void;
  /** Показать «Рассрочку» доп. пунктом (право sell_installment + новый чек).
   *  По умолчанию скрыта — полная обратная совместимость. */
  showInstallment?: boolean;
}

export default function PaymentMethodModal({
  visible,
  value,
  onSelect,
  onClose,
  showInstallment = false,
}: PaymentMethodModalProps) {
  const palette = useColors();

  // Reduce Motion — кэшируем синхронно, чтобы первый кадр уже знал, нужна ли
  // анимация (иначе карточка моргнёт из масштаба в полный размер).
  const reduceMotionRef = useRef(false);
  const [, force] = useState(0);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => {
        if (alive) {
          reduceMotionRef.current = v;
          force((n) => n + 1);
        }
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (v) => {
      reduceMotionRef.current = v;
      force((n) => n + 1);
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  // Нежная spring-анимация появления карточки: scale 0.92 → 1 + fade.
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (visible) {
      if (reduceMotionRef.current) {
        progress.setValue(1);
      } else {
        progress.setValue(0);
        Animated.spring(progress, {
          toValue: 1,
          useNativeDriver: true,
          damping: 22,
          stiffness: 240,
          mass: 0.9,
        }).start();
      }
    } else {
      progress.setValue(0);
    }
  }, [visible, progress]);

  const cardScale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] });

  const handleSelect = (method: PaymentMethod) => {
    haptic('select');
    onSelect(method);
  };

  return (
    <RNModal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <ModalBlurBackdrop onPress={onClose} />
        <Animated.View
          style={[
            styles.card,
            { backgroundColor: palette.bg.elevated, opacity: progress, transform: [{ scale: cardScale }] },
          ]}
        >
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <Ionicons name="wallet-outline" size={18} color={colors.green[600]} />
              <Text style={[styles.title, { color: palette.text.primary }]}>Способ оплаты</Text>
            </View>
            <TouchableOpacity
              onPress={onClose}
              style={[styles.closeBtn, { backgroundColor: palette.bg.muted }]}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityLabel="Закрыть"
            >
              <Ionicons name="close" size={18} color={palette.text.tertiary} />
            </TouchableOpacity>
          </View>

          <View style={styles.list}>
            {(showInstallment ? ALL_PAYMENT_OPTIONS : PAYMENT_OPTIONS).map((opt) => {
              const active = value === opt.key;
              // Light keeps the option's pale `[50]` tint; dark swaps it for a
              // muted translucent tint of the same accent so the card/icon-tile
              // don't glow on the dark sheet.
              const tint = palette.mode === 'dark' ? softTint(opt.color, 'dark') : opt.tint;
              const activeIconBg = palette.mode === 'dark' ? palette.bg.elevated : '#FFFFFF';
              return (
                <TouchableOpacity
                  key={opt.key}
                  activeOpacity={0.85}
                  onPress={() => handleSelect(opt.key)}
                  style={[
                    styles.option,
                    { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle },
                    active && { borderColor: opt.color, backgroundColor: tint },
                  ]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={opt.label}
                >
                  <View style={[styles.optionIcon, { backgroundColor: active ? activeIconBg : tint }]}>
                    <Ionicons name={opt.icon} size={22} color={opt.color} />
                  </View>
                  <View style={styles.optionText}>
                    <Text
                      style={[
                        styles.optionLabel,
                        { color: palette.text.primary },
                        active && { color: opt.color, fontWeight: fontWeight.bold },
                      ]}
                      numberOfLines={1}
                    >
                      {opt.label}
                    </Text>
                    <Text style={[styles.optionDesc, { color: palette.text.tertiary }]} numberOfLines={1}>
                      {opt.description}
                    </Text>
                  </View>
                  {active ? (
                    <View style={[styles.checkCircle, { backgroundColor: opt.color }]}>
                      <Ionicons name="checkmark" size={15} color="#FFFFFF" />
                    </View>
                  ) : (
                    <View style={[styles.radioEmpty, { borderColor: palette.border.strong }]} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
        </Animated.View>
      </View>
    </RNModal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing[5],
  },
  card: {
    width: '100%',
    maxWidth: 420,
    borderRadius: Platform.OS === 'android' ? 28 : borderRadius['2xl'],
    paddingTop: spacing[4],
    paddingBottom: spacing[4],
    paddingHorizontal: spacing[4],
    shadowColor: colors.black,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 28,
    elevation: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing[3],
  },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  title: { fontSize: fontSize.lg, fontWeight: fontWeight.bold },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: { gap: spacing[2.5] },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[3],
    borderRadius: borderRadius.xl,
    borderWidth: 1.5,
  },
  optionIcon: {
    width: 44,
    height: 44,
    borderRadius: borderRadius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: { flex: 1, minWidth: 0 },
  optionLabel: { fontSize: fontSize.base, fontWeight: fontWeight.semibold, letterSpacing: -0.2 },
  optionDesc: { fontSize: fontSize.xs, marginTop: 2, letterSpacing: -0.1 },
  checkCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioEmpty: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
  },
});
