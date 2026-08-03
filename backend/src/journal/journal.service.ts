import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';

export interface JournalDoc {
  id: string;
  kind:
    | 'purchase'
    | 'return_to_supplier'
    | 'customer_return'
    | 'defect_transfer'
    | 'writeoff'
    | 'supplier_payment'
    | 'supplier_refund'
    | 'used_purchase';
  occurredAt: string;
  title: string;
  subtitle?: string;
  amount: number;
  badge: string;
  badgeColor: string;
  payeeName?: string;
  /**
   * 144 → Round 14 (совместимость со старыми клиентами): возврат денег ОТ
   * поставщика уходит в ленту с kind='supplier_payment' + isRefund=true, а НЕ
   * с отдельным kind='supplier_refund'. Причина: пред-Round-14 мобильные
   * бандлы индексируют journalKindVisual[kind] БЕЗ фолбэка — незнакомый kind
   * = undefined.cardBg = TypeError = корневой ErrorBoundary на весь апп у
   * любого сотрудника тенанта, где появился хоть один возврат. Новые клиенты
   * рисуют «Возврат от поставщика» (тил, «+», ABS-сумма) по этому флагу;
   * старые видят обычный платёж (с минусом — неточно, но БЕЗ краша).
   * 'supplier_refund' остаётся в union только как значение фильтра ?type=.
   */
  isRefund?: boolean;
}

// Visual tokens shared with the FE for chip / badge rendering.
const KIND_META: Record<JournalDoc['kind'], { badge: string; badgeColor: string; title: string }> = {
  purchase: { badge: 'Поступление', badgeColor: 'green', title: 'Поступление товара' },
  return_to_supplier: { badge: 'Возврат поставщику', badgeColor: 'orange', title: 'Возврат поставщику' },
  customer_return: { badge: 'Возврат клиента', badgeColor: 'teal', title: 'Возврат клиента на склад' },
  defect_transfer: { badge: 'В брак', badgeColor: 'red', title: 'Перемещение в брак' },
  writeoff: { badge: 'Списание', badgeColor: 'red', title: 'Списание со склада' },
  supplier_payment: { badge: 'Оплата', badgeColor: 'blue', title: 'Оплата поставщику' },
  // 144 → Round 14: возврат денег ОТ поставщика (kind='refund', amount < 0 в
  // БД). В ленту уходит kind='supplier_payment' + isRefund=true (см. коммент
  // у JournalDoc.isRefund — старые бандлы крашились на незнакомом kind), но
  // badge/title берутся отсюда: строка честно подписана «Возврат от
  // поставщика», ABS(amount). Teal — деньги пришли, но это не продажа.
  supplier_refund: { badge: 'Возврат от поставщика', badgeColor: 'teal', title: 'Возврат от поставщика' },
  used_purchase: { badge: 'Б/У', badgeColor: 'purple', title: 'Покупка Б/У товара' },
};

@Injectable()
export class JournalService {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  /**
   * Unified warehouse documents feed for the journal screen. Pulls
   * relevant stock_movements + supplier_payments and emits an interleaved
   * date-sorted list. The FE filters by `kind` client-side; if the caller
   * passes `?type=...` we narrow the SQL to that single kind to save
   * bandwidth on large tenants.
   */
  async getWarehouseDocs(
    tenantID: string,
    params: { from?: string; to?: string; type?: JournalDoc['kind'] | string },
  ): Promise<JournalDoc[]> {
    const type = params.type;
    const out: JournalDoc[] = [];

    const baseConds: string[] = ['sm.tenant_id = $1'];
    const baseParams: any[] = [tenantID];
    let idx = 2;
    if (params.from) {
      baseConds.push(`sm.created_at >= $${idx++}`);
      baseParams.push(params.from);
    }
    if (params.to) {
      baseConds.push(`sm.created_at <= ($${idx++}::date + 1)::timestamptz`);
      baseParams.push(params.to);
    }

    // Pull stock_movements first; we map type → kind below.
    const wantStockMovements =
      !type ||
      ['purchase', 'return_to_supplier', 'customer_return', 'defect_transfer', 'writeoff', 'used_purchase'].includes(
        type,
      );

    if (wantStockMovements) {
      const { rows } = await this.pool.query(
        `SELECT sm.id, sm.type, sm.created_at, sm.quantity, sm.stock_before, sm.stock_after, sm.reason,
                sm.warehouse_id, sm.source_warehouse_id, sm.target_warehouse_id,
                sm.supplier_id, sm.linked_expense_id, sm.is_used_purchase,
                p.name as product_name, p.cost_price, p.sell_price,
                s.name as supplier_name,
                w.name as warehouse_name
         FROM stock_movements sm
         JOIN products p ON p.id = sm.product_id
         LEFT JOIN suppliers s ON s.id = sm.supplier_id
         LEFT JOIN warehouses w ON w.id = sm.warehouse_id
         WHERE ${baseConds.join(' AND ')}
         ORDER BY sm.created_at DESC
         LIMIT 500`,
        baseParams,
      );
      for (const r of rows) {
        const qty = parseFloat(r.quantity) || 0;
        const cost = parseFloat(r.cost_price) || 0;
        const amount = qty * cost;
        let kind: JournalDoc['kind'] | null = null;
        if (r.is_used_purchase) kind = 'used_purchase';
        else if (r.type === 'income') kind = 'purchase';
        else if (r.type === 'customer_return') kind = 'customer_return';
        else if (r.type === 'defect_return_to_supplier') kind = 'return_to_supplier';
        else if (r.type === 'defect_transfer') kind = 'defect_transfer';
        else if (r.type === 'writeoff') kind = 'writeoff';
        // inventory / used_transfer / expense → silently dropped from the
        // journal (they are internal corrections, not "documents").
        if (!kind) continue;
        if (type && kind !== type) continue;

        const meta = KIND_META[kind];
        out.push({
          id: r.id,
          kind,
          occurredAt: r.created_at,
          title: `${r.product_name} ×${qty}`,
          subtitle: r.reason || r.warehouse_name || r.supplier_name || undefined,
          amount,
          badge: meta.badge,
          badgeColor: meta.badgeColor,
          payeeName: r.supplier_name || undefined,
        });
      }
    }

    if (!type || type === 'supplier_payment' || type === 'supplier_refund') {
      // 144: сторнированные строки исключены — денег по ним не было.
      const spConds: string[] = ['sp.tenant_id = $1', 'sp.reversed_at IS NULL'];
      // Adversarial-ревью Round 14 (LOW): kind-фильтр проталкивается в SQL —
      // иначе LIMIT 500 срезал бы строки ДО JS-фильтра и, например, чип
      // «Возврат от поставщика» на тенанте с 600+ платежами за период молча
      // прятал бы возвраты старше 500 новейших строк. Значения БД-словаря
      // (144, NOT NULL DEFAULT 'payment'): 'payment' и 'defect_return' →
      // логический supplier_payment; 'refund' → supplier_refund. JS-строка
      // `if (type && logicalKind !== type) continue` ниже остаётся страховкой
      // и НЕ зависит от того, как ВЫХОДНОЙ kind маппится для клиентов
      // (совместимость isRefund её не трогает — фильтруем по kind в БД).
      if (type === 'supplier_refund') {
        spConds.push(`sp.kind = 'refund'`);
      } else if (type === 'supplier_payment') {
        spConds.push(`sp.kind <> 'refund'`);
      }
      const spParams: any[] = [tenantID];
      let spIdx = 2;
      if (params.from) {
        spConds.push(`sp.date >= $${spIdx++}`);
        spParams.push(params.from);
      }
      if (params.to) {
        spConds.push(`sp.date <= ($${spIdx++}::date + 1)::timestamptz`);
        spParams.push(params.to);
      }
      const { rows: payRows } = await this.pool.query(
        `SELECT sp.id, sp.amount, sp.date, sp.comment, sp.created_at, sp.kind, s.name as supplier_name
         FROM supplier_payments sp
         LEFT JOIN suppliers s ON s.id = sp.supplier_id
         WHERE ${spConds.join(' AND ')}
         ORDER BY sp.date DESC
         LIMIT 500`,
        spParams,
      );
      for (const r of payRows) {
        // 'payment' и 'defect_return' остаются supplier_payment (как до 144);
        // 'refund' — ЛОГИЧЕСКИ отдельный вид (фильтр ?type=supplier_refund,
        // бейдж «Возврат от поставщика», ABS(amount)), но в проводе kind
        // остаётся 'supplier_payment' + isRefund=true: старые мобильные бандлы
        // крашатся на незнакомом kind (journalKindVisual[kind] без фолбэка →
        // TypeError → корневой ErrorBoundary). Новые клиенты рисуют по флагу.
        const isRefund = r.kind === 'refund';
        const logicalKind: JournalDoc['kind'] = isRefund ? 'supplier_refund' : 'supplier_payment';
        if (type && logicalKind !== type) continue;
        const meta = KIND_META[logicalKind];
        const rawAmount = parseFloat(r.amount) || 0;
        out.push({
          id: r.id,
          kind: 'supplier_payment',
          ...(isRefund ? { isRefund: true } : {}),
          occurredAt: r.date || r.created_at,
          title: isRefund
            ? r.supplier_name
              ? `Возврат от поставщика: ${r.supplier_name}`
              : 'Возврат от поставщика'
            : r.supplier_name
              ? `Оплата: ${r.supplier_name}`
              : 'Оплата поставщику',
          subtitle: r.comment || undefined,
          amount: Math.abs(rawAmount),
          badge: meta.badge,
          badgeColor: meta.badgeColor,
          payeeName: r.supplier_name || undefined,
        });
      }
    }

    // Final merge — sort by occurredAt DESC; if equal, by amount desc
    // for predictable order. Cap at 500 rows total to keep payload sane.
    out.sort((a, b) => {
      const t = new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime();
      return t !== 0 ? t : b.amount - a.amount;
    });
    return out.slice(0, 500);
  }
}
