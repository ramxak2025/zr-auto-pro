/**
 * Toast — лёгкий глобальный тост (волна C «Связь 2.0», C-2).
 *
 * ЗАЧЕМ: жалоба владельца — «запись не сохранилась из-за интернета, а на
 * экране тишина, люди думают что сделали». Блокирующий Alert для каждой
 * перестановки/тумблера — перебор (владелец явно отказался от Alert per tap в
 * расписании), а локальный quickError-баннер ScheduleScreen не глобален.
 * Этот компонент — та же идея, но одна точка на всё приложение: авто-исчезающая
 * пилюля сверху, не блокирует контент, зовётся императивно из любого места
 * (включая mutationCache в App.tsx, где хуков нет).
 *
 * Паттерн — по образцу OfflineBanner (reanimated fade, box-none, сигнальные
 * цвета одинаковы в light/dark) + quickError ScheduleScreen (авто-hide 2.6 с,
 * тап — скрыть раньше). Android-safe: insets + elevation, ничего iOS-only.
 *
 * API:
 *   showToast('Не сохранено: нет связи с сервером')            // kind 'error'
 *   showToast('Чек №41 отправлен', 'success')
 *   showMutationErrorToast(err)  // текст из серверной ошибки, если есть
 *
 * Хост <ToastHost /> монтируется ОДИН раз в App.tsx рядом с OfflineBanner.
 * Новый тост замещает текущий (key=id перезапускает entering-анимацию) и
 * перезаводит таймер. Тост до маунта хоста (сплеш) молча отбрасывается —
 * мутации до первого экрана невозможны.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../platform/Typography';
import { colors } from '../theme';

export type ToastKind = 'error' | 'success';

interface ToastEvent {
  id: number;
  message: string;
  kind: ToastKind;
}

/** Авто-скрытие — как у quickError в ScheduleScreen. */
const TOAST_HIDE_MS = 2_600;
/**
 * Отступ ниже safe area: чтобы тост не наезжал на полосу OfflineBanner
 * (paddingTop = insets.top + ~26pt контента), когда оба видны одновременно —
 * а «офлайн + не сохранено» как раз их типичная совместная сцена.
 */
const TOP_OFFSET = 40;

let activeListener: ((event: ToastEvent) => void) | null = null;
let toastSeq = 0;

/** Показать глобальный тост. Безопасно звать откуда угодно (не хук). */
export function showToast(message: string, kind: ToastKind = 'error'): void {
  activeListener?.({ id: ++toastSeq, message, kind });
}

/**
 * Русский текст для тоста «мутация упала»: текст серверной ошибки, если он
 * есть (валидация, права), иначе честное «нет связи» / «ошибка сервера» —
 * английские axios-сообщения («Network Error», «timeout of…») пользователю
 * не показываем.
 */
export function mutationErrorToastMessage(err: unknown): string {
  const e = err as {
    response?: { data?: { message?: string | string[] } };
  } | null;
  const raw = e?.response?.data?.message;
  const serverMsg = Array.isArray(raw) ? raw.join('\n') : raw;
  if (serverMsg) return `Не сохранено: ${serverMsg}`;
  return e?.response ? 'Не сохранено: ошибка сервера' : 'Не сохранено: нет связи с сервером';
}

/** showToast(mutationErrorToastMessage(err)) — общий шорткат для onError. */
export function showMutationErrorToast(err: unknown): void {
  showToast(mutationErrorToastMessage(err), 'error');
}

export default function ToastHost() {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<ToastEvent | null>(null);

  useEffect(() => {
    activeListener = setToast;
    return () => {
      if (activeListener === setToast) activeListener = null;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), TOAST_HIDE_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  if (!toast) return null;

  const isError = toast.kind === 'error';

  return (
    <View style={[styles.wrap, { top: insets.top + TOP_OFFSET }]} pointerEvents="box-none">
      {/* key=id — замещающий тост проигрывает entering заново, видно что
          сообщение НОВОЕ, а не зависшее старое. */}
      <Animated.View key={toast.id} entering={FadeInDown.duration(200)} exiting={FadeOutUp.duration(160)}>
        <TouchableOpacity
          style={[styles.pill, { backgroundColor: isError ? colors.red[600] : colors.green[600] }]}
          onPress={() => setToast(null)}
          activeOpacity={0.85}
          accessibilityRole="alert"
          accessibilityLabel={toast.message}
        >
          <Ionicons
            name={isError ? 'alert-circle-outline' : 'checkmark-circle-outline'}
            size={16}
            color={colors.white}
            style={styles.icon}
          />
          <Text style={styles.text} numberOfLines={3}>
            {toast.message}
          </Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 16,
    // Под OfflineBanner (у него 1000): полоса связи важнее тоста.
    zIndex: 990,
    elevation: 990,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    maxWidth: '100%',
    borderRadius: 14,
    paddingVertical: 9,
    paddingHorizontal: 14,
    gap: 7,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  icon: {
    flexShrink: 0,
  },
  text: {
    flexShrink: 1,
    color: colors.white,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.1,
  },
});
