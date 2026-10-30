import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database.module';
import { analysisSelection, AnalysisData, AnalysisRow, loadAnalysis } from '../analysis-query';
import { BuiltReport, MAIN_ROW_LIMIT, ReportBuilder, ReportContext } from '../report-context';
import { ReportColumn, ReportKpi, ReportRow, ReportSection } from '../report-types';
import { pct, round2, weekLabel } from '../report-sql';

const KIND_LABELS = { product: 'Товар', service: 'Услуга', adjustment: 'Корректировка' };
const grossHint = 'Выручка − себестоимость товаров; до зарплаты и прочих расходов';
const margin = (gross: number | null, revenue: number): number | null =>
  gross === null || revenue <= 0 ? null : pct(gross, revenue);

export function analysisNotes(data: AnalysisData): string[] {
  const notes = [
    'Проведённые чеки текущего филиала за выбранные даты в часовом поясе компании. Гарантийные, отложенные и удалённые чеки не входят. Возврат уменьшает исходный период продажи.',
    'Цены и себестоимость сохранены в строках чеков. Скидка чека распределена только по товарам пропорционально их сумме, с точностью до копейки.',
    'У товара показано количество после возвратов. Одна строка услуги — одна оказанная услуга, включая старые строки «×3»; полностью возвращённые не считаются оказанными.',
  ];
  if (data.totals.groups > MAIN_ROW_LIMIT) {
    notes.unshift(
      `Показано ${MAIN_ROW_LIMIT} из ${data.totals.groups} позиций. Итоги, доли и классы ABC рассчитаны по всем позициям; экран и экспорт содержат только показанные строки.`,
    );
  }
  if (data.adjustment.checks > 0) {
    notes.push(
      '«Корректировки чеков» — разница между сохранёнными итогами чеков и их строками: например, ручная сумма возврата. Она входит в общий итог, но не приписывается товарам или услугам и не участвует в ABC. В выборе только товаров или услуг она показана отдельно и в итог выборки не входит.',
    );
  }
  if (data.totals.unknown_cost > 0) {
    notes.push(
      `Строк без сохранённой себестоимости: ${data.totals.unknown_cost}. Для этих позиций, общей валовой прибыли и маржи показано «—» вместо предположения о нулевой себестоимости.`,
    );
  }
  if (data.totals.zero_cost > 0) {
    notes.push(
      `Товарных строк с нулевой себестоимостью: ${data.totals.zero_cost}. Она использована как записано; по старым данным нельзя отличить бесплатный товар от незаполненной закупки — проверьте эти строки.`,
    );
  }
  return notes;
}

function rowStatus(row: AnalysisRow, abc = false): string {
  if (row.kind === 'adjustment') return 'Сверка с чеками';
  if (row.cost === null) return 'Нет себестоимости';
  if (abc && row.value !== null && row.value < 0) return 'Отрицательный вклад';
  if (abc && row.value === 0) return 'Нулевой вклад';
  if (row.zero_cost > 0) return 'Нулевая себестоимость';
  return row.kind === 'service' ? 'До зарплаты' : '';
}

function financialColumns(): ReportColumn[] {
  return [
    { key: 'revenue', title: 'Выручка', type: 'money' },
    { key: 'cost', title: 'Себестоимость товаров', type: 'money', hint: 'У услуг отдельная себестоимость не задана' },
    { key: 'gross', title: 'Валовая прибыль', type: 'money', hint: grossHint, signed: true },
    {
      key: 'margin',
      title: 'Маржа',
      type: 'percent',
      hint: 'Валовая прибыль ÷ выручка; при выручке ≤ 0 не определена',
    },
  ];
}

function sections(data: AnalysisData, ctx: ReportContext, gross: boolean): ReportSection[] {
  const valueColumns = gross ? financialColumns() : [{ key: 'revenue', title: 'Выручка', type: 'money' as const }];
  const result: ReportSection[] = [
    {
      key: 'composition',
      title: 'Состав результата',
      columns: [{ key: 'name', title: 'Состав', type: 'text' }, ...valueColumns],
      rows: data.kinds.map((r) => ({
        name: r.kind === 'product' ? 'Товары' : r.kind === 'service' ? 'Услуги' : 'Корректировки чеков',
        revenue: r.revenue,
        cost: r.kind === 'service' ? null : r.cost,
        gross: r.gross,
        margin: margin(r.gross, r.revenue),
      })),
    },
    {
      key: 'timeline',
      title: ctx.days > 93 ? 'По неделям' : 'По дням',
      description: 'По дате исходного чека; суммы включают его возвраты.',
      columns: [
        { key: 'date', title: ctx.days > 93 ? 'Неделя' : 'Дата', type: ctx.days > 93 ? 'text' : 'date' },
        ...valueColumns,
      ],
      rows: data.timeline.map((r) => ({
        date: ctx.days > 93 ? weekLabel(r.day, ctx.dateFrom, ctx.dateTo) : r.day,
        revenue: r.revenue,
        cost: r.cost,
        gross: r.gross,
        margin: margin(r.gross, r.revenue),
      })),
    },
  ];
  if (data.adjustment.checks > 0 && analysisSelection(ctx.groupBy).kind !== 'all') {
    result.push({
      key: 'adjustments',
      title: 'Не распределено по позициям',
      description: 'Общие корректировки чеков; в итог выбранных товаров или услуг не входят.',
      columns: [{ key: 'name', title: 'Состав', type: 'text' }, ...valueColumns],
      rows: [
        {
          name: 'Корректировки чеков',
          revenue: data.adjustment.revenue,
          cost: data.adjustment.cost,
          gross: data.adjustment.cost === null ? null : round2(data.adjustment.revenue - data.adjustment.cost),
          margin: null,
        },
      ],
    });
  }
  return result;
}

async function buildSales(pool: Pool, ctx: ReportContext, gross: boolean): Promise<BuiltReport> {
  const selection = analysisSelection(ctx.groupBy);
  const data = await loadAnalysis(pool, ctx, { ...selection, basis: gross ? 'gross' : 'revenue' });
  const totals = data.totals;
  const kpis: ReportKpi[] = [{ key: 'revenue', title: 'Выручка', value: totals.revenue, type: 'money' }];
  if (gross) {
    kpis.push(
      { key: 'cost', title: 'Себестоимость товаров', value: totals.cost, type: 'money' },
      {
        key: 'gross',
        title: 'Валовая прибыль',
        value: totals.gross,
        type: 'money',
        hint: grossHint,
        tone: totals.gross === null ? 'warning' : totals.gross < 0 ? 'negative' : 'positive',
      },
      { key: 'margin', title: 'Маржа', value: margin(totals.gross, totals.revenue), type: 'percent' },
    );
    if (totals.unknown_cost > 0)
      kpis.push({
        key: 'unknownCost',
        title: 'Без себестоимости',
        value: totals.unknown_cost,
        type: 'int',
        tone: 'warning',
      });
  } else {
    kpis.push({ key: 'checks', title: 'Чеков с позициями', value: totals.checks, type: 'int' });
    if (selection.kind !== 'services')
      kpis.push({
        key: 'products',
        title: 'Продано товаров',
        value: totals.product_qty,
        type: 'number',
        hint: 'Количество после возвратов',
      });
    if (selection.kind !== 'products')
      kpis.push({ key: 'services', title: 'Оказано услуг', value: totals.service_qty, type: 'int' });
  }
  const columns: ReportColumn[] = [
    { key: 'name', title: 'Позиция', type: 'text' },
    { key: 'kind', title: 'Тип', type: 'text' },
    ...(gross
      ? financialColumns()
      : [
          {
            key: 'qty',
            title: 'Количество',
            type: 'number' as const,
            hint: 'Товары — единицы; услуги — строки заказ-наряда',
          },
          { key: 'revenue', title: 'Выручка', type: 'money' as const },
          { key: 'share', title: 'Доля выручки', type: 'percent' as const },
        ]),
    ...(gross ? [{ key: 'status', title: 'Примечание', type: 'text' as const }] : []),
  ];
  const rows: ReportRow[] = data.rows.slice(0, MAIN_ROW_LIMIT).map((r) => ({
    _id: r.key,
    name: r.name,
    kind: KIND_LABELS[r.kind],
    qty: r.kind === 'adjustment' ? null : r.qty,
    revenue: r.revenue,
    cost: r.kind === 'service' ? null : r.cost,
    gross: r.gross,
    margin: margin(r.gross, r.revenue),
    share: totals.revenue > 0 ? pct(r.revenue, totals.revenue) : null,
    status: rowStatus(r),
  }));
  return {
    kpis,
    columns,
    rows,
    totals: {
      name: 'Итого',
      kind: null,
      qty:
        selection.kind === 'products' ? totals.product_qty : selection.kind === 'services' ? totals.service_qty : null,
      revenue: totals.revenue,
      cost: totals.cost,
      gross: totals.gross,
      margin: margin(totals.gross, totals.revenue),
      share: totals.revenue > 0 ? 100 : null,
      status: null,
    },
    truncated: data.rows.length > MAIN_ROW_LIMIT,
    sections: sections(data, ctx, gross),
    notes: [
      ...(gross
        ? [
            grossHint +
              '. Вклад услуг равен их выручке: товарная себестоимость к ним не применяется, зарплата здесь не вычитается. Возврат товара в брак сохраняет его себестоимость и убыток.',
          ]
        : []),
      ...analysisNotes(data),
    ],
  };
}

@Injectable()
export class SalesBuilder implements ReportBuilder {
  readonly id = 'sales' as const;
  constructor(@Inject(PG_POOL) private pool: Pool) {}
  build(ctx: ReportContext): Promise<BuiltReport> {
    return buildSales(this.pool, ctx, false);
  }
}

@Injectable()
export class GrossProfitBuilder implements ReportBuilder {
  readonly id = 'gross-profit' as const;
  constructor(@Inject(PG_POOL) private pool: Pool) {}
  build(ctx: ReportContext): Promise<BuiltReport> {
    return buildSales(this.pool, ctx, true);
  }
}

@Injectable()
export class AbcBuilder implements ReportBuilder {
  readonly id = 'abc' as const;
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  async build(ctx: ReportContext): Promise<BuiltReport> {
    const selection = analysisSelection(ctx.groupBy);
    const data = await loadAnalysis(this.pool, ctx, selection);
    const gross = selection.basis === 'gross';
    const valueTitle = gross ? 'Валовая прибыль' : 'Выручка';
    return {
      kpis: [
        {
          key: 'value',
          title: `${valueTitle} выборки`,
          value: gross ? data.totals.gross : data.totals.revenue,
          type: 'money',
          hint: gross ? grossHint : 'После скидок и возвратов',
        },
        {
          key: 'basis',
          title: 'Положительная база ABC',
          value: data.totals.positive_value,
          type: 'money',
          hint: 'Только позиции с положительным известным вкладом, без корректировок',
        },
        { key: 'ranked', title: 'Позиций в ABC', value: data.totals.ranked_count, type: 'int' },
        {
          key: 'outside',
          title: 'Вне классификации',
          value: data.totals.groups - data.totals.ranked_count,
          type: 'int',
          hint: 'Нули, отрицательный вклад, неизвестная база и корректировки',
        },
      ],
      columns: [
        { key: 'tier', title: 'Класс', type: 'text' },
        { key: 'name', title: 'Позиция', type: 'text' },
        { key: 'kind', title: 'Тип', type: 'text' },
        { key: 'value', title: valueTitle, type: 'money', signed: true },
        { key: 'share', title: 'Доля базы', type: 'percent' },
        { key: 'cumulative', title: 'Накоплено', type: 'percent' },
        { key: 'status', title: 'Примечание', type: 'text' },
      ],
      rows: data.rows.slice(0, MAIN_ROW_LIMIT).map((r) => ({
        _id: r.key,
        tier: r.tier ?? '—',
        name: r.name,
        kind: KIND_LABELS[r.kind],
        value: r.value,
        share: r.share,
        cumulative: r.cumulative,
        status: rowStatus(r, true),
      })),
      totals: {
        tier: null,
        name: 'Положительная база ABC',
        kind: null,
        value: data.totals.positive_value,
        share: data.totals.positive_value > 0 ? 100 : null,
        cumulative: null,
        status: null,
      },
      truncated: data.rows.length > MAIN_ROW_LIMIT,
      sections: [
        {
          key: 'abc-tiers',
          title: 'Классы ABC',
          description:
            'Ориентиры долей: A — 80%, B — следующие 15%, C — остаток. Позиции и равные значения не делятся между классами.',
          columns: [
            { key: 'tier', title: 'Класс', type: 'text' },
            { key: 'count', title: 'Позиций', type: 'int' },
            { key: 'value', title: valueTitle, type: 'money' },
            { key: 'share', title: 'Доля базы', type: 'percent' },
          ],
          rows: (['A', 'B', 'C'] as const).map(
            (tier) => data.tiers.find((r) => r.tier === tier) ?? { tier, count: 0, value: 0, share: 0 },
          ),
        },
        ...sections(data, ctx, gross).filter((s) => s.key !== 'timeline'),
      ],
      notes: [
        'Класс определяется долей, накопленной перед позицией: до 80% — A, до 95% — B, затем C. Лидер всегда A. Равный вклад получает один класс; «Накоплено» включает всю группу равных. Поэтому фактические доли могут отличаться от 80/15/5.',
        'Нулевой и отрицательный вклад не увеличивает базу ABC и показан без класса. Неизвестная себестоимость исключает позицию из ABC по валовой прибыли, но не из ABC по выручке.',
        ...(gross ? [grossHint + '. У услуг вклад равен выручке до зарплаты; это не чистая прибыль услуги.'] : []),
        ...analysisNotes(data),
      ],
    };
  }
}
