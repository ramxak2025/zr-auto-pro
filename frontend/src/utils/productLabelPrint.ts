import JsBarcode from 'jsbarcode';
import type { PreparedProductLabels } from '../../../shared/utils/productLabels';

/** Client-local import is intentional: shared/ must not resolve a sibling package's runtime dependency. */
export function encodeProductLabelCode(value: string): string {
  const output: { encodings?: Array<{ data: string }> } = {};
  JsBarcode(output, value, { format: 'CODE128', displayValue: false, margin: 0 });
  if (!output.encodings?.length) throw new Error('Не удалось закодировать штрихкод.');
  return output.encodings.map((encoding) => encoding.data).join('');
}

/** The browser owns printer choice and Save as PDF. No fake PDF download is returned. */
export async function printProductLabelsBrowser(
  labels: PreparedProductLabels,
  host: Document = document,
): Promise<void> {
  const frame = host.createElement('iframe');
  frame.title = 'Печать этикеток';
  frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;';
  const loaded = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Документ этикеток не загрузился. Повторите печать.')), 15_000);
    frame.onload = () => {
      clearTimeout(timeout);
      resolve();
    };
    frame.onerror = () => {
      clearTimeout(timeout);
      reject(new Error('Не удалось открыть документ этикеток.'));
    };
  });
  frame.srcdoc = labels.html;
  host.body.appendChild(frame);
  try {
    await loaded;
    await frame.contentDocument?.fonts?.ready;
    const printer = frame.contentWindow;
    if (!printer) throw new Error('Браузер не открыл документ этикеток.');
    const cleanup = () => frame.remove();
    printer.addEventListener('afterprint', cleanup, { once: true });
    // Some browsers omit afterprint when the system dialog is dismissed.
    setTimeout(cleanup, 120_000);
    printer.focus();
    printer.print();
  } catch (error) {
    frame.remove();
    throw error;
  }
}
