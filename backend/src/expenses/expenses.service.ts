import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';

@Injectable()
export class ExpensesService {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  // --- Categories ---

  async getCategories(tenantID: string) {
    const { rows } = await this.pool.query(
      'SELECT * FROM expense_categories WHERE tenant_id=$1 ORDER BY name',
      [tenantID],
    );
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

    if (dateFrom) { where += ` AND e.date >= $${idx++}`; params.push(dateFrom); }
    if (dateTo) { where += ` AND e.date <= ($${idx++}::date + 1)::timestamptz`; params.push(dateTo); }

    const { rows } = await this.pool.query(
      `SELECT e.*, ec.name as category_name, u.full_name as user_name
       FROM expenses e
       LEFT JOIN expense_categories ec ON ec.id = e.category_id
       LEFT JOIN users u ON u.id = e.user_id
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
      createdAt: r.created_at,
    }));
  }

  async create(tenantID: string, userID: string, dto: any) {
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

    const { rows } = await this.pool.query(
      `INSERT INTO expenses (category_id, amount, description, date, user_id, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [dto.categoryId || null, dto.amount, dto.description || null,
       dto.date || new Date().toISOString(), userID, tenantID],
    );
    return rows[0];
  }

  async remove(id: string, tenantID: string) {
    const { rows } = await this.pool.query(
      'DELETE FROM expenses WHERE id=$1 AND tenant_id=$2 RETURNING id', [id, tenantID],
    );
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
