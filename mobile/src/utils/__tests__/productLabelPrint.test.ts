import {
  encodeProductLabelCode,
  exportProductLabelsPdf,
  printProductLabelsNative,
  productLabelPdfOptions,
} from '../productLabelPrint';
import { prepareProductLabels } from '../../../../shared/utils/productLabels';
const document = () =>
  prepareProductLabels(
    [{ id: 'one', name: 'Фильтр воздушный', sellPrice: 0, internalBarcode: 'AX00000001' }],
    {},
    { paper: { widthMm: 40, heightMm: 30 }, showPrice: false },
    encodeProductLabelCode,
  );

it('encodes using the actual mobile-local JsBarcode dependency without DOM globals', () => {
  const data = encodeProductLabelCode('AX00000001');
  expect(data).toMatch(/^[01]+$/);
  expect(document().previews[0].code).toBe('AX00000001');
  expect(productLabelPdfOptions(document(), 'android')).toMatchObject({
    width: 114,
    height: 86,
    textZoom: 100,
    base64: false,
    margins: { top: 0, right: 0, bottom: 0, left: 0 },
  });
});
it('exports a real PDF URI even without sharing and propagates system print cancellation', async () => {
  const printToFileAsync = jest.fn(async () => ({ uri: 'file:///label.pdf', numberOfPages: 1 }));
  const printAsync = jest.fn(async () => {
    throw Error('cancelled');
  });
  const shareAsync = jest.fn(async () => {});
  const deps = {
    platform: 'ios',
    print: { printToFileAsync, printAsync },
    sharing: { isAvailableAsync: async () => false, shareAsync },
  };
  await expect(exportProductLabelsPdf(document(), deps)).resolves.toEqual({ uri: 'file:///label.pdf', shared: false });
  expect(shareAsync).not.toHaveBeenCalled();
  await expect(printProductLabelsNative(document(), deps)).rejects.toThrow('cancelled');
  expect(printAsync).toHaveBeenCalledWith({ uri: 'file:///label.pdf' });
});
