/**
 * Семантические тона визуальной системы админки (docs/web-redesign/DESIGN_SYSTEM.md).
 *
 * Правило: семантический цвет — только по смыслу. `ok` — деньги пришли / успех,
 * `warn` — требует внимания (не перезвонили, просрочка скоро), `bad` — ошибка /
 * просрочено / удаление, `info` — нейтральная подсказка, `accent` — бренд и
 * активное состояние, `neutral` — всё остальное. Один акцент на экран.
 */
export type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'bad' | 'info';

/** Мягкая плашка: фон-тинт + тёмный текст того же семейства (контраст ≥ 4.5:1). */
export const toneSoft: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-ink-2',
  accent: 'bg-accent-soft text-accent-text',
  ok: 'bg-ok-soft text-ok-text',
  warn: 'bg-warn-soft text-warn-text',
  bad: 'bg-bad-soft text-bad-text',
  info: 'bg-info-soft text-info-text',
};

/** Иконка-чип 36–40 px: тинт + насыщенная иконка. */
export const toneChip: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-ink-3',
  accent: 'bg-accent-soft text-accent',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
  info: 'bg-info-soft text-info',
};

/** Точка-индикатор статуса (StatusPill, легенды). */
export const toneDot: Record<Tone, string> = {
  neutral: 'bg-ink-4',
  accent: 'bg-accent',
  ok: 'bg-ok',
  warn: 'bg-warn',
  bad: 'bg-bad',
  info: 'bg-info',
};

/** Цвет текста-значения (дельты, суммы со знаком). */
export const toneText: Record<Tone, string> = {
  neutral: 'text-ink-2',
  accent: 'text-accent',
  ok: 'text-ok-text',
  warn: 'text-warn-text',
  bad: 'text-bad-text',
  info: 'text-info-text',
};

/**
 * Единое фокус-кольцо для всех интерактивных элементов на светлых поверхностях.
 * Только :focus-visible — мышь кольцо не показывает, клавиатура видит всегда.
 */
export const focusRing =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface';

/** Фокус-кольцо для элементов на тёмной боковой панели. */
export const focusRingOnRail =
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-rail';
