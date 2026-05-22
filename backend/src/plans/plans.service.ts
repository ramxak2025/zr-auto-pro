import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';

@Injectable()
export class PlansService {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  private mapPlan(row: any) {
    return {
      id: row.id,
      name: row.name,
      monthlyPrice: parseFloat(row.monthly_price) || 0,
      description: row.description,
      features: row.features || [],
      maxUsers: row.max_users,
      isActive: row.is_active,
      sortOrder: row.sort_order,
      createdAt: row.created_at,
    };
  }

  async getAll() {
    const { rows } = await this.pool.query('SELECT * FROM plans ORDER BY sort_order, monthly_price');
    return rows.map(this.mapPlan);
  }

  async create(dto: any) {
    const { rows } = await this.pool.query(
      `INSERT INTO plans (name, monthly_price, description, features, max_users, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        dto.name,
        dto.monthlyPrice || 0,
        dto.description,
        JSON.stringify(dto.features || []),
        dto.maxUsers || 5,
        dto.sortOrder || 0,
      ],
    );
    return this.mapPlan(rows[0]);
  }

  async update(id: string, dto: any) {
    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (dto.name !== undefined) {
      sets.push(`name=$${idx++}`);
      vals.push(dto.name);
    }
    if (dto.monthlyPrice !== undefined) {
      sets.push(`monthly_price=$${idx++}`);
      vals.push(dto.monthlyPrice);
    }
    if (dto.description !== undefined) {
      sets.push(`description=$${idx++}`);
      vals.push(dto.description);
    }
    if (dto.features !== undefined) {
      sets.push(`features=$${idx++}`);
      vals.push(JSON.stringify(dto.features));
    }
    if (dto.maxUsers !== undefined) {
      sets.push(`max_users=$${idx++}`);
      vals.push(dto.maxUsers);
    }
    if (dto.isActive !== undefined) {
      sets.push(`is_active=$${idx++}`);
      vals.push(dto.isActive);
    }
    if (dto.sortOrder !== undefined) {
      sets.push(`sort_order=$${idx++}`);
      vals.push(dto.sortOrder);
    }

    if (sets.length === 0) throw new NotFoundException({ message: 'Нечего обновлять' });

    vals.push(id);
    const { rows } = await this.pool.query(`UPDATE plans SET ${sets.join(', ')} WHERE id=$${idx} RETURNING *`, vals);
    if (rows.length === 0) throw new NotFoundException({ message: 'Тариф не найден' });
    return this.mapPlan(rows[0]);
  }

  async remove(id: string) {
    await this.pool.query('DELETE FROM plans WHERE id=$1', [id]);
    return { message: 'Удалено' };
  }
}
