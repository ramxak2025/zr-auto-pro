import { Injectable, Inject, NotFoundException, BadRequestException, InternalServerErrorException, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';

@Injectable()
export class SuppliersService {
  private readonly logger = new Logger('SuppliersService');

  constructor(@Inject(PG_POOL) private pool: Pool) {}

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
      createdAt: row.created_at,
    };
  }

  async getAll(tenantID: string, query: any) {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 50;
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

    const countResult = await this.pool.query(
      `SELECT COUNT(*) as total FROM suppliers WHERE ${where}`,
      params,
    );
    const total = parseInt(countResult.rows[0].total);

    params.push(limit, offset);
    const { rows } = await this.pool.query(
      `SELECT * FROM suppliers WHERE ${where} ORDER BY name LIMIT $${idx} OFFSET $${idx + 1}`,
      params,
    );

    return { data: rows.map(this.mapSupplier), total, page, limit };
  }

  async getById(id: string, tenantID: string) {
    const { rows } = await this.pool.query(
      'SELECT * FROM suppliers WHERE id=$1 AND tenant_id=$2',
      [id, tenantID],
    );
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
    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (dto.name !== undefined) { sets.push(`name=$${idx++}`); vals.push(dto.name); }
    if (dto.phone !== undefined) { sets.push(`phone=$${idx++}`); vals.push(dto.phone); }
    if (dto.contactPerson !== undefined) { sets.push(`contact_person=$${idx++}`); vals.push(dto.contactPerson); }
    if (dto.comment !== undefined) { sets.push(`comment=$${idx++}`); vals.push(dto.comment); }

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
    await this.pool.query('DELETE FROM suppliers WHERE id=$1 AND tenant_id=$2', [id, tenantID]);
    return { message: 'Удалено' };
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
      id: r.id, supplierId: r.supplier_id,
      supplier: { id: r.supplier_id, name: r.supplier_name },
      date: r.date, totalAmount: parseFloat(r.total_amount) || 0,
      paymentStatus: r.payment_status, comment: r.comment,
    };

    const { rows: itemRows } = await this.pool.query(
      `SELECT di.*, p.name as product_name
       FROM delivery_items di LEFT JOIN products p ON p.id = di.product_id
       WHERE di.delivery_id=$1`,
      [id],
    );
    delivery.items = itemRows.map((item) => ({
      id: item.id, productId: item.product_id,
      product: item.product_name ? { id: item.product_id, name: item.product_name } : undefined,
      quantity: parseFloat(item.quantity) || 0,
      price: parseFloat(item.price) || 0,
      total: parseFloat(item.total) || 0,
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
      const { rows: supRows } = await client.query(
        'SELECT 1 FROM suppliers WHERE id = $1 AND tenant_id = $2 LIMIT 1',
        [dto.supplierId, tenantID],
      );
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
          const upd = await client.query(
            'UPDATE products SET stock = stock + $1 WHERE id = $2 AND tenant_id = $3',
            [item.quantity || 0, item.productId, tenantID],
          );
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
      const { rows: supRows } = await client.query(
        'SELECT 1 FROM suppliers WHERE id = $1 AND tenant_id = $2 LIMIT 1',
        [dto.supplierId, tenantID],
      );
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
}
