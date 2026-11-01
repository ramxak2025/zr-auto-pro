import { useEffect, useMemo, useState } from 'react';
import { FileText, Printer, Barcode } from 'lucide-react';
import toast from 'react-hot-toast';
import { Drawer } from '../../ui/Drawer';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Select } from '../../ui/Select';
import { Checkbox } from '../../ui/Checkbox';
import { Field } from '../../ui/Field';
import {
  defaultLabelSource,
  LABEL_PAPERS,
  MAX_LABEL_COPIES,
  MAX_LABELS,
  prepareProductLabels,
  type LabelProduct,
  type LabelSelection,
} from '../../../../shared/utils/productLabels';
import { encodeProductLabelCode, printProductLabelsBrowser } from '../../utils/productLabelPrint';

export interface ProductLabelPrintProps {
  open: boolean;
  onClose: () => void;
  products: readonly LabelProduct[];
  /** Must call the server's generate-only-if-absent command. Never supply a client-generated code. */
  onGenerateInternal?: (productIds: string[]) => Promise<Array<{ id: string; internalBarcode: string }>>;
}
export default function ProductLabelPrint({ open, onClose, products, onGenerateInternal }: ProductLabelPrintProps) {
  const [items, setItems] = useState<LabelProduct[]>([]);
  const [choices, setChoices] = useState<Record<string, LabelSelection>>({});
  const [paper, setPaper] = useState('40');
  const [width, setWidth] = useState('40');
  const [height, setHeight] = useState('30');
  const [showPrice, setShowPrice] = useState(false);
  const [previewId, setPreviewId] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setItems(
      products.map(({ id, name, sellPrice, barcode, internalBarcode }) => ({
        id,
        name,
        sellPrice,
        barcode,
        internalBarcode,
      })),
    );
    setChoices(
      Object.fromEntries(products.map((product) => [product.id, { copies: 1, source: defaultLabelSource(product) }])),
    );
    setPreviewId(products[0]?.id ?? '');
  }, [open, products]);
  const dimensions = useMemo(
    () =>
      paper === 'custom'
        ? { widthMm: Number(width.replace(',', '.')), heightMm: Number(height.replace(',', '.')) }
        : LABEL_PAPERS[paper === '58' ? 1 : 0],
    [paper, width, height],
  );
  const result = useMemo(() => {
    try {
      return {
        labels: prepareProductLabels(items, choices, { paper: dimensions, showPrice }, encodeProductLabelCode),
        error: '',
      };
    } catch (error) {
      return { labels: undefined, error: error instanceof Error ? error.message : 'Не удалось подготовить этикетки.' };
    }
  }, [items, choices, dimensions, showPrice]);
  const preview = result.labels?.previews.find((item) => item.productId === previewId) ?? result.labels?.previews[0];
  const setChoice = (id: string, patch: Partial<LabelSelection>) =>
    setChoices((previous) => ({ ...previous, [id]: { ...previous[id], ...patch } }));
  const generate = async (ids: string[]) => {
    if (!onGenerateInternal || busy) return;
    setBusy(true);
    try {
      if (ids.length > MAX_LABELS) throw new Error(`Выберите не больше ${MAX_LABELS} товаров.`);
      const codes = await onGenerateInternal(ids);
      setItems((previous) =>
        previous.map((item) => ({
          ...item,
          internalBarcode: codes.find((code) => code.id === item.id)?.internalBarcode ?? item.internalBarcode,
        })),
      );
      for (const id of ids) setChoice(id, { source: 'internal' });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось создать штрихкод. Повторите по сети.');
    } finally {
      setBusy(false);
    }
  };
  const print = async () => {
    if (!result.labels || busy) return;
    setBusy(true);
    try {
      await printProductLabelsBrowser(result.labels);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось открыть печать.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Этикетки"
      subtitle="Одна этикетка на страницу"
      size="lg"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" icon={FileText} disabled={!result.labels || busy} onClick={() => void print()}>
            PDF через диалог
          </Button>
          <Button icon={Printer} loading={busy} disabled={!result.labels} onClick={() => void print()}>
            Печать{result.labels ? ` · ${result.labels.count}` : ''}
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        <Field label="Бумага">
          <Select value={paper} onChange={(event) => setPaper(event.target.value)}>
            <option value="40">40 × 30 мм</option>
            <option value="58">58 × 40 мм</option>
            <option value="custom">Свой размер</option>
          </Select>
        </Field>
        {paper === 'custom' && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Ширина, мм">
              <Input inputMode="decimal" value={width} onChange={(event) => setWidth(event.target.value)} />
            </Field>
            <Field label="Высота, мм">
              <Input inputMode="decimal" value={height} onChange={(event) => setHeight(event.target.value)} />
            </Field>
          </div>
        )}
        <Checkbox
          label="Печатать цену продажи"
          checked={showPrice}
          onChange={(event) => setShowPrice(event.target.checked)}
        />
        {onGenerateInternal && items.filter((item) => !item.internalBarcode).length > 1 && (
          <Button
            variant="secondary"
            size="sm"
            icon={Barcode}
            disabled={busy}
            onClick={() => void generate(items.filter((item) => !item.internalBarcode).map((item) => item.id))}
          >
            Создать недостающие внутренние коды
          </Button>
        )}
        <div className="divide-y divide-line border-y border-line">
          {items.map((item) => (
            <div key={item.id} className="space-y-2 py-3">
              <div className="flex items-start justify-between gap-3">
                <button
                  className="min-w-0 text-left text-sm font-medium text-ink underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  onClick={() => setPreviewId(item.id)}
                >
                  {item.name}
                </button>
                <label
                  htmlFor={`label-copies-${item.id}`}
                  className="flex shrink-0 items-center gap-2 text-xs text-ink-2"
                >
                  Копий
                  <Input
                    id={`label-copies-${item.id}`}
                    className="w-20"
                    aria-label={`Копий: ${item.name}`}
                    type="number"
                    min="0"
                    max={MAX_LABEL_COPIES}
                    value={choices[item.id]?.copies ?? 1}
                    onChange={(event) => setChoice(item.id, { copies: Number(event.target.value) })}
                  />
                </label>
              </div>
              {item.barcode && item.internalBarcode ? (
                <Field label={`Штрихкод: ${item.name}`}>
                  <Select
                    value={choices[item.id]?.source ?? defaultLabelSource(item)}
                    onChange={(event) =>
                      setChoice(item.id, { source: event.target.value === 'factory' ? 'factory' : 'internal' })
                    }
                  >
                    <option value="factory">Заводской · {item.barcode}</option>
                    <option value="internal">Внутренний · {item.internalBarcode}</option>
                  </Select>
                </Field>
              ) : (
                <p className="break-all text-xs text-ink-2">
                  {item.barcode
                    ? `Заводской · ${item.barcode}`
                    : item.internalBarcode
                      ? `Внутренний · ${item.internalBarcode}`
                      : 'Штрихкод не создан'}
                </p>
              )}
              {!item.internalBarcode && onGenerateInternal && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Barcode}
                  disabled={busy}
                  onClick={() => void generate([item.id])}
                >
                  Создать внутренний штрихкод
                </Button>
              )}
            </div>
          ))}
        </div>
        {result.error && (
          <p role="alert" className="text-sm text-bad-text">
            {result.error}
          </p>
        )}
        {preview && (
          <figure className="space-y-2">
            <figcaption className="text-sm font-medium text-ink">
              Предпросмотр · {dimensions.widthMm} × {dimensions.heightMm} мм
            </figcaption>
            <div className="overflow-auto rounded-lg border border-line bg-surface-2 p-4">
              <div
                style={{ width: '100%', maxWidth: dimensions.widthMm * 6 }}
                dangerouslySetInnerHTML={{ __html: preview.svg }}
              />
            </div>
            <p className="text-xs text-ink-3">Нажмите название товара, чтобы посмотреть его этикетку.</p>
          </figure>
        )}
        {result.labels?.warnings.map((warning) => (
          <p key={warning} className="text-xs text-ink-3">
            {warning}
          </p>
        ))}
        <p className="text-xs leading-relaxed text-ink-2">
          Выберите такой же размер в драйвере, масштаб 100% и отключите колонтитулы. USB/Wi-Fi — через установленный
          драйвер. Для PDF выберите «Сохранить как PDF» в диалоге браузера.
        </p>
      </div>
    </Drawer>
  );
}
