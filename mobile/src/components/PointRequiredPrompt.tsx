/**
 * usePointRequiredPrompt — ОДНА реакция всего приложения на отказ сервера
 * «Выберите филиал, …» (400, backend/src/common/point-scope.ts).
 *
 * ЗАЧЕМ. Сервер запрещает денежную запись без филиала: чек, расход, выплата
 * или кассовая смена, пробитые в режиме «Все точки», не попали бы НИ В ОДИН
 * филиал — ни в журнал, ни в выручку, ни в «к выплате». Отказ приходит с
 * человеческим текстом, но до этой правки экраны показывали его как обычную
 * «Ошибку»: владелец читал «выберите филиал» и не имел на экране ни одного
 * способа это сделать. Тупик стоил денег — операция просто не проходила.
 *
 * ЧТО ДЕЛАЕТ ХУК. Распознаёт ровно этот отказ (shared/utils/apiError.ts —
 * общий разбор для веба и мобилки), показывает текст СЕРВЕРА как есть (он
 * объясняет цель: «чтобы пробить чек», «чтобы открыть кассовую смену») и даёт
 * кнопку, открывающую ту же шторку выбора филиала, что и обычный переключатель.
 *
 * ПОЧЕМУ ХУК + ЭЛЕМЕНТ, А НЕ ГЛОБАЛЬНЫЙ ПРОВАЙДЕР. Шторка выбора живёт внутри
 * PointSwitcher (вариант `silent` — рисует только шторку), и ей нужен свой
 * узел в дереве экрана. Провайдер поверх всего приложения открывал бы шторку
 * из-под модалок экрана и конфликтовал с ними по слоям.
 *
 * ИСПОЛЬЗОВАНИЕ:
 *   const pointPrompt = usePointRequiredPrompt();
 *   ...
 *   onError: (err) => { if (pointPrompt.handleApiError(err)) return; ...своё... }
 *   ...
 *   {pointPrompt.element}
 */
import React from 'react';
import { Alert } from 'react-native';

import PointSwitcher, { type PointSwitcherHandle } from './PointSwitcher';
import { haptic } from '../platform/haptics';
import { choosePointMessage } from '../../../shared/utils/apiError';

export interface PointRequiredPrompt {
  /**
   * Если `err` — это отказ «Выберите филиал», показывает диалог с выбором
   * филиала и возвращает true (вызывающий обязан выйти из своего onError).
   * Любая другая ошибка → false, экран показывает своё сообщение как раньше.
   */
  handleApiError: (err: unknown) => boolean;
  /**
   * Показать тот же диалог ДО отправки — когда клиент уже знает, что сервер
   * откажет (см. `needsPointForWrite` в hooks/usePoints).
   */
  show: (message: string) => void;
  /** Невидимый узел со шторкой выбора. Обязателен в разметке экрана. */
  element: React.ReactElement;
}

export function usePointRequiredPrompt(): PointRequiredPrompt {
  const switcherRef = React.useRef<PointSwitcherHandle>(null);

  const show = React.useCallback((message: string) => {
    haptic('warning');
    Alert.alert('Выберите филиал', message, [
      { text: 'Отмена', style: 'cancel' },
      // Не «ОК»: единственный полезный ответ на эту ошибку — открыть выбор.
      { text: 'Выбрать филиал', onPress: () => switcherRef.current?.open() },
    ]);
  }, []);

  const handleApiError = React.useCallback(
    (err: unknown) => {
      const message = choosePointMessage(err);
      if (!message) return false;
      show(message);
      return true;
    },
    [show],
  );

  // useMemo, а не создание на каждый рендер: элемент вставляется в разметку
  // экрана, и новый объект каждый раз перемонтировал бы шторку.
  const element = React.useMemo(() => <PointSwitcher ref={switcherRef} variant="silent" />, []);

  // Стабильная ссылка на весь результат: экраны кладут его в зависимости
  // useCallback / useMutation, и новый объект на каждый рендер пересоздавал бы
  // их без нужды.
  return React.useMemo(() => ({ handleApiError, show, element }), [handleApiError, show, element]);
}
