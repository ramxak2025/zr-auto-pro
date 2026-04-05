import { Injectable, Inject, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';

@Injectable()
export class EquipmentService {
  private readonly logger = new Logger('EquipmentService');

  constructor(@Inject(PG_POOL) private pool: Pool) {}

  // ─── Storage Categories (folders) ─────────────────────────────────

  async getCategories(tenantId: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM storage_categories WHERE tenant_id = $1 ORDER BY sort_order, name`,
      [tenantId],
    );
    return rows.map(r => ({ id: r.id, name: r.name, parentId: r.parent_id, sortOrder: r.sort_order }));
  }

  async createCategory(tenantId: string, dto: any) {
    const { rows } = await this.pool.query(
      `INSERT INTO storage_categories (tenant_id, name, parent_id, sort_order) VALUES ($1, $2, $3, $4) RETURNING *`,
      [tenantId, dto.name, dto.parentId || null, dto.sortOrder || 0],
    );
    return { id: rows[0].id, name: rows[0].name, parentId: rows[0].parent_id };
  }

  async removeCategory(id: string, tenantId: string) {
    await this.pool.query('DELETE FROM storage_categories WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    return { message: 'Удалено' };
  }

  // ─── Storage Items (подсобка) ─────────────────────────────────────

  async getStorageItems(tenantId: string, query?: { categoryId?: string; search?: string }) {
    let where = 'si.tenant_id = $1';
    const params: any[] = [tenantId];
    let idx = 2;
    if (query?.categoryId) { where += ` AND si.category_id = $${idx++}`; params.push(query.categoryId); }
    if (query?.search) { where += ` AND si.name ILIKE $${idx++}`; params.push(`%${query.search}%`); }

    const { rows } = await this.pool.query(
      `SELECT si.*, sc.name as category_name
       FROM storage_items si LEFT JOIN storage_categories sc ON sc.id = si.category_id
       WHERE ${where} ORDER BY si.name LIMIT 500`,
      params,
    );
    return rows.map(r => ({
      id: r.id, name: r.name, description: r.description, photo: r.photo,
      purchasePrice: parseFloat(r.purchase_price) || 0, quantity: parseInt(r.quantity) || 0,
      unit: r.unit, serviceLifeMonths: r.service_life_months,
      categoryId: r.category_id, categoryName: r.category_name,
    }));
  }

  async createStorageItem(tenantId: string, dto: any) {
    const { rows } = await this.pool.query(
      `INSERT INTO storage_items (tenant_id, category_id, name, description, photo, purchase_price, quantity, unit, service_life_months)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [tenantId, dto.categoryId || null, dto.name, dto.description, dto.photo,
       dto.purchasePrice || 0, dto.quantity || 0, dto.unit || 'шт', dto.serviceLifeMonths || null],
    );
    return this.mapStorageItem(rows[0]);
  }

  async updateStorageItem(id: string, tenantId: string, dto: any) {
    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;
    if (dto.name !== undefined) { sets.push(`name=$${idx++}`); vals.push(dto.name); }
    if (dto.description !== undefined) { sets.push(`description=$${idx++}`); vals.push(dto.description); }
    if (dto.photo !== undefined) { sets.push(`photo=$${idx++}`); vals.push(dto.photo); }
    if (dto.purchasePrice !== undefined) { sets.push(`purchase_price=$${idx++}`); vals.push(dto.purchasePrice); }
    if (dto.quantity !== undefined) { sets.push(`quantity=$${idx++}`); vals.push(dto.quantity); }
    if (dto.unit !== undefined) { sets.push(`unit=$${idx++}`); vals.push(dto.unit); }
    if (dto.serviceLifeMonths !== undefined) { sets.push(`service_life_months=$${idx++}`); vals.push(dto.serviceLifeMonths); }
    if (dto.categoryId !== undefined) { sets.push(`category_id=$${idx++}`); vals.push(dto.categoryId); }
    if (sets.length === 0) return;
    vals.push(id, tenantId);
    await this.pool.query(`UPDATE storage_items SET ${sets.join(', ')} WHERE id=$${idx++} AND tenant_id=$${idx}`, vals);
    return { message: 'Обновлено' };
  }

  async removeStorageItem(id: string, tenantId: string) {
    await this.pool.query('DELETE FROM storage_items WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    return { message: 'Удалено' };
  }

  private mapStorageItem(r: any) {
    return {
      id: r.id, name: r.name, description: r.description, photo: r.photo,
      purchasePrice: parseFloat(r.purchase_price) || 0, quantity: parseInt(r.quantity) || 0,
      unit: r.unit, serviceLifeMonths: r.service_life_months,
      categoryId: r.category_id, categoryName: r.category_name,
    };
  }

  // ─── Issued Equipment ─────────────────────────────────────────────

  async getIssuedByUser(tenantId: string, userId: string, includeInactive = false) {
    const statusFilter = includeInactive ? '' : `AND ei.status = 'active'`;
    const { rows } = await this.pool.query(
      `SELECT ei.*, u.full_name as user_name, u.avatar as user_avatar
       FROM equipment_issued ei JOIN users u ON u.id = ei.user_id
       WHERE ei.tenant_id = $1 AND ei.user_id = $2 ${statusFilter}
       ORDER BY ei.category_type, ei.issued_at DESC LIMIT 200`,
      [tenantId, userId],
    );
    return rows.map(r => this.mapIssued(r));
  }

  async getEmployeeSummary(tenantId: string) {
    const { rows } = await this.pool.query(
      `SELECT u.id, u.full_name, u.avatar, u.role,
              COUNT(ei.id) FILTER (WHERE ei.status = 'active') as active_count,
              COALESCE(SUM(ei.cost) FILTER (WHERE ei.status = 'active'), 0) as total_cost,
              COUNT(ei.id) FILTER (WHERE ei.status = 'active' AND ei.category_type = 'tools') as tools_count,
              COUNT(ei.id) FILTER (WHERE ei.status = 'active' AND ei.category_type = 'uniform') as uniform_count,
              COUNT(ei.id) FILTER (WHERE ei.expires_at < now() AND ei.status = 'active') as expired_count
       FROM users u
       LEFT JOIN equipment_issued ei ON ei.user_id = u.id AND ei.tenant_id = $1
       WHERE u.tenant_id = $1 AND u.is_active = true AND u.role IN ('master', 'admin')
       GROUP BY u.id ORDER BY u.full_name`,
      [tenantId],
    );
    return rows.map(r => ({
      userId: r.id, fullName: r.full_name, avatar: r.avatar, role: r.role,
      activeCount: parseInt(r.active_count) || 0,
      totalCost: parseFloat(r.total_cost) || 0,
      toolsCount: parseInt(r.tools_count) || 0,
      uniformCount: parseInt(r.uniform_count) || 0,
      expiredCount: parseInt(r.expired_count) || 0,
    }));
  }

  async issueToEmployee(tenantId: string, dto: any) {
    const expiresAt = dto.serviceLifeMonths
      ? new Date(Date.now() + dto.serviceLifeMonths * 30 * 24 * 3600000).toISOString()
      : null;

    // Deduct from storage if linked
    if (dto.storageItemId) {
      await this.pool.query(
        `UPDATE storage_items SET quantity = GREATEST(quantity - 1, 0) WHERE id = $1 AND tenant_id = $2`,
        [dto.storageItemId, tenantId],
      );
    }

    const { rows } = await this.pool.query(
      `INSERT INTO equipment_issued (tenant_id, user_id, storage_item_id, name, description, photo, cost, category_type, service_life_months, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [tenantId, dto.userId, dto.storageItemId || null, dto.name, dto.description,
       dto.photo, dto.cost || 0, dto.categoryType || 'tools', dto.serviceLifeMonths || null, expiresAt],
    );
    return this.mapIssued(rows[0]);
  }

  async replaceItem(id: string, tenantId: string, dto: any) {
    // Get old item
    const { rows: oldRows } = await this.pool.query(
      'SELECT * FROM equipment_issued WHERE id = $1 AND tenant_id = $2', [id, tenantId],
    );
    if (oldRows.length === 0) throw new NotFoundException({ message: 'Не найдено' });
    const old = oldRows[0];

    // Move old to chosen destination
    if (dto.oldDestination === 'storage' && old.storage_item_id) {
      // Return to storage
      await this.pool.query(
        'UPDATE storage_items SET quantity = quantity + 1 WHERE id = $1', [old.storage_item_id],
      );
      await this.pool.query(
        `UPDATE equipment_issued SET status = 'returned', return_reason = $2, trashed_at = now() WHERE id = $1`,
        [id, dto.reason || 'Возврат на склад'],
      );
    } else {
      // Trash old
      const trashExpires = new Date(Date.now() + 7 * 24 * 3600000).toISOString();
      await this.pool.query(
        `UPDATE equipment_issued SET status = 'trashed', return_reason = $2, trashed_at = now(), trash_expires_at = $3 WHERE id = $1`,
        [id, dto.reason || 'Замена', trashExpires],
      );
    }

    // Issue new
    return this.issueToEmployee(tenantId, {
      userId: old.user_id,
      storageItemId: dto.newStorageItemId || null,
      name: dto.name || old.name,
      description: dto.description || old.description,
      photo: dto.photo || old.photo,
      cost: dto.cost ?? parseFloat(old.cost),
      categoryType: old.category_type,
      serviceLifeMonths: dto.serviceLifeMonths ?? old.service_life_months,
    });
  }

  async trashItem(id: string, tenantId: string, reason?: string) {
    const trashExpires = new Date(Date.now() + 7 * 24 * 3600000).toISOString();
    await this.pool.query(
      `UPDATE equipment_issued SET status = 'trashed', return_reason = $3, trashed_at = now(), trash_expires_at = $4
       WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId, reason || 'Списание', trashExpires],
    );
    return { message: 'В корзину' };
  }

  async restoreFromTrash(id: string, tenantId: string) {
    await this.pool.query(
      `UPDATE equipment_issued SET status = 'active', trashed_at = NULL, trash_expires_at = NULL, return_reason = NULL
       WHERE id = $1 AND tenant_id = $2 AND status = 'trashed'`,
      [id, tenantId],
    );
    return { message: 'Восстановлено' };
  }

  async getTrash(tenantId: string) {
    const { rows } = await this.pool.query(
      `SELECT ei.*, u.full_name as user_name
       FROM equipment_issued ei JOIN users u ON u.id = ei.user_id
       WHERE ei.tenant_id = $1 AND ei.status = 'trashed' AND (ei.trash_expires_at IS NULL OR ei.trash_expires_at > now())
       ORDER BY ei.trashed_at DESC LIMIT 100`,
      [tenantId],
    );
    return rows.map(r => this.mapIssued(r));
  }

  async permanentDelete(id: string, tenantId: string) {
    await this.pool.query('DELETE FROM equipment_issued WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    return { message: 'Удалено навсегда' };
  }

  async returnToStorage(id: string, tenantId: string) {
    const { rows } = await this.pool.query(
      'SELECT * FROM equipment_issued WHERE id = $1 AND tenant_id = $2', [id, tenantId],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Не найдено' });
    if (rows[0].storage_item_id) {
      await this.pool.query(
        'UPDATE storage_items SET quantity = quantity + 1 WHERE id = $1', [rows[0].storage_item_id],
      );
    }
    await this.pool.query(
      `UPDATE equipment_issued SET status = 'returned', return_reason = 'Возврат на склад', trashed_at = now() WHERE id = $1`,
      [id],
    );
    return { message: 'Возвращено на склад' };
  }

  // My equipment (for masters)
  async getMyEquipment(tenantId: string, userId: string) {
    return this.getIssuedByUser(tenantId, userId, false);
  }

  private mapIssued(r: any) {
    return {
      id: r.id, userId: r.user_id, userName: r.user_name || null, userAvatar: r.user_avatar || null,
      storageItemId: r.storage_item_id, name: r.name, description: r.description,
      photo: r.photo, cost: parseFloat(r.cost) || 0, categoryType: r.category_type,
      issuedAt: r.issued_at, serviceLifeMonths: r.service_life_months,
      expiresAt: r.expires_at, status: r.status,
      trashedAt: r.trashed_at, trashExpiresAt: r.trash_expires_at,
      returnReason: r.return_reason, replacedBy: r.replaced_by,
    };
  }
}
