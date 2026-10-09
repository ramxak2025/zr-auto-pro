/**
 * Строки услуг заказ-наряда — чистые хелперы, общие для web и mobile
 * (2026-09-30, docs/specs/2026-09-30-SERVICE_LINES_NO_QTY.md). Никаких зависимостей от
 * React / RN / Node.
 *
 * Строка услуги = одна услуга по одной цене: у новых строк `quantity` всегда 1 и клиенты
 * его больше не шлют. Поле остаётся в типах ради legacy-строк старых чеков и шаблонов
 * («Мойка ×3»); эти хелперы нужны, чтобы старые данные показывались честно.
 *
 *   - expandServiceQuantities — строку «×3» разворачивает в три строки (для шаблонов)
 *   - serviceLineTotal        — сумма строки, как её считает сервер
 */

import type { CheckServiceLine } from '../types';

/**
 * Минимальная форма строки услуги. Под неё подходят и `CheckServiceLine`, и строка
 * шаблона `CheckTemplate.services[]` (у неё нет `total`).
 */
export interface ServiceLineLike {
  price: number;
  quantity?: number | null;
  total?: number;
}

/**
 * Строки с `quantity` больше этого числа `expandServiceQuantities` не разворачивает —
 * они остаются legacy-строкой «×N» (иначе битый `quantity: 1000000` завесил бы клиент).
 */
export const MAX_EXPANDED_QUANTITY = 100;

/** Explicit edit hydration keeps the persisted line id and editable fields only. */
export function hydrateServiceLineForCheckEdit(line: CheckServiceLine, fallbackMasterId: string): {
  id?: string;
  serviceId: string;
  masterId: string;
  name: string;
  price: number;
  quantity: number;
  total: number;
} {
  const quantity = Number(line.quantity);
  return {
    ...(line.id ? { id: line.id } : {}),
    serviceId: line.serviceId || '',
    masterId: line.masterId || fallbackMasterId,
    name: line.name,
    price: line.price,
    quantity: Number.isFinite(quantity) && quantity > 1 ? quantity : 1,
    total: line.total,
  };
}

/** Copy only user-editable template fields; persisted line IDs and server snapshots are never copied. */
export function toCheckTemplateServiceInput(line: {
  serviceId?: string;
  name: string;
  price: number;
}): { serviceId?: string; name: string; price: number } {
  return { ...(line.serviceId ? { serviceId: line.serviceId } : {}), name: line.name, price: line.price };
}

/** Как на сервере (checks.service.ts): до копеек, с защитой от артефактов float. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Сумма строки услуги: `round2(price × (quantity ?? 1))`. Для новых строк — просто цена;
 * для legacy-строки «×3» — честная сумма, нужна при редактировании старого чека.
 * Сервер считает то же (`price × (quantity || 1)`); `??` и `||` расходятся только на 0,
 * а нулевого `quantity` в БД нет. Нечисловая цена → 0, нечисловое количество → 1.
 */
export function serviceLineTotal(line: ServiceLineLike): number {
  const price = Number(line.price);
  if (!Number.isFinite(price)) return 0;
  const quantity = Number(line.quantity ?? 1);
  return round2(price * (Number.isFinite(quantity) ? quantity : 1));
}

/**
 * Разворачивает строку с `quantity > 1` в N отдельных строк: у каждой `quantity: 1`,
 * а `total` (если поле было у исходной строки; у строк шаблонов его нет) равен цене.
 * Порядок сохраняется: `[A×2, B]` → `[A, A, B]`. Нужен, чтобы применить старый шаблон
 * и открыть его в редакторе, где количества больше нет.
 *
 * Остальные строки возвращаются как есть (та же ссылка): `quantity` 1 / пусто / < 1,
 * дробное, а также больше `MAX_EXPANDED_QUANTITY`. Их сумму честно даёт `serviceLineTotal`.
 * Вход не мутируется. Копии поверхностные: остальные поля (в т. ч. `id`, если он есть)
 * не меняются — ключи для списка вызывающий назначает сам.
 */
export function expandServiceQuantities<T extends ServiceLineLike>(lines: readonly T[]): T[] {
  const out: T[] = [];
  for (const line of lines) {
    const quantity = line.quantity;
    const expandable =
      typeof quantity === 'number' && Number.isInteger(quantity) && quantity > 1 && quantity <= MAX_EXPANDED_QUANTITY;
    if (!expandable) {
      out.push(line);
      continue;
    }
    for (let i = 0; i < quantity; i++) {
      out.push(
        line.total === undefined
          ? { ...line, quantity: 1 }
          : { ...line, quantity: 1, total: serviceLineTotal({ price: line.price }) },
      );
    }
  }
  return out;
}
