import {
  Injectable,
  Inject,
  Logger,
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
import { motivationByPointMonthSql, premiumsByPointMonthSql } from '../common/salary-extras-sql';
import { actorPointId, PointScopeQueryable } from '../common/point-scope';

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
 *
 * ФОРМА ЭЛЕМЕНТА: [таблица, алиас, UPDATE]. Алиас хранится отдельно, потому
 * что attachOrphanHistory дописывает к каждому UPDATE хвост-порцию
 * (`AND <алиас>.id IN (…LIMIT $2)`) — вытаскивать алиас регуляркой из текста
 * запроса значило бы ставить работоспособность привязки в зависимость от
 * форматирования SQL.
 */
const HISTORY_ATTACH_SQL: ReadonlyArray<readonly [string, string, string]> = [
  [
    'checks',
    'ch',
    `UPDATE checks ch
        SET point_id = mp.main_id
       FROM ${MAIN_FACTS_SQL}
      WHERE ch.point_id IS NULL AND ch.tenant_id = mp.tenant_id`,
  ],
  [
    'clients',
    'cl',
    `UPDATE clients cl
        SET point_id = mp.main_id
       FROM ${MAIN_FACTS_SQL}
      WHERE cl.point_id IS NULL AND cl.tenant_id = mp.tenant_id`,
  ],
  [
    'shifts',
    's',
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
    'cs',
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
    'sp',
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
    'pr',
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
    'pe',
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
    'spm',
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
    'e',
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
 * Доступ к БД для порционной привязки истории.
 *
 * Отдельный от PointScopeQueryable тип нужен ровно из-за `rowCount`: цикл
 * порций останавливается по числу ЗАТРОНУТЫХ строк, а PointScopeQueryable
 * обещает только `rows` (у UPDATE без RETURNING он всегда пуст). Расширять
 * общий тип ради одного вызывающего не стали — он импортируется половиной
 * сервисов, и лишнее поле в нём пришлось бы поддерживать всем фейкам в тестах.
 */
interface HistoryAttachDb {
  query(text: string, params?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

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

  private readonly logger = new Logger('PointsService');

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
   * Филиалы своего тенанта для приложения: живые филиалы + назначения
   * сотрудников (memberIds — раздел «Филиалы» показывает состав ДЛЯ ПРОСМОТРА,
   * настраивается он в карточке сотрудника) + филиал ТЕКУЩЕЙ СЕССИИ.
   *
   * 163 — МЕТОД БОЛЬШЕ НИЧЕГО НЕ ПИШЕТ. Раньше он на чтении подставлял
   * сотруднику филиал (UPDATE users.current_point_id + сброс auth-кеша), потому
   * что сессия могла существовать без филиала. Теперь филиал выдаётся при
   * входе, и подставлять на GET нечего: currentPointId — это то, что лежит в
   * токене этой сессии. Побочный эффект на чтении был ещё и гонкой: два
   * параллельных GET /points с разных устройств могли записать разные филиалы.
   */
  async listForTenant(user: JwtPayload) {
    const [{ rows: points }, { rows: members }] = await Promise.all([
      this.pool.query(
        // is_main DESC во главе: основной сервис — первый пункт любого списка
        // (160). Иначе владелец искал бы «ZR AUTO» где-то посреди филиалов.
        `SELECT * FROM tenant_points WHERE tenant_id=$1 AND is_active=true
         ORDER BY is_main DESC, sort_order ASC, lower(name) ASC`,
        [user.tenantID],
      ),
      this.pool.query(`SELECT user_id, point_id FROM user_points WHERE tenant_id=$1`, [user.tenantID]),
    ]);
    const byPoint = new Map<string, string[]>();
    for (const m of members) {
      const list = byPoint.get(m.point_id) ?? [];
      list.push(m.user_id);
      byPoint.set(m.point_id, list);
    }

    return {
      points: points.map((p) => ({ ...this.mapPoint(p), memberIds: byPoint.get(p.id) ?? [] })),
      // Филиал СЕССИИ, а не колонка пользователя: колонка отдала бы вебу
      // филиал, выбранный в телефоне.
      currentPointId: actorPointId(user),
    };
  }

  /**
   * СМЕНА ФИЛИАЛА ДЛЯ СТАРЫХ СБОРОК: ручка ЗАПИСЫВАЕТ ПОДСКАЗКУ СЛЕДУЮЩЕГО
   * ВХОДА и отвечает успехом. Сама смена происходит при повторном входе.
   *
   * ЧТО БЫЛО СЛОМАНО. 163 сделал филиал свойством сессии и оставил эту ручку
   * живой, но ВСЕГДА отвечающей 409, и сознательно не писал
   * users.current_point_id. На руках у людей сборки 3.5/3.6, которые про
   * двухшаговый вход ничего не знают: сервер выбирает им филиал сам —
   * autexa_default_point, то есть «последний выбранный, иначе основной». В
   * итоге мастер, вошедший не в тот филиал, не мог попасть в нужный НИКАК:
   * переключатель отвечал отказом, а выход и вход возвращали его туда же,
   * потому что подсказку менять было нечем. Тупик на ровном месте.
   *
   * ЧТО ДЕЛАЕТ ТЕПЕРЬ — И ЧЕГО НЕ ДЕЛАЕТ. Пишет ТОЛЬКО users.current_point_id,
   * то есть «куда этот человек хочет попасть в следующий раз». Филиал ТЕКУЩЕЙ
   * сессии не меняется и измениться не может: он лежит в подписанном токене.
   * Поэтому в ответе `currentPointId` — филиал ЭТОЙ сессии, неизменный, а не
   * тот, что попросили: соврать здесь значило бы, что человек видит филиал Б, а
   * чеки уходят в филиал А. Офлайн-очередь старого клиента читает ровно это
   * поле и потому продолжает штамповать верный филиал.
   *
   * ПОЧЕМУ ПОДСКАЗКА — ЭТО НЕ ДЫРА В ДОСТУПЕ. Записываем только филиал, в
   * котором сотрудник ВПРАВЕ работать: предикат общий на весь монорепо —
   * autexa_point_is_allowed (163/165). Иначе подсказка стала бы способом
   * попасть при следующем входе в чужой автосервис.
   *
   * pointId = null (кнопка «Все автосервисы» старых сборок) — 409: рабочего
   * режима «все филиалы» больше нет, он рождал денежные строки без филиала.
   * Сводка по сети осталась карточками GET /points/summary.
   *
   * НОВЫЙ КЛИЕНТ СЮДА НЕ ХОДИТ: в shared/api/createServices.ts метод помечен
   * @deprecated. В новом UI филиал меняет руководитель — мгновенно, перевыпуском
   * сессии (POST /auth/switch-point, 167), а сотрудник — выходом и входом
   * (authApi.loginWithPointSelect → selectPoint). Эта ручка остаётся дословно
   * такой, какая есть: на руках сборки 3.5/3.6, и сломать им подсказку
   * следующего входа значит запереть человека не в том филиале.
   */
  async switchPoint(user: JwtPayload, pointId: string | null): Promise<{ currentPointId: string | null }> {
    if (!pointId) {
      throw new ConflictException({
        message: 'Режим «Все автосервисы» больше не поддерживается. Выберите филиал при входе.',
      });
    }
    if (!UUID_RE.test(pointId)) throw new NotFoundException({ message: 'Филиал не найден' });

    const { rows } = await this.pool.query(`SELECT autexa_point_is_allowed($1::uuid, $2::uuid, $3::uuid) as ok`, [
      user.tenantID,
      user.userID,
      pointId,
    ]);
    if (rows[0]?.ok !== true) {
      throw new ForbiddenException({ message: 'Филиал недоступен' });
    }

    await this.pool.query(`UPDATE users SET current_point_id=$1 WHERE id=$2 AND tenant_id=$3`, [
      pointId,
      user.userID,
      user.tenantID,
    ]);

    // Филиал СЕССИИ не изменился — отдаём его, а не запрошенный. Подсказка
    // применится при следующем входе.
    return { currentPointId: actorPointId(user) };
  }

  /**
   * ДОСТУП СОТРУДНИКА К ФИЛИАЛАМ — ОДНА ТРАНЗАКЦИЯ, ОДИН СПИСОК ПОСЛЕДСТВИЙ.
   * Обе ручки настройки доступа (со стороны филиала — PUT /points/:id/members,
   * со стороны карточки сотрудника — PUT /users/:id/points) обязаны вести себя
   * ОДИНАКОВО, поэтому обе ходят сюда, а не имеют по копии правила.
   *
   * СНЯТИЕ ДОСТУПА ОБЯЗАНО ОБЕСТОЧИТЬ ЖИВУЮ СЕССИЮ (163). Филиал лежит в
   * подписанном токене — отобрать его из выданного токена нельзя, поэтому
   * механизм такой: сбрасываем auth-кеш затронутых сотрудников, следующий их
   * запрос идёт в базу, JwtStrategy спрашивает autexa_point_is_allowed и
   * отвечает 401 «Филиал больше не доступен — войдите заново». Без сброса
   * кеша снятый сотрудник ещё до 30 секунд пробивал бы чеки там, откуда его
   * убрали.
   *
   * СБРАСЫВАЕМ ВСЕМ, У КОГО НАБОР ИЗМЕНИЛСЯ — И ДОБАВЛЕННЫМ ТОЖЕ. Добавление
   * — это тоже ограничение: сотрудник БЕЗ назначений не ограничен ничем
   * (конвенция 156), и первое же назначение запирает его в одном филиале.
   * Если не сбросить кеш ему, он останется работать в филиале, к которому
   * доступ только что отобрали этим самым назначением.
   *
   * Сброс идёт ПОСЛЕ коммита: откат не должен оставлять пустой кеш при
   * неизменённых назначениях.
   */
  private async applyMembership(
    tenantID: string,
    scope: { pointId: string; userIds: string[] } | { userID: string; pointIds: string[] },
  ): Promise<string[]> {
    const client = await this.pool.connect();
    let affected: string[] = [];
    let result: string[] = [];
    try {
      await client.query('BEGIN');
      let before: string[];
      let after: string[];
      if ('pointId' in scope) {
        const { rows } = await client.query(`SELECT id FROM tenant_points WHERE id=$1 AND tenant_id=$2`, [
          scope.pointId,
          tenantID,
        ]);
        if (rows.length === 0) throw new NotFoundException({ message: 'Точка не найдена' });
        const { rows: prev } = await client.query(
          `SELECT user_id FROM user_points WHERE point_id=$1 AND tenant_id=$2`,
          [scope.pointId, tenantID],
        );
        before = prev.map((r) => r.user_id as string);
        await client.query(`DELETE FROM user_points WHERE point_id=$1 AND tenant_id=$2`, [scope.pointId, tenantID]);
        // Только сотрудники СВОЕГО тенанта — чужие id молча отбрасываются JOIN'ом.
        const { rows: ins } = await client.query(
          `INSERT INTO user_points (user_id, point_id, tenant_id)
           SELECT u.id, $1, $2 FROM users u WHERE u.tenant_id=$2 AND u.id = ANY($3::uuid[])
           ON CONFLICT DO NOTHING
           RETURNING user_id`,
          [scope.pointId, tenantID, scope.userIds],
        );
        after = ins.map((r) => r.user_id as string);
        // Затронут тот, у кого состав ИЗМЕНИЛСЯ: снятый (был — не остался) и
        // добавленный (не был — появился). Оставшийся в составе не затронут:
        // его доступ не поменялся, и гасить его сессию не за что.
        affected = [...before.filter((id) => !after.includes(id)), ...after.filter((id) => !before.includes(id))];
      } else {
        const { rows } = await client.query(`SELECT id FROM users WHERE id=$1 AND tenant_id=$2`, [
          scope.userID,
          tenantID,
        ]);
        if (rows.length === 0) throw new NotFoundException({ message: 'Сотрудник не найден' });
        const { rows: prev } = await client.query(
          `SELECT point_id FROM user_points WHERE user_id=$1 AND tenant_id=$2`,
          [scope.userID, tenantID],
        );
        before = prev.map((r) => r.point_id as string);
        await client.query(`DELETE FROM user_points WHERE user_id=$1 AND tenant_id=$2`, [scope.userID, tenantID]);
        // Только филиалы СВОЕГО тенанта; архивные не назначаем — доступ к
        // погашенному филиалу ничего не значит и только путал бы владельца.
        const { rows: ins } = await client.query(
          `INSERT INTO user_points (user_id, point_id, tenant_id)
           SELECT $1, p.id, $2 FROM tenant_points p
            WHERE p.tenant_id=$2 AND p.is_active=true AND p.id = ANY($3::uuid[])
           ON CONFLICT DO NOTHING
           RETURNING point_id`,
          [scope.userID, tenantID, scope.pointIds],
        );
        after = ins.map((r) => r.point_id as string);
        // Набор филиалов правится у ОДНОГО сотрудника — он и затронут, если
        // набор реально изменился (в любую сторону).
        const changed = before.length !== after.length || before.some((id) => !after.includes(id));
        affected = changed ? [scope.userID] : [];
      }
      await client.query('COMMIT');
      result = after;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    // ТОЛЬКО ПОСЛЕ КОММИТА: откат не должен оставлять пустой кеш при
    // неизменённых назначениях — это лишний поход в базу на каждой сессии
    // сотрудника без единой причины.
    for (const id of affected) invalidateAuthUser(id);
    return result;
  }

  /**
   * Заменить состав сотрудников филиала (user_management) — сторона раздела
   * «Филиалы». Пустой массив = явных назначений нет; сотрудник без назначений
   * не ограничен ничем (конвенция 156).
   *
   * Ручка оставлена ради сборок 3.5/3.6, которые правят состав отсюда; новый
   * UI настраивает доступ в карточке сотрудника (PUT /users/:id/points), а
   * раздел «Филиалы» показывает состав для просмотра. Обе стороны — один и тот
   * же applyMembership, поэтому последствия у них одинаковые.
   */
  async setMembers(tenantID: string, pointId: string, userIds: string[]) {
    if (!UUID_RE.test(pointId)) throw new NotFoundException({ message: 'Точка не найдена' });
    const clean = [...new Set((userIds ?? []).filter((id) => typeof id === 'string' && UUID_RE.test(id)))];
    const memberIds = await this.applyMembership(tenantID, { pointId, userIds: clean });
    return { memberIds };
  }

  /**
   * На каких филиалах может работать сотрудник (карточка сотрудника).
   * ПУСТО = не ограничен: ему доступны все живые филиалы тенанта. Это
   * конвенция 156, а не забытая настройка, — тенант, который никого никуда не
   * назначал, продолжает работать без единой настройки.
   */
  async getUserPoints(tenantID: string, userID: string) {
    if (!UUID_RE.test(userID)) throw new NotFoundException({ message: 'Сотрудник не найден' });
    const { rows: exists } = await this.pool.query(`SELECT id FROM users WHERE id=$1 AND tenant_id=$2`, [
      userID,
      tenantID,
    ]);
    if (exists.length === 0) throw new NotFoundException({ message: 'Сотрудник не найден' });
    const { rows } = await this.pool.query(
      `SELECT up.point_id::text as point_id
         FROM user_points up
         JOIN tenant_points p ON p.id = up.point_id AND p.is_active = true
        WHERE up.user_id=$1 AND up.tenant_id=$2`,
      [userID, tenantID],
    );
    return { pointIds: rows.map((r) => r.point_id as string) };
  }

  /**
   * Заменить набор филиалов сотрудника (user_management) — сторона карточки
   * сотрудника, та самая «настройка, на каких филиалах они могут работать».
   * Пустой массив = снять ограничение (доступны все живые филиалы).
   */
  async setUserPoints(tenantID: string, userID: string, pointIds: string[]) {
    if (!UUID_RE.test(userID)) throw new NotFoundException({ message: 'Сотрудник не найден' });
    const clean = [...new Set((pointIds ?? []).filter((id) => typeof id === 'string' && UUID_RE.test(id)))];
    const applied = await this.applyMembership(tenantID, { userID, pointIds: clean });
    return { pointIds: applied };
  }

  // ── Сводка по филиалам ──────────────────────────────────────────────────

  /**
   * Карточки раздела «Филиалы»: на каждую точку — оборот за день, оборот
   * за месяц, прибыль за месяц, число чеков (день и месяц) и сколько мастеров
   * сейчас на работе.
   *
   * ПРАВИЛА ДЕНЕГ — ОДИН В ОДИН с главным дашбордом (checks.getDashboard) и
   * dashboard-v2 (reports.computeDashboardV2): формулы не скопированы, а взяты
   * из общих модулей common/check-money-sql.ts и common/salary-extras-sql.ts,
   * поэтому разъехаться физически не могут. Гарантия исключена из выручки и
   * заменена реальным убытком; в расчёт входят только проведённые живые чеки
   * (is_deferred=false AND deleted_at IS NULL); границы дня и месяца — в поясе
   * ТЕНАНТА (157), а не в UTC процесса.
   *
   * `profitMonth` — ЧИСТАЯ прибыль филиала, ДОСЛОВНО netProfitMonth дашборда:
   *
   *     прибыль по чекам − расходы филиала − премии деньгами − мотивация
   *
   * Каждый терм добавлялся, потому что без него владелец видел на соседних
   * экранах два разных числа под названием «Прибыль за месяц»: сначала не
   * вычитались расходы (карточка 400 000 против главной 150 000), потом —
   * премии и мотивация (карточка выше главной ровно на выданные мастерам
   * деньги, см. common/salary-extras-sql.ts). Теперь термы те же и в том же
   * составе, поэтому числа сходятся до рубля.
   *
   * ЧЕГО В ОБЕИХ ЦИФРАХ НЕТ ОДИНАКОВО: плановая постоянка (fixed_costs,
   * employee_compensation) — она общетенантная, филиала не имеет и не входит
   * ни в netProfitMonth, ни сюда. Расхождением это не является: accrual-прибыль
   * дашборда (netProfitAccrual) — ДРУГАЯ метрика с другим именем.
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

    // ПРЕМИИ ДЕНЬГАМИ + МОТИВАЦИЯ ЗА МЕСЯЦ — третий вид зарплатного начисления
    // (обоснование и доказательство отсутствия двойного счёта —
    // common/salary-extras-sql.ts). Запросы приходят ЦЕЛИКОМ оттуда же, откуда
    // их берёт дашборд: формула, месяц отнесения премии и правило «филиал
    // мотивации = филиал её чека» существуют в ОДНОМ экземпляре. Без этого
    // терма карточка филиала показывала прибыль ВЫШЕ главной ровно на деньги,
    // выданные мастерам сверх чековой зарплаты.
    const [{ rows: premRows }, { rows: motRows }] = await Promise.all([
      this.pool.query(premiumsByPointMonthSql(), [tenantID, monthKey, tz]),
      this.pool.query(motivationByPointMonthSql(), [tenantID, monthStart]),
    ]);
    const extrasByPoint = new Map<string, number>();
    for (const r of [...premRows, ...motRows]) {
      const id = r.point_id as string;
      extrasByPoint.set(id, (extrasByPoint.get(id) ?? 0) + (parseFloat(r.total) || 0));
    }

    const revenue = checkRevenueExpr('ch');
    const profit = checkProfitExpr('ch');
    // АРХИВНЫЕ ФИЛИАЛЫ ТОЖЕ В ВЫБОРКЕ (фильтра `p.is_active = true` здесь
    // больше нет).
    //
    // ПОЧЕМУ. Итоги тенанта считаются по ВСЕМ его чекам, а сводка брала только
    // живые точки. Стоило закрыть филиал в середине месяца — и его выручка,
    // прибыль и расходы оставались в сетевых цифрах, но исчезали из карточек:
    // владелец складывал карточки, не получал того, что видит на главной, и
    // читал это как пропавшие деньги. Молча терять их нельзя.
    //
    // ПОЧЕМУ ОТДЕЛЬНОЙ СТРОКОЙ В ТОМ ЖЕ СПИСКЕ, А НЕ ОДНИМ СВОДНЫМ ПУНКТОМ
    // «архив». Деньги закрытого филиала — это деньги КОНКРЕТНОГО автосервиса
    // с именем и историей; схлопнув два закрытых филиала в одну строку, мы
    // лишили бы владельца возможности понять, чьи это цифры. Карточка едет с
    // признаком `isArchived`, клиент подписывает её «Закрыт» и не предлагает
    // в неё войти.
    //
    // ПУСТЫЕ АРХИВНЫЕ КАРТОЧКИ ОТСЕИВАЮТСЯ НИЖЕ: филиал, закрытый год назад,
    // не должен вечно висеть строкой нулей — терять в нулях нечего.
    const { rows } = await this.pool.query(
      // LEFT JOIN, а не подзапросы: точка без единого чека обязана вернуться
      // строкой с нулями (карточка филиала существует и до первой продажи).
      `SELECT p.id, p.name, p.is_main, p.is_active,
              COALESCE(SUM(CASE WHEN ch.date >= $2 THEN (${revenue}) END), 0) AS revenue_today,
              COALESCE(SUM(CASE WHEN ch.date >= $3 THEN (${revenue}) END), 0) AS revenue_month,
              COALESCE(SUM(CASE WHEN ch.date >= $3 THEN (${profit}) END), 0) AS profit_month,
              COUNT(ch.id) FILTER (WHERE ch.date >= $2) AS checks_today,
              COUNT(ch.id) FILTER (WHERE ch.date >= $3) AS checks_month
         FROM tenant_points p
         LEFT JOIN checks ch
                ON ch.point_id = p.id AND ch.tenant_id = p.tenant_id
               AND ${checkMoneyBaseWhere('ch')}
        WHERE p.tenant_id = $1
        GROUP BY p.id, p.name, p.is_main, p.is_active, p.sort_order
        ORDER BY p.is_active DESC, p.is_main DESC, p.sort_order ASC, lower(p.name) ASC`,
      [tenantID, dayStart, monthStart],
    );

    const points = rows.map((r) => {
      const id = r.id as string;
      const revenueToday = parseFloat(r.revenue_today) || 0;
      const revenueMonth = parseFloat(r.revenue_month) || 0;
      const checksToday = parseInt(r.checks_today, 10) || 0;
      const checksMonth = parseInt(r.checks_month, 10) || 0;
      // ЧИСТАЯ прибыль филиала = прибыль по чекам − расходы этого филиала за
      // месяц − премии деньгами − мотивация. Минус здесь — норма, а не баг:
      // филиал с большой постоянкой и слабой выручкой месяц и правда
      // закрывает в убыток, и увидеть это владелец обязан именно на карточке
      // филиала.
      const profitMonth =
        (parseFloat(r.profit_month) || 0) - (expenseByPoint.get(id) ?? 0) - (extrasByPoint.get(id) ?? 0);
      return {
        pointId: id,
        name: r.name as string,
        // Основной сервис (160) — первая карточка раздела «Филиалы». Клиент
        // подписывает её как сам автосервис, а не как один из филиалов.
        isMain: !!r.is_main,
        // Филиал закрыт (архив). Деньги его месяца остаются в итогах тенанта,
        // поэтому карточка остаётся в сводке — но помеченной, чтобы владелец
        // не искал в ней сегодняшнюю работу.
        isArchived: r.is_active !== true,
        revenueToday,
        revenueMonth,
        profitMonth,
        checksToday,
        checksMonth,
        // 161 — сколько мастеров/админов филиала прямо сейчас в открытой смене.
        // null = учёт смен у тенанта выключен (источника факта нет — прочерк);
        // 0 = учёт включён и сегодня действительно никто не открыл смену.
        // У закрытого филиала смен быть не может — там всегда 0 либо прочерк.
        mastersOnShift: (shiftsEnabled ? (onShiftByPoint.get(id) ?? 0) : null) as number | null,
      };
    });

    return {
      // ЖИВЫЕ — ВСЕГДА; АРХИВНЫЕ — ТОЛЬКО ЕСЛИ В ПОКАЗАННОМ ПЕРИОДЕ У НИХ ЕСТЬ
      // ДЕНЬГИ ИЛИ РАБОТА. Условие проверяет РОВНО те величины, которые видит
      // владелец на карточке: если все они нули, складывать нечего и сумма
      // карточек сходится с итогом тенанта без этой строки. Именно поэтому
      // проверяется profitMonth, а не только выручка: у закрытого филиала
      // может не быть ни одного чека месяца, но остаться оплаченная аренда —
      // и такой филиал обязан показать свой минус, а не исчезнуть.
      //
      // Одноточечный автосервис и тенант, который ничего не закрывал, получают
      // прежний ответ байт-в-байт: архивных строк у них нет вовсе.
      points: points.filter(
        (p) =>
          !p.isArchived ||
          p.revenueToday !== 0 ||
          p.revenueMonth !== 0 ||
          p.profitMonth !== 0 ||
          p.checksToday !== 0 ||
          p.checksMonth !== 0,
      ),
    };
  }

  // ── Суперадмин (ЛК, admin-пул) ──────────────────────────────────────────

  /** Все филиалы тенанта (живые + архив) для карточки тенанта в ЛК. */
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
   * Размер порции привязки истории — компромисс между «каждый запрос заведомо
   * укладывается в statement_timeout» и «не делать тысячу round-trip'ов».
   * 500 строк самой дорогой таблицы (expenses: четыре подзапроса-свидетеля на
   * строку) — это доли секунды при лимите в 8 секунд, то есть запас на порядок.
   */
  private static readonly HISTORY_BATCH = 500;

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
   * мог родить только актор без филиала (до 163 — режим «все филиалы») —
   * утащить их куда-либо
   * значило бы задним числом переписать чужую выручку.
   *
   * Работает на клиенте внутри транзакции вызывающего: точка и разбор истории
   * обязаны коммититься вместе.
   *
   * ПОЧЕМУ ПОРЦИЯМИ, А НЕ ОДНИМ UPDATE'ОМ НА ТАБЛИЦУ. У рантайм-пула стоит
   * statement_timeout = 8 секунд (common/db-config.ts) — он защищает быстрые
   * списки от того, чтобы один тяжёлый запрос занял соединение пула. Девять
   * ПОЛНОТАБЛИЧНЫХ (по тенанту) UPDATE'ов в этот лимит не укладываются, как
   * только у автосервиса набирается многолетняя история: суперадмин, заводящий
   * КРУПНОМУ тенанту первый филиал, получал 57014 → ROLLBACK → «Не удалось
   * создать точку», и повторная попытка падала ровно так же — завести филиал
   * такому тенанту было НЕЛЬЗЯ ВООБЩЕ.
   *
   * statement_timeout считается НА ЗАПРОС, а не на транзакцию, поэтому лекарство
   * — резать каждый UPDATE на порции по HISTORY_BATCH строк: каждый запрос
   * заведомо короткий, а транзакция остаётся ОДНА и по-прежнему коммитится
   * целиком. Половинчатого состояния не бывает по построению: обрыв на любой
   * порции — это ROLLBACK всей транзакции, включая создание точки.
   *
   * ПОВТОРЯЕМОСТЬ. Все UPDATE'ы адресуют только `point_id IS NULL`, поэтому
   * повторный запуск (после отката или после ручной перезаливки) доделывает
   * ровно недоделанное и никогда не переписывает уже привязанную строку.
   *
   * ПОДНЯТЫЙ ЛИМИТ — СТРАХОВКА, А НЕ ОСНОВНОЙ МЕХАНИЗМ. `SET LOCAL` живёт
   * только до конца ЭТОЙ транзакции (вызывается строго внутри BEGIN обоих
   * вызывающих) и не портит соединение, которое вернётся в пул. Он нужен на
   * случай одной патологически тяжёлой порции — например, в expenses, где
   * каждая строка тянет за собой четыре коррелированных подзапроса-свидетеля.
   */
  private async attachOrphanHistory(db: HistoryAttachDb, tenantId: string) {
    await db.query(`SET LOCAL statement_timeout = '60s'`);
    const batch = PointsService.HISTORY_BATCH;
    for (const [table, alias, sql] of HISTORY_ATTACH_SQL) {
      // Хвост-порция: берём до $2 строк БЕЗ филиала и обновляем только их.
      // ORDER BY сознательно нет — порядок не важен, а сортировка заставила бы
      // Postgres перебрать всех сирот таблицы на каждой итерации. Итерация,
      // обновившая строку, выводит её из-под `point_id IS NULL`, поэтому
      // следующая порция всегда берёт СЛЕДУЮЩИЕ строки, и цикл конечен.
      const chunked = `${sql}
        AND ${alias}.id IN (SELECT o.id FROM ${table} o
                             WHERE o.tenant_id = $1 AND o.point_id IS NULL
                             LIMIT $2)`;
      let attached = 0;
      for (;;) {
        const res = await db.query(chunked, [tenantId, batch]);
        const affected = res.rowCount ?? 0;
        attached += affected;
        // Порция пришла неполной — сирот в этой таблице больше нет.
        if (affected < batch) break;
      }
      if (attached > 0) {
        // Прогресс в лог: у крупного тенанта привязка идёт минуты, и владельцу
        // операции нужно видеть, что она движется, а не висит.
        this.logger.log(`Привязка истории тенанта ${tenantId}: ${table} — ${attached} строк`);
      }
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
   * филиала после этого, мог родить только актор без филиала (до 163) —
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
    let created: any;
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
      created = point;
    } catch (err: any) {
      await client.query('ROLLBACK');
      // 23505 частичного uq-индекса: живой дубль имени.
      if (err?.code === '23505') throw new ConflictException({ message: 'Точка с таким названием уже есть' });
      throw err;
    } finally {
      client.release();
    }
    // ПОСЛЕ коммита и ВНЕ try: у тенанта изменился состав живых филиалов, и
    // сессии, жившие без филиала (одноточечный режим), обязаны получить его на
    // следующем же запросе — иначе продолжат рождать строки без филиала (см.
    // хелпер). Внутри try сбой этого запроса привёл бы к ROLLBACK уже
    // закоммиченной транзакции и 500 при фактически созданном филиале.
    await this.invalidateTenantSessions(tenantId);
    return this.mapPoint(created);
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
    // Живые филиалы тенанта изменились в ЛЮБУЮ сторону — и архивация, и
    // разархивация обязаны обесточить сессии (обоснование — в хелпере).
    if (dto.isActive !== undefined) await this.invalidateTenantSessions(tenantId);
    return this.mapPoint(row);
  }

  /**
   * ПОСЛЕДСТВИЯ ИЗМЕНЕНИЯ СОСТАВА ЖИВЫХ ФИЛИАЛОВ ТЕНАНТА — один хелпер на все
   * пути: архивация (DELETE /points/:id и PATCH isActive:false), создание
   * первого филиала и разархивация.
   *
   * ПОЧЕМУ ЭТО НЕ КОСМЕТИКА, А ДЕНЬГИ.
   *   • АРХИВАЦИЯ. Филиал гаснет, а в токенах живых сессий он остался: чтение
   *     фильтрует по архивному филиалу (пустые журнал, склад, зарплата), запись
   *     штампует в филиал, которого нет ни в одном живом срезе, — выручка
   *     проваливается ровно так же, как при point_id = NULL. После сброса
   *     кеша JwtStrategy отвечает таким сессиям 401 «Филиал больше не
   *     доступен — войдите заново».
   *   • ПОЯВЛЕНИЕ ПЕРВОГО ФИЛИАЛА. До него сессии тенанта законно жили без
   *     филиала (одноточечный автосервис). С этой секунды скоуп включается, и
   *     сессия без филиала снова начала бы рождать строки без филиала. После
   *     сброса кеша JwtStrategy подставит таким сессиям филиал по умолчанию
   *     (autexa_default_point) — без выхода из приложения.
   *
   * СБРАСЫВАЕМ ВСЕМУ ТЕНАНТУ, а не «тем, кто сидел в этом филиале»: филиал
   * сессии лежит в подписанном токене, и по базе больше нельзя узнать, кто
   * сейчас в каком филиале. Операция редкая (её делает суперадмин), а цена
   * ошибки — деньги в несуществующем филиале.
   */
  private async invalidateTenantSessions(tenantId: string) {
    const { rows } = await this.pool.query(`SELECT id FROM users WHERE tenant_id=$1`, [tenantId]);
    for (const r of rows) invalidateAuthUser(r.id as string);
  }

  /**
   * «Удалить» точку = АРХИВ (is_active=false), паттерн 146: старые чеки точку
   * сохраняют, пикеры не предлагают, имя освобождается. Заодно обесточиваем
   * сессии тенанта, чтобы никто не остался работать в погашенном филиале
   * (обоснование — invalidateTenantSessions).
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
    await this.invalidateTenantSessions(tenantId);
    return { success: true };
  }
}
