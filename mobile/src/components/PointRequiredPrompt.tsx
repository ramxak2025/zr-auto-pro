/**
 * usePointRequiredPrompt — ОДНА реакция всего приложения на отказ сервера
 * «Выберите филиал, …» (400, backend/src/common/point-scope.ts).
 *
 * ЗАЧЕМ. Сервер запрещает денежную запись, пока не понятно, в КАКОМ из
 * автосервисов владельца она происходит: чек, расход, выплата или кассовая
 * смена, пробитые в режиме «Все автосервисы», не попали бы ни в основной
 * сервис, ни в филиал — ни в журнал, ни в выручку, ни в «к выплате». Отказ
 * приходит с человеческим текстом, но до этой правки экраны показывали его как
 * обычную «Ошибку»: владелец читал «выберите филиал» и не имел на экране ни
 * одного способа это сделать. Тупик стоил денег — операция просто не проходила.
 *
 * ЧТО ДЕЛАЕТ ХУК. Распознаёт ровно этот отказ (shared/utils/apiError.ts —
 * общий разбор для веба и мобилки), показывает текст СЕРВЕРА как есть (он
 * объясняет цель: «чтобы пробить чек», «чтобы открыть кассовую смену») и даёт
 * кнопку, которая ведёт в раздел «Филиалы».
 *
 * ПОЧЕМУ ИМЕННО ПЕРЕХОД, А НЕ ШТОРКА ВЫБОРА. Переключение автосервиса живёт в
 * ОДНОМ месте — разделе «Филиалы» (требование владельца: «переключиться туда
 * можно ТОЛЬКО через филиал, а не везде»). Раньше эта кнопка открывала шторку
 * прямо поверх экрана, то есть была вторым входом в переключение. Теперь она
 * приводит человека туда, где видно оба автосервиса, чей из них основной и
 * сколько в каждом денег, — и выбор делается там осознанно.
 *
 * ИСПОЛЬЗОВАНИЕ:
 *   const pointPrompt = usePointRequiredPrompt();
 *   ...
 *   onError: (err) => { if (pointPrompt.handleApiError(err)) return; ...своё... }
 */
import React from 'react';
import { Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';

import { haptic } from '../platform/haptics';
import { openPoints } from '../navigation/entityLinks';
import { choosePointMessage } from '../../../shared/utils/apiError';

export interface PointRequiredPrompt {
  /**
   * Если `err` — это отказ «Выберите филиал», показывает диалог с переходом в
   * раздел «Филиалы» и возвращает true (вызывающий обязан выйти из своего
   * onError). Любая другая ошибка → false, экран показывает своё сообщение
   * как раньше.
   */
  handleApiError: (err: unknown) => boolean;
  /**
   * Показать тот же диалог ДО отправки — когда клиент уже знает, что сервер
   * откажет (см. `needsPointForWrite` в hooks/usePoints).
   */
  show: (message: string) => void;
}

export function usePointRequiredPrompt(): PointRequiredPrompt {
  const navigation = useNavigation<any>();

  const show = React.useCallback(
    (message: string) => {
      haptic('warning');
      // Заголовок дословно повторяет формулировку сервера («Выберите филиал,
      // чтобы …»): придумывать свой означало бы разойтись с текстом, который
      // тут же напечатан ниже.
      Alert.alert('Выберите филиал', message, [
        { text: 'Отмена', style: 'cancel' },
        // Не «ОК»: единственный полезный ответ на эту ошибку — попасть туда,
        // где автосервис выбирают.
        { text: 'Открыть «Филиалы»', onPress: () => openPoints(navigation) },
      ]);
    },
    [navigation],
  );

  const handleApiError = React.useCallback(
    (err: unknown) => {
      const message = choosePointMessage(err);
      if (!message) return false;
      show(message);
      return true;
    },
    [show],
  );

  // Стабильная ссылка на весь результат: экраны кладут его в зависимости
  // useCallback / useMutation, и новый объект на каждый рендер пересоздавал бы
  // их без нужды.
  return React.useMemo(() => ({ handleApiError, show }), [handleApiError, show]);
}
