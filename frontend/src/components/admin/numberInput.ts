/*
 * Десятичный ввод для денег и процентов: пользователь печатает «12,5», в поле остаётся запятая,
 * а число для запроса получаем через parseDecimalInput.
 */

/** Оставляет цифры, одну запятую и не более `fraction` знаков после неё; «−» — только если разрешён. */
export function sanitizeDecimalInput(
  raw: string,
  options: { allowNegative?: boolean; fraction?: number } = {},
): string {
  const { allowNegative = false, fraction = 2 } = options;
  const negative = allowNegative && raw.trimStart().startsWith('-');
  const chars = raw.replace(/[^\d.,]/g, '');
  const sep = chars.search(/[.,]/);
  const intPart = (sep === -1 ? chars : chars.slice(0, sep)).replace(/[.,]/g, '');
  const fracPart =
    sep === -1
      ? ''
      : chars
          .slice(sep + 1)
          .replace(/[.,]/g, '')
          .slice(0, fraction);
  return `${negative ? '-' : ''}${intPart}${sep === -1 ? '' : ','}${fracPart}`;
}

/** «12,5» → 12.5; пустая строка, «-» и «,» дают NaN. */
export function parseDecimalInput(text: string): number {
  if (text === '' || text === '-') return Number.NaN;
  return Number(text.replace(',', '.'));
}

/** 37.5 → «37,5», 40 → «40»: процент без лишних нулей, с десятичной запятой. */
export function formatPercent(value: number): string {
  return String(Math.round(value * 100) / 100).replace('.', ',');
}
