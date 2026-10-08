import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../database.module';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { actorPointId, pointCacheSegment } from '../../common/point-scope';
import { ttlCache } from '../../common/ttl-cache';
import { getTenantTimezone, zonedDateKey } from '../../common/timezone';
import { assignedToPointSql } from '../../users/user-points-sql';
import {
  FILTER_KIND_LABELS,
  getReportDefinition,
  isFilterKind,
  isReportId,
  REPORT_CATALOG,
  ReportDefinition,
} from './catalog';
import { reportAvailability, salaryReportSelfOnly } from './report-access';
import { BuiltReport, MAIN_ROW_LIMIT, ReportBuilder, ReportContext } from './report-context';
import { daysInclusive } from './report-sql';
import {
  ReportCatalogResponse,
  ReportFilterKind,
  ReportFilterOption,
  ReportFilterOptions,
  ReportId,
  ReportResult,
} from './report-types';
import { ReportQueryDto } from './dto/report-query.dto';
import { SummaryBuilder } from './builders/summary.builder';
import { MastersBuilder } from './builders/masters.builder';
import { SalaryBuilder } from './builders/salary.builder';
import { SuppliersBuilder } from './builders/suppliers.builder';
import { ClientsBuilder } from './builders/clients.builder';
import { ProductsBuilder } from './builders/products.builder';
import { ServicesBuilder } from './builders/services.builder';
import { PaymentsBuilder } from './builders/payments.builder';
import { ExpensesBuilder } from './builders/expenses.builder';
import { BookingsBuilder } from './builders/bookings.builder';
import { PointsBuilder } from './builders/points.builder';

/** Максимальная длина периода в днях — зеркало REPORT_MAX_DAYS из shared/reports/catalog.ts. */
export const REPORT_MAX_DAYS = 366;

/** Кэш результата отчёта: 30 с, как у остальных отчётных агрегатов. */
const REPORT_CACHE_TTL_MS = 30_000;

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const ROLE_LABELS: Record<string, string> = {
  master: 'мастер',
  admin: 'администратор',
  director: 'директор',
  superadmin: 'владелец платформы',
};

/**
 * Диспетчер конструктора отчётов: валидация периода, проверка доступа (те же
 * правила, что в каталоге), кэш 30 с и вызов билдера. Сами цифры — в
 * builders/*, здесь только «кто, за что и в каком скоупе».
 *
 * Ключ кэша — `reports-builder:<tenant>:<point>:<user>:<reportId>:<params>`.
 * Инвалидация финансовых изменений через reports-cache.ts сбрасывает также
 * этот префикс в пределах тенанта. TTL остаётся страховкой для остальных
 * изменений. Сегмент филиала стоит сразу после тенанта.
 */
@Injectable()
export class ReportBuilderService {
  private readonly builders: Map<ReportId, ReportBuilder>;

  constructor(
    @Inject(PG_POOL) private pool: Pool,
    summary: SummaryBuilder,
    masters: MastersBuilder,
    salary: SalaryBuilder,
    suppliers: SuppliersBuilder,
    clients: ClientsBuilder,
    products: ProductsBuilder,
    services: ServicesBuilder,
    payments: PaymentsBuilder,
    expenses: ExpensesBuilder,
    bookings: BookingsBuilder,
    points: PointsBuilder,
  ) {
    const list: ReportBuilder[] = [
      summary,
      masters,
      salary,
      suppliers,
      clients,
      products,
      services,
      payments,
      expenses,
      bookings,
      points,
    ];
    this.builders = new Map(list.map((b) => [b.id, b]));
  }

  // ── Каталог ────────────────────────────────────────────────────────────────

  async catalog(actor: JwtPayload): Promise<ReportCatalogResponse> {
    const pointsCount = await this.activePointsCount(actor.tenantID);
    return {
      reports: REPORT_CATALOG.map((def) => {
        const a = reportAvailability(actor, def, pointsCount);
        return { id: def.id, available: a.available, reason: a.available ? null : (a.reason ?? null) };
      }),
    };
  }

  // ── Фильтры ────────────────────────────────────────────────────────────────

  async filterOptions(actor: JwtPayload, kindRaw: string): Promise<ReportFilterOptions> {
    if (!isFilterKind(kindRaw)) throw new NotFoundException({ message: 'Такого фильтра нет' });
    const kind: ReportFilterKind = kindRaw;
    // Фильтр доступен тому, кому доступен хотя бы один отчёт с этим фильтром —
    // иначе список поставщиков/сотрудников утекал бы мимо прав отчётов.
    const pointsCount = await this.activePointsCount(actor.tenantID);
    const usable = REPORT_CATALOG.filter((d) => d.entityFilter?.kind === kind);
    const allowed = usable.find((d) => reportAvailability(actor, d, pointsCount).available);
    if (!allowed) {
      const reason = usable.map((d) => reportAvailability(actor, d, pointsCount).reason).find(Boolean);
      throw new ForbiddenException({ message: reason ?? 'Недостаточно прав для этого действия' });
    }
    const pointId = actorPointId(actor);
    const tz = await getTenantTimezone(this.pool, actor.tenantID);
    // Сотрудники — фильтр зарплатного отчёта. Охват «только свои» (без
    // salary_view_all) не должен видеть штат вообще: в списке он один, выбор
    // единственный (multi=false) — клиенты прячут фильтр при ≤ 1 опции.
    const selfOnly = kind === 'employees' && salaryReportSelfOnly(actor);
    let options: ReportFilterOption[];
    switch (kind) {
      case 'masters':
        options = await this.masterOptions(actor.tenantID, pointId, tz);
        break;
      case 'employees':
        options = selfOnly
          ? await this.selfOption(actor.tenantID, actor.userID, tz)
          : await this.employeeOptions(actor.tenantID, pointId, tz);
        break;
      case 'suppliers':
        options = await this.supplierOptions(actor.tenantID);
        break;
      case 'points':
        options = await this.pointOptions(actor.tenantID);
        break;
    }
    return { kind, label: FILTER_KIND_LABELS[kind], multi: !selfOnly, options };
  }

  /**
   * Мастера: роль «мастер» + все, у кого за последние 12 месяцев есть чеки как
   * у мастера (уволенные — с пометкой). В скоупе филиала — назначенные на
   * филиал (user_points, тот же предикат, что у графика и пикера Кассы) + те,
   * у кого чеки в этом филиале.
   */
  private async masterOptions(tenantId: string, pointId: string | null, tz: string): Promise<ReportFilterOption[]> {
    const params: unknown[] = [tenantId];
    // assignedToPointSql возвращает фрагмент с ведущим ` AND ` — здесь он
    // нужен как множитель внутри скобок, поэтому префикс снимаем.
    const assigned = assignedToPointSql('u', '$1', pointId, params).replace(/^ AND /, '');
    const chPoint = pointId ? ` AND ch.point_id = $${params.length}` : '';
    const { rows } = await this.pool.query(
      `SELECT u.id, u.full_name, u.role, u.dismissed_at
         FROM users u
        WHERE u.tenant_id = $1 AND u.purged_at IS NULL
          AND ((u.role = 'master'${assigned ? ` AND ${assigned}` : ''})
               OR EXISTS (SELECT 1 FROM checks ch
                           WHERE ch.tenant_id = $1 AND ch.master_id = u.id AND ch.deleted_at IS NULL
                             AND ch.date >= now() - interval '12 months'${chPoint}))
        ORDER BY (u.dismissed_at IS NOT NULL), lower(u.full_name)`,
      params,
    );
    return rows.map((r) => this.userOption(r, tz));
  }

  /** Сотрудники: все люди тенанта, включая уволенных; в скоупе филиала — назначенные + с чеками в филиале. */
  private async employeeOptions(tenantId: string, pointId: string | null, tz: string): Promise<ReportFilterOption[]> {
    const params: unknown[] = [tenantId];
    const assigned = assignedToPointSql('u', '$1', pointId, params).replace(/^ AND /, '');
    const scope = pointId
      ? ` AND (${assigned} OR EXISTS (SELECT 1 FROM checks ch
                 WHERE ch.tenant_id = $1 AND ch.master_id = u.id AND ch.deleted_at IS NULL
                   AND ch.date >= now() - interval '12 months' AND ch.point_id = $${params.length}))`
      : '';
    const { rows } = await this.pool.query(
      `SELECT u.id, u.full_name, u.role, u.dismissed_at
         FROM users u
        WHERE u.tenant_id = $1 AND u.purged_at IS NULL AND u.role <> 'superadmin'${scope}
        ORDER BY (u.dismissed_at IS NOT NULL), lower(u.full_name)`,
      params,
    );
    return rows.map((r) => this.userOption(r, tz));
  }

  /** Только сам актор — для охвата «свои» у фильтра сотрудников. */
  private async selfOption(tenantId: string, userId: string, tz: string): Promise<ReportFilterOption[]> {
    const { rows } = await this.pool.query(
      `SELECT u.id, u.full_name, u.role, u.dismissed_at
         FROM users u
        WHERE u.tenant_id = $1 AND u.id = $2 AND u.purged_at IS NULL`,
      [tenantId, userId],
    );
    return rows.map((r) => this.userOption(r, tz));
  }

  private userOption(r: any, tz: string): ReportFilterOption {
    let sublabel = ROLE_LABELS[String(r.role)] ?? String(r.role ?? '');
    if (r.dismissed_at) {
      const key = zonedDateKey(new Date(r.dismissed_at), tz);
      sublabel = `уволен ${key.slice(8, 10)}.${key.slice(5, 7)}.${key.slice(0, 4)}`;
    }
    return { id: String(r.id), label: String(r.full_name ?? '—'), sublabel };
  }

  private async supplierOptions(tenantId: string): Promise<ReportFilterOption[]> {
    const { rows } = await this.pool.query(
      `SELECT id, name, phone, is_system FROM suppliers WHERE tenant_id = $1 ORDER BY is_system DESC, lower(name)`,
      [tenantId],
    );
    return rows.map((r) => ({
      id: String(r.id),
      label: String(r.name),
      sublabel: r.is_system ? 'системный' : r.phone ? String(r.phone) : undefined,
    }));
  }

  private async pointOptions(tenantId: string): Promise<ReportFilterOption[]> {
    const { rows } = await this.pool.query(
      `SELECT id, name, is_main FROM tenant_points WHERE tenant_id = $1 AND is_active = true
        ORDER BY is_main DESC, sort_order ASC, lower(name) ASC`,
      [tenantId],
    );
    return rows.map((r) => ({ id: String(r.id), label: String(r.name), sublabel: r.is_main ? 'основной' : undefined }));
  }

  // ── Запуск отчёта ──────────────────────────────────────────────────────────

  async run(actor: JwtPayload, reportIdRaw: string, query: ReportQueryDto): Promise<ReportResult> {
    if (!isReportId(reportIdRaw)) throw new NotFoundException({ message: 'Отчёт не найден' });
    const def = getReportDefinition(reportIdRaw);

    const pointsCount = await this.activePointsCount(actor.tenantID);
    const access = reportAvailability(actor, def, pointsCount);
    if (!access.available)
      throw new ForbiddenException({ message: access.reason ?? 'Недостаточно прав для этого отчёта' });

    const { dateFrom, dateTo, days } = this.parsePeriod(query);
    let ids = def.entityFilter ? this.parseIds(query.ids) : [];
    const groupBy = this.parseGroupBy(def, query.groupBy);

    // Зарплата с охватом «только свои» (salary.view = 'own'): человек видит
    // отчёт, но исключительно по себе — иначе право «своя зарплата» открывало
    // бы весь зарплатный лист команды. financial_reports охват НЕ расширяет
    // (см. report-access: как у GET /salary, где нужен salary_view_all).
    if (def.id === 'salary' && salaryReportSelfOnly(actor)) {
      ids = [actor.userID];
    }

    const pointId = def.id === 'points' ? null : actorPointId(actor);
    const cacheKey =
      `reports-builder:${actor.tenantID}:${pointCacheSegment(pointId)}:${actor.userID}:${def.id}` +
      `:${dateFrom}:${dateTo}:${[...ids].sort().join(',')}:${groupBy ?? ''}`;
    return ttlCache.wrap(cacheKey, REPORT_CACHE_TTL_MS, () =>
      this.compute(actor, def, { dateFrom, dateTo, days, ids, groupBy, pointId }),
    );
  }

  private async compute(
    actor: JwtPayload,
    def: ReportDefinition,
    q: {
      dateFrom: string;
      dateTo: string;
      days: number;
      ids: string[];
      groupBy: string | null;
      pointId: string | null;
    },
  ): Promise<ReportResult> {
    const builder = this.builders.get(def.id);
    if (!builder) throw new NotFoundException({ message: 'Отчёт не найден' });

    const tz = await getTenantTimezone(this.pool, actor.tenantID);
    const today = zonedDateKey(new Date(), tz);
    const [{ rows: tenantRows }, { rows: pointRows }, entityLabels] = await Promise.all([
      this.pool.query(`SELECT name FROM tenants WHERE id = $1`, [actor.tenantID]),
      q.pointId
        ? this.pool.query(`SELECT name FROM tenant_points WHERE id = $1 AND tenant_id = $2`, [
            q.pointId,
            actor.tenantID,
          ])
        : Promise.resolve({ rows: [] as any[] }),
      this.entityLabels(actor.tenantID, def, q.ids),
    ]);

    const ctx: ReportContext = {
      tenantId: actor.tenantID,
      pointId: q.pointId,
      tz,
      actor,
      companyName: String(tenantRows[0]?.name ?? ''),
      pointName: pointRows[0]?.name ? String(pointRows[0].name) : null,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      days: q.days,
      refDate: q.dateTo < today ? q.dateTo : today,
      ids: q.ids,
      groupBy: q.groupBy,
      def,
    };

    const built: BuiltReport = await builder.build(ctx);
    const groupByLabel = q.groupBy ? (def.groupByOptions?.find((o) => o.value === q.groupBy)?.label ?? null) : null;

    return {
      reportId: def.id,
      title: def.title,
      period: { from: q.dateFrom, to: q.dateTo },
      generatedAt: new Date().toISOString(),
      filters: {
        entityIds: q.ids,
        entityLabels,
        groupBy: q.groupBy,
        groupByLabel,
        ...(built.filters ?? {}),
      },
      kpis: built.kpis,
      columns: built.columns,
      rows: built.rows,
      totals: built.totals ?? null,
      sections: built.sections ?? [],
      notes: built.notes ?? [],
      meta: {
        pointName: def.id === 'points' ? null : ctx.pointName,
        scope: def.id === 'points' || !q.pointId ? 'all' : 'point',
        truncated: !!built.truncated,
        rowLimit: MAIN_ROW_LIMIT,
        companyName: ctx.companyName,
      },
    };
  }

  // ── Валидация запроса ──────────────────────────────────────────────────────

  private parsePeriod(query: ReportQueryDto): { dateFrom: string; dateTo: string; days: number } {
    const dateFrom = this.parseDate(query.dateFrom, 'Дата начала');
    const dateTo = this.parseDate(query.dateTo, 'Дата окончания');
    if (dateFrom > dateTo) throw new BadRequestException({ message: 'Дата начала позже даты окончания' });
    const days = daysInclusive(dateFrom, dateTo);
    if (days > REPORT_MAX_DAYS) {
      throw new BadRequestException({ message: `Период не может быть длиннее ${REPORT_MAX_DAYS} дней` });
    }
    return { dateFrom, dateTo, days };
  }

  private parseDate(value: unknown, label: string): string {
    if (typeof value !== 'string' || value.length === 0) {
      throw new BadRequestException({ message: 'Укажите период отчёта' });
    }
    if (!ISO_DATE_RE.test(value)) throw new BadRequestException({ message: `${label}: формат ГГГГ-ММ-ДД` });
    const ts = Date.parse(`${value}T00:00:00Z`);
    if (Number.isNaN(ts) || new Date(ts).toISOString().slice(0, 10) !== value) {
      throw new BadRequestException({ message: `${label}: такой даты нет` });
    }
    return value;
  }

  private parseIds(raw: string | undefined): string[] {
    if (!raw) return [];
    const ids = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const id of ids) {
      if (!UUID_RE.test(id)) throw new BadRequestException({ message: 'Фильтр: неверный идентификатор' });
    }
    return [...new Set(ids)];
  }

  private parseGroupBy(def: ReportDefinition, raw: string | undefined): string | null {
    const options = def.groupByOptions;
    if (!options || options.length === 0) return null;
    if (!raw) return options[0].value;
    if (!options.some((o) => o.value === raw)) {
      throw new BadRequestException({ message: 'Неизвестная группировка' });
    }
    return raw;
  }

  // ── Справочные запросы ─────────────────────────────────────────────────────

  private async activePointsCount(tenantId: string): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT COUNT(*)::int AS cnt FROM tenant_points WHERE tenant_id = $1 AND is_active = true`,
      [tenantId],
    );
    return Number(rows[0]?.cnt) || 0;
  }

  /** Подписи выбранных сущностей — для шапки экспорта и заголовка экрана. */
  private async entityLabels(tenantId: string, def: ReportDefinition, ids: string[]): Promise<string[]> {
    if (ids.length === 0 || !def.entityFilter) return [];
    const kind = def.entityFilter.kind;
    const sql =
      kind === 'suppliers'
        ? `SELECT id, name AS label FROM suppliers WHERE tenant_id = $1 AND id = ANY($2::uuid[])`
        : kind === 'points'
          ? `SELECT id, name AS label FROM tenant_points WHERE tenant_id = $1 AND id = ANY($2::uuid[])`
          : `SELECT id, full_name AS label FROM users WHERE tenant_id = $1 AND id = ANY($2::uuid[])`;
    const { rows } = await this.pool.query(sql, [tenantId, ids]);
    const byId = new Map(rows.map((r) => [String(r.id), String(r.label ?? '—')]));
    return ids.map((id) => byId.get(id) ?? '—');
  }
}
