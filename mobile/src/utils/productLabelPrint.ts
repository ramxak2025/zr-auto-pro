import JsBarcode from 'jsbarcode';
import { Platform } from 'react-native';
import { labelPagePoints, type PreparedProductLabels } from '../../../shared/utils/productLabels';

/** Plain-object mode uses no DOM, canvas, SVG native module or printer SDK. */
export function encodeProductLabelCode(value: string): string {
  const output: { encodings?: Array<{ data: string }> } = {};
  JsBarcode(output, value, { format: 'CODE128', displayValue: false, margin: 0 });
  if (!output.encodings?.length) throw new Error('Не удалось закодировать штрихкод.');
  return output.encodings.map((encoding) => encoding.data).join('');
}

export function productLabelPdfOptions(labels: PreparedProductLabels, platform: string) {
  const points = labelPagePoints(labels.paper);
  // expo-print 15 Android PrintOptions.kt uses integer points; round up to avoid clipping.
  // Rounding is under 0.36 mm. iOS accepts Float and retains the requested physical size.
  return {
    html: labels.html,
    width: platform === 'android' ? Math.ceil(points.width) : points.width,
    height: platform === 'android' ? Math.ceil(points.height) : points.height,
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
    base64: false,
    textZoom: 100,
    useMarkupFormatter: false,
  };
}

interface LabelPrintDependencies {
  platform: string;
  print: Pick<typeof import('expo-print'), 'printToFileAsync' | 'printAsync'>;
  sharing: Pick<typeof import('expo-sharing'), 'isAvailableAsync' | 'shareAsync'>;
}
async function dependencies(): Promise<LabelPrintDependencies> {
  // Metro's namespace import eagerly reads every React Native export, including
  // deprecated native modules that are absent in this binary. Read Platform only.
  const [print, sharing] = await Promise.all([import('expo-print'), import('expo-sharing')]);
  return { print, sharing, platform: Platform.OS };
}

export async function exportProductLabelsPdf(labels: PreparedProductLabels, deps?: LabelPrintDependencies) {
  const api = deps ?? (await dependencies());
  const pdf = await api.print.printToFileAsync(productLabelPdfOptions(labels, api.platform));
  if (!pdf.uri) throw new Error('Не удалось создать PDF этикеток.');
  const shared = await api.sharing.isAvailableAsync();
  if (shared)
    await api.sharing.shareAsync(pdf.uri, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      dialogTitle: 'Этикетки товаров',
    });
  return { uri: pdf.uri, shared };
}

/** Print the generated label-sized PDF, so system printing cannot substitute Letter HTML defaults. */
export async function printProductLabelsNative(
  labels: PreparedProductLabels,
  deps?: LabelPrintDependencies,
): Promise<void> {
  const api = deps ?? (await dependencies());
  const pdf = await api.print.printToFileAsync(productLabelPdfOptions(labels, api.platform));
  if (!pdf.uri) throw new Error('Не удалось создать PDF этикеток.');
  await api.print.printAsync({ uri: pdf.uri });
}
