/**
 * LoginPointSelect — ВТОРОЙ ШАГ ВХОДА: «в какой филиал зайти» (163).
 *
 * ТРЕБОВАНИЕ ВЛАДЕЛЬЦА ДОСЛОВНО: «чтобы они заходили, например, введя номер и
 * пароль свой, и им показывал выбор, в какой филиал из доступных для них они
 * могли зайти. И чтобы выйти и войти в другой им надо опять выйти и войти».
 *
 * ПОЧЕМУ ЭТО ПОЛНОЦЕННЫЙ ШАГ, А НЕ ШТОРКА ПОВЕРХ ФОРМЫ. Филиал — это не
 * настройка, а ответ на вопрос «где я сегодня работаю»: от него зависит, в чью
 * выручку уйдёт заказ-наряд и из чьей кассы выдадут зарплату. Шторку смахивают
 * не глядя; отдельный экран с крупными карточками заставляет прочитать
 * название и адрес. Сессия к этому моменту ещё НЕ создана — токена нет, есть
 * только промежуточный (минуты жизни, одноразовый).
 *
 * СВЕТЛАЯ ПАЛИТРА ЖЁСТКО, как и на LoginScreen. Вход — брендовый экран, он
 * намеренно не переключается в тёмную тему (см. комментарий в LoginScreen), и
 * второй шаг ТОГО ЖЕ входа обязан выглядеть его продолжением: тёмная карточка
 * поверх светлой формы читалась бы как другое приложение. Поэтому здесь
 * `getPalette('light')` + `buildIosSurface(...)` вместо хуков темы, а не
 * собственный набор цветов.
 */
import React from 'react';
import { View, StyleSheet, ScrollView, Pressable, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../platform/Typography';
import { haptic } from '../platform/haptics';
import { buildIosSurface } from '../platform/iosSurface';
import { getPalette } from '../theme/palette';
import { spacing, borderRadius, fontSize, fontWeight } from '../theme';
import type { LoginPointOption } from '../../../shared/api/types';

export interface LoginPointSelectProps {
  /** Доступные сотруднику живые филиалы; порядок сервера (основной сервис первым). */
  points: LoginPointOption[];
  /** Где человек работал в прошлый раз — подсвечиваем, но НЕ выбираем за него. */
  defaultPointId: string;
  /** Идёт обмен по этому филиалу; null — ничего не отправляем. */
  submittingPointId: string | null;
  onSelect: (pointId: string) => void;
  /** «Назад» — вернуться к телефону и паролю (промежуточный токен просто бросаем). */
  onBack: () => void;
}

const palette = getPalette('light');
const surface = buildIosSurface(palette);

export default function LoginPointSelect({
  points,
  defaultPointId,
  submittingPointId,
  onSelect,
  onBack,
}: LoginPointSelectProps) {
  const busy = submittingPointId !== null;

  const handlePress = (pointId: string) => {
    // Второй тап по второй карточке, пока летит первый обмен, сжёг бы
    // одноразовый токен: сервер ответил бы «Выбор филиала уже использован», и
    // человек начинал бы вход заново на ровном месте.
    if (busy) return;
    haptic('tap');
    onSelect(pointId);
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.bg.canvas }]} edges={['top']}>
      {/* Шапка повторяет геометрию IosScreenHeader (36pt-сквиркл слева, 17pt
          semibold заголовок): тот же ритм, что во всём приложении, но на
          зафиксированной светлой палитре входа. */}
      <View style={styles.header}>
        <Pressable
          onPress={busy ? undefined : onBack}
          hitSlop={10}
          disabled={busy}
          style={[styles.backBtn, { backgroundColor: palette.bg.muted, opacity: busy ? 0.4 : 1 }]}
          accessibilityRole="button"
          accessibilityLabel="Назад, к вводу телефона и пароля"
        >
          <Ionicons name="chevron-back" size={20} color={palette.text.primary} />
        </Pressable>
        <View style={styles.headerTitles}>
          <Text style={[styles.title, { color: palette.text.primary }]}>Выберите филиал</Text>
          <Text style={[styles.subtitle, { color: palette.text.tertiary }]}>Куда вы заходите работать</Text>
        </View>
        <View style={styles.backBtnPlaceholder} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Честное объяснение ПРАВИЛА, а не украшение: человек должен узнать
            про «выйти и войти» здесь, а не когда будет искать переключатель. */}
        <Text style={[styles.intro, { color: palette.text.secondary }]}>
          Вы войдёте в один филиал — вся касса, склад и зарплата смены будут его. Чтобы работать в другом, нужно выйти и
          войти заново.
        </Text>

        <View style={styles.list}>
          {points.map((point) => (
            <PointRow
              key={point.id}
              point={point}
              isLast={point.id === defaultPointId}
              busy={submittingPointId === point.id}
              disabled={busy && submittingPointId !== point.id}
              onPress={() => handlePress(point.id)}
            />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * Карточка филиала. Крупная и с адресом: у владельца два автосервиса могут
 * называться похоже, и адрес — единственное, что различает их наверняка.
 */
function PointRow({
  point,
  isLast,
  busy,
  disabled,
  onPress,
}: {
  point: LoginPointOption;
  /** Здесь человек работал в прошлый раз — подсказка, а не выбор за него. */
  isLast: boolean;
  busy: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const kind = point.isMain ? 'Основной сервис' : 'Филиал';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        surface.card,
        styles.card,
        pressed && !busy ? styles.cardPressed : null,
        disabled ? styles.cardDisabled : null,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Войти: ${point.name}, ${kind.toLowerCase()}${point.address ? `, ${point.address}` : ''}${
        isLast ? '. Здесь вы работали в прошлый раз' : ''
      }`}
    >
      {/* Дом = сам автосервис владельца, здание = открытый позже филиал. Те же
          глифы, что в разделе «Филиалы», — одна сущность, один значок. */}
      <View style={[styles.icon, { backgroundColor: palette.accent.primarySoft }]}>
        <Ionicons name={point.isMain ? 'home' : 'business'} size={20} color={palette.accent.primary} />
      </View>

      <View style={styles.cardBody}>
        <View style={styles.nameRow}>
          <Text style={[styles.pointName, { color: palette.text.primary }]} numberOfLines={1}>
            {point.name}
          </Text>
          {isLast && (
            <View style={[styles.lastBadge, { backgroundColor: palette.accent.primarySoft }]}>
              <Text style={[styles.lastBadgeText, { color: palette.accent.primary }]}>Были здесь</Text>
            </View>
          )}
        </View>
        <Text style={[styles.pointKind, { color: palette.text.tertiary }]} numberOfLines={2}>
          {point.address ? `${kind} · ${point.address}` : kind}
        </Text>
      </View>

      {busy ? (
        <ActivityIndicator size="small" color={palette.accent.primary} />
      ) : (
        <Ionicons name="chevron-forward" size={18} color={palette.text.tertiary} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
    paddingBottom: spacing[3],
  },
  backBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  backBtnPlaceholder: { width: 36, height: 36 },
  headerTitles: { flex: 1, alignItems: 'center' },
  title: { fontSize: 17, fontWeight: fontWeight.semibold, letterSpacing: -0.4 },
  subtitle: { fontSize: fontSize.xs, marginTop: 1 },
  scroll: { paddingHorizontal: spacing[4], paddingBottom: spacing[10], gap: spacing[4] },
  intro: { fontSize: 13, lineHeight: 18 },
  list: { gap: spacing[3] },
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingVertical: spacing[4], minHeight: 76 },
  cardPressed: { opacity: 0.7 },
  cardDisabled: { opacity: 0.45 },
  icon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1, minWidth: 0, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  pointName: { flexShrink: 1, fontSize: 17, fontWeight: '700' },
  lastBadge: { paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: borderRadius.full },
  lastBadgeText: { fontSize: 10, fontWeight: '700' },
  pointKind: { fontSize: 13, lineHeight: 17 },
});
