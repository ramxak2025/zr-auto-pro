import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database.module';
import { checkMoneyBaseWhere, checkRevenueExpr } from '../../../common/check-money-sql';
import { pointFilterSql } from '../../../common/point-scope';
import { BuiltReport, MAIN_ROW_LIMIT, ReportBuilder, ReportContext, SECTION_ROW_LIMIT } from '../report-context';
import { ReportColumn, ReportRow, ReportSection } from '../report-types';
import { baseParams, inPeriod, num, pct, pushPoint } from '../report-sql';

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/**
 * По записям — записи по дате визита в периоде, филиал — у самой записи
 * (bookings.point_id, 167). Приехали = arrived + converted; конверсия в чек
 * = converted / (все − отменённые). Таблица — по исполнителям, если хотя бы
 * у одной записи периода есть мастер (остальные — «Без исполнителя»), иначе
 * по дням недели визита. Выручка по записям — чеки, в которые записи проведены,
 * каждый чек ОДИН раз: две записи периода на один чек его не задваивают.
 */
@Injectable()
export class BookingsBuilder implements ReportBuilder {
  readonly id = 'bookings' as const;

  constructor(@Inject(PG_POOL) private pool: Pool) {}

  async build(ctx: ReportContext): Promise<BuiltReport> {
    const kParams = baseParams(ctx);
    // Точка кладётся ОДИН раз: её адресуют и внешний запрос по записям, и
    // подзапрос выручки (pointFilterSql положил бы второй параметр).
    const kPh = pushPoint(kParams, ctx.pointId);
    const kPoint = kPh ? ` AND b.point_id = ${kPh}` : '';
    const kPointInner = kPh ? ` AND bb.point_id = ${kPh}` : '';
    // Выручка — по УНИКАЛЬНЫМ чекам, в которые проведена хотя бы одна запись
    // периода: SUM по bookings LEFT JOIN checks считал бы чек столько раз,
    // сколько записей на него ссылается.
    const { rows: kRows } = await this.pool.query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE b.status IN ('arrived', 'converted'))::int AS arrived,
              COUNT(*) FILTER (WHERE b.status = 'converted')::int AS converted,
              COUNT(*) FILTER (WHERE b.status = 'no_show')::int AS no_show,
              COUNT(*) FILTER (WHERE b.status = 'cancelled')::int AS cancelled,
              COUNT(*) FILTER (WHERE b.master_id IS NOT NULL)::int AS with_master,
              (SELECT COALESCE(SUM(${checkRevenueExpr('ch')}), 0)
                 FROM checks ch
                WHERE ch.tenant_id = $1 AND ${checkMoneyBaseWhere('ch')}
                  AND EXISTS (SELECT 1 FROM bookings bb
                               WHERE bb.tenant_id = $1 AND bb.check_id = ch.id
                                 AND ${inPeriod('bb.scheduled_at')}${kPointInner})) AS revenue
         FROM bookings b
        WHERE b.tenant_id = $1 AND ${inPeriod('b.scheduled_at')}${kPoint}`,
      kParams,
    );
    const k = kRows[0] ?? {};
    const total = num(k.total);
    const cancelled = num(k.cancelled);
    const converted = num(k.converted);
    const noShow = num(k.no_show);
    const base = total - cancelled;
    const byMaster = num(k.with_master) > 0;

    const tParams = baseParams(ctx);
    const tPoint = pointFilterSql('b', ctx.pointId, tParams);
    const groupExpr = byMaster
      ? `COALESCE(u.full_name, 'Без исполнителя')`
      : `EXTRACT(ISODOW FROM b.scheduled_at AT TIME ZONE $4::text)::int`;
    const { rows: tRows } = await this.pool.query(
      `SELECT ${groupExpr} AS grp,
              ${byMaster ? 'b.master_id' : 'NULL::uuid'} AS master_id,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE b.status IN ('arrived', 'converted'))::int AS arrived,
              COUNT(*) FILTER (WHERE b.status = 'converted')::int AS converted,
              COUNT(*) FILTER (WHERE b.status = 'no_show')::int AS no_show,
              COUNT(*) FILTER (WHERE b.status = 'cancelled')::int AS cancelled
         FROM bookings b
         ${byMaster ? 'LEFT JOIN users u ON u.id = b.master_id AND u.tenant_id = b.tenant_id' : ''}
        WHERE b.tenant_id = $1 AND ${inPeriod('b.scheduled_at')}${tPoint}
        GROUP BY 1${byMaster ? ', 2' : ''}
        ORDER BY ${byMaster ? 'total DESC, grp' : 'grp'}
        LIMIT ${MAIN_ROW_LIMIT + 1}`,
      tParams,
    );
    const truncated = tRows.length > MAIN_ROW_LIMIT;
    const data = truncated ? tRows.slice(0, MAIN_ROW_LIMIT) : tRows;

    const columns: ReportColumn[] = [
      { key: 'name', title: byMaster ? 'Исполнитель' : 'День недели', type: 'text' },
      { key: 'total', title: 'Записей', type: 'int' },
      { key: 'arrived', title: 'Приехали', type: 'int' },
      { key: 'noShow', title: 'Не пришли', type: 'int' },
      {
        key: 'conversion',
        title: 'Конверсия в чек',
        type: 'percent',
        hint: 'Оформлен чек ÷ все записи, кроме отменённых',
      },
    ];
    const rows: ReportRow[] = data.map((r) => ({
      _id: r.master_id ?? null,
      name: byMaster ? String(r.grp) : (WEEKDAYS[num(r.grp) - 1] ?? String(r.grp)),
      total: num(r.total),
      arrived: num(r.arrived),
      noShow: num(r.no_show),
      conversion: pct(num(r.converted), num(r.total) - num(r.cancelled)),
    }));
    const totals: ReportRow = {
      name: 'Итого',
      total,
      arrived: num(k.arrived),
      noShow,
      conversion: pct(converted, base),
    };

    const nParams = baseParams(ctx);
    const nPoint = pointFilterSql('b', ctx.pointId, nParams);
    const { rows: nRows } = await this.pool.query(
      `SELECT b.id, b.scheduled_at, cl.full_name AS client, cl.phone, b.comment, u.full_name AS master
         FROM bookings b
         LEFT JOIN clients cl ON cl.id = b.client_id
         LEFT JOIN users u ON u.id = b.master_id AND u.tenant_id = b.tenant_id
        WHERE b.tenant_id = $1 AND b.status = 'no_show' AND ${inPeriod('b.scheduled_at')}${nPoint}
        ORDER BY b.scheduled_at DESC
        LIMIT ${SECTION_ROW_LIMIT}`,
      nParams,
    );
    const noShowSection: ReportSection = {
      key: 'noShow',
      title: 'Не пришли',
      description: 'Для обзвона: кто записывался и не приехал.',
      columns: [
        { key: 'date', title: 'Дата визита', type: 'datetime' },
        { key: 'client', title: 'Клиент', type: 'text' },
        { key: 'phone', title: 'Телефон', type: 'text' },
        { key: 'comment', title: 'Комментарий к записи', type: 'text' },
        { key: 'master', title: 'Исполнитель', type: 'text' },
      ],
      rows: nRows.map((r) => ({
        _id: r.id,
        date: r.scheduled_at instanceof Date ? r.scheduled_at.toISOString() : String(r.scheduled_at),
        client: r.client ?? '—',
        phone: r.phone ?? null,
        comment: r.comment ?? null,
        master: r.master ?? null,
      })),
      emptyText: 'За период все записанные приехали',
    };

    return {
      kpis: [
        { key: 'total', title: 'Записей', value: total, type: 'int' },
        {
          key: 'arrived',
          title: 'Приехали',
          value: num(k.arrived),
          type: 'int',
          hint: 'Статусы «приехал» и «оформлен чек»',
        },
        { key: 'converted', title: 'Оформлен чек', value: converted, type: 'int' },
        { key: 'noShow', title: 'Не пришли', value: noShow, type: 'int', tone: noShow > 0 ? 'warning' : 'default' },
        { key: 'cancelled', title: 'Отменены', value: cancelled, type: 'int' },
        {
          key: 'conversion',
          title: 'Конверсия в чек',
          value: pct(converted, base),
          type: 'percent',
          hint: 'От всех записей, кроме отменённых',
        },
        {
          key: 'noShowRate',
          title: 'Не пришли',
          value: pct(noShow, base),
          type: 'percent',
          hint: 'От всех записей, кроме отменённых',
        },
        {
          key: 'revenue',
          title: 'Выручка по записям',
          value: num(k.revenue),
          type: 'money',
          hint: 'Чеки, в которые проведены записи',
        },
      ],
      columns,
      rows,
      totals,
      sections: [noShowSection],
      truncated,
      notes: [
        'Записи — по дате визита в периоде. Приехали — статусы «приехал» и «оформлен чек»; не пришли — статус «не пришёл».',
        'Конверсия = оформлен чек ÷ все записи, кроме отменённых. Записи со статусом «запланирована» ещё не состоялись.',
        byMaster
          ? 'Таблица — по исполнителям записей; записи без исполнителя собраны в строку «Без исполнителя».'
          : 'У записей периода нет исполнителей, поэтому таблица — по дням недели визита.',
      ],
    };
  }
}
