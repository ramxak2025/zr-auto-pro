import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';

@Injectable()
export class CarsService {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  private mapCar(row: any) {
    const car: any = {
      id: row.id,
      plateNumber: row.plate_number,
      makeModel: row.make_model,
      comment: row.comment,
      clientId: row.client_id,
      createdAt: row.created_at,
    };
    if (row.client_full_name) {
      car.client = {
        id: row.client_id,
        fullName: row.client_full_name,
        phone: row.client_phone,
      };
    }
    return car;
  }

  async getAll(tenantID: string, query: any) {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 50;
    const offset = (page - 1) * limit;
    const search = query.search || '';

    let where = 'ca.tenant_id = $1';
    const params: any[] = [tenantID];
    let idx = 2;

    if (search) {
      where += ` AND (ca.plate_number ILIKE $${idx} OR ca.make_model ILIKE $${idx})`;
      params.push(`%${search}%`);
      idx++;
    }

    const countResult = await this.pool.query(
      `SELECT COUNT(*) as total FROM cars ca WHERE ${where}`,
      params,
    );
    const total = parseInt(countResult.rows[0].total);

    params.push(limit, offset);
    const { rows } = await this.pool.query(
      `SELECT ca.*, cl.full_name as client_full_name, cl.phone as client_phone
       FROM cars ca LEFT JOIN clients cl ON cl.id = ca.client_id
       WHERE ${where} ORDER BY ca.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      params,
    );

    return { data: rows.map(this.mapCar), total, page, limit };
  }

  async getById(id: string, tenantID: string) {
    const { rows } = await this.pool.query(
      `SELECT ca.*, cl.full_name as client_full_name, cl.phone as client_phone
       FROM cars ca LEFT JOIN clients cl ON cl.id = ca.client_id
       WHERE ca.id=$1 AND ca.tenant_id=$2`,
      [id, tenantID],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Машина не найдена' });
    return this.mapCar(rows[0]);
  }

  async create(tenantID: string, dto: any) {
    const { rows } = await this.pool.query(
      `INSERT INTO cars (plate_number, make_model, comment, client_id, tenant_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [dto.plateNumber, dto.makeModel, dto.comment, dto.clientId, tenantID],
    );
    return this.mapCar(rows[0]);
  }

  async update(id: string, tenantID: string, dto: any) {
    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (dto.plateNumber !== undefined) { sets.push(`plate_number=$${idx++}`); vals.push(dto.plateNumber); }
    if (dto.makeModel !== undefined) { sets.push(`make_model=$${idx++}`); vals.push(dto.makeModel); }
    if (dto.comment !== undefined) { sets.push(`comment=$${idx++}`); vals.push(dto.comment); }
    if (dto.clientId !== undefined) { sets.push(`client_id=$${idx++}`); vals.push(dto.clientId); }

    if (sets.length === 0) return this.getById(id, tenantID);

    vals.push(id, tenantID);
    const { rows } = await this.pool.query(
      `UPDATE cars SET ${sets.join(', ')} WHERE id=$${idx++} AND tenant_id=$${idx} RETURNING *`,
      vals,
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Машина не найдена' });
    return this.mapCar(rows[0]);
  }

  async remove(id: string, tenantID: string) {
    await this.pool.query('DELETE FROM cars WHERE id=$1 AND tenant_id=$2', [id, tenantID]);
    return { message: 'Удалено' };
  }
}
