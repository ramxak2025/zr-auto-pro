import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database.module';
import { capLimit } from '../common/cap-limit';
import { StockMovementsService } from '../stock-movements/stock-movements.service';
import { WarehousesService } from '../warehouses/warehouses.service';

@Injectable()
export class SuppliersService {
  private readonly logger = new Logger('SuppliersService');

  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private stockMovements: StockMovementsService,
    private warehouses: WarehousesService,
  ) {}

  /**
   * Defect return endpoint — supplier-facing. Delegates to StockMovementsService
   * which handles the stock decrement, debt adjustment, and audit row in one
   * transaction. Cross-tenant guarded inside the service.
   */
  async returnDefect(
    tenantID: string,
    userID: string | null,
    supplierId: string,
    dto: { productId: string; qty: number; purchasePrice?: number; note?: string },
  ) {
    if (!dto || !dto.productId) {
      throw new BadRequestException({ message: 'Товар обязателен' });
    }
    return this.stockMovements.create(tenantID, userID, {
      type: 'defect_return_to_supplier',
      productId: dto.productId,
      quantity: dto.qty,
      purchasePrice: dto.purchasePrice,
      supplierId,
      reason: dto.note,
    });
  }

  private mapSupplier(row: any) {
    return {
      id: row.id,
      name: row.name,
      phone: row.phone,
      contactPerson: row.contact_person,
      comment: row.comment,
      totalPurchases: parseFloat(row.total_purchases) || 0,
      totalPaid: parseFloat(row.total_paid) || 0,
      currentDebt: parseFloat(row.current_debt) || 0,
      // System rows are pinned + uneditable. The FE relies on these two
      // fields to render the special "Покупка б/у товара" row at the top
      // of the suppliers list and to swap actions on the detail screen.
      isSystem: !!row.is_system,
      kind: (row.kind as string | null) ?? null,
      createdAt: row.created_at,
    };
  }

  async getAll(tenantID: string, query: any) {
    const page = parseInt(query.page) || 1;
    const limit = capLimit(query.limit, 50, 1000);
    const offset = (page - 1) * limit;
    const search = query.search || '';

    let where = 'tenant_id = $1';
    const params: any[] = [tenantID];
    let idx = 2;

    if (search) {
      where += ` AND (name ILIKE $${idx} OR phone ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    const countResult = await this.pool.query(`SELECT COUNT(*) as total FROM suppliers WHERE ${where}`, params);
    const total = parseInt(countResult.rows[0].total);

    params.push(limit, offset);
    // ORDER: system rows first (is_system DESC puts true above false),
    // then alphabetical. The FE renders the system row as a pinned
    // header card; this keeps the order stable across pagination.
    const { rows } = await this.pool.query(
      `SELECT * FROM suppliers WHERE ${where}
        ORDER BY is_system DESC, name
        LIMIT $${idx} OFFSET $${idx + 1}`,
      params,
    );

    return { data: rows.map(this.mapSupplier), total, page, limit };
  }

  async getById(id: string, tenantID: string) {
    const { rows } = await this.pool.query('SELECT * FROM suppliers WHERE id=$1 AND tenant_id=$2', [id, tenantID]);
    if (rows.length === 0) throw new NotFoundException({ message: 'Поставщик не найден' });
    return this.mapSupplier(rows[0]);
  }

  async create(tenantID: string, dto: any) {
    const { rows } = await this.pool.query(
      `INSERT INTO suppliers (name, phone, contact_person, comment, tenant_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [dto.name, dto.phone, dto.contactPerson, dto.comment, tenantID],
    );
    return this.mapSupplier(rows[0]);
  }

  async update(id: string, tenantID: string, dto: any) {
    // System rows (e.g. "Покупка б/у товара") have a fixed name + are
    // not editable. Phone / contact / comment make no sense for them
    // either since the "supplier" is just the act of buying second-hand
    // from a client. Reject the whole update with 403 to give the FE a
    // clear signal that this row is read-only.
    const { rows: sysRows } = await this.pool.query(
      'SELECT is_system FROM suppliers WHERE id=$1 AND tenant_id=$2 LIMIT 1',
      [id, tenantID],
    );
    if (sysRows.length === 0) throw new NotFoundException({ message: 'Поставщик не найден' });
    if (sysRows[0].is_system) {
      throw new ForbiddenException({ message: 'Системного поставщика нельзя редактировать' });
    }

    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (dto.name !== undefined) {
      sets.push(`name=$${idx++}`);
      vals.push(dto.name);
    }
    if (dto.phone !== undefined) {
      sets.push(`phone=$${idx++}`);
      vals.push(dto.phone);
    }
    if (dto.contactPerson !== undefined) {
      sets.push(`contact_person=$${idx++}`);
      vals.push(dto.contactPerson);
    }
    if (dto.comment !== undefined) {
      sets.push(`comment=$${idx++}`);
      vals.push(dto.comment);
    }

    if (sets.length === 0) return this.getById(id, tenantID);

    vals.push(id, tenantID);
    const { rows } = await this.pool.query(
      `UPDATE suppliers SET ${sets.join(', ')} WHERE id=$${idx++} AND tenant_id=$${idx} RETURNING *`,
      vals,
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Поставщик не найден' });
    return this.mapSupplier(rows[0]);
  }

  async remove(id: string, tenantID: string) {
    // Block destructive ops on system rows — the pinned "Покупка б/у
    // товара" supplier must survive every tenant lifetime. Stock
    // movements + deliveries reference it, so removing the row would
    // break the journal anyway.
    const { rows: sysRows } = await this.pool.query(
      'SELECT is_system FROM suppliers WHERE id=$1 AND tenant_id=$2 LIMIT 1',
      [id, tenantID],
    );
    if (sysRows.length === 0) throw new NotFoundException({ message: 'Поставщик не найден' });
    if (sysRows[0].is_system) {
      throw new ForbiddenException({ message: 'Системного поставщика нельзя удалить' });
    }
    await this.pool.query('DELETE FROM suppliers WHERE id=$1 AND tenant_id=$2', [id, tenantID]);
    return { message: 'Удалено' };
  }

  /**
   * "Покупка б/у товара" — buy a second-hand item from the client. The
   * supplier represents the inbound side of the transaction (we owe the
   * client `qty * purchasePrice`). One transaction does:
   *
   *   1. Resolve / insert the product on the Б/У warehouse with the
   *      given name, category, and purchase price. If a matching product
   *      already lives in Б/У with the same (name, category), bump its
   *      stock instead of creating a duplicate.
   *   2. Create a delivery + delivery_item so the supplier ledger
   *      (total_purchases / current_debt) tracks the obligation. This
   *      mirrors how a normal delivery would increase debt — the user
   *      can later pay this off through the existing payment flow.
   *   3. Insert a stock_movement of type 'income' with
   *      `is_used_purchase = true` so the journal can render it
   *      specially.
   *
   * Cross-tenant guarded — supplier must belong to the caller and must
   * be the system used_purchase row to avoid mis-routing a normal
   * supplier's inbound delivery to the Б/У warehouse.
   */
  async usedPurchase(
    tenantID: string,
    userID: string | null,
    supplierId: string,
    dto: {
      productName?: string;
      qty?: number;
      purchasePrice?: number;
      sellPrice?: number | null;
      category?: string;
      note?: string;
    },
  ) {
    const productName = String(dto?.productName ?? '').trim();
    const qty = parseFloat(String(dto?.qty ?? ''));
    const purchasePrice = parseFloat(String(dto?.purchasePrice ?? ''));
    if (!productName) {
      throw new BadRequestException({ message: 'Название товара обязательно' });
    }
    if (!isFinite(qty) || qty <= 0) {
      throw new BadRequestException({ message: 'Количество должно быть положительным' });
    }
    if (!isFinite(purchasePrice) || purchasePrice < 0) {
      throw new BadRequestException({ message: 'Закупочная цена должна быть неотрицательной' });
    }
    // sellPrice is OPTIONAL — owner often doesn't know the final markup at
    // intake time. If absent / null we persist NULL so the FE can render
    // a "set price later" prompt and call /products/:id/sell-price.
    const hasSellPrice = dto?.sellPrice !== undefined && dto?.sellPrice !== null;
    const sellPriceParsed = hasSellPrice ? parseFloat(String(dto.sellPrice)) : null;
    if (sellPriceParsed !== null && (!isFinite(sellPriceParsed) || sellPriceParsed < 0)) {
      throw new BadRequestException({ message: 'Неверная цена продажи' });
    }
    const category = dto?.category ? String(dto.category).trim() || null : null;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Verify the supplier is (a) in our tenant and (b) the system
      // used_purchase row — this endpoint must never run against a
      // normal supplier. Without the kind check a director could
      // mis-route the purchase to e.g. "ООО Запчасти" and corrupt
      // their balance.
      const { rows: supRows } = await client.query(
        'SELECT id, kind, is_system FROM suppliers WHERE id=$1 AND tenant_id=$2 LIMIT 1',
        [supplierId, tenantID],
      );
      if (supRows.length === 0) {
        throw new BadRequestException({ message: 'Поставщик не найден' });
      }
      if (supRows[0].kind !== 'used_purchase' || !supRows[0].is_system) {
        throw new BadRequestException({
          message: 'Этот endpoint доступен только для системного поставщика «Покупка б/у товара»',
        });
      }

      const usedWarehouse = await this.warehouses.resolveByKind(tenantID, 'used');

      // Find an existing product with the same (name, category,
      // warehouse) so we bump stock instead of forking duplicates.
      // category compare is NULL-safe (IS NOT DISTINCT FROM).
      const { rows: existingRows } = await client.query(
        `SELECT id, stock, cost_price FROM products
          WHERE tenant_id = $1
            AND warehouse_id = $2
            AND lower(name) = lower($3)
            AND (category IS NOT DISTINCT FROM $4)
            AND deleted_at IS NULL
          LIMIT 1`,
        [tenantID, usedWarehouse.id, productName, category],
      );

      let productId: string;
      const stockBefore = existingRows.length > 0 ? parseFloat(existingRows[0].stock) || 0 : 0;
      const stockAfter = stockBefore + qty;

      if (existingRows.length > 0) {
        productId = existingRows[0].id;
        // Bump stock; keep the existing cost_price (user might have
        // bought the same SKU at a different price previously). The
        // current purchase price is logged on the stock_movement row
        // for audit / cost basis recomputation.
        await client.query('UPDATE products SET stock = $1 WHERE id = $2 AND tenant_id = $3', [
          stockAfter,
          productId,
          tenantID,
        ]);
      } else {
        // Create a fresh Б/У product. sellPrice can be NULL if the owner
        // hasn't decided yet — they patch it later via
        // /products/:id/sell-price. warehouseId is locked to the tenant's
        // used warehouse. Note: sell_price column is NOT NULL on legacy
        // tenants, so we store 0 as "unknown" if the caller didn't pass
        // anything. The FE distinguishes 0 from a real price using the
        // separate flag — we leave the cost_price column populated for
        // reporting.
        const finalSellPrice = sellPriceParsed !== null ? sellPriceParsed : 0;
        const { rows: insRows } = await client.query(
          `INSERT INTO products
             (name, category, cost_price, sell_price, stock, min_stock, unit,
              tenant_id, warehouse_id)
           VALUES ($1, $2, $3, $4, $5, 0, 'шт', $6, $7)
           RETURNING id`,
          [productName, category, purchasePrice, finalSellPrice, qty, tenantID, usedWarehouse.id],
        );
        productId = insRows[0].id;
      }

      // Insert a delivery so the supplier ledger reflects the debt.
      // Status = 'unpaid' matches the normal delivery flow: user
      // settles via supplier_payments later.
      const totalAmount = qty * purchasePrice;
      const { rows: delRows } = await client.query(
        `INSERT INTO deliveries (supplier_id, date, total_amount, payment_status, comment, tenant_id)
         VALUES ($1, now(), $2, 'unpaid', $3, $4) RETURNING id`,
        [supplierId, totalAmount, dto?.note ?? null, tenantID],
      );
      const deliveryId = delRows[0].id;

      await client.query(
        `INSERT INTO delivery_items (delivery_id, product_id, quantity, price, total)
         VALUES ($1, $2, $3, $4, $5)`,
        [deliveryId, productId, qty, purchasePrice, totalAmount],
      );

      // Mirror the normal delivery flow: supplier debt rises by the
      // purchase amount. Tenant-scoped UPDATE to defend against any
      // future refactor that drops the cross-tenant guard above.
      await client.query(
        `UPDATE suppliers
            SET total_purchases = total_purchases + $1,
                current_debt    = current_debt + $1
          WHERE id = $2 AND tenant_id = $3`,
        [totalAmount, supplierId, tenantID],
      );

      // Log the stock movement. type='income' (legitimate inbound),
      // is_used_purchase=true so the journal renders it as "Покупка Б/У".
      const { rows: mvRows } = await client.query(
        `INSERT INTO stock_movements (
           product_id, type, quantity, stock_before, stock_after, reason,
           tenant_id, user_id, warehouse_id, supplier_id, is_used_purchase
         ) VALUES ($1, 'income', $2, $3, $4, $5, $6, $7, $8, $9, true)
         RETURNING id`,
        [productId, qty, stockBefore, stockAfter, dto?.note ?? null, tenantID, userID, usedWarehouse.id, supplierId],
      );

      await client.query('COMMIT');
      return {
        id: mvRows[0].id,
        productId,
        deliveryId,
        warehouseId: usedWarehouse.id,
        stockAfter,
        debtIncrease: totalAmount,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      if (err instanceof BadRequestException || err instanceof NotFoundException) throw err;
      this.logger.error(`Used-purchase error: ${err}`);
      throw new InternalServerErrorException({ message: 'Ошибка сервера' });
    } finally {
      client.release();
    }
  }

  // Deliveries

  async getDeliveries(tenantID: string, query: any) {
    let where = 'd.tenant_id = $1';
    const params: any[] = [tenantID];
    let idx = 2;

    if (query.supplierId) {
      where += ` AND d.supplier_id = $${idx++}`;
      params.push(query.supplierId);
    }

    const { rows } = await this.pool.query(
      `SELECT d.*, s.name as supplier_name
       FROM deliveries d JOIN suppliers s ON s.id = d.supplier_id
       WHERE ${where} AND d.tenant_id = $1 ORDER BY d.date DESC LIMIT 500`,
      params,
    );

    const deliveries = rows.map((r) => ({
      id: r.id,
      supplierId: r.supplier_id,
      supplier: { id: r.supplier_id, name: r.supplier_name },
      date: r.date,
      totalAmount: parseFloat(r.total_amount) || 0,
      paymentStatus: r.payment_status,
      comment: r.comment,
      // Order-sourced supplies (098) link back to their purchase order + receiver.
      purchaseOrderId: r.purchase_order_id ?? null,
      receivedBy: r.received_by ?? null,
      items: [] as any[],
    }));

    // Load items for each delivery
    if (deliveries.length > 0) {
      const ids = deliveries.map((d) => d.id);
      const { rows: itemRows } = await this.pool.query(
        `SELECT di.*, p.name as product_name
         FROM delivery_items di LEFT JOIN products p ON p.id = di.product_id
         WHERE di.delivery_id = ANY($1)`,
        [ids],
      );

      const itemsMap: Record<string, any[]> = {};
      for (const item of itemRows) {
        const did = item.delivery_id;
        if (!itemsMap[did]) itemsMap[did] = [];
        itemsMap[did].push({
          id: item.id,
          productId: item.product_id,
          product: item.product_name ? { id: item.product_id, name: item.product_name } : undefined,
          quantity: parseFloat(item.quantity) || 0,
          price: parseFloat(item.price) || 0,
          total: parseFloat(item.total) || 0,
          purchaseOrderItemId: item.purchase_order_item_id ?? null,
        });
      }
      for (const d of deliveries) {
        d.items = itemsMap[d.id] || [];
      }
    }

    return deliveries;
  }

  async getDeliveryById(id: string, tenantID: string) {
    const { rows } = await this.pool.query(
      `SELECT d.*, s.name as supplier_name
       FROM deliveries d JOIN suppliers s ON s.id = d.supplier_id
       WHERE d.id=$1 AND d.tenant_id=$2`,
      [id, tenantID],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Поставка не найдена' });

    const r = rows[0];
    const delivery: any = {
      id: r.id,
      supplierId: r.supplier_id,
      supplier: { id: r.supplier_id, name: r.supplier_name },
      date: r.date,
      totalAmount: parseFloat(r.total_amount) || 0,
      paymentStatus: r.payment_status,
      comment: r.comment,
      purchaseOrderId: r.purchase_order_id ?? null,
      receivedBy: r.received_by ?? null,
    };

    const { rows: itemRows } = await this.pool.query(
      `SELECT di.*, p.name as product_name
       FROM delivery_items di LEFT JOIN products p ON p.id = di.product_id
       WHERE di.delivery_id=$1`,
      [id],
    );
    delivery.items = itemRows.map((item) => ({
      id: item.id,
      productId: item.product_id,
      product: item.product_name ? { id: item.product_id, name: item.product_name } : undefined,
      quantity: parseFloat(item.quantity) || 0,
      price: parseFloat(item.price) || 0,
      total: parseFloat(item.total) || 0,
      purchaseOrderItemId: item.purchase_order_item_id ?? null,
    }));

    return delivery;
  }

  async createDelivery(tenantID: string, dto: any) {
    if (!dto.supplierId || !dto.items || dto.items.length === 0) {
      throw new BadRequestException({ message: 'Поставщик и товары обязательны' });
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Verify the supplier belongs to the caller's tenant BEFORE anything
      // else. Without this, a director could craft a request with a
      // supplierId from another tenant and corrupt that supplier's totals
      // (the post-insert UPDATE suppliers used to omit tenant_id).
      const { rows: supRows } = await client.query('SELECT 1 FROM suppliers WHERE id = $1 AND tenant_id = $2 LIMIT 1', [
        dto.supplierId,
        tenantID,
      ]);
      if (supRows.length === 0) {
        throw new BadRequestException({ message: 'Поставщик не найден' });
      }

      let totalAmount = 0;
      for (const item of dto.items) {
        totalAmount += (item.price || 0) * (item.quantity || 0);
      }

      const { rows: delRows } = await client.query(
        `INSERT INTO deliveries (supplier_id, date, total_amount, payment_status, comment, tenant_id)
         VALUES ($1, $2, $3, 'unpaid', $4, $5) RETURNING id`,
        [dto.supplierId, dto.date || new Date().toISOString(), totalAmount, dto.comment, tenantID],
      );
      const deliveryId = delRows[0].id;

      for (const item of dto.items) {
        const itemTotal = (item.price || 0) * (item.quantity || 0);
        await client.query(
          `INSERT INTO delivery_items (delivery_id, product_id, quantity, price, total)
           VALUES ($1, $2, $3, $4, $5)`,
          [deliveryId, item.productId, item.quantity || 0, item.price || 0, itemTotal],
        );

        // Increase product stock — scoped to tenant (defense-in-depth so a
        // crafted productId from another tenant cannot mutate stock here).
        if (item.productId) {
          const upd = await client.query('UPDATE products SET stock = stock + $1 WHERE id = $2 AND tenant_id = $3', [
            item.quantity || 0,
            item.productId,
            tenantID,
          ]);
          if (upd.rowCount === 0) {
            throw new BadRequestException({ message: `Товар ${item.productId} не найден` });
          }
        }
      }

      // Update supplier totals — tenant_id filter mirrors the upfront check
      // above. Belt and suspenders so a future refactor can't drop the
      // assertion without also losing the WHERE clause.
      await client.query(
        `UPDATE suppliers SET total_purchases = total_purchases + $1, current_debt = current_debt + $1
         WHERE id = $2 AND tenant_id = $3`,
        [totalAmount, dto.supplierId, tenantID],
      );

      await client.query('COMMIT');
      return { id: deliveryId };
    } catch (err) {
      await client.query('ROLLBACK');
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`Delivery create error: ${err}`);
      throw new InternalServerErrorException({ message: 'Ошибка сервера' });
    } finally {
      client.release();
    }
  }

  // Payments

  async getPayments(tenantID: string, query: any) {
    let where = 'sp.tenant_id = $1';
    const params: any[] = [tenantID];
    let idx = 2;

    if (query.supplierId) {
      where += ` AND sp.supplier_id = $${idx++}`;
      params.push(query.supplierId);
    }

    const { rows } = await this.pool.query(
      `SELECT sp.* FROM supplier_payments sp WHERE ${where} ORDER BY sp.date DESC LIMIT 500`,
      params,
    );

    return rows.map((r) => ({
      id: r.id,
      supplierId: r.supplier_id,
      amount: parseFloat(r.amount) || 0,
      date: r.date,
      comment: r.comment,
      // Set when this payment was auto-created by «Оплатить сразу» at receiving (098).
      deliveryId: r.delivery_id ?? null,
    }));
  }

  async createPayment(tenantID: string, dto: any) {
    if (!dto.supplierId || !dto.amount) {
      throw new BadRequestException({ message: 'Поставщик и сумма обязательны' });
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Same cross-tenant guard as createDelivery — verify the supplier
      // lives in the caller's tenant before recording a payment against it.
      const { rows: supRows } = await client.query('SELECT 1 FROM suppliers WHERE id = $1 AND tenant_id = $2 LIMIT 1', [
        dto.supplierId,
        tenantID,
      ]);
      if (supRows.length === 0) {
        throw new BadRequestException({ message: 'Поставщик не найден' });
      }

      const { rows } = await client.query(
        `INSERT INTO supplier_payments (supplier_id, amount, date, comment, tenant_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [dto.supplierId, dto.amount, dto.date || new Date().toISOString(), dto.comment, tenantID],
      );

      await client.query(
        `UPDATE suppliers SET total_paid = total_paid + $1, current_debt = current_debt - $1
         WHERE id = $2 AND tenant_id = $3`,
        [dto.amount, dto.supplierId, tenantID],
      );

      await client.query('COMMIT');
      return { id: rows[0].id };
    } catch (err) {
      await client.query('ROLLBACK');
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`Payment create error: ${err}`);
      throw new InternalServerErrorException({ message: 'Ошибка сервера' });
    } finally {
      client.release();
    }
  }

  // ── Order-sourced supply (the Заказ → Поставка → Долг → Платёж seam) ─────────

  /**
   * Record a SUPPLY (поставка) created by receiving a purchase order, on the
   * CALLER'S open transaction. This is the reuse seam that wires PO receiving to
   * the existing supplier ledger — mirroring how PurchaseOrdersService already
   * reuses StockMovementsService.applyIncomeTx for stock.
   *
   * It writes a `deliveries` row (the «Поставки» tab) linked to the order, one
   * `delivery_items` row per received line (linked to its PO line), and moves the
   * SAME supplier balance the manual delivery / payment flow moves:
   *
   *   • debt mode («Без оплаты») → total_purchases += invoice, current_debt +=
   *     invoice. The supply is left payment_status='unpaid'; the owner settles it
   *     later through the normal supplier Payments flow (partial / full).
   *   • paid mode («Оплатить сразу») → total_purchases += invoice AND a
   *     supplier_payments row for the full invoice is auto-created (total_paid +=
   *     invoice, current_debt nets back to 0). The supply is payment_status='paid'
   *     and the payment row points back at it via delivery_id.
   *
   * CRITICAL — no double counting: stock has ALREADY been credited by the PO
   * receive (applyIncomeTx) before this is called, so this method NEVER touches
   * products.stock. It only writes the financial/ledger rows for the supply.
   *
   * Caller MUST already hold an open transaction on `client` (and SHOULD have
   * verified the supplier belongs to the tenant). This method issues no
   * BEGIN / COMMIT / ROLLBACK itself.
   */
  async recordOrderSupplyTx(
    client: PoolClient,
    tenantID: string,
    userID: string | null,
    params: {
      supplierId: string;
      purchaseOrderId: string;
      comment?: string | null;
      paymentMode: 'debt' | 'paid';
      lines: Array<{ productId: string; purchaseOrderItemId: string; quantity: number; price: number }>;
    },
  ): Promise<{ deliveryId: string; paymentId: string | null; invoiceTotal: number }> {
    // Invoice total (стоимость накладной) = Σ received qty × purchase price.
    let invoiceTotal = 0;
    for (const line of params.lines) {
      invoiceTotal += (Number(line.quantity) || 0) * (Number(line.price) || 0);
    }
    invoiceTotal = Math.round(invoiceTotal * 100) / 100;

    const paid = params.paymentMode === 'paid';

    // 1) The supply header (a deliveries row), linked to its order + receiver.
    const { rows: delRows } = await client.query(
      `INSERT INTO deliveries
         (supplier_id, date, total_amount, payment_status, comment, tenant_id, purchase_order_id, received_by)
       VALUES ($1, now(), $2, $3, $4, $5, $6, $7) RETURNING id`,
      [
        params.supplierId,
        invoiceTotal,
        paid ? 'paid' : 'unpaid',
        params.comment ?? null,
        tenantID,
        params.purchaseOrderId,
        userID,
      ],
    );
    const deliveryId = delRows[0].id;

    // 2) Supply lines (NO stock bump — already credited by the PO receive).
    for (const line of params.lines) {
      const qty = Number(line.quantity) || 0;
      const price = Number(line.price) || 0;
      const lineTotal = Math.round(qty * price * 100) / 100;
      await client.query(
        `INSERT INTO delivery_items (delivery_id, product_id, quantity, price, total, purchase_order_item_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [deliveryId, line.productId, qty, price, lineTotal, line.purchaseOrderItemId],
      );
    }

    // 3) Supplier debt rises by the invoice — the SAME ledger the manual
    //    delivery flow moves. Tenant-scoped UPDATE (defense in depth).
    await client.query(
      `UPDATE suppliers
          SET total_purchases = total_purchases + $1,
              current_debt    = current_debt + $1
        WHERE id = $2 AND tenant_id = $3`,
      [invoiceTotal, params.supplierId, tenantID],
    );

    // 4) «Оплатить сразу» — auto-create a payment for the full invoice, netting
    //    the debt back to 0 for this supply. Skipped when invoice is 0.
    let paymentId: string | null = null;
    if (paid && invoiceTotal > 0) {
      const { rows: payRows } = await client.query(
        `INSERT INTO supplier_payments (supplier_id, amount, date, comment, tenant_id, delivery_id)
         VALUES ($1, $2, now(), $3, $4, $5) RETURNING id`,
        [params.supplierId, invoiceTotal, 'Оплата при приёмке заказа', tenantID, deliveryId],
      );
      paymentId = payRows[0].id;
      await client.query(
        `UPDATE suppliers
            SET total_paid    = total_paid + $1,
                current_debt  = current_debt - $1
          WHERE id = $2 AND tenant_id = $3`,
        [invoiceTotal, params.supplierId, tenantID],
      );
    }

    return { deliveryId, paymentId, invoiceTotal };
  }
}
