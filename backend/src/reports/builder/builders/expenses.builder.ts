import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database.module';
import { checkMoneyBaseWhere, checkRevenueExpr } from '../../../common/check-money-sql';
import { effectiveMonthMembershipSql } from '../../../common/period-membership';
import { pointFilterSql } from '../../../common/point-scope';
import { BuiltReport, MAIN_ROW_LIMIT, ReportBuilder, ReportContext } from '../report-context';
import { ReportColumn, ReportRow, ReportSection } from '../report-types';
import { TZ_PH, baseParams, dayKey, expenseApproved, inPeriod, num, pct, round2 } from '../report-sql';

const TOP_EXPENSES = 20;

/**
 * Убыток гарантийного чека (алиас ch) — ДОСЛОВНО колонка warranty_loss из
 * report-shared-queries.checkAggregate и reports.getFinancial: запчасти +
 * зарплата мастера за работу + его товарная комиссия (product_salary_total
 * начисляется и по гарантии — money-audit C2). Другая формула здесь означала
 * бы разную «Гарантию» в сводном отчёте и в «По расходам».
 */
const WARRANTY_LOSS = 'ch.product_cost_total + ch.service_salary_total + COALESCE(ch.product_salary_total, 0)';

/**
 * По расходам — как раздел «Расходы»: одобренные расходы (включая категорию
 * «Зарплата») плюс синтетическая строка «Гарантия (убыток)» из гарантийных чеков —
 * по формуле сводного отчёта (WARRANTY_LOSS), суммой отдельного агрегата без лимита
 * строк.
 *
 * ОТНЕСЕНИЕ К ПЕРИОДУ — по МЕСЯЦУ, «ЗА КОТОРЫЙ» расход (правка №3, 2026-09-30):
 * period_month (у выплат зарплаты это месяц выплаты; у ручного расхода — «аренда за
 * сентябрь, оплачена в октябре» стоит в сентябре). Расход без назначенного месяца — по
 * дате оплаты. Правило — общий helper common/period-membership.ts, тот же, что у «По
 * зарплатам» и экрана «Зарплата»; поэтому «Из них зарплата» здесь сходится с «Выплачено»
 * из отчёта «По зарплатам». Кассовый взгляд «куда ушли деньги по дням» — лента раздела
 * «Расходы» (attribution=date) и кассовая смена: они считают по дате оплаты и не менялись
 * («Движение денег» после Волны G оттоков вообще не показывает — только приход).
 * Гарантийные убытки — по дате чека (у чека месяца «за который» нет).
 */
@Injectable()
export class ExpensesBuilder implements ReportBuilder {
  readonly id = 'expenses' as const;

  constructor(@Inject(PG_POOL) private pool: Pool) {}

  async build(ctx: ReportContext): Promise<BuiltReport> {
    // Один и тот же фрагмент отнесения к периоду — для категорий и топа: суммы
    // «по категориям» и «Крупнейшие расходы» обязаны считаться по одним и тем же строкам.
    const expenseInPeriod = effectiveMonthMembershipSql('e.period_month', 'e.date', ctx.dateFrom, ctx.dateTo, TZ_PH);
    const catParams = baseParams(ctx);
    const catPoint = pointFilterSql('e', ctx.pointId, catParams);
    const revParams = baseParams(ctx);
    const revPoint = pointFilterSql('ch', ctx.pointId, revParams);
    const wParams = baseParams(ctx);
    const wPoint = pointFilterSql('ch', ctx.pointId, wParams);
    const wTopParams = baseParams(ctx);
    const wTopPoint = pointFilterSql('ch', ctx.pointId, wTopParams);
    const topParams = baseParams(ctx);
    const topPoint = pointFilterSql('e', ctx.pointId, topParams);

    const [{ rows: catRows }, { rows: revRows }, { rows: wAggRows }, { rows: wRows }, { rows: topRows }] =
      await Promise.all([
        this.pool.query(
          `SELECT COALESCE(ec.name, 'Без категории') AS category, COUNT(*)::int AS cnt, COALESCE(SUM(e.amount), 0) AS total
           FROM expenses e
           LEFT JOIN expense_categories ec ON ec.id = e.category_id
          WHERE e.tenant_id = $1 AND ${expenseInPeriod} AND ${expenseApproved('e')}${catPoint}
          GROUP BY 1
          ORDER BY total DESC, category
          LIMIT ${MAIN_ROW_LIMIT + 1}`,
          catParams,
        ),
        this.pool.query(
          `SELECT COALESCE(SUM(${checkRevenueExpr('ch')}), 0) AS revenue
           FROM checks ch
          WHERE ch.tenant_id = $1 AND ${inPeriod('ch.date')} AND ${checkMoneyBaseWhere('ch')}${revPoint}`,
          revParams,
        ),
        // Сумма и число гарантийных убытков — БЕЗ лимита: усечённый список давал
        // бы при длинном периоде «Гарантию» меньше, чем в сводном отчёте.
        this.pool.query(
          `SELECT COUNT(*) FILTER (WHERE (${WARRANTY_LOSS}) > 0)::int AS cnt,
                COALESCE(SUM(${WARRANTY_LOSS}), 0) AS total
           FROM checks ch
          WHERE ch.tenant_id = $1 AND ch.payment_method = 'warranty' AND ${checkMoneyBaseWhere('ch')}
            AND ${inPeriod('ch.date')}${wPoint}`,
          wParams,
        ),
        // Крупнейшие гарантийные убытки — только для секции «Крупнейшие расходы»
        // (туда попадает топ-N вместе с обычными расходами), поэтому лимит = N.
        this.pool.query(
          `SELECT ch.id, ch.number, ${dayKey('ch.date')} AS day,
                (${WARRANTY_LOSS}) AS loss,
                u.full_name AS master_name, ca.plate_number
           FROM checks ch
           LEFT JOIN users u ON u.id = ch.master_id AND u.tenant_id = ch.tenant_id
           LEFT JOIN cars ca ON ca.id = ch.car_id AND ca.tenant_id = ch.tenant_id
          WHERE ch.tenant_id = $1 AND ch.payment_method = 'warranty' AND ${checkMoneyBaseWhere('ch')}
            AND (${WARRANTY_LOSS}) > 0 AND ${inPeriod('ch.date')}${wTopPoint}
          ORDER BY loss DESC
          LIMIT ${TOP_EXPENSES}`,
          wTopParams,
        ),
        this.pool.query(
          `SELECT e.id, ${dayKey('e.date')} AS day, COALESCE(ec.name, 'Без категории') AS category, e.amount, e.description,
                COALESCE(u.full_name, e.recipient_name, cu.full_name) AS employee
           FROM expenses e
           LEFT JOIN expense_categories ec ON ec.id = e.category_id
           LEFT JOIN users u ON u.id = e.user_id
           LEFT JOIN users cu ON cu.id = e.created_by
          WHERE e.tenant_id = $1 AND ${expenseInPeriod} AND ${expenseApproved('e')}${topPoint}
          ORDER BY e.amount DESC, e.date DESC
          LIMIT ${TOP_EXPENSES}`,
          topParams,
        ),
      ]);

    const truncated = catRows.length > MAIN_ROW_LIMIT;
    const cats = (truncated ? catRows.slice(0, MAIN_ROW_LIMIT) : catRows).map((r) => ({
      category: String(r.category),
      count: num(r.cnt),
      total: num(r.total),
    }));
    const warrantyCount = num(wAggRows[0]?.cnt);
    const warrantyLoss = round2(num(wAggRows[0]?.total));
    if (warrantyCount > 0) cats.push({ category: 'Гарантия (убыток)', count: warrantyCount, total: warrantyLoss });
    cats.sort((a, b) => b.total - a.total);

    const revenue = num(revRows[0]?.revenue);
    const total = round2(cats.reduce((s, c) => s + c.total, 0));
    const salary = round2(cats.filter((c) => c.category === 'Зарплата').reduce((s, c) => s + c.total, 0));

    const columns: ReportColumn[] = [
      { key: 'category', title: 'Категория', type: 'text' },
      { key: 'count', title: 'Расходов', type: 'int' },
      { key: 'amount', title: 'Сумма', type: 'money' },
      { key: 'shareOfExpenses', title: 'Доля от расходов', type: 'percent' },
      { key: 'shareOfRevenue', title: 'Доля от выручки', type: 'percent' },
    ];
    const rows: ReportRow[] = cats.map((c) => ({
      category: c.category,
      count: c.count,
      amount: c.total,
      shareOfExpenses: pct(c.total, total),
      shareOfRevenue: pct(c.total, revenue),
      _tone: c.category === 'Гарантия (убыток)' ? 'warning' : 'default',
    }));
    const totals: ReportRow = {
      category: 'Итого',
      count: cats.reduce((s, c) => s + c.count, 0),
      amount: total,
      shareOfExpenses: total > 0 ? 100 : 0,
      shareOfRevenue: pct(total, revenue),
    };

    const topAll: ReportRow[] = [
      ...topRows.map((r) => ({
        _id: r.id,
        date: String(r.day),
        category: String(r.category),
        amount: num(r.amount),
        comment: r.description ?? null,
        employee: r.employee ?? null,
      })),
      ...wRows.map((w) => ({
        _id: w.id,
        _tone: 'warning',
        date: String(w.day),
        category: 'Гарантия (убыток)',
        amount: num(w.loss),
        comment: `Гарантия — заказ-наряд #${w.number}${w.plate_number ? ` · ${w.plate_number}` : ''}`,
        employee: w.master_name ?? null,
      })),
    ]
      .sort((a, b) => (b.amount as number) - (a.amount as number))
      .slice(0, TOP_EXPENSES);

    const top: ReportSection = {
      key: 'largest',
      title: 'Крупнейшие расходы',
      description: `Топ-${TOP_EXPENSES} за период. Дата — день оплаты; расход стоит в периоде того месяца, за который назначен.`,
      columns: [
        { key: 'date', title: 'Дата', type: 'date' },
        { key: 'category', title: 'Категория', type: 'text' },
        { key: 'amount', title: 'Сумма', type: 'money' },
        { key: 'comment', title: 'Комментарий', type: 'text' },
        { key: 'employee', title: 'Сотрудник', type: 'text' },
      ],
      rows: topAll,
      emptyText: 'За период расходов не было',
    };

    return {
      kpis: [
        { key: 'total', title: 'Расходы всего', value: total, type: 'money' },
        { key: 'revenue', title: 'Выручка', value: revenue, type: 'money' },
        { key: 'salary', title: 'Из них зарплата', value: salary, type: 'money' },
        {
          key: 'ratio',
          title: 'Расходы / выручка',
          value: pct(total, revenue),
          type: 'percent',
          tone: revenue > 0 && total > revenue ? 'negative' : 'default',
        },
      ],
      columns,
      rows,
      totals,
      sections: [top],
      truncated,
      notes: [
        'Расходы — из раздела «Расходы», только одобренные, включая выплаты зарплаты (категория «Зарплата»). По месяцу, за который расход; расход без назначенного месяца — по дате оплаты.',
        'Выплата зарплаты относится к месяцу, за который выдана (выдана в октябре за сентябрь — в сентябре). Деньги по дате выдачи — в списке раздела «Расходы» и в кассовой смене.',
        '«Гарантия (убыток)» — запчасти, зарплата мастера и его товарная комиссия по гарантийным чекам за период; та же сумма, что в сводном отчёте.',
        'Доля от выручки — расход ÷ выручка по проведённым чекам за тот же период.',
      ],
    };
  }
}
