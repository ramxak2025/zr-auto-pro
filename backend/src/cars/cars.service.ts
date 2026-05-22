import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { normalizePlate } from '../imports/normalize-plate';

@Injectable()
export class CarsService {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  private async assertClientInTenant(clientId: string, tenantID: string): Promise<void> {
    const { rows } = await this.pool.query('SELECT 1 FROM clients WHERE id = $1 AND tenant_id = $2 LIMIT 1', [
      clientId,
      tenantID,
    ]);
    if (rows.length === 0) {
      throw new BadRequestException({ message: 'Клиент не найден' });
    }
  }

  /**
   * Find an existing car by plate within the current tenant.
   * Plate matching is normalized: spaces, dashes and slashes are stripped,
   * Cyrillic look-alikes transliterated, so "Р 332 РА 05" and "P332PA05"
   * resolve to the same record. Used by the UI duplicate-warning popup.
   */
  async findByPlate(tenantID: string, plate: string) {
    const norm = normalizePlate(plate || '');
    if (!norm.key) return null;
    const { rows } = await this.pool.query(
      `SELECT ca.id, ca.plate_number, ca.make_model, ca.client_id, ca.created_at,
              cl.full_name AS client_full_name, cl.phone AS client_phone
       FROM cars ca
       LEFT JOIN clients cl ON cl.id = ca.client_id
       WHERE ca.tenant_id = $1
         AND REPLACE(REPLACE(REPLACE(UPPER(ca.plate_number), ' ', ''), '-', ''), '/', '') = $2
       ORDER BY ca.created_at LIMIT 1`,
      [tenantID, norm.key],
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id as string,
      plateNumber: r.plate_number as string,
      makeModel: r.make_model as string,
      clientId: r.client_id as string | null,
      createdAt: r.created_at as string,
      client: r.client_full_name
        ? {
            id: r.client_id as string,
            fullName: r.client_full_name as string,
            phone: r.client_phone as string,
          }
        : null,
    };
  }

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
      // Plate numbers are stored compactly (no spaces). Let the user enter
      // either form: REPLACE strips spaces from the column at match time.
      const compactSearch = search.replace(/\s+/g, '');
      where += ` AND (
        REPLACE(ca.plate_number, ' ', '') ILIKE $${idx}
        OR ca.make_model ILIKE $${idx + 1}
      )`;
      params.push(`%${compactSearch}%`, `%${search}%`);
      idx += 2;
    }

    const countResult = await this.pool.query(`SELECT COUNT(*) as total FROM cars ca WHERE ${where}`, params);
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
    // If linked to a client, the client must live in the same tenant.
    // Without this a director could attach a car to another tenant's client.
    if (dto.clientId) {
      await this.assertClientInTenant(dto.clientId, tenantID);
    }
    const { rows } = await this.pool.query(
      `INSERT INTO cars (plate_number, make_model, comment, client_id, tenant_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [dto.plateNumber, dto.makeModel, dto.comment, dto.clientId, tenantID],
    );
    return this.mapCar(rows[0]);
  }

  async update(id: string, tenantID: string, dto: any) {
    if (dto.clientId !== undefined && dto.clientId !== null) {
      await this.assertClientInTenant(dto.clientId, tenantID);
    }

    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (dto.plateNumber !== undefined) {
      sets.push(`plate_number=$${idx++}`);
      vals.push(dto.plateNumber);
    }
    if (dto.makeModel !== undefined) {
      sets.push(`make_model=$${idx++}`);
      vals.push(dto.makeModel);
    }
    if (dto.comment !== undefined) {
      sets.push(`comment=$${idx++}`);
      vals.push(dto.comment);
    }
    if (dto.clientId !== undefined) {
      sets.push(`client_id=$${idx++}`);
      vals.push(dto.clientId);
    }

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
