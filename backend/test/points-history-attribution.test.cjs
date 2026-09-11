const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

/**
 * АТРИБУЦИЯ ИСТОРИИ ПО ФИЛИАЛАМ — ЗЕРКАЛЬНАЯ КАТАСТРОФА И КАК ОНА ЗАКРЫТА.
 *
 * ЧТО БЫЛО. Волна 160 научилась отдавать историю ОСНОВНОМУ сервису: у чеков и
 * клиентов point_id завела ещё 156, поэтому оставшийся NULL там честно значит
 * «строка старше филиалов». Волна 161 скопировала это правило на семь денежных
 * таблиц (shifts, expenses, cash_shifts, salary_payouts / _premiums /
 * _penalties / _payments) — и вот там оно НЕВЕРНО: колонку point_id этим
 * таблицам заводит сама 161, NULL стоит у ВСЕХ строк без исключения.
 *
 * ЖИВОЙ СЦЕНАРИЙ ВЛАДЕЛЬЦА. Тенант ZR AUTO. 1 августа суперадмин завёл филиал
 * «ТопГаз», мастер туда перешёл, августовские чеки уже лежат с точкой ТопГаза.
 * А кассовые смены, расходы и зарплатные выплаты августа лежат с пустой
 * точкой — колонки не было. Слепое «NULL → основной сервис» увело бы их все на
 * счёт ZR AUTO: деньги двух автосервисов снова перемешаны, просто в другую
 * сторону.
 *
 * ЧТО ОХРАНЯЕТ ЭТОТ ТЕСТ:
 *   1. 161 и 162 несут ПОБАЙТОВО ОДИНАКОВЫЙ блок атрибуции — иначе один и тот
 *      же тенант приходит к разному распределению денег в зависимости от того,
 *      какая миграция досталась его базе.
 *   2. Лестница доказательств цела: временнОе доказательство → связанная
 *      операция → след в чеках → назначение сотрудника → основной сервис. И
 *      ни одна ступень не адресует строки, у которых филиал уже проставлен.
 *   3. Основной сервис выведен из отсечения «точка моложе строки»: его строку
 *      в tenant_points заводит сама миграция, и без исключения он выпал бы из
 *      кандидатов для ВСЕЙ истории.
 *   4. PointsService применяет ту же лестницу теми же словами — код и SQL
 *      обязаны смотреть на одну строку.
 *   5. Разархивация точки (adminUpdate isActive:true) обеспечивает основной
 *      сервис и разбирает историю — раньше эта дыра оставляла тенанта с живым
 *      филиалом, без основного сервиса и с историей в никуда.
 *
 * Тест статический (читает SQL и исходники) + поведенческий на собранном dist
 * с фейковым пулом + модель лестницы на сценарии владельца: живой БД в CI нет.
 * Семантика самого SQL проверялась отдельно, на временном кластере PostgreSQL
 * 16 (полная цепочка миграций 001→162 на этих же данных) — см. отчёт задачи.
 * Конвенция — points-main-service / points-scoping-modules.
 */

const backendRoot = join(__dirname, '..');
const read = (relativePath) => readFileSync(join(backendRoot, relativePath), 'utf8');

const migration161 = read('migrations/161_points_scoping_modules.sql');
const migration162 = read('migrations/162_points_main_repair.sql');
const points = read('src/points/points.service.ts');

const { PointsService } = require('../dist/points/points.service');

const MONEY_TABLES = [
  'shifts',
  'cash_shifts',
  'salary_payouts',
  'salary_premiums',
  'salary_penalties',
  'salary_payments',
  'expenses',
];

const flat = (sql) => sql.replace(/\s+/g, ' ').trim();

/** Блок атрибуции между маркерами — то, что обязано совпадать в 161 и 162. */
function attributionBlock(sql) {
  const from = sql.indexOf('-- >>> ATTRIBUTION-BLOCK');
  const to = sql.indexOf('-- <<< ATTRIBUTION-BLOCK');
  assert.ok(from > 0 && to > from, 'маркеры блока атрибуции не найдены');
  return sql.slice(from, to);
}

/** Тело COALESCE-лестницы одной таблицы (без подзапроса фактов тенанта). */
function ladderOf(src, table) {
  const m = src.match(new RegExp(`UPDATE ${table} \\w+\\s+SET point_id = COALESCE\\(([\\s\\S]*?)\\n\\s*FROM `));
  assert.ok(m, `лестница атрибуции для ${table} не найдена`);
  return flat(m[1]);
}

// ── 1. Один блок на две миграции ───────────────────────────────────────────

test('блок атрибуции в 161 и 162 совпадает побайтово', () => {
  assert.equal(
    attributionBlock(migration161),
    attributionBlock(migration162),
    'копии разъехались: одна и та же база придёт к РАЗНОМУ распределению денег в зависимости от того, какая миграция досталась ей первой',
  );
});

test('162 разбирает семь денежных таблиц лестницей, а чеки и клиентов — правилом 160', () => {
  for (const table of MONEY_TABLES) {
    assert.ok(
      new RegExp(`UPDATE ${table} \\w+\\s+SET point_id = COALESCE\\(`).test(migration162),
      `${table}: 162 повторяет слепое «NULL → основной сервис» — августовская касса филиала уедет чужому автосервису`,
    );
  }
  for (const table of ['checks', 'clients']) {
    assert.ok(
      new RegExp(`UPDATE ${table} \\w+\\n\\s+SET point_id = mp\\.point_id`).test(migration162),
      `${table}: колонку завела ещё 156, оставшийся NULL честно значит «старше филиалов» — лестница здесь лишняя`,
    );
  }
});

// ── 2. Свидетели ───────────────────────────────────────────────────────────

test('три функции-свидетеля заведены идемпотентно и только читают', () => {
  const block = attributionBlock(migration161);
  for (const fn of ['autexa_point_by_assignment', 'autexa_point_by_checks', 'autexa_point_by_month']) {
    assert.ok(
      new RegExp(`CREATE OR REPLACE FUNCTION ${fn}\\(`).test(block),
      `${fn}: без CREATE OR REPLACE повторный прогон миграции упадёт на дубле`,
    );
  }
  assert.equal(
    (block.match(/LANGUAGE sql STABLE/g) ?? []).length,
    3,
    'свидетели обязаны быть STABLE и SQL: VOLATILE отключил бы любую оптимизацию, а plpgsql здесь не нужен',
  );
  assert.ok(!/SECURITY DEFINER/.test(block), 'обход RLS свидетелям не нужен и опасен');
});

test('свидетель молчит, когда кандидатов больше одного', () => {
  const block = attributionBlock(migration161);
  assert.equal(
    (block.match(/HAVING count\(\*\) = 1/g) ?? []).length,
    2,
    'без «ровно один» свидетель выбрал бы max() из двух филиалов — то есть выдумал бы, чьи это деньги',
  );
  assert.equal(
    (block.match(/SELECT DISTINCT/g) ?? []).length,
    2,
    'считать надо РАЗНЫЕ точки, а не строки: десять чеков одного филиала — это один кандидат',
  );
});

test('основной сервис не выпадает из кандидатов из-за собственной даты создания', () => {
  const block = attributionBlock(migration161);
  const guards = block.match(/AND \(p\.is_main OR p_born IS NULL OR p\.created_at <= p_born\)/g) ?? [];
  assert.equal(
    guards.length,
    2,
    'строку основного сервиса заводит сама миграция — без «p.is_main OR» он оказался бы моложе ЛЮБОЙ ' +
      'исторической строки, выпал бы из кандидатов, и июльская выплата мастеру ушла бы в августовский филиал',
  );
  assert.ok(
    !/AND \(p_born IS NULL OR p\.created_at <= p_born\)/.test(block),
    'осталось отсечение без исключения для основного сервиса',
  );
});

test('отсечение «филиал моложе строки» есть — иначе 161 и 162 разошлись бы', () => {
  // 162 переносит на основной сервис строку, приписанную филиалу, который
  // появился ПОЗЖЕ неё. Если 161 умеет создавать такие строки, две миграции
  // дают разное состояние одной базы.
  assert.ok(
    /p\.created_at <= p_born/.test(attributionBlock(migration161)),
    'без отсечения 161 припишет июльскую смену августовскому филиалу, а 162 тут же утащит её обратно',
  );
  assert.ok(
    /(created_at|opened_at) < p\.created_at/.test(migration162),
    'ремонтный блок 162 пропал — база, испорченная первой редакцией, останется испорченной',
  );
});

// ── 3. Лестница ────────────────────────────────────────────────────────────

test('лестница цела у всех семи денежных таблиц и идемпотентна', () => {
  const block = attributionBlock(migration161);
  for (const table of MONEY_TABLES) {
    const ladder = ladderOf(block, table);

    // Ступень 1 — временнОе доказательство. Оно же закрывает тенанта без
    // филиалов одной проверкой, без единого подзапроса на всю его историю.
    assert.ok(
      /^CASE WHEN mp\.branch_since IS NULL/.test(ladder),
      `${table}: временнОе доказательство обязано идти ПЕРВЫМ — оно единственное неопровержимо`,
    );
    // Ступень 5 — честный дефолт.
    assert.ok(
      ladder.endsWith('mp.main_id)'),
      `${table}: без последней ступени строка осталась бы NULL — невидимой в любом филиальном срезе`,
    );
    // Между ними — хотя бы один настоящий свидетель, а не догадка.
    assert.ok(
      /autexa_point_by_/.test(ladder) || /SELECT po\.point_id/.test(ladder),
      `${table}: ступень «доказательство» пропала — осталось «всё основному», то есть исходная ошибка`,
    );

    const stmt = block.match(new RegExp(`UPDATE ${table} \\w+\\n[\\s\\S]*?;`))[0];
    assert.ok(
      /point_id IS NULL/.test(stmt),
      `${table}: без «point_id IS NULL» повторный прогон перенёс бы уже привязанные деньги в другой филиал`,
    );
    assert.ok(
      /WHERE tp\.is_main AND tp\.is_active/.test(stmt),
      `${table}: дефолтная ступень обязана указывать на ОСНОВНОЙ сервис, а не на первую попавшуюся точку`,
    );
    assert.ok(
      !/DISTINCT ON/.test(stmt) && !/sort_order/.test(stmt),
      `${table}: «первой точки» как понятия больше нет — основная ровно одна (uq_tenant_points_one_main)`,
    );
  }
});

test('расход разбирается ПОСЛЕ выплат — он наследует их филиал', () => {
  const block = attributionBlock(migration161);
  const at = (table) => block.indexOf(`UPDATE ${table} `);
  assert.ok(at('expenses') > at('salary_payouts'), 'расход зарплаты возьмёт ещё не проставленный филиал выплаты');
  assert.ok(at('expenses') > at('salary_payments'), 'то же для легаси-выплат (012)');
  const ladder = ladderOf(block, 'expenses');
  assert.ok(
    /SELECT po\.point_id FROM salary_payouts po WHERE po\.expense_id = e\.id/.test(ladder),
    'связь «расход ← выплата» (100) — единственное прямое доказательство у автоматического расхода',
  );
  assert.ok(
    /SELECT pm\.point_id FROM salary_payments pm WHERE pm\.expense_id = e\.id/.test(ladder),
    'связь «расход ← легаси-выплата» (153) потеряна',
  );
});

test('кассовая смена атрибутируется чеками СВОЕГО окна', () => {
  const ladder = ladderOf(attributionBlock(migration161), 'cash_shifts');
  assert.ok(
    /autexa_point_by_checks\(cs\.tenant_id, NULL::uuid, cs\.opened_at, COALESCE\(cs\.closed_at, now\(\)\)/.test(ladder),
    'окно смены обязано совпадать с тем, по которому сходится её Z-отчёт (cash-shifts.computeFigures)',
  );
  assert.ok(
    /autexa_point_by_assignment\(cs\.tenant_id, cs\.opened_by/.test(ladder),
    'смена без единого чека в окне (пустой день) теряет последнего свидетеля — кассира',
  );
});

test('зарплата атрибутируется чеками ТОГО ЖЕ месяца начисления', () => {
  const block = attributionBlock(migration161);
  for (const [table, period] of [
    ['salary_payouts', 'sp.period_month'],
    ['salary_premiums', 'pr.period_month_year'],
    ['salary_payments', 'spm.month_year'],
  ]) {
    const ladder = ladderOf(block, table);
    assert.ok(
      ladder.includes(period),
      `${table}: период начисления (149/048/012) не участвует — выплата «за июль» уедет в филиал, открытый в августе`,
    );
    assert.ok(
      /autexa_point_by_month\(/.test(ladder),
      `${table}: месяц начисления обязан спрашиваться у чеков, а не угадываться`,
    );
  }
  assert.ok(
    /to_char\(COALESCE\(pe\.date, pe\.created_at\)/.test(ladderOf(block, 'salary_penalties')),
    'у штрафа собственного периода нет — месяцем считается месяц его даты',
  );
});

test('кривой период не роняет миграцию', () => {
  // 048: period_month_year — TEXT без CHECK, туда мог попасть мусор.
  // to_date('мусор','YYYY-MM') уронил бы весь старт backend'а.
  const block = attributionBlock(migration161);
  assert.ok(
    /WHERE p_month ~ '\^\\d\{4\}-\\d\{2\}\$'/.test(block),
    'без проверки формата месяца легаси-мусор в period_month_year уронит миграцию и уведёт backend в краш-луп',
  );
});

// ── 4. Код и SQL — одна лестница ───────────────────────────────────────────

test('PointsService применяет ту же лестницу теми же словами', () => {
  const block = attributionBlock(migration161);
  // В TS-исходнике регулярка месяца записана с экранированием (\\d), в SQL —
  // как есть: сравниваем то, что реально уйдёт в Postgres.
  const service = points.replace(/\\\\/g, '\\');
  for (const table of MONEY_TABLES) {
    assert.equal(
      ladderOf(service, table),
      ladderOf(block, table),
      `${table}: лестница в коде разъехалась с миграцией — тенант, которому точку заводят сегодня, ` +
        `получит другое распределение денег, чем тот, кого разобрала миграция`,
    );
  }
});

test('подзапрос фактов тенанта в коде и в миграции — один', () => {
  const factsOf = (src) => {
    const m = src.match(/SELECT tp\.tenant_id,[\s\S]*?WHERE tp\.is_main AND tp\.is_active[^\n]*/);
    assert.ok(m, 'подзапрос фактов тенанта не найден');
    // Код сужен до одного тенанта ($1) — единственное осмысленное отличие.
    return flat(m[0]).replace(' AND tp.tenant_id = $1', '');
  };
  assert.equal(
    factsOf(points),
    factsOf(attributionBlock(migration161)),
    'основной сервис, пояс или дата первого филиала считаются в коде иначе, чем в миграции',
  );
});

test('состав разбираемых таблиц у кода и миграций общий', () => {
  const tables = [...PointsService.HISTORY_TABLES];
  assert.deepEqual(
    tables.slice().sort(),
    ['checks', 'clients', ...MONEY_TABLES].sort(),
    'список таблиц разъехался: по забытой таблице тенант увидит пустоту',
  );
  assert.ok(
    tables.indexOf('expenses') > tables.indexOf('salary_payouts'),
    'порядок важен и в коде: расход зарплаты наследует филиал выплаты',
  );
});

// ── 5. Разархивация точки — вторая дверь в мульти-точечный режим ───────────

function fakePool(rowsFor = () => []) {
  const calls = [];
  const run = async (text, params) => {
    calls.push({ text, params });
    return { rows: rowsFor(text, params) ?? [] };
  };
  return {
    calls,
    released: 0,
    query: run,
    connect: async function () {
      const pool = this;
      return {
        query: run,
        release() {
          pool.released += 1;
        },
      };
    },
  };
}

const POINT_ID = '11111111-1111-4111-8111-111111111111';

test('разархивация точки у тенанта БЕЗ основного сервиса разбирает историю', async () => {
  // Сценарий дыры: на момент прогона миграций все точки тенанта лежали в
  // архиве, и миграции его пропустили (они трогают только тенантов с ЖИВЫМИ
  // точками). Суперадмин разархивирует «ТопГаз» — у тенанта появляется живая
  // точка, основного сервиса нет, вся история с пустым филиалом.
  const pool = fakePool((text) => {
    if (/FROM tenants WHERE id/.test(text)) return [{ id: 't-1', name: 'ZR AUTO' }];
    if (/SELECT id FROM tenant_points WHERE tenant_id=\$1 AND is_main/.test(text)) return [];
    if (/UPDATE tenant_points SET is_main=true/.test(text)) return [];
    if (/INSERT INTO tenant_points/.test(text)) return [{ id: 'p-main' }];
    if (/UPDATE tenant_points SET/.test(text)) return [{ id: POINT_ID, name: 'ТопГаз', is_active: true }];
    return [];
  });
  const service = new PointsService(pool);

  await service.adminUpdate('t-1', POINT_ID, { isActive: true });

  const sql = pool.calls.map((c) => flat(c.text));
  const begin = sql.indexOf('BEGIN');
  const commit = sql.indexOf('COMMIT');
  assert.ok(begin >= 0 && commit > begin, 'точка, основной сервис и разбор истории обязаны коммититься вместе');

  const mainAt = sql.findIndex((t) => /INSERT INTO tenant_points .*is_main/.test(t));
  assert.ok(mainAt > begin && mainAt < commit, 'основной сервис не заведён — историю разбирать не к чему');

  // Точка обязана СНАЧАЛА стать живой: шаг «пометить точку с именем компании»
  // в ensureMainPoint смотрит только на живые точки, иначе разархивируемая
  // «ZR AUTO» прошла бы мимо, а рядом родился бы дубль с тем же именем.
  const activateAt = sql.findIndex((t) => /^UPDATE tenant_points SET is_active=\$1/.test(t));
  assert.ok(activateAt >= 0 && activateAt < mainAt, 'основной сервис ищется до того, как точка ожила');

  for (const table of PointsService.HISTORY_TABLES) {
    const call = pool.calls.find((c) => c.text.startsWith(`UPDATE ${table} `));
    assert.ok(call, `${table}: история осталась без филиала — раздел покажет пустоту`);
    assert.deepEqual(call.params, ['t-1', PointsService.HISTORY_BATCH]);
    const at = sql.indexOf(flat(call.text));
    assert.ok(at > mainAt && at < commit, `${table}: разбор идёт вне транзакции или раньше основного сервиса`);
  }
  assert.equal(pool.released, 1, 'соединение пула обязано возвращаться в пул');
});

test('падение разбора при разархивации откатывает и саму точку', async () => {
  const pool = fakePool((text) => {
    if (/FROM tenants WHERE id/.test(text)) return [{ id: 't-1', name: 'ZR AUTO' }];
    if (/SELECT id FROM tenant_points WHERE tenant_id=\$1 AND is_main/.test(text)) return [];
    if (/UPDATE tenant_points SET is_main=true/.test(text)) return [];
    if (/INSERT INTO tenant_points/.test(text)) return [{ id: 'p-main' }];
    if (/UPDATE tenant_points SET/.test(text)) return [{ id: POINT_ID, is_active: true }];
    if (/^UPDATE checks ch/.test(text)) throw new Error('boom');
    return [];
  });
  const service = new PointsService(pool);

  await assert.rejects(() => service.adminUpdate('t-1', POINT_ID, { isActive: true }), /boom/);
  assert.ok(
    pool.calls.map((c) => flat(c.text)).includes('ROLLBACK'),
    'иначе остаётся живая точка без основного сервиса и с полуразобранной историей',
  );
  assert.equal(pool.released, 1);
});

test('дверей в мульти-точечный режим ровно две, и обе разбирают историю', () => {
  // Живая точка у тенанта может появиться ровно двумя способами: её СОЗДАЛИ
  // (INSERT) или РАЗАРХИВИРОВАЛИ (UPDATE ... is_active). Если появится третья
  // дверь без разбора истории, тенант снова окажется с живым филиалом, без
  // основного сервиса и с историей, которой не видно ни в одном срезе.
  // Три INSERT'а и все внутри двух методов: ensureMainPoint (основной сервис)
  // и обе ветви adminCreate — «суперадмин завёл саму компанию» и «завёл филиал».
  const inserts = points.match(/INSERT INTO tenant_points/g) ?? [];
  assert.equal(inserts.length, 3, 'появился ещё один путь заведения точки — проверь, разбирает ли он историю');

  const updates = [...points.matchAll(/UPDATE tenant_points SET ([\s\S]*?)WHERE/g)].map((m) => m[1].trim());
  for (const set of updates) {
    assert.ok(
      /^is_main=true/.test(set) || /^is_active=false/.test(set) || /^\$\{sets\.join/.test(set),
      `неизвестный путь смены полей точки: «${set}» — проверь, обеспечивает ли он основной сервис и разбор истории`,
    );
  }

  // Обе двери зовут разбор истории, и обе — под условием «основного не было».
  const attachAt = [...points.matchAll(/await this\.attachOrphanHistory\(client, tenantId\)/g)].map((m) => m.index);
  assert.equal(attachAt.length, 2, 'разбор истории обязан вызываться из обеих дверей — adminCreate и adminUpdate');
  for (const at of attachAt) {
    // Ближайшее «if (» перед вызовом — то самое условие, под которым он стоит.
    const before = points.slice(0, at);
    assert.ok(
      /!hadMain/.test(before.slice(before.lastIndexOf('if ('))),
      'разбор без условия «основного сервиса не было» утащил бы в новый филиал строки, рождённые в режиме «Все точки»',
    );
  }
});

// ── 6. Модель лестницы на сценарии владельца ───────────────────────────────

/**
 * Модель ТОЙ ЖЕ лестницы на данных владельца. Структуру лестницы охраняют
 * тесты выше; здесь проверяется, что из неё следует правильный ответ — что
 * доисторическое уходит основному сервису, а августовское ОСТАЁТСЯ филиалу.
 *
 * Ровно эти же данные прогонялись через настоящую цепочку миграций на
 * временном кластере PostgreSQL 16 и дали тот же результат.
 */
const MAIN = 'ZR AUTO';
const BRANCH = 'ТопГаз';
const BRANCH_SINCE = Date.parse('2026-08-01T09:00:00+03:00');

// Чеки: точку им проставил сервер в момент пробития (156) либо миграция 160.
const CHECKS = [
  { at: '2026-07-10T12:00:00+03:00', master: 'zr', point: MAIN }, // 160: NULL → основной
  { at: '2026-07-12T12:00:00+03:00', master: 'tg', point: MAIN }, // 160: NULL → основной
  { at: '2026-08-10T12:00:00+03:00', master: 'tg', point: BRANCH },
  { at: '2026-08-11T12:00:00+03:00', master: 'tg', point: BRANCH },
  { at: '2026-08-12T12:00:00+03:00', master: 'zr', point: MAIN }, // 160: NULL → основной
];
// Назначения: мастер «tg» приписан ровно к филиалу, мастер «zr» — ни к чему.
const ASSIGNMENT = { tg: BRANCH };

const born = (iso) => Date.parse(iso);
const isMainPoint = (p) => p === MAIN;
/** Точка существовала на момент рождения строки? Основной сервис — всегда. */
const existed = (point, at) => isMainPoint(point) || BRANCH_SINCE <= at;

/** Ступень 3: единственная точка чеков окна. */
function pointByChecks({ master, from, to, at }) {
  const seen = new Set(
    CHECKS.filter(
      (c) =>
        (master === null || c.master === master) &&
        born(c.at) >= from &&
        born(c.at) < to &&
        existed(c.point, at),
    ).map((c) => c.point),
  );
  return seen.size === 1 ? [...seen][0] : null;
}

/** Ступень 4: единственный филиал сотрудника. */
function pointByAssignment(user, at) {
  const p = ASSIGNMENT[user];
  return p && existed(p, at) ? p : null;
}

/** Месяц 'YYYY-MM' → границы в поясе тенанта (МСК). */
const monthWindow = (m) => [Date.parse(`${m}-01T00:00:00+03:00`), Date.parse(`${m === '2026-07' ? '2026-08' : '2026-09'}-01T00:00:00+03:00`)];

/** Вся лестница целиком. */
function attribute(row) {
  const at = born(row.createdAt);
  if (at < BRANCH_SINCE) return MAIN; // 1. временнОе доказательство
  if (row.linkedPoint) return row.linkedPoint; // 2. связанная операция
  if (row.window) {
    const byChecks = pointByChecks({ master: row.master ?? null, from: row.window[0], to: row.window[1], at });
    if (byChecks) return byChecks; // 3. след в чеках
  }
  for (const user of row.actors ?? []) {
    const byAssignment = pointByAssignment(user, at);
    if (byAssignment) return byAssignment; // 4. назначение сотрудника
  }
  return MAIN; // 5. честный дефолт
}

test('сценарий владельца: доисторическое — основному, августовское — филиалу', () => {
  const day = (d) => [Date.parse(`${d}T00:00:00+03:00`), Date.parse(`${d}T00:00:00+03:00`) + 24 * 3600e3];

  const cases = [
    // Рабочие смены мастера, ушедшего в филиал.
    ['смена 12 июля (филиала ещё нет)', { createdAt: '2026-07-12T08:00:00+03:00', master: 'tg', window: day('2026-07-12'), actors: ['tg'] }, MAIN],
    ['смена 10 августа (мастер уже в филиале)', { createdAt: '2026-08-10T08:00:00+03:00', master: 'tg', window: day('2026-08-10'), actors: ['tg'] }, BRANCH],
    ['смена 12 августа у мастера основного сервиса', { createdAt: '2026-08-12T08:00:00+03:00', master: 'zr', window: day('2026-08-12'), actors: ['zr'] }, MAIN],

    // Кассовые смены — по чекам своего окна (мастер не важен).
    ['касса 12 июля', { createdAt: '2026-07-12T08:00:00+03:00', master: null, window: [Date.parse('2026-07-12T08:00:00+03:00'), Date.parse('2026-07-12T21:00:00+03:00')], actors: ['tg'] }, MAIN],
    ['касса 10 августа', { createdAt: '2026-08-10T08:00:00+03:00', master: null, window: [Date.parse('2026-08-10T08:00:00+03:00'), Date.parse('2026-08-10T21:00:00+03:00')], actors: ['tg'] }, BRANCH],

    // Расходы — по автору, зарплатный — по связанной выплате.
    ['июльская аренда', { createdAt: '2026-07-05T10:00:00+03:00', actors: ['zr'] }, MAIN],
    ['расходники филиала 15 августа', { createdAt: '2026-08-15T10:00:00+03:00', actors: ['tg'] }, BRANCH],
    ['аренда офиса от владельца (доказательств нет)', { createdAt: '2026-08-16T10:00:00+03:00', actors: ['owner'] }, MAIN],
    ['расход зарплаты филиала', { createdAt: '2026-09-01T10:00:00+03:00', linkedPoint: BRANCH, actors: ['owner'] }, BRANCH],

    // Зарплата — по чекам месяца начисления, а не по текущему месту работы.
    ['выплата ЗА ИЮЛЬ, сделанная в августе', { createdAt: '2026-08-05T10:00:00+03:00', master: 'tg', window: monthWindow('2026-07'), actors: ['tg', 'owner'] }, MAIN],
    ['выплата ЗА АВГУСТ', { createdAt: '2026-09-01T10:00:00+03:00', master: 'tg', window: monthWindow('2026-08'), actors: ['tg', 'owner'] }, BRANCH],
    ['выплата за август мастеру основного сервиса', { createdAt: '2026-09-01T10:00:00+03:00', master: 'zr', window: monthWindow('2026-08'), actors: ['zr', 'owner'] }, MAIN],
    ['премия за август', { createdAt: '2026-09-02T10:00:00+03:00', master: 'tg', window: monthWindow('2026-08'), actors: ['tg', 'owner'] }, BRANCH],
    ['штраф 20 августа', { createdAt: '2026-08-20T10:00:00+03:00', master: 'tg', window: monthWindow('2026-08'), actors: ['tg', 'owner'] }, BRANCH],
  ];

  for (const [what, row, expected] of cases) {
    assert.equal(attribute(row), expected, `${what}: деньги ушли не тому автосервису`);
  }
});

test('выплата ЗА ИЮЛЬ не уезжает в филиал только из-за назначения мастера', () => {
  // Самая коварная строка сценария: мастер СЕЙЧАС приписан к ТопГазу, но
  // выплата — за июль, когда филиала не существовало. Ступень «след в чеках»
  // обязана сработать РАНЬШЕ ступени «назначение сотрудника».
  const july = { createdAt: '2026-08-05T10:00:00+03:00', master: 'tg', window: monthWindow('2026-07'), actors: ['tg'] };
  assert.equal(attribute(july), MAIN);
  assert.equal(pointByAssignment('tg', born(july.createdAt)), BRANCH, 'назначение действительно указывает на филиал');
});

test('тенант без филиалов проходит лестницу одной проверкой', () => {
  // branch_since IS NULL — вся история основному сервису, ни одного подзапроса.
  const ladder = ladderOf(attributionBlock(migration161), 'shifts');
  assert.ok(
    ladder.startsWith('CASE WHEN mp.branch_since IS NULL OR'),
    'без этой ветви одноточечный тенант платил бы подзапросом за каждую историческую строку',
  );
});
