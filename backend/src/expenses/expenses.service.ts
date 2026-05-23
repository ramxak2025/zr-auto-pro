import { Injectable, Inject, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';

const PRIVILEGED_ROLES = new Set(['director', 'admin', 'superadmin']);

@Injectable()
export class ExpensesService {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  // --- Categories ---

  async getCategories(tenantID: string) {
    const { rows } = await this.pool.query('SELECT * FROM expense_categories WHERE tenant_id=$1 ORDER BY name', [
      tenantID,
    ]);
    return rows.map((r) => ({ id: r.id, name: r.name, tenantId: r.tenant_id, createdAt: r.created_at }));
  }

  async createCategory(tenantID: string, dto: any) {
    const { rows } = await this.pool.query(
      'INSERT INTO expense_categories (name, tenant_id) VALUES ($1, $2) RETURNING *',
      [dto.name, tenantID],
    );
    const r = rows[0];
    return { id: r.id, name: r.name, tenantId: r.tenant_id, createdAt: r.created_at };
  }

  async removeCategory(id: string, tenantID: string) {
    await this.pool.query('DELETE FROM expense_categories WHERE id=$1 AND tenant_id=$2', [id, tenantID]);
    return { message: 'Удалено' };
  }

  // --- Expenses ---

  async getAll(tenantID: string, query: any) {
    const dateFrom = query.dateFrom;
    const dateTo = query.dateTo;

    let where = 'e.tenant_id = $1';
    const params: any[] = [tenantID];
    let idx = 2;

    if (dateFrom) {
      where += ` AND e.date >= $${idx++}`;
      params.push(dateFrom);
    }
    if (dateTo) {
      where += ` AND e.date <= ($${idx++}::date + 1)::timestamptz`;
      params.push(dateTo);
    }
    if (query.createdBy) {
      where += ` AND e.created_by = $${idx++}`;
      params.push(query.createdBy);
    }
    if (query.approvalStatus) {
      where += ` AND e.approval_status = $${idx++}`;
      params.push(query.approvalStatus);
    }

    const { rows } = await this.pool.query(
      `SELECT e.*, ec.name as category_name,
              u.full_name as user_name,
              cu.full_name as creator_name
       FROM expenses e
       LEFT JOIN expense_categories ec ON ec.id = e.category_id
       LEFT JOIN users u ON u.id = e.user_id
       LEFT JOIN users cu ON cu.id = e.created_by
       WHERE ${where}
       ORDER BY e.date DESC`,
      params,
    );

    return rows.map((r) => ({
      id: r.id,
      categoryId: r.category_id,
      categoryName: r.category_name,
      amount: parseFloat(r.amount) || 0,
      description: r.description,
      date: r.date,
      userId: r.user_id,
      userName: r.user_name,
      createdBy: r.created_by,
      creatorName: r.creator_name,
      source: r.source ?? 'owner',
      approvalStatus: r.approval_status ?? 'approved',
      createdAt: r.created_at,
    }));
  }

  async create(tenantID: string, userID: string, userRole: string, dto: any) {
    // If a category is referenced, confirm it lives in the caller's tenant.
    // Without this, a director could store an expense under a foreign
    // tenant's category and have it surface in their own listing JOIN'd
    // with that foreign name.
    if (dto.categoryId) {
      const { rows: catRows } = await this.pool.query(
        'SELECT 1 FROM expense_categories WHERE id = $1 AND tenant_id = $2 LIMIT 1',
        [dto.categoryId, tenantID],
      );
      if (catRows.length === 0) {
        throw new NotFoundException({ message: 'Категория расходов не найдена' });
      }
    }

    const isPrivileged = PRIVILEGED_ROLES.has(userRole);
    const source = isPrivileged ? 'owner' : 'employee';

    // Non-privileged users need the `can_add_expenses` permission flag set.
    if (!isPrivileged) {
      const { rows: userRows } = await this.pool.query(
        'SELECT can_add_expenses, daily_expense_limit FROM users WHERE id=$1 AND tenant_id=$2',
        [userID, tenantID],
      );
      if (userRows.length === 0) {
        throw new ForbiddenException({ message: 'Пользователь не найден' });
      }
      if (!userRows[0].can_add_expenses) {
        throw new ForbiddenException({ message: 'У вас нет права добавлять расходы' });
      }
    }

    const amount = parseFloat(String(dto.amount));
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException({ message: 'Сумма должна быть положительной' });
    }
    const date = dto.date || new Date().toISOString();

    // Daily-limit check — only meaningful for non-privileged users; we
    // sum up all the user's expenses on the same calendar day and flip
    // the new one to 'pending' if the cumulative total crosses the cap.
    let approvalStatus: 'approved' | 'pending' = 'approved';
    if (!isPrivileged) {
      const { rows: limitRows } = await this.pool.query(
        'SELECT daily_expense_limit FROM users WHERE id=$1 AND tenant_id=$2',
        [userID, tenantID],
      );
      const limit =
        limitRows[0]?.daily_expense_limit === null || limitRows[0]?.daily_expense_limit === undefined
          ? null
          : parseFloat(limitRows[0].daily_expense_limit);
      if (limit !== null && limit > 0) {
        const dayStartIso = new Date(date).toISOString().slice(0, 10);
        const { rows: totalRows } = await this.pool.query(
          `SELECT COALESCE(SUM(amount), 0) as total FROM expenses
            WHERE tenant_id=$1 AND created_by=$2
              AND date >= $3::date AND date < ($3::date + 1)`,
          [tenantID, userID, dayStartIso],
        );
        const sumSoFar = parseFloat(totalRows[0].total) || 0;
        if (sumSoFar + amount > limit) {
          approvalStatus = 'pending';
        }
      }
    }

    const { rows } = await this.pool.query(
      `INSERT INTO expenses (category_id, amount, description, date, user_id, created_by, source, approval_status, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        dto.categoryId || null,
        amount,
        dto.description || null,
        date,
        userID,
        userID,
        source,
        approvalStatus,
        tenantID,
      ],
    );
    const r = rows[0];
    return {
      id: r.id,
      categoryId: r.category_id,
      amount: parseFloat(r.amount) || 0,
      description: r.description,
      date: r.date,
      userId: r.user_id,
      createdBy: r.created_by,
      source: r.source,
      approvalStatus: r.approval_status,
      createdAt: r.created_at,
    };
  }

  /**
   * Owner approves a pending expense. Sets approval_status='approved' and
   * returns the updated row. Idempotent — re-approving an approved row is
   * a no-op and returns the existing record.
   */
  async approve(id: string, tenantID: string) {
    const { rows } = await this.pool.query(
      `UPDATE expenses SET approval_status='approved' WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [id, tenantID],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Расход не найден' });
    return rows[0];
  }

  async reject(id: string, tenantID: string) {
    const { rows } = await this.pool.query(
      `UPDATE expenses SET approval_status='rejected' WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [id, tenantID],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Расход не найден' });
    return rows[0];
  }

  async remove(id: string, tenantID: string) {
    const { rows } = await this.pool.query('DELETE FROM expenses WHERE id=$1 AND tenant_id=$2 RETURNING id', [
      id,
      tenantID,
    ]);
    if (rows.length === 0) throw new NotFoundException({ message: 'Расход не найден' });
    return { message: 'Удалено' };
  }

  async getTotalForPeriod(tenantID: string, dateFrom: string, dateTo: string) {
    const { rows } = await this.pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total
       FROM expenses
       WHERE tenant_id = $1 AND date >= $2 AND date <= ($3::date + 1)::timestamptz`,
      [tenantID, dateFrom, dateTo],
    );
    return parseFloat(rows[0].total) || 0;
  }
}
