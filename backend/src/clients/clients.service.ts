import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';

@Injectable()
export class ClientsService {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  private mapClient(row: any) {
    return {
      id: row.id,
      fullName: row.full_name,
      phone: row.phone,
      comment: row.comment,
      createdAt: row.created_at,
    };
  }

  private mapCar(row: any) {
    return {
      id: row.id,
      plateNumber: row.plate_number,
      makeModel: row.make_model,
      comment: row.comment,
      clientId: row.client_id,
      createdAt: row.created_at,
    };
  }

  async getAll(tenantID: string, query: any) {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 50;
    const offset = (page - 1) * limit;
    const search = query.search || '';

    let where = 'c.tenant_id = $1';
    const params: any[] = [tenantID];
    let idx = 2;

    if (search) {
      where += ` AND (c.full_name ILIKE $${idx} OR c.phone ILIKE $${idx} OR EXISTS(SELECT 1 FROM cars ca WHERE ca.client_id = c.id AND ca.plate_number ILIKE $${idx}))`;
      params.push(`%${search}%`);
      idx++;
    }

    const countResult = await this.pool.query(
      `SELECT COUNT(*) as total FROM clients c WHERE ${where}`,
      params,
    );
    const total = parseInt(countResult.rows[0].total);

    params.push(limit, offset);
    const { rows } = await this.pool.query(
      `SELECT c.* FROM clients c WHERE ${where} ORDER BY c.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      params,
    );

    const clients = rows.map(this.mapClient);

    // Load cars for each client
    if (clients.length > 0) {
      const clientIds = clients.map((c) => c.id);
      const { rows: carRows } = await this.pool.query(
        `SELECT * FROM cars WHERE client_id = ANY($1) AND tenant_id = $2 ORDER BY created_at`,
        [clientIds, tenantID],
      );
      const carsMap: Record<string, any[]> = {};
      for (const car of carRows) {
        const cid = car.client_id;
        if (!carsMap[cid]) carsMap[cid] = [];
        carsMap[cid].push(this.mapCar(car));
      }
      for (const client of clients) {
        (client as any).cars = carsMap[client.id] || [];
      }
    }

    return { data: clients, total, page, limit };
  }

  async getById(id: string, tenantID: string) {
    const { rows } = await this.pool.query(
      'SELECT * FROM clients WHERE id=$1 AND tenant_id=$2',
      [id, tenantID],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Клиент не найден' });

    const client = this.mapClient(rows[0]);

    const { rows: carRows } = await this.pool.query(
      'SELECT * FROM cars WHERE client_id=$1 AND tenant_id=$2 ORDER BY created_at',
      [id, tenantID],
    );
    (client as any).cars = carRows.map(this.mapCar);

    return client;
  }

  async create(tenantID: string, dto: any) {
    const { rows } = await this.pool.query(
      `INSERT INTO clients (full_name, phone, comment, tenant_id)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [dto.fullName, dto.phone, dto.comment, tenantID],
    );
    const client = this.mapClient(rows[0]);
    (client as any).cars = [];
    return client;
  }

  async update(id: string, tenantID: string, dto: any) {
    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (dto.fullName !== undefined) { sets.push(`full_name=$${idx++}`); vals.push(dto.fullName); }
    if (dto.phone !== undefined) { sets.push(`phone=$${idx++}`); vals.push(dto.phone); }
    if (dto.comment !== undefined) { sets.push(`comment=$${idx++}`); vals.push(dto.comment); }

    if (sets.length === 0) return this.getById(id, tenantID);

    vals.push(id, tenantID);
    const { rows } = await this.pool.query(
      `UPDATE clients SET ${sets.join(', ')} WHERE id=$${idx++} AND tenant_id=$${idx} RETURNING *`,
      vals,
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Клиент не найден' });
    return this.mapClient(rows[0]);
  }

  async exportCsv(tenantID: string) {
    const { rows } = await this.pool.query(
      `SELECT full_name, phone FROM clients WHERE tenant_id = $1 ORDER BY full_name`,
      [tenantID],
    );
    const header = 'Имя;Телефон';
    const lines = rows.map(r => `${r.full_name};${r.phone}`);
    return [header, ...lines].join('\n');
  }

  async remove(id: string, tenantID: string) {
    await this.pool.query('DELETE FROM clients WHERE id=$1 AND tenant_id=$2', [id, tenantID]);
    return { message: 'Удалено' };
  }
}
