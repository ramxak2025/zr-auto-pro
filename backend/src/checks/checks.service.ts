import { Injectable, Inject, NotFoundException, BadRequestException, ForbiddenException, InternalServerErrorException, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';

@Injectable()
export class ChecksService {
  private readonly logger = new Logger('ChecksService');

  constructor(@Inject(PG_POOL) private pool: Pool) {}

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
      totalCost: parseFloat(row.total_cost) || 0,
      profit: parseFloat(row.profit) || 0,
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

    if (query.masterId) { where += ` AND ch.master_id = $${idx++}`; params.push(query.masterId); }
    if (query.clientId) { where += ` AND ch.client_id = $${idx++}`; params.push(query.clientId); }
    if (query.carId) { where += ` AND ch.car_id = $${idx++}`; params.push(query.carId); }
    if (query.dateFrom) { where += ` AND ch.date >= $${idx++}`; params.push(query.dateFrom); }
    if (query.dateTo) { where += ` AND ch.date <= $${idx++}`; params.push(query.dateTo + 'T23:59:59Z'); }
    if (query.retail === 'true') { where += ` AND ch.client_id IS NULL`; }
    if (query.search) {
      where += ` AND (cl.full_name ILIKE $${idx} OR cl.phone ILIKE $${idx} OR ca.plate_number ILIKE $${idx})`;
      params.push(`%${query.search}%`);
      idx++;
    }

    const countResult = await this.pool.query(
      `SELECT COUNT(*) as total FROM checks ch
       LEFT JOIN clients cl ON cl.id = ch.client_id
       LEFT JOIN cars ca ON ca.id = ch.car_id
       WHERE ${where}`,
      params,
    );
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
      return ch;
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

    // Load service lines
    const { rows: svcRows } = await this.pool.query(
      `SELECT sl.*, u.full_name as master_name
       FROM check_service_lines sl
       LEFT JOIN users u ON u.id = sl.master_id
       WHERE sl.check_id=$1`,
      [id],
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

    // Load product lines
    const { rows: prodRows } = await this.pool.query(
      'SELECT * FROM check_product_lines WHERE check_id=$1',
      [id],
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

      const serviceLines: any[] = [];
      for (const svc of services) {
        const total = (svc.price || 0) * (svc.quantity || 1);
        serviceTotal += total;
        const masterId = svc.masterId || dto.masterId;
        const salaryPct = salaryMap[masterId] || 0;
        serviceSalaryTotal += total * salaryPct / 100;
        serviceLines.push({ ...svc, total, masterId });
      }

      // Calculate product totals
      let productTotal = 0;
      let productCostTotal = 0;
      const productLines: any[] = [];
      for (const prod of products) {
        const totalSell = (prod.sellPrice || 0) * (prod.quantity || 1);
        const totalCost = (prod.costPrice || 0) * (prod.quantity || 1);
        productTotal += totalSell;
        productCostTotal += totalCost;
        productLines.push({ ...prod, totalSell, totalCost });
      }

      const discount = dto.discount || 0;
      const discountedProductTotal = productTotal - discount;
      const totalRevenue = serviceTotal + (discountedProductTotal > 0 ? discountedProductTotal : 0);
      const totalCost = productCostTotal + serviceSalaryTotal;
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
         service_salary_total, total_cost, profit, tenant_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         RETURNING *`,
        [checkDate, dto.masterId, dto.clientId || null, dto.carId || null,
         dto.mileage || null, dto.comment || null, discount,
         dto.isDeferred || false, dto.paymentMethod || 'cash',
         dto.cashAmount || 0, dto.cardAmount || 0,
         serviceTotal, productTotal, totalRevenue, productCostTotal,
         serviceSalaryTotal, totalCost, profit, tenantID],
      );

      const checkId = checkRows[0].id;

      // Insert service lines
      for (const svc of serviceLines) {
        await client.query(
          `INSERT INTO check_service_lines (check_id, service_id, master_id, name, price, quantity, total)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [checkId, svc.serviceId || null, svc.masterId || null,
           svc.name, svc.price || 0, svc.quantity || 1, svc.total],
        );
      }

      // Insert product lines and update stock
      for (const prod of productLines) {
        await client.query(
          `INSERT INTO check_product_lines (check_id, product_id, name, sell_price, cost_price, quantity, total_sell, total_cost)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [checkId, prod.productId || null, prod.name,
           prod.sellPrice || 0, prod.costPrice || 0, prod.quantity || 1,
           prod.totalSell, prod.totalCost],
        );

        // Decrease product stock
        if (prod.productId && !dto.isDeferred) {
          await client.query(
            `UPDATE products SET stock = GREATEST(stock - $1, 0) WHERE id = $2`,
            [prod.quantity || 1, prod.productId],
          );
        }
      }

      await client.query('COMMIT');

      return this.getById(checkId, tenantID);
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
    if (dto.paymentMethod !== undefined) { sets.push(`payment_method=$${idx++}`); vals.push(dto.paymentMethod); }
    if (dto.isDeferred !== undefined) { sets.push(`is_deferred=$${idx++}`); vals.push(dto.isDeferred); }
    if (dto.comment !== undefined) { sets.push(`comment=$${idx++}`); vals.push(dto.comment); }
    if (dto.cashAmount !== undefined) { sets.push(`cash_amount=$${idx++}`); vals.push(dto.cashAmount); }
    if (dto.cardAmount !== undefined) { sets.push(`card_amount=$${idx++}`); vals.push(dto.cardAmount); }

    if (sets.length === 0) return this.getById(id, tenantID);

    vals.push(id, tenantID);
    const { rows } = await this.pool.query(
      `UPDATE checks SET ${sets.join(', ')} WHERE id=$${idx++} AND tenant_id=$${idx} RETURNING id`,
      vals,
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Заказ-наряд не найден' });
    return this.getById(id, tenantID);
  }

  private async fullUpdate(id: string, tenantID: string, userRole: string, dto: any) {
    // Verify check exists and is deferred
    const { rows: checkRows } = await this.pool.query(
      'SELECT * FROM checks WHERE id=$1 AND tenant_id=$2',
      [id, tenantID],
    );
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

      const serviceLines: any[] = [];
      const primaryMasterId = dto.masterId || existingMasterId;
      for (const svc of services) {
        const total = (svc.price || 0) * (svc.quantity || 1);
        serviceTotal += total;
        const masterId = svc.masterId || primaryMasterId;
        const salaryPct = salaryMap[masterId] || 0;
        serviceSalaryTotal += total * salaryPct / 100;
        serviceLines.push({ ...svc, total, masterId });
      }

      // Calculate product totals
      let productTotal = 0;
      let productCostTotal = 0;
      const productLines: any[] = [];
      for (const prod of products) {
        const totalSell = (prod.sellPrice || 0) * (prod.quantity || 1);
        const totalCost = (prod.costPrice || 0) * (prod.quantity || 1);
        productTotal += totalSell;
        productCostTotal += totalCost;
        productLines.push({ ...prod, totalSell, totalCost });
      }

      const discount = dto.discount ?? (parseFloat(checkRows[0].discount) || 0);
      const discountedProductTotal = productTotal - discount;
      const totalRevenue = serviceTotal + (discountedProductTotal > 0 ? discountedProductTotal : 0);
      const totalCost = productCostTotal + serviceSalaryTotal;
      const profit = totalRevenue - totalCost;

      // Update check record
      const updateFields: string[] = [];
      const updateVals: any[] = [];
      let ui = 1;

      if (dto.masterId !== undefined) { updateFields.push(`master_id=$${ui++}`); updateVals.push(dto.masterId); }
      if (dto.clientId !== undefined) { updateFields.push(`client_id=$${ui++}`); updateVals.push(dto.clientId || null); }
      if (dto.carId !== undefined) { updateFields.push(`car_id=$${ui++}`); updateVals.push(dto.carId || null); }
      if (dto.mileage !== undefined) { updateFields.push(`mileage=$${ui++}`); updateVals.push(dto.mileage || null); }
      if (dto.comment !== undefined) { updateFields.push(`comment=$${ui++}`); updateVals.push(dto.comment || null); }
      if (dto.discount !== undefined) { updateFields.push(`discount=$${ui++}`); updateVals.push(dto.discount || 0); }
      if (dto.paymentMethod !== undefined) { updateFields.push(`payment_method=$${ui++}`); updateVals.push(dto.paymentMethod); }
      if (dto.cashAmount !== undefined) { updateFields.push(`cash_amount=$${ui++}`); updateVals.push(dto.cashAmount || 0); }
      if (dto.cardAmount !== undefined) { updateFields.push(`card_amount=$${ui++}`); updateVals.push(dto.cardAmount || 0); }
      if (dto.isDeferred !== undefined) { updateFields.push(`is_deferred=$${ui++}`); updateVals.push(dto.isDeferred); }

      // Always update calculated fields
      updateFields.push(`service_total=$${ui++}`); updateVals.push(serviceTotal);
      updateFields.push(`product_total=$${ui++}`); updateVals.push(productTotal);
      updateFields.push(`total_revenue=$${ui++}`); updateVals.push(totalRevenue);
      updateFields.push(`product_cost_total=$${ui++}`); updateVals.push(productCostTotal);
      updateFields.push(`service_salary_total=$${ui++}`); updateVals.push(serviceSalaryTotal);
      updateFields.push(`total_cost=$${ui++}`); updateVals.push(totalCost);
      updateFields.push(`profit=$${ui++}`); updateVals.push(profit);

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
          [id, prod.productId || null, prod.name, prod.sellPrice || 0, prod.costPrice || 0, prod.quantity || 1, prod.totalSell, prod.totalCost],
        );
      }

      await client.query('COMMIT');
      return this.getById(id, tenantID);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async remove(id: string, tenantID: string, userRole: string) {
    const { rows } = await this.pool.query(
      'SELECT is_deferred FROM checks WHERE id=$1 AND tenant_id=$2',
      [id, tenantID],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Заказ-наряд не найден' });

    if (userRole === 'master' && !rows[0].is_deferred) {
      throw new ForbiddenException({ message: 'Мастер не может удалить закрытый заказ-наряд' });
    }

    await this.pool.query('DELETE FROM checks WHERE id=$1 AND tenant_id=$2', [id, tenantID]);
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
    let totalRevenue = 0, totalProfit = 0, totalChecks = 0;
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
        let rev = 0, prof = 0, cc = 0;
        for (const [dk, dv] of Object.entries(dataMap)) {
          if (dk.startsWith(key)) { rev += dv.revenue; prof += dv.profit; cc += dv.checkCount; }
        }
        points.push({ date: `${dateFrom.getFullYear()}-${String(m + 1).padStart(2, '0')}-01`, revenue: rev, profit: prof, checkCount: cc });
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

  async getRanking(tenantID: string) {
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
