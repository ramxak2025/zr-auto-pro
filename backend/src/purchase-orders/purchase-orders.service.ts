import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database.module';
import { StockMovementsService } from '../stock-movements/stock-movements.service';
import { CreatePurchaseOrderDto, PurchaseOrderItemInputDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { ReceivePurchaseOrderDto } from './dto/receive-purchase-order.dto';

@Injectable()
export class PurchaseOrdersService {
  private readonly logger = new Logger('PurchaseOrdersService');

  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private stockMovements: StockMovementsService,
  ) {}

  // ── mappers ─────────────────────────────────────────────────────────────
  private mapOrder(row: any) {
    return {
      id: row.id,
      supplierId: row.supplier_id,
      supplierName: row.supplier_name ?? null,
      status: row.status as 'draft' | 'ordered' | 'received' | 'cancelled',
      note: row.note ?? null,
      total: parseFloat(row.total) || 0,
      itemCount: row.item_count !== undefined ? parseInt(row.item_count, 10) || 0 : undefined,
      createdBy: row.created_by ?? null,
      createdByName: row.created_by_name ?? null,
      orderedAt: row.ordered_at ?? null,
      receivedAt: row.received_at ?? null,
      createdAt: row.created_at,
    };
  }

  private mapItem(row: any) {
    const quantity = parseFloat(row.quantity) || 0;
    const costPrice = parseFloat(row.cost_price) || 0;
    return {
      id: row.id,
      purchaseOrderId: row.purchase_order_id,
      productId: row.product_id,
      name: row.name,
      quantity,
      costPrice,
      receivedQuantity: parseFloat(row.received_quantity) || 0,
      total: Math.round(quantity * costPrice * 100) / 100,
    };
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  /** Verify the supplier belongs to the tenant. Throws 400 otherwise. */
  private async assertSupplierInTenant(client: PoolClient, supplierId: string, tenantID: string): Promise<void> {
    const { rows } = await client.query('SELECT 1 FROM suppliers WHERE id=$1 AND tenant_id=$2 LIMIT 1', [
      supplierId,
      tenantID,
    ]);
    if (rows.length === 0) throw new BadRequestException({ message: 'Поставщик не найден' });
  }

  /**
   * Normalise + validate the requested line set against the tenant's products,
   * snapshotting each product's current name. Returns rows ready to insert plus
   * the computed total. Runs on the caller's transaction client.
   */
  private async resolveItems(
    client: PoolClient,
    tenantID: string,
    items: PurchaseOrderItemInputDto[],
  ): Promise<{ rows: Array<{ productId: string; name: string; quantity: number; costPrice: number }>; total: number }> {
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestException({ message: 'Добавьте хотя бы одну позицию' });
    }

    const out: Array<{ productId: string; name: string; quantity: number; costPrice: number }> = [];
    let total = 0;

    for (const item of items) {
      const quantity = parseFloat(String(item.quantity));
      const costPrice = parseFloat(String(item.costPrice));
      if (!isFinite(quantity) || quantity <= 0) {
        throw new BadRequestException({ message: 'Количество должно быть положительным' });
      }
      if (!isFinite(costPrice) || costPrice < 0) {
        throw new BadRequestException({ message: 'Цена закупки не может быть отрицательной' });
      }
      // Product must live in the tenant (and not be trashed) — snapshot its name.
      const { rows } = await client.query(
        'SELECT name FROM products WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL LIMIT 1',
        [item.productId, tenantID],
      );
      if (rows.length === 0) {
        throw new BadRequestException({ message: 'Товар не найден' });
      }
      out.push({ productId: item.productId, name: rows[0].name, quantity, costPrice });
      total += quantity * costPrice;
    }

    return { rows: out, total: Math.round(total * 100) / 100 };
  }

  /** Load a full order (header + items), tenant-scoped. Throws 404 if missing. */
  private async loadDetail(client: Pool | PoolClient, id: string, tenantID: string) {
    const { rows } = await client.query(
      `SELECT po.*, s.name AS supplier_name, u.full_name AS created_by_name
         FROM purchase_orders po
         LEFT JOIN suppliers s ON s.id = po.supplier_id
         LEFT JOIN users u ON u.id = po.created_by
        WHERE po.id=$1 AND po.tenant_id=$2`,
      [id, tenantID],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Заказ не найден' });

    const { rows: itemRows } = await client.query(
      `SELECT * FROM purchase_order_items WHERE purchase_order_id=$1 AND tenant_id=$2 ORDER BY created_at, id`,
      [id, tenantID],
    );

    return { ...this.mapOrder(rows[0]), items: itemRows.map((r) => this.mapItem(r)) };
  }

  // ── create ──────────────────────────────────────────────────────────────
  async create(tenantID: string, userID: string | null, dto: CreatePurchaseOrderDto) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      await this.assertSupplierInTenant(client, dto.supplierId, tenantID);
      const { rows: items, total } = await this.resolveItems(client, tenantID, dto.items);

      const { rows: poRows } = await client.query(
        `INSERT INTO purchase_orders (tenant_id, supplier_id, status, note, total, created_by)
         VALUES ($1, $2, 'draft', $3, $4, $5) RETURNING id`,
        [tenantID, dto.supplierId, dto.note ?? null, total, userID],
      );
      const poId = poRows[0].id;

      for (const it of items) {
        await client.query(
          `INSERT INTO purchase_order_items (tenant_id, purchase_order_id, product_id, name, quantity, cost_price, received_quantity)
           VALUES ($1, $2, $3, $4, $5, $6, 0)`,
          [tenantID, poId, it.productId, it.name, it.quantity, it.costPrice],
        );
      }

      const detail = await this.loadDetail(client, poId, tenantID);
      await client.query('COMMIT');
      return detail;
    } catch (err) {
      await client.query('ROLLBACK');
      if (err instanceof BadRequestException || err instanceof NotFoundException) throw err;
      this.logger.error(`Purchase order create error: ${err}`);
      throw new InternalServerErrorException({ message: 'Ошибка сервера' });
    } finally {
      client.release();
    }
  }

  // ── list ──────────────────────────────────────────────────────────────────
  async list(tenantID: string, query: { status?: string; supplierId?: string; page?: any; limit?: any }) {
    const page = parseInt(query.page) || 1;
    const limit = Math.min(parseInt(query.limit) || 50, 200);
    const offset = (page - 1) * limit;

    let where = 'po.tenant_id = $1';
    const params: any[] = [tenantID];
    let idx = 2;

    if (query.status) {
      where += ` AND po.status = $${idx++}`;
      params.push(query.status);
    }
    if (query.supplierId) {
      where += ` AND po.supplier_id = $${idx++}`;
      params.push(query.supplierId);
    }

    const countResult = await this.pool.query(
      `SELECT COUNT(*) AS total FROM purchase_orders po WHERE ${where}`,
      params,
    );
    const total = parseInt(countResult.rows[0].total, 10);

    params.push(limit, offset);
    const { rows } = await this.pool.query(
      `SELECT po.*, s.name AS supplier_name, u.full_name AS created_by_name,
              (SELECT COUNT(*) FROM purchase_order_items poi WHERE poi.purchase_order_id = po.id) AS item_count
         FROM purchase_orders po
         LEFT JOIN suppliers s ON s.id = po.supplier_id
         LEFT JOIN users u ON u.id = po.created_by
        WHERE ${where}
        ORDER BY po.created_at DESC
        LIMIT $${idx} OFFSET $${idx + 1}`,
      params,
    );

    return { data: rows.map((r) => this.mapOrder(r)), total, page, limit };
  }

  // ── detail ──────────────────────────────────────────────────────────────
  async getById(id: string, tenantID: string) {
    return this.loadDetail(this.pool, id, tenantID);
  }

  // ── update (draft only) ───────────────────────────────────────────────────
  async update(id: string, tenantID: string, dto: UpdatePurchaseOrderDto) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        'SELECT status FROM purchase_orders WHERE id=$1 AND tenant_id=$2 FOR UPDATE',
        [id, tenantID],
      );
      if (rows.length === 0) throw new NotFoundException({ message: 'Заказ не найден' });
      if (rows[0].status !== 'draft') {
        throw new BadRequestException({ message: 'Редактировать можно только черновик' });
      }

      const sets: string[] = [];
      const vals: any[] = [];
      let idx = 1;

      if (dto.supplierId !== undefined) {
        await this.assertSupplierInTenant(client, dto.supplierId, tenantID);
        sets.push(`supplier_id=$${idx++}`);
        vals.push(dto.supplierId);
      }
      if (dto.note !== undefined) {
        sets.push(`note=$${idx++}`);
        vals.push(dto.note ?? null);
      }

      // Replacing items also recomputes the stored total.
      if (dto.items !== undefined) {
        const { rows: items, total } = await this.resolveItems(client, tenantID, dto.items);
        await client.query('DELETE FROM purchase_order_items WHERE purchase_order_id=$1 AND tenant_id=$2', [
          id,
          tenantID,
        ]);
        for (const it of items) {
          await client.query(
            `INSERT INTO purchase_order_items (tenant_id, purchase_order_id, product_id, name, quantity, cost_price, received_quantity)
             VALUES ($1, $2, $3, $4, $5, $6, 0)`,
            [tenantID, id, it.productId, it.name, it.quantity, it.costPrice],
          );
        }
        sets.push(`total=$${idx++}`);
        vals.push(total);
      }

      if (sets.length > 0) {
        vals.push(id, tenantID);
        await client.query(
          `UPDATE purchase_orders SET ${sets.join(', ')} WHERE id=$${idx++} AND tenant_id=$${idx}`,
          vals,
        );
      }

      const detail = await this.loadDetail(client, id, tenantID);
      await client.query('COMMIT');
      return detail;
    } catch (err) {
      await client.query('ROLLBACK');
      if (err instanceof BadRequestException || err instanceof NotFoundException) throw err;
      this.logger.error(`Purchase order update error: ${err}`);
      throw new InternalServerErrorException({ message: 'Ошибка сервера' });
    } finally {
      client.release();
    }
  }

  // ── order (draft → ordered) ───────────────────────────────────────────────
  async markOrdered(id: string, tenantID: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'SELECT status FROM purchase_orders WHERE id=$1 AND tenant_id=$2 FOR UPDATE',
        [id, tenantID],
      );
      if (rows.length === 0) throw new NotFoundException({ message: 'Заказ не найден' });
      if (rows[0].status !== 'draft') {
        throw new BadRequestException({ message: 'Отправить можно только черновик' });
      }
      await client.query(`UPDATE purchase_orders SET status='ordered', ordered_at=now() WHERE id=$1 AND tenant_id=$2`, [
        id,
        tenantID,
      ]);
      const detail = await this.loadDetail(client, id, tenantID);
      await client.query('COMMIT');
      return detail;
    } catch (err) {
      await client.query('ROLLBACK');
      if (err instanceof BadRequestException || err instanceof NotFoundException) throw err;
      this.logger.error(`Purchase order order error: ${err}`);
      throw new InternalServerErrorException({ message: 'Ошибка сервера' });
    } finally {
      client.release();
    }
  }

  // ── receive (full or partial) ─────────────────────────────────────────────
  /**
   * Receive stock against a purchase order. Transactional: the PO status flip and
   * EVERY per-item stock income commit (or roll back) together.
   *
   * Stock is credited via StockMovementsService.applyIncomeTx() — the same
   * `income` path manual receiving uses — so cost/stock behave identically and
   * each receipt produces an `income` stock_movement linked to the supplier.
   *
   * Body semantics:
   *   • no `items`        → receive the full outstanding qty of every line.
   *   • `items: [...]`    → receive a delta on the listed lines only.
   * Over-receipt (received_quantity + delta > ordered quantity) is rejected.
   *
   * Status after receive:
   *   • every line fully received → status='received', received_at=now().
   *   • otherwise (partial)       → status='ordered', received_at stays null.
   */
  async receive(id: string, tenantID: string, userID: string | null, dto: ReceivePurchaseOrderDto) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: poRows } = await client.query(
        'SELECT id, status, supplier_id FROM purchase_orders WHERE id=$1 AND tenant_id=$2 FOR UPDATE',
        [id, tenantID],
      );
      if (poRows.length === 0) throw new NotFoundException({ message: 'Заказ не найден' });
      const po = poRows[0];
      if (po.status === 'cancelled') {
        throw new BadRequestException({ message: 'Заказ отменён' });
      }
      if (po.status === 'received') {
        throw new BadRequestException({ message: 'Заказ уже принят' });
      }

      // Lock the lines for this order so concurrent receives serialise.
      const { rows: itemRows } = await client.query(
        `SELECT id, product_id, name, quantity, cost_price, received_quantity
           FROM purchase_order_items WHERE purchase_order_id=$1 AND tenant_id=$2 FOR UPDATE`,
        [id, tenantID],
      );
      if (itemRows.length === 0) {
        throw new BadRequestException({ message: 'В заказе нет позиций' });
      }

      // Build a map of itemId → delta to receive.
      const deltaById = new Map<string, number>();
      if (dto.items && dto.items.length > 0) {
        for (const reqItem of dto.items) {
          const delta = parseFloat(String(reqItem.receivedQuantity));
          if (!isFinite(delta) || delta <= 0) {
            throw new BadRequestException({ message: 'Количество должно быть положительным' });
          }
          if (deltaById.has(reqItem.itemId)) {
            throw new BadRequestException({ message: 'Позиция указана дважды' });
          }
          deltaById.set(reqItem.itemId, delta);
        }
      } else {
        // Full receive — outstanding qty of every line.
        for (const row of itemRows) {
          const outstanding = (parseFloat(row.quantity) || 0) - (parseFloat(row.received_quantity) || 0);
          if (outstanding > 0) deltaById.set(row.id, outstanding);
        }
      }

      if (deltaById.size === 0) {
        throw new BadRequestException({ message: 'Нечего принимать' });
      }

      const byId = new Map(itemRows.map((r) => [r.id, r]));

      // Apply each receipt: credit stock via the shared income path, then bump
      // received_quantity on the line.
      for (const [itemId, delta] of deltaById) {
        const row = byId.get(itemId);
        if (!row) {
          throw new BadRequestException({ message: 'Позиция не найдена в заказе' });
        }
        const ordered = parseFloat(row.quantity) || 0;
        const already = parseFloat(row.received_quantity) || 0;
        if (already + delta > ordered + 1e-9) {
          throw new BadRequestException({ message: `Нельзя принять больше заказанного: ${row.name}` });
        }

        await this.stockMovements.applyIncomeTx(client, tenantID, userID, {
          productId: row.product_id,
          quantity: delta,
          purchasePrice: parseFloat(row.cost_price) || 0,
          supplierId: po.supplier_id,
          reason: 'Приёмка заказа поставщику',
        });

        await client.query(
          'UPDATE purchase_order_items SET received_quantity = received_quantity + $1 WHERE id=$2 AND tenant_id=$3',
          [delta, itemId, tenantID],
        );
      }

      // Re-read lines to decide the new status (fully vs partially received).
      const { rows: afterRows } = await client.query(
        'SELECT quantity, received_quantity FROM purchase_order_items WHERE purchase_order_id=$1 AND tenant_id=$2',
        [id, tenantID],
      );
      const fullyReceived = afterRows.every(
        (r) => (parseFloat(r.received_quantity) || 0) + 1e-9 >= (parseFloat(r.quantity) || 0),
      );

      if (fullyReceived) {
        // ordered_at backfilled when receiving straight from draft (skipped the
        // explicit "order" step) so the timeline isn't missing a milestone.
        await client.query(
          `UPDATE purchase_orders
              SET status='received', received_at=now(), ordered_at=COALESCE(ordered_at, now())
            WHERE id=$1 AND tenant_id=$2`,
          [id, tenantID],
        );
      } else {
        await client.query(
          `UPDATE purchase_orders
              SET status='ordered', ordered_at=COALESCE(ordered_at, now())
            WHERE id=$1 AND tenant_id=$2`,
          [id, tenantID],
        );
      }

      const detail = await this.loadDetail(client, id, tenantID);
      await client.query('COMMIT');
      return detail;
    } catch (err) {
      await client.query('ROLLBACK');
      if (err instanceof BadRequestException || err instanceof NotFoundException) throw err;
      this.logger.error(`Purchase order receive error: ${err}`);
      throw new InternalServerErrorException({ message: 'Ошибка сервера' });
    } finally {
      client.release();
    }
  }

  // ── cancel (not yet received) ─────────────────────────────────────────────
  async cancel(id: string, tenantID: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'SELECT status FROM purchase_orders WHERE id=$1 AND tenant_id=$2 FOR UPDATE',
        [id, tenantID],
      );
      if (rows.length === 0) throw new NotFoundException({ message: 'Заказ не найден' });
      if (rows[0].status === 'received') {
        throw new BadRequestException({ message: 'Нельзя отменить принятый заказ' });
      }
      if (rows[0].status === 'cancelled') {
        throw new BadRequestException({ message: 'Заказ уже отменён' });
      }
      await client.query(`UPDATE purchase_orders SET status='cancelled' WHERE id=$1 AND tenant_id=$2`, [id, tenantID]);
      const detail = await this.loadDetail(client, id, tenantID);
      await client.query('COMMIT');
      return detail;
    } catch (err) {
      await client.query('ROLLBACK');
      if (err instanceof BadRequestException || err instanceof NotFoundException) throw err;
      this.logger.error(`Purchase order cancel error: ${err}`);
      throw new InternalServerErrorException({ message: 'Ошибка сервера' });
    } finally {
      client.release();
    }
  }

  // ── reorder suggestions ───────────────────────────────────────────────────
  /**
   * Products at/below their min stock, grouped by their preferred supplier
   * (products.supplier_id). Products without a preferred supplier are grouped
   * under a null supplier so the UI can still surface them. `suggestedQuantity`
   * is a hint (restore at least to min stock) the UI may override.
   */
  async suggestions(tenantID: string) {
    const { rows } = await this.pool.query(
      `SELECT p.id, p.name, p.stock, p.min_stock, p.cost_price,
              p.supplier_id, s.name AS supplier_name
         FROM products p
         LEFT JOIN suppliers s ON s.id = p.supplier_id
        WHERE p.tenant_id = $1
          AND p.deleted_at IS NULL
          AND p.min_stock > 0
          AND p.stock <= p.min_stock
        ORDER BY s.name NULLS LAST, p.name`,
      [tenantID],
    );

    const groups = new Map<string, { supplierId: string | null; supplierName: string | null; items: any[] }>();

    for (const r of rows) {
      const supplierId: string | null = r.supplier_id ?? null;
      const key = supplierId ?? '__none__';
      if (!groups.has(key)) {
        groups.set(key, { supplierId, supplierName: r.supplier_name ?? null, items: [] });
      }
      const stock = parseFloat(r.stock) || 0;
      const minStock = parseFloat(r.min_stock) || 0;
      const costPrice = parseFloat(r.cost_price) || 0;
      const deficit = minStock - stock;
      const suggestedQuantity = deficit > 0 ? deficit : minStock;
      groups.get(key)!.items.push({
        productId: r.id,
        name: r.name,
        stock,
        minStock,
        costPrice,
        suggestedQuantity,
      });
    }

    return Array.from(groups.values());
  }
}
