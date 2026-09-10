import { Injectable, Inject, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { capLimit } from '../common/cap-limit';
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
  async findByPhone(tenantID: string, phone: string, actorUserID?: string) {
    // Match on the normalized core so a client saved as «+7 (988) 444-44-85»
    // is found when the user types «89884444485» or «9884444485» (#64). The
    // previous exact `phone = '+7…'` compare missed every non-canonical row,
    // which is exactly why the duplicate-warning never fired and the cash
    // screen created a second client (#57 BUG B).
    const key = phoneSearchKey(phone || '');
    if (!key) return null;
    // 161 — в РАЗДЕЛЬНОМ режиме поиск по телефону обязан подчиняться тем же
    // границам, что и список: иначе одна ручка отдавала бы ФИО и телефон
    // клиента чужого филиала любому, кто просто наберёт номер.
    const params: unknown[] = [tenantID, key];
    const pointWhere = this.separatePointWhere(null, await this.separatePointFor(tenantID, actorUserID), params);
    const { rows } = await this.pool.query(
      `SELECT id, full_name, phone, created_at
       FROM clients WHERE tenant_id = $1 AND ${PHONE_KEY_SQL} = $2${pointWhere}
       ORDER BY created_at LIMIT 1`,
      params,
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

  /**
   * 156 — мульти-точки, раздельная база клиентов: точка запрашивающего, если
   * тенант выбрал points_shared_clients=false И точка у сотрудника выбрана;
   * иначе null (общая база — дефолт, поведение прежнее).
   */
  async separatePointFor(tenantID: string, userID?: string): Promise<string | null> {
    if (!userID) return null;
    const { rows } = await this.pool.query(
      `SELECT t.points_shared_clients AS shared, u.current_point_id AS point
         FROM tenants t, users u
        WHERE t.id = $1 AND u.id = $2 AND u.tenant_id = $1`,
      [tenantID, userID],
    );
    if (rows.length === 0) return null;
    return rows[0].shared === false && rows[0].point ? rows[0].point : null;
  }

  /**
   * SQL-фрагмент «клиент виден на этой точке» + push параметра в `params`.
   * Пустая строка при общей базе (дефолт) — запрос остаётся дословно прежним.
   *
   * ПОЧЕМУ `OR point_id IS NULL`, а не строгое равенство (в отличие от денег,
   * common/point-scope.ts): клиент без точки — ОБЩИЙ (розничный покупатель и
   * вся история до внедрения точек). Спрятать его от филиала значило бы
   * оставить кассу без покупателя по умолчанию. Задвоения денег тут нет:
   * клиент — не сумма, его «двойная видимость» ничего не складывает.
   *
   * ОДИН ИСТОЧНИК НА ВСЕ РУЧКИ. До 161 предикат жил только в getAll, и любой
   * другой запрос был обходным путём: по /clients/:id, lookup-by-phone,
   * export-csv и PATCH карточка чужого филиала открывалась целиком. Метод
   * ПУБЛИЧНЫЙ ровно поэтому: CarsService режет гараж тем же предикатом через
   * clients.point_id, а не собственной копией правила.
   */
  separatePointWhere(alias: string | null, point: string | null, params: unknown[]): string {
    if (!point) return '';
    params.push(point);
    const prefix = alias ? `${alias}.` : '';
    return ` AND (${prefix}point_id = $${params.length} OR ${prefix}point_id IS NULL)`;
  }

  async getAll(tenantID: string, query: any, actorUserID?: string) {
    const page = parseInt(query.page) || 1;
    const limit = capLimit(query.limit, 50, 1000);
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
      //
      // TRUNK-PREFIX VARIANT (round 7 item 8c): a PARTIAL query that still
      // carries the trunk digit — «8988», «8(988)», «7-988», «+7 988» — reduces
      // to a key starting with 8/7 («8988»), which is NOT a substring of the
      // stored national key («9884444485»): the leading trunk digit breaks
      // containment, so live narrowing found nothing until the number was long
      // enough for last-10 to shed it. Match BOTH the raw key and the key with
      // a single leading 7/8 stripped. A fragment genuinely starting with 8/7
      // («8444» mid-number) still matches via the raw variant — the OR only
      // widens results.
      // LETTER GUARD (round 7 item 8a root cause): a query with LETTERS is a
      // plate or a name, never a phone. Without this, «Х8» extracted digit '8'
      // and the phone branch LIKE '%8%' matched nearly every client — the
      // 20-row page filled with phone noise and the real Х8… plate matches
      // never reached the client, so plate suggestions "didn't work" until the
      // query got long enough to be selective. Digits-only queries keep the
      // full phone behaviour.
      const hasLetters = /[a-zа-яё]/i.test(search);
      const phoneKey = hasLetters ? '' : phoneSearchKey(search);
      if (phoneKey) {
        const phoneVariants = new Set<string>([phoneKey]);
        if (phoneKey.length >= 2 && (phoneKey[0] === '7' || phoneKey[0] === '8')) {
          phoneVariants.add(phoneKey.slice(1));
        }
        for (const variant of phoneVariants) {
          params.push(`%${variant}%`);
          ors.push(`${PHONE_KEY_SQL} LIKE $${params.length}`);
        }
      }

      // Plate: stored compactly (no spaces); match with spaces stripped.
      params.push(`%${search.replace(/\s+/g, '')}%`);
      ors.push(
        `EXISTS (SELECT 1 FROM cars ca WHERE ca.client_id = c.id AND REPLACE(ca.plate_number, ' ', '') ILIKE $${params.length})`,
      );

      where += ` AND (${ors.join(' OR ')})`;
    }

    // 156 — раздельная база клиентов по точкам: клиенты СВОЕЙ точки + общие/
    // исторические (point_id IS NULL, в т.ч. розничный покупатель). Общая
    // база (дефолт) — фильтра нет, поведение прежнее.
    where += this.separatePointWhere('c', await this.separatePointFor(tenantID, actorUserID), params);

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

  async getById(id: string, tenantID: string, actorUserID?: string) {
    // 161 — карточка клиента чужого филиала в раздельном режиме не должна
    // открываться по прямой ссылке (её id легко узнать из истории авто).
    const params: unknown[] = [id, tenantID];
    const pointWhere = this.separatePointWhere('c', await this.separatePointFor(tenantID, actorUserID), params);
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
       WHERE c.id=$1 AND c.tenant_id=$2${pointWhere}`,
      params,
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

  async create(tenantID: string, dto: any, actorUserID?: string) {
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
    // 156 — при раздельной базе новый клиент рождается НА точке автора;
    // при общей базе (дефолт) point_id остаётся NULL — виден всем.
    const creationPoint = await this.separatePointFor(tenantID, actorUserID);

    const key = phoneSearchKey(phone);
    if (key) {
      const { rows: dupe } = await this.pool.query(
        `SELECT id, full_name, phone, point_id FROM clients
          WHERE tenant_id = $1 AND ${PHONE_KEY_SQL} = $2
          ORDER BY created_at LIMIT 1`,
        [tenantID, key],
      );
      if (dupe.length > 0) {
        throw this.phoneConflict(dupe[0], creationPoint);
      }
    }

    try {
      const { rows } = await this.pool.query(
        `INSERT INTO clients (full_name, phone, comment, source, owner_notes, tenant_id, point_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [fullName, phone, dto.comment ?? null, dto.source ?? null, dto.ownerNotes ?? null, tenantID, creationPoint],
      );
      const client = this.mapClient(rows[0]);
      (client as any).cars = [];
      return client;
    } catch (err) {
      // Race loser of the pre-check above (108): a concurrent create slipped in
      // between the SELECT and this INSERT and the unique index
      // uq_clients_tenant_phone_key rejected the second row. Map it to the SAME
      // 409 CLIENT_PHONE_EXISTS contract the friendly path returns, so the UI
      // shows its normal «Перейти к клиенту» flow instead of a raw 500.
      throw (await this.mapPhoneUniqueViolation(err, tenantID, phone, creationPoint)) ?? err;
    }
  }

  /**
   * If `err` is the unique_violation (23505) from uq_clients_tenant_phone_key
   * (migration 108), look up the winning row and build the standard 409
   * ConflictException (`CLIENT_PHONE_EXISTS` + existing client payload).
   * Returns null for any other error so the caller rethrows it untouched.
   */
  private async mapPhoneUniqueViolation(err: unknown, tenantID: string, phone: string, viewerPoint: string | null) {
    const e = err as { code?: string; constraint?: string } | null;
    if (!e || e.code !== '23505' || e.constraint !== 'uq_clients_tenant_phone_key') return null;
    const key = phoneSearchKey(phone || '');
    if (!key) return null;
    const { rows } = await this.pool.query(
      `SELECT id, full_name, phone, point_id FROM clients
        WHERE tenant_id = $1 AND ${PHONE_KEY_SQL} = $2
        ORDER BY created_at LIMIT 1`,
      [tenantID, key],
    );
    if (rows.length === 0) return null; // winner vanished — let the raw error surface
    return this.phoneConflict(rows[0], viewerPoint);
  }

  /**
   * 409 «номер занят» — ОДНА точка сборки для обоих путей дедупа (пре-проверка
   * в create и гонка на уникальном индексе 108).
   *
   * ФИЛИАЛЫ (161). Уникальный индекс uq_clients_tenant_phone_key построен по
   * ТЕНАНТУ и точки не знает, поэтому в раздельном режиме дубль возможен с
   * карточкой ЧУЖОГО филиала. Индекс мы намеренно НЕ переделываем: разрешить
   * один номер на нескольких филиалах значит завести двух «одинаковых»
   * клиентов, которых потом никто не сведёт, — их долги, бонусы и рассрочки
   * разъедутся по разным карточкам, а это уже деньги. Ограничение остаётся
   * тенантным, меняется только ОТВЕТ:
   *   • номер занят видимой карточкой → прежний контракт CLIENT_PHONE_EXISTS
   *     с id и данными («Перейти к клиенту») — поведение 1:1;
   *   • номер занят карточкой другого филиала → НЕЙТРАЛЬНЫЙ текст без имени и
   *     без id. Иначе мастер филиала А узнавал бы ФИО клиента филиала Б,
   *     просто пытаясь его завести, а «Перейти к клиенту» вело бы в 404 —
   *     тупик, из которого нельзя выйти. Вместо этого говорим, ЧТО делать.
   */
  private phoneConflict(
    existing: { id: string; full_name: string; phone: string; point_id: string | null },
    viewerPoint: string | null,
  ) {
    const visible = !viewerPoint || existing.point_id === null || existing.point_id === viewerPoint;
    if (!visible) {
      return new ConflictException({
        message:
          'Этот номер уже занят карточкой другого филиала. Попросите владельца перевести клиента на ваш филиал ' +
          'или включить общую базу клиентов.',
        code: 'CLIENT_PHONE_EXISTS_OTHER_POINT',
      });
    }
    return new ConflictException({
      message: 'Клиент с этим номером уже добавлен',
      code: 'CLIENT_PHONE_EXISTS',
      clientId: existing.id,
      client: {
        id: existing.id,
        fullName: existing.full_name,
        phone: existing.phone,
      },
    });
  }

  async update(id: string, tenantID: string, dto: any, actorUserID?: string) {
    // 161 — правка чужого филиала невозможна: тот же предикат видимости, что и
    // в списке, уходит в WHERE — чужая карточка просто «не найдена».
    const viewerPoint = await this.separatePointFor(tenantID, actorUserID);
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

    if (sets.length === 0) return this.getById(id, tenantID, actorUserID);

    vals.push(id, tenantID);
    idx += 1; // теперь idx указывает на плейсхолдер tenant_id
    const pointWhere = this.separatePointWhere(null, viewerPoint, vals);
    try {
      const { rows } = await this.pool.query(
        `UPDATE clients SET ${sets.join(', ')} WHERE id=$${idx - 1} AND tenant_id=$${idx}${pointWhere} RETURNING *`,
        vals,
      );
      if (rows.length === 0) throw new NotFoundException({ message: 'Клиент не найден' });
      return this.mapClient(rows[0]);
    } catch (err) {
      // Editing a phone into one another client already owns hits the same
      // unique index (108) — surface the same 409 contract as create().
      throw (
        (await this.mapPhoneUniqueViolation(
          err,
          tenantID,
          typeof dto.phone === 'string' ? dto.phone : '',
          viewerPoint,
        )) ?? err
      );
    }
  }

  async exportCsv(tenantID: string, actorUserID?: string) {
    // 161 — выгрузка обязана отдавать РОВНО ту базу, которую человек видит на
    // экране: иначе экспорт становился бы самым простым способом получить
    // клиентов чужого филиала одним файлом.
    const params: unknown[] = [tenantID];
    const pointWhere = this.separatePointWhere(null, await this.separatePointFor(tenantID, actorUserID), params);
    const { rows } = await this.pool.query(
      `SELECT full_name, phone FROM clients WHERE tenant_id = $1${pointWhere} ORDER BY full_name`,
      params,
    );
    const header = 'Имя;Телефон';
    const lines = rows.map((r) => `${r.full_name};${r.phone}`);
    return [header, ...lines].join('\n');
  }

  async remove(id: string, tenantID: string, actorUserID?: string) {
    // 161 — удалить клиента чужого филиала нельзя: он «не найден». Проверка
    // стоит ПЕРВОЙ, до чтения обязательств, чтобы наружу не утекал даже факт
    // существования карточки.
    const checkParams: unknown[] = [id, tenantID];
    const pointWhere = this.separatePointWhere(null, await this.separatePointFor(tenantID, actorUserID), checkParams);
    // Refuse to delete the pinned retail client — it's a system row that
    // /cash relies on. Without this guard the cash screen would silently
    // lose its default buyer.
    const { rows: check } = await this.pool.query(
      `SELECT is_retail FROM clients WHERE id=$1 AND tenant_id=$2${pointWhere}`,
      checkParams,
    );
    if (check.length === 0) throw new NotFoundException({ message: 'Клиент не найден' });
    if (check.length > 0 && check[0].is_retail) {
      throw new NotFoundException({ message: 'Нельзя удалить розничного покупателя' });
    }

    // Hard delete каскадом уничтожает installment_plans / client_debts /
    // client_bonuses (FK CASCADE, мигр. 081/083/093) — деньги, которые клиент
    // должен, пропали бы из учёта без следа. Блокируем удаление, пока есть
    // открытая рассрочка или непогашенный долг (409 с понятным текстом).
    const { rows: obligations } = await this.pool.query(
      `SELECT
         (SELECT COUNT(*) FROM installment_plans
           WHERE client_id=$1 AND tenant_id=$2 AND status='open') AS open_plans,
         (SELECT COALESCE(SUM(CASE WHEN type='charge' THEN amount ELSE -amount END), 0)
            FROM client_debts WHERE client_id=$1 AND tenant_id=$2) AS debt_balance`,
      [id, tenantID],
    );
    const openPlans = parseInt(obligations[0].open_plans, 10) || 0;
    const debtBalance = parseFloat(obligations[0].debt_balance) || 0;
    if (openPlans > 0 || debtBalance > 0) {
      throw new ConflictException({
        message:
          openPlans > 0
            ? 'Нельзя удалить клиента: есть незакрытая рассрочка. Сначала закройте рассрочку.'
            : 'Нельзя удалить клиента: есть непогашенный долг. Сначала погасите или спишите долг.',
      });
    }

    await this.pool.query('DELETE FROM clients WHERE id=$1 AND tenant_id=$2', [id, tenantID]);
    return { message: 'Удалено' };
  }

  /**
   * Update just the `source` tag on a client. Trimmed and stored verbatim;
   * empty string normalised to NULL so the FE renders "Без источника".
   */
  async updateSource(id: string, tenantID: string, source: string | null, actorUserID?: string) {
    const normalized = typeof source === 'string' ? source.trim().slice(0, 100) : null;
    // 161 — тот же предикат видимости, что и в update(): чужая карточка «не найдена».
    const params: unknown[] = [normalized && normalized.length > 0 ? normalized : null, id, tenantID];
    const pointWhere = this.separatePointWhere(null, await this.separatePointFor(tenantID, actorUserID), params);
    const { rows } = await this.pool.query(
      `UPDATE clients SET source=$1 WHERE id=$2 AND tenant_id=$3${pointWhere} RETURNING *`,
      params,
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Клиент не найден' });
    return this.mapClient(rows[0]);
  }

  /**
   * Update just the `owner_notes` field. Free-form text — capped at 4000
   * chars so a runaway client can't blow up the table.
   */
  async updateNotes(id: string, tenantID: string, notes: string | null, actorUserID?: string) {
    const normalized = typeof notes === 'string' ? notes.slice(0, 4000) : null;
    const params: unknown[] = [normalized && normalized.length > 0 ? normalized : null, id, tenantID];
    const pointWhere = this.separatePointWhere(null, await this.separatePointFor(tenantID, actorUserID), params);
    const { rows } = await this.pool.query(
      `UPDATE clients SET owner_notes=$1 WHERE id=$2 AND tenant_id=$3${pointWhere} RETURNING *`,
      params,
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Клиент не найден' });
    return this.mapClient(rows[0]);
  }

  /**
   * Group the client's checks by car so the FE can render a per-car history
   * panel inside ClientDetail. Cars with zero checks still appear so the FE
   * doesn't have to do its own merge.
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
   * CarsService.getChecks.
   */
  async getChecksByCar(
    id: string,
    tenantID: string,
    opts: { limit?: number; offset?: number } = {},
    actorUserID?: string,
  ) {
    // 161 — скоупится ДОСТУП К КЛИЕНТУ (карточка чужого филиала не открывается),
    // но НЕ сами чеки ниже: открытая история клиента общая на всю сеть — см.
    // блок «ИСКЛЮЧЕНИЕ, НЕ ЧИНИТЬ» выше.
    const clientParams: unknown[] = [id, tenantID];
    const pointWhere = this.separatePointWhere(null, await this.separatePointFor(tenantID, actorUserID), clientParams);
    const { rows: clientRows } = await this.pool.query(
      `SELECT 1 FROM clients WHERE id=$1 AND tenant_id=$2${pointWhere}`,
      clientParams,
    );
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
       WHERE ch.tenant_id=$1 AND ch.client_id=$2 AND ch.deleted_at IS NULL
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
