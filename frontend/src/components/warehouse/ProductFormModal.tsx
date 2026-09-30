import { useMemo, useState, type FormEvent } from 'react';
import { Package, Search, X } from 'lucide-react';
import toast from 'react-hot-toast';
import type { Product, BundleItem } from '../../types';
import Modal from '../Modal';
import Switch from '../Switch';
import ImageUpload from '../ImageUpload';
import { Button } from '../../ui/Button';
import { Field } from '../../ui/Field';
import { Input } from '../../ui/Input';
import { IconButton } from '../../ui/IconButton';
import { SegmentedControl } from '../../ui/SegmentedControl';
import { cn } from '../../ui/cn';
import { focusRing } from '../../ui/tokens';
import { DEFAULT_UNIT, UNIT_PRESETS, formatQty, unitLabel } from '../../utils/units';
import { toNumberOrZero } from './format';
import StorageCellSelect from './StorageCellSelect';

export interface ProductFormData {
  name: string;
  category: string;
  photo?: string;
  costPrice: number;
  sellPrice: number;
  stock: number;
  minStock: number;
  unit: string;
  /** Round 12 #6: EAN-13/QR/свой код. У существующего товара '' очищает. */
  barcode?: string;
  isBundle: boolean;
  bundleItems: BundleItem[];
  warrantyDays: number | null;
  warehouseId?: string;
  /** Ячейка хранения: id — назначить, null — снять (только у существующего товара), не задано — не менять. */
  storageCellId?: string | null;
}

interface ProductFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  product?: Product | null;
  onSubmit: (data: ProductFormData) => void;
  isLoading: boolean;
  categories: string[];
  allProducts: Product[];
  defaultCategory?: string;
  /** Warehouse the create form should default to (currently active picker). */
  defaultWarehouseId?: string;
  /** Owner-class or warehouse_manage. Gates the cost-price input (defensive —
   *  non-managers never reach this modal since add/edit buttons are hidden). */
  canManage?: boolean;
}

// 120 (дробные количества): значения единиц храним русскими метками
// ('шт','м','кг','л','уп','компл'); legacy-коды ('pcs','m','l','kg')
// разруливает unitLabel из utils/units.
const UNIT_OPTIONS = UNIT_PRESETS.map((u) => ({ value: u as string, label: u as string }));
const FORM_ID = 'product-form';

/** Форма товара: создание и правка (одна модалка, состояние сбрасывается через key). */
export default function ProductFormModal({
  isOpen,
  onClose,
  product,
  onSubmit,
  isLoading,
  categories,
  allProducts,
  defaultCategory,
  defaultWarehouseId,
  canManage = true,
}: ProductFormModalProps) {
  const [name, setName] = useState(product?.name || '');
  const [category, setCategory] = useState(product?.category || defaultCategory || '');
  const [photo, setPhoto] = useState(product?.photo || '');
  const [costPrice, setCostPrice] = useState(product?.costPrice?.toString() || '0');
  const [sellPrice, setSellPrice] = useState(product?.sellPrice?.toString() || '0');
  const [stock, setStock] = useState(product?.stock?.toString() || '0');
  const [minStock, setMinStock] = useState(product?.minStock?.toString() || '0');
  // 120: legacy-код ('pcs'→'шт') нормализуем сразу — переключатель подсветит
  // значение, сохранение перезапишет legacy-код русской меткой.
  const [unit, setUnit] = useState(unitLabel(product?.unit) || DEFAULT_UNIT);
  const [isBundle, setIsBundle] = useState(product?.isBundle || false);
  const [bundleItems, setBundleItems] = useState<BundleItem[]>(product?.bundleItems || []);
  const [bundleSearch, setBundleSearch] = useState('');
  const [warrantyDays, setWarrantyDays] = useState(product?.warrantyDays != null ? String(product.warrantyDays) : '');
  // Round 12 #6: штрихкод — обычный текстовый input. USB-сканер печатает код
  // как клавиатура, поэтому отдельная камера-кнопка на вебе не нужна.
  const [barcode, setBarcode] = useState(product?.barcode || '');
  const initialCellId = product?.storageCellId || '';
  const [storageCellId, setStorageCellId] = useState(initialCellId);
  const cellWarehouseId = product?.warehouseId || defaultWarehouseId;
  const currentCell = useMemo(
    () =>
      product?.storageCellId && product.storageCellCode
        ? { id: product.storageCellId, code: product.storageCellCode, name: product.storageCellName }
        : null,
    [product?.storageCellId, product?.storageCellCode, product?.storageCellName],
  );

  const bundleSearchResults = useMemo(() => {
    if (!bundleSearch.trim()) return [];
    const q = bundleSearch.toLowerCase();
    return allProducts
      .filter(
        (p) => !p.isBundle && p.name.toLowerCase().includes(q) && !bundleItems.some((bi) => bi.productId === p.id),
      )
      .slice(0, 8);
  }, [bundleSearch, allProducts, bundleItems]);

  function addBundleItem(p: Product) {
    setBundleItems((prev) => [...prev, { productId: p.id, name: p.name, quantity: 1 }]);
    setBundleSearch('');
  }

  function removeBundleItem(productId: string) {
    setBundleItems((prev) => prev.filter((bi) => bi.productId !== productId));
  }

  function updateBundleItemQty(productId: string, qty: number) {
    setBundleItems((prev) =>
      prev.map((bi) => (bi.productId === productId ? { ...bi, quantity: Math.max(1, qty) } : bi)),
    );
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Введите название товара');
      return;
    }
    if (isBundle && bundleItems.length === 0) {
      toast.error('Добавьте товары в комплект');
      return;
    }
    const trimmedWd = warrantyDays.trim();
    onSubmit({
      name: name.trim(),
      category: category.trim(),
      photo: photo || undefined,
      costPrice: toNumberOrZero(costPrice),
      sellPrice: toNumberOrZero(sellPrice),
      stock: toNumberOrZero(stock),
      minStock: toNumberOrZero(minStock),
      unit,
      isBundle,
      bundleItems: isBundle ? bundleItems : [],
      // '' у существующего товара ОЧИЩАЕТ штрихкод (PATCH сетит поле только
      // когда оно пришло); у нового пустое поле просто не отправляем.
      barcode: product ? barcode.trim() : barcode.trim() || undefined,
      warrantyDays: trimmedWd === '' ? null : Math.max(0, Math.floor(Number(trimmedWd))),
      // For new products, fall back to the currently selected warehouse from
      // the page. Edits keep the product's own warehouseId untouched here.
      warehouseId: product?.warehouseId || defaultWarehouseId || undefined,
      // Не менялась — поле не отправляем, чтобы склад без ячеек не получал лишнего.
      storageCellId: storageCellId !== initialCellId ? storageCellId || null : undefined,
    });
  }

  const unitHint = unit !== DEFAULT_UNIT ? `в ${unitLabel(unit)}, до трёх знаков после запятой` : undefined;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={product ? 'Редактировать товар' : 'Новый товар'}
      description={product ? product.name : defaultCategory ? `В папку «${defaultCategory}»` : undefined}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={isLoading}>
            Отмена
          </Button>
          <Button type="submit" form={FORM_ID} loading={isLoading}>
            {product ? 'Сохранить' : 'Создать'}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={handleSubmit} className="space-y-4">
        <div className="flex items-start gap-4">
          <ImageUpload
            variant="avatar"
            label="Фото товара"
            value={photo}
            onChange={setPhoto}
            onClear={() => setPhoto('')}
          />
          <div className="min-w-0 flex-1 space-y-4">
            <Field label="Название" htmlFor="product-name" required>
              <Input
                id="product-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Название товара"
                autoComplete="off"
                required
              />
            </Field>
            <Field label="Папка" htmlFor="product-category" hint="Вложенность через «/»: Расходники/Масла">
              <Input
                id="product-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Без папки"
                list="product-categories"
                autoComplete="off"
              />
              <datalist id="product-categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </Field>
          </div>
        </div>

        <Field label="Единица измерения">
          <SegmentedControl<string>
            aria-label="Единица измерения"
            fullWidth
            value={unit}
            onChange={setUnit}
            options={UNIT_OPTIONS}
          />
        </Field>

        <div className={cn('grid gap-4', canManage ? 'grid-cols-2' : 'grid-cols-1')}>
          {/* Закуп. цена — cost-price is manage-only. Hidden defensively for
              non-managers (they can't reach this modal anyway). */}
          {canManage && (
            <Field label="Закупочная цена, ₽" htmlFor="product-cost">
              <Input
                id="product-cost"
                inputMode="decimal"
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
                className="tabular-nums"
              />
            </Field>
          )}
          <Field label="Продажная цена, ₽" htmlFor="product-sell">
            <Input
              id="product-sell"
              inputMode="decimal"
              value={sellPrice}
              onChange={(e) => setSellPrice(e.target.value)}
              className="tabular-nums"
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Без ограничения снизу: товар, проданный «в минус» (оверселл разрешён
              продуктово), хранит отрицательный остаток, и валидация блокировала
              бы отправку всей формы — включая правку цены. */}
          <Field label="Остаток" htmlFor="product-stock" hint={unitHint}>
            <Input
              id="product-stock"
              inputMode="decimal"
              value={stock}
              onChange={(e) => setStock(e.target.value)}
              className="tabular-nums"
            />
          </Field>
          <Field label="Минимальный остаток" htmlFor="product-min-stock" hint="Ниже — товар подсветится как дефицит">
            <Input
              id="product-min-stock"
              inputMode="decimal"
              value={minStock}
              onChange={(e) => setMinStock(e.target.value)}
              className="tabular-nums"
            />
          </Field>
        </div>

        <StorageCellSelect
          id="product-storage-cell"
          warehouseId={cellWarehouseId}
          value={storageCellId}
          onChange={setStorageCellId}
          canCreate={canManage}
          currentCell={currentCell}
        />

        <div className="flex items-center gap-3">
          <Switch id="product-bundle" checked={isBundle} onChange={setIsBundle} label="Комплект (набор товаров)" />
          <label htmlFor="product-bundle" className="cursor-pointer text-sm font-medium text-ink-2">
            Комплект (набор товаров)
          </label>
        </div>

        {isBundle && (
          <div className="space-y-3 rounded-xl border border-accent/30 bg-accent-soft/50 p-3">
            <p className="text-sm font-medium text-ink">Состав комплекта</p>
            {bundleItems.length > 0 && (
              <ul className="space-y-1.5">
                {bundleItems.map((bi) => (
                  <li
                    key={bi.productId}
                    className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{bi.name}</span>
                    <Input
                      size="sm"
                      inputMode="numeric"
                      aria-label={`Количество — ${bi.name}`}
                      value={String(bi.quantity)}
                      onChange={(e) => updateBundleItemQty(bi.productId, parseInt(e.target.value, 10) || 1)}
                      className="w-16 text-center tabular-nums"
                    />
                    <span className="w-8 text-xs text-ink-3">
                      {unitLabel(allProducts.find((p) => p.id === bi.productId)?.unit)}
                    </span>
                    <IconButton
                      label={`Убрать ${bi.name}`}
                      icon={X}
                      size="sm"
                      variant="danger"
                      onClick={() => removeBundleItem(bi.productId)}
                    />
                  </li>
                ))}
              </ul>
            )}
            <Input
              size="sm"
              leftIcon={Search}
              aria-label="Поиск товара для комплекта"
              value={bundleSearch}
              onChange={(e) => setBundleSearch(e.target.value)}
              placeholder="Поиск товара для комплекта…"
              autoComplete="off"
            />
            {bundleSearchResults.length > 0 && (
              <ul className="max-h-40 space-y-1 overflow-y-auto">
                {bundleSearchResults.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => addBundleItem(p)}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-left text-sm',
                        'transition-colors duration-150 hover:bg-surface-2',
                        focusRing,
                      )}
                    >
                      <Package className="h-4 w-4 flex-shrink-0 text-ink-4" aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate text-ink">{p.name}</span>
                      <span className="text-xs tabular-nums text-ink-3">
                        {formatQty(p.stock)} {unitLabel(p.unit)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Barcode (round 12 #6) — plain input: a USB scanner types the code
            like a keyboard, so no dedicated scan button is needed on web. */}
        <Field
          label="Штрихкод"
          htmlFor="product-barcode"
          hint="Поставьте курсор в поле и считайте код USB-сканером — он напечатает его как клавиатура"
        >
          <Input
            id="product-barcode"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value)}
            placeholder="EAN-13 / QR / свой код"
            autoComplete="off"
            className="tabular-nums"
          />
        </Field>

        <Field
          label="Гарантия, дней"
          htmlFor="product-warranty"
          hint="Дней с момента продажи; пусто — без гарантии. На товар можно будет оформить гарантийный возврат"
        >
          <Input
            id="product-warranty"
            inputMode="numeric"
            value={warrantyDays}
            onChange={(e) => setWarrantyDays(e.target.value)}
            placeholder="Без гарантии"
            className="tabular-nums"
          />
        </Field>
      </form>
    </Modal>
  );
}
