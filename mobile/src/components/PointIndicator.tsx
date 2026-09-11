/**
 * PointIndicator — НЕинтерактивный индикатор автосервиса ТЕКУЩЕЙ СЕССИИ
 * (мульти-точки 156/160/161/163).
 *
 * ЧТО ЭТО И ПОЧЕМУ НЕ ПЕРЕКЛЮЧАТЕЛЬ. У владельца два РАЗНЫХ автосервиса:
 * основной («ZR AUTO» — сам сервис, вся история до появления филиалов) и
 * открытый позже филиал («ТопГаз»). Филиал выбирается ОДИН РАЗ, при входе
 * (163), и живёт ровно столько, сколько живёт сессия. Сменить его внутри
 * приложения нельзя вообще — ни отсюда, ни из раздела «Филиалы»: там для этого
 * предлагают выйти и войти заново.
 *
 * Поэтому здесь остался ровно один смысл: ПОКАЗАТЬ, где человек сейчас
 * работает, до того как он нажмёт «Пробить». Ни тапа, ни навигации: прошлая
 * волна ставила сюда выпадающий выбор, и одним неудачным тапом по шапке касса
 * уезжала в соседний автосервис — заметить это можно было уже только по чужой
 * выручке. Следующая волна заменила выбор переходом в раздел, но переход с
 * Кассы всё равно уносил экран из-под набранного заказ-наряда. Теперь это
 * просто подпись.
 *
 * ВАРИАНТЫ:
 *   • `chip`   — компактная пилюля для шапок списков (главная, Журнал, смена,
 *                расписание);
 *   • `banner` — широкая строка для Кассы: там цена ошибки максимальна, и
 *                автосервис должен читаться боковым зрением.
 *
 * Индикатор не рисуется, когда показывать нечего (см. `multiPoint` в
 * hooks/usePoints): у одноточечного тенанта второго автосервиса не существует,
 * и подпись «ZR AUTO» была бы шумом. Не рисуется он и пока филиал сессии
 * неизвестен (первый холодный старт до ответа сети) — пустая или гадательная
 * подпись в денежной шапке хуже её отсутствия.
 */
import React from 'react';
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../platform/Typography';
import { useColors } from '../contexts/ThemeContext';
import { useIosSurface } from '../platform/iosSurface';
import { spacing, borderRadius } from '../theme';
import { usePointAccess, pointKindLabel } from '../hooks/usePoints';

export interface PointIndicatorProps {
  variant?: 'chip' | 'banner';
  style?: StyleProp<ViewStyle>;
}

export default function PointIndicator({ variant = 'chip', style }: PointIndicatorProps) {
  const { currentPoint, multiPoint } = usePointAccess();

  if (!multiPoint || !currentPoint) return null;

  const props = {
    label: currentPoint.name,
    // Подзаголовок «Основной сервис» / «Филиал» — чтобы владелец видел не
    // просто название, а КАКОЙ из своих автосервисов сейчас открыт.
    kind: pointKindLabel(currentPoint),
    isMain: currentPoint.isMain,
    style,
  };
  return variant === 'banner' ? <BannerRow {...props} /> : <ChipRow {...props} />;
}

interface RowProps {
  label: string;
  /** «Основной сервис» / «Филиал». */
  kind: string;
  isMain: boolean;
  style?: StyleProp<ViewStyle>;
}

/**
 * Иконка автосервиса: дом = основной сервис (сам автосервис владельца),
 * здание = филиал. Разные глифы, потому что это разные сущности, а не два
 * одинаковых пункта списка.
 */
function pointIcon(isMain: boolean): keyof typeof Ionicons.glyphMap {
  return isMain ? 'home' : 'business';
}

function ChipRow({ label, kind, isMain, style }: RowProps) {
  const palette = useColors();
  const tone = palette.text.secondary;
  return (
    <View
      style={[styles.chip, { backgroundColor: palette.bg.muted, borderColor: palette.border.subtle }, style]}
      accessibilityRole="text"
      accessibilityLabel={`Автосервис: ${label}, ${kind.toLowerCase()}`}
    >
      <Ionicons name={pointIcon(isMain)} size={13} color={tone} />
      <Text style={[styles.chipText, { color: tone }]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function BannerRow({ label, kind, isMain, style }: RowProps) {
  const palette = useColors();
  const surface = useIosSurface();
  return (
    <View
      style={[
        // cardCompact ПЕРВЫМ: дальше идут собственные радиус/отступы строки —
        // в RN выигрывает последний стиль, и порядок здесь смысловой.
        surface.cardCompact,
        styles.banner,
        { borderColor: palette.border.subtle, backgroundColor: palette.bg.card },
        style,
      ]}
      accessibilityRole="text"
      accessibilityLabel={`Заказ-наряд создаётся в автосервисе: ${label}, ${kind.toLowerCase()}`}
    >
      <View style={[styles.bannerIcon, { backgroundColor: palette.accent.primarySoft }]}>
        <Ionicons name={pointIcon(isMain)} size={16} color={palette.accent.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.bannerCaption, { color: palette.text.tertiary }]}>Автосервис заказ-наряда</Text>
        <Text style={[styles.bannerLabel, { color: palette.text.primary }]} numberOfLines={1}>
          {label}
        </Text>
        <Text style={[styles.bannerKind, { color: palette.text.tertiary }]}>{kind}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing[2.5],
    paddingVertical: spacing[1],
    borderRadius: borderRadius.full,
    borderWidth: StyleSheet.hairlineWidth,
    maxWidth: 220,
    minHeight: 28,
  },
  chipText: { flexShrink: 1, fontSize: 12, fontWeight: '600' },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2.5],
    borderRadius: borderRadius.xl,
    paddingVertical: spacing[2.5],
  },
  bannerIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  bannerCaption: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' },
  bannerLabel: { fontSize: 15, fontWeight: '700', marginTop: 1 },
  bannerKind: { fontSize: 11, fontWeight: '600', marginTop: 1 },
});
