import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
  Optional,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../database.module';
import { WarrantyService } from '../warranty/warranty.service';
import { PushService } from '../push/push.service';
import { parseFields, filterShape } from '../common/field-filter';
import { ttlCache } from '../common/ttl-cache';
import { invalidateReportsForTenant } from '../common/reports-cache';

// Only tables we explicitly want to allow as targets of cross-tenant
// assertions. Keeping this as an allow-list (not a string the caller
// passes through) means even if a future refactor mistakenly forwards
// user input as the table name, the helper rejects it.
const TENANT_OWNED_TABLES = new Set(['users', 'clients', 'cars', 'services', 'products']);

@Injectable()
export class ChecksService {
  private readonly logger = new Logger('ChecksService');

  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private warranty: WarrantyService,
    @Optional() private pushService?: PushService,
  ) {}

  /**
   * Throw NotFoundException unless `id` exists in `table` AND belongs to the
   * caller's `tenantID`. Used at the top of write operations to prevent a
   * privileged caller from referencing rows from a foreign tenant.
   *
   * `table` is checked against TENANT_OWNED_TABLES — never interpolate user
   * input here. The column is always `id` + `tenant_id` by convention.
   */
  private async assertOwnsByTenant(
    client: PoolClient,
    tenantID: string,
    table: string,
    id: string,
    label: string,
  ): Promise<void> {
    if (!TENANT_OWNED_TABLES.has(table)) {
      throw new InternalServerErrorException({ message: 'Internal assertion error' });
    }
    const { rows } = await client.query(`SELECT 1 FROM ${table} WHERE id = $1 AND tenant_id = $2 LIMIT 1`, [
      id,
      tenantID,
    ]);
    if (rows.length === 0) {
      throw new BadRequestException({ message: `${label} не найден` });
    }
  }

  private async assertManyOwnedByTenant(
    client: PoolClient,
    tenantID: string,
    table: string,
    ids: string[],
    label: string,
  ): Promise<void> {
    if (!TENANT_OWNED_TABLES.has(table)) {
      throw new InternalServerErrorException({ message: 'Internal assertion error' });
    }
    const uniqueIds = Array.from(new Set(ids));
    if (uniqueIds.length === 0) return;
    const { rows } = await client.query(`SELECT id FROM ${table} WHERE id = ANY($1) AND tenant_id = $2`, [
      uniqueIds,
      tenantID,
    ]);
    if (rows.length !== uniqueIds.length) {
      throw new BadRequestException({ message: `${label} не найден или принадлежит другому автосервису` });
    }
  }

  private invalidateReports(tenantID: string) {
    invalidateReportsForTenant(tenantID);
  }

  private mapCheck(row: any) {
    return {
      id: row.id,
      number: row.number,
      date: row.date,
      masterId: row.master_id,
      clientId: row.client_id,
      carId: row.car_id,
      mileage: row.mileage,
      comment: row.comment,
      discount: parseFloat(row.discount) || 0,
      isDeferred: row.is_deferred,
      paymentMethod: row.payment_method,
      cashAmount: parseFloat(row.cash_amount) || 0,
      cardAmount: parseFloat(row.card_amount) || 0,
      serviceTotal: parseFloat(row.service_total) || 0,
      productTotal: parseFloat(row.product_total) || 0,
      totalRevenue: parseFloat(row.total_revenue) || 0,
      productCostTotal: parseFloat(row.product_cost_total) || 0,
      serviceSalaryTotal: parseFloat(row.service_salary_total) || 0,
      productSalaryTotal: parseFloat(row.product_salary_total) || 0,
      totalCost: parseFloat(row.total_cost) || 0,
      profit: parseFloat(row.profit) || 0,
      // Returns metadata: 040 added is_returned + returned_at + return_destination + return_scope.
      // FE renders a strikethrough / red badge on returned checks in the journal.
      isReturned: !!row.is_returned,
      returnedAt: row.returned_at ?? null,
      returnDestination: row.return_destination ?? null,
      returnScope: row.return_scope ?? null,
      createdAt: row.created_at,
    };
  }

  async getAll(tenantID: string, query: any) {
    const page = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 50;
    const offset = (page - 1) * limit;

    let where = 'ch.tenant_id = $1';
    const params: any[] = [tenantID];
    let idx = 2;

    if (query.masterId) {
      where += ` AND ch.master_id = $${idx++}`;
      params.push(query.masterId);
    }
    if (query.clientId) {
      where += ` AND ch.client_id = $${idx++}`;
      params.push(query.clientId);
    }
    if (query.carId) {
      where += ` AND ch.car_id = $${idx++}`;
      params.push(query.carId);
    }
    if (query.dateFrom) {
      where += ` AND ch.date >= $${idx++}`;
      params.push(query.dateFrom);
    }
    if (query.dateTo) {
      where += ` AND ch.date <= $${idx++}`;
      params.push(query.dateTo + 'T23:59:59Z');
    }
    if (query.retail === 'true') {
      where += ` AND ch.client_id IS NULL`;
    }
    if (query.search) {
      where += ` AND (cl.full_name ILIKE $${idx} OR cl.phone ILIKE $${idx} OR ca.plate_number ILIKE $${idx})`;
      params.push(`%${query.search}%`);
      idx++;
    }

    // The clients+cars LEFT JOINs only exist to satisfy the `search` filter
    // (cl.full_name / cl.phone / ca.plate_number). With no search term the
    // COUNT can run on `checks` alone — dropping two joins per page load on
    // the most-hit list endpoint. The response shape is unchanged.
    const countResult = query.search
      ? await this.pool.query(
          `SELECT COUNT(*) as total FROM checks ch
           LEFT JOIN clients cl ON cl.id = ch.client_id
           LEFT JOIN cars ca ON ca.id = ch.car_id
           WHERE ${where}`,
          params,
        )
      : await this.pool.query(`SELECT COUNT(*) as total FROM checks ch WHERE ${where}`, params);
    const total = parseInt(countResult.rows[0].total);

    params.push(limit, offset);
    const { rows } = await this.pool.query(
      `SELECT ch.*,
              m.full_name as master_name, m.avatar as master_avatar,
              cl.full_name as client_name, cl.phone as client_phone,
              ca.plate_number, ca.make_model
       FROM checks ch
       LEFT JOIN users m ON m.id = ch.master_id
       LEFT JOIN clients cl ON cl.id = ch.client_id
       LEFT JOIN cars ca ON ca.id = ch.car_id
       WHERE ${where}
       ORDER BY ch.date DESC, ch.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      params,
    );

    const fields = parseFields(query.fields);
    const checks = rows.map((row) => {
      const ch = this.mapCheck(row);
      if (row.master_id) {
        (ch as any).master = { id: row.master_id, fullName: row.master_name, avatar: row.master_avatar };
      }
      if (row.client_id) {
        (ch as any).client = { id: row.client_id, fullName: row.client_name, phone: row.client_phone };
      }
      if (row.car_id) {
        (ch as any).car = { id: row.car_id, plateNumber: row.plate_number, makeModel: row.make_model };
      }
      // Slim payload: list view never carries inline service / product line
      // arrays — they belong to the detail endpoint. Caller can opt in to a
      // subset via ?fields=. Counts are intentionally not included; the FE
      // already has serviceTotal + productTotal in the row.
      return filterShape(ch as Record<string, unknown>, fields);
    });

    return { data: checks, total, page, limit };
  }

  async getById(id: string, tenantID: string) {
    const { rows } = await this.pool.query(
      `SELECT ch.*,
              m.full_name as master_name, m.avatar as master_avatar,
              cl.full_name as client_name, cl.phone as client_phone,
              ca.plate_number, ca.make_model
       FROM checks ch
       LEFT JOIN users m ON m.id = ch.master_id
       LEFT JOIN clients cl ON cl.id = ch.client_id
       LEFT JOIN cars ca ON ca.id = ch.car_id
       WHERE ch.id=$1 AND ch.tenant_id=$2`,
      [id, tenantID],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Заказ-наряд не найден' });

    const row = rows[0];
    const ch: any = this.mapCheck(row);
    if (row.master_id) ch.master = { id: row.master_id, fullName: row.master_name, avatar: row.master_avatar };
    if (row.client_id) ch.client = { id: row.client_id, fullName: row.client_name, phone: row.client_phone };
    if (row.car_id) ch.car = { id: row.car_id, plateNumber: row.plate_number, makeModel: row.make_model };

    // Load service lines (check_id already verified against tenant above)
    const { rows: svcRows } = await this.pool.query(
      `SELECT sl.*, u.full_name as master_name
       FROM check_service_lines sl
       JOIN checks c ON c.id = sl.check_id AND c.tenant_id = $2
       LEFT JOIN users u ON u.id = sl.master_id
       WHERE sl.check_id=$1`,
      [id, tenantID],
    );
    ch.services = svcRows.map((s) => ({
      id: s.id,
      serviceId: s.service_id,
      masterId: s.master_id,
      master: s.master_id ? { id: s.master_id, fullName: s.master_name } : undefined,
      name: s.name,
      price: parseFloat(s.price) || 0,
      quantity: s.quantity,
      total: parseFloat(s.total) || 0,
    }));

    // Load product lines (tenant-scoped via JOIN)
    const { rows: prodRows } = await this.pool.query(
      `SELECT pl.* FROM check_product_lines pl
       JOIN checks c ON c.id = pl.check_id AND c.tenant_id = $2
       WHERE pl.check_id=$1`,
      [id, tenantID],
    );
    ch.products = prodRows.map((p) => ({
      id: p.id,
      productId: p.product_id,
      name: p.name,
      sellPrice: parseFloat(p.sell_price) || 0,
      costPrice: parseFloat(p.cost_price) || 0,
      quantity: parseFloat(p.quantity) || 0,
      totalSell: parseFloat(p.total_sell) || 0,
      totalCost: parseFloat(p.total_cost) || 0,
    }));

    // Warranty claims tied to this check (may be empty — only filled when
    // a product/service had warranty_days set at sale time).
    ch.warrantyClaims = await this.warranty.listForCheck(tenantID, id);

    return ch;
  }

  async create(tenantID: string, userID: string, userRole: string, dto: any) {
    if (!dto.masterId) throw new BadRequestException({ message: 'Мастер обязателен' });

    const services = dto.services || [];
    const products = dto.products || [];

    if (!dto.isDeferred && services.length === 0 && products.length === 0) {
      throw new BadRequestException({ message: 'Добавьте хотя бы одну услугу или товар' });
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // ── Cross-tenant integrity guard ─────────────────────────────────
      // Every referenced ID (master, client, car, services, products) MUST
      // belong to the caller's tenant. Without this, a director from
      // tenant A who knows a UUID from tenant B could persist a check
      // with foreign references — the check would land in A's listing
      // (because we set tenant_id from JWT) but JOINs would surface B's
      // client name / car plate / product name to A's masters, and
      // mutate B's product stock via the post-insert UPDATE.
      await this.assertOwnsByTenant(client, tenantID, 'users', dto.masterId, 'Мастер');
      if (dto.clientId) {
        await this.assertOwnsByTenant(client, tenantID, 'clients', dto.clientId, 'Клиент');
      }
      if (dto.carId) {
        await this.assertOwnsByTenant(client, tenantID, 'cars', dto.carId, 'Машина');
      }
      const referencedServiceIds: string[] = services
        .map((s: any) => s.serviceId)
        .filter((x: string | undefined): x is string => !!x);
      if (referencedServiceIds.length > 0) {
        await this.assertManyOwnedByTenant(client, tenantID, 'services', referencedServiceIds, 'Услуга');
      }
      const referencedProductIds: string[] = products
        .map((p: any) => p.productId)
        .filter((x: string | undefined): x is string => !!x);
      if (referencedProductIds.length > 0) {
        await this.assertManyOwnedByTenant(client, tenantID, 'products', referencedProductIds, 'Товар');
      }
      // Per-line master overrides too — masters live in users with tenant_id
      const lineMasterIds: string[] = services
        .map((s: any) => s.masterId)
        .filter((x: string | undefined): x is string => !!x);
      if (lineMasterIds.length > 0) {
        await this.assertManyOwnedByTenant(client, tenantID, 'users', lineMasterIds, 'Мастер');
      }

      // Calculate service totals and salary
      let serviceTotal = 0;
      let serviceSalaryTotal = 0;

      // Collect unique master IDs for salary lookup
      const masterIds = new Set<string>();
      masterIds.add(dto.masterId);
      for (const svc of services) {
        if (svc.masterId) masterIds.add(svc.masterId);
      }

      // Fetch salary percentages
      const salaryMap: Record<string, number> = {};
      if (masterIds.size > 0) {
        const { rows: salaryRows } = await client.query(
          `SELECT id, COALESCE(salary_percent, 0) as salary_percent FROM users WHERE id = ANY($1) AND tenant_id = $2`,
          [Array.from(masterIds), tenantID],
        );
        for (const r of salaryRows) {
          salaryMap[r.id] = parseFloat(r.salary_percent) || 0;
        }
      }

      // Fetch service master_percent overrides
      const serviceIds = services.map((s: any) => s.serviceId).filter(Boolean);
      const serviceMasterPct: Record<string, number | null> = {};
      if (serviceIds.length > 0) {
        const { rows: srvRows } = await client.query(
          `SELECT id, master_percent FROM services WHERE id = ANY($1) AND tenant_id = $2`,
          [serviceIds, tenantID],
        );
        for (const r of srvRows) {
          serviceMasterPct[r.id] =
            r.master_percent !== null && r.master_percent !== undefined ? parseFloat(r.master_percent) : null;
        }
      }

      const serviceLines: any[] = [];
      for (const svc of services) {
        const total = (svc.price || 0) * (svc.quantity || 1);
        serviceTotal += total;
        const masterId = svc.masterId || dto.masterId;
        // Service-specific percent takes priority over master default
        const serviceOverride = svc.serviceId ? serviceMasterPct[svc.serviceId] : null;
        const salaryPct = serviceOverride !== null ? serviceOverride : salaryMap[masterId] || 0;
        serviceSalaryTotal += (total * salaryPct) / 100;
        serviceLines.push({ ...svc, total, masterId });
      }

      // Calculate product totals and product commission for master
      let productTotal = 0;
      let productCostTotal = 0;
      let productSalaryTotal = 0;
      const productLines: any[] = [];

      // Fetch master's product commission settings (tenant-scoped)
      const mainMasterId = dto.masterId;
      const { rows: masterProdRows } = await client.query(
        'SELECT COALESCE(product_salary_percent, 0) as product_salary_percent FROM users WHERE id = $1 AND tenant_id = $2',
        [mainMasterId, tenantID],
      );
      const globalProductPct = parseFloat(masterProdRows[0]?.product_salary_percent) || 0;

      // Fetch product-specific commissions for this master
      const productCommissionMap: Record<string, number> = {};
      if (products.length > 0) {
        const prodIds = products.map((p: Record<string, unknown>) => p.productId).filter(Boolean);
        if (prodIds.length > 0) {
          const { rows: pcRows } = await client.query(
            `SELECT product_id, percent FROM product_commissions WHERE user_id = $1 AND product_id = ANY($2) AND tenant_id = $3`,
            [mainMasterId, prodIds, tenantID],
          );
          for (const r of pcRows) {
            productCommissionMap[r.product_id] = parseFloat(r.percent) || 0;
          }
        }
      }

      for (const prod of products) {
        const totalSell = (prod.sellPrice || 0) * (prod.quantity || 1);
        const totalCost = (prod.costPrice || 0) * (prod.quantity || 1);
        const productProfit = totalSell - totalCost;
        productTotal += totalSell;
        productCostTotal += totalCost;

        // Product commission: specific per-product % takes priority, otherwise global %
        const pct = productCommissionMap[prod.productId] ?? globalProductPct;
        if (pct > 0 && productProfit > 0) {
          productSalaryTotal += (productProfit * pct) / 100;
        }

        productLines.push({ ...prod, totalSell, totalCost });
      }

      const discount = dto.discount || 0;
      const discountedProductTotal = productTotal - discount;
      const totalRevenue = serviceTotal + (discountedProductTotal > 0 ? discountedProductTotal : 0);
      const totalCost = productCostTotal + serviceSalaryTotal + productSalaryTotal;
      const profit = totalRevenue - totalCost;

      // Parse date
      let checkDate = dto.date || new Date().toISOString();

      // Masters can only create checks for today
      if (userRole === 'master' && dto.date) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const inputDate = new Date(dto.date);
        inputDate.setHours(0, 0, 0, 0);
        if (inputDate.getTime() !== today.getTime()) {
          checkDate = new Date().toISOString();
        }
      }

      const { rows: checkRows } = await client.query(
        `INSERT INTO checks (date, master_id, client_id, car_id, mileage, comment, discount,
         is_deferred, payment_method, cash_amount, card_amount,
         service_total, product_total, total_revenue, product_cost_total,
         service_salary_total, product_salary_total, total_cost, profit, tenant_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         RETURNING *`,
        [
          checkDate,
          dto.masterId,
          dto.clientId || null,
          dto.carId || null,
          dto.mileage || null,
          dto.comment || null,
          discount,
          dto.isDeferred || false,
          dto.paymentMethod || 'cash',
          dto.cashAmount || 0,
          dto.cardAmount || 0,
          serviceTotal,
          productTotal,
          totalRevenue,
          productCostTotal,
          serviceSalaryTotal,
          productSalaryTotal,
          totalCost,
          profit,
          tenantID,
        ],
      );

      const checkId = checkRows[0].id;

      // Insert service lines
      for (const svc of serviceLines) {
        await client.query(
          `INSERT INTO check_service_lines (check_id, service_id, master_id, name, price, quantity, total)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            checkId,
            svc.serviceId || null,
            svc.masterId || null,
            svc.name,
            svc.price || 0,
            svc.quantity || 1,
            svc.total,
          ],
        );
      }

      // Insert product lines and update stock
      for (const prod of productLines) {
        await client.query(
          `INSERT INTO check_product_lines (check_id, product_id, name, sell_price, cost_price, quantity, total_sell, total_cost)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            checkId,
            prod.productId || null,
            prod.name,
            prod.sellPrice || 0,
            prod.costPrice || 0,
            prod.quantity || 1,
            prod.totalSell,
            prod.totalCost,
          ],
        );

        // Decrease product stock
        if (prod.productId && !dto.isDeferred) {
          await client.query(`UPDATE products SET stock = GREATEST(stock - $1, 0) WHERE id = $2 AND tenant_id = $3`, [
            prod.quantity || 1,
            prod.productId,
            tenantID,
          ]);
        }
      }

      // Spawn warranty_claims rows for any product/service in this check
      // whose master record has warranty_days set. Skip for deferred
      // (drafts) checks — warranty only starts when the work is actually
      // performed / sold.
      if (!dto.isDeferred) {
        const warrantyLines: Array<{
          kind: 'product' | 'service';
          productId?: string | null;
          serviceId?: string | null;
          itemName?: string | null;
        }> = [];
        for (const svc of serviceLines) {
          if (svc.serviceId) {
            warrantyLines.push({ kind: 'service', serviceId: svc.serviceId, itemName: svc.name });
          }
        }
        for (const prod of productLines) {
          if (prod.productId) {
            warrantyLines.push({ kind: 'product', productId: prod.productId, itemName: prod.name });
          }
        }
        if (warrantyLines.length > 0) {
          await this.warranty.createFromCheckLines(
            client,
            tenantID,
            checkId,
            checkDate,
            dto.clientId || null,
            dto.carId || null,
            warrantyLines,
          );
        }
      }

      await client.query('COMMIT');

      // A new sale changes revenue/profit/ranking — drop cached aggregates so
      // the dashboard reflects it immediately instead of up to 30s late.
      this.invalidateReports(tenantID);

      const savedCheck = await this.getById(checkId, tenantID);

      // Push notification to master when assigned by someone else
      if (this.pushService && dto.masterId && dto.masterId !== userID) {
        const checkNumber = (savedCheck as any).number;
        this.pushService
          .sendToUser(dto.masterId, 'Новый заказ-наряд', `Назначен заказ-наряд #${checkNumber}`)
          .catch(() => {
            /* non-fatal */
          });
      }

      return savedCheck;
    } catch (err) {
      await client.query('ROLLBACK');
      if (err instanceof BadRequestException || err instanceof NotFoundException) throw err;
      this.logger.error(`Check create error: ${err}`);
      throw new InternalServerErrorException({ message: 'Ошибка сервера' });
    } finally {
      client.release();
    }
  }

  async update(id: string, tenantID: string, userRole: string, dto: any) {
    // If services or products are provided, do a full re-edit (only for deferred checks)
    if (dto.services !== undefined || dto.products !== undefined) {
      return this.fullUpdate(id, tenantID, userRole, dto);
    }

    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;

    if (dto.date !== undefined) {
      if (!['director', 'admin', 'superadmin'].includes(userRole)) {
        throw new ForbiddenException({ message: 'Нет прав на изменение даты' });
      }
      sets.push(`date=$${idx++}`);
      vals.push(dto.date);
    }
    if (dto.paymentMethod !== undefined) {
      sets.push(`payment_method=$${idx++}`);
      vals.push(dto.paymentMethod);
    }
    if (dto.isDeferred !== undefined) {
      sets.push(`is_deferred=$${idx++}`);
      vals.push(dto.isDeferred);
    }
    if (dto.comment !== undefined) {
      sets.push(`comment=$${idx++}`);
      vals.push(dto.comment);
    }
    if (dto.cashAmount !== undefined) {
      sets.push(`cash_amount=$${idx++}`);
      vals.push(dto.cashAmount);
    }
    if (dto.cardAmount !== undefined) {
      sets.push(`card_amount=$${idx++}`);
      vals.push(dto.cardAmount);
    }
    if (dto.paymentStatus !== undefined) {
      sets.push(`payment_status=$${idx++}`);
      vals.push(dto.paymentStatus);
    }

    if (sets.length === 0) return this.getById(id, tenantID);

    vals.push(id, tenantID);
    const { rows } = await this.pool.query(
      `UPDATE checks SET ${sets.join(', ')} WHERE id=$${idx++} AND tenant_id=$${idx} RETURNING id, number, total_revenue, payment_status`,
      vals,
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Заказ-наряд не найден' });

    // Payment-method / amount / status edits can move the cash-position and
    // dashboard tiles — invalidate the tenant's report caches.
    this.invalidateReports(tenantID);

    // Push directors/admins when check is marked paid
    if (this.pushService && dto.paymentStatus === 'paid') {
      const updatedRow = rows[0];
      const totalRevenue: number = parseFloat(updatedRow.total_revenue) || 0;
      const checkNumber: number = updatedRow.number;
      const formatted = new Intl.NumberFormat('ru-RU', {
        style: 'currency',
        currency: 'RUB',
        maximumFractionDigits: 0,
      }).format(totalRevenue);
      const { rows: managers } = await this.pool.query(
        `SELECT id FROM users WHERE tenant_id=$1 AND role IN ('director','admin')`,
        [tenantID],
      );
      for (const mgr of managers) {
        this.pushService.sendToUser(mgr.id, 'Чек закрыт', `Чек #${checkNumber} закрыт — ${formatted}`).catch(() => {
          /* non-fatal */
        });
      }
    }

    return this.getById(id, tenantID);
  }

  private async fullUpdate(id: string, tenantID: string, userRole: string, dto: any) {
    // Verify check exists and is deferred
    const { rows: checkRows } = await this.pool.query('SELECT * FROM checks WHERE id=$1 AND tenant_id=$2', [
      id,
      tenantID,
    ]);
    if (checkRows.length === 0) throw new NotFoundException({ message: 'Заказ-наряд не найден' });
    if (!checkRows[0].is_deferred) {
      throw new ForbiddenException({ message: 'Редактирование доступно только для отложенных чеков' });
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const services = dto.services || [];
      const products = dto.products || [];

      // Calculate service totals and salary
      let serviceTotal = 0;
      let serviceSalaryTotal = 0;

      const masterIds = new Set<string>();
      if (dto.masterId) masterIds.add(dto.masterId);
      const existingMasterId = checkRows[0].master_id;
      if (existingMasterId) masterIds.add(existingMasterId);
      for (const svc of services) {
        if (svc.masterId) masterIds.add(svc.masterId);
      }

      const salaryMap: Record<string, number> = {};
      if (masterIds.size > 0) {
        const { rows: salaryRows } = await client.query(
          `SELECT id, COALESCE(salary_percent, 0) as salary_percent FROM users WHERE id = ANY($1) AND tenant_id = $2`,
          [Array.from(masterIds), tenantID],
        );
        for (const r of salaryRows) {
          salaryMap[r.id] = parseFloat(r.salary_percent) || 0;
        }
      }

      // Service-specific percent overrides
      const serviceIds = services.map((s: any) => s.serviceId).filter(Boolean);
      const serviceMasterPct: Record<string, number | null> = {};
      if (serviceIds.length > 0) {
        const { rows: srvRows } = await client.query(
          `SELECT id, master_percent FROM services WHERE id = ANY($1) AND tenant_id = $2`,
          [serviceIds, tenantID],
        );
        for (const r of srvRows) {
          serviceMasterPct[r.id] =
            r.master_percent !== null && r.master_percent !== undefined ? parseFloat(r.master_percent) : null;
        }
      }

      const serviceLines: any[] = [];
      const primaryMasterId = dto.masterId || existingMasterId;
      for (const svc of services) {
        const total = (svc.price || 0) * (svc.quantity || 1);
        serviceTotal += total;
        const masterId = svc.masterId || primaryMasterId;
        const serviceOverride = svc.serviceId ? serviceMasterPct[svc.serviceId] : null;
        const salaryPct = serviceOverride !== null ? serviceOverride : salaryMap[masterId] || 0;
        serviceSalaryTotal += (total * salaryPct) / 100;
        serviceLines.push({ ...svc, total, masterId });
      }

      // Calculate product totals and product commission
      let productTotal = 0;
      let productCostTotal = 0;
      let productSalaryTotal = 0;
      const productLines: any[] = [];

      // Fetch master's product commission settings (tenant-scoped)
      const { rows: masterProdRows } = await client.query(
        'SELECT COALESCE(product_salary_percent, 0) as product_salary_percent FROM users WHERE id = $1 AND tenant_id = $2',
        [primaryMasterId, tenantID],
      );
      const globalProductPct = parseFloat(masterProdRows[0]?.product_salary_percent) || 0;

      const productCommissionMap: Record<string, number> = {};
      if (products.length > 0) {
        const prodIds = products.map((p: Record<string, unknown>) => p.productId).filter(Boolean);
        if (prodIds.length > 0) {
          const { rows: pcRows } = await client.query(
            `SELECT product_id, percent FROM product_commissions WHERE user_id = $1 AND product_id = ANY($2) AND tenant_id = $3`,
            [primaryMasterId, prodIds, tenantID],
          );
          for (const r of pcRows) {
            productCommissionMap[r.product_id] = parseFloat(r.percent) || 0;
          }
        }
      }

      for (const prod of products) {
        const totalSell = (prod.sellPrice || 0) * (prod.quantity || 1);
        const totalCost = (prod.costPrice || 0) * (prod.quantity || 1);
        const productProfit = totalSell - totalCost;
        productTotal += totalSell;
        productCostTotal += totalCost;

        const pct = productCommissionMap[prod.productId] ?? globalProductPct;
        if (pct > 0 && productProfit > 0) {
          productSalaryTotal += (productProfit * pct) / 100;
        }

        productLines.push({ ...prod, totalSell, totalCost });
      }

      const discount = dto.discount ?? (parseFloat(checkRows[0].discount) || 0);
      const discountedProductTotal = productTotal - discount;
      const totalRevenue = serviceTotal + (discountedProductTotal > 0 ? discountedProductTotal : 0);
      const totalCost = productCostTotal + serviceSalaryTotal + productSalaryTotal;
      const profit = totalRevenue - totalCost;

      // Update check record
      const updateFields: string[] = [];
      const updateVals: any[] = [];
      let ui = 1;

      if (dto.masterId !== undefined) {
        updateFields.push(`master_id=$${ui++}`);
        updateVals.push(dto.masterId);
      }
      if (dto.clientId !== undefined) {
        updateFields.push(`client_id=$${ui++}`);
        updateVals.push(dto.clientId || null);
      }
      if (dto.carId !== undefined) {
        updateFields.push(`car_id=$${ui++}`);
        updateVals.push(dto.carId || null);
      }
      if (dto.mileage !== undefined) {
        updateFields.push(`mileage=$${ui++}`);
        updateVals.push(dto.mileage || null);
      }
      if (dto.comment !== undefined) {
        updateFields.push(`comment=$${ui++}`);
        updateVals.push(dto.comment || null);
      }
      if (dto.discount !== undefined) {
        updateFields.push(`discount=$${ui++}`);
        updateVals.push(dto.discount || 0);
      }
      if (dto.paymentMethod !== undefined) {
        updateFields.push(`payment_method=$${ui++}`);
        updateVals.push(dto.paymentMethod);
      }
      if (dto.cashAmount !== undefined) {
        updateFields.push(`cash_amount=$${ui++}`);
        updateVals.push(dto.cashAmount || 0);
      }
      if (dto.cardAmount !== undefined) {
        updateFields.push(`card_amount=$${ui++}`);
        updateVals.push(dto.cardAmount || 0);
      }
      if (dto.isDeferred !== undefined) {
        updateFields.push(`is_deferred=$${ui++}`);
        updateVals.push(dto.isDeferred);
      }

      // Always update calculated fields
      updateFields.push(`service_total=$${ui++}`);
      updateVals.push(serviceTotal);
      updateFields.push(`product_total=$${ui++}`);
      updateVals.push(productTotal);
      updateFields.push(`total_revenue=$${ui++}`);
      updateVals.push(totalRevenue);
      updateFields.push(`product_cost_total=$${ui++}`);
      updateVals.push(productCostTotal);
      updateFields.push(`service_salary_total=$${ui++}`);
      updateVals.push(serviceSalaryTotal);
      updateFields.push(`product_salary_total=$${ui++}`);
      updateVals.push(productSalaryTotal);
      updateFields.push(`total_cost=$${ui++}`);
      updateVals.push(totalCost);
      updateFields.push(`profit=$${ui++}`);
      updateVals.push(profit);

      updateVals.push(id, tenantID);
      await client.query(
        `UPDATE checks SET ${updateFields.join(', ')} WHERE id=$${ui++} AND tenant_id=$${ui}`,
        updateVals,
      );

      // Delete existing lines and re-insert
      await client.query('DELETE FROM check_service_lines WHERE check_id=$1', [id]);
      await client.query('DELETE FROM check_product_lines WHERE check_id=$1', [id]);

      for (const svc of serviceLines) {
        await client.query(
          `INSERT INTO check_service_lines (check_id, service_id, master_id, name, price, quantity, total) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [id, svc.serviceId || null, svc.masterId || null, svc.name, svc.price || 0, svc.quantity || 1, svc.total],
        );
      }

      for (const prod of productLines) {
        await client.query(
          `INSERT INTO check_product_lines (check_id, product_id, name, sell_price, cost_price, quantity, total_sell, total_cost) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            id,
            prod.productId || null,
            prod.name,
            prod.sellPrice || 0,
            prod.costPrice || 0,
            prod.quantity || 1,
            prod.totalSell,
            prod.totalCost,
          ],
        );
      }

      await client.query('COMMIT');
      this.invalidateReports(tenantID);
      return this.getById(id, tenantID);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async remove(id: string, tenantID: string, userRole: string) {
    const { rows } = await this.pool.query('SELECT is_deferred FROM checks WHERE id=$1 AND tenant_id=$2', [
      id,
      tenantID,
    ]);
    if (rows.length === 0) throw new NotFoundException({ message: 'Заказ-наряд не найден' });

    if (userRole === 'master' && !rows[0].is_deferred) {
      throw new ForbiddenException({ message: 'Мастер не может удалить закрытый заказ-наряд' });
    }

    await this.pool.query('DELETE FROM checks WHERE id=$1 AND tenant_id=$2', [id, tenantID]);
    this.invalidateReports(tenantID);
    return { message: 'Удалено' };
  }

  async getDashboard(tenantID: string) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() + 1).toISOString();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const { rows } = await this.pool.query(
      `SELECT
         COALESCE(SUM(CASE WHEN date >= $2 THEN total_revenue END), 0) as today_revenue,
         COALESCE(COUNT(CASE WHEN date >= $2 THEN 1 END), 0) as today_checks,
         COALESCE(SUM(CASE WHEN date >= $3 THEN total_revenue END), 0) as week_revenue,
         COALESCE(SUM(CASE WHEN date >= $4 THEN total_revenue END), 0) as month_revenue,
         COALESCE(SUM(CASE WHEN date >= $2 THEN profit END), 0) as today_profit,
         COALESCE(SUM(CASE WHEN date >= $4 THEN profit END), 0) as month_profit
       FROM checks
       WHERE tenant_id=$1 AND is_deferred=false`,
      [tenantID, todayStart, weekStart, monthStart],
    );

    const r = rows[0];
    return {
      todayRevenue: parseFloat(r.today_revenue) || 0,
      todayChecks: parseInt(r.today_checks) || 0,
      weekRevenue: parseFloat(r.week_revenue) || 0,
      monthRevenue: parseFloat(r.month_revenue) || 0,
      todayProfit: parseFloat(r.today_profit) || 0,
      monthProfit: parseFloat(r.month_profit) || 0,
    };
  }

  async getDashboardChart(tenantID: string, period: string, offset: number = 0) {
    // 30s cache, in-flight de-duplicated (see TtlCache.wrap). Invalidated on
    // any check create/update/delete via `reports:<tenant>` prefix purge, so a
    // sale shows up immediately rather than up to 30s late.
    return ttlCache.wrap(`reports:dashboard-chart:${tenantID}:${period}:${offset}`, 30_000, () =>
      this.computeDashboardChart(tenantID, period, offset),
    );
  }

  private async computeDashboardChart(tenantID: string, period: string, offset: number = 0) {
    let dateFrom: Date;
    let dateTo: Date;
    const now = new Date();

    switch (period) {
      case 'today': {
        const base = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
        dateFrom = new Date(base.getFullYear(), base.getMonth(), base.getDate());
        dateTo = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 23, 59, 59);
        break;
      }
      case 'week': {
        const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay();
        const mondayOffset = 1 - dayOfWeek;
        const baseMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mondayOffset + offset * 7);
        dateFrom = new Date(baseMonday.getFullYear(), baseMonday.getMonth(), baseMonday.getDate());
        dateTo = new Date(baseMonday.getFullYear(), baseMonday.getMonth(), baseMonday.getDate() + 6, 23, 59, 59);
        break;
      }
      case 'month': {
        const baseMonth = new Date(now.getFullYear(), now.getMonth() + offset, 1);
        dateFrom = new Date(baseMonth.getFullYear(), baseMonth.getMonth(), 1);
        dateTo = new Date(baseMonth.getFullYear(), baseMonth.getMonth() + 1, 0, 23, 59, 59);
        break;
      }
      case 'year': {
        const baseYear = now.getFullYear() + offset;
        dateFrom = new Date(baseYear, 0, 1);
        dateTo = new Date(baseYear, 11, 31, 23, 59, 59);
        break;
      }
      default: {
        const dow = now.getDay() === 0 ? 7 : now.getDay();
        const mo = 1 - dow;
        const bm = new Date(now.getFullYear(), now.getMonth(), now.getDate() + mo + offset * 7);
        dateFrom = new Date(bm.getFullYear(), bm.getMonth(), bm.getDate());
        dateTo = new Date(bm.getFullYear(), bm.getMonth(), bm.getDate() + 6, 23, 59, 59);
      }
    }

    const { rows } = await this.pool.query(
      `SELECT date::date as day,
              COALESCE(SUM(total_revenue), 0) as revenue,
              COALESCE(SUM(profit), 0) as profit,
              COUNT(*) as check_count
       FROM checks
       WHERE tenant_id=$1 AND date >= $2 AND date <= $3 AND is_deferred=false
       GROUP BY date::date
       ORDER BY day`,
      [tenantID, dateFrom.toISOString(), dateTo.toISOString()],
    );

    // Build lookup from query results
    const dataMap: Record<string, { revenue: number; profit: number; checkCount: number }> = {};
    let totalRevenue = 0,
      totalProfit = 0,
      totalChecks = 0;
    for (const r of rows) {
      const key = typeof r.day === 'string' ? r.day.slice(0, 10) : new Date(r.day).toISOString().slice(0, 10);
      const revenue = parseFloat(r.revenue) || 0;
      const profit = parseFloat(r.profit) || 0;
      const checkCount = parseInt(r.check_count) || 0;
      dataMap[key] = { revenue, profit, checkCount };
      totalRevenue += revenue;
      totalProfit += profit;
      totalChecks += checkCount;
    }

    // Fill in all time slots so the chart always has a complete axis
    const points: Array<{ date: string; revenue: number; profit: number; checkCount: number }> = [];

    if (period === 'today') {
      for (let h = 0; h < 24; h++) {
        const d = new Date(dateFrom.getFullYear(), dateFrom.getMonth(), dateFrom.getDate(), h);
        const key = d.toISOString().slice(0, 10);
        // For hourly, we need to re-query per hour — instead, use the daily total spread across existing data
        points.push({ date: d.toISOString(), revenue: 0, profit: 0, checkCount: 0 });
      }
      // Overlay actual hourly data from a separate query
      const { rows: hourlyRows } = await this.pool.query(
        `SELECT EXTRACT(HOUR FROM date) as hour,
                COALESCE(SUM(total_revenue), 0) as revenue,
                COALESCE(SUM(profit), 0) as profit,
                COUNT(*) as check_count
         FROM checks
         WHERE tenant_id=$1 AND date >= $2 AND date <= $3 AND is_deferred=false
         GROUP BY EXTRACT(HOUR FROM date)
         ORDER BY hour`,
        [tenantID, dateFrom.toISOString(), dateTo.toISOString()],
      );
      for (const hr of hourlyRows) {
        const idx = parseInt(hr.hour);
        if (idx >= 0 && idx < 24) {
          points[idx].revenue = parseFloat(hr.revenue) || 0;
          points[idx].profit = parseFloat(hr.profit) || 0;
          points[idx].checkCount = parseInt(hr.check_count) || 0;
        }
      }
    } else if (period === 'year') {
      for (let m = 0; m < 12; m++) {
        const d = new Date(dateFrom.getFullYear(), m, 1);
        const key = d.toISOString().slice(0, 7); // yyyy-MM
        // Sum all matching days in this month
        let rev = 0,
          prof = 0,
          cc = 0;
        for (const [dk, dv] of Object.entries(dataMap)) {
          if (dk.startsWith(key)) {
            rev += dv.revenue;
            prof += dv.profit;
            cc += dv.checkCount;
          }
        }
        points.push({
          date: `${dateFrom.getFullYear()}-${String(m + 1).padStart(2, '0')}-01`,
          revenue: rev,
          profit: prof,
          checkCount: cc,
        });
      }
    } else {
      // week / month — fill each day
      const cursor = new Date(dateFrom);
      while (cursor <= dateTo) {
        const key = cursor.toISOString().slice(0, 10);
        const d = dataMap[key] || { revenue: 0, profit: 0, checkCount: 0 };
        points.push({ date: key, ...d });
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    return { points, totalRevenue, totalProfit, totalChecks };
  }

  /**
   * Returns the most recent (non-deferred) check for the given client/car.
   * Either or both filters can be set; if both are passed, the check must
   * match both. Used by the cash screen to show "Последний визит".
   */
  async getLastVisit(
    tenantID: string,
    filters: { clientId?: string; carId?: string },
  ): Promise<{
    id: string;
    date: string;
    number: number;
    totalRevenue: number;
    masterName: string | null;
    carPlate: string | null;
    carMakeModel: string | null;
  } | null> {
    const conds: string[] = ['ch.tenant_id = $1'];
    const params: unknown[] = [tenantID];
    let idx = 2;
    if (filters.clientId) {
      conds.push(`ch.client_id = $${idx++}`);
      params.push(filters.clientId);
    }
    if (filters.carId) {
      conds.push(`ch.car_id = $${idx++}`);
      params.push(filters.carId);
    }
    if (!filters.clientId && !filters.carId) {
      return null;
    }

    const { rows } = await this.pool.query(
      `SELECT
         ch.id, ch.number, ch.date, ch.total_revenue,
         u.full_name AS master_name,
         ca.plate_number AS car_plate,
         ca.make_model AS car_make_model
       FROM checks ch
       LEFT JOIN users u ON u.id = ch.master_id
       LEFT JOIN cars ca ON ca.id = ch.car_id
       WHERE ${conds.join(' AND ')}
       ORDER BY ch.date DESC, ch.number DESC
       LIMIT 1`,
      params,
    );

    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id as string,
      date: r.date as string,
      number: r.number as number,
      totalRevenue: parseFloat(r.total_revenue) || 0,
      masterName: (r.master_name as string) || null,
      carPlate: (r.car_plate as string) || null,
      carMakeModel: (r.car_make_model as string) || null,
    };
  }

  async getRanking(tenantID: string) {
    // Same 30s cache + in-flight de-dup + write-side invalidation as the chart.
    return ttlCache.wrap(`reports:ranking:${tenantID}`, 30_000, () => this.computeRanking(tenantID));
  }

  private async computeRanking(tenantID: string) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const { rows: todayRows } = await this.pool.query(
      `SELECT ch.master_id, u.full_name as master_name,
              COALESCE(SUM(ch.total_revenue), 0) as revenue,
              COUNT(*) as check_count
       FROM checks ch JOIN users u ON u.id = ch.master_id
       WHERE ch.tenant_id=$1 AND ch.date >= $2 AND ch.is_deferred=false
       GROUP BY ch.master_id, u.full_name
       ORDER BY revenue DESC`,
      [tenantID, todayStart],
    );

    const { rows: monthRows } = await this.pool.query(
      `SELECT ch.master_id, u.full_name as master_name,
              COALESCE(SUM(ch.total_revenue), 0) as revenue,
              COUNT(*) as check_count
       FROM checks ch JOIN users u ON u.id = ch.master_id
       WHERE ch.tenant_id=$1 AND ch.date >= $2 AND ch.is_deferred=false
       GROUP BY ch.master_id, u.full_name
       ORDER BY revenue DESC`,
      [tenantID, monthStart],
    );

    return {
      today: todayRows.map((r) => ({
        masterId: r.master_id,
        masterName: r.master_name,
        revenue: parseFloat(r.revenue) || 0,
        checkCount: parseInt(r.check_count) || 0,
      })),
      month: monthRows.map((r) => ({
        masterId: r.master_id,
        masterName: r.master_name,
        revenue: parseFloat(r.revenue) || 0,
        checkCount: parseInt(r.check_count) || 0,
      })),
    };
  }
}
