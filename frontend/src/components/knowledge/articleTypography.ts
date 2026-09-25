/**
 * Типографика чтения для базы знаний — ОДНА шкала для markdown-статей,
 * блочных статей (ArticleBlocks), уроков курсов и plain-text фолбэка.
 *
 * Правила (docs/web-redesign/DESIGN_SYSTEM.md, §2.2 + брief фазы B):
 *   • колонка чтения — не шире 68–76 символов (`max-w-[70ch]`), 16 px / 1.65;
 *   • заголовки внутри материала — по шкале системы: 22/28 → 18/26 → 16/24;
 *     семантический уровень тега задаёт вызывающий (заголовок самой статьи —
 *     h2 под h1 страницы, значит `#` в markdown становится h3 и т. д.),
 *     визуальный размер — глубиной от «первого» заголовка материала;
 *   • текст не светлее `ink-2`, ссылки — `accent-text` с подчёркиванием.
 */
export const articleType = {
  /** Контейнер текста материала. */
  body: 'max-w-[70ch] text-[16px] leading-[1.65] text-ink [overflow-wrap:anywhere]',
  /** Заголовки по глубине: 0 — первый уровень внутри материала. */
  heading: [
    'mt-10 mb-3 text-[22px] font-semibold leading-7 tracking-[-0.01em] text-ink first:mt-0',
    'mt-8 mb-2 text-lg font-semibold leading-[1.45] text-ink first:mt-0',
    'mt-6 mb-2 text-base font-semibold leading-6 text-ink first:mt-0',
    'mt-5 mb-1.5 text-[15px] font-semibold leading-6 text-ink first:mt-0',
  ] as const,
  paragraph: 'my-4 first:mt-0 last:mb-0',
  list: 'my-4 space-y-1.5 pl-6 marker:text-ink-3',
  listItem: 'pl-1',
  link: 'text-accent-text underline decoration-accent/40 underline-offset-[3px] transition-colors hover:decoration-accent break-words',
  blockquote: 'my-5 border-l-2 border-accent/60 pl-4 text-ink-2',
  hr: 'my-8 border-line',
  codeInline: 'rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[13px] text-ink',
  codeBlock:
    'block overflow-x-auto rounded-lg border border-line bg-surface-2 p-3.5 font-mono text-[13px] leading-relaxed text-ink',
  table: 'my-5 overflow-x-auto rounded-lg border border-line',
  th: 'h-10 border-b border-line bg-surface-2 px-3 text-left text-xs font-semibold text-ink-3',
  td: 'border-b border-line px-3 py-2 text-sm text-ink-2 last:border-b-0',
  figure: 'my-5 first:mt-0',
  figcaption: 'mt-2 text-center text-xs text-ink-3',
  image: 'w-full rounded-lg border border-line bg-surface-2 object-contain',
  /** Пустое содержимое («Содержимое не заполнено»). */
  empty: 'text-sm italic text-ink-3',
} as const;

/** Заголовок самого материала (статьи, курса, урока): 26–28 px, 600. */
export const articleTitleClass =
  'text-2xl font-semibold leading-tight tracking-[-0.015em] text-ink sm:text-[28px] sm:leading-[1.2] [overflow-wrap:anywhere]';

/** Тег заголовка по уровню (h2…h6) для семантически корректного дерева. */
export function headingTag(level: number): 'h2' | 'h3' | 'h4' | 'h5' | 'h6' {
  const clamped = Math.min(6, Math.max(2, level));
  return `h${clamped}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
}

/** Классы заголовка по глубине внутри материала (0 — первый уровень). */
export function headingClass(depth: number): string {
  return articleType.heading[Math.min(articleType.heading.length - 1, Math.max(0, depth))];
}
