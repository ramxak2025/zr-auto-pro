import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { normalizePhone } from '../common/normalize-phone';

@Injectable()
export class ClientsService {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  /**
   * Find an existing client by phone within the current tenant.
   * Used by the UI to warn the user before creating a duplicate.
   * Returns at most one match (the first by created_at).
   */
  async findByPhone(tenantID: string, phone: string) {
    const normalized = normalizePhone(phone || '');
    if (!normalized) return null;
    const { rows } = await this.pool.query(
      `SELECT id, full_name, phone, created_at
       FROM clients WHERE tenant_id = $1 AND phone = $2
       ORDER BY created_at LIMIT 1`,
      [tenantID, normalized],
    );
    if (rows.length === 0) return null;
    const client = {
      id: rows[0].id as string,
      fullName: rows[0].full_name as string,
      phone: rows[0].phone as string,
      createdAt: rows[0].created_at as string,
    };
    // Include the client's cars so the duplicate-warning dialog can show
    // "уже привязано: А123АА77 Toyota Camry, В456ВВ99 Lada Granta".
    const { rows: carRows } = await this.pool.query(
      `SELECT id, plate_number, make_model
       FROM cars WHERE client_id = $1 AND tenant_id = $2
       ORDER BY created_at`,
      [client.id, tenantID],
    );
    return {
      ...client,
      cars: carRows.map((r) => ({
        id: r.id as string,
        plateNumber: r.plate_number as string,
        makeModel: r.make_model as string,
      })),
    };
  }

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
      // Plates and phones are stored without spaces; let the user search with
      // or without them.
      const compactSearch = search.replace(/\s+/g, '');
      where += ` AND (
        c.full_name ILIKE $${idx}
        OR REPLACE(c.phone, ' ', '') ILIKE $${idx + 1}
        OR EXISTS (
          SELECT 1 FROM cars ca
          WHERE ca.client_id = c.id
            AND REPLACE(ca.plate_number, ' ', '') ILIKE $${idx + 1}
        )
      )`;
      params.push(`%${search}%`, `%${compactSearch}%`);
      idx += 2;
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
