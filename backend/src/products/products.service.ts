import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { parseFields, filterShape } from '../common/field-filter';

@Injectable()
export class ProductsService {
  private readonly logger = new Logger('ProductsService');

  constructor(@Inject(PG_POOL) private pool: Pool) {}

  private mapProduct(row: any) {
    const p: any = {
      id: row.id,
      name: row.name,
      category: row.category,
      photo: row.photo,
      costPrice: parseFloat(row.cost_price) || 0,
      sellPrice: parseFloat(row.sell_price) || 0,
      stock: parseFloat(row.stock) || 0,
      minStock: parseFloat(row.min_stock) || 0,
      unit: row.unit || 'pcs',
      isBundle: row.is_bundle || false,
      bundleItems: row.bundle_items || [],
      supplierId: row.supplier_id,
      warehouseId: row.warehouse_id ?? null,
      warrantyDays: row.warranty_days !== null && row.warranty_days !== undefined ? parseInt(row.warranty_days) : null,
      barcode: row.barcode ?? null,
      createdAt: row.created_at,
    };
    if (row.supplier_name) {
      p.supplier = { id: row.supplier_id, name: row.supplier_name };
    }
    return p;
  }

  /**
   * Resolve the warehouse id we should assign to a product write.
   *
   *   - explicit warehouseId from caller → verify it lives in tenant;
   *   - null / undefined → fall back to the tenant's "main" warehouse.
   *
   * Returns the resolved id or throws BadRequest for a foreign / unknown
   * warehouse. `forCreate=true` additionally rejects direct creation on
   * the defect warehouse (you can only land there via a defect transfer
   * / return).
   */
  private async resolveWarehouseId(
    tenantID: string,
    warehouseId?: string | null,
    opts: { forCreate?: boolean } = {},
  ): Promise<string | null> {
    if (warehouseId) {
      const { rows } = await this.pool.query(
        'SELECT id, kind FROM warehouses WHERE id=$1 AND tenant_id=$2 LIMIT 1',
        [warehouseId, tenantID],
      );
      if (rows.length === 0) {
        throw new BadRequestException({ message: 'Склад не найден' });
      }
      if (opts.forCreate && rows[0].kind === 'defect') {
        throw new BadRequestException({ message: 'Нельзя добавлять товары напрямую в склад брака' });
      }
      return rows[0].id;
    }
    const { rows } = await this.pool.query(`SELECT id FROM warehouses WHERE tenant_id=$1 AND kind='main' LIMIT 1`, [
      tenantID,
    ]);
    return rows.length > 0 ? rows[0].id : null;
  }

  async getAll(tenantID: string, query: any) {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 100;
    const offset = (page - 1) * limit;
    const search = query.search || '';

    let where = 'p.tenant_id = $1 AND p.deleted_at IS NULL';
    const params: any[] = [tenantID];
    let idx = 2;

    if (search) {
      where += ` AND (p.name ILIKE $${idx} OR p.barcode ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    // Default the product list to the "main" warehouse so existing clients
    // (which don't pass a warehouseId yet) keep seeing the same data. The
    // FE can opt-in to other warehouses by setting `warehouseId=...`.
    // `warehouseId=all` short-circuits the filter entirely.
    if (query.warehouseId && query.warehouseId !== 'all') {
      where += ` AND p.warehouse_id = $${idx}`;
      params.push(query.warehouseId);
      idx++;
    } else if (!query.warehouseId) {
      where += ` AND p.warehouse_id = (SELECT id FROM warehouses WHERE tenant_id = $1 AND kind = 'main' LIMIT 1)`;
    }

    const countResult = await this.pool.query(`SELECT COUNT(*) as total FROM products p WHERE ${where}`, params);
    const total = parseInt(countResult.rows[0].total);

    params.push(limit, offset);
    const { rows } = await this.pool.query(
      `SELECT p.*, s.name as supplier_name
       FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id
       WHERE ${where} ORDER BY p.name LIMIT $${idx} OFFSET $${idx + 1}`,
      params,
    );

    // Slim payload for list responses unless explicit fields were requested.
    // `description` and `notes` are not on the products table today, but
    // future migrations might add them; the FE can already pass `fields=`
    // to opt-in to specific subsets. Caller passes `?fields=*` (or omits
    // entirely) to get the full mapping for backwards compatibility.
    const fields = parseFields(query.fields);
    const data = rows.map((r) => filterShape(this.mapProduct(r), fields));
    return { data, total, page, limit };
  }

  async getLowStock(tenantID: string) {
    const { rows } = await this.pool.query(
      `SELECT p.*, s.name as supplier_name
       FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id
       WHERE p.tenant_id = $1 AND p.deleted_at IS NULL
         AND p.stock <= p.min_stock AND p.min_stock > 0
       ORDER BY p.name`,
      [tenantID],
    );
    return rows.map(this.mapProduct);
  }

  async getMovements(tenantID: string, query?: { masterId?: string; dateFrom?: string; dateTo?: string }) {
    let where = 'sm.tenant_id = $1';
    const params: any[] = [tenantID];
    let idx = 2;

    if (query?.masterId) {
      where += ` AND sm.user_id = $${idx}`;
      params.push(query.masterId);
      idx++;
    }
    if (query?.dateFrom) {
      where += ` AND sm.created_at >= $${idx}`;
      params.push(query.dateFrom);
      idx++;
    }
    if (query?.dateTo) {
      where += ` AND sm.created_at <= $${idx}`;
      params.push(query.dateTo);
      idx++;
    }

    const { rows } = await this.pool.query(
      `SELECT sm.*, p.name as product_name, u.full_name as user_name
       FROM stock_movements sm
       JOIN products p ON p.id = sm.product_id
       LEFT JOIN users u ON u.id = sm.user_id
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
      createdAt: row.created_at,
    }));
  }

  async getWarehouseStats(tenantID: string) {
    const { rows } = await this.pool.query(
      `SELECT
         COALESCE(SUM(cost_price * stock), 0) as total_cost_value,
         COALESCE(SUM(sell_price * stock), 0) as total_sell_value,
         COALESCE(SUM(stock), 0) as total_items
       FROM products WHERE tenant_id = $1 AND deleted_at IS NULL`,
      [tenantID],
    );

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
    const lastMonthEnd = monthStart;

    const { rows: mcRows } = await this.pool.query(
      `SELECT COALESCE(SUM(product_cost_total), 0) as month_cost
       FROM checks WHERE tenant_id=$1 AND date >= $2 AND is_deferred=false`,
      [tenantID, monthStart],
    );

    const { rows: lmcRows } = await this.pool.query(
      `SELECT COALESCE(SUM(product_cost_total), 0) as last_month_cost
       FROM checks WHERE tenant_id=$1 AND date >= $2 AND date < $3 AND is_deferred=false`,
      [tenantID, lastMonthStart, lastMonthEnd],
    );

    return {
      totalCostValue: parseFloat(rows[0].total_cost_value) || 0,
      totalSellValue: parseFloat(rows[0].total_sell_value) || 0,
      totalItems: parseFloat(rows[0].total_items) || 0,
      monthProductCost: parseFloat(mcRows[0].month_cost) || 0,
      lastMonthProductCost: parseFloat(lmcRows[0].last_month_cost) || 0,
    };
  }

  async getById(id: string, tenantID: string) {
    const { rows } = await this.pool.query(
      `SELECT p.*, s.name as supplier_name
       FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id
       WHERE p.id=$1 AND p.tenant_id=$2 AND p.deleted_at IS NULL`,
      [id, tenantID],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Товар не найден' });
    return this.mapProduct(rows[0]);
  }

  async create(tenantID: string, dto: any) {
    // If a supplier is referenced, it must belong to the caller's tenant.
    if (dto.supplierId) {
      await this.assertSupplierInTenant(dto.supplierId, tenantID);
    }
    const warehouseId = await this.resolveWarehouseId(tenantID, dto.warehouseId, { forCreate: true });
    const warrantyDays = this.normalizeWarrantyDays(dto.warrantyDays);
    const { rows } = await this.pool.query(
      `INSERT INTO products (name, category, photo, cost_price, sell_price, stock, min_stock, unit, is_bundle, bundle_items, supplier_id, tenant_id, warehouse_id, warranty_days, barcode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING *`,
      [
        dto.name,
        dto.category,
        dto.photo,
        dto.costPrice || 0,
        dto.sellPrice || 0,
        dto.stock || 0,
        dto.minStock || 0,
        dto.unit || 'pcs',
        dto.isBundle || false,
        JSON.stringify(dto.bundleItems || []),
        dto.supplierId,
        tenantID,
        warehouseId,
        warrantyDays,
        dto.barcode ?? null,
      ],
    );
    return this.mapProduct(rows[0]);
  }

  private normalizeWarrantyDays(value: unknown): number | null {
    if (value === undefined || value === null || value === '') return null;
    const n = parseInt(String(value), 10);
    if (!Number.isFinite(n)) return null;
    if (n <= 0) return null;
    return Math.min(n, 36500); // ~100 years guard
  }

  private async assertSupplierInTenant(supplierId: string, tenantID: string): Promise<void> {
    const { rows } = await this.pool.query('SELECT 1 FROM suppliers WHERE id = $1 AND tenant_id = $2 LIMIT 1', [
      supplierId,
      tenantID,
    ]);
    if (rows.length === 0) {
      throw new BadRequestException({ message: 'Поставщик не найден' });
    }
  }

  async update(id: string, tenantID: string, dto: any, userID?: string) {
    if (dto.supplierId !== undefined && dto.supplierId !== null) {
      await this.assertSupplierInTenant(dto.supplierId, tenantID);
    }

    // Get current prices before update for price history
    const { rows: current } = await this.pool.query(
      'SELECT cost_price, sell_price FROM products WHERE id=$1 AND tenant_id=$2',
      [id, tenantID],
    );

    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (dto.name !== undefined) {
      sets.push(`name=$${idx++}`);
      vals.push(dto.name);
    }
    if (dto.category !== undefined) {
      sets.push(`category=$${idx++}`);
      vals.push(dto.category);
    }
    if (dto.photo !== undefined) {
      sets.push(`photo=$${idx++}`);
      vals.push(dto.photo);
    }
    if (dto.costPrice !== undefined) {
      sets.push(`cost_price=$${idx++}`);
      vals.push(dto.costPrice);
    }
    if (dto.sellPrice !== undefined) {
      sets.push(`sell_price=$${idx++}`);
      vals.push(dto.sellPrice);
    }
    if (dto.stock !== undefined) {
      sets.push(`stock=$${idx++}`);
      vals.push(dto.stock);
    }
    if (dto.minStock !== undefined) {
      sets.push(`min_stock=$${idx++}`);
      vals.push(dto.minStock);
    }
    if (dto.unit !== undefined) {
      sets.push(`unit=$${idx++}`);
      vals.push(dto.unit);
    }
    if (dto.isBundle !== undefined) {
      sets.push(`is_bundle=$${idx++}`);
      vals.push(dto.isBundle);
    }
    if (dto.bundleItems !== undefined) {
      sets.push(`bundle_items=$${idx++}`);
      vals.push(JSON.stringify(dto.bundleItems));
    }
    if (dto.supplierId !== undefined) {
      sets.push(`supplier_id=$${idx++}`);
      vals.push(dto.supplierId);
    }
    if (dto.warehouseId !== undefined) {
      const resolved = await this.resolveWarehouseId(tenantID, dto.warehouseId);
      sets.push(`warehouse_id=$${idx++}`);
      vals.push(resolved);
    }
    if (dto.warrantyDays !== undefined) {
      sets.push(`warranty_days=$${idx++}`);
      vals.push(this.normalizeWarrantyDays(dto.warrantyDays));
    }
    if (dto.barcode !== undefined) {
      sets.push(`barcode=$${idx++}`);
      vals.push(dto.barcode ?? null);
    }

    if (sets.length === 0) return this.getById(id, tenantID);

    vals.push(id, tenantID);
    const { rows } = await this.pool.query(
      `UPDATE products SET ${sets.join(', ')} WHERE id=$${idx++} AND tenant_id=$${idx} RETURNING *`,
      vals,
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Товар не найден' });

    // Track price changes
    if (current.length > 0) {
      const oldCost = parseFloat(current[0].cost_price) || 0;
      const oldSell = parseFloat(current[0].sell_price) || 0;
      const newCost = dto.costPrice !== undefined ? parseFloat(dto.costPrice) : oldCost;
      const newSell = dto.sellPrice !== undefined ? parseFloat(dto.sellPrice) : oldSell;
      if (oldCost !== newCost || oldSell !== newSell) {
        await this.pool.query(
          `INSERT INTO price_history (product_id, cost_price_before, cost_price_after, sell_price_before, sell_price_after, user_id, tenant_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, oldCost, newCost, oldSell, newSell, userID || null, tenantID],
        );
      }
    }

    return this.mapProduct(rows[0]);
  }

  /**
   * Set just the sell price of a product. Lightweight endpoint used by the
   * used-purchase flow where the product is initially created with sell_price
   * defaulted to the purchase price (sell price unknown at intake time) and
   * needs to be set later when the owner decides what to charge.
   */
  async setSellPrice(id: string, tenantID: string, sellPrice: number, userID?: string) {
    if (sellPrice === undefined || sellPrice === null) {
      throw new BadRequestException({ message: 'Цена продажи обязательна' });
    }
    const numeric = parseFloat(String(sellPrice));
    if (!isFinite(numeric) || numeric < 0) {
      throw new BadRequestException({ message: 'Неверная цена' });
    }

    const { rows: current } = await this.pool.query(
      'SELECT cost_price, sell_price FROM products WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL',
      [id, tenantID],
    );
    if (current.length === 0) {
      throw new NotFoundException({ message: 'Товар не найден' });
    }

    const oldCost = parseFloat(current[0].cost_price) || 0;
    const oldSell = parseFloat(current[0].sell_price) || 0;

    const { rows } = await this.pool.query(
      `UPDATE products SET sell_price=$1 WHERE id=$2 AND tenant_id=$3 RETURNING *`,
      [numeric, id, tenantID],
    );

    if (oldSell !== numeric) {
      await this.pool.query(
        `INSERT INTO price_history (product_id, cost_price_before, cost_price_after, sell_price_before, sell_price_after, user_id, tenant_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, oldCost, oldCost, oldSell, numeric, userID || null, tenantID],
      );
    }

    return this.mapProduct(rows[0]);
  }

  async getProductMovements(productId: string, tenantID: string) {
    const { rows } = await this.pool.query(
      `SELECT sm.*, u.full_name as user_name
       FROM stock_movements sm
       LEFT JOIN users u ON u.id = sm.user_id
       WHERE sm.product_id = $1 AND sm.tenant_id = $2
       ORDER BY sm.created_at DESC LIMIT 50`,
      [productId, tenantID],
    );
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      quantity: parseFloat(row.quantity) || 0,
      stockBefore: parseFloat(row.stock_before) || 0,
      stockAfter: parseFloat(row.stock_after) || 0,
      reason: row.reason,
      userId: row.user_id,
      user: row.user_id ? { id: row.user_id, fullName: row.user_name } : null,
      createdAt: row.created_at,
    }));
  }

  async getProductPriceHistory(productId: string, tenantID: string) {
    const { rows } = await this.pool.query(
      `SELECT ph.*, u.full_name as user_name
       FROM price_history ph
       LEFT JOIN users u ON u.id = ph.user_id
       WHERE ph.product_id = $1 AND ph.tenant_id = $2
       ORDER BY ph.created_at DESC LIMIT 50`,
      [productId, tenantID],
    );
    return rows.map((row) => ({
      id: row.id,
      costPriceBefore: parseFloat(row.cost_price_before) || 0,
      costPriceAfter: parseFloat(row.cost_price_after) || 0,
      sellPriceBefore: parseFloat(row.sell_price_before) || 0,
      sellPriceAfter: parseFloat(row.sell_price_after) || 0,
      user: row.user_id ? { id: row.user_id, fullName: row.user_name } : null,
      createdAt: row.created_at,
    }));
  }

  // Soft delete — moves to trash. The row stays in the table; checks that
  // reference this product keep working because check_product_lines stores
  // a snapshot (name + prices) at the time of sale.
  async remove(id: string, tenantID: string) {
    const result = await this.pool.query(
      'UPDATE products SET deleted_at = NOW() WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL',
      [id, tenantID],
    );
    if (result.rowCount === 0) {
      // Already trashed or doesn't exist — keep idempotent
      return { message: 'Уже в корзине' };
    }
    return { message: 'Перемещено в корзину' };
  }

  // List items currently in trash, newest first.
  async getTrash(tenantID: string) {
    const { rows } = await this.pool.query(
      `SELECT p.*, s.name as supplier_name
       FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id
       WHERE p.tenant_id = $1 AND p.deleted_at IS NOT NULL
       ORDER BY p.deleted_at DESC`,
      [tenantID],
    );
    return rows.map(this.mapProduct);
  }

  async restore(id: string, tenantID: string) {
    const result = await this.pool.query(
      'UPDATE products SET deleted_at = NULL WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NOT NULL',
      [id, tenantID],
    );
    if (result.rowCount === 0) {
      throw new NotFoundException({ message: 'Товар не найден в корзине' });
    }
    return { message: 'Восстановлено' };
  }

  // Permanently delete a single trashed item.
  async hardDelete(id: string, tenantID: string) {
    const result = await this.pool.query(
      'DELETE FROM products WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NOT NULL',
      [id, tenantID],
    );
    if (result.rowCount === 0) {
      throw new NotFoundException({ message: 'Товар не найден в корзине' });
    }
    return { message: 'Удалено навсегда' };
  }

  // Drain the trash. Only ever touches rows with deleted_at IS NOT NULL.
  async emptyTrash(tenantID: string) {
    const result = await this.pool.query('DELETE FROM products WHERE tenant_id=$1 AND deleted_at IS NOT NULL', [
      tenantID,
    ]);
    return { message: 'Корзина очищена', count: result.rowCount ?? 0 };
  }

  async exportCsv(tenantID: string) {
    const { rows } = await this.pool.query(
      `SELECT name, category, unit, sell_price, cost_price, stock, min_stock
       FROM products WHERE tenant_id = $1 AND deleted_at IS NULL
       ORDER BY category, name`,
      [tenantID],
    );
    const header = 'Наименование;Группа;Единица измерения;Цена продажи;Цена закупки;Остаток;Мин. остаток';
    const lines = rows.map((r) => {
      const vals = [
        r.name || '',
        r.category || '',
        r.unit || '',
        parseFloat(r.sell_price) || 0,
        parseFloat(r.cost_price) || 0,
        parseFloat(r.stock) || 0,
        parseFloat(r.min_stock) || 0,
      ];
      return vals.join(';');
    });
    return [header, ...lines].join('\n');
  }

  async importCsv(tenantID: string, items: unknown) {
    this.logger.log(`[importCsv] received ${Array.isArray(items) ? items.length : 0} items for tenant ${tenantID}`);

    // Top-level try/catch so we always return a meaningful error instead of 500.
    try {
      if (!Array.isArray(items) || items.length === 0) {
        throw new BadRequestException({ message: 'Нет данных для импорта' });
      }

      if (!tenantID) {
        throw new BadRequestException({ message: 'Нет tenantID' });
      }

      // Normalize: coerce types, trim strings, handle Russian "100,50" decimals.
      const toNum = (v: unknown): number => {
        if (v === null || v === undefined || v === '') return 0;
        if (typeof v === 'number') return isFinite(v) ? v : 0;
        const cleaned = String(v).replace(/\s/g, '').replace(',', '.');
        const n = parseFloat(cleaned);
        return isFinite(n) ? Math.max(0, n) : 0; // clamp negatives
      };
      const toStr = (v: unknown): string => (v === null || v === undefined ? '' : String(v).trim());
      const clampPrice = (n: number) => Math.min(n, 99999999.99);
      const clampStock = (n: number) => Math.min(n, 9999999.99);

      // Normalize + deduplicate by name (CSV often has duplicates).
      const byName = new Map<
        string,
        {
          name: string;
          category: string | null;
          unit: string;
          costPrice: number;
          sellPrice: number;
          stock: number;
          minStock: number;
        }
      >();

      for (const item of items as unknown[]) {
        if (!item || typeof item !== 'object') continue;
        const it = item as Record<string, unknown>;
        const name = toStr(it.name).slice(0, 500);
        if (!name) continue;
        // Last write wins for duplicate names within the same import
        byName.set(name, {
          name,
          category: toStr(it.category).slice(0, 500) || null,
          unit: toStr(it.unit).slice(0, 50) || 'pcs',
          costPrice: clampPrice(toNum(it.costPrice)),
          sellPrice: clampPrice(toNum(it.sellPrice)),
          stock: clampStock(toNum(it.stock)),
          minStock: clampStock(toNum(it.minStock)),
        });
      }

      const normalized = Array.from(byName.values());
      if (normalized.length === 0) {
        throw new BadRequestException({ message: 'Нет товаров с непустым названием' });
      }

      this.logger.log(`[importCsv] normalized ${normalized.length} unique products`);

      // One SELECT to find all existing names at once.
      const names = normalized.map((r) => r.name);
      const { rows: existingRows } = await this.pool.query(
        `SELECT id, name FROM products WHERE tenant_id = $1 AND name = ANY($2::text[]) AND deleted_at IS NULL`,
        [tenantID, names],
      );
      const existingMap = new Map<string, string>();
      for (const row of existingRows) existingMap.set(row.name, row.id);

      let created = 0;
      let updated = 0;
      let skipped = 0;
      const errors: string[] = [];

      const client = await this.pool.connect();
      try {
        await client.query('BEGIN');

        // Batch INSERT new items — chunk by 100 to stay under param limit (65535/8 ≈ 8k max).
        const newItems = normalized.filter((r) => !existingMap.has(r.name));
        for (let i = 0; i < newItems.length; i += 100) {
          const chunk = newItems.slice(i, i + 100);
          const values: unknown[] = [];
          const placeholders: string[] = [];
          chunk.forEach((it, idx) => {
            const b = idx * 8;
            placeholders.push(
              `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8})`,
            );
            values.push(it.name, it.category, it.costPrice, it.sellPrice, it.stock, it.minStock, it.unit, tenantID);
          });
          try {
            await client.query(
              `INSERT INTO products (name, category, cost_price, sell_price, stock, min_stock, unit, tenant_id) VALUES ${placeholders.join(', ')}`,
              values,
            );
            created += chunk.length;
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'unknown';
            this.logger.error(`[importCsv] batch INSERT failed at chunk ${i}-${i + chunk.length}: ${msg}`);
            skipped += chunk.length;
            if (errors.length < 5) errors.push(`batch insert: ${msg}`);
          }
        }

        // UPDATE existing items — individual queries but inside transaction.
        const updateItems = normalized.filter((r) => existingMap.has(r.name));
        for (const it of updateItems) {
          const existingId = existingMap.get(it.name);
          try {
            await client.query(
              `UPDATE products SET category=$3, cost_price=$4, sell_price=$5, stock=$6, min_stock=$7, unit=$8 WHERE id=$1 AND tenant_id=$2`,
              [existingId, tenantID, it.category, it.costPrice, it.sellPrice, it.stock, it.minStock, it.unit],
            );
            updated++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : 'unknown';
            this.logger.error(`[importCsv] UPDATE failed for "${it.name}": ${msg}`);
            skipped++;
            if (errors.length < 5) errors.push(`"${it.name}": ${msg}`);
          }
        }

        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      this.logger.log(`[importCsv] done: ${created} created, ${updated} updated, ${skipped} skipped`);
      return { created, updated, skipped, total: created + updated, errors };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      const msg = err instanceof Error ? err.message : 'неизвестная ошибка';
      const stack = err instanceof Error ? err.stack : '';
      this.logger.error(`[importCsv] FATAL: ${msg}\n${stack}`);
      throw new InternalServerErrorException({ message: `Ошибка импорта: ${msg}` });
    }
  }

  async updateStock(id: string, tenantID: string, dto: any, userId?: string) {
    const { type, quantity, reason, recordAsExpense } = dto;
    if (!type || quantity === undefined) {
      throw new BadRequestException({ message: 'Тип и количество обязательны' });
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        'SELECT stock, warehouse_id, cost_price FROM products WHERE id=$1 AND tenant_id=$2 FOR UPDATE',
        [id, tenantID],
      );
      if (rows.length === 0) {
        await client.query('ROLLBACK');
        throw new NotFoundException({ message: 'Товар не найден' });
      }

      const stockBefore = parseFloat(rows[0].stock) || 0;
      const productWarehouseId = (rows[0].warehouse_id as string | null) ?? null;
      const purchasePrice = parseFloat(rows[0].cost_price) || 0;
      let stockAfter: number;

      switch (type) {
        case 'income':
          stockAfter = stockBefore + quantity;
          break;
        case 'expense':
        case 'writeoff':
          stockAfter = Math.max(stockBefore - quantity, 0);
          break;
        case 'inventory':
          stockAfter = quantity;
          break;
        default:
          await client.query('ROLLBACK');
          throw new BadRequestException({ message: 'Неверный тип операции' });
      }

      await client.query('UPDATE products SET stock=$1 WHERE id=$2 AND tenant_id=$3', [stockAfter, id, tenantID]);

      // For writeoff with recordAsExpense, also insert an expense row and
      // link it back via stock_movements.linked_expense_id. Mirrors the
      // logic in StockMovementsService so the simple /stock endpoint
      // delivers the same audit trail.
      let linkedExpenseId: string | null = null;
      const writeAsExpense = type === 'writeoff' && !!recordAsExpense;
      if (writeAsExpense) {
        const catRes = await client.query('SELECT id FROM expense_categories WHERE tenant_id=$1 AND name=$2 LIMIT 1', [
          tenantID,
          'Списание со склада',
        ]);
        let categoryId = catRes.rows[0]?.id as string | undefined;
        if (!categoryId) {
          const ins = await client.query(
            'INSERT INTO expense_categories (name, tenant_id) VALUES ($1, $2) RETURNING id',
            ['Списание со склада', tenantID],
          );
          categoryId = ins.rows[0].id;
        }
        const amount = quantity * purchasePrice;
        const expIns = await client.query(
          `INSERT INTO expenses (category_id, amount, description, date, user_id, tenant_id)
           VALUES ($1, $2, $3, now(), $4, $5) RETURNING id`,
          [categoryId, amount, reason ?? 'Списание со склада', userId || null, tenantID],
        );
        linkedExpenseId = expIns.rows[0].id;
      }

      await client.query(
        `INSERT INTO stock_movements (
           product_id, type, quantity, stock_before, stock_after, reason,
           tenant_id, user_id, warehouse_id, record_as_expense, linked_expense_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          id,
          type,
          quantity,
          stockBefore,
          stockAfter,
          reason,
          tenantID,
          userId || null,
          productWarehouseId,
          writeAsExpense,
          linkedExpenseId,
        ],
      );

      await client.query('COMMIT');
      return { stock: stockAfter, linkedExpenseId };
    } catch (err) {
      await client.query('ROLLBACK');
      if (err instanceof NotFoundException || err instanceof BadRequestException) throw err;
      this.logger.error(`Stock update error: ${err}`);
      throw new InternalServerErrorException({ message: 'Ошибка сервера' });
    } finally {
      client.release();
    }
  }
}
