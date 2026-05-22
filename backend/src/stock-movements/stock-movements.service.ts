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

    const { rows } = await client.query(
      'SELECT stock, warehouse_id FROM products WHERE id=$1 AND tenant_id=$2 FOR UPDATE',
      [dto.productId, tenantID],
    );
    const stockBefore = parseFloat(rows[0].stock) || 0;
    const productWarehouseId = rows[0].warehouse_id as string | null;

    // Source-stock model: the product belongs to one warehouse at a time
    // (multi-warehouse SKU split is out of scope for v1). A transfer is
    // valid only when the product currently lives in the source warehouse.
    if (productWarehouseId !== sourceWarehouseId) {
      throw new BadRequestException({ message: 'Товар не находится на исходном складе' });
    }

    // Reduce source stock; the same SKU now points to the target warehouse.
    const stockAfter = Math.max(stockBefore - qty, 0);
    await client.query('UPDATE products SET stock=$1, warehouse_id=$2 WHERE id=$3 AND tenant_id=$4', [
      stockAfter,
      targetWarehouseId,
      dto.productId,
      tenantID,
    ]);

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

    if (query.warehouseId) {
      where += ` AND sm.warehouse_id = $${idx++}`;
      params.push(query.warehouseId);
    }
    if (query.productId) {
      where += ` AND sm.product_id = $${idx++}`;
      params.push(query.productId);
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
