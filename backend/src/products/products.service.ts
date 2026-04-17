import { Injectable, Inject, NotFoundException, BadRequestException, InternalServerErrorException, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';

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
      createdAt: row.created_at,
    };
    if (row.supplier_name) {
      p.supplier = { id: row.supplier_id, name: row.supplier_name };
    }
    return p;
  }

  async getAll(tenantID: string, query: any) {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 100;
    const offset = (page - 1) * limit;
    const search = query.search || '';

    let where = 'p.tenant_id = $1';
    const params: any[] = [tenantID];
    let idx = 2;

    if (search) {
      where += ` AND p.name ILIKE $${idx}`;
      params.push(`%${search}%`);
      idx++;
    }

    const countResult = await this.pool.query(
      `SELECT COUNT(*) as total FROM products p WHERE ${where}`,
      params,
    );
    const total = parseInt(countResult.rows[0].total);

    params.push(limit, offset);
    const { rows } = await this.pool.query(
      `SELECT p.*, s.name as supplier_name
       FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id
       WHERE ${where} ORDER BY p.name LIMIT $${idx} OFFSET $${idx + 1}`,
      params,
    );

    return { data: rows.map(this.mapProduct), total, page, limit };
  }

  async getLowStock(tenantID: string) {
    const { rows } = await this.pool.query(
      `SELECT p.*, s.name as supplier_name
       FROM products p LEFT JOIN suppliers s ON s.id = p.supplier_id
       WHERE p.tenant_id = $1 AND p.stock <= p.min_stock AND p.min_stock > 0
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
       FROM products WHERE tenant_id = $1`,
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
       WHERE p.id=$1 AND p.tenant_id=$2`,
      [id, tenantID],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Товар не найден' });
    return this.mapProduct(rows[0]);
  }

  async create(tenantID: string, dto: any) {
    const { rows } = await this.pool.query(
      `INSERT INTO products (name, category, photo, cost_price, sell_price, stock, min_stock, unit, is_bundle, bundle_items, supplier_id, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
      [dto.name, dto.category, dto.photo, dto.costPrice || 0, dto.sellPrice || 0,
       dto.stock || 0, dto.minStock || 0, dto.unit || 'pcs',
       dto.isBundle || false, JSON.stringify(dto.bundleItems || []),
       dto.supplierId, tenantID],
    );
    return this.mapProduct(rows[0]);
  }

  async update(id: string, tenantID: string, dto: any, userID?: string) {
    // Get current prices before update for price history
    const { rows: current } = await this.pool.query(
      'SELECT cost_price, sell_price FROM products WHERE id=$1 AND tenant_id=$2',
      [id, tenantID],
    );

    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (dto.name !== undefined) { sets.push(`name=$${idx++}`); vals.push(dto.name); }
    if (dto.category !== undefined) { sets.push(`category=$${idx++}`); vals.push(dto.category); }
    if (dto.photo !== undefined) { sets.push(`photo=$${idx++}`); vals.push(dto.photo); }
    if (dto.costPrice !== undefined) { sets.push(`cost_price=$${idx++}`); vals.push(dto.costPrice); }
    if (dto.sellPrice !== undefined) { sets.push(`sell_price=$${idx++}`); vals.push(dto.sellPrice); }
    if (dto.stock !== undefined) { sets.push(`stock=$${idx++}`); vals.push(dto.stock); }
    if (dto.minStock !== undefined) { sets.push(`min_stock=$${idx++}`); vals.push(dto.minStock); }
    if (dto.unit !== undefined) { sets.push(`unit=$${idx++}`); vals.push(dto.unit); }
    if (dto.isBundle !== undefined) { sets.push(`is_bundle=$${idx++}`); vals.push(dto.isBundle); }
    if (dto.bundleItems !== undefined) { sets.push(`bundle_items=$${idx++}`); vals.push(JSON.stringify(dto.bundleItems)); }
    if (dto.supplierId !== undefined) { sets.push(`supplier_id=$${idx++}`); vals.push(dto.supplierId); }

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

  async remove(id: string, tenantID: string) {
    await this.pool.query('DELETE FROM products WHERE id=$1 AND tenant_id=$2', [id, tenantID]);
    return { message: 'Удалено' };
  }

  async exportCsv(tenantID: string) {
    const { rows } = await this.pool.query(
      `SELECT name, category, unit, sell_price, cost_price, stock, min_stock
       FROM products WHERE tenant_id = $1 ORDER BY category, name`,
      [tenantID],
    );
    const header = 'Наименование;Группа;Единица измерения;Цена продажи;Цена закупки;Остаток;Мин. остаток';
    const lines = rows.map(r => {
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

  async importCsv(tenantID: string, items: any[]) {
    if (!items || items.length === 0) {
      throw new BadRequestException({ message: 'Нет данных для импорта' });
    }

    const toNum = (v: any): number => {
      if (v === null || v === undefined || v === '') return 0;
      if (typeof v === 'number') return isFinite(v) ? v : 0;
      const cleaned = String(v).replace(/\s/g, '').replace(',', '.');
      const n = parseFloat(cleaned);
      return isFinite(n) ? n : 0;
    };
    const toStr = (v: any): string => (v === null || v === undefined) ? '' : String(v).trim();

    // 1) Normalize all items
    const normalized = items
      .map((item) => ({
        name: toStr(item?.name),
        category: toStr(item?.category) || null,
        unit: toStr(item?.unit) || 'pcs',
        costPrice: toNum(item?.costPrice),
        sellPrice: toNum(item?.sellPrice),
        stock: toNum(item?.stock),
        minStock: toNum(item?.minStock),
      }))
      .filter((r) => r.name);

    if (normalized.length === 0) {
      throw new BadRequestException({ message: 'Нет товаров с непустым названием' });
    }

    // 2) Single query: find all existing products by name
    const names = normalized.map((r) => r.name);
    const { rows: existingRows } = await this.pool.query(
      `SELECT id, name FROM products WHERE tenant_id = $1 AND name = ANY($2)`,
      [tenantID, names],
    );
    const existingMap = new Map<string, string>();
    for (const row of existingRows) {
      existingMap.set(row.name, row.id);
    }

    const client = await this.pool.connect();
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];

    try {
      await client.query('BEGIN');

      // 3) Batch INSERT new items (in chunks of 100 to avoid param limit)
      const newItems = normalized.filter((r) => !existingMap.has(r.name));
      for (let i = 0; i < newItems.length; i += 100) {
        const chunk = newItems.slice(i, i + 100);
        const values: any[] = [];
        const placeholders: string[] = [];
        chunk.forEach((item, idx) => {
          const base = idx * 8;
          placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`);
          values.push(item.name, item.category, item.costPrice, item.sellPrice, item.stock, item.minStock, item.unit, tenantID);
        });
        try {
          await client.query(
            `INSERT INTO products (name, category, cost_price, sell_price, stock, min_stock, unit, tenant_id) VALUES ${placeholders.join(', ')}`,
            values,
          );
          created += chunk.length;
        } catch (err: any) {
          skipped += chunk.length;
          if (errors.length < 5) errors.push(`batch insert failed: ${err?.message}`);
        }
      }

      // 4) Batch UPDATE existing items (one by one, but within transaction)
      const updateItems = normalized.filter((r) => existingMap.has(r.name));
      for (const item of updateItems) {
        const existingId = existingMap.get(item.name);
        try {
          await client.query(
            `UPDATE products SET category=$3, cost_price=$4, sell_price=$5, stock=$6, min_stock=$7, unit=$8 WHERE id=$1 AND tenant_id=$2`,
            [existingId, tenantID, item.category, item.costPrice, item.sellPrice, item.stock, item.minStock, item.unit],
          );
          updated++;
        } catch (err: any) {
          skipped++;
          if (errors.length < 5) errors.push(`"${item.name}": ${err?.message}`);
        }
      }

      await client.query('COMMIT');
    } catch (err: any) {
      await client.query('ROLLBACK');
      throw new InternalServerErrorException({ message: `Ошибка импорта: ${err?.message}` });
    } finally {
      client.release();
    }

    return { created, updated, skipped, total: created + updated, errors };
  }

  async updateStock(id: string, tenantID: string, dto: any, userId?: string) {
    const { type, quantity, reason } = dto;
    if (!type || quantity === undefined) {
      throw new BadRequestException({ message: 'Тип и количество обязательны' });
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        'SELECT stock FROM products WHERE id=$1 AND tenant_id=$2 FOR UPDATE',
        [id, tenantID],
      );
      if (rows.length === 0) {
        await client.query('ROLLBACK');
        throw new NotFoundException({ message: 'Товар не найден' });
      }

      const stockBefore = parseFloat(rows[0].stock) || 0;
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

      await client.query(
        `INSERT INTO stock_movements (product_id, type, quantity, stock_before, stock_after, reason, tenant_id, user_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, type, quantity, stockBefore, stockAfter, reason, tenantID, userId || null],
      );

      await client.query('COMMIT');
      return { stock: stockAfter };
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
