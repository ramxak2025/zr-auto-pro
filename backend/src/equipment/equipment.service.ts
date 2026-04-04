import { Injectable, Inject, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';

@Injectable()
export class EquipmentService {
  private readonly logger = new Logger('EquipmentService');

  constructor(@Inject(PG_POOL) private pool: Pool) {}

  private mapItem(row: any) {
    return {
      id: row.id,
      userId: row.user_id,
      userName: row.user_name || null,
      userAvatar: row.user_avatar || null,
      name: row.name,
      description: row.description,
      photo: row.photo,
      cost: parseFloat(row.cost) || 0,
      source: row.source,
      productId: row.product_id,
      issuedAt: row.issued_at,
      serviceLifeMonths: row.service_life_months,
      expiresAt: row.expires_at,
      status: row.status,
      replacedBy: row.replaced_by,
      replacedAt: row.replaced_at,
      returnReason: row.return_reason,
      createdAt: row.created_at,
    };
  }

  async getAll(tenantId: string, query?: { userId?: string; status?: string }) {
    let where = 'e.tenant_id = $1';
    const params: any[] = [tenantId];
    let idx = 2;

    if (query?.userId) { where += ` AND e.user_id = $${idx++}`; params.push(query.userId); }
    if (query?.status) { where += ` AND e.status = $${idx++}`; params.push(query.status); }

    const { rows } = await this.pool.query(
      `SELECT e.*, u.full_name as user_name, u.avatar as user_avatar
       FROM equipment e
       JOIN users u ON u.id = e.user_id
       WHERE ${where}
       ORDER BY e.status = 'active' DESC, e.issued_at DESC
       LIMIT 500`,
      params,
    );
    return rows.map(r => this.mapItem(r));
  }

  async getById(id: string, tenantId: string) {
    const { rows } = await this.pool.query(
      `SELECT e.*, u.full_name as user_name, u.avatar as user_avatar
       FROM equipment e
       JOIN users u ON u.id = e.user_id
       WHERE e.id = $1 AND e.tenant_id = $2`,
      [id, tenantId],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Имущество не найдено' });
    return this.mapItem(rows[0]);
  }

  async getSummaryByUser(tenantId: string) {
    const { rows } = await this.pool.query(
      `SELECT u.id as user_id, u.full_name, u.avatar,
              COUNT(e.id) FILTER (WHERE e.status = 'active') as active_count,
              COALESCE(SUM(e.cost) FILTER (WHERE e.status = 'active'), 0) as total_cost,
              COUNT(e.id) FILTER (WHERE e.expires_at IS NOT NULL AND e.expires_at < now() AND e.status = 'active') as expired_count
       FROM users u
       LEFT JOIN equipment e ON e.user_id = u.id AND e.tenant_id = $1
       WHERE u.tenant_id = $1 AND u.is_active = true AND u.role IN ('master', 'admin')
       GROUP BY u.id, u.full_name, u.avatar
       ORDER BY u.full_name`,
      [tenantId],
    );
    return rows.map(r => ({
      userId: r.user_id,
      fullName: r.full_name,
      avatar: r.avatar,
      activeCount: parseInt(r.active_count) || 0,
      totalCost: parseFloat(r.total_cost) || 0,
      expiredCount: parseInt(r.expired_count) || 0,
    }));
  }

  async create(tenantId: string, dto: any) {
    const expiresAt = dto.serviceLifeMonths
      ? new Date(Date.now() + dto.serviceLifeMonths * 30 * 24 * 60 * 60 * 1000).toISOString()
      : null;

    // If sourcing from warehouse, deduct stock
    if (dto.source === 'warehouse' && dto.productId) {
      await this.pool.query(
        `UPDATE products SET stock = GREATEST(stock - 1, 0) WHERE id = $1 AND tenant_id = $2`,
        [dto.productId, tenantId],
      );
      // Create stock movement
      const { rows: prodRows } = await this.pool.query(
        'SELECT stock FROM products WHERE id = $1', [dto.productId],
      );
      if (prodRows.length > 0) {
        await this.pool.query(
          `INSERT INTO stock_movements (product_id, type, quantity, stock_before, stock_after, reason, tenant_id)
           VALUES ($1, 'expense', 1, $2, $3, $4, $5)`,
          [dto.productId, parseFloat(prodRows[0].stock) + 1, parseFloat(prodRows[0].stock), `Выдано: ${dto.name} сотруднику`, tenantId],
        );
      }
    }

    const { rows } = await this.pool.query(
      `INSERT INTO equipment (tenant_id, user_id, name, description, photo, cost, source, product_id, service_life_months, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [tenantId, dto.userId, dto.name, dto.description, dto.photo, dto.cost || 0,
       dto.source || 'new', dto.productId || null, dto.serviceLifeMonths || null, expiresAt],
    );

    return this.mapItem(rows[0]);
  }

  async update(id: string, tenantId: string, dto: any) {
    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (dto.name !== undefined) { sets.push(`name=$${idx++}`); vals.push(dto.name); }
    if (dto.description !== undefined) { sets.push(`description=$${idx++}`); vals.push(dto.description); }
    if (dto.photo !== undefined) { sets.push(`photo=$${idx++}`); vals.push(dto.photo); }
    if (dto.cost !== undefined) { sets.push(`cost=$${idx++}`); vals.push(dto.cost); }
    if (dto.serviceLifeMonths !== undefined) {
      sets.push(`service_life_months=$${idx++}`); vals.push(dto.serviceLifeMonths);
      if (dto.serviceLifeMonths) {
        const expiresAt = new Date(Date.now() + dto.serviceLifeMonths * 30 * 24 * 60 * 60 * 1000).toISOString();
        sets.push(`expires_at=$${idx++}`); vals.push(expiresAt);
      }
    }

    if (sets.length === 0) return this.getById(id, tenantId);

    vals.push(id, tenantId);
    const { rows } = await this.pool.query(
      `UPDATE equipment SET ${sets.join(', ')} WHERE id=$${idx++} AND tenant_id=$${idx} RETURNING *`,
      vals,
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Не найдено' });
    return this.mapItem(rows[0]);
  }

  async replace(id: string, tenantId: string, dto: any) {
    // Mark old item as replaced
    await this.pool.query(
      `UPDATE equipment SET status = 'replaced', replaced_at = now(), return_reason = $3
       WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId, dto.reason || 'Замена'],
    );

    // Get old item info
    const old = await this.getById(id, tenantId);

    // Create new item
    const newItem = await this.create(tenantId, {
      userId: old.userId,
      name: dto.name || old.name,
      description: dto.description || old.description,
      photo: dto.photo || old.photo,
      cost: dto.cost ?? old.cost,
      source: dto.source || 'new',
      productId: dto.productId,
      serviceLifeMonths: dto.serviceLifeMonths ?? old.serviceLifeMonths,
    });

    // Link old to new
    await this.pool.query(
      'UPDATE equipment SET replaced_by = $1 WHERE id = $2',
      [newItem.id, id],
    );

    return newItem;
  }

  async writeOff(id: string, tenantId: string, reason?: string) {
    const { rows } = await this.pool.query(
      `UPDATE equipment SET status = 'written_off', return_reason = $3, replaced_at = now()
       WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [id, tenantId, reason || 'Списание'],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Не найдено' });
    return this.mapItem(rows[0]);
  }

  async returnItem(id: string, tenantId: string, reason?: string) {
    const { rows } = await this.pool.query(
      `UPDATE equipment SET status = 'returned', return_reason = $3, replaced_at = now()
       WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [id, tenantId, reason || 'Возврат'],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Не найдено' });
    return this.mapItem(rows[0]);
  }

  async remove(id: string, tenantId: string) {
    await this.pool.query('DELETE FROM equipment WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    return { message: 'Удалено' };
  }
}
