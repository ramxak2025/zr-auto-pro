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
import { PointScopeQueryable } from '../common/point-scope';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ФАКТЫ ТЕНАНТА ДЛЯ АТРИБУЦИИ ИСТОРИИ — дословно тот же подзапрос, что в
 * ATTRIBUTION-BLOCK миграций 161 и 162, сужённый до одного тенанта ($1):
 *   main_id      — основной сервис (uq_tenant_points_one_main гарантирует, что
 *                  он ровно один, поэтому JOIN не размножает строки);
 *   tz           — пояс тенанта (157), в нём считаются календарные месяцы;
 *                  сверяется с pg_timezone_names — `AT TIME ZONE 'мусор'`
 *                  это 22023, а у tenants.timezone нет CHECK'а;
 *   branch_since — когда у тенанта появился ПЕРВЫЙ филиал (архивные тоже
 *                  считаются). NULL = филиалов не было никогда.
 */
const MAIN_FACTS_SQL = `(
        SELECT tp.tenant_id,
               tp.id AS main_id,
               COALESCE((SELECT z.name FROM pg_timezone_names z WHERE z.name = btrim(t.timezone)),
                        'Europe/Moscow') AS tz,
               (SELECT min(b.created_at) FROM tenant_points b
                 WHERE b.tenant_id = tp.tenant_id AND b.is_main = false) AS branch_since
          FROM tenant_points tp
          JOIN tenants t ON t.id = tp.tenant_id
         WHERE tp.is_main AND tp.is_active AND tp.tenant_id = $1
       ) mp`;

/**
 * ПРИВЯЗКА ИСТОРИИ БЕЗ ФИЛИАЛА — ровно та же лестница доказательств, что в
 * миграциях 161/162 (см. ATTRIBUTION-BLOCK там: полное обоснование каждой
 * ступени и честный список того, что остаётся неточным).
 *
 * ПОЧЕМУ ЗДЕСЬ ВООБЩЕ ЛЕСТНИЦА, А НЕ «ВСЁ ОСНОВНОМУ». Миграции привязали
 * историю тем тенантам, у кого на момент прогона БЫЛА хотя бы одна ЖИВАЯ
 * точка. Остальные приходят сюда — и среди них есть тенант, у которого филиал
 * уже существовал, но был в архиве: слепое «NULL → основной сервис» отправило
 * бы августовскую кассу этого филиала на счёт основного сервиса. Это та же
 * ошибка, что чинит 161, просто на другом пути.
 *
 * ЧЕКИ И КЛИЕНТЫ идут без лестницы: их point_id завела ещё 156, филиальная
 * строка там уже помечена филиалом, поэтому оставшийся NULL честно означает
 * «строка старше филиалов» (правило 160).
 *
 * $1 — тенант. Основной сервис не передаётся параметром: подзапрос находит его
 * сам, и это гарантирует, что код и миграции смотрят на ОДНУ И ТУ ЖЕ строку.
 *
 * ПОРЯДОК ВАЖЕН: expenses идёт последним — зарплатный расход наследует филиал
 * своей выплаты (salary_payouts.expense_id / salary_payments.expense_id).
 *
 * Функции-свидетели autexa_point_by_checks / autexa_point_by_assignment
 * заводит миграция 161 (CREATE OR REPLACE, идемпотентно): один и тот же
 * предикат на три места — миграцию, ремонт и этот сервис.
 */
const HISTORY_ATTACH_SQL: ReadonlyArray<readonly [string, string]> = [
  [
    'checks',
    `UPDATE checks ch
        SET point_id = mp.main_id
       FROM ${MAIN_FACTS_SQL}
      WHERE ch.point_id IS NULL AND ch.tenant_id = mp.tenant_id`,
  ],
  [
    'clients',
    `UPDATE clients cl
        SET point_id = mp.main_id
       FROM ${MAIN_FACTS_SQL}
      WHERE cl.point_id IS NULL AND cl.tenant_id = mp.tenant_id`,
  ],
  [
    'shifts',
    `UPDATE shifts s
        SET point_id = COALESCE(
              CASE WHEN mp.branch_since IS NULL
                     OR COALESCE(s.created_at, s.opened_at) < mp.branch_since
                   THEN mp.main_id END,
              autexa_point_by_checks(s.tenant_id, s.user_id,
                                      s.date::timestamp      AT TIME ZONE mp.tz,
                                     (s.date + 1)::timestamp AT TIME ZONE mp.tz,
                                     COALESCE(s.created_at, s.opened_at)),
              autexa_point_by_assignment(s.tenant_id, s.user_id, COALESCE(s.created_at, s.opened_at)),
              mp.main_id)
       FROM ${MAIN_FACTS_SQL}
      WHERE s.point_id IS NULL AND s.tenant_id = mp.tenant_id`,
  ],
  [
    'cash_shifts',
    `UPDATE cash_shifts cs
        SET point_id = COALESCE(
              CASE WHEN mp.branch_since IS NULL
                     OR COALESCE(cs.created_at, cs.opened_at) < mp.branch_since
                   THEN mp.main_id END,
              autexa_point_by_checks(cs.tenant_id, NULL::uuid,
                                     cs.opened_at, COALESCE(cs.closed_at, now()),
                                     COALESCE(cs.created_at, cs.opened_at)),
              autexa_point_by_assignment(cs.tenant_id, cs.opened_by, COALESCE(cs.created_at, cs.opened_at)),
              autexa_point_by_assignment(cs.tenant_id, cs.closed_by, COALESCE(cs.created_at, cs.opened_at)),
              mp.main_id)
       FROM ${MAIN_FACTS_SQL}
      WHERE cs.point_id IS NULL AND cs.tenant_id = mp.tenant_id`,
  ],
  [
    'salary_payouts',
    `UPDATE salary_payouts sp
        SET point_id = COALESCE(
              CASE WHEN mp.branch_since IS NULL OR sp.created_at < mp.branch_since THEN mp.main_id END,
              autexa_point_by_month(sp.tenant_id, sp.employee_id,
                                    COALESCE(CASE WHEN sp.period_month ~ '^\\d{4}-\\d{2}$' THEN sp.period_month END,
                                             to_char(sp.created_at AT TIME ZONE mp.tz, 'YYYY-MM')),
                                    mp.tz, sp.created_at),
              autexa_point_by_assignment(sp.tenant_id, sp.employee_id, sp.created_at),
              autexa_point_by_assignment(sp.tenant_id, sp.created_by,  sp.created_at),
              mp.main_id)
       FROM ${MAIN_FACTS_SQL}
      WHERE sp.point_id IS NULL AND sp.tenant_id = mp.tenant_id`,
  ],
  [
    'salary_premiums',
    `UPDATE salary_premiums pr
        SET point_id = COALESCE(
              CASE WHEN mp.branch_since IS NULL OR pr.created_at < mp.branch_since THEN mp.main_id END,
              autexa_point_by_month(pr.tenant_id, pr.user_id,
                                    COALESCE(CASE WHEN pr.period_month_year ~ '^\\d{4}-\\d{2}$' THEN pr.period_month_year END,
                                             to_char(pr.created_at AT TIME ZONE mp.tz, 'YYYY-MM')),
                                    mp.tz, pr.created_at),
              autexa_point_by_assignment(pr.tenant_id, pr.user_id,    pr.created_at),
              autexa_point_by_assignment(pr.tenant_id, pr.awarded_by, pr.created_at),
              mp.main_id)
       FROM ${MAIN_FACTS_SQL}
      WHERE pr.point_id IS NULL AND pr.tenant_id = mp.tenant_id`,
  ],
  [
    'salary_penalties',
    `UPDATE salary_penalties pe
        SET point_id = COALESCE(
              CASE WHEN mp.branch_since IS NULL OR pe.created_at < mp.branch_since THEN mp.main_id END,
              autexa_point_by_month(pe.tenant_id, pe.user_id,
                                    to_char(COALESCE(pe.date, pe.created_at) AT TIME ZONE mp.tz, 'YYYY-MM'),
                                    mp.tz, pe.created_at),
              autexa_point_by_assignment(pe.tenant_id, pe.user_id,    pe.created_at),
              autexa_point_by_assignment(pe.tenant_id, pe.created_by, pe.created_at),
              mp.main_id)
       FROM ${MAIN_FACTS_SQL}
      WHERE pe.point_id IS NULL AND pe.tenant_id = mp.tenant_id`,
  ],
  [
    'salary_payments',
    `UPDATE salary_payments spm
        SET point_id = COALESCE(
              CASE WHEN mp.branch_since IS NULL OR spm.created_at < mp.branch_since THEN mp.main_id END,
              autexa_point_by_month(spm.tenant_id, spm.user_id,
                                    COALESCE(CASE WHEN spm.month_year ~ '^\\d{4}-\\d{2}$' THEN spm.month_year END,
                                             to_char(spm.date AT TIME ZONE mp.tz, 'YYYY-MM')),
                                    mp.tz, spm.created_at),
              autexa_point_by_assignment(spm.tenant_id, spm.user_id,    spm.created_at),
              autexa_point_by_assignment(spm.tenant_id, spm.created_by, spm.created_at),
              mp.main_id)
       FROM ${MAIN_FACTS_SQL}
      WHERE spm.point_id IS NULL AND spm.tenant_id = mp.tenant_id`,
  ],
  [
    'expenses',
    `UPDATE expenses e
        SET point_id = COALESCE(
              CASE WHEN mp.branch_since IS NULL OR e.created_at < mp.branch_since THEN mp.main_id END,
              (SELECT po.point_id FROM salary_payouts po
                WHERE po.expense_id = e.id AND po.tenant_id = e.tenant_id AND po.point_id IS NOT NULL LIMIT 1),
              (SELECT pm.point_id FROM salary_payments pm
                WHERE pm.expense_id = e.id AND pm.tenant_id = e.tenant_id AND pm.point_id IS NOT NULL LIMIT 1),
              autexa_point_by_assignment(e.tenant_id, e.user_id,    e.created_at),
              autexa_point_by_assignment(e.tenant_id, e.created_by, e.created_at),
              mp.main_id)
       FROM ${MAIN_FACTS_SQL}
      WHERE e.point_id IS NULL AND e.tenant_id = mp.tenant_id`,
  ],
];

/**
 * Имя ОСНОВНОГО сервиса берётся из tenants.name. Этот запасной вариант нужен
 * ровно для одного вырожденного случая — пустого названия компании: точка без
 * имени сломала бы и пикер, и уникальный индекс имён из 156.
 */
const MAIN_POINT_FALLBACK_NAME = 'Основной';

/**
 * Мульти-точки (миграция 156, tenant_points): несколько автосервисов у одного
 * тенанта. Точки заводит ТОЛЬКО суперадмин из ЛК (их количество и есть лимит);
 * тенант переключается между точками и назначает сотрудников на точки.
 * 0 или 1 точка = одноточечный режим, UI ничего не показывает.
 * НЕ путать с tenant_locations («места» внутри двора, Round 14).
 *
 * ОСНОВНОЙ СЕРВИС И ФИЛИАЛЫ (160). Автосервис владельца — это САМ ТЕНАНТ, его
 * название лежит в tenants.name. Всё, что суперадмин заводит сверху, —
 * дополнительно открытые филиалы. Формулировка владельца дословно: «Должен
 * быть основной сервис, он называется ZR AUTO, а филиал ТопГаз — это
 * дополнительно открытый. Это два разных автосервиса одного владельца просто».
 *
 * Отсюда инварианты, за которые отвечает этот сервис:
 *   • как только у тенанта есть хотя бы одна точка, ОСНОВНАЯ (is_main)
 *     обязана существовать — ровно одна, гарантия на уровне БД
 *     (uq_tenant_points_one_main);
 *   • вся историческая строка без филиала принадлежит основному сервису и
 *     НИКОГДА филиалу, открытому позже;
 *   • основную точку нельзя заархивировать и нельзя удалить — это сам
 *     автосервис; переименовать можно;
 *   • основная идёт ПЕРВОЙ в любом списке (ORDER BY is_main DESC, …).
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
      // Признак основного сервиса (160). Клиент по нему отличает «сам
      // автосервис» от филиала и подписывает карточку.
      isMain: !!row.is_main,
      createdAt: row.created_at,
    };
  }

  /**
   * ОСНОВНАЯ ТОЧКА ТЕНАНТА — гарантированно существует после вызова.
   * Возвращает её id.
   *
   * ПОРЯДОК ПОПЫТОК (тот же, что в миграциях 160 и 162 — расхождение между
   * кодом и миграцией означало бы, что у части тенантов основной сервис
   * называется одним, а у части другим):
   *   1. Основная уже помечена — она и есть ответ.
   *   2. Живая точка НАЗЫВАЕТСЯ КАК КОМПАНИЯ — помечаем ЕЁ. Плодить вторую
   *      «ZR AUTO» рядом с существующей «ZR AUTO» нельзя: владелец не поймёт,
   *      в какую из них смотреть, а уникальный индекс имён из 156 такую
   *      вставку и не пропустит.
   *   3. Заводим основную из tenants.name. sort_order = MIN(существующих) − 1,
   *      чтобы она шла первой даже там, где сортируют голым sort_order.
   *
   * Работает и на пуле, и на клиенте внутри транзакции — вызывающий решает,
   * с чем именно коммитить создание основной точки.
   */
  private async ensureMainPoint(db: PointScopeQueryable, tenantId: string, tenantName: unknown): Promise<string> {
    const { rows: existing } = await db.query(`SELECT id FROM tenant_points WHERE tenant_id=$1 AND is_main LIMIT 1`, [
      tenantId,
    ]);
    if (existing.length > 0) return existing[0].id as string;

    const desiredName = String(tenantName ?? '').trim() || MAIN_POINT_FALLBACK_NAME;

    const { rows: marked } = await db.query(
      `UPDATE tenant_points SET is_main=true
        WHERE id = (SELECT p.id FROM tenant_points p
                     WHERE p.tenant_id=$1 AND p.is_active=true
                       AND lower(btrim(p.name)) = lower($2::text)
                     ORDER BY p.sort_order ASC, p.created_at ASC, p.id ASC
                     LIMIT 1)
        RETURNING id`,
      [tenantId, desiredName],
    );
    if (marked.length > 0) return marked[0].id as string;

    const { rows: created } = await db.query(
      `INSERT INTO tenant_points (tenant_id, name, address, sort_order, is_active, is_main)
       VALUES ($1, $2, NULL,
               COALESCE((SELECT MIN(sort_order) FROM tenant_points WHERE tenant_id=$1), 1) - 1,
               true, true)
       RETURNING id`,
      [tenantId, desiredName],
    );
    return created[0].id as string;
  }

  // ── Тенант-сторона ──────────────────────────────────────────────────────

  /**
   * Точки своего тенанта для приложения: живые точки + назначения сотрудников
   * (memberIds — для экрана управления) + текущая точка запрашивающего.
   */
  async listForTenant(user: JwtPayload) {
    const [{ rows: points }, { rows: members }, { rows: me }] = await Promise.all([
      this.pool.query(
        // is_main DESC во главе: основной сервис — первый пункт любого списка
        // (160). Иначе владелец искал бы «ZR AUTO» где-то посреди филиалов.
        `SELECT * FROM tenant_points WHERE tenant_id=$1 AND is_active=true
         ORDER BY is_main DESC, sort_order ASC, lower(name) ASC`,
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
    // доступную (порядок пикера: основная точка, затем sort_order и имя):
    // сотрудник без назначений попадает в ОСНОВНОЙ сервис, а не в случайный
    // филиал; выбор безопасен и обратим (сотрудник переключится сам), а
    // «видно всё» — нет. Держателя user_management это по-прежнему не касается.
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
   * Порядок — как в пикере (основная → sort_order → имя): «первая» обязана
   * быть детерминированной, иначе два параллельных запроса поставили бы
   * сотруднику разные филиалы. Сотрудник без назначений попадает при этом в
   * ОСНОВНОЙ сервис, а не в случайный филиал — это и есть «его» автосервис по
   * умолчанию. Это тот же выбор, что делает listForTenant по уже
   * загруженным данным, и та же конвенция доступности, что у денежной записи
   * (common/point-scope.resolvePointForWrite).
   */
  private async defaultPointForMember(user: JwtPayload): Promise<string | null> {
    const { rows } = await this.pool.query(
      `WITH live AS (
         SELECT p.id, p.sort_order, p.name, p.is_main
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
        ORDER BY is_main DESC, sort_order ASC, lower(name) ASC
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
      `SELECT p.id, p.name, p.is_main,
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
        GROUP BY p.id, p.name, p.is_main, p.sort_order
        ORDER BY p.is_main DESC, p.sort_order ASC, lower(p.name) ASC`,
      [tenantID, dayStart, monthStart],
    );

    return {
      points: rows.map((r) => ({
        pointId: r.id as string,
        name: r.name as string,
        // Основной сервис (160) — первая карточка раздела «Филиалы». Клиент
        // подписывает её как сам автосервис, а не как один из филиалов.
        isMain: !!r.is_main,
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
      // Основная точка (160) всегда живая, поэтому is_main DESC сразу после
      // is_active DESC делает её первой строкой карточки тенанта в ЛК.
      `SELECT * FROM tenant_points WHERE tenant_id=$1
        ORDER BY is_active DESC, is_main DESC, sort_order ASC, lower(name) ASC`,
      [tenantId],
    );
    return rows.map((r) => this.mapPoint(r));
  }

  /**
   * Таблицы, чью историю без филиала разбирает атрибуция. Состав — дословно из
   * миграций 160 (checks, clients) и 161 (остальные денежные модули). Список
   * общий с миграциями сознательно: если у таблицы появится point_id, её надо
   * добавить в ОБА места, иначе тенант, которому точку заводят сегодня, увидит
   * по этой таблице пустоту.
   */
  private static readonly HISTORY_TABLES = HISTORY_ATTACH_SQL.map(([table]) => table);

  /**
   * РАЗОБРАТЬ ИСТОРИЮ БЕЗ ФИЛИАЛА — момент, когда у тенанта впервые появляется
   * ЖИВАЯ точка (суперадмин её завёл или разархивировал). До этой секунды
   * скоуп филиала у тенанта выключен и point_id никого не волнует; с этой
   * секунды PointsService.listForTenant отдаёт точку сотрудникам, и филиальный
   * срез начинает фильтровать СТРОГИМ равенством (common/point-scope.ts) — вся
   * прежняя история без привязки одномоментно пропала бы с экранов.
   *
   * Зовётся ТОЛЬКО когда основной точки до этого не было: если она уже есть,
   * история к ней уже привязана, а строки, оставшиеся без филиала после этого,
   * мог родить только владелец в режиме «Все точки» — утащить их куда-либо
   * значило бы задним числом переписать чужую выручку.
   *
   * Работает на клиенте внутри транзакции вызывающего: точка и разбор истории
   * обязаны коммититься вместе.
   */
  private async attachOrphanHistory(db: PointScopeQueryable, tenantId: string) {
    for (const [, sql] of HISTORY_ATTACH_SQL) {
      await db.query(sql, [tenantId]);
    }
  }

  /**
   * Создать точку тенанту (суперадмин). Дубль живого имени → 409.
   *
   * ИСТОРИЯ ДОСТАЁТСЯ ОСНОВНОМУ СЕРВИСУ, А НЕ ПЕРВОЙ ЗАВЕДЁННОЙ ТОЧКЕ.
   * Миграции 160/161 привязали историю у тех тенантов, у кого точки УЖЕ БЫЛИ
   * на момент прогона. Для всех остальных этот момент наступает ИМЕННО ЗДЕСЬ:
   * суперадмин заводит первую точку, PointsService.listForTenant тут же выдаёт
   * её сотрудникам — и с этой секунды скоуп фильтрует СТРОГИМ равенством
   * (common/point-scope.pointFilterSql). Вся прежняя история лежит с
   * point_id IS NULL, поэтому без привязки автосервис одномоментно теряет
   * журнал, отчёты, зарплату, смены и расходы — выглядит это как «данные
   * пропали».
   *
   * ПОЧЕМУ НЕ «ПЕРВОЙ СОЗДАННОЙ» (как было в первой редакции волны 3): у
   * владельца, годами работавшего как ZR AUTO и открывшего второй автосервис
   * ТопГаз, суперадмин заводит ОДНУ точку — «ТопГаз». Привязка к ней пометила
   * бы всю многолетнюю историю ZR AUTO чужим филиалом, и различить их обратно
   * было бы нечем. Поэтому сначала обеспечиваем существование ОСНОВНОЙ точки
   * (имя — из tenants.name), историю отдаём ЕЙ, а создаваемая точка становится
   * филиалом.
   *
   * ЕСЛИ СУПЕРАДМИН НАЗВАЛ ПЕРВУЮ ТОЧКУ КАК КОМПАНИЮ — она И ЕСТЬ основной
   * сервис: помечаем её is_main и дубль не создаём.
   *
   * ПРИВЯЗКА — ТОЛЬКО В МОМЕНТ ПОЯВЛЕНИЯ ОСНОВНОЙ ТОЧКИ. Если основная у
   * тенанта уже была, история к ней уже привязана, а строки, оставшиеся без
   * филиала после этого, мог родить только владелец в режиме «Все точки» —
   * утащить их в новорождённый филиал значило бы задним числом переписать
   * чужую выручку. Сам UPDATE к тому же адресует лишь `point_id IS NULL`.
   *
   * ОДНА ТРАНЗАКЦИЯ: основная точка, филиал и привязка коммитятся вместе.
   * Иначе упавшая посередине привязка оставила бы живые точки и
   * полупривязанную историю — состояние, из которого нет автоматического
   * выхода. Строка тенанта берётся FOR UPDATE: два параллельных создания не
   * должны оба решить, что основной точки ещё нет.
   */
  async adminCreate(tenantId: string, dto: { name?: string; address?: string }) {
    const name = String(dto?.name ?? '').trim();
    if (!name) throw new BadRequestException({ message: 'Укажите название точки' });
    const address = String(dto?.address ?? '').trim() || null;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows: t } = await client.query(`SELECT id, name FROM tenants WHERE id=$1 FOR UPDATE`, [tenantId]);
      if (t.length === 0) throw new NotFoundException({ message: 'Тенант не найден' });

      const { rows: mainRows } = await client.query(
        `SELECT id FROM tenant_points WHERE tenant_id=$1 AND is_main LIMIT 1`,
        [tenantId],
      );
      const hadMain = mainRows.length > 0;

      const companyName = String(t[0].name ?? '').trim() || MAIN_POINT_FALLBACK_NAME;
      // Сравнение регистронезависимое — ровно как уникальный индекс имён 156.
      const asksForCompanyItself = !hadMain && name.toLowerCase() === companyName.toLowerCase();

      let point: any;
      if (asksForCompanyItself) {
        // Суперадмин заводит саму компанию: создаваемая точка И ЕСТЬ основной
        // сервис. sort_order на минимум ниже прочих — основная идёт первой.
        const { rows } = await client.query(
          `INSERT INTO tenant_points (tenant_id, name, address, sort_order, is_active, is_main)
           VALUES ($1, $2, $3,
                   COALESCE((SELECT MIN(sort_order) FROM tenant_points WHERE tenant_id=$1), 1) - 1,
                   true, true)
           RETURNING *`,
          [tenantId, name, address],
        );
        point = rows[0];
      } else {
        // Основная точка обязана существовать ДО привязки истории — иначе
        // привязывать было бы не к чему, и история снова досталась бы филиалу.
        await this.ensureMainPoint(client, tenantId, t[0].name);
        const { rows } = await client.query(
          `INSERT INTO tenant_points (tenant_id, name, address, sort_order)
           VALUES ($1, $2, $3, COALESCE((SELECT MAX(sort_order)+1 FROM tenant_points WHERE tenant_id=$1), 0))
           RETURNING *`,
          [tenantId, name, address],
        );
        point = rows[0];
      }

      // Основной точки не было — значит, филиальный скоуп у тенанта включается
      // ПРЯМО СЕЙЧАС и историю надо разобрать по филиалам. Хелпер находит
      // основной сервис тем же подзапросом, что и миграции 161/162: код и SQL
      // обязаны смотреть на одну и ту же строку.
      if (!hadMain) await this.attachOrphanHistory(client, tenantId);

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

  /**
   * ОСНОВНОЙ СЕРВИС НЕЛЬЗЯ ПОГАСИТЬ. Архив (is_active=false) и «удаление»
   * (это тот же архив, паттерн 146) для основной точки запрещены: она не
   * филиал, а сам автосервис тенанта, и вся его историческая выручка,
   * клиентура и зарплата привязаны именно к ней (160). Погашенная точка не
   * входит ни в один живой срез — для владельца это выглядело бы как разовая
   * потеря всей истории компании, причём без обратного хода: разархивировать
   * её смог бы только суперадмин, и то если бы догадался, что произошло.
   *
   * Переименование основной точки РАЗРЕШЕНО — компания может сменить вывеску,
   * и на принадлежность истории это никак не влияет.
   *
   * Заодно единственная точка валидации формы id на админ-путях архивации:
   * не-uuid в сравнении с uuid дал бы 22P02 → 500 вместо честного 404.
   */
  private async assertPointCanBeArchived(tenantId: string, pointId: string) {
    if (!UUID_RE.test(pointId)) throw new NotFoundException({ message: 'Точка не найдена' });
    const { rows } = await this.pool.query(`SELECT is_main FROM tenant_points WHERE id=$1 AND tenant_id=$2`, [
      pointId,
      tenantId,
    ]);
    if (rows.length === 0) throw new NotFoundException({ message: 'Точка не найдена' });
    if (rows[0].is_main) {
      throw new BadRequestException({
        message: 'Основной сервис нельзя удалить или заархивировать — это сам автосервис. Его можно переименовать.',
      });
    }
  }

  /**
   * Переименовать / сменить адрес / архив-РАЗархив (суперадмин).
   *
   * РАЗАРХИВАЦИЯ — ТОЧКА ВХОДА В МУЛЬТИ-ТОЧЕЧНЫЙ РЕЖИМ, РОВНО КАК adminCreate.
   * Инвариант всей волны — «есть хотя бы одна ЖИВАЯ точка → основной сервис
   * обязан существовать, и история обязана быть разобрана». Его держали
   * миграции 160/161/162 и adminCreate, но НЕ этот метод, а дыра открывалась
   * так: на момент прогона миграций ВСЕ точки тенанта лежали в архиве, и
   * миграции его пропустили (они трогают только тенантов с живыми точками);
   * позже суперадмин разархивирует «ТопГаз» — у тенанта появляется живая
   * точка, основной нет, вся история с пустым филиалом. С этой секунды
   * listForTenant отдаёт точку сотрудникам, скоуп включается и режет СТРОГИМ
   * равенством: журнал, деньги, зарплата и смены филиала пусты, а владелец
   * читает это как «данные пропали».
   *
   * Поэтому включение точки идёт той же транзакцией, что и в adminCreate:
   * is_active=true → обеспечить основной сервис → разобрать историю, всё
   * вместе или ничего. Переименование, адрес и сортировка ничего этого не
   * запускают — они не меняют числа живых точек.
   */
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
    // Проверка ДО UPDATE: запрет обязан сработать раньше, чем точка погаснет.
    if (dto.isActive === false) await this.assertPointCanBeArchived(tenantId, pointId);
    vals.push(pointId, tenantId);

    const activating = dto.isActive === true;
    const client = await this.pool.connect();
    let row: any;
    try {
      await client.query('BEGIN');

      let tenantName: unknown = null;
      let hadMain = true;
      if (activating) {
        // Строку тенанта берём FOR UPDATE — как в adminCreate: два
        // параллельных «включить точку» не должны оба решить, что основной
        // сервис ещё не заведён, и создать его дважды.
        const { rows: t } = await client.query(`SELECT id, name FROM tenants WHERE id=$1 FOR UPDATE`, [tenantId]);
        if (t.length === 0) throw new NotFoundException({ message: 'Точка не найдена' });
        tenantName = t[0].name;
        const { rows: mainRows } = await client.query(
          `SELECT id FROM tenant_points WHERE tenant_id=$1 AND is_main LIMIT 1`,
          [tenantId],
        );
        hadMain = mainRows.length > 0;
      }

      const { rows } = await client.query(
        `UPDATE tenant_points SET ${sets.join(', ')} WHERE id=$${idx++} AND tenant_id=$${idx} RETURNING *`,
        vals,
      );
      if (rows.length === 0) throw new NotFoundException({ message: 'Точка не найдена' });
      row = rows[0];

      if (activating && !hadMain) {
        // ПОРЯДОК: сначала точка стала живой (UPDATE выше), только потом
        // ensureMainPoint — его шаг «пометить точку с именем компании» смотрит
        // ТОЛЬКО на живые точки, и разархивируемая «ZR AUTO» иначе прошла бы
        // мимо, а рядом родился бы дубль с тем же именем.
        await this.ensureMainPoint(client, tenantId, tenantName);
        await this.attachOrphanHistory(client, tenantId);
      }

      await client.query('COMMIT');
    } catch (err: any) {
      await client.query('ROLLBACK');
      if (err?.code === '23505') throw new ConflictException({ message: 'Точка с таким названием уже есть' });
      throw err;
    } finally {
      client.release();
    }

    // Архивация через PATCH — тот же архив, что и DELETE, значит и последствия
    // обязаны быть теми же: иначе сотрудники остаются приколотыми к погашенной
    // точке и продолжают штамповать в неё деньги. Вне транзакции — сброс
    // auth-кеша откатить всё равно нельзя, а лишний lock на users не нужен.
    if (dto.isActive === false) await this.detachMembersFromPoint(tenantId, pointId);
    return this.mapPoint(row);
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
   *
   * ОСНОВНОЙ СЕРВИС сюда не пускается вовсе — обоснование в
   * assertPointCanBeArchived.
   */
  async adminArchive(tenantId: string, pointId: string) {
    await this.assertPointCanBeArchived(tenantId, pointId);
    const { rows } = await this.pool.query(
      `UPDATE tenant_points SET is_active=false WHERE id=$1 AND tenant_id=$2 RETURNING id`,
      [pointId, tenantId],
    );
    if (rows.length === 0) throw new NotFoundException({ message: 'Точка не найдена' });
    await this.detachMembersFromPoint(tenantId, pointId);
    return { success: true };
  }
}
