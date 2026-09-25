import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database.module';
import { SalaryService } from '../../../salary/salary.service';
import { BuiltReport, MAIN_ROW_LIMIT, ReportBuilder, ReportContext, SECTION_ROW_LIMIT } from '../report-context';
import { ReportColumn, ReportRow, ReportSection } from '../report-types';
import { baseParams, idsFilter, inPeriod, num, pushPoint, round2 } from '../report-sql';

interface SalaryListRow {
  masterId: string;
  masterName: string;
  serviceEarnings: number;
  productEarnings: number;
  premiumsAmount: number;
  penaltiesAmount: number;
  motivationAmount: number;
  totalEarnings: number;
  workedShifts: number;
  perDay: number | null;
}

interface MovementRow {
  user_id: string;
  kind: 'salary' | 'advance' | 'premium' | 'penalty';
  amount: string;
  at: string | Date;
  comment: string | null;
}

/** Суммы движений сотрудника за период по видам. */
interface PaidSums {
  salary: number;
  advance: number;
  premium: number;
  penalty: number;
}

/**
 * По зарплатам.
 *
 * НАЧИСЛЕНИЯ — через SalaryService.getAll: тот же расчёт, что видит мастер и
 * владелец на экране «Зарплата» (процент с работ исполнителю строки, товарная
 * комиссия мастеру чека, премии деньгами, мотивация, штрафы, смены).
 * Формула процента здесь не повторяется — берутся готовые суммы.
 *
 * ВЫПЛАТЫ — по ДАТЕ ВЫДАЧИ в периоде (спека): принятые salary_payouts
 * (зарплата / аванс) + легаси salary_payments без сторно. Экран «Зарплата»
 * относит выплату с назначенным месяцем (period_month) к этому месяцу; в
 * отчёте выплата «за июль», выданная 5 августа, стоит в августе — так столбцы
 * сходятся с секцией «Выплаты и удержания» до копейки. Разница оговорена в notes.
 *
 * ОСТАТОК = начислено всего − штрафы − выплачено всего; минус — переплата.
 *
 * Суммы выплат/удержаний по сотруднику — отдельным GROUP BY БЕЗ лимита
 * (paidByUser): список движений в секции ограничен SECTION_ROW_LIMIT, и
 * считать «Выплачено»/«Остаток» по нему нельзя — при длинном периоде старые
 * выплаты выпадали бы из сумм.
 */
@Injectable()
export class SalaryBuilder implements ReportBuilder {
  readonly id = 'salary' as const;

  constructor(
    @Inject(PG_POOL) private pool: Pool,
    private salary: SalaryService,
  ) {}

  async build(ctx: ReportContext): Promise<BuiltReport> {
    const [list, byUser, movements, users] = await Promise.all([
      this.salary.getAll(ctx.tenantId, { dateFrom: ctx.dateFrom, dateTo: ctx.dateTo }, ctx.pointId) as Promise<
        SalaryListRow[]
      >,
      this.paidByUser(ctx),
      this.movements(ctx),
      this.users(ctx),
    ]);

    const selected = new Set(ctx.ids);

    const columns: ReportColumn[] = [
      { key: 'name', title: 'Сотрудник', type: 'text' },
      { key: 'works', title: 'За работы', type: 'money' },
      { key: 'products', title: 'За товары', type: 'money' },
      { key: 'extras', title: 'Премии и мотивация', type: 'money' },
      { key: 'accrued', title: 'Начислено всего', type: 'money' },
      { key: 'penalties', title: 'Штрафы', type: 'money' },
      { key: 'advances', title: 'Авансы', type: 'money' },
      { key: 'salaryPaid', title: 'Выплачено ЗП', type: 'money' },
      { key: 'paid', title: 'Выплачено всего', type: 'money' },
      {
        key: 'remaining',
        title: 'Остаток',
        type: 'money',
        signed: true,
        hint: 'Начислено − штрафы − выплачено; минус — выплатили больше, чем заработано',
      },
      { key: 'shifts', title: 'Смен', type: 'int' },
      { key: 'perShift', title: 'За смену', type: 'money' },
    ];

    const totals: ReportRow = {
      name: 'Итого',
      works: 0,
      products: 0,
      extras: 0,
      accrued: 0,
      penalties: 0,
      advances: 0,
      salaryPaid: 0,
      paid: 0,
      remaining: 0,
      shifts: 0,
      perShift: 0,
    };
    const add = (key: string, v: number) => {
      totals[key] = round2((totals[key] as number) + v);
    };

    const rows: ReportRow[] = [];
    for (const r of list) {
      if (selected.size > 0 && !selected.has(r.masterId)) continue;
      const mv = byUser.get(r.masterId) ?? { salary: 0, advance: 0, premium: 0, penalty: 0 };
      const u = users.get(r.masterId);
      const extras = round2(num(r.premiumsAmount) + num(r.motivationAmount));
      const accrued = round2(num(r.totalEarnings));
      const penalties = round2(num(r.penaltiesAmount));
      const paid = round2(mv.salary + mv.advance);
      const remaining = round2(accrued - penalties - paid);
      const isEmpty = accrued === 0 && penalties === 0 && paid === 0 && num(r.workedShifts) === 0;
      // Уволенного без единой цифры за период не показываем — иначе список
      // вечно тянул бы всех, кто когда-либо работал.
      if (isEmpty && u?.dismissed) continue;
      const row: ReportRow = {
        _id: r.masterId,
        _tone: remaining < 0 ? 'negative' : 'default',
        name: u?.dismissed ? `${r.masterName} (уволен)` : r.masterName,
        works: round2(num(r.serviceEarnings)),
        products: round2(num(r.productEarnings)),
        extras,
        accrued,
        penalties,
        advances: mv.advance,
        salaryPaid: mv.salary,
        paid,
        remaining,
        shifts: num(r.workedShifts),
        perShift: r.perDay ?? null,
      };
      rows.push(row);
      for (const key of [
        'works',
        'products',
        'extras',
        'accrued',
        'penalties',
        'advances',
        'salaryPaid',
        'paid',
        'remaining',
        'shifts',
      ]) {
        add(key, row[key] as number);
      }
    }
    rows.sort(
      (a, b) => (b.accrued as number) - (a.accrued as number) || String(a.name).localeCompare(String(b.name), 'ru'),
    );
    const truncated = rows.length > MAIN_ROW_LIMIT;
    const shown = truncated ? rows.slice(0, MAIN_ROW_LIMIT) : rows;
    totals.perShift =
      (totals.shifts as number) > 0 ? Math.round((totals.accrued as number) / (totals.shifts as number)) : null;

    const section: ReportSection = {
      key: 'movements',
      title: 'Выплаты и удержания за период',
      columns: [
        { key: 'date', title: 'Дата', type: 'datetime' },
        { key: 'name', title: 'Сотрудник', type: 'text' },
        { key: 'kind', title: 'Тип', type: 'text' },
        { key: 'amount', title: 'Сумма', type: 'money' },
        { key: 'comment', title: 'Комментарий', type: 'text' },
      ],
      // Список усечён лимитом секции — суммы таблицы и KPI от него не зависят
      // (paidByUser считает без лимита), поэтому усечение только помечаем.
      ...(movements.truncated
        ? {
            description: `Показаны последние ${SECTION_ROW_LIMIT} операций; суммы в таблице и KPI учитывают все операции периода.`,
            truncated: true,
          }
        : {}),
      rows: movements.rows.map((m) => ({
        _id: m.user_id,
        date: m.at instanceof Date ? m.at.toISOString() : String(m.at),
        name: users.get(m.user_id)?.name ?? '—',
        kind: KIND_LABELS[m.kind],
        amount: num(m.amount),
        comment: m.comment ?? null,
      })),
      emptyText: 'За период выплат, премий и штрафов не было',
    };

    return {
      kpis: [
        { key: 'accrued', title: 'Начислено', value: totals.accrued as number, type: 'money' },
        { key: 'paid', title: 'Выплачено', value: totals.paid as number, type: 'money' },
        { key: 'penalties', title: 'Штрафы', value: totals.penalties as number, type: 'money' },
        {
          key: 'remaining',
          title: 'Остаток к выплате',
          value: totals.remaining as number,
          type: 'money',
          tone: (totals.remaining as number) < 0 ? 'negative' : 'default',
          hint: 'Минус — выплачено больше, чем начислено',
        },
      ],
      columns,
      rows: shown,
      totals,
      sections: [section],
      truncated,
      notes: [
        'Начисления — как на экране «Зарплата»: процент с работ и товаров по проведённым чекам, премии деньгами и мотивация за период.',
        'Выплаты, авансы, премии и штрафы — по дате выдачи в периоде. Выплата, отнесённая к другому месяцу, на экране «Зарплата» стоит в том месяце, а здесь — в дате выдачи.',
        'Остаток = начислено всего − штрафы − выплачено всего; отрицательный остаток — переплата.',
        'Смены — отработанные дни по графику за период; «за смену» = начислено ÷ смен.',
      ],
    };
  }

  /**
   * Тело UNION'а движений — выплаты (принятые + легаси), премии деньгами и
   * штрафы по дате факта в периоде, филиал — у строки. Общее для сумм и
   * списка; точка кладётся в params ОДИН раз и адресуется всеми ветками.
   */
  private movementsUnionSql(ctx: ReportContext, params: unknown[]): string {
    const ph = pushPoint(params, ctx.pointId);
    const pt = (alias: string) => (ph ? ` AND ${alias}.point_id = ${ph}` : '');
    return `SELECT p.employee_id AS user_id, p.type AS kind, p.amount, p.created_at AS at, p.comment
           FROM salary_payouts p
          WHERE p.tenant_id = $1 AND p.status = 'accepted' AND ${inPeriod('p.created_at')}${pt('p')}
         UNION ALL
         SELECT sp.user_id, CASE WHEN sp.type = 'advance' THEN 'advance' ELSE 'salary' END, sp.amount, sp.date, sp.comment
           FROM salary_payments sp
          WHERE sp.tenant_id = $1 AND sp.reversed_at IS NULL AND ${inPeriod('sp.date')}${pt('sp')}
         UNION ALL
         SELECT pr.user_id, 'premium', COALESCE(pr.amount, 0), pr.created_at, pr.reason
           FROM salary_premiums pr
          WHERE pr.tenant_id = $1 AND pr.type = 'cash' AND ${inPeriod('pr.created_at')}${pt('pr')}
         UNION ALL
         SELECT pen.user_id, 'penalty', pen.amount, pen.date, pen.description
           FROM salary_penalties pen
          WHERE pen.tenant_id = $1 AND ${inPeriod('pen.date')}${pt('pen')}`;
  }

  /** Суммы движений по (сотрудник, вид) за период — БЕЗ лимита строк. */
  private async paidByUser(ctx: ReportContext): Promise<Map<string, PaidSums>> {
    const params = baseParams(ctx);
    const union = this.movementsUnionSql(ctx, params);
    const idsFrag = idsFilter('x.user_id', ctx.ids, params);
    const { rows } = await this.pool.query(
      `SELECT x.user_id, x.kind, COALESCE(SUM(x.amount), 0) AS total
         FROM (${union}) x
        WHERE TRUE${idsFrag}
        GROUP BY x.user_id, x.kind`,
      params,
    );
    const byUser = new Map<string, PaidSums>();
    for (const r of rows as Array<{ user_id: string; kind: MovementRow['kind']; total: string }>) {
      let b = byUser.get(r.user_id);
      if (!b) {
        b = { salary: 0, advance: 0, premium: 0, penalty: 0 };
        byUser.set(r.user_id, b);
      }
      if (r.kind in b) b[r.kind] = round2(b[r.kind] + num(r.total));
    }
    return byUser;
  }

  /** Последние движения для секции — с лимитом строк секции и признаком усечения. */
  private async movements(ctx: ReportContext): Promise<{ rows: MovementRow[]; truncated: boolean }> {
    const params = baseParams(ctx);
    const union = this.movementsUnionSql(ctx, params);
    const idsFrag = idsFilter('x.user_id', ctx.ids, params);
    const { rows } = await this.pool.query(
      `SELECT x.user_id, x.kind, x.amount, x.at, x.comment
         FROM (${union}) x
        WHERE TRUE${idsFrag}
        ORDER BY x.at DESC
        LIMIT ${SECTION_ROW_LIMIT + 1}`,
      params,
    );
    const truncated = rows.length > SECTION_ROW_LIMIT;
    return { rows: (truncated ? rows.slice(0, SECTION_ROW_LIMIT) : rows) as MovementRow[], truncated };
  }

  private async users(ctx: ReportContext): Promise<Map<string, { name: string; dismissed: boolean }>> {
    const { rows } = await this.pool.query(
      `SELECT id, full_name, dismissed_at FROM users WHERE tenant_id = $1 AND purged_at IS NULL`,
      [ctx.tenantId],
    );
    const map = new Map<string, { name: string; dismissed: boolean }>();
    for (const r of rows) map.set(String(r.id), { name: String(r.full_name ?? '—'), dismissed: !!r.dismissed_at });
    return map;
  }
}

const KIND_LABELS: Record<MovementRow['kind'], string> = {
  salary: 'Зарплата',
  advance: 'Аванс',
  premium: 'Премия',
  penalty: 'Штраф',
};
