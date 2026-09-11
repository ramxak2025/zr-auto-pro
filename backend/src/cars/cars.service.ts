import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { capLimit } from '../common/cap-limit';
import { normalizePlate } from '../imports/normalize-plate';
import { ClientsService } from '../clients/clients.service';

/**
 * ФИЛИАЛЫ (156/161). Своей точки у машины НЕТ и не будет: машина — это гараж
 * КЛИЕНТА, и принадлежит она тому филиалу, которому принадлежит владелец.
 * Поэтому в раздельном режиме (tenants.points_shared_clients=false) гараж
 * режется через clients.point_id — ТЕМ ЖЕ предикатом, что база клиентов
 * (ClientsService.separatePointWhere), а не второй копией правила.
 *
 * Машина БЕЗ владельца (client_id IS NULL) видна везде: приписать её некуда, а
 * спрятать значило бы потерять её из всех списков сразу.
 */
@Injectable()
export class CarsService {
  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private clients: ClientsService,
  ) {}

  /**
   * Фрагмент « AND (владелец виден на моём филиале ИЛИ владельца нет)» для УЖЕ
   * известной точки. Пустая строка при общей базе клиентов (дефолт) — запрос
   * дословно прежний.
   *
   * Отдельно от `ownerVisibleSql` ради запросов, которые режут ОДНУ И ТУ ЖЕ
   * машину несколько раз (update: предварительная выборка владельца + сам
   * UPDATE): точка резолвится один раз, поэтому оба фрагмента гарантированно
   * про один филиал, даже если между запросами актор переключил точку.
   */
  private ownerVisibleSqlFor(alias: string, point: string | null, params: unknown[]): string {
    if (!point) return '';
    params.push(point);
    return (
      ` AND (${alias}.client_id IS NULL OR EXISTS (SELECT 1 FROM clients ocl` +
      ` WHERE ocl.id = ${alias}.client_id AND ocl.tenant_id = ${alias}.tenant_id` +
      ` AND (ocl.point_id = $${params.length} OR ocl.point_id IS NULL)))`
    );
  }

  /**
   * То же, но точка резолвится внутри — для запросов, которым нужен ровно один
   * фрагмент.
   */
  private async ownerVisibleSql(
    alias: string,
    tenantID: string,
    actorPoint: string | null | undefined,
    params: unknown[],
  ): Promise<string> {
    return this.ownerVisibleSqlFor(alias, await this.clients.separatePointFor(tenantID, actorPoint), params);
  }

  /**
   * 161 — «клиент моего тенанта» превратилось в «клиент, ВИДИМЫЙ мне»: в
   * раздельном режиме привязать машину к клиенту чужого филиала нельзя. Это
   * закрывает самый тихий обходной путь — узнать чужого клиента можно было,
   * просто привязав к нему авто и открыв карточку машины.
   */
  private async assertClientInTenant(clientId: string, tenantID: string, actorPoint?: string | null): Promise<void> {
    const params: unknown[] = [clientId, tenantID];
    const pointWhere = this.clients.separatePointWhere(
      null,
      await this.clients.separatePointFor(tenantID, actorPoint),
      params,
    );
    const { rows } = await this.pool.query(
      `SELECT 1 FROM clients WHERE id = $1 AND tenant_id = $2${pointWhere} LIMIT 1`,
      params,
    );
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
  async findByPlate(tenantID: string, plate: string, actorPoint?: string | null) {
    const norm = normalizePlate(plate || '');
    if (!norm.key) return null;
    // 161 — САМАЯ ЗАМЕТНАЯ УТЕЧКА раздельного режима: по одному госномеру
    // ручка отдавала ФИО и телефон владельца чужого филиала любому мастеру.
    // Теперь поиск по номеру подчиняется тем же границам, что база клиентов.
    const params: unknown[] = [tenantID, norm.key];
    const ownerWhere = await this.ownerVisibleSql('ca', tenantID, actorPoint, params);
    const { rows } = await this.pool.query(
      `SELECT ca.id, ca.plate_number, ca.make_model, ca.client_id, ca.created_at,
              cl.full_name AS client_full_name, cl.phone AS client_phone
       FROM cars ca
       LEFT JOIN clients cl ON cl.id = ca.client_id
       WHERE ca.tenant_id = $1
         AND REPLACE(REPLACE(REPLACE(UPPER(ca.plate_number), ' ', ''), '-', ''), '/', '') = $2${ownerWhere}
       ORDER BY ca.created_at LIMIT 1`,
      params,
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

  async getAll(tenantID: string, query: any, actorPoint?: string | null) {
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

    // Филиал — последним фильтром: дальше локальный idx для WHERE не растёт,
    // а LIMIT/OFFSET нумеруются от актуальной длины params.
    where += await this.ownerVisibleSql('ca', tenantID, actorPoint, params);

    const countResult = await this.pool.query(`SELECT COUNT(*) as total FROM cars ca WHERE ${where}`, params);
    const total = parseInt(countResult.rows[0].total);

    idx = params.length + 1;
    params.push(limit, offset);
    const { rows } = await this.pool.query(
      `SELECT ca.*, cl.full_name as client_full_name, cl.phone as client_phone
       FROM cars ca LEFT JOIN clients cl ON cl.id = ca.client_id
       WHERE ${where} ORDER BY ca.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
      params,
    );

    return { data: rows.map(this.mapCar), total, page, limit };
  }

  async getById(id: string, tenantID: string, actorPoint?: string | null) {
    const params: unknown[] = [id, tenantID];
    const ownerWhere = await this.ownerVisibleSql('ca', tenantID, actorPoint, params);
    const { rows } = await this.pool.query(
      `SELECT ca.*, cl.full_name as client_full_name, cl.phone as client_phone
       FROM cars ca LEFT JOIN clients cl ON cl.id = ca.client_id
       WHERE ca.id=$1 AND ca.tenant_id=$2${ownerWhere}`,
      params,
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

  async create(tenantID: string, dto: any, actorPoint?: string | null) {
    // If linked to a client, the client must live in the same tenant.
    // Without this a director could attach a car to another tenant's client.
    // 161 — и быть ВИДИМЫМ автору: в раздельном режиме привязка к клиенту
    // чужого филиала запрещена (см. assertClientInTenant).
    if (dto.clientId) {
      await this.assertClientInTenant(dto.clientId, tenantID, actorPoint);
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

  async update(id: string, tenantID: string, dto: any, actorPoint?: string | null) {
    // Точка автора — ОДИН раз на весь метод: и предварительная выборка
    // владельца, и финальный UPDATE обязаны резать один и тот же филиал.
    const viewerPoint = await this.clients.separatePointFor(tenantID, actorPoint);

    if (dto.clientId !== undefined && dto.clientId !== null) {
      await this.assertClientInTenant(dto.clientId, tenantID, actorPoint);
    }

    // Reassigning a car to a different owner (feature #9): guard against
    // creating a duplicate plate under the TARGET client. Only runs when a
    // real owner change is requested (`dto.clientId` present AND different from
    // the car's current client_id). Reuses the exact same normalization +
    // per-client lookup as create()'s idempotent-attach path. No-plate cars
    // («без номера») normalize to empty and are skipped — an empty plate is not
    // a stable identity.
    if (dto.clientId !== undefined && dto.clientId !== null) {
      // 161 — предварительная выборка текущего владельца тем же предикатом
      // видимости, что и сам UPDATE ниже. Без него машина чужого филиала
      // отдавала бы своего владельца (client_id) и его госномер автору,
      // которому этот гараж не виден, — тихая утечка через дедуп-проверку.
      const currentParams: unknown[] = [id, tenantID];
      const currentOwnerWhere = this.ownerVisibleSqlFor('cars', viewerPoint, currentParams);
      const { rows: currentRows } = await this.pool.query(
        `SELECT client_id, plate_number FROM cars WHERE id=$1 AND tenant_id=$2${currentOwnerWhere} LIMIT 1`,
        currentParams,
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

    if (sets.length === 0) return this.getById(id, tenantID, actorPoint);

    vals.push(id, tenantID);
    // 161 — ЕДИНСТВЕННЫЙ путь записи машины, у которого предиката видимости не
    // было: в раздельном режиме мастер чужого филиала мог перепривязать чужую
    // машину к СВОЕМУ клиенту (`clientId` проверялся только на «виден мне»,
    // а сама машина — нет) и вместе с ней увести историю чеков. Предикат тот
    // же, что в remove/getById; строка ownerWhere собирается ДО шаблона, её
    // плейсхолдер идёт после id и tenant_id (params.length уже вырос на два).
    const ownerWhere = this.ownerVisibleSqlFor('cars', viewerPoint, vals);
    const { rows } = await this.pool.query(
      `UPDATE cars SET ${sets.join(', ')} WHERE id=$${idx++} AND tenant_id=$${idx}${ownerWhere} RETURNING *`,
      vals,
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Машина не найдена' });
    return this.mapCar(rows[0]);
  }

  async remove(id: string, tenantID: string, actorPoint?: string | null) {
    // 161 — удалить машину клиента чужого филиала нельзя: тот же предикат
    // видимости, что и в чтении (иначе гараж филиала Б чистился бы из А).
    const params: unknown[] = [id, tenantID];
    const ownerWhere = await this.ownerVisibleSql('cars', tenantID, actorPoint, params);
    await this.pool.query(`DELETE FROM cars WHERE id=$1 AND tenant_id=$2${ownerWhere}`, params);
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
  async transferOwner(
    carId: string,
    tenantID: string,
    newClientId: string,
    moveHistory: boolean,
    actorPoint?: string | null,
  ) {
    // 1) Target client must exist in the tenant.
    // 161 — и быть ВИДИМЫМ автору. Перенос владельца на клиента чужого филиала
    // в раздельном режиме запрещён: вместе с машиной уехала бы вся история
    // чеков и рассрочка, то есть деньги сменили бы филиал незаметно для обоих.
    await this.assertClientInTenant(newClientId, tenantID, actorPoint);

    // 2) Load the car (tenant-scoped) → current owner + plate.
    const carParams: unknown[] = [carId, tenantID];
    const carOwnerWhere = await this.ownerVisibleSql('cars', tenantID, actorPoint, carParams);
    const { rows: carRows } = await this.pool.query(
      `SELECT id, client_id, plate_number, no_plate FROM cars WHERE id=$1 AND tenant_id=$2${carOwnerWhere} LIMIT 1`,
      carParams,
    );
    if (carRows.length === 0) throw new NotFoundException({ message: 'Машина не найдена' });
    const current = carRows[0];

    // Idempotent no-op: already owned by the target client.
    if (current.client_id === newClientId) {
      return { car: await this.getById(carId, tenantID, actorPoint), movedChecks: 0 };
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

    return { car: await this.getById(carId, tenantID, actorPoint), movedChecks };
  }

  /**
   * Recent checks for a specific car, newest-first. Belongs-to-tenant is
   * enforced via the WHERE clause; foreign cars yield an empty list rather
   * than 404 to keep the FE simple (an empty list is a valid history).
   */
  /**
   * ФИЛИАЛЫ (156/160) — ИСКЛЮЧЕНИЕ, НЕ «ЧИНИТЬ». Эта выборка СОЗНАТЕЛЬНО НЕ
   * фильтруется по точке (checks.point_id). Продуктовое требование владельца:
   * филиал видит только свои чеки, деньги, смены и отчёты, но база клиентов и
   * ИХ ИСТОРИЯ — единственное общее на всю сеть. Клиент обслуживался на
   * филиале А и приехал на Б: мастер обязан увидеть, что с машиной уже
   * делали, иначе он повторит работу или пропустит гарантийный случай.
   * Раздельный режим (tenants.points_shared_clients=false) режет СОСТАВ базы
   * клиентов в ClientsService.getAll, а не историю уже открытого клиента.
   * Зеркальные исключения: checks.getAll при ?clientId/?carId и
   * ClientsService.getChecksByCar.
   */
  async getChecks(id: string, tenantID: string, limit: number, actorPoint?: string | null) {
    // Verify car belongs to tenant — without this the foreign-id path
    // returns an empty array instead of a 404, which masks bugs.
    // 161 — скоупится ДОСТУП К МАШИНЕ (чужой гараж не открывается), но НЕ сами
    // чеки ниже: история открытой машины общая на всю сеть, см. блок
    // «ИСКЛЮЧЕНИЕ, НЕ ЧИНИТЬ» в доке метода.
    const carParams: unknown[] = [id, tenantID];
    const carOwnerWhere = await this.ownerVisibleSql('cars', tenantID, actorPoint, carParams);
    const { rows: carRows } = await this.pool.query(
      `SELECT 1 FROM cars WHERE id=$1 AND tenant_id=$2${carOwnerWhere} LIMIT 1`,
      carParams,
    );
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
