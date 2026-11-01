/** Label geometry is independent of browser/native packages. Barcodes are encoded by each client. */
export interface LabelProduct {
  id: string;
  name: string;
  sellPrice: number;
  barcode?: string | null;
  internalBarcode?: string | null;
}
export type LabelCodeSource = 'factory' | 'internal';
export interface LabelSelection {
  copies: number;
  source: LabelCodeSource;
}
export interface LabelPaper {
  widthMm: number;
  heightMm: number;
}
export interface LabelSettings {
  paper: LabelPaper;
  showPrice: boolean;
}
export interface PreparedProductLabels {
  html: string;
  previews: Array<{ productId: string; svg: string; copies: number; code: string }>;
  count: number;
  paper: LabelPaper;
  warnings: string[];
}
export const LABEL_PAPERS = [
  { widthMm: 40, heightMm: 30 },
  { widthMm: 58, heightMm: 40 },
] as const;
export const MAX_LABELS = 200;
export const MAX_LABEL_COPIES = 100;
export const LABEL_DPI = 203;
/** Two physical dots at 203 dpi. Never compress bars to fit paper. */
export const LABEL_MODULE_MM = (2 * 25.4) / LABEL_DPI;
const QUIET_MODULES = 10;
const MARGIN_MM = 2;

export const escapeLabelHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );
export const defaultLabelSource = (product: LabelProduct): LabelCodeSource =>
  product.barcode ? 'factory' : 'internal';
export const labelPagePoints = (paper: LabelPaper) => ({
  width: (paper.widthMm * 72) / 25.4,
  height: (paper.heightMm * 72) / 25.4,
});

function nameWidth(text: string): number {
  return [...text].reduce(
    (width, char) =>
      width + (/\s/.test(char) ? 0.75 : /[MWШЩЖЮФ@]/.test(char) ? 2.6 : /[ilI1.,:;!]/.test(char) ? 0.85 : 1.55),
    0,
  );
}
function labelName(name: string, width: number): { lines: string[]; shortened: boolean } {
  let remaining = name.replace(/\s+/g, ' ').trim();
  const lines: string[] = [];
  for (let row = 0; row < 2; row++) {
    if (nameWidth(remaining) <= width) return { lines: [...lines, remaining], shortened: false };
    let cut = remaining.length;
    const suffix = row === 1 ? '…' : '';
    while (cut > 0 && nameWidth(remaining.slice(0, cut) + suffix) > width) cut--;
    if (row === 0) {
      const space = remaining.lastIndexOf(' ', cut);
      if (space > 0) cut = space;
    }
    lines.push(remaining.slice(0, cut).trimEnd() + suffix);
    remaining = remaining.slice(cut).trimStart();
  }
  return { lines, shortened: true };
}
const mm = (value: number) => Number(value.toFixed(5));

/** Whitelisted fields only: stock, cost, supplier and customer data never enter the document. */
export function prepareProductLabels(
  products: readonly LabelProduct[],
  selections: Readonly<Record<string, LabelSelection | undefined>>,
  settings: LabelSettings,
  encode: (value: string) => string,
): PreparedProductLabels {
  const { widthMm, heightMm } = settings.paper;
  if (
    !Number.isFinite(widthMm) ||
    !Number.isFinite(heightMm) ||
    widthMm < 25 ||
    widthMm > 120 ||
    heightMm < 25 ||
    heightMm > 100
  )
    throw new Error('Размер этикетки: ширина 25–120 мм, высота 25–100 мм.');
  if (products.length > MAX_LABELS) throw new Error(`Выберите не больше ${MAX_LABELS} товаров.`);
  const previews: PreparedProductLabels['previews'] = [];
  const pages: string[] = [];
  const warnings = new Set<string>();
  let count = 0;
  for (const product of products) {
    const choice = selections[product.id] ?? { copies: 1, source: defaultLabelSource(product) };
    if (!Number.isInteger(choice.copies) || choice.copies < 0 || choice.copies > MAX_LABEL_COPIES)
      throw new Error(`«${product.name}»: укажите от 0 до ${MAX_LABEL_COPIES} копий.`);
    if (choice.copies === 0) continue;
    count += choice.copies;
    if (count > MAX_LABELS) throw new Error(`За один раз можно подготовить не больше ${MAX_LABELS} этикеток.`);
    const code = (choice.source === 'factory' ? product.barcode : product.internalBarcode) ?? '';
    if (!code || !code.trim()) throw new Error(`«${product.name}»: сначала создайте внутренний штрихкод.`);
    if (!/^[\x20-\x7E]{1,80}$/.test(code))
      throw new Error(
        `«${product.name}»: этот код не подходит для Code 128. Выберите или создайте внутренний штрихкод; исходный код сохранится.`,
      );
    const bits = encode(code);
    if (!/^[01]+$/.test(bits)) throw new Error('Не удалось закодировать штрихкод.');
    const barWidth = (bits.length + 2 * QUIET_MODULES) * LABEL_MODULE_MM;
    const required = Math.max(barWidth, code.length * 1.55) + 2 * MARGIN_MM;
    if (required > widthMm)
      throw new Error(
        `«${product.name}»: для этого кода нужна ширина от ${Math.ceil(required)} мм. Выберите бумагу шире или внутренний код.`,
      );
    if (!product.name.trim()) throw new Error('У товара должно быть название.');
    const name = labelName(product.name, widthMm - 2 * MARGIN_MM);
    if (name.shortened) warnings.add('Длинные названия сокращены на этикетке.');
    const barY = settings.showPrice ? 14 : 10;
    const barHeight = Math.min(18, heightMm - barY - 6);
    if (barHeight < 8) throw new Error('Для цены и штрихкода нужна этикетка высотой от 28 мм.');
    const dotMm = 25.4 / LABEL_DPI;
    const left = Math.floor((widthMm - barWidth) / 2 / dotMm) * dotMm + QUIET_MODULES * LABEL_MODULE_MM;
    const bars: string[] = [];
    for (let index = 0; index < bits.length; ) {
      if (bits[index] === '0') {
        index++;
        continue;
      }
      const start = index;
      while (bits[index] === '1') index++;
      bars.push(
        `<rect x="${mm(left + start * LABEL_MODULE_MM)}" y="${barY}" width="${mm((index - start) * LABEL_MODULE_MM)}" height="${mm(barHeight)}"/>`,
      );
    }
    let price = '';
    if (settings.showPrice) {
      if (!Number.isFinite(product.sellPrice) || product.sellPrice < 0)
        throw new Error(`«${product.name}»: проверьте цену продажи.`);
      const formatted = `${product.sellPrice.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} ₽`;
      if (formatted.length * 1.85 > widthMm - 2 * MARGIN_MM)
        throw new Error('Цена не помещается на этикетке. Выберите бумагу шире или отключите цену.');
      price = `<text x="2" y="11.5" font-size="3" font-weight="700">${escapeLabelHtml(formatted)}</text>`;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${widthMm}mm" height="${heightMm}mm" viewBox="0 0 ${widthMm} ${heightMm}" role="img" aria-label="${escapeLabelHtml(product.name)}"><rect width="100%" height="100%" fill="white"/><g fill="black" font-family="Arial, sans-serif">${name.lines.map((line, index) => `<text x="2" y="${4.5 + index * 3.2}" font-size="2.6">${escapeLabelHtml(line)}</text>`).join('')}${price}<g shape-rendering="crispEdges">${bars.join('')}</g><text x="${widthMm / 2}" y="${mm(barY + barHeight + 3.4)}" font-family="monospace" font-size="2.5" text-anchor="middle" xml:space="preserve">${escapeLabelHtml(code)}</text></g></svg>`;
    previews.push({ productId: product.id, svg, copies: choice.copies, code });
    for (let copy = 0; copy < choice.copies; copy++) pages.push(`<div class="label">${svg}</div>`);
  }
  if (count === 0) throw new Error('Укажите хотя бы одну копию.');
  const html = `<!doctype html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Этикетки товаров</title><style>@page{size:${widthMm}mm ${heightMm}mm;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;width:${widthMm}mm;background:#fff}.label{display:block;width:${widthMm}mm;height:${heightMm}mm;break-inside:avoid;break-after:page;page-break-after:always;overflow:hidden}.label:last-child{break-after:auto;page-break-after:auto}svg{display:block;width:${widthMm}mm;height:${heightMm}mm}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}</style></head><body>${pages.join('')}</body></html>`;
  return { html, previews, count, paper: { widthMm, heightMm }, warnings: [...warnings] };
}
