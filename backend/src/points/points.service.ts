import {
  Injectable,
  Inject,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../database.module';
import { userHasPermission } from '../common/guards/permissions.guard';
import { JwtPayload } from '../common/decorators/current-user.decorator';
import { invalidateAuthUser } from '../common/auth-cache';
import { ttlCache } from '../common/ttl-cache';
import { getTenantTimezone, startOfDayInZone, startOfMonthInZone, zonedMonthKey } from '../common/timezone';
import { checkMoneyBaseWhere, checkProfitExpr, checkRevenueExpr } from '../common/check-money-sql';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Мульти-точки (миграция 156, tenant_points): несколько автосервисов у одного
 * тенанта. Точки заводит ТОЛЬКО суперадмин из ЛК (их количество и есть лимит);
 * тенант переключается между точками и назначает сотрудников на точки.
 * 0 или 1 точка = одноточечный режим, UI ничего не показывает.
 * НЕ путать с tenant_locations («места» внутри двора, Round 14).
 */
@Injectable()
export class PointsService {
  constructor(@Inject(PG_POOL) private pool: Pool) {}

  private mapPoint(row: any) {
    return {
      id: row.id,
      name: row.name,
      address: row.address ?? null,
      sortOrder: typeof row.sort_order === 'number' ? row.sort_order : parseInt(row.sort_order, 10) || 0,
      isActive: !!row.is_active,
      createdAt: row.created_at,
    };
  }

  // ── Тенант-сторона ──────────────────────────────────────────────────────

  /**
   * Точки своего тенанта для приложения: живые точки + назначения сотрудников
   * (memberIds — для экрана управления) + текущая точка запрашивающего.
   */
  async listForTenant(user: JwtPayload) {
    const [{ rows: points }, { rows: members }, { rows: me }] = await Promise.all([
      this.pool.query(
        `SELECT * FROM tenant_points WHERE tenant_id=$1 AND is_active=true
         ORDER BY sort_order ASC, lower(name) ASC`,
        [user.tenantID],
      ),
      this.pool.query(`SELECT user_id, point_id FROM user_points WHERE tenant_id=$1`, [user.tenantID]),
      this.pool.query(`SELECT current_point_id FROM users WHERE id=$1 AND tenant_id=$2`, [user.userID, user.tenantID]),
    ]);
    const byPoint = new Map<string, string[]>();
    for (const m of members) {
      const list = byPoint.get(m.point_id) ?? [];
      list.push(m.user_id);
      byPoint.set(m.point_id, list);
    }

    // ── Филиал обязателен для сотрудника (решение владельца) ──────────────
    // Режим «Все точки» (current_point_id = NULL) сохраняется ТОЛЬКО за
    // держателем user_management — владельцем/админом, которому нужна сводка
    // по сети, и это его осознанный выбор.
    //
    // ВОЛНА 4 — САМЫЙ ОПАСНЫЙ ДЕФОЛТ, КОТОРЫЙ ЗДЕСЬ БЫЛ. Раньше точка
    // подставлялась, только когда доступна РОВНО ОДНА. Сотрудник без
    // назначений в тенанте с двумя и более точками оставался с пустым
    // скоупом — а пустой скоуп на чтении означает «фильтра нет», то есть
    // мастер видел журнал, кассу и деньги ВСЕЙ СЕТИ. Теперь берём ПЕРВУЮ
    // доступную (порядок пикера: sort_order, затем имя): произвольность
    // безопасна и обратима (сотрудник переключится сам), а «видно всё» —
    // нет. Держателя user_management это по-прежнему не касается.
    //
    // Почему запись выполняется на чтении: точку резолвит ровно один запрос
    // (GET /points на старте приложения), а не каждый хоп. Операция
    // идемпотентна (второй раз условие уже не выполняется) и обязательно
    // сбрасывает auth-кеш — иначе актор до 30 секунд ходил бы без точки.
    // Доступные точки берём из УЖЕ загруженных данных: есть назначения на
    // ЖИВЫЕ точки — только они; нет ни одного (в том числе когда все
    // назначения ведут на архивные точки) — все живые точки тенанта
    // (безопасный дефолт 156, тот же, что в resolvePointForWrite).
    let currentPointId: string | null = me[0]?.current_point_id ?? null;
    if (currentPointId === null && !userHasPermission(user, 'user_management')) {
      const mine = members.filter((m) => m.user_id === user.userID).map((m) => m.point_id as string);
      const assigned = points.filter((p) => mine.includes(p.id));
      const available = assigned.length > 0 ? assigned : points;
      if (available.length > 0) {
        const chosen = available[0].id as string;
        await this.pool.query(`UPDATE users SET current_point_id=$1 WHERE id=$2 AND tenant_id=$3`, [
          chosen,
          user.userID,
          user.tenantID,
        ]);
        invalidateAuthUser(user.userID);
        currentPointId = chosen;
      }
    }

    return {
      points: points.map((p) => ({ ...this.mapPoint(p), memberIds: byPoint.get(p.id) ?? [] })),
      currentPointId,
    };
  }

  /**
   * Переключить свою текущую точку. null = сбросить («все точки» у владельца).
   * Держатель user_management (owner-class/админ) переключается свободно;
   * остальные (мастера) — только на назначенные им точки; сотрудник БЕЗ
   * назначений не ограничен (безопасный дефолт внедрения).
   */
  async switchPoint(user: JwtPayload, pointId: string | null) {
    let effectivePointId = pointId;
    if (pointId !== null) {
      if (!UUID_RE.test(pointId)) throw new BadRequestException({ message: 'Точка не найдена' });
      const { rows } = await this.pool.query(
        `SELECT id FROM tenant_points WHERE id=$1 AND tenant_id=$2 AND is_active=true`,
        [pointId, user.tenantID],
      );
      if (rows.length === 0) throw new NotFoundException({ message: 'Точка не найдена' });

      if (!userHasPermission(user, 'user_management')) {
        const { rows: mine } = await this.pool.query(
          `SELECT point_id FROM user_points WHERE user_id=$1 AND tenant_id=$2`,
          [user.userID, user.tenantID],
        );
        const allowed = mine.length === 0 || mine.some((r) => r.point_id === pointId);
        if (!allowed) throw new ForbiddenException({ message: 'Вы не назначены на эту точку' });
      }
    } else if (!userHasPermission(user, 'user_management')) {
      // Сброс в «Все точки» — привилегия владельца/админа. Сотруднику филиал
      // обязателен, поэтому сброс молча схлопывается в ПЕРВУЮ доступную точку
      // (тот же резолв, что в listForTenant), а не оставляет мастера с сетевым
      // срезом чужих денег. Волна 4: раньше схлопывание работало только при
      // РОВНО ОДНОЙ доступной точке — у мастера с двумя филиалами сброс
      // проходил как есть, и до следующего GET /points он видел всю сеть.
      const fallback = await this.defaultPointForMember(user);
      if (fallback) effectivePointId = fallback;
    }
    await this.pool.query(`UPDATE users SET current_point_id=$1 WHERE id=$2 AND tenant_id=$3`, [
      effectivePointId,
      user.userID,
      user.tenantID,
    ]);
    // КРИТИЧНО: точка едет в акторе из auth-кеша (30 с). Без сброса кеша
    // сразу после переключения филиала сервер ещё полминуты фильтровал бы
    // журнал, кассу и отчёты по СТАРОЙ точке — владелец видит чужие деньги и
    // считает это потерей своих.
    invalidateAuthUser(user.userID);
    return { currentPointId: effectivePointId };
  }

  /**
   * ПЕРВАЯ доступная сотруднику живая точка либо null (у тенанта живых точек
   * нет вовсе). Назначения на живые точки есть — выбираем из них, нет —
   * из всех живых точек тенанта (безопасный дефолт внедрения, конвенция 156).
   *
   * Порядок — как в пикере (sort_order → имя): «первая» обязана быть
   * детерминированной, иначе два параллельных запроса поставили бы сотруднику
   * разные филиалы. Это тот же выбор, что делает listForTenant по уже
   * загруженным данным, и та же конвенция доступности, что у денежной записи
   * (common/point-scope.resolvePointForWrite).
   */
  private async defaultPointForMember(user: JwtPayload): Promise<string | null> {
    const { rows } = await this.pool.query(
      `WITH live AS (
         SELECT p.id, p.sort_order, p.name
           FROM tenant_points p
          WHERE p.tenant_id = $1 AND p.is_active = true
       ),
       mine AS (
         SELECT l.* FROM live l
          WHERE EXISTS (SELECT 1 FROM user_points up
                         WHERE up.point_id = l.id AND up.user_id = $2 AND up.tenant_id = $1)
       )
       SELECT id FROM (
         SELECT * FROM mine
         UNION ALL
         SELECT * FROM live WHERE NOT EXISTS (SELECT 1 FROM mine)
       ) available
        ORDER BY sort_order ASC, lower(name) ASC
        LIMIT 1`,
      [user.tenantID, user.userID],
    );
    return rows.length === 1 ? (rows[0].id as string) : null;
  }

  /**
   * Заменить состав сотрудников точки (user_management). Пустой массив =
   * никто не назначен явно; сотрудники без назначений не ограничены.
   *
   * ВОЛНА 4 — СНЯТИЕ С ФИЛИАЛА ОБЯЗАНО ВЫГНАТЬ ИЗ НЕГО. Раньше метод правил
   * только user_points: снятый мастер продолжал сидеть в
   * users.current_point_id снятого филиала и до тридцати секунд ещё и в
   * auth-кеше — то есть работал (и пробивал чеки) там, откуда его убрали.
   * Сбрасываем точку тем же паттерном, что adminArchive: UPDATE ... RETURNING
   * id + invalidateAuthUser ПОСЛЕ коммита (откат не должен оставлять пустой
   * кеш при неснятом назначении). Следующий GET /points подставит сотруднику
   * первую доступную точку — «Все точки» он не получает.
   */
  async setMembers(tenantID: string, pointId: string, userIds: string[]) {
    if (!UUID_RE.test(pointId)) throw new NotFoundException({ message: 'Точка не найдена' });
    const clean = [...new Set((userIds ?? []).filter((id) => typeof id === 'string' && UUID_RE.test(id)))];
    const client = await this.pool.connect();
    let resetUserIds: string[] = [];
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(`SELECT id FROM tenant_points WHERE id=$1 AND tenant_id=$2`, [
        pointId,
        tenantID,
      ]);
      if (rows.length === 0) throw new NotFoundException({ message: 'Точка не найдена' });
      const { rows: before } = await client.query(
        `SELECT user_id FROM user_points WHERE point_id=$1 AND tenant_id=$2`,
        [pointId, tenantID],
      );
      await client.query(`DELETE FROM user_points WHERE point_id=$1 AND tenant_id=$2`, [pointId, tenantID]);
      if (clean.length > 0) {
        // Только сотрудники СВОЕГО тенанта — чужие id молча отбрасываются JOIN'ом.
        await client.query(
          `INSERT INTO user_points (user_id, point_id, tenant_id)
           SELECT u.id, $1, $2 FROM users u WHERE u.tenant_id=$2 AND u.id = ANY($3::uuid[])
           ON CONFLICT DO NOTHING`,
          [pointId, tenantID, clean],
        );
      }
      // Снятые = были в составе и не остались в нём. Точку обнуляем ТОЛЬКО тем,
      // кто прямо сейчас сидит в этом филиале: снятый сотрудник, работающий на
      // другой точке, трогаться не должен.
      const removed = before.map((r) => r.user_id as string).filter((id) => !clean.includes(id));
      if (removed.length > 0) {
        const { rows: reset } = await client.query(
          `UPDATE users SET current_point_id=NULL
            WHERE tenant_id=$1 AND current_point_id=$2 AND id = ANY($3::uuid[])
            RETURNING id`,
          [tenantID, pointId, removed],
        );
        resetUserIds = reset.map((r) => r.id as string);
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    // Тем же основанием, что switchPoint и adminArchive: точка живёт в
    // auth-кеше (30 с), и без сброса снятый сотрудник ещё полминуты пишет чеки
    // в филиал, из которого его только что убрали.
    for (const id of resetUserIds) invalidateAuthUser(id);
    const { rows: after } = await this.pool.query(
      `SELECT user_id FROM user_points WHERE point_id=$1 AND tenant_id=$2`,
      [pointId, tenantID],
    );
    return { memberIds: after.map((r) => r.user_id) };
  }

  // ── Сводка по филиалам ──────────────────────────────────────────────────

  /**
   * Карточки раздела «Филиалы»: на каждую ЖИВУЮ точку — оборот за день, оборот
   * за месяц, прибыль за месяц, число чеков (день и месяц) и сколько мастеров
   * сейчас на работе.
   *
   * ПРАВИЛА ДЕНЕГ — ОДИН В ОДИН с главным дашбордом (checks.getDashboard) и
   * dashboard-v2 (reports.computeDashboardV2): формулы не скопированы, а взяты
   * из общего модуля common/check-money-sql.ts, поэтому разъехаться физически
   * не могут. Гарантия исключена из выручки и заменена реальным убытком; в
   * расчёт входят только проведённые живые чеки (is_deferred=false AND
   * deleted_at IS NULL); границы дня и месяца — в поясе ТЕНАНТА (157), а не
   * в UTC процесса.
   *
   * `profitMonth` — ЧИСТАЯ прибыль филиала: прибыль по чекам МИНУС расходы
   * этого филиала за тот же месяц. Раньше расходы не вычитались, и владелец
   * видел на карточке филиала 400 000, а на главной под тем же названием
   * «Прибыль за месяц» — 150 000: две разные метрики с одним именем, из-за
   * которых нельзя было доверять ни одной. Теперь обе считаются по одному
   * определению (netProfitMonth из dashboard-v2), поэтому сходятся до рубля.
   *
   * ПРИБЫЛЬ ВИДИТ ТОЛЬКО ДЕРЖАТЕЛЬ profit_view — как и в чеке/дашборде.
   * Зануляем на КОПИИ: кеш общий на тенанта, мутация закэшированного объекта
   * обнулила бы прибыль и следом пришедшему владельцу.
   *
   * КЕШ 30 с. Ключ начинается с `reports:` и содержит tenantID, поэтому его
   * чистит та же invalidateReportsForTenant, что и остальные агрегаты: чек
   * пробили — карточка филиала обновилась сразу, а не через полминуты.
   * Сегмент точки в ключе не нужен — ответ и так содержит ВСЕ точки тенанта.
   */
  async summaryForTenant(user: JwtPayload) {
    const data = await ttlCache.wrap(`reports:points-summary:${user.tenantID}`, 30_000, () =>
      this.computeSummary(user.tenantID),
    );
    if (userHasPermission(user, 'profit_view')) return data;
    return { points: data.points.map((p) => ({ ...p, profitMonth: 0 })) };
  }

  private async computeSummary(tenantID: string) {
    const tz = await getTenantTimezone(this.pool, tenantID);
    const now = new Date();
    const dayStart = startOfDayInZone(tz, now).toISOString();
    const monthStart = startOfMonthInZone(tz, now).toISOString();

    // 161 — «мастеров на работе»: у смен появился филиал (shifts.point_id),
    // поэтому считаем по НИМ, а не по всему тенанту. Открытая смена сегодняшней
    // БИЗНЕС-даты (пояс тенанта, как в schedule.getToday и shift-auto-close) —
    // ровно тот же факт «человек на работе», что показывает график.
    //
    // УЧЁТ СМЕН ВЫКЛЮЧЕН (tenants.shifts_enabled, дефолт false) → null, а НЕ 0:
    // источника факта нет, и «0» читалось бы как «сегодня никто не вышел» —
    // владелец начал бы искать несуществующую проблему. Карточка на null
    // рисует прочерк.
    const { rows: tRows } = await this.pool.query(`SELECT shifts_enabled FROM tenants WHERE id = $1`, [tenantID]);
    const shiftsEnabled = tRows[0]?.shifts_enabled === true;
    const onShiftByPoint = new Map<string, number>();
    if (shiftsEnabled) {
      const { rows: shiftRows } = await this.pool.query(
        `SELECT s.point_id, COUNT(DISTINCT s.user_id)::int AS on_shift
           FROM shifts s
           JOIN users u ON u.id = s.user_id AND u.tenant_id = s.tenant_id
          WHERE s.tenant_id = $1
            AND s.closed_at IS NULL
            AND s.date = (now() AT TIME ZONE $2::text)::date
            AND s.point_id IS NOT NULL
            AND u.role IN ('master', 'admin')
            AND u.is_active = true AND u.dismissed_at IS NULL AND u.purged_at IS NULL
          GROUP BY s.point_id`,
        [tenantID, tz],
      );
      for (const r of shiftRows) onShiftByPoint.set(r.point_id as string, parseInt(r.on_shift, 10) || 0);
    }

    // Расходы филиала за ТЕКУЩИЙ МЕСЯЦ — тем же определением, что
    // reports.computeDashboardV2 (иначе «Прибыль за месяц» на карточке филиала
    // и на главной снова разъедутся):
    //   • отнесение к месяцу — по effective-месяцу COALESCE(period_month,
    //     месяц даты факта в поясе тенанта), а не по голой дате: выплата
    //     5 сентября «за август» режет август, а не сентябрь;
    //   • только approved (NULL у легаси = approved);
    //   • без категории «Зарплата» — зарплатное начисление уже сидит внутри
    //     per-check profit, и вычесть выплату ещё раз значило бы списать труд
    //     дважды.
    // Отдельным запросом, а не подзапросом в LEFT JOIN ниже: расход к чеку
    // отношения не имеет, и join по точке размножил бы строки чеков.
    const monthKey = zonedMonthKey(now, tz);
    const { rows: expRows } = await this.pool.query(
      `SELECT e.point_id,
              COALESCE(SUM(e.amount), 0) AS total
         FROM expenses e
         LEFT JOIN expense_categories ec ON ec.id = e.category_id
        WHERE e.tenant_id = $1
          AND e.point_id IS NOT NULL
          AND COALESCE(e.period_month, to_char(e.date AT TIME ZONE $2::text, 'YYYY-MM')) = $3
          AND COALESCE(e.approval_status, 'approved') = 'approved'
          AND COALESCE(ec.name, '') <> 'Зарплата'
        GROUP BY e.point_id`,
      [tenantID, tz, monthKey],
    );
    const expenseByPoint = new Map<string, number>();
    for (const r of expRows) expenseByPoint.set(r.point_id as string, parseFloat(r.total) || 0);

    const revenue = checkRevenueExpr('ch');
    const profit = checkProfitExpr('ch');
    // LEFT JOIN, а не подзапросы: точка без единого чека обязана вернуться
    // строкой с нулями (карточка филиала существует и до первой продажи).
    const { rows } = await this.pool.query(
      `SELECT p.id, p.name,
              COALESCE(SUM(CASE WHEN ch.date >= $2 THEN (${revenue}) END), 0) AS revenue_today,
              COALESCE(SUM(CASE WHEN ch.date >= $3 THEN (${revenue}) END), 0) AS revenue_month,
              COALESCE(SUM(CASE WHEN ch.date >= $3 THEN (${profit}) END), 0) AS profit_month,
              COUNT(ch.id) FILTER (WHERE ch.date >= $2) AS checks_today,
              COUNT(ch.id) FILTER (WHERE ch.date >= $3) AS checks_month
         FROM tenant_points p
         LEFT JOIN checks ch
                ON ch.point_id = p.id AND ch.tenant_id = p.tenant_id
               AND ${checkMoneyBaseWhere('ch')}
        WHERE p.tenant_id = $1 AND p.is_active = true
        GROUP BY p.id, p.name, p.sort_order
        ORDER BY p.sort_order ASC, lower(p.name) ASC`,
      [tenantID, dayStart, monthStart],
    );

    return {
      points: rows.map((r) => ({
        pointId: r.id as string,
        name: r.name as string,
        revenueToday: parseFloat(r.revenue_today) || 0,
        revenueMonth: parseFloat(r.revenue_month) || 0,
        // ЧИСТАЯ прибыль филиала = прибыль по чекам − расходы этого филиала за
        // месяц. Минус здесь — норма, а не баг: филиал с большой постоянкой и
        // слабой выручкой месяц и правда закрывает в убыток, и увидеть это
        // владелец обязан именно на карточке филиала.
        profitMonth: (parseFloat(r.profit_month) || 0) - (expenseByPoint.get(r.id as string) ?? 0),
        checksToday: parseInt(r.checks_today, 10) || 0,
        checksMonth: parseInt(r.checks_month, 10) || 0,
        // 161 — сколько мастеров/админов филиала прямо сейчас в открытой смене.
        // null = учёт смен у тенанта выключен (источника факта нет — прочерк);
        // 0 = учёт включён и сегодня действительно никто не открыл смену.
        mastersOnShift: (shiftsEnabled ? (onShiftByPoint.get(r.id as string) ?? 0) : null) as number | null,
      })),
    };
  }

  // ── Суперадмин (ЛК, admin-пул) ──────────────────────────────────────────

  /** Все точки тенанта (живые + архив) для карточки тенанта в ЛК. */
  async adminList(tenantId: string) {
    const { rows } = await this.pool.query(
      `SELECT * FROM tenant_points WHERE tenant_id=$1 ORDER BY is_active DESC, sort_order ASC, lower(name) ASC`,
      [tenantId],
    );
    return rows.map((r) => this.mapPoint(r));
  }

  /**
   * Таблицы, чью историю без филиала прибивает к ПЕРВОЙ живой точке тенанта.
   * Состав и условие — дословно из миграций 160 (checks, clients) и 161
   * (остальные денежные модули). Список общий с миграциями сознательно: если
   * у таблицы появится point_id, её надо добавить в ОБА места, иначе тенант,
   * которому точку заводят сегодня, увидит по этой таблице пустоту.
   */
  private static readonly HISTORY_TABLES = [
    'checks',
    'clients',
    'shifts',
    'expenses',
    'cash_shifts',
    'salary_payouts',
    'salary_premiums',
    'salary_penalties',
    'salary_payments',
  ] as const;

  /**
   * Создать точку тенанту (суперадмин). Дубль живого имени → 409.
   *
   * ПЕРВАЯ ЖИВАЯ ТОЧКА ЗАБИРАЕТ ВСЮ ИСТОРИЮ ТЕНАНТА. Миграции 160/161
   * прибили историю к первой живой точке только у тех тенантов, у кого точки
   * УЖЕ БЫЛИ на момент прогона. Для всех остальных этот момент наступает
   * ИМЕННО ЗДЕСЬ: суперадмин заводит первую точку, PointsService.listForTenant
   * тут же выдаёт её сотрудникам — и с этой секунды скоуп фильтрует СТРОГИМ
   * равенством (common/point-scope.pointFilterSql). Вся прежняя история
   * лежит с point_id IS NULL, поэтому без привязки автосервис одномоментно
   * теряет журнал, отчёты, зарплату, смены и расходы — выглядит это как
   * «данные пропали», а по факту это та же мина, ради которой 160 трогала
   * даже одноточечных тенантов.
   *
   * ОДНА ТРАНЗАКЦИЯ: точка и привязка коммитятся вместе. Иначе упавшая
   * посередине привязка оставила бы живую точку и полупривязанную историю —
   * состояние, из которого нет автоматического выхода.
   *
   * ТОЛЬКО ПЕРВАЯ ЖИВАЯ. У второй и последующих точек привязки нет: строки без
   * филиала к этому моменту могут родиться лишь у владельца в режиме «Все
   * точки», и утащить их в новорождённый филиал значило бы задним числом
   * переписать чужую выручку. Проверка «живых точек, кроме этой, нет» идёт
   * ВНУТРИ транзакции — она же и защита от параллельного создания.
   */
  async adminCreate(tenantId: string, dto: { name?: string; address?: string }) {
    const name = String(dto?.name ?? '').trim();
    if (!name) throw new BadRequestException({ message: 'Укажите название точки' });
    const address = String(dto?.address ?? '').trim() || null;
    const { rows: t } = await this.pool.query(`SELECT id FROM tenants WHERE id=$1`, [tenantId]);
    if (t.length === 0) throw new NotFoundException({ message: 'Тенант не найден' });
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO tenant_points (tenant_id, name, address, sort_order)
         VALUES ($1, $2, $3, COALESCE((SELECT MAX(sort_order)+1 FROM tenant_points WHERE tenant_id=$1), 0))
         RETURNING *`,
        [tenantId, name, address],
      );
      const point = rows[0];

      const { rows: others } = await client.query(
        `SELECT 1 FROM tenant_points WHERE tenant_id=$1 AND is_active=true AND id<>$2 LIMIT 1`,
        [tenantId, point.id],
      );
      if (others.length === 0) {
        for (const table of PointsService.HISTORY_TABLES) {
          // Условие — то же, что в 160/161: адресуем ТОЛЬКО строки без
          // филиала, поэтому повторный проход (или гонка с миграцией) не
          // способен «перенести» уже привязанные деньги в другой филиал.
          // Имя таблицы — литерал из приватного readonly-списка выше, снаружи
          // сюда попасть нечему; uuid уходит плейсхолдером.
          await client.query(`UPDATE ${table} SET point_id=$1 WHERE tenant_id=$2 AND point_id IS NULL`, [
            point.id,
            tenantId,
          ]);
        }
      }

      await client.query('COMMIT');
      return this.mapPoint(point);
    } catch (err: any) {
      await client.query('ROLLBACK');
      // 23505 частичного uq-индекса: живой дубль имени.
      if (err?.code === '23505') throw new ConflictException({ message: 'Точка с таким названием уже есть' });
      throw err;
    } finally {
      client.release();
    }
  }

  /** Переименовать / сменить адрес / архив-разархив (суперадмин). */
  async adminUpdate(
    tenantId: string,
    pointId: string,
    dto: { name?: string; address?: string; isActive?: boolean; sortOrder?: number },
  ) {
    const sets: string[] = [];
    const vals: any[] = [];
    let idx = 1;
    if (dto.name !== undefined) {
      const name = String(dto.name).trim();
      if (!name) throw new BadRequestException({ message: 'Укажите название точки' });
      sets.push(`name=$${idx++}`);
      vals.push(name);
    }
    if (dto.address !== undefined) {
      sets.push(`address=$${idx++}`);
      vals.push(String(dto.address ?? '').trim() || null);
    }
    if (dto.isActive !== undefined) {
      sets.push(`is_active=$${idx++}`);
      vals.push(!!dto.isActive);
    }
    if (dto.sortOrder !== undefined) {
      sets.push(`sort_order=$${idx++}`);
      vals.push(Number(dto.sortOrder) || 0);
    }
    if (sets.length === 0) {
      const list = await this.adminList(tenantId);
      const found = list.find((p) => p.id === pointId);
      if (!found) throw new NotFoundException({ message: 'Точка не найдена' });
      return found;
    }
    vals.push(pointId, tenantId);
    try {
      const { rows } = await this.pool.query(
        `UPDATE tenant_points SET ${sets.join(', ')} WHERE id=$${idx++} AND tenant_id=$${idx} RETURNING *`,
        vals,
      );
      if (rows.length === 0) throw new NotFoundException({ message: 'Точка не найдена' });
      // Архивация через PATCH — тот же архив, что и DELETE, значит и
      // последствия обязаны быть теми же: иначе сотрудники остаются
      // приколотыми к погашенной точке и продолжают штамповать в неё деньги.
      if (dto.isActive === false) await this.detachMembersFromPoint(tenantId, pointId);
      return this.mapPoint(rows[0]);
    } catch (err: any) {
      if (err?.code === '23505') throw new ConflictException({ message: 'Точка с таким названием уже есть' });
      throw err;
    }
  }

  /**
   * ПОСЛЕДСТВИЯ АРХИВАЦИИ ТОЧКИ — один хелпер на оба пути архивации
   * (DELETE /points/:id и PATCH с isActive:false).
   *
   * ПОЧЕМУ ЭТО НЕ КОСМЕТИКА. Точка гаснет, а current_point_id сотрудников
   * продолжает на неё указывать: скоуп чтения фильтрует по архивной точке
   * (пустые журнал, склад, зарплата), а денежная запись штампует в филиал,
   * которого больше нет ни в одном живом срезе — выручка проваливается ровно
   * так же, как при point_id = NULL. Поэтому сброс обязателен в ОБОИХ путях;
   * раньше он стоял только в adminArchive, и архивация через PATCH оставляла
   * сотрудников приколотыми к мёртвому филиалу.
   *
   * Сброс auth-кеша — по тому же основанию, что и в switchPoint: точка едет в
   * акторе из JwtStrategy и живёт 30 секунд, а всё это время актор писал бы
   * деньги в архив.
   */
  private async detachMembersFromPoint(tenantId: string, pointId: string) {
    const { rows: reset } = await this.pool.query(
      `UPDATE users SET current_point_id=NULL WHERE current_point_id=$1 AND tenant_id=$2 RETURNING id`,
      [pointId, tenantId],
    );
    for (const r of reset) invalidateAuthUser(r.id as string);
  }

  /**
   * «Удалить» точку = АРХИВ (is_active=false), паттерн 146: старые чеки точку
   * сохраняют, пикеры не предлагают, имя освобождается. Заодно чистим
   * current_point_id у сотрудников, чтобы никто не «застрял» на архивной точке.
   */
  async adminArchive(tenantId: string, pointId: string) {
    const { rows } = await this.pool.query(
      `UPDATE tenant_points SET is_active=false WHERE id=$1 AND tenant_id=$2 RETURNING id`,
      [pointId, tenantId],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Точка не найдена' });
    await this.detachMembersFromPoint(tenantId, pointId);
    return { success: true };
  }
}
