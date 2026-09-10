/**
 * PointIndicator — НЕинтерактивный индикатор текущего автосервиса
 * (мульти-точки 156/160/161).
 *
 * ЧТО ЭТО И ПОЧЕМУ НЕ ПЕРЕКЛЮЧАТЕЛЬ. У владельца два РАЗНЫХ автосервиса:
 * основной («ZR AUTO» — сам сервис, вся история до появления филиалов) и
 * открытый позже филиал («ТопГаз»). Его требование дословно: «переключиться
 * туда можно ТОЛЬКО через филиал, а не везде». Прошлая волна расставила
 * выпадающий выбор по всем денежным экранам — с него одним неудачным тапом по
 * шапке касса уезжала в соседний автосервис, и заметить это можно было уже
 * только по чужой выручке.
 *
 * Поэтому здесь остался ровно один смысл: ПОКАЗАТЬ, где человек сейчас
 * находится, до того как он нажмёт «Пробить». Тап ведёт в раздел «Филиалы»
 * (единственное место переключения, см. navigation/entityLinks → openPoints) и
 * сам по себе ничего не меняет — ни списка выбора, ни запроса на сервер.
 *
 * ТАП НИЧЕГО НЕ ТЕРЯЕТ. «Филиалы» открываются ПОВЕРХ текущего экрана (push), а
 * не переходом на вкладку «Ещё». Это принципиально для Кассы: экран создания
 * заказ-наряда живёт на корневом стеке, уход с него размонтировал бы экран, а
 * состав заказ-наряда хранится только в его памяти — кассир, тронувший строку
 * «просто посмотреть», терял три работы и две запчасти. Теперь «назад»
 * возвращает Кассу нетронутой. Подробности — navigation/entityLinks.openPoints.
 *
 * ВАРИАНТЫ:
 *   • `chip`   — компактная пилюля для шапок списков (главная, Журнал, смена,
 *                расписание);
 *   • `banner` — широкая строка для Кассы: там цена ошибки максимальна, и
 *                автосервис должен читаться боковым зрением.
 *
 * Индикатор не рисуется, когда показывать нечего (см. `multiPoint` в
 * hooks/usePoints): у одноточечного тенанта второго автосервиса не существует,
 * и подпись «ZR AUTO» была бы шумом.
 */
import React from 'react';
import { View, StyleSheet, Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { Text } from '../platform/Typography';
import { haptic } from '../platform/haptics';
import { useColors } from '../contexts/ThemeContext';
import { useIosSurface } from '../platform/iosSurface';
import { spacing, borderRadius, colors } from '../theme';
import { openPoints } from '../navigation/entityLinks';
import { usePointAccess, ALL_POINTS_LABEL, NO_POINT_LABEL, pointKindLabel } from '../hooks/usePoints';

export interface PointIndicatorProps {
  variant?: 'chip' | 'banner';
  style?: StyleProp<ViewStyle>;
}

export default function PointIndicator({ variant = 'chip', style }: PointIndicatorProps) {
  const navigation = useNavigation<any>();
  const { currentPointId, currentPoint, canSeeAllPoints, multiPoint } = usePointAccess();

  const openSection = React.useCallback(() => {
    haptic('tap');
    openPoints(navigation);
  }, [navigation]);

  if (!multiPoint) return null;

  // Автосервис не выбран — не нейтральное состояние: новый заказ-наряд просто
  // не примут (сервер отвечает 400 «Выберите филиал»). Подсвечиваем янтарным,
  // чтобы это читалось как «нужно зайти в свой автосервис», а не как подпись.
  const noPointChosen = currentPointId === null;
  const label = currentPoint?.name ?? (canSeeAllPoints ? ALL_POINTS_LABEL : NO_POINT_LABEL);
  // Подзаголовок «Основной сервис» / «Филиал» — чтобы владелец видел не просто
  // название, а КАКОЙ из своих автосервисов сейчас открыт.
  const kind = currentPoint ? pointKindLabel(currentPoint) : null;

  const props = {
    label,
    kind,
    isMain: currentPoint?.isMain ?? false,
    warn: noPointChosen,
    onPress: openSection,
    style,
  };
  return variant === 'banner' ? <BannerRow {...props} /> : <ChipRow {...props} />;
}

interface RowProps {
  label: string;
  /** «Основной сервис» / «Филиал»; null — автосервис не выбран. */
  kind: string | null;
  isMain: boolean;
  warn: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * Иконка автосервиса: дом = основной сервис (сам автосервис владельца),
 * здание = филиал. Разные глифы, потому что это разные сущности, а не два
 * одинаковых пункта списка.
 */
function pointIcon(isMain: boolean, warn: boolean): keyof typeof Ionicons.glyphMap {
  if (warn) return 'alert-circle-outline';
  return isMain ? 'home' : 'business';
}

function ChipRow({ label, kind, isMain, warn, onPress, style }: RowProps) {
  const palette = useColors();
  const tone = warn ? colors.amber[600] : palette.text.secondary;
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        { backgroundColor: palette.bg.muted, borderColor: warn ? colors.amber[200] : palette.border.subtle },
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Автосервис: ${label}${kind ? `, ${kind.toLowerCase()}` : ''}. Открыть раздел «Филиалы»`}
    >
      <Ionicons name={pointIcon(isMain, warn)} size={13} color={tone} />
      <Text style={[styles.chipText, { color: tone }]} numberOfLines={1}>
        {label}
      </Text>
      {/* chevron-forward, а НЕ chevron-down: стрелка вниз читается как
          «раскрыть список», а списка выбора здесь больше нет — только переход
          в раздел. */}
      <Ionicons name="chevron-forward" size={12} color={palette.text.tertiary} />
    </Pressable>
  );
}

function BannerRow({ label, kind, isMain, warn, onPress, style }: RowProps) {
  const palette = useColors();
  const surface = useIosSurface();
  const isDark = palette.mode === 'dark';
  const accent = warn ? colors.amber[600] : palette.accent.primary;
  return (
    <Pressable
      onPress={onPress}
      style={[
        // cardCompact ПЕРВЫМ: дальше идут собственные радиус/отступы строки —
        // в RN выигрывает последний стиль, и порядок здесь смысловой.
        surface.cardCompact,
        styles.banner,
        {
          borderColor: warn ? colors.amber[200] : palette.border.subtle,
          backgroundColor: warn ? (isDark ? 'rgba(217, 119, 6, 0.16)' : colors.amber[50]) : palette.bg.card,
        },
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Заказ-наряд создаётся в автосервисе: ${label}. Открыть раздел «Филиалы»`}
    >
      <View style={[styles.bannerIcon, { backgroundColor: warn ? colors.amber[100] : palette.accent.primarySoft }]}>
        <Ionicons name={pointIcon(isMain, warn)} size={16} color={accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.bannerCaption, { color: palette.text.tertiary }]}>Автосервис заказ-наряда</Text>
        <Text
          style={[styles.bannerLabel, { color: warn ? colors.amber[700] : palette.text.primary }]}
          numberOfLines={1}
        >
          {label}
        </Text>
        {kind ? <Text style={[styles.bannerKind, { color: palette.text.tertiary }]}>{kind}</Text> : null}
      </View>
      <Text style={[styles.bannerAction, { color: palette.accent.primary }]}>Филиалы</Text>
      <Ionicons name="chevron-forward" size={15} color={palette.text.tertiary} />
    </Pressable>
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
  bannerAction: { fontSize: 13, fontWeight: '600' },
});
