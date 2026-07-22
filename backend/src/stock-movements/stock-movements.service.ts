import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database.module';
import { WarehousesService, WarehouseKind } from '../warehouses/warehouses.service';

export type StockMovementType =
  | 'inventory'
  | 'writeoff'
  | 'income'
  | 'expense'
  | 'defect_transfer'
  | 'used_transfer'
  | 'defect_return_to_supplier';

const ALL_TYPES: StockMovementType[] = [
  'inventory',
  'writeoff',
  'income',
  'expense',
  'defect_transfer',
  'used_transfer',
  'defect_return_to_supplier',
];

// Мусор от битых клиентов (' ', 'undefined', 'null') в uuid-фильтрах раньше
// падал в pg 22P02 «invalid input syntax for type uuid» → 500 в Sentry
// (тот же класс, что был захарден в warehouse.service.resolveWarehouseId).
// Не-UUID трактуем как «фильтр не задан».
const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.trim());

interface CreateMovementDto {
  type: StockMovementType;
  productId: string;
  quantity: number;
  purchasePrice?: number;
  reason?: string;
  warehouseId?: string;
  sourceWarehouseId?: string;
  targetWarehouseId?: string;
  supplierId?: string;
  recordAsExpense?: boolean;
}

@Injectable()
export class StockMovementsService {
  private readonly logger = new Logger('StockMovementsService');

  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private warehouses: WarehousesService,
  ) {}

  private async assertProductInTenant(
    client: PoolClient,
    productId: string,
    tenantID: string,
  ): Promise<{
    id: string;
    tenant_id: string;
    warehouse_id: string | null;
    cost_price: number;
  }> {
    const { rows } = await client.query(
      'SELECT id, tenant_id, warehouse_id, cost_price FROM products WHERE id=$1 AND tenant_id=$2 LIMIT 1',
      [productId, tenantID],
    );
    if (rows.length === 0) {
      throw new BadRequestException({ message: 'Товар не найден' });
    }
    return rows[0];
  }

  private async assertSupplierInTenant(client: PoolClient, supplierId: string, tenantID: string): Promise<void> {
    const { rows } = await client.query('SELECT 1 FROM suppliers WHERE id=$1 AND tenant_id=$2 LIMIT 1', [
      supplierId,
      tenantID,
    ]);
    if (rows.length === 0) {
      throw new BadRequestException({ message: 'Поставщик не найден' });
    }
  }

  private async resolveWarehouse(
    client: PoolClient,
    tenantID: string,
    warehouseId: string | undefined,
    fallbackKind: WarehouseKind,
  ): Promise<string> {
    if (warehouseId) {
      const { rows } = await client.query('SELECT id FROM warehouses WHERE id=$1 AND tenant_id=$2 LIMIT 1', [
        warehouseId,
        tenantID,
      ]);
      if (rows.length === 0) throw new BadRequestException({ message: 'Склад не найден' });
      return rows[0].id;
    }
    const w = await this.warehouses.resolveByKind(tenantID, fallbackKind);
    return w.id;
  }

  private async getOrInsertExpenseCategory(client: PoolClient, tenantID: string, name: string): Promise<string> {
    const { rows } = await client.query('SELECT id FROM expense_categories WHERE tenant_id=$1 AND name=$2 LIMIT 1', [
      tenantID,
      name,
    ]);
    if (rows.length > 0) return rows[0].id;
    const { rows: ins } = await client.query(
      'INSERT INTO expense_categories (name, tenant_id) VALUES ($1, $2) RETURNING id',
      [name, tenantID],
    );
    return ins[0].id;
  }

  /**
   * Create a stock movement. The shape of the body depends on `type`:
   *
   *   inventory / income / expense / writeoff  → warehouseId (defaults to main)
   *   defect_transfer / used_transfer          → sourceWarehouseId + targetWarehouseId
   *   defect_return_to_supplier                → supplierId; warehouse fixed to "defect"
   *
   * For `writeoff` with `recordAsExpense=true` we also insert a row in
   * `expenses` (category "Списание со склада", auto-created if missing).
   * Everything happens inside one DB transaction so a failure rolls back
   * the stock change AND the linked expense.
   */
  async create(tenantID: string, userID: string | null, dto: CreateMovementDto) {
    if (!dto || !dto.type) {
      throw new BadRequestException({ message: 'Тип операции обязателен' });
    }
    if (!ALL_TYPES.includes(dto.type)) {
      throw new BadRequestException({ message: 'Неверный тип операции' });
    }
    if (!dto.productId) {
      throw new BadRequestException({ message: 'Товар обязателен' });
    }
    if (dto.quantity === undefined || dto.quantity === null) {
      throw new BadRequestException({ message: 'Количество обязательно' });
    }
    const qty = parseFloat(String(dto.quantity));
    if (!isFinite(qty) || qty <= 0) {
      throw new BadRequestException({ message: 'Количество должно быть положительным' });
    }
    // Reason is mandatory for any movement that ends up on the defect
    // warehouse — otherwise we lose the diagnostic trail. Checked early so
    // the caller never opens a transaction.
    const reason = (dto.reason ?? '').trim();
    if (dto.type === 'defect_transfer' && !reason) {
      throw new BadRequestException({ message: 'Укажите причину перемещения в брак' });
    }
    if (dto.type === 'defect_return_to_supplier' && !reason) {
      throw new BadRequestException({ message: 'Укажите причину возврата поставщику' });
    }
    // For arbitrary income/inventory/expense with explicit defect target
    // (unusual but possible via direct API), require reason too.
    if (dto.targetWarehouseId && dto.type !== 'defect_transfer') {
      const { rows } = await this.pool.query('SELECT kind FROM warehouses WHERE id=$1 AND tenant_id=$2 LIMIT 1', [
        dto.targetWarehouseId,
        tenantID,
      ]);
      if (rows[0]?.kind === 'defect' && !reason) {
        throw new BadRequestException({ message: 'Укажите причину для склада брака' });
      }
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const product = await this.assertProductInTenant(client, dto.productId, tenantID);
      const purchasePrice =
        dto.purchasePrice !== undefined && dto.purchasePrice !== null
          ? parseFloat(String(dto.purchasePrice))
          : parseFloat(String(product.cost_price)) || 0;

      let result: any;

      switch (dto.type) {
        case 'inventory':
        case 'income':
        case 'expense':
          result = await this.applySingleWarehouse(client, tenantID, userID, dto, qty, purchasePrice);
          break;
        case 'writeoff':
          result = await this.applyWriteoff(client, tenantID, userID, dto, qty, purchasePrice);
          break;
        case 'defect_transfer':
          result = await this.applyTransfer(client, tenantID, userID, dto, qty, purchasePrice, 'defect');
          break;
        case 'used_transfer':
          result = await this.applyTransfer(client, tenantID, userID, dto, qty, purchasePrice, 'used');
          break;
        case 'defect_return_to_supplier':
          result = await this.applyDefectReturn(client, tenantID, userID, dto, qty, purchasePrice);
          break;
      }

      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      if (err instanceof BadRequestException || err instanceof NotFoundException) throw err;
      this.logger.error(`Stock movement error: ${err}`);
      throw new InternalServerErrorException({ message: 'Ошибка сервера' });
    } finally {
      client.release();
    }
  }

  /**
   * Transaction-aware income — increments product stock and writes the EXACT same
   * `income` stock_movement a manual receiving produces, but runs on a
   * CALLER-OWNED PoolClient/transaction instead of opening its own.
   *
   * This is the reuse seam for Purchase-Order receiving: the PO status flip and
   * every per-item stock income must commit (or roll back) together, which is
   * impossible through the public `create()` — that method BEGIN/COMMITs
   * internally and would commit the income before the PO row is even touched.
   *
   * The stock math is NOT forked: it delegates to the very same private
   * `applySingleWarehouse` helper that `create({ type: 'income' })` uses, so
   * cost/stock behave identically to manual receiving (income adjusts stock
   * only, never cost_price). The optional `supplierId` is linked onto the
   * resulting movement row (stock_movements.supplier_id) so the journal can
   * attribute the receipt to its supplier.
   *
   * Caller MUST already have an open transaction on `client`. This method never
   * issues BEGIN / COMMIT / ROLLBACK itself.
   */
  async applyIncomeTx(
    client: PoolClient,
    tenantID: string,
    userID: string | null,
    params: {
      productId: string;
      quantity: number;
      purchasePrice?: number;
      warehouseId?: string;
      supplierId?: string;
      reason?: string;
    },
  ): Promise<{ id: string; stockAfter: number; warehouseId: string }> {
    if (!params?.productId) {
      throw new BadRequestException({ message: 'Товар обязателен' });
    }
    const qty = parseFloat(String(params.quantity));
    if (!isFinite(qty) || qty <= 0) {
      throw new BadRequestException({ message: 'Количество должно быть положительным' });
    }

    const product = await this.assertProductInTenant(client, params.productId, tenantID);
    const purchasePrice =
      params.purchasePrice !== undefined && params.purchasePrice !== null
        ? parseFloat(String(params.purchasePrice))
        : parseFloat(String(product.cost_price)) || 0;

    // Record the movement on the product's own warehouse by default (mirrors the
    // /products/:id/stock manual income path); `applySingleWarehouse` falls back
    // to the tenant's "main" warehouse when this is undefined.
    const warehouseId = params.warehouseId ?? product.warehouse_id ?? undefined;

    const result = await this.applySingleWarehouse(
      client,
      tenantID,
      userID,
      { type: 'income', productId: params.productId, quantity: qty, warehouseId, reason: params.reason },
      qty,
      purchasePrice,
    );

    // Link the income movement to its supplier (the income INSERT in
    // applySingleWarehouse intentionally has no supplier column in its param
    // list; we attach it here without forking the stock math).
    if (params.supplierId) {
      await client.query('UPDATE stock_movements SET supplier_id=$1 WHERE id=$2 AND tenant_id=$3', [
        params.supplierId,
        result.id,
        tenantID,
      ]);
    }

    return { id: result.id, stockAfter: result.stockAfter, warehouseId: result.warehouseId };
  }

  // ── inventory / income / expense ────────────────────────────────────────
  // `_purchasePrice` is accepted to match the signature of the other apply*
  // helpers (so the switch-case in `create()` stays clean) but the
  // single-warehouse types never need it — stock-only moves do not adjust
  // any monetary ledger.
  private async applySingleWarehouse(
    client: PoolClient,
    tenantID: string,
    userID: string | null,
    dto: CreateMovementDto,
    qty: number,
    _purchasePrice: number,
  ) {
    const warehouseId = await this.resolveWarehouse(client, tenantID, dto.warehouseId, 'main');

    // FOR UPDATE on products row so concurrent stock updates serialise.
    const { rows } = await client.query('SELECT stock FROM products WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [
      dto.productId,
      tenantID,
    ]);
    const stockBefore = parseFloat(rows[0].stock) || 0;

    let stockAfter: number;
    switch (dto.type) {
      case 'income':
        stockAfter = stockBefore + qty;
        break;
      case 'expense':
        stockAfter = Math.max(stockBefore - qty, 0);
        break;
      case 'inventory':
        stockAfter = qty;
        break;
      default:
        throw new BadRequestException({ message: 'Неверный тип' });
    }

    await client.query('UPDATE products SET stock=$1 WHERE id=$2 AND tenant_id=$3', [
      stockAfter,
      dto.productId,
      tenantID,
    ]);

    const { rows: mvRows } = await client.query(
      `INSERT INTO stock_movements (
         product_id, type, quantity, stock_before, stock_after, reason,
         tenant_id, user_id, warehouse_id, record_as_expense
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false)
       RETURNING id`,
      [dto.productId, dto.type, qty, stockBefore, stockAfter, dto.reason ?? null, tenantID, userID, warehouseId],
    );

    return { id: mvRows[0].id, type: dto.type, stockAfter, warehouseId };
  }

  // ── writeoff (optionally booked as expense) ────────────────────────────
  private async applyWriteoff(
    client: PoolClient,
    tenantID: string,
    userID: string | null,
    dto: CreateMovementDto,
    qty: number,
    purchasePrice: number,
  ) {
    const warehouseId = await this.resolveWarehouse(client, tenantID, dto.warehouseId, 'main');
    const recordAsExpense = !!dto.recordAsExpense;

    const { rows } = await client.query('SELECT stock FROM products WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [
      dto.productId,
      tenantID,
    ]);
    const stockBefore = parseFloat(rows[0].stock) || 0;
    const stockAfter = Math.max(stockBefore - qty, 0);

    await client.query('UPDATE products SET stock=$1 WHERE id=$2 AND tenant_id=$3', [
      stockAfter,
      dto.productId,
      tenantID,
    ]);

    let linkedExpenseId: string | null = null;
    if (recordAsExpense) {
      const categoryId = await this.getOrInsertExpenseCategory(client, tenantID, 'Списание со склада');
      const amount = qty * purchasePrice;
      const { rows: expRows } = await client.query(
        `INSERT INTO expenses (category_id, amount, description, date, user_id, tenant_id)
         VALUES ($1,$2,$3,now(),$4,$5) RETURNING id`,
        [categoryId, amount, dto.reason ?? 'Списание со склада', userID, tenantID],
      );
      linkedExpenseId = expRows[0].id;
    }

    const { rows: mvRows } = await client.query(
      `INSERT INTO stock_movements (
         product_id, type, quantity, stock_before, stock_after, reason,
         tenant_id, user_id, warehouse_id, record_as_expense, linked_expense_id
       ) VALUES ($1,'writeoff',$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        dto.productId,
        qty,
        stockBefore,
        stockAfter,
        dto.reason ?? null,
        tenantID,
        userID,
        warehouseId,
        recordAsExpense,
        linkedExpenseId,
      ],
    );

    return {
      id: mvRows[0].id,
      type: 'writeoff' as const,
      stockAfter,
      warehouseId,
      recordAsExpense,
      linkedExpenseId,
    };
  }

  // ── defect_transfer / used_transfer ────────────────────────────────────
  private async applyTransfer(
    client: PoolClient,
    tenantID: string,
    userID: string | null,
    dto: CreateMovementDto,
    qty: number,
    purchasePrice: number,
    targetKind: 'defect' | 'used',
  ) {
    const sourceWarehouseId = await this.resolveWarehouse(client, tenantID, dto.sourceWarehouseId, 'main');
    const targetWarehouseId = await this.resolveWarehouse(client, tenantID, dto.targetWarehouseId, targetKind);

    if (sourceWarehouseId === targetWarehouseId) {
      throw new BadRequestException({ message: 'Склад источника и приёма должны отличаться' });
    }

    // NEW-4 (защита от взаимоблокировки): перевод лочит строку-источник, затем
    // строку-копию того же SKU на приёмнике. Фиксированный порядок источник→
    // приёмник конфликтует с путём продажи чека / другими перемещениями, где те
    // же две строки могут лочиться в обратном порядке → deadlock 40P01 →
    // перемежающийся 500. Лочим ОБЕ строки заранее ОДНИМ оператором в
    // детерминированном ГЛОБАЛЬНОМ порядке (по возрастанию id): `SELECT ... IN
    // (...) ORDER BY id FOR UPDATE` — LockRows над Sort берёт блокировки в
    // порядке сортировки. Дальнейшие FOR UPDATE-чтения ниже лишь пере-лочат уже
    // удерживаемые строки (no-op), поэтому порядок захвата фиксирован. Имя/ед.
    // источника читаем БЕЗ блокировки только чтобы найти копию; авторитетные
    // значения берутся из блокирующего чтения ниже. Строку-копию, созданную
    // INSERT'ом в этой же транзакции, лочить не нужно — она приватна до COMMIT.
    const { rows: peekRows } = await client.query(
      'SELECT name, unit FROM products WHERE id=$1 AND tenant_id=$2 LIMIT 1',
      [dto.productId, tenantID],
    );
    if (peekRows.length > 0) {
      const { rows: copyRows } = await client.query(
        `SELECT id FROM products
          WHERE tenant_id=$1 AND warehouse_id=$2 AND name=$3 AND unit IS NOT DISTINCT FROM $4
            AND deleted_at IS NULL AND id <> $5`,
        [tenantID, targetWarehouseId, peekRows[0].name, peekRows[0].unit, dto.productId],
      );
      const lockIds = [dto.productId, ...copyRows.map((r) => r.id as string)];
      await client.query(`SELECT id FROM products WHERE id = ANY($1::uuid[]) AND tenant_id=$2 ORDER BY id FOR UPDATE`, [
        lockIds,
        tenantID,
      ]);
    }

    const { rows } = await client.query(
      'SELECT stock, warehouse_id, name, unit FROM products WHERE id=$1 AND tenant_id=$2 FOR UPDATE',
      [dto.productId, tenantID],
    );
    const stockBefore = parseFloat(rows[0].stock) || 0;
    const productWarehouseId = rows[0].warehouse_id as string | null;

    // Source-stock model: a product ROW belongs to one warehouse at a time.
    // A transfer is valid only when the product currently lives in the source
    // warehouse and holds enough stock to cover the transferred qty.
    if (productWarehouseId !== sourceWarehouseId) {
      throw new BadRequestException({ message: 'Товар не находится на исходном складе' });
    }
    if (qty > stockBefore) {
      throw new BadRequestException({ message: 'На исходном складе недостаточно товара' });
    }

    // Transfer semantics (fix 2026-07): the TRANSFERRED qty arrives on the
    // target warehouse; the remainder STAYS on the source. Before this fix the
    // row was pointed at the target with stock = stockBefore - qty, which
    // displayed the remaining GOOD units on брак/Б-У and erased the transferred
    // units from the books (a full transfer landed on брак with stock = 0,
    // making defect_return_to_supplier impossible).
    //   • full transfer (qty == stock) → the row itself moves, stock unchanged;
    //   • partial transfer → the source row keeps the remainder; the moved qty
    //     lands on a separate row of the same SKU on the target warehouse
    //     (matched by name + unit, created as a copy when missing).
    // `stockAfter` is the SOURCE-side remainder — the movement row below always
    // describes the source warehouse (было → осталось на исходном).
    const stockAfter = stockBefore - qty;
    let targetProductId: string = dto.productId;
    if (stockAfter === 0) {
      await client.query('UPDATE products SET warehouse_id=$1 WHERE id=$2 AND tenant_id=$3', [
        targetWarehouseId,
        dto.productId,
        tenantID,
      ]);
    } else {
      await client.query('UPDATE products SET stock=$1 WHERE id=$2 AND tenant_id=$3', [
        stockAfter,
        dto.productId,
        tenantID,
      ]);
      const { rows: targetRows } = await client.query(
        `SELECT id, stock FROM products
          WHERE tenant_id=$1 AND warehouse_id=$2 AND name=$3 AND unit IS NOT DISTINCT FROM $4
            AND deleted_at IS NULL AND id <> $5
          ORDER BY created_at LIMIT 1 FOR UPDATE`,
        [tenantID, targetWarehouseId, rows[0].name, rows[0].unit, dto.productId],
      );
      if (targetRows.length > 0) {
        targetProductId = targetRows[0].id;
        const targetStockAfter = (parseFloat(targetRows[0].stock) || 0) + qty;
        await client.query('UPDATE products SET stock=$1 WHERE id=$2 AND tenant_id=$3', [
          targetStockAfter,
          targetProductId,
          tenantID,
        ]);
      } else {
        // Copy the SKU onto the target warehouse. min_stock = 0 on the copy —
        // брак/Б-У stock must never ring low-stock alerts.
        const { rows: insRows } = await client.query(
          `INSERT INTO products (name, category, photo, cost_price, sell_price, stock, min_stock, unit,
                                 is_bundle, bundle_items, supplier_id, tenant_id, warehouse_id, warranty_days, barcode)
           SELECT name, category, photo, cost_price, sell_price, $3, 0, unit,
                  is_bundle, bundle_items, supplier_id, tenant_id, $4, warranty_days, barcode
             FROM products WHERE id=$1 AND tenant_id=$2
           RETURNING id`,
          [dto.productId, tenantID, qty, targetWarehouseId],
        );
        targetProductId = insRows[0].id;
      }
    }

    const { rows: mvRows } = await client.query(
      `INSERT INTO stock_movements (
         product_id, type, quantity, stock_before, stock_after, reason,
         tenant_id, user_id, warehouse_id, source_warehouse_id, target_warehouse_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [
        dto.productId,
        targetKind === 'defect' ? 'defect_transfer' : 'used_transfer',
        qty,
        stockBefore,
        stockAfter,
        dto.reason ?? null,
        tenantID,
        userID,
        targetWarehouseId,
        sourceWarehouseId,
        targetWarehouseId,
      ],
    );

    return {
      id: mvRows[0].id,
      type: targetKind === 'defect' ? ('defect_transfer' as const) : ('used_transfer' as const),
      stockAfter,
      sourceWarehouseId,
      targetWarehouseId,
      targetProductId,
    };
  }

  // ── defect_return_to_supplier ──────────────────────────────────────────
  private async applyDefectReturn(
    client: PoolClient,
    tenantID: string,
    userID: string | null,
    dto: CreateMovementDto,
    qty: number,
    purchasePrice: number,
  ) {
    if (!dto.supplierId) {
      throw new BadRequestException({ message: 'Поставщик обязателен' });
    }
    await this.assertSupplierInTenant(client, dto.supplierId, tenantID);

    const defectWarehouse = await this.warehouses.resolveByKind(tenantID, 'defect');

    const { rows } = await client.query(
      'SELECT stock, warehouse_id FROM products WHERE id=$1 AND tenant_id=$2 FOR UPDATE',
      [dto.productId, tenantID],
    );
    const stockBefore = parseFloat(rows[0].stock) || 0;
    const currentWarehouseId = rows[0].warehouse_id as string | null;

    if (currentWarehouseId !== defectWarehouse.id) {
      throw new BadRequestException({ message: 'Товар не находится на складе брака' });
    }
    if (stockBefore < qty) {
      throw new BadRequestException({ message: 'На складе брака недостаточно товара' });
    }

    const stockAfter = stockBefore - qty;
    await client.query('UPDATE products SET stock=$1 WHERE id=$2 AND tenant_id=$3', [
      stockAfter,
      dto.productId,
      tenantID,
    ]);

    // Decrement supplier debt by qty * purchasePrice. Mirror of supplier
    // payment side effects: total_paid grows, current_debt shrinks.
    const amount = qty * purchasePrice;
    await client.query(
      `UPDATE suppliers SET total_paid = total_paid + $1, current_debt = current_debt - $1
        WHERE id = $2 AND tenant_id = $3`,
      [amount, dto.supplierId, tenantID],
    );

    // Also record a virtual payment row so the supplier ledger has a
    // matching entry (cash-flow style audit).
    await client.query(
      `INSERT INTO supplier_payments (supplier_id, amount, date, comment, tenant_id)
       VALUES ($1, $2, now(), $3, $4)`,
      [dto.supplierId, amount, dto.reason ? `Возврат брака: ${dto.reason}` : 'Возврат брака поставщику', tenantID],
    );

    const { rows: mvRows } = await client.query(
      `INSERT INTO stock_movements (
         product_id, type, quantity, stock_before, stock_after, reason,
         tenant_id, user_id, warehouse_id, supplier_id
       ) VALUES ($1,'defect_return_to_supplier',$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id`,
      [
        dto.productId,
        qty,
        stockBefore,
        stockAfter,
        dto.reason ?? null,
        tenantID,
        userID,
        defectWarehouse.id,
        dto.supplierId,
      ],
    );

    return {
      id: mvRows[0].id,
      type: 'defect_return_to_supplier' as const,
      stockAfter,
      warehouseId: defectWarehouse.id,
      supplierId: dto.supplierId,
      debtAdjustment: amount,
    };
  }

  // ── listing ────────────────────────────────────────────────────────────
  async list(
    tenantID: string,
    query: { warehouseId?: string; productId?: string; type?: string; dateFrom?: string; dateTo?: string },
  ) {
    let where = 'sm.tenant_id = $1';
    const params: any[] = [tenantID];
    let idx = 2;

    if (isUuid(query.warehouseId)) {
      where += ` AND sm.warehouse_id = $${idx++}`;
      params.push(query.warehouseId.trim());
    }
    if (isUuid(query.productId)) {
      where += ` AND sm.product_id = $${idx++}`;
      params.push(query.productId.trim());
    }
    if (query.type) {
      where += ` AND sm.type = $${idx++}`;
      params.push(query.type);
    }
    if (query.dateFrom) {
      where += ` AND sm.created_at >= $${idx++}`;
      params.push(query.dateFrom);
    }
    if (query.dateTo) {
      where += ` AND sm.created_at <= $${idx++}`;
      params.push(query.dateTo);
    }

    const { rows } = await this.pool.query(
      `SELECT sm.*, p.name as product_name, u.full_name as user_name,
              w.name as warehouse_name, sw.name as source_name, tw.name as target_name,
              s.name as supplier_name
         FROM stock_movements sm
         JOIN products p ON p.id = sm.product_id
         LEFT JOIN users u ON u.id = sm.user_id
         LEFT JOIN warehouses w  ON w.id  = sm.warehouse_id
         LEFT JOIN warehouses sw ON sw.id = sm.source_warehouse_id
         LEFT JOIN warehouses tw ON tw.id = sm.target_warehouse_id
         LEFT JOIN suppliers  s  ON s.id  = sm.supplier_id
        WHERE ${where}
        ORDER BY sm.created_at DESC LIMIT 200`,
      params,
    );

    return rows.map((row) => ({
      id: row.id,
      productId: row.product_id,
      product: { id: row.product_id, name: row.product_name },
      type: row.type,
      quantity: parseFloat(row.quantity) || 0,
      stockBefore: parseFloat(row.stock_before) || 0,
      stockAfter: parseFloat(row.stock_after) || 0,
      reason: row.reason,
      userId: row.user_id,
      user: row.user_id ? { id: row.user_id, fullName: row.user_name } : null,
      warehouseId: row.warehouse_id ?? null,
      warehouseName: row.warehouse_name ?? null,
      sourceWarehouseId: row.source_warehouse_id ?? null,
      sourceWarehouseName: row.source_name ?? null,
      targetWarehouseId: row.target_warehouse_id ?? null,
      targetWarehouseName: row.target_name ?? null,
      supplierId: row.supplier_id ?? null,
      supplierName: row.supplier_name ?? null,
      recordAsExpense: !!row.record_as_expense,
      linkedExpenseId: row.linked_expense_id ?? null,
      // 034_used_purchase_movement_flag.sql adds this column. The journal
      // (mobile + web) keys off it to render "Покупка Б/У" specially.
      isUsedPurchase: !!row.is_used_purchase,
      createdAt: row.created_at,
    }));
  }
}
