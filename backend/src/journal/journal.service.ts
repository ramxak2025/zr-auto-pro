import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';

export interface JournalDoc {
  id: string;
  kind: 'purchase' | 'return_to_supplier' | 'defect_transfer' | 'writeoff' | 'supplier_payment' | 'used_purchase';
  occurredAt: string;
  title: string;
  subtitle?: string;
  amount: number;
  badge: string;
  badgeColor: string;
  payeeName?: string;
}

// Visual tokens shared with the FE for chip / badge rendering.
const KIND_META: Record<JournalDoc['kind'], { badge: string; badgeColor: string; title: string }> = {
  purchase: { badge: 'Поступление', badgeColor: 'green', title: 'Поступление товара' },
  return_to_supplier: { badge: 'Возврат', badgeColor: 'orange', title: 'Возврат поставщику' },
  defect_transfer: { badge: 'В брак', badgeColor: 'red', title: 'Перемещение в брак' },
  writeoff: { badge: 'Списание', badgeColor: 'red', title: 'Списание со склада' },
  supplier_payment: { badge: 'Оплата', badgeColor: 'blue', title: 'Оплата поставщику' },
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
      ['purchase', 'return_to_supplier', 'defect_transfer', 'writeoff', 'used_purchase'].includes(type);

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

    if (!type || type === 'supplier_payment') {
      const spConds: string[] = ['sp.tenant_id = $1'];
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
        `SELECT sp.id, sp.amount, sp.date, sp.comment, sp.created_at, s.name as supplier_name
         FROM supplier_payments sp
         LEFT JOIN suppliers s ON s.id = sp.supplier_id
         WHERE ${spConds.join(' AND ')}
         ORDER BY sp.date DESC
         LIMIT 500`,
        spParams,
      );
      for (const r of payRows) {
        const meta = KIND_META.supplier_payment;
        out.push({
          id: r.id,
          kind: 'supplier_payment',
          occurredAt: r.date || r.created_at,
          title: r.supplier_name ? `Оплата: ${r.supplier_name}` : 'Оплата поставщику',
          subtitle: r.comment || undefined,
          amount: parseFloat(r.amount) || 0,
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
