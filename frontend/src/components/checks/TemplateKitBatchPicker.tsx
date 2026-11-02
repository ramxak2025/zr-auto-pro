import { useState } from 'react';
import type { KitBatchChoice, TemplateKitChoiceRequest } from '../../../../shared/utils/templateKitApplication';
import { validateKitAllocation } from '../../../../shared/utils/templateKitApplication';
import ProductPickerDrawer from './ProductPickerDrawer';
import Modal from '../Modal';
import { Button, Input } from '../../ui';

export default function TemplateKitBatchPicker({
  request,
  onResolve,
  onRebuild,
}: {
  request: TemplateKitChoiceRequest;
  onResolve: (choice: KitBatchChoice[] | null) => void;
  onRebuild?: () => void;
}) {
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState('');
  const available = request.candidates.reduce((sum, product) => sum + product.stock, 0);
  const shortage = available < request.line.quantity;
  const choices = () =>
    Object.entries(quantities)
      .filter(([, value]) => value !== '' && Number(value) !== 0)
      .map(([productId, value]) => ({ productId, quantity: Number(value) }));
  return (
    <>
      <Modal
        isOpen={!pickerOpen}
        onClose={() => onResolve(null)}
        title={shortage ? 'Не хватает собранных комплектов' : 'Выберите партии комплекта'}
        footer={
          <>
            <Button variant="secondary" onClick={() => onResolve(null)}>
              Отмена
            </Button>
            {!shortage && (
              <Button
                onClick={() => {
                  try {
                    const next = choices();
                    validateKitAllocation(request.line, request.candidates, next);
                    onResolve(next);
                  } catch (cause) {
                    setError((cause as Error).message);
                  }
                }}
              >
                Применить весь шаблон
              </Button>
            )}
          </>
        }
      >
        <p className="text-sm text-ink">
          {request.line.name} · состав версии {request.line.kitRecipeVersion} · нужно {request.line.quantity}, доступно{' '}
          {available}
        </p>
        <p className="mt-2 text-sm text-ink-2">
          Цены — из выбранных партий. Корзина изменится после выбора всех позиций шаблона.
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-bad-text">
            {error}
          </p>
        )}
        {shortage ? (
          <div className="mt-4">
            {onRebuild ? (
              <Button variant="secondary" onClick={onRebuild}>
                Собрать ещё по этому составу
              </Button>
            ) : (
              <p className="text-sm text-ink-2">
                Попросите сотрудника с правом управления складом собрать нужное количество.
              </p>
            )}
          </div>
        ) : (
          <>
            <Button variant="secondary" className="mt-4" onClick={() => setPickerOpen(true)}>
              Выбрать через каталог кассы
            </Button>
            {request.candidates
              .filter((product) => quantities[product.id] !== undefined)
              .map((product) => (
                <div key={product.id} className="flex items-center gap-3 border-b border-line py-3">
                  <div className="min-w-0 flex-1 text-sm">
                    <p>{product.name}</p>
                    <p className="text-ink-2">
                      {product.sellPrice} ₽ · остаток {product.stock}
                    </p>
                  </div>
                  <Input
                    className="w-24"
                    aria-label={`Количество партии — ${product.id}`}
                    inputMode="numeric"
                    value={quantities[product.id]}
                    onChange={(event) =>
                      setQuantities((previous) => ({ ...previous, [product.id]: event.target.value }))
                    }
                  />
                </div>
              ))}
          </>
        )}
      </Modal>
      <ProductPickerDrawer
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        products={request.candidates}
        selectedIds={Object.keys(quantities)}
        onSelectProduct={(product) => {
          setQuantities((previous) => ({ ...previous, [product.id]: previous[product.id] ?? '1' }));
          setPickerOpen(false);
        }}
      />
    </>
  );
}
