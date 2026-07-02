/**
 * productPickerSession — модульный мост Касса ⇄ ProductPickerScreen (Round 8 #2).
 *
 * ЗАЧЕМ. Пикер товаров Кассы — теперь ПОЛНОЭКРАННЫЕ экраны на корневом стеке
 * (каждый уровень папки — отдельный push роута `ProductPicker`), а корзина
 * (productLines + addProductLine) живёт в CheckCreateScreen, который остаётся
 * смонтированным ПОД экранами пикера. Передавать колбэки через route.params
 * нельзя: React Navigation честно ругается non-serializable warning'ом и
 * ломает state-restoration. Вместо этого — крошечный module-level store:
 * CheckCreateScreen «клеймит» сессию перед открытием пикера и обновляет её
 * на каждом своём рендере (mutable ref, нулевая стоимость), а экраны пикера
 * подписываются через useSyncExternalStore и перерисовываются ТОЛЬКО когда
 * Касса явно нотифицирует (изменилась корзина / склад / права).
 *
 * ВЛАДЕНИЕ. Одновременно живут максимум две Кассы (таб «Касса» + пушнутый
 * edit-CheckCreate), поэтому сессия принадлежит тому инстансу, который
 * ПОСЛЕДНИМ открыл пикер (claim при открытии). notify/release сверяют ref
 * владельца — чужой инстанс не может ни перетереть, ни закрыть чужую сессию.
 *
 * Экран пикера обязан переживать `getProductPickerSession() === null`
 * (state-restoration / deep-link без живой Кассы) — в этом случае он просто
 * закрывает себя.
 */
import type { Product, Warehouse, CheckProductLine } from '../../../shared/types';

export interface ProductPickerBridge {
  /** Текущие строки товаров чека — источник qty-бейджей и нижнего бара. */
  productLines: CheckProductLine[];
  /** Добавить товар (комплекты разворачивает сама Касса — addProductLine). */
  addProduct: (product: Product) => void;
  /** Убрать одну единицу; при quantity → 0 строка удаляется из чека. */
  decrementProduct: (productId: string) => void;
  /** Показывать себестоимость (директор/админ/суперадмин — как на Складе). */
  showCostPrice: boolean;
  /** Имена товаров на активной гарантии у выбранного клиента (#12). */
  warrantyNames: ReadonlySet<string>;
  /** Активный склад пикера (state Кассы — переживает закрытие/открытие). */
  warehouseId: string | null;
  setWarehouseId: (id: string) => void;
  /** Список складов для свитчера на корневом уровне. */
  warehouses: Warehouse[];
}

type BridgeRef = { readonly current: ProductPickerBridge };

let ownerRef: BridgeRef | null = null;
let version = 0;
const listeners = new Set<() => void>();

function emit(): void {
  version++;
  for (const l of listeners) l();
}

/** Касса становится владельцем сессии — вызывается ПЕРЕД navigate в пикер. */
export function claimProductPickerSession(ref: BridgeRef): void {
  ownerRef = ref;
  emit();
}

/** Снять сессию при unmount Кассы (только если она всё ещё владелец). */
export function releaseProductPickerSession(ref: BridgeRef): void {
  if (ownerRef === ref) {
    ownerRef = null;
    emit();
  }
}

/** Касса сообщает пикеру «корзина/склад/права изменились» (гейтится ref'ом). */
export function notifyProductPickerSession(ref: BridgeRef): void {
  if (ownerRef === ref) emit();
}

export function getProductPickerSession(): ProductPickerBridge | null {
  return ownerRef ? ownerRef.current : null;
}

/** Снэпшот-версия для useSyncExternalStore (растёт на каждый emit). */
export function getProductPickerSessionVersion(): number {
  return version;
}

export function subscribeProductPickerSession(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
