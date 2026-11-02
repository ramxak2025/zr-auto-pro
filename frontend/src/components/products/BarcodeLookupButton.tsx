import { useEffect, useRef, useState } from 'react';
import { ScanLine } from 'lucide-react';
import { productsApi } from '../../api/services';
import { loadProductBarcodeMatches, type ProductBarcodeResult } from '../../../../shared/utils/productBarcodeLookup';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Input';
import { Field } from '../../ui/Field';

/** USB scanners type into this field like a keyboard; names still use the normal search box. */
export default function BarcodeLookupButton({
  warehouseId,
  onResolved,
  disabled = false,
}: {
  warehouseId?: string;
  disabled?: boolean;
  onResolved: (result: ProductBarcodeResult) => void;
}) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const epoch = useRef(0);
  useEffect(
    () => () => {
      epoch.current++;
    },
    [],
  );
  useEffect(() => {
    epoch.current++;
    setOpen(false);
    setBusy(false);
  }, [warehouseId]);
  const close = () => {
    epoch.current++;
    setOpen(false);
    setBusy(false);
  };
  const lookup = async () => {
    if (busy) return;
    const request = ++epoch.current;
    setBusy(true);
    setError('');
    try {
      const result = await loadProductBarcodeMatches(productsApi.lookupBarcode, {
        barcode: code,
        ...(warehouseId ? { warehouseId } : {}),
      });
      if (request !== epoch.current) return;
      if (result.status === 'not_found') {
        setError('Штрихкод не найден. Проверьте код и выбранный склад.');
        return;
      }
      onResolved(result);
      close();
    } catch (failure) {
      if (request === epoch.current)
        setError(
          failure instanceof Error
            ? failure.message
            : 'Не удалось проверить штрихкод. Подключитесь к сети и повторите.',
        );
    } finally {
      if (request === epoch.current) setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <Button
        variant="secondary"
        size="sm"
        icon={ScanLine}
        disabled={disabled}
        aria-expanded={open}
        onClick={() => {
          if (open) {
            close();
            return;
          }
          setCode('');
          setError('');
          setOpen(true);
        }}
      >
        Штрихкод
      </Button>
      {open && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            void lookup();
          }}
          className="flex flex-wrap items-end gap-2"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              close();
            }
          }}
        >
          <Field label="Штрихкод">
            <Input autoFocus value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" />
          </Field>
          <Button type="submit" loading={busy} disabled={!code.trim()}>
            Найти
          </Button>
          <Button variant="ghost" onClick={close}>
            Отмена
          </Button>
          <p className="basis-full text-xs text-ink-3">
            Отсканируйте сканером или вставьте код. При совпадениях выберите нужный товар.
          </p>
          {error && (
            <p role="alert" className="basis-full text-sm text-bad-text">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
