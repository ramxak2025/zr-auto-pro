import {
  Injectable,
  Inject,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { WarehousesService } from '../warehouses/warehouses.service';
import { invalidateReportsForTenant } from '../common/reports-cache';
import { getTenantTimezone } from '../common/timezone';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { actorPointId, pointFilterSql } from '../common/point-scope';

export type ReturnDestination = 'warehouse' | 'defect';
export type ReturnScope = 'full' | 'partial';

/** Round to 2 decimals — money columns are NUMERIC(…,2); avoids float drift. */
function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export interface ReturnLineInput {
  productLineId?: string;
  serviceLineId?: string;
  quantity?: number;
}

export interface CreateReturnDto {
  destination: ReturnDestination;
  reason?: string;
  scope: ReturnScope;
  refundAmount?: number;
  lines?: ReturnLineInput[];
}

@Injectable()
export class ReturnsService {
  private readonly logger = new Logger('ReturnsService');

  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private warehouses: WarehousesService,
  ) {}

  /**
   * Create a return against a check. The endpoint accepts either a full
   * return (all lines come back) or a partial return (specific lines).
   *
   * Side effects (inside one transaction):
   *
   *   1. `check_returns` header row gets inserted.
   *   2. For partial scope, one `check_return_lines` row per requested line.
   *   3. The parent `checks` row is marked `is_returned=true` + returned_at,
   *      return_destination, return_scope are persisted.
   *   4. For every product line returned (full → all product lines; partial →
   *      the ones the caller listed), a `stock_movements` row is written.
   *      Destination=warehouse → main warehouse (customer_return, returned to
   *      stock — a distinct type so the journal shows «Возврат клиента», NOT
   *      a supplier «Поступление»; stock still increments exactly as income did).
   *      Destination=defect    → defect warehouse (defect_transfer): the
   *      returned units are ADDED to a same-SKU row on the defect warehouse
   *      (matched by name+unit, created as a copy when missing — the exact
   *      model of stock-movements.applyTransfer), so they are visible on
   *      брак and available for defect_return_to_supplier. Main stock is NOT
   *      touched (the units came back from the client, not from the shelf).
   */
  async createReturn(tenantID: string, userID: string, checkId: string, dto: CreateReturnDto, actor?: JwtPayload) {
    if (!dto || !dto.destination || !dto.scope) {
      throw new BadRequestException({ message: 'destination и scope обязательны' });
    }
    if (dto.destination !== 'warehouse' && dto.destination !== 'defect') {
      throw new BadRequestException({ message: 'Неверное направление возврата' });
    }
    if (dto.scope !== 'full' && dto.scope !== 'partial') {
      throw new BadRequestException({ message: 'Неверный тип возврата' });
    }
    // Reason is required for defect destination — otherwise we lose the
    // diagnostic trail of why the part was junked.
    if (dto.destination === 'defect' && (!dto.reason || !dto.reason.trim())) {
      throw new BadRequestException({ message: 'Для возврата в брак укажите причину' });
    }
    if (dto.scope === 'partial' && (!dto.lines || dto.lines.length === 0)) {
      throw new BadRequestException({ message: 'Укажите позиции для частичного возврата' });
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      // Verify the check belongs to this tenant + grab basic data.
      //
      // FOR UPDATE (audit round 7, item 1): lock the check row for the whole
      // return so two CONCURRENT returns can't both read is_returned=false and
      // both add the stock back / reverse the money twice. The second
      // transaction blocks here until the first commits, then re-reads the row
      // with is_returned=true and takes the clean «уже возвращён» exit below.
      //
      // ФИЛИАЛ (161) — «читаем широко, пишем только в свой филиал». Возврат
      // РЕВЕРСИРУЕТ выручку и склад, то есть это запись, и она обязана быть
      // не слабее чтения журнала. Без этого фильтра мастер филиала А, зная id
      // чека филиала Б (деталь чека читается межфилиально СОЗНАТЕЛЬНО — это
      // история клиента), оформлял бы возврат по чужой продаже. Фильтр стоит
      // ПРЯМО В ЛОКЕ, а не отдельным гейтом: у возврата своя транзакция, и
      // лишний SELECT до неё был бы вторым источником правды.
      const lockParams: unknown[] = [checkId, tenantID];
      const lockPointFilter = pointFilterSql(null, actorPointId(actor), lockParams);
      const { rows: checkRows } = await client.query(
        // cash_amount читаем ЗДЕСЬ, под тем же локом: это наличные чека ДО
        // реверса, и только из них выводится наличная часть возврата (164).
        // После UPDATE ниже исходное значение уже не восстановить.
        `SELECT id, total_revenue, cash_amount, is_returned FROM checks WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL${lockPointFilter} LIMIT 1 FOR UPDATE`,
        lockParams,
      );
      if (checkRows.length === 0) {
        throw new NotFoundException({ message: 'Заказ-наряд не найден' });
      }
      // Re-checked UNDER the row lock — this is now the authoritative guard,
      // not a best-effort JS pre-check.
      if (checkRows[0].is_returned) {
        throw new BadRequestException({ message: 'Заказ-наряд уже возвращён' });
      }

      // Чек, проданный в рассрочку, возвращать нельзя, пока у него есть план:
      // реверс денег ниже занулил бы оборот/ноги (корзина «Рассрочка (долг)»
      // в отчётах упала бы до нуля), а installment_plans остался бы open с
      // remaining>0 — экран «Рассрочка» продолжил бы требовать долг за
      // возвращённую продажу, слал напоминания, а будущие платежи по нему
      // честно падали бы в installmentPaid. Два источника долга (чеки vs
      // планы) разошлись бы навсегда. Зеркально отказам editClosedCheck /
      // softDelete: сначала закрыть/изменить рассрочку, затем возврат.
      const { rows: planRows } = await client.query(
        `SELECT 1 FROM installment_plans WHERE tenant_id = $1 AND check_id = $2 LIMIT 1`,
        [tenantID, checkId],
      );
      if (planRows.length > 0) {
        throw new BadRequestException({
          message: 'Заказ-наряд продан в рассрочку — сначала закройте или измените рассрочку, затем оформляйте возврат',
        });
      }

      const totalRevenue = parseFloat(checkRows[0].total_revenue) || 0;
      // Наличные чека ДО реверса — база для наличной части возврата (164).
      const cashBefore = parseFloat(checkRows[0].cash_amount) || 0;

      // Collect the check's lines WITH their money columns: the sell side
      // drives the default refund for partial scope (money-audit M6), the cost
      // side drives the COGS reversal for warehouse returns (money-audit C1).
      const allProductLines = await client.query(
        `SELECT id, product_id, quantity, sell_price, cost_price, total_sell, total_cost
           FROM check_product_lines WHERE check_id = $1`,
        [checkId],
      );
      const allServiceLines = await client.query(
        `SELECT id, price, quantity, total FROM check_service_lines WHERE check_id = $1`,
        [checkId],
      );

      // Sell/cost value of `qty` units of a product line. A full-line return
      // reuses the persisted line totals verbatim (no per-unit rounding drift);
      // a partial quantity derives per-unit values from the line totals (they
      // already carry any discounts), falling back to the raw prices when the
      // stored quantity is 0/broken.
      const lineMoney = (row: any, qty: number): { sell: number; cost: number } => {
        const lineQty = parseFloat(row.quantity) || 0;
        const totalSell = parseFloat(row.total_sell) || 0;
        const totalCost = parseFloat(row.total_cost) || 0;
        if (lineQty > 0 && qty >= lineQty) return { sell: totalSell, cost: totalCost };
        const unitSell = lineQty > 0 ? totalSell / lineQty : parseFloat(row.sell_price) || 0;
        const unitCost = lineQty > 0 ? totalCost / lineQty : parseFloat(row.cost_price) || 0;
        return { sell: round2(unitSell * qty), cost: round2(unitCost * qty) };
      };

      // For full scope we move every product line; for partial we honour the
      // caller's list. Lines are resolved BEFORE the header insert because the
      // default refund of a partial return is derived from them (M6).
      const productMoves: Array<{
        productLineId: string | null;
        productId: string | null;
        quantity: number;
        /** Себестоимость возвращаемого количества — реверс COGS (C1). */
        cost: number;
      }> = [];
      // Per-line rows for check_return_lines (partial scope only) — inserted
      // after the header row exists (FK on return_id).
      const pendingReturnLines: Array<{
        productLineId: string | null;
        productId: string | null;
        serviceLineId: string | null;
        quantity: number;
        amount: number;
      }> = [];
      if (dto.scope === 'full') {
        for (const pl of allProductLines.rows) {
          const qty = parseFloat(pl.quantity) || 0;
          productMoves.push({
            productLineId: pl.id,
            productId: pl.product_id,
            quantity: qty,
            cost: lineMoney(pl, qty).cost,
          });
        }
      } else if (dto.lines) {
        // Resolve each user-provided line back to a line in this check.
        for (const ln of dto.lines) {
          if (ln.productLineId) {
            const match = allProductLines.rows.find((r) => r.id === ln.productLineId);
            if (!match) {
              throw new BadRequestException({ message: 'Позиция не найдена в заказ-наряде' });
            }
            const lineQty = parseFloat(match.quantity) || 0;
            const requestedQty =
              ln.quantity !== undefined && ln.quantity !== null ? parseFloat(String(ln.quantity)) : 1;
            // Never return more than was sold on that line — a forged quantity
            // would otherwise inflate stock on add-back.
            const qty = Math.max(0, Math.min(requestedQty, lineQty));
            const money = lineMoney(match, qty);
            productMoves.push({
              productLineId: match.id,
              productId: match.product_id,
              quantity: qty,
              cost: money.cost,
            });
            pendingReturnLines.push({
              productLineId: match.id,
              productId: match.product_id,
              serviceLineId: null,
              quantity: qty,
              amount: money.sell,
            });
          } else if (ln.serviceLineId) {
            // Services are intangible — no stock move. The line must still
            // belong to THIS check (needed for the price-derived amount; also
            // closes the hole where a foreign line id was recorded blindly).
            const match = allServiceLines.rows.find((r) => r.id === ln.serviceLineId);
            if (!match) {
              throw new BadRequestException({ message: 'Позиция не найдена в заказ-наряде' });
            }
            const lineQty = parseFloat(match.quantity) || 0;
            const requestedQty =
              ln.quantity !== undefined && ln.quantity !== null ? parseFloat(String(ln.quantity)) : 1;
            const qty = lineQty > 0 ? Math.max(0, Math.min(requestedQty, lineQty)) : Math.max(0, requestedQty);
            const lineTotal = parseFloat(match.total) || 0;
            const amount =
              lineQty > 0 && qty >= lineQty
                ? lineTotal
                : round2((lineQty > 0 ? lineTotal / lineQty : parseFloat(match.price) || 0) * qty);
            pendingReturnLines.push({
              productLineId: null,
              productId: null,
              serviceLineId: match.id,
              quantity: qty,
              amount,
            });
          }
        }
      }

      const requestedRefund =
        dto.refundAmount !== undefined && dto.refundAmount !== null
          ? Math.max(0, parseFloat(String(dto.refundAmount)))
          : dto.scope === 'full'
            ? totalRevenue
            : // M6 — дефолт ЧАСТИЧНОГО возврата = продажная стоимость возвращаемых
              // позиций (раньше 0: товар восстанавливался на складе, а деньги
              // молча оставались на чеке — сток и выручка задваивались).
              round2(pendingReturnLines.reduce((acc, l) => acc + l.amount, 0));
      // A refund can never exceed what was actually charged on the check —
      // otherwise reversing it would drive the check's revenue/cash negative.
      const refundAmount = Math.min(requestedRefund, totalRevenue);

      // НАЛИЧНАЯ ЧАСТЬ ВОЗВРАТА (164) — ровно то, что реверс ниже снимет с
      // cash_amount: возврат гасит НАЛ ПЕРВЫМ, остаток добирает с карты
      // (`cash_amount = GREATEST(cash - refund, 0)` + `card_amount = ... - GREATEST(refund - cash, 0)`).
      // Значение сохраняем в строку возврата, потому что кассовой смене нужна
      // выдача из ДЕНЕЖНОГО ЯЩИКА в день ФАКТА возврата, а после UPDATE
      // исходный cash_amount не восстановить (см. шапку миграции 164).
      const refundCash = round2(Math.min(refundAmount, cashBefore));

      // Insert the header row first (return lines FK to it).
      const { rows: retRows } = await client.query(
        `INSERT INTO check_returns
           (check_id, tenant_id, returned_by, destination, reason, refund_amount, refund_cash_amount, scope)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, created_at`,
        [checkId, tenantID, userID || null, dto.destination, dto.reason ?? null, refundAmount, refundCash, dto.scope],
      );
      const returnId = retRows[0].id;

      for (const l of pendingReturnLines) {
        // `amount` — продажная стоимость позиции (для сверки refund ↔ строки).
        await client.query(
          `INSERT INTO check_return_lines (return_id, product_line_id, product_id, service_line_id, quantity, amount)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [returnId, l.productLineId, l.productId, l.serviceLineId, l.quantity, l.amount],
        );
      }

      // Resolve target warehouse once.
      const targetWh =
        dto.destination === 'warehouse'
          ? await this.warehouses.resolveByKind(tenantID, 'main')
          : await this.warehouses.resolveByKind(tenantID, 'defect');

      // NEW-4 (защита от взаимоблокировки): цикл ниже лочит по строке-источнику
      // на позицию, а для возврата в брак ещё и строку-копию того же SKU на
      // складе брака — с фиксированным порядком источник→приёмник и в порядке
      // позиций чека. Это конфликтует с путём продажи чека / перемещениями,
      // которые могут лочить те же строки в обратном порядке → deadlock 40P01 →
      // перемежающийся 500. Заранее лочим ВСЕ затрагиваемые строки (источники +
      // существующие копии SKU на складе брака) ОДНИМ оператором в
      // детерминированном ГЛОБАЛЬНОМ порядке (по возрастанию id): `ORDER BY id
      // FOR UPDATE` берёт блокировки в порядке сортировки. FOR UPDATE-чтения в
      // цикле затем лишь пере-лочат уже удерживаемые строки (no-op), поэтому
      // порядок захвата фиксирован. Новые копии, созданные INSERT'ом в цикле,
      // приватны до COMMIT — их лочить не нужно.
      const sourceIds = Array.from(new Set(productMoves.map((m) => m.productId).filter((x): x is string => !!x)));
      if (sourceIds.length > 0) {
        const lockIds = new Set<string>(sourceIds);
        if (dto.destination === 'defect') {
          const { rows: copyRows } = await client.query(
            `SELECT c.id FROM products c
               JOIN products s
                 ON s.name = c.name AND s.unit IS NOT DISTINCT FROM c.unit
              WHERE c.tenant_id = $1 AND c.warehouse_id = $2 AND c.deleted_at IS NULL
                AND s.tenant_id = $1 AND s.id = ANY($3::uuid[]) AND c.id <> s.id`,
            [tenantID, targetWh.id, sourceIds],
          );
          for (const r of copyRows) lockIds.add(r.id as string);
        }
        await client.query(
          `SELECT id FROM products WHERE id = ANY($1::uuid[]) AND tenant_id = $2 ORDER BY id FOR UPDATE`,
          [Array.from(lockIds), tenantID],
        );
      }

      // COGS-реверс (money-audit C1): при возврате НА СКЛАД себестоимость
      // возвращённого товара снимается с чека — товар снова продаваем, и его
      // cost будет заново записан чеком перепродажи; без реверса он считался
      // бы в прибыли ДВАЖДЫ. Накапливаем только по позициям, реально
      // вернувшимся в сток (товар не удалён). Брак (defect) — реальный убыток:
      // сток ОСНОВНОГО склада не восстанавливается (единицы ложатся на склад
      // брака ниже), cost остаётся на чеке.
      let reversedCost = 0;
      for (const mv of productMoves) {
        if (!mv.productId || mv.quantity <= 0) continue;
        const { rows: prodRows } = await client.query(
          `SELECT stock, warehouse_id, name, unit FROM products WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
          [mv.productId, tenantID],
        );
        if (prodRows.length === 0) continue; // product deleted — skip stock, but keep the return line

        const stockBefore = parseFloat(prodRows[0].stock) || 0;

        if (dto.destination === 'warehouse') {
          const stockAfter = stockBefore + mv.quantity;
          await client.query(`UPDATE products SET stock = $1 WHERE id = $2 AND tenant_id = $3`, [
            stockAfter,
            mv.productId,
            tenantID,
          ]);
          reversedCost = round2(reversedCost + mv.cost);

          await client.query(
            `INSERT INTO stock_movements
               (product_id, type, quantity, stock_before, stock_after, reason,
                tenant_id, user_id, warehouse_id)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              mv.productId,
              // Customer return to the main warehouse gets its OWN type so the
              // journal classifies it as «Возврат клиента» (not a supplier
              // «Поступление»). Stock still adds back identically (see stockAfter
              // above) — only the type label differs from the old 'income'.
              'customer_return',
              mv.quantity,
              stockBefore,
              stockAfter,
              dto.reason ?? `Возврат заказ-наряда`,
              tenantID,
              userID || null,
              targetWh.id,
            ],
          );
          continue;
        }

        // Destination=defect: единицы вернулись ОТ КЛИЕНТА (со склада они ушли
        // ещё при продаже), поэтому основной сток не трогаем — но возвращённое
        // количество обязано ФИЗИЧЕСКИ появиться на складе брака, иначе оно
        // невидимо в остатках и недоступно для defect_return_to_supplier.
        // Модель — зеркально applyTransfer из stock-movements.service: строка
        // товара живёт на одном складе; брак-единицы ложатся на строку того же
        // SKU на складе брака (совпадение name + unit, копия при отсутствии,
        // min_stock = 0 — брак не должен звенеть low-stock алертами).
        let defectProductId: string = mv.productId;
        let defectBefore: number;
        let defectAfter: number;
        if (prodRows[0].warehouse_id === targetWh.id) {
          // Сама строка товара уже живёт на складе брака — просто пополняем её.
          defectBefore = stockBefore;
          defectAfter = stockBefore + mv.quantity;
          await client.query(`UPDATE products SET stock = $1 WHERE id = $2 AND tenant_id = $3`, [
            defectAfter,
            mv.productId,
            tenantID,
          ]);
        } else {
          const { rows: targetRows } = await client.query(
            `SELECT id, stock FROM products
              WHERE tenant_id=$1 AND warehouse_id=$2 AND name=$3 AND unit IS NOT DISTINCT FROM $4
                AND deleted_at IS NULL AND id <> $5
              ORDER BY created_at LIMIT 1 FOR UPDATE`,
            [tenantID, targetWh.id, prodRows[0].name, prodRows[0].unit, mv.productId],
          );
          if (targetRows.length > 0) {
            defectProductId = targetRows[0].id;
            defectBefore = parseFloat(targetRows[0].stock) || 0;
            defectAfter = defectBefore + mv.quantity;
            await client.query(`UPDATE products SET stock = $1 WHERE id = $2 AND tenant_id = $3`, [
              defectAfter,
              defectProductId,
              tenantID,
            ]);
          } else {
            defectBefore = 0;
            defectAfter = mv.quantity;
            const { rows: insRows } = await client.query(
              `INSERT INTO products (name, category, photo, cost_price, sell_price, stock, min_stock, unit,
                                     is_bundle, bundle_items, supplier_id, tenant_id, warehouse_id, warranty_days, barcode)
               SELECT name, category, photo, cost_price, sell_price, $3, 0, unit,
                      is_bundle, bundle_items, supplier_id, tenant_id, $4, warranty_days, barcode
                 FROM products WHERE id=$1 AND tenant_id=$2
               RETURNING id`,
              [mv.productId, tenantID, mv.quantity, targetWh.id],
            );
            defectProductId = insRows[0].id;
          }
        }

        // Движение описывает ПРИНИМАЮЩУЮ строку на складе брака (было →
        // стало), как и customer_return выше описывает принимающий основной
        // склад. source_warehouse_id — NULL сознательно: единицы пришли от
        // клиента, ни один склад их не терял (web-журнал отрисует
        // «Основной → Брак» через свой фолбэк источника).
        await client.query(
          `INSERT INTO stock_movements
             (product_id, type, quantity, stock_before, stock_after, reason,
              tenant_id, user_id, warehouse_id, target_warehouse_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            defectProductId,
            'defect_transfer',
            mv.quantity,
            defectBefore,
            defectAfter,
            dto.reason ?? `Возврат заказ-наряда`,
            tenantID,
            userID || null,
            targetWh.id,
            targetWh.id,
          ],
        );
      }

      // Mark the check returned AND reverse its realised money so every
      // report (cash-flow, profit, dashboard) is automatically correct from a
      // single source of truth — no aggregation needs to special-case
      // is_returned. Owner policy (2026-06): a returned sale stops counting in
      // its OWN period (full → whole sale removed, partial → by refund amount),
      // while the master KEEPS their accrued salary (service_salary_total /
      // product_salary_total are left untouched), so the labour stays a real
      // cost and the return shows as the genuine loss it is. refundAmount is
      // already capped at total_revenue above, so these never go negative.
      // The card reduction takes whatever the refund couldn't draw from cash
      // (cash first, then card) — a full return zeroes both exactly.
      // COGS (C1): $6 = себестоимость товара, вернувшегося В СТОК — снимается
      // с product_cost_total/total_cost (товар снова продаваем, его cost
      // запишет чек перепродажи), а profit корректируется на (−refund +
      // reversedCost), т.е. чек теряет ровно свою маржу по возвращённому.
      // Для defect $6 = 0 — прежняя семантика реального убытка сохранена.
      // `AND is_returned = false` + rowCount check: belt-and-braces on top of
      // the FOR UPDATE above. Even if a future refactor drops the row lock,
      // the money reversal can only ever apply to a not-yet-returned check —
      // zero rows updated means someone beat us to it → roll the WHOLE return
      // back (header row, return lines, stock movements included).
      const { rowCount: returnedNow } = await client.query(
        `UPDATE checks
            SET is_returned = true,
                returned_at = now(),
                return_destination = $1,
                return_scope = $2,
                total_revenue = GREATEST(COALESCE(total_revenue, 0) - $5, 0),
                profit = COALESCE(profit, 0) - $5 + $6,
                product_cost_total = GREATEST(COALESCE(product_cost_total, 0) - $6, 0),
                total_cost = GREATEST(COALESCE(total_cost, 0) - $6, 0),
                cash_amount = GREATEST(COALESCE(cash_amount, 0) - $5, 0),
                card_amount = GREATEST(COALESCE(card_amount, 0) - GREATEST($5 - COALESCE(cash_amount, 0), 0), 0)
          WHERE id = $3 AND tenant_id = $4 AND is_returned = false`,
        [dto.destination, dto.scope, checkId, tenantID, refundAmount, reversedCost],
      );
      if (!returnedNow) {
        // Rolls back via the catch below — nothing of this return persists.
        throw new BadRequestException({ message: 'Заказ-наряд уже возвращён' });
      }

      if (dto.scope === 'full') {
        // M9 — полный возврат СТОРНИРУЕТ мотивационные начисления чека: маржа
        // реверсирована (товар на складе, выручка снята), бонус за неё не
        // должен оставаться в зарплате. Симметрия с reverseCheckFootprintTx
        // (softDelete чека) в checks.service. Частичный возврат начисления
        // сохраняет — пересчёт по остатку строк требует продуктового решения.
        await client.query('DELETE FROM motivation_accruals WHERE tenant_id = $1 AND check_id = $2', [
          tenantID,
          checkId,
        ]);
      }

      await client.query('COMMIT');

      // Returns move the cash position / profit — drop the tenant's cached
      // report aggregates so the dashboard reflects the reversal immediately
      // (mirrors every check/expense write).
      invalidateReportsForTenant(tenantID);

      return {
        id: returnId,
        checkId,
        destination: dto.destination,
        scope: dto.scope,
        reason: dto.reason ?? null,
        refundAmount,
        // 164 — сколько из возврата выдано НАЛИЧНЫМИ (остаток ушёл на карту).
        refundCashAmount: refundCash,
        returnedBy: userID || null,
        createdAt: retRows[0].created_at,
      };
    } catch (err) {
      await client.query('ROLLBACK');
      if (err instanceof BadRequestException || err instanceof NotFoundException) throw err;
      this.logger.error(`Return create error: ${err}`);
      throw new InternalServerErrorException({ message: 'Ошибка сервера' });
    } finally {
      client.release();
    }
  }

  /**
   * List returns for the journal. Joined with checks for number / total / client
   * name. Default window: last 90 days unless explicit from/to are provided.
   */
  /**
   * 161 — журнал возвратов ФИЛИАЛА. Своей колонки у возврата нет и не нужно:
   * возврат неотделим от чека, поэтому филиал берём у чека — тем же
   * предикатом, что журнал и деньги. JOIN checks здесь ВНУТРЕННИЙ, поэтому
   * условие уходит прямо в WHERE.
   */
  async list(tenantID: string, query: { from?: string; to?: string }, actor?: JwtPayload) {
    const conds: string[] = ['cr.tenant_id = $1'];
    const params: unknown[] = [tenantID];
    let idx = 2;
    // Границы окна: строка YYYY-MM-DD трактуется как МЕСТНЫЙ календарный день
    // тенанта — полуинтервал [from 00:00, to+1 00:00), паттерн reports.service.
    // Раньше касты шли в СЕРВЕРНОЙ TZ (UTC) с включённой верхней полуночью —
    // ночные возвраты граничного дня уезжали в соседнее окно. Полный timestamp
    // — прежняя семантика 1:1.
    const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
    const needsTz = (query.from && DATE_ONLY_RE.test(query.from)) || (query.to && DATE_ONLY_RE.test(query.to));
    // Пояс кладём в params ОДИН раз и только когда он реально нужен запросу:
    // лишний плейсхолдер без использования Postgres не примет.
    let tzPh = '';
    if (needsTz) {
      tzPh = `$${idx++}::text`;
      params.push(await getTenantTimezone(this.pool, tenantID));
    }
    if (query.from) {
      conds.push(
        DATE_ONLY_RE.test(query.from)
          ? `cr.created_at >= $${idx++}::date::timestamp AT TIME ZONE ${tzPh}`
          : `cr.created_at >= $${idx++}`,
      );
      params.push(query.from);
    }
    if (query.to) {
      conds.push(
        DATE_ONLY_RE.test(query.to)
          ? `cr.created_at < ($${idx++}::date + 1)::timestamp AT TIME ZONE ${tzPh}`
          : `cr.created_at <= ($${idx++}::date + 1)::timestamptz`,
      );
      params.push(query.to);
    }
    // Точка — последним условием: дальше локальный idx не используется.
    const pointFilter = pointFilterSql('ch', actorPointId(actor), params);

    const { rows } = await this.pool.query(
      `SELECT cr.id, cr.check_id, cr.destination, cr.reason, cr.refund_amount,
              cr.scope, cr.returned_by, cr.created_at,
              ch.number AS check_number, ch.total_revenue AS check_total,
              cl.full_name AS client_name
         FROM check_returns cr
         JOIN checks ch ON ch.id = cr.check_id
         LEFT JOIN clients cl ON cl.id = ch.client_id
        WHERE ${conds.join(' AND ')}${pointFilter}
        ORDER BY cr.created_at DESC
        LIMIT 500`,
      params,
    );

    return rows.map((r) => ({
      id: r.id,
      checkId: r.check_id,
      checkNumber: r.check_number,
      checkTotal: parseFloat(r.check_total) || 0,
      clientName: r.client_name || null,
      destination: r.destination as ReturnDestination,
      reason: r.reason,
      refundAmount: parseFloat(r.refund_amount) || 0,
      scope: r.scope as ReturnScope,
      returnedBy: r.returned_by,
      createdAt: r.created_at,
    }));
  }
}
