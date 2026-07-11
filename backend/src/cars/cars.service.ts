import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { capLimit } from '../common/cap-limit';
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
      // 059_cars_no_plate — true for cars registered "без номера".
      noPlate: !!row.no_plate,
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
    const limit = capLimit(query.limit, 50, 1000);
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

    // «Без номеров» filter — applied server-side so it works across the full
    // paginated dataset, not just the current page. A car counts as plate-less
    // when the 059 no_plate flag is set OR the stored plate is empty.
    const noPlate = query.noPlate === true || query.noPlate === 'true' || query.noPlate === '1';
    if (noPlate) {
      where += ` AND (ca.no_plate = true OR ca.plate_number = '')`;
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

  /**
   * Find an existing car with the same normalized plate that already belongs to
   * THIS client. Uses the exact same plate normalization as `findByPlate`
   * (lookup-by-plate): the SQL strips spaces/dashes/slashes + uppercases the
   * stored column and compares against `normalizePlate(...).key`. Scoped to the
   * one client so the dedup can only ever attach to that client's own car.
   */
  private async findExistingPlateForClient(tenantID: string, clientId: string, normKey: string) {
    const { rows } = await this.pool.query(
      `SELECT ca.*, cl.full_name as client_full_name, cl.phone as client_phone
       FROM cars ca LEFT JOIN clients cl ON cl.id = ca.client_id
       WHERE ca.tenant_id = $1
         AND ca.client_id = $2
         AND REPLACE(REPLACE(REPLACE(UPPER(ca.plate_number), ' ', ''), '-', ''), '/', '') = $3
       ORDER BY ca.created_at
       LIMIT 1`,
      [tenantID, clientId, normKey],
    );
    return rows.length > 0 ? this.mapCar(rows[0]) : null;
  }

  async create(tenantID: string, dto: any) {
    // If linked to a client, the client must live in the same tenant.
    // Without this a director could attach a car to another tenant's client.
    if (dto.clientId) {
      await this.assertClientInTenant(dto.clientId, tenantID);
    }
    // "Без номера" cars store an empty plate; the duplicate-plate lookup (run
    // by the FE before create) is meaningless for them and is skipped. Foreign
    // plates are stored verbatim — no RU validation is applied here.
    const noPlate = !!dto.noPlate;
    // plate_number + make_model are NOT NULL. Coerce undefined → '' so the
    // quick-create-from-cash flow (which may send a plate but no make/model,
    // or vice-versa) can't hit a raw NOT NULL 500 on save (#57 BUG B).
    const plateNumber = noPlate ? '' : typeof dto.plateNumber === 'string' ? dto.plateNumber : '';
    const makeModel = typeof dto.makeModel === 'string' ? dto.makeModel : '';

    // Idempotent attach: when creating a plated car for an EXISTING client, if
    // that client already has a car with the same normalized plate, return the
    // existing car instead of inserting a duplicate row. Supports the mobile
    // flow where a customer's new car is attached to an already-existing client
    // (retried / double-tapped saves must not fan out into duplicate cars).
    // No-plate cars are skipped — an empty plate is not a stable identity.
    if (dto.clientId && !noPlate) {
      const norm = normalizePlate(plateNumber);
      if (!norm.isEmpty && norm.key) {
        const existing = await this.findExistingPlateForClient(tenantID, dto.clientId, norm.key);
        if (existing) return existing;
      }
    }

    const { rows } = await this.pool.query(
      `INSERT INTO cars (plate_number, make_model, comment, client_id, tenant_id, no_plate)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [plateNumber, makeModel, dto.comment ?? null, dto.clientId ?? null, tenantID, noPlate],
    );
    return this.mapCar(rows[0]);
  }

  async update(id: string, tenantID: string, dto: any) {
    if (dto.clientId !== undefined && dto.clientId !== null) {
      await this.assertClientInTenant(dto.clientId, tenantID);
    }

    // Reassigning a car to a different owner (feature #9): guard against
    // creating a duplicate plate under the TARGET client. Only runs when a
    // real owner change is requested (`dto.clientId` present AND different from
    // the car's current client_id). Reuses the exact same normalization +
    // per-client lookup as create()'s idempotent-attach path. No-plate cars
    // («без номера») normalize to empty and are skipped — an empty plate is not
    // a stable identity.
    if (dto.clientId !== undefined && dto.clientId !== null) {
      const { rows: currentRows } = await this.pool.query(
        'SELECT client_id, plate_number FROM cars WHERE id=$1 AND tenant_id=$2 LIMIT 1',
        [id, tenantID],
      );
      if (currentRows.length > 0 && currentRows[0].client_id !== dto.clientId) {
        // Plate to check is the one the car will have after this update:
        // a provided plateNumber wins (unless toggling «без номера»), else the
        // car's current stored plate.
        const effectivePlate = dto.noPlate
          ? ''
          : dto.plateNumber !== undefined
            ? dto.plateNumber
            : (currentRows[0].plate_number ?? '');
        const norm = normalizePlate(effectivePlate);
        if (!norm.isEmpty && norm.key) {
          const existing = await this.findExistingPlateForClient(tenantID, dto.clientId, norm.key);
          if (existing) {
            throw new BadRequestException({ message: 'У этого клиента уже есть авто с таким номером' });
          }
        }
      }
    }

    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    // When toggling "без номера" on, force the stored plate empty; otherwise a
    // provided plateNumber wins. Foreign plates pass through unchanged.
    if (dto.noPlate !== undefined) {
      sets.push(`no_plate=$${idx++}`);
      vals.push(!!dto.noPlate);
      if (dto.noPlate) {
        sets.push(`plate_number=$${idx++}`);
        vals.push('');
      }
    }
    if (dto.plateNumber !== undefined && !dto.noPlate) {
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

  /**
   * Transfer a car to a NEW owner («сменить владельца»), optionally carrying the
   * car's full check history — and the рассрочка (installment_plans) derived FROM
   * those checks — over to the new client. Everything runs in ONE transaction so a
   * partial transfer is impossible.
   *
   * Scope (fix #4): only the CURRENT owner's checks on this car are moved. Checks
   * that belonged to a PRIOR owner (left behind by an earlier moveHistory=false
   * transfer, or a reused plate) keep their owner. We capture that check-id set
   * BEFORE mutating so the derived-ledger move below is order-independent.
   *
   * Ledger handling (investigated 2026-07, revised): ONLY installment_plans are
   * carried. An installment plan is a DISCRETE per-check obligation (paid /
   * remaining live on the plan row; installment_payments follow via plan_id FK) —
   * moving it with its sale keeps «полный перенос» consistent and cannot corrupt a
   * cross-client balance. client_bonuses (loyalty) and client_debts are
   * DELIBERATELY NOT moved: both are FUNGIBLE per-client running balances (loyalty
   * = Σaccrual − Σredemption; debts = Σcharge − Σpayment) whose negative side
   * (redemption / payment) carries NO check_id and so cannot be split by car.
   * Moving only the check-linked positive rows would decouple the balance, drive
   * the OLD client negative (breaking loyalty's non-negative invariant) and hand
   * the NEW client unearned, immediately-spendable value (real money as discounts).
   * Loyalty & debts are PERSONAL to the client, not attached to the car — same
   * precedent as checks.service.ts editClosedCheck, which leaves them untouched.
   */
  async transferOwner(carId: string, tenantID: string, newClientId: string, moveHistory: boolean) {
    // 1) Target client must exist in the tenant.
    await this.assertClientInTenant(newClientId, tenantID);

    // 2) Load the car (tenant-scoped) → current owner + plate.
    const { rows: carRows } = await this.pool.query(
      'SELECT id, client_id, plate_number, no_plate FROM cars WHERE id=$1 AND tenant_id=$2 LIMIT 1',
      [carId, tenantID],
    );
    if (carRows.length === 0) throw new NotFoundException({ message: 'Машина не найдена' });
    const current = carRows[0];

    // Idempotent no-op: already owned by the target client.
    if (current.client_id === newClientId) {
      return { car: await this.getById(carId, tenantID), movedChecks: 0 };
    }

    // 3) Dedup guard: the target must not already own a car with this plate.
    // Reuses the exact same normalization + per-client lookup as create/update.
    // No-plate cars normalize to empty and are skipped (empty plate ≠ identity).
    if (!current.no_plate) {
      const norm = normalizePlate(current.plate_number ?? '');
      if (!norm.isEmpty && norm.key) {
        const existing = await this.findExistingPlateForClient(tenantID, newClientId, norm.key);
        if (existing) {
          throw new BadRequestException({ message: 'У этого клиента уже есть авто с таким номером' });
        }
      }
    }

    let movedChecks = 0;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // 4) Reassign the car itself.
      await client.query('UPDATE cars SET client_id=$1 WHERE id=$2 AND tenant_id=$3', [newClientId, carId, tenantID]);

      if (moveHistory !== false) {
        // 5) Capture the CURRENT owner's checks on this car BEFORE any mutation.
        // Scoping to `client_id = current owner` (fix #4) leaves a PRIOR owner's
        // checks — from an earlier moveHistory=false transfer or a reused plate —
        // untouched. Capturing the ids up front makes the ledger move below
        // order-independent (moving the checks first would otherwise empty a
        // car_id+client_id subquery). Trashed history is included (no deleted_at
        // filter) so «полный перенос» carries the full history.
        const { rows: chkRows } = await client.query(
          'SELECT id FROM checks WHERE car_id=$1 AND tenant_id=$2 AND client_id=$3',
          [carId, tenantID, current.client_id],
        );
        const checkIds = chkRows.map((r: any) => r.id as string);
        movedChecks = checkIds.length;

        if (checkIds.length > 0) {
          // Move exactly those checks to the new client.
          await client.query('UPDATE checks SET client_id=$1 WHERE tenant_id=$2 AND id = ANY($3::uuid[])', [
            newClientId,
            tenantID,
            checkIds,
          ]);

          // 6) Carry рассрочка for exactly those checks. An installment plan is a
          // DISCRETE per-check obligation (see method doc) — safe to move with its
          // sale; installment_payments follow via plan_id FK → no direct touch.
          // client_bonuses / client_debts are INTENTIONALLY NOT moved (see doc):
          // fungible per-client balances that can't be split by car without
          // corrupting the old owner's / new owner's balance.
          await client.query(
            'UPDATE installment_plans SET client_id=$1 WHERE tenant_id=$2 AND check_id = ANY($3::uuid[])',
            [newClientId, tenantID, checkIds],
          );
        }
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return { car: await this.getById(carId, tenantID), movedChecks };
  }

  /**
   * Recent checks for a specific car, newest-first. Belongs-to-tenant is
   * enforced via the WHERE clause; foreign cars yield an empty list rather
   * than 404 to keep the FE simple (an empty list is a valid history).
   */
  async getChecks(id: string, tenantID: string, limit: number) {
    // Verify car belongs to tenant — without this the foreign-id path
    // returns an empty array instead of a 404, which masks bugs.
    const { rows: carRows } = await this.pool.query('SELECT 1 FROM cars WHERE id=$1 AND tenant_id=$2 LIMIT 1', [
      id,
      tenantID,
    ]);
    if (carRows.length === 0) throw new NotFoundException({ message: 'Машина не найдена' });

    const { rows } = await this.pool.query(
      `SELECT ch.id, ch.number, ch.date, ch.total_revenue, ch.payment_method, ch.is_returned,
              ch.is_deferred, ch.mileage, m.full_name as master_name, ca.plate_number, ca.make_model,
              cl.full_name as client_name, cl.phone as client_phone
       FROM checks ch
       LEFT JOIN users m ON m.id = ch.master_id
       LEFT JOIN cars ca ON ca.id = ch.car_id
       LEFT JOIN clients cl ON cl.id = ch.client_id
       WHERE ch.tenant_id=$1 AND ch.car_id=$2 AND ch.deleted_at IS NULL
       ORDER BY ch.date DESC
       LIMIT $3`,
      [tenantID, id, limit],
    );
    return rows.map((r: any) => ({
      id: r.id,
      number: r.number,
      date: r.date,
      totalRevenue: parseFloat(r.total_revenue) || 0,
      paymentMethod: r.payment_method,
      isReturned: !!r.is_returned,
      isDeferred: !!r.is_deferred,
      // 001 checks.mileage (INT, nullable). CarDetailScreen derives «Пробег»
      // from the latest non-null value and net «Потрачено» from non-returned rows.
      mileage: r.mileage ?? null,
      masterName: r.master_name,
      carPlate: r.plate_number,
      carMakeModel: r.make_model,
      clientName: r.client_name,
      clientPhone: r.client_phone,
    }));
  }
}
