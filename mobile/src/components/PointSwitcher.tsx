/**
 * PointSwitcher — индикатор текущего филиала + переключатель (мульти-точки
 * 156/160/161).
 *
 * ЗАЧЕМ ОН НА ДЕНЕЖНЫХ ЭКРАНАХ. Формулировка владельца: «в разных филиалах
 * могут работать одни и те же мастера… чтобы чек не туда случайно не пробил».
 * Значит на Кассе, в Журнале и на кассовой смене человек обязан ВИДЕТЬ филиал
 * до того, как нажмёт «Пробить», и уметь переключиться прямо оттуда.
 *
 * ВАРИАНТЫ:
 *   • `chip`   — компактная пилюля для шапок списков (дашборд, журнал, смена);
 *   • `banner` — широкая строка для Кассы: там цена ошибки максимальна, и
 *                филиал должен читаться боковым зрением;
 *   • `silent` — НИЧЕГО не рисует, только шторка выбора по императивному
 *                `ref.open()`. Нужен экранам, где предложить выбрать филиал
 *                должен ОТКАЗ СЕРВЕРА (400 «Выберите филиал»), а места под
 *                постоянный индикатор нет: расходы, зарплата. Без него
 *                владелец видел текст «Выберите филиал» и не имел на экране
 *                ни одного способа это сделать.
 *
 * Выбор — ВСЕГДА BottomSheet, а не Alert.alert: RN Alert на Android держит
 * максимум три кнопки, поэтому владелец с четырьмя филиалами физически не мог
 * выбрать часть из них. Шторка работает одинаково на обеих платформах и не
 * ограничена по числу строк.
 *
 * Индикатор не рисуется, когда выбирать нечего (см. `multiPoint` в
 * hooks/usePoints): одноточечному сотруднику филиал подставляется молча.
 * Вариант `silent` этой проверке НЕ подчиняется — его шторку открывает отказ
 * сервера, и она обязана открыться.
 */
import React from 'react';
import { View, StyleSheet, Pressable, ActivityIndicator, Alert, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../platform/Typography';
import { haptic } from '../platform/haptics';
import { useColors } from '../contexts/ThemeContext';
import { useIosSurface } from '../platform/iosSurface';
import { spacing, borderRadius, colors } from '../theme';
import { BottomSheet } from './BottomSheet';
import { usePointAccess, useSwitchPoint } from '../hooks/usePoints';

/** Подпись режима «без выбранного филиала» — только у владельца/админа. */
export const ALL_POINTS_LABEL = 'Все точки';

export interface PointSwitcherProps {
  variant?: 'chip' | 'banner' | 'silent';
  /** Вызывается ПОСЛЕ успешного переключения (экран может уйти на главную). */
  onSwitched?: (pointId: string | null) => void;
  style?: StyleProp<ViewStyle>;
}

/**
 * Императивный доступ к шторке выбора. Нужен ровно там, где предложить выбрать
 * филиал должен НЕ пользовательский тап, а отказ сервера: кассовая смена не
 * открывается в режиме «Все точки», и правильный ответ на эту ошибку —
 * открыть выбор, а не показать текст и оставить человека гадать.
 */
export interface PointSwitcherHandle {
  open: () => void;
}

const PointSwitcher = React.forwardRef<PointSwitcherHandle, PointSwitcherProps>(function PointSwitcher(
  { variant = 'chip', onSwitched, style },
  ref,
) {
  const { selectable, currentPointId, currentPoint, canSeeAllPoints, multiPoint } = usePointAccess();
  const { switchPoint, isSwitching } = useSwitchPoint();
  const [pickerOpen, setPickerOpen] = React.useState(false);

  React.useImperativeHandle(ref, () => ({ open: () => setPickerOpen(true) }), []);

  const handleSelect = React.useCallback(
    async (pointId: string | null) => {
      if (pointId === currentPointId) {
        setPickerOpen(false);
        return;
      }
      try {
        await switchPoint(pointId);
        haptic('success');
        setPickerOpen(false);
        onSwitched?.(pointId);
      } catch {
        haptic('error');
        Alert.alert('Ошибка', 'Не удалось переключить филиал. Проверьте связь и попробуйте ещё раз.');
      }
    },
    [currentPointId, onSwitched, switchPoint],
  );

  // `silent` живёт ради императивного open() — прятать его нельзя даже когда
  // индикатор был бы не нужен, иначе кнопка «Выбрать филиал» в диалоге ошибки
  // молча ничего не делала бы.
  if (!multiPoint && variant !== 'silent') return null;

  // Режим «Все точки» на денежных экранах — не нейтральное состояние: новый
  // заказ-наряд уйдёт БЕЗ филиала. Подсвечиваем янтарным, чтобы это читалось
  // как «филиал не выбран», а не как обычная подпись.
  const noPointChosen = currentPointId === null;
  const label = currentPoint?.name ?? (canSeeAllPoints ? ALL_POINTS_LABEL : 'Филиал не выбран');

  const openPicker = () => {
    haptic('tap');
    setPickerOpen(true);
  };

  return (
    <>
      {variant === 'silent' ? null : variant === 'banner' ? (
        <BannerButton label={label} warn={noPointChosen} busy={isSwitching} onPress={openPicker} style={style} />
      ) : (
        <ChipButton label={label} warn={noPointChosen} busy={isSwitching} onPress={openPicker} style={style} />
      )}

      <BottomSheet visible={pickerOpen} onClose={() => setPickerOpen(false)} title="Филиал" heightRatio={0.6}>
        {/* Своего ScrollView тут нет намеренно: BottomSheet уже оборачивает
            children в KeyboardAwareScrollView, и вложенный скролл того же
            направления перехватывал бы жесты. */}
        <View>
          {selectable.map((p) => (
            <PickerRow
              key={p.id}
              title={p.name}
              subtitle={p.address ?? undefined}
              selected={p.id === currentPointId}
              disabled={isSwitching}
              onPress={() => void handleSelect(p.id)}
            />
          ))}
          {canSeeAllPoints && (
            <PickerRow
              title={ALL_POINTS_LABEL}
              /* Подпись обязана быть честной: сервер денежную запись без
                 филиала больше не принимает — он либо подставит единственную
                 доступную точку, либо ответит «Выберите филиал, …». Обещать
                 «заказ-наряды будут без филиала» = обещать поведение, которого
                 нет, и подставлять кассира под отказ прямо на клиенте. */
              subtitle="Сводка по всей сети — для просмотра. Для кассы, расходов и зарплаты нужно выбрать филиал."
              selected={currentPointId === null}
              disabled={isSwitching}
              onPress={() => void handleSelect(null)}
            />
          )}
        </View>
      </BottomSheet>
    </>
  );
});

export default PointSwitcher;

function ChipButton({
  label,
  warn,
  busy,
  onPress,
  style,
}: {
  label: string;
  warn: boolean;
  busy: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = useColors();
  const tone = warn ? colors.amber[600] : palette.text.secondary;
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={[
        styles.chip,
        { backgroundColor: palette.bg.muted, borderColor: warn ? colors.amber[200] : palette.border.subtle },
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Филиал: ${label}. Нажмите, чтобы переключить`}
    >
      <Ionicons name={warn ? 'alert-circle-outline' : 'location-outline'} size={13} color={tone} />
      <Text style={[styles.chipText, { color: tone }]} numberOfLines={1}>
        {label}
      </Text>
      {busy ? (
        <ActivityIndicator size="small" color={tone} />
      ) : (
        <Ionicons name="chevron-down" size={12} color={palette.text.tertiary} />
      )}
    </Pressable>
  );
}

function BannerButton({
  label,
  warn,
  busy,
  onPress,
  style,
}: {
  label: string;
  warn: boolean;
  busy: boolean;
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const palette = useColors();
  const surface = useIosSurface();
  const isDark = palette.mode === 'dark';
  const accent = warn ? colors.amber[600] : palette.accent.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
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
      accessibilityLabel={`Заказ-наряд создаётся в филиале: ${label}. Нажмите, чтобы переключить`}
    >
      <View style={[styles.bannerIcon, { backgroundColor: warn ? colors.amber[100] : palette.accent.primarySoft }]}>
        <Ionicons name={warn ? 'alert-circle-outline' : 'location'} size={16} color={accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.bannerCaption, { color: palette.text.tertiary }]}>Филиал заказ-наряда</Text>
        <Text
          style={[styles.bannerLabel, { color: warn ? colors.amber[700] : palette.text.primary }]}
          numberOfLines={1}
        >
          {label}
        </Text>
      </View>
      {busy ? (
        <ActivityIndicator size="small" color={accent} />
      ) : (
        <>
          <Text style={[styles.bannerAction, { color: palette.accent.primary }]}>Сменить</Text>
          <Ionicons name="chevron-forward" size={15} color={palette.text.tertiary} />
        </>
      )}
    </Pressable>
  );
}

function PickerRow({
  title,
  subtitle,
  selected,
  disabled,
  onPress,
}: {
  title: string;
  subtitle?: string;
  selected: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const palette = useColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.pickerRow,
        { borderBottomColor: palette.border.subtle },
        pressed && { backgroundColor: palette.bg.muted },
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      accessibilityLabel={title}
    >
      <Ionicons
        name={selected ? 'radio-button-on' : 'radio-button-off'}
        size={20}
        color={selected ? palette.accent.primary : palette.text.tertiary}
      />
      <View style={{ flex: 1 }}>
        <Text style={[styles.pickerTitle, { color: palette.text.primary }]} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={[styles.pickerSubtitle, { color: palette.text.tertiary }]} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
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
    maxWidth: 190,
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
  bannerAction: { fontSize: 13, fontWeight: '600' },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[1],
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 52,
  },
  pickerTitle: { fontSize: 15, fontWeight: '600' },
  pickerSubtitle: { fontSize: 12, marginTop: 2, lineHeight: 16 },
});
