import { Injectable, Inject, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { phoneSearchKey } from '../common/normalize-phone';

// Format-agnostic phone key expression, mirrors `phoneSearchKey` (JS) and the
// functional indexes in migration 104. Normalises the stored value to its
// last-10 national digits so any format (+7 / 8 / 7 / spaces / dashes / parens)
// compares equal. Kept as a constant so query + dedup + index never drift.
const PHONE_KEY_SQL = `right(regexp_replace(phone, '[^0-9]', '', 'g'), 10)`;

@Injectable()
export class ClientsService {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  /**
   * Find an existing client by phone within the current tenant.
   * Used by the UI to warn the user before creating a duplicate.
   * Returns at most one match (the first by created_at).
   */
  async findByPhone(tenantID: string, phone: string) {
    // Match on the normalized core so a client saved as «+7 (988) 444-44-85»
    // is found when the user types «89884444485» or «9884444485» (#64). The
    // previous exact `phone = '+7…'` compare missed every non-canonical row,
    // which is exactly why the duplicate-warning never fired and the cash
    // screen created a second client (#57 BUG B).
    const key = phoneSearchKey(phone || '');
    if (!key) return null;
    const { rows } = await this.pool.query(
      `SELECT id, full_name, phone, created_at
       FROM clients WHERE tenant_id = $1 AND ${PHONE_KEY_SQL} = $2
       ORDER BY created_at LIMIT 1`,
      [tenantID, key],
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
      source: row.source ?? null,
      ownerNotes: row.owner_notes ?? null,
      isRetail: !!row.is_retail,
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
      // 059_cars_no_plate — present on rows selected with `cars.*`.
      noPlate: !!row.no_plate,
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

    if (search) {
      // Build the OR-group dynamically so the phone branch can be omitted when
      // the query has no digits (otherwise a `LIKE '%%'` would match every
      // client). Param indices key off params.length, so they never drift.
      const ors: string[] = [];

      params.push(`%${search}%`);
      ors.push(`c.full_name ILIKE $${params.length}`);

      // Phone: normalise BOTH the query and the stored value to their last-10
      // national digits, then substring-match — so «9884444485», «89884444485»,
      // «+79884444485» and «8 (988) 444-44-85» all find the same client (#64).
      // This is also the fix for #57 BUG A: masters typing a customer's phone in
      // a different format than it was saved used to get zero results.
      const phoneKey = phoneSearchKey(search);
      if (phoneKey) {
        params.push(`%${phoneKey}%`);
        ors.push(`${PHONE_KEY_SQL} LIKE $${params.length}`);
      }

      // Plate: stored compactly (no spaces); match with spaces stripped.
      params.push(`%${search.replace(/\s+/g, '')}%`);
      ors.push(
        `EXISTS (SELECT 1 FROM cars ca WHERE ca.client_id = c.id AND REPLACE(ca.plate_number, ' ', '') ILIKE $${params.length})`,
      );

      where += ` AND (${ors.join(' OR ')})`;
    }

    const countResult = await this.pool.query(`SELECT COUNT(*) as total FROM clients c WHERE ${where}`, params);
    const total = parseInt(countResult.rows[0].total);

    const limitIdx = params.length + 1;
    params.push(limit, offset);
    const { rows } = await this.pool.query(
      // Retail client pinned to the top so the cash screen always shows it
      // first; the rest are newest-first as before.
      `SELECT c.* FROM clients c WHERE ${where}
       ORDER BY c.is_retail DESC NULLS LAST, c.created_at DESC
       LIMIT $${limitIdx} OFFSET $${limitIdx + 1}`,
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
    // Last loyalty rating is computed in the query (not denormalized) — the
    // most recent review_responses row for this client (007_marketing_reviews).
    const { rows } = await this.pool.query(
      `SELECT c.*,
              rr.rating AS last_rating,
              rr.created_at AS last_rating_at
       FROM clients c
       LEFT JOIN LATERAL (
         SELECT rating, created_at
         FROM review_responses
         WHERE client_id = c.id AND tenant_id = c.tenant_id
         ORDER BY created_at DESC
         LIMIT 1
       ) rr ON true
       WHERE c.id=$1 AND c.tenant_id=$2`,
      [id, tenantID],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Клиент не найден' });

    const client = this.mapClient(rows[0]);
    (client as any).lastRating =
      rows[0].last_rating === null || rows[0].last_rating === undefined ? null : parseInt(rows[0].last_rating, 10);
    (client as any).lastRatingAt = rows[0].last_rating_at ?? null;

    const { rows: carRows } = await this.pool.query(
      'SELECT * FROM cars WHERE client_id=$1 AND tenant_id=$2 ORDER BY created_at',
      [id, tenantID],
    );
    (client as any).cars = carRows.map(this.mapCar);

    return client;
  }

  async create(tenantID: string, dto: any) {
    // full_name / phone are NOT NULL. Coerce + validate here so a missing field
    // returns a friendly 400 instead of a raw Postgres NOT NULL 500 — that raw
    // 500 was #57 BUG B ("создание клиента падает"): any create call that
    // omitted the phone (undefined → NULL) blew up on save.
    const fullName = typeof dto.fullName === 'string' ? dto.fullName.trim() : '';
    if (!fullName) {
      throw new BadRequestException({ message: 'Укажите имя клиента' });
    }
    const phone = typeof dto.phone === 'string' ? dto.phone.trim() : '';

    // Duplicate guard (#57 BUG B): if a client with the same normalized phone
    // already exists in THIS tenant, don't silently create a second row —
    // return 409 with the existing client's id so the UI can jump to it
    // («Клиент с этим номером уже добавлен → Перейти к клиенту»). There is no
    // DB unique constraint on phone (numbers are stored in many formats and the
    // retail client has ''), so this is the authoritative dedup.
    const key = phoneSearchKey(phone);
    if (key) {
      const { rows: dupe } = await this.pool.query(
        `SELECT id, full_name, phone FROM clients
          WHERE tenant_id = $1 AND ${PHONE_KEY_SQL} = $2
          ORDER BY created_at LIMIT 1`,
        [tenantID, key],
      );
      if (dupe.length > 0) {
        throw new ConflictException({
          message: 'Клиент с этим номером уже добавлен',
          code: 'CLIENT_PHONE_EXISTS',
          clientId: dupe[0].id as string,
          client: {
            id: dupe[0].id as string,
            fullName: dupe[0].full_name as string,
            phone: dupe[0].phone as string,
          },
        });
      }
    }

    const { rows } = await this.pool.query(
      `INSERT INTO clients (full_name, phone, comment, source, owner_notes, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [fullName, phone, dto.comment ?? null, dto.source ?? null, dto.ownerNotes ?? null, tenantID],
    );
    const client = this.mapClient(rows[0]);
    (client as any).cars = [];
    return client;
  }

  async update(id: string, tenantID: string, dto: any) {
    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (dto.fullName !== undefined) {
      sets.push(`full_name=$${idx++}`);
      vals.push(dto.fullName);
    }
    if (dto.phone !== undefined) {
      sets.push(`phone=$${idx++}`);
      vals.push(dto.phone);
    }
    if (dto.comment !== undefined) {
      sets.push(`comment=$${idx++}`);
      vals.push(dto.comment);
    }
    if (dto.source !== undefined) {
      sets.push(`source=$${idx++}`);
      vals.push(dto.source === '' ? null : dto.source);
    }
    if (dto.ownerNotes !== undefined) {
      sets.push(`owner_notes=$${idx++}`);
      vals.push(dto.ownerNotes === '' ? null : dto.ownerNotes);
    }

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
    const lines = rows.map((r) => `${r.full_name};${r.phone}`);
    return [header, ...lines].join('\n');
  }

  async remove(id: string, tenantID: string) {
    // Refuse to delete the pinned retail client — it's a system row that
    // /cash relies on. Without this guard the cash screen would silently
    // lose its default buyer.
    const { rows: check } = await this.pool.query('SELECT is_retail FROM clients WHERE id=$1 AND tenant_id=$2', [
      id,
      tenantID,
    ]);
    if (check.length > 0 && check[0].is_retail) {
      throw new NotFoundException({ message: 'Нельзя удалить розничного покупателя' });
    }
    await this.pool.query('DELETE FROM clients WHERE id=$1 AND tenant_id=$2', [id, tenantID]);
    return { message: 'Удалено' };
  }

  /**
   * Update just the `source` tag on a client. Trimmed and stored verbatim;
   * empty string normalised to NULL so the FE renders "Без источника".
   */
  async updateSource(id: string, tenantID: string, source: string | null) {
    const normalized = typeof source === 'string' ? source.trim().slice(0, 100) : null;
    const { rows } = await this.pool.query(`UPDATE clients SET source=$1 WHERE id=$2 AND tenant_id=$3 RETURNING *`, [
      normalized && normalized.length > 0 ? normalized : null,
      id,
      tenantID,
    ]);
    if (rows.length === 0) throw new NotFoundException({ message: 'Клиент не найден' });
    return this.mapClient(rows[0]);
  }

  /**
   * Update just the `owner_notes` field. Free-form text — capped at 4000
   * chars so a runaway client can't blow up the table.
   */
  async updateNotes(id: string, tenantID: string, notes: string | null) {
    const normalized = typeof notes === 'string' ? notes.slice(0, 4000) : null;
    const { rows } = await this.pool.query(
      `UPDATE clients SET owner_notes=$1 WHERE id=$2 AND tenant_id=$3 RETURNING *`,
      [normalized && normalized.length > 0 ? normalized : null, id, tenantID],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Клиент не найден' });
    return this.mapClient(rows[0]);
  }

  /**
   * Group the client's checks by car so the FE can render a per-car history
   * panel inside ClientDetail. Cars with zero checks still appear so the FE
   * doesn't have to do its own merge.
   */
  async getChecksByCar(id: string, tenantID: string, opts: { limit?: number; offset?: number } = {}) {
    const { rows: clientRows } = await this.pool.query('SELECT 1 FROM clients WHERE id=$1 AND tenant_id=$2', [
      id,
      tenantID,
    ]);
    if (clientRows.length === 0) throw new NotFoundException({ message: 'Клиент не найден' });

    const { rows: carRows } = await this.pool.query(
      `SELECT id, plate_number, make_model FROM cars WHERE client_id=$1 AND tenant_id=$2 ORDER BY created_at`,
      [id, tenantID],
    );

    // Bound the history so a long-lived car can't return unbounded rows. The
    // FE renders the most recent visits per car; 50 (newest-first) is plenty
    // and keeps the response small. Optional offset lets a future "show more"
    // page deeper without changing the response shape.
    const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
    const offset = Math.max(Number(opts.offset) || 0, 0);

    const { rows: checkRows } = await this.pool.query(
      `SELECT ch.*, m.full_name as master_name, ca.plate_number, ca.make_model
       FROM checks ch
       LEFT JOIN users m ON m.id = ch.master_id
       LEFT JOIN cars ca ON ca.id = ch.car_id
       WHERE ch.tenant_id=$1 AND ch.client_id=$2
       ORDER BY ch.date DESC
       LIMIT $3 OFFSET $4`,
      [tenantID, id, limit, offset],
    );

    const byCar: Record<string, any[]> = {};
    for (const r of checkRows) {
      const carId = r.car_id ?? 'no-car';
      if (!byCar[carId]) byCar[carId] = [];
      byCar[carId].push({
        id: r.id,
        number: r.number,
        date: r.date,
        totalRevenue: parseFloat(r.total_revenue) || 0,
        paymentMethod: r.payment_method,
        masterName: r.master_name,
        carPlate: r.plate_number,
        carMakeModel: r.make_model,
        isReturned: !!r.is_returned,
      });
    }

    const out = carRows.map((c: any) => ({
      carId: c.id as string,
      carPlate: c.plate_number as string,
      makeModel: c.make_model as string,
      checks: byCar[c.id] || [],
    }));
    // Add an "no-car" bucket if any checks were attached without car_id.
    if (byCar['no-car'] && byCar['no-car'].length > 0) {
      out.push({
        carId: '',
        carPlate: '—',
        makeModel: 'Без автомобиля',
        checks: byCar['no-car'],
      });
    }
    return out;
  }
}
