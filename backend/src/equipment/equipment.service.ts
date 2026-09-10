import { Injectable, Inject, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { resolvePointForWrite } from '../common/point-scope';

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
    return rows.map((r) => ({ id: r.id, name: r.name, parentId: r.parent_id, sortOrder: r.sort_order }));
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
    if (query?.categoryId) {
      where += ` AND si.category_id = $${idx++}`;
      params.push(query.categoryId);
    }
    if (query?.search) {
      where += ` AND si.name ILIKE $${idx++}`;
      params.push(`%${query.search}%`);
    }

    const { rows } = await this.pool.query(
      `SELECT si.*, sc.name as category_name
       FROM storage_items si LEFT JOIN storage_categories sc ON sc.id = si.category_id
       WHERE ${where} ORDER BY si.name LIMIT 500`,
      params,
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      photo: r.photo,
      purchasePrice: parseFloat(r.purchase_price) || 0,
      quantity: parseInt(r.quantity) || 0,
      unit: r.unit,
      serviceLifeMonths: r.service_life_months,
      categoryId: r.category_id,
      categoryName: r.category_name,
    }));
  }

  /**
   * Add a storage item (подсобка). When a purchase price is set, atomically
   * record an expense in the reserved «Имущество» category linked back to the
   * new item via `storage_item_id` (#14). Equipment + expense are written in
   * one transaction so they can never disagree.
   */
  /**
   * 161 — `pointId` (текущий филиал автора) уходит в зеркальный расход
   * «Покупка имущества»: оборудование покупается ДЛЯ конкретного филиала, и
   * его стоимость обязана резать прибыль именно этого филиала.
   */
  async createStorageItem(tenantId: string, createdBy: string | null, dto: any, pointId: string | null = null) {
    const purchasePrice = parseFloat(String(dto.purchasePrice ?? 0)) || 0;
    // «Цена, ₽» is per-unit; quantity is a separate column. The cash outflow is
    // the full purchase, so the linked expense must be pricePerUnit × quantity.
    const qty = parseFloat(String(dto.quantity ?? 0)) || 0;
    const expenseAmount = purchasePrice * Math.max(qty, 1);

    // ФИЛИАЛ ЗЕРКАЛЬНОГО РАСХОДА (волна 4). Раньше сюда приезжала сырая точка
    // актора, и в режиме «Все точки» покупка имущества рождала расход с
    // point_id = NULL: деньги ушли, а из прибыли и «Движения денег» КАЖДОГО
    // филиала эта покупка выпадала. Общий резолв — своя точка, либо
    // единственная доступная, либо 400 «Выберите филиал».
    //
    // Резолвим ТОЛЬКО когда расход реально родится (цена > 0): бесплатное
    // имущество денег не двигает, и требовать под него филиал незачем.
    // Резолв ДО pool.connect() — вторая коннекция под открытой транзакцией на
    // исчерпанном пуле даёт взаимную блокировку.
    const writePointId =
      purchasePrice > 0
        ? await resolvePointForWrite(
            this.pool,
            { tenantID: tenantId, userID: createdBy, currentPointId: pointId },
            'чтобы записать покупку имущества',
          )
        : pointId;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query(
        `INSERT INTO storage_items (tenant_id, category_id, name, description, photo, purchase_price, quantity, unit, service_life_months)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [
          tenantId,
          dto.categoryId || null,
          dto.name,
          dto.description,
          dto.photo,
          purchasePrice,
          dto.quantity || 0,
          dto.unit || 'шт',
          dto.serviceLifeMonths || null,
        ],
      );
      const item = rows[0];

      // Only money-bearing purchases create an expense. Guard against a double
      // expense if a row already references this freshly-minted id (shouldn't
      // happen inside one tx, but keeps the operation idempotent on retry).
      if (purchasePrice > 0) {
        const categoryId = await this.getOrCreateEquipmentCategory(client, tenantId);
        const { rows: dup } = await client.query(
          'SELECT 1 FROM expenses WHERE storage_item_id = $1 AND tenant_id = $2 LIMIT 1',
          [item.id, tenantId],
        );
        if (dup.length === 0) {
          await client.query(
            `INSERT INTO expenses (category_id, amount, description, date, user_id, created_by, source, approval_status, tenant_id, storage_item_id, point_id)
             VALUES ($1, $2, $3, now(), $4, $4, 'owner', 'approved', $5, $6, $7)`,
            [categoryId, expenseAmount, `Покупка имущества: ${item.name}`, createdBy, tenantId, item.id, writePointId],
          );
        }
      }

      await client.query('COMMIT');
      return this.mapStorageItem(item);
    } catch (err) {
      await client.query('ROLLBACK');
      this.logger.error(`createStorageItem error: ${err}`);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Lookup-or-create the reserved «Имущество» expense category for a tenant.
   * Never throws on "missing" — it creates the row. Runs on the supplied
   * client so it participates in the caller's transaction.
   */
  private async getOrCreateEquipmentCategory(client: any, tenantId: string): Promise<string> {
    const { rows } = await client.query(
      `SELECT id FROM expense_categories WHERE tenant_id = $1 AND name = 'Имущество' LIMIT 1`,
      [tenantId],
    );
    if (rows.length > 0) return rows[0].id as string;
    // Race-safe insert: the partial unique index uq_expense_categories_imushchestvo
    // (migration 060) guarantees at most one «Имущество» row per tenant, so a
    // concurrent insert collapses to ON CONFLICT DO NOTHING. When that happens we
    // get zero rows back and re-SELECT the row the other transaction created.
    const { rows: created } = await client.query(
      `INSERT INTO expense_categories (name, tenant_id) VALUES ('Имущество', $1)
       ON CONFLICT DO NOTHING RETURNING id`,
      [tenantId],
    );
    if (created.length > 0) return created[0].id as string;
    const { rows: existing } = await client.query(
      `SELECT id FROM expense_categories WHERE tenant_id = $1 AND name = 'Имущество' LIMIT 1`,
      [tenantId],
    );
    return existing[0].id as string;
  }

  /**
   * 161 — `pointId` нужен ТОЛЬКО когда цена подняли с нуля и расход рождается
   * впервые: у уже существующего расхода филиал не переписываем (расход
   * принадлежит филиалу ПОКУПКИ, а правит карточку может кто угодно и откуда
   * угодно — перенос сдвинул бы прибыль сразу двух филиалов задним числом).
   *
   * ВОЛНА 4 — сырая точка актора заменена общим резолвом
   * (common/point-scope.resolvePointForWrite): в режиме «Все точки» расход
   * рождался с point_id = NULL и не попадал ни в один филиальный срез.
   */
  async updateStorageItem(
    id: string,
    tenantId: string,
    dto: any,
    actorId: string | null = null,
    pointId: string | null = null,
  ) {
    const buildSets = () => {
      const sets: string[] = [];
      const vals: any[] = [];
      let idx = 1;
      if (dto.name !== undefined) {
        sets.push(`name=$${idx++}`);
        vals.push(dto.name);
      }
      if (dto.description !== undefined) {
        sets.push(`description=$${idx++}`);
        vals.push(dto.description);
      }
      if (dto.photo !== undefined) {
        sets.push(`photo=$${idx++}`);
        vals.push(dto.photo);
      }
      if (dto.purchasePrice !== undefined) {
        sets.push(`purchase_price=$${idx++}`);
        vals.push(dto.purchasePrice);
      }
      if (dto.quantity !== undefined) {
        sets.push(`quantity=$${idx++}`);
        vals.push(dto.quantity);
      }
      if (dto.unit !== undefined) {
        sets.push(`unit=$${idx++}`);
        vals.push(dto.unit);
      }
      if (dto.serviceLifeMonths !== undefined) {
        sets.push(`service_life_months=$${idx++}`);
        vals.push(dto.serviceLifeMonths);
      }
      if (dto.categoryId !== undefined) {
        sets.push(`category_id=$${idx++}`);
        vals.push(dto.categoryId);
      }
      return { sets, vals, idx };
    };

    // Non-price edits keep the original single-query fast path.
    if (dto.purchasePrice === undefined) {
      const { sets, vals, idx } = buildSets();
      if (sets.length === 0) return;
      let i = idx;
      vals.push(id, tenantId);
      await this.pool.query(`UPDATE storage_items SET ${sets.join(', ')} WHERE id=$${i++} AND tenant_id=$${i}`, vals);
      return { message: 'Обновлено' };
    }

    // Price changed → the linked «Имущество» auto-expense must be reconciled so
    // the cash outflow keeps matching pricePerUnit × quantity (#14). Item update
    // and expense reconciliation run in one transaction so they can't disagree.
    const newPrice = parseFloat(String(dto.purchasePrice ?? 0)) || 0;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const { sets, vals, idx } = buildSets();
      let i = idx;
      vals.push(id, tenantId);
      const { rows: updated } = await client.query(
        `UPDATE storage_items SET ${sets.join(', ')} WHERE id=$${i++} AND tenant_id=$${i} RETURNING quantity`,
        vals,
      );
      if (updated.length === 0) {
        // Item missing or foreign — nothing to reconcile.
        await client.query('COMMIT');
        return { message: 'Обновлено' };
      }

      // Effective quantity after the update (new value if supplied, else current).
      const qty = parseFloat(String(updated[0].quantity ?? 0)) || 0;
      const expenseAmount = newPrice * Math.max(qty, 1);

      const { rows: existing } = await client.query(
        'SELECT id FROM expenses WHERE storage_item_id = $1 AND tenant_id = $2 LIMIT 1',
        [id, tenantId],
      );

      if (existing.length > 0) {
        if (newPrice > 0) {
          await client.query('UPDATE expenses SET amount = $1 WHERE storage_item_id = $2 AND tenant_id = $3', [
            expenseAmount,
            id,
            tenantId,
          ]);
        } else {
          // Price dropped to 0 → no cash outflow remains, drop the linked expense.
          await client.query('DELETE FROM expenses WHERE storage_item_id = $1 AND tenant_id = $2', [id, tenantId]);
        }
      } else if (newPrice > 0) {
        // No linked expense yet (item created at price 0, now priced) → create it
        // via the same reserved-category path as createStorageItem.
        //
        // ФИЛИАЛ резолвится ИМЕННО ЗДЕСЬ, а не до транзакции: только в этой
        // ветке расход действительно рождается. Резолв до pool.connect()
        // потребовал бы гадать снаружи, есть ли уже связанный расход, и
        // отвечал бы 400 «Выберите филиал» на безобидную правку цены у
        // существующего расхода. Дедлока нет: резолв идёт по УЖЕ ВЗЯТОМУ
        // клиенту транзакции, второй коннекции из пула не берётся (см.
        // PointScopeQueryable — «подойдёт и пул, и клиент внутри транзакции»).
        const writePointId = await resolvePointForWrite(
          client,
          { tenantID: tenantId, userID: actorId, currentPointId: pointId },
          'чтобы записать покупку имущества',
        );
        const categoryId = await this.getOrCreateEquipmentCategory(client, tenantId);
        const { rows: nameRows } = await client.query(
          'SELECT name FROM storage_items WHERE id = $1 AND tenant_id = $2 LIMIT 1',
          [id, tenantId],
        );
        const itemName = nameRows[0]?.name ?? '';
        await client.query(
          `INSERT INTO expenses (category_id, amount, description, date, source, approval_status, tenant_id, storage_item_id, point_id)
           VALUES ($1, $2, $3, now(), 'owner', 'approved', $4, $5, $6)`,
          [categoryId, expenseAmount, `Покупка имущества: ${itemName}`, tenantId, id, writePointId],
        );
      }

      await client.query('COMMIT');
      return { message: 'Обновлено' };
    } catch (err) {
      await client.query('ROLLBACK');
      // 400 «Выберите филиал» — это диалог с пользователем, а не сбой сервера:
      // в error-лог (и в Sentry) он попадать не должен.
      if (err instanceof BadRequestException) throw err;
      this.logger.error(`updateStorageItem error: ${err}`);
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Delete a storage item. The linked auto-expense (#14) is handled per the
   * owner-confirmed dialog:
   *   reverseExpense = true  → "вернуть деньги в оборот": the linked expense
   *                            is deleted, so the money is returned to circulation.
   *   reverseExpense = false → "расход остаётся": the expense is kept; its
   *                            storage_item_id is cleared (ON DELETE SET NULL
   *                            would do this anyway, but we null it explicitly
   *                            in the same tx for clarity).
   */
  async removeStorageItem(id: string, tenantId: string, reverseExpense = false) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      if (reverseExpense) {
        await client.query('DELETE FROM expenses WHERE storage_item_id = $1 AND tenant_id = $2', [id, tenantId]);
      } else {
        await client.query('UPDATE expenses SET storage_item_id = NULL WHERE storage_item_id = $1 AND tenant_id = $2', [
          id,
          tenantId,
        ]);
      }

      await client.query('DELETE FROM storage_items WHERE id = $1 AND tenant_id = $2', [id, tenantId]);

      await client.query('COMMIT');
      return { message: reverseExpense ? 'Удалено, расход возвращён в оборот' : 'Удалено' };
    } catch (err) {
      await client.query('ROLLBACK');
      this.logger.error(`removeStorageItem error: ${err}`);
      throw err;
    } finally {
      client.release();
    }
  }

  private mapStorageItem(r: any) {
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      photo: r.photo,
      purchasePrice: parseFloat(r.purchase_price) || 0,
      quantity: parseInt(r.quantity) || 0,
      unit: r.unit,
      serviceLifeMonths: r.service_life_months,
      categoryId: r.category_id,
      categoryName: r.category_name,
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
    return rows.map((r) => this.mapIssued(r));
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
    return rows.map((r) => ({
      userId: r.id,
      fullName: r.full_name,
      avatar: r.avatar,
      role: r.role,
      activeCount: parseInt(r.active_count) || 0,
      totalCost: parseFloat(r.total_cost) || 0,
      toolsCount: parseInt(r.tools_count) || 0,
      uniformCount: parseInt(r.uniform_count) || 0,
      expiredCount: parseInt(r.expired_count) || 0,
    }));
  }

  async issueToEmployee(tenantId: string, dto: any) {
    // Refuse to issue equipment to a user that doesn't belong to this tenant.
    // Otherwise a director could pin equipment records to a foreign user_id
    // and have it appear in their tenant's listing tied to a name fetched
    // via JOIN from another tenant's users row.
    if (!dto.userId) {
      throw new BadRequestException({ message: 'Сотрудник обязателен' });
    }
    const { rows: userRows } = await this.pool.query('SELECT 1 FROM users WHERE id = $1 AND tenant_id = $2 LIMIT 1', [
      dto.userId,
      tenantId,
    ]);
    if (userRows.length === 0) {
      throw new BadRequestException({ message: 'Сотрудник не найден' });
    }

    const expiresAt = dto.serviceLifeMonths
      ? new Date(Date.now() + dto.serviceLifeMonths * 30 * 24 * 3600000).toISOString()
      : null;

    // Deduct from storage if linked
    if (dto.storageItemId) {
      const upd = await this.pool.query(
        `UPDATE storage_items SET quantity = GREATEST(quantity - 1, 0) WHERE id = $1 AND tenant_id = $2`,
        [dto.storageItemId, tenantId],
      );
      if (upd.rowCount === 0) {
        // Storage item is missing OR belongs to another tenant — refuse
        // rather than silently issuing equipment without deducting stock.
        throw new BadRequestException({ message: 'Склад: позиция не найдена' });
      }
    }

    const { rows } = await this.pool.query(
      `INSERT INTO equipment_issued (tenant_id, user_id, storage_item_id, name, description, photo, cost, category_type, service_life_months, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [
        tenantId,
        dto.userId,
        dto.storageItemId || null,
        dto.name,
        dto.description,
        dto.photo,
        dto.cost || 0,
        dto.categoryType || 'tools',
        dto.serviceLifeMonths || null,
        expiresAt,
      ],
    );
    return this.mapIssued(rows[0]);
  }

  async replaceItem(id: string, tenantId: string, dto: any) {
    // Get old item
    const { rows: oldRows } = await this.pool.query('SELECT * FROM equipment_issued WHERE id = $1 AND tenant_id = $2', [
      id,
      tenantId,
    ]);
    if (oldRows.length === 0) throw new NotFoundException({ message: 'Не найдено' });
    const old = oldRows[0];

    // Move old to chosen destination. Every UPDATE here doubles up the
    // tenant_id filter even though `old` is already verified to belong to
    // the caller's tenant — belt and suspenders so a future refactor can't
    // drop the upfront check without also losing the WHERE clause.
    if (dto.oldDestination === 'storage' && old.storage_item_id) {
      // Return to storage
      await this.pool.query('UPDATE storage_items SET quantity = quantity + 1 WHERE id = $1 AND tenant_id = $2', [
        old.storage_item_id,
        tenantId,
      ]);
      await this.pool.query(
        `UPDATE equipment_issued SET status = 'returned', return_reason = $3, trashed_at = now()
         WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId, dto.reason || 'Возврат на склад'],
      );
    } else {
      // Trash old
      const trashExpires = new Date(Date.now() + 7 * 24 * 3600000).toISOString();
      await this.pool.query(
        `UPDATE equipment_issued SET status = 'trashed', return_reason = $3, trashed_at = now(), trash_expires_at = $4
         WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId, dto.reason || 'Замена', trashExpires],
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
    return rows.map((r) => this.mapIssued(r));
  }

  async permanentDelete(id: string, tenantId: string) {
    await this.pool.query('DELETE FROM equipment_issued WHERE id = $1 AND tenant_id = $2', [id, tenantId]);
    return { message: 'Удалено навсегда' };
  }

  async returnToStorage(id: string, tenantId: string) {
    const { rows } = await this.pool.query('SELECT * FROM equipment_issued WHERE id = $1 AND tenant_id = $2', [
      id,
      tenantId,
    ]);
    if (rows.length === 0) throw new NotFoundException({ message: 'Не найдено' });
    if (rows[0].storage_item_id) {
      await this.pool.query('UPDATE storage_items SET quantity = quantity + 1 WHERE id = $1 AND tenant_id = $2', [
        rows[0].storage_item_id,
        tenantId,
      ]);
    }
    await this.pool.query(
      `UPDATE equipment_issued SET status = 'returned', return_reason = 'Возврат на склад', trashed_at = now()
       WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId],
    );
    return { message: 'Возвращено на склад' };
  }

  // My equipment (for masters)
  async getMyEquipment(tenantId: string, userId: string) {
    return this.getIssuedByUser(tenantId, userId, false);
  }

  private mapIssued(r: any) {
    return {
      id: r.id,
      userId: r.user_id,
      userName: r.user_name || null,
      userAvatar: r.user_avatar || null,
      storageItemId: r.storage_item_id,
      name: r.name,
      description: r.description,
      photo: r.photo,
      cost: parseFloat(r.cost) || 0,
      categoryType: r.category_type,
      issuedAt: r.issued_at,
      serviceLifeMonths: r.service_life_months,
      expiresAt: r.expires_at,
      status: r.status,
      trashedAt: r.trashed_at,
      trashExpiresAt: r.trash_expires_at,
      returnReason: r.return_reason,
      replacedBy: r.replaced_by,
    };
  }
}
