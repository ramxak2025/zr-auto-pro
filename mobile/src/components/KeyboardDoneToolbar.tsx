/**
 * KeyboardDoneToolbar — единая «Готово» над клавиатурой (Round 11 D).
 *
 * ПРОБЛЕМА (владелец). «Где бы я ни писал текст — хочу видеть, что пишу, и
 * легко сворачивать клавиатуру.» Раньше сворачивание было разнородным: на
 * части экранов работал только tap-outside, на iPad/крупных полях без
 * `return`-кнопки (multiline «Комментарий») клавиатуру было нечем закрыть.
 *
 * РЕШЕНИЕ. Один общий тулбар поверх клавиатуры с правой кнопкой «Готово»,
 * который зовёт `Keyboard.dismiss()`. Монтируется РОВНО ОДИН РАЗ внутри
 * каждого `KeyboardProvider`:
 *   • корневой — App.tsx (все обычные экраны/скроллы);
 *   • вложенный — components/Modal.tsx (центрированный диалог);
 *   • вложенный — components/BottomSheet.tsx (шит);
 *   • вложенные в экранах, что рендерят собственный RN `<Modal>` (отдельное
 *     нативное окно — корневой провайдер туда не дотягивается).
 * За счёт этого КАЖДЫЙ сфокусированный TextInput получает одинаковую «Готово»
 * без пер-экранной работы.
 *
 * РЕАЛИЗАЦИЯ. `KeyboardToolbar` из react-native-keyboard-controller уже
 * построен на `KeyboardStickyView` (синхронно с кадрами клавиатуры, iOS+Android
 * одинаково) и сам ничего не рендерит, пока клавиатура скрыта — значит его
 * можно держать всегда смонтированным, без per-screen флагов. `showArrows=false`
 * — владельцу нужна ТОЛЬКО кнопка сворачивания, prev/next между полями лишние и
 * визуально шумные. Тема берётся из активной палитры, чтобы полоска не спорила
 * с dark mode.
 *
 * NB. Компонент НЕ добавляет новую нативную зависимость: keyboard-controller уже
 * слинкован (build 62/77). Native rebuild не требуется.
 */
import React from 'react';
import { Keyboard } from 'react-native';
import { KeyboardToolbar } from 'react-native-keyboard-controller';
import { useColors } from '../contexts/ThemeContext';

export default function KeyboardDoneToolbar() {
  const palette = useColors();

  // Тема тулбара берётся из семантической палитры (свет/тёмная). Оба варианта
  // обязательны по типам библиотеки; активный выбирается ей же по системной
  // теме — а наша палитра уже привязана к тому же режиму, поэтому цвета
  // совпадают в обоих случаях.
  const toolbarColors = {
    primary: palette.accent.primary, // «Готово» активна
    disabled: palette.text.tertiary, // (стрелки скрыты, но тип требует)
    background: palette.bg.elevated, // фон полоски = elevated-поверхность
    ripple: palette.border.strong, // Android ripple
  };

  return (
    <KeyboardToolbar
      // Только кнопка «Готово» — без prev/next между полями (владелец: нужно
      // просто СВЕРНУТЬ, навигация по полям здесь лишний шум).
      showArrows={false}
      doneText="Готово"
      onDoneCallback={() => Keyboard.dismiss()}
      theme={{ light: toolbarColors, dark: toolbarColors }}
    />
  );
}
