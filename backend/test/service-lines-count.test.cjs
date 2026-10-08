const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

/**
 * УСЛУГИ В КАССЕ БЕЗ КОЛИЧЕСТВА (правка владельца №4, 2026-09-30).
 *
 * Решение владельца: история чеков не меняется; новые строки услуг и шаблоны
 * всегда с quantity = 1; отчёты по услугам считают СТРОКИ, а не SUM(quantity).
 * Сервер по-прежнему принимает quantity (старые версии приложений) и денег не
 * пересчитывает. Инварианты:
 *
 *   1. «По услугам»: «Мойка ×3» из истории — ОДНА услуга с той же выручкой
 *      (total строки), средняя цена = выручка / число строк, колонка «Оказано».
 *   2. Полностью возвращённая строка (сумма check_return_lines.quantity >=
 *      количества строки) исключается; частично возвращённая — одна услуга с
 *      выручкой total − сумма возврата; NULL/0 в quantity читается как 1.
 *   3. «Сводный»: «Топ-5 услуг» считается по тому же правилу («Оказано»), а
 *      «Топ-5 товаров» по-прежнему считает SUM(quantity) — товар не тронут.
 *   4. Шаблоны чеков: услуга с quantity 3 сохраняется как 1 (поле пишется явно —
 *      старые клиенты умножают price на quantity), quantity товара сохраняется
 *      как пришло, старые шаблоны при чтении не переписываются.
 *   5. DTO шаблона: объявлены все поля клиентов (whitelist не вырезает `shared`
 *      и `folderId`), цена >= 0, quantity услуги принимается и не проверяется.
 *
 * Части 1–2 (статика, заглушки пула, ValidationPipe) идут без БД. Часть «LIVE»
 * гоняет настоящий SQL отчётов на Postgres в транзакции с ROLLBACK — включается
 * переменной SERVICE_LINES_LIVE_DB (локальная dev-БД, нужен владелец таблиц).
 */

const backendRoot = join(__dirname, '..');
const read = (relativePath) => readFileSync(join(backendRoot, relativePath), 'utf8');
/** Код без комментариев: правила «нет SUM(quantity)» не должны срабатывать на JSDoc. */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

require('reflect-metadata');
const { ValidationPipe, BadRequestException } = require('@nestjs/common');
const { ServicesBuilder } = require('../dist/reports/builder/builders/services.builder');
const { SummaryBuilder } = require('../dist/reports/builder/builders/summary.builder');
const {
  CreateCheckTemplateDto,
  UpdateCheckTemplateDto,
  normalizeTemplateServices,
} = require('../dist/check-templates/dto/check-template.dto');
const { CheckTemplatesService } = require('../dist/check-templates/check-templates.service');
const { CheckTemplatesController } = require('../dist/check-templates/check-templates.controller');

const round2 = (n) => Math.round(n * 100) / 100;

/** Те же опции, что у глобального пайпа в main.ts (проверяется статикой ниже). */
const makePipe = () => new ValidationPipe({ transform: true, whitelist: true });
const bodyOf = (metatype) => ({ type: 'body', metatype });

/**
 * Что увидит пользователь: HttpExceptionFilter показывает message[0]. На отсутствующее
 * поле срабатывают все его правила сразу — первым должно идти сообщение про настоящую
 * причину («укажите текст», «введите число»), а не про длину или максимум.
 */
async function firstMessage(body, Dto = CreateCheckTemplateDto) {
  try {
    await makePipe().transform(structuredClone(body), bodyOf(Dto));
  } catch (err) {
    assert.ok(err instanceof BadRequestException, 'ошибка валидации — BadRequestException');
    return err.getResponse().message[0];
  }
  return assert.fail(`должно быть отклонено: ${JSON.stringify(body)}`);
}

function makeCtx(overrides = {}) {
  return {
    tenantId: 'tenant-1',
    pointId: null,
    tz: 'Europe/Moscow',
    actor: { userID: 'user-1', tenantID: 'tenant-1', role: 'director' },
    companyName: 'Автосервис',
    pointName: null,
    dateFrom: '2026-09-01',
    dateTo: '2026-09-30',
    days: 30,
    refDate: '2026-09-30',
    ids: [],
    groupBy: null,
    def: { id: 'services' },
    ...overrides,
  };
}

/** Пул-заглушка: запоминает запросы, отвечает заранее заданными строками. */
function makePool(rows) {
  const calls = [];
  return {
    calls,
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows };
    },
  };
}

// ── 1. Статика: SQL отчётов больше не суммирует quantity услуги ──────────────

test('статика: «По услугам» считает строки (COUNT), а не SUM(quantity); колонка «Оказано»', () => {
  const src = stripComments(read('src/reports/builder/builders/services.builder.ts'));
  assert.doesNotMatch(src, /SUM\(\s*(?:l|sl|b)\.quantity/, 'SUM(quantity) услуги удалён из SQL');
  assert.match(src, /COUNT\(\*\)::int AS qty/, 'оказано = число строк');
  assert.match(src, /check_return_lines/, 'возвраты по строкам по-прежнему учитываются');
  assert.match(src, /COALESCE\(NULLIF\(b\.quantity, 0\), 1\)/, 'NULL/0 в quantity читается как 1');
  assert.match(src, /key: 'qty', title: 'Оказано'/, 'колонка называется «Оказано»');
  assert.doesNotMatch(src, /title: 'Количество'/, 'старого названия колонки нет');
});

test('статика: «Топ-5 услуг» в сводном — то же правило; «Топ-5 товаров» не тронут', () => {
  const src = stripComments(read('src/reports/builder/builders/summary.builder.ts'));
  const start = src.indexOf('private async topServices');
  const end = src.indexOf('private async', start + 10);
  assert.notEqual(start, -1, 'topServices должен существовать');
  assert.ok(end > start, 'после topServices идёт следующий метод');
  const top = src.slice(start, end);
  assert.doesNotMatch(top, /SUM\(\s*(?:l|sl|b)\.quantity/, 'SUM(quantity) услуги удалён');
  assert.match(top, /COUNT\(\*\)::int AS qty/, 'оказано = число строк');
  assert.match(top, /check_return_lines/, 'возвраты вычтены, как в «По услугам»');
  assert.match(top, /title: 'Оказано'/, 'колонка «Оказано»');
  assert.doesNotMatch(top, /'Кол-во'/, 'старого названия колонки в топе услуг нет');

  const products = src.slice(src.indexOf('private async topProducts'));
  assert.match(products, /SUM\(pl\.quantity\)/, 'у товара количество по-прежнему значимо');
  assert.match(products, /'Кол-во'/, 'колонка товаров не переименована');
});

test('статика: контроллер шаблонов принимает DTO-классы, сервис нормализует только услуги', () => {
  const controller = read('src/check-templates/check-templates.controller.ts');
  assert.match(controller, /@Body\(\) dto: CreateCheckTemplateDto/, 'POST валидируется DTO');
  assert.match(controller, /@Body\(\) dto: UpdateCheckTemplateDto/, 'PUT валидируется DTO');
  assert.doesNotMatch(controller, /any\[\]/, 'тело шаблона больше не any[]');

  const service = read('src/check-templates/check-templates.service.ts');
  const normalizeCalls = service.match(/normalizeTemplateServices\(dto\.services\)/g) || [];
  assert.equal(normalizeCalls.length, 2, 'нормализация услуг — и на create, и на update');
  assert.doesNotMatch(service, /normalizeTemplateServices\(dto\.products/, 'товары не нормализуются');
  assert.match(service, /JSON\.stringify\(dto\.products \|\| \[\]\)/, 'create: товары как пришли');
  assert.match(service, /JSON\.stringify\(dto\.products\)/, 'update: товары как пришли');

  const main = read('src/main.ts');
  assert.match(
    main,
    /new ValidationPipe\(\{ transform: true, whitelist: true \}\)/,
    'глобальный пайп main.ts — те же опции, что использует этот тест',
  );
});

test('контроллер: метаданные параметров указывают на DTO-классы (их увидит глобальный ValidationPipe)', () => {
  const create = Reflect.getMetadata('design:paramtypes', CheckTemplatesController.prototype, 'create');
  const update = Reflect.getMetadata('design:paramtypes', CheckTemplatesController.prototype, 'update');
  assert.equal(create[1], CreateCheckTemplateDto, 'POST: второй параметр — CreateCheckTemplateDto');
  assert.equal(update[2], UpdateCheckTemplateDto, 'PUT: третий параметр — UpdateCheckTemplateDto');
});

// ── 2. Шаблоны: услуга всегда quantity = 1, товар — как пришёл ───────────────

test('normalizeTemplateServices: «Мойка» quantity 3 → 1, поле пишется явно', () => {
  const lines = normalizeTemplateServices([
    { serviceId: 'svc-1', name: 'Мойка', price: 500, quantity: 3 },
    { name: 'Диагностика', price: 700 },
    { serviceId: 'svc-2', name: 'Полировка', price: '4000', quantity: '2' },
  ]);
  assert.deepEqual(lines, [
    { serviceId: 'svc-1', name: 'Мойка', price: 500, quantity: 1 },
    { name: 'Диагностика', price: 700, quantity: 1 },
    { serviceId: 'svc-2', name: 'Полировка', price: 4000, quantity: 1 },
  ]);
  for (const line of lines) assert.equal(line.quantity, 1, 'quantity не пропускается: старый клиент умножит на него');
});

test('normalizeTemplateServices: serviceId пустой/null опускается, лишние поля и мусор отбрасываются', () => {
  const input = [
    { serviceId: '', name: 'А', price: 1, foo: 'bar' },
    { serviceId: null, name: 'Б', price: 2 },
    null,
    5,
    'строка',
    { name: 'В', price: 'не число' },
  ];
  const snapshot = JSON.stringify(input);
  const lines = normalizeTemplateServices(input);
  assert.deepEqual(lines, [
    { name: 'А', price: 1, quantity: 1 },
    { name: 'Б', price: 2, quantity: 1 },
    { name: 'В', price: 0, quantity: 1 },
  ]);
  assert.equal(JSON.stringify(input), snapshot, 'вход не мутируется');
  assert.deepEqual(normalizeTemplateServices(undefined), []);
  assert.deepEqual(normalizeTemplateServices(null), []);
  assert.deepEqual(normalizeTemplateServices('x'), []);
});

// ── 3. DTO шаблона через глобальный ValidationPipe ───────────────────────────

const OLD_CLIENT_BODY = {
  name: 'Замена масла',
  services: [{ serviceId: 'svc-1', name: 'Мойка', price: 500, quantity: 3 }],
  products: [
    { productId: 'p-1', name: 'Масло', price: 900, quantity: 5 },
    { productId: 'p-2', name: 'Присадка', price: 300, quantity: 0.5 },
  ],
  folderId: 'folder-1',
  shared: true,
};

test('DTO: тело старого клиента (услуга quantity 3) валидно; shared / folderId / товары переживают whitelist', async () => {
  const dto = await makePipe().transform(structuredClone(OLD_CLIENT_BODY), bodyOf(CreateCheckTemplateDto));
  assert.ok(dto instanceof CreateCheckTemplateDto, 'transform: true отдаёт экземпляр DTO');
  assert.equal(dto.name, 'Замена масла');
  assert.equal(dto.shared, true, 'shared не вырезан whitelist-ом');
  assert.equal(dto.folderId, 'folder-1', 'folderId не вырезан whitelist-ом');
  assert.equal(dto.services.length, 1);
  assert.equal(dto.services[0].name, 'Мойка');
  assert.equal(dto.services[0].price, 500);
  assert.deepEqual(dto.products, OLD_CLIENT_BODY.products, 'товары не трогаются, в том числе дробное количество');
  assert.equal(normalizeTemplateServices(dto.services)[0].quantity, 1, 'после нормализации услуга — 1');
});

test('DTO: services / products / folderId / shared необязательны; quantity услуги не проверяется', async () => {
  const pipe = makePipe();
  await pipe.transform({ name: 'Пустой шаблон' }, bodyOf(CreateCheckTemplateDto));
  await pipe.transform(
    { name: 'Без количества', services: [{ name: 'Мойка', price: 500 }], folderId: null },
    bodyOf(CreateCheckTemplateDto),
  );
  // Игнорируемое поле: значение любого вида не повод для отказа старому клиенту.
  const odd = await pipe.transform(
    { name: 'Странный клиент', services: [{ name: 'Мойка', price: 500, quantity: 'abc' }] },
    bodyOf(CreateCheckTemplateDto),
  );
  assert.equal(normalizeTemplateServices(odd.services)[0].quantity, 1);
});

test('DTO: цена приходит строкой — приводится к числу (@Type); отрицательная / не число / огромная — 400 с верным сообщением', async () => {
  const pipe = makePipe();
  const ok = await pipe.transform(
    { name: 'Шаблон', services: [{ name: 'Мойка', price: '1500' }] },
    bodyOf(CreateCheckTemplateDto),
  );
  assert.equal(ok.services[0].price, 1500);

  const withPrice = (price) => ({ name: 'Шаблон', services: [{ name: 'Мойка', price }] });
  assert.equal(
    await firstMessage(withPrice(-1)),
    'services.0.Цена услуги: значение не может быть отрицательным',
    'отрицательная цена',
  );
  assert.equal(await firstMessage(withPrice('много')), 'services.0.Цена услуги: введите число', 'цена — не число');
  assert.equal(await firstMessage(withPrice(null)), 'services.0.Цена услуги: введите число', 'цена null');
  assert.equal(
    await firstMessage({ name: 'Шаблон', services: [{ name: 'Мойка' }] }),
    'services.0.Цена услуги: введите число',
    'цены нет вовсе — не «не больше 10 000 000»',
  );
  assert.equal(
    await firstMessage(withPrice(10_000_001)),
    'services.0.Цена услуги: не больше 10 000 000',
    'слишком большая',
  );
});

test('DTO: без названия шаблона / без названия услуги / услуги не списком — 400 с верным сообщением', async () => {
  assert.equal(await firstMessage({ services: [] }), 'Название шаблона: укажите текст', 'нет названия шаблона');
  assert.equal(await firstMessage({ name: 5 }), 'Название шаблона: укажите текст', 'название — число');
  assert.equal(
    await firstMessage({ name: 'x'.repeat(2001) }),
    'Название шаблона: слишком длинный текст (максимум 2000 символов)',
    'слишком длинное название',
  );
  assert.equal(
    await firstMessage({ name: 'Шаблон', services: [{ price: 100 }] }),
    'services.0.Название услуги: укажите текст',
    'у услуги нет названия',
  );
  assert.equal(await firstMessage({ name: 'Шаблон', services: 'мойка' }), 'Услуги шаблона: ожидается список');
  assert.equal(await firstMessage({ name: 'Шаблон', products: 'масло' }), 'Товары шаблона: ожидается список');
  assert.equal(await firstMessage({ name: 5 }, UpdateCheckTemplateDto), 'Название шаблона: укажите текст', 'update');
});

test('DTO обновления: пустое тело, folderId: null и правка только услуг валидны', async () => {
  const pipe = makePipe();
  await pipe.transform({}, bodyOf(UpdateCheckTemplateDto));
  const moved = await pipe.transform({ folderId: null }, bodyOf(UpdateCheckTemplateDto));
  assert.equal(moved.folderId, null, 'null — вернуть шаблон в корень');
  const upd = await pipe.transform(
    { name: 'Новое имя', services: [{ name: 'Мойка', price: 500, quantity: 3 }] },
    bodyOf(UpdateCheckTemplateDto),
  );
  assert.equal(upd.name, 'Новое имя');
  assert.equal(upd.products, undefined, 'товары не присланы — не трогаем');
  await assert.rejects(
    () => pipe.transform({ services: [{ name: 'Мойка', price: -5 }] }, bodyOf(UpdateCheckTemplateDto)),
    (err) => err instanceof BadRequestException,
  );
});

// ── 4. Сервис шаблонов: что уходит в БД ──────────────────────────────────────

function makeTemplatePool(stored = {}) {
  const calls = [];
  const row = (over) => ({
    id: 'tpl-1',
    name: 'Шаблон',
    services: [],
    products: [],
    user_id: 'user-1',
    folder_id: null,
    created_at: '2026-09-30T09:00:00Z',
    updated_at: '2026-09-30T09:00:00Z',
    ...over,
  });
  const query = async (sql, params) => {
      calls.push({ sql, params });
      if (/^\s*(?:BEGIN|COMMIT|ROLLBACK)/.test(sql) || /pg_advisory_xact_lock/.test(sql)) return { rows: [] };
      if (/^\s*INSERT INTO check_templates/.test(sql)) {
        return {
          rows: [
            row({
              name: params[1],
              services: JSON.parse(params[2]),
              products: JSON.parse(params[3]),
              user_id: params[4],
              folder_id: params[5],
            }),
          ],
        };
      }
      if (/^\s*UPDATE check_templates/.test(sql)) return { rows: [row()] };
      // Папка нужного scope найдена.
      if (/FROM check_template_folders/.test(sql)) return { rows: [{ id: params[0] }] };
      if (/FROM check_templates/.test(sql)) return { rows: [row(stored)] };
      throw new Error(`unexpected SQL: ${sql.slice(0, 120)}`);
  };
  return {
    calls,
    query,
    connect: async () => ({ query, release() {} }),
  };
}

const MASTER = { userID: 'user-1', role: 'master' };

test('create: услуга quantity 3 сохраняется как 1, количество товара сохраняется', async () => {
  const pool = makeTemplatePool();
  const service = new CheckTemplatesService(pool);
  const dto = await makePipe().transform({ ...structuredClone(OLD_CLIENT_BODY), shared: false }, bodyOf(CreateCheckTemplateDto));

  const created = await service.create('tenant-1', MASTER, dto);

  const insert = pool.calls.find((c) => /INSERT INTO check_templates/.test(c.sql));
  assert.ok(insert, 'INSERT выполнен');
  const savedServices = JSON.parse(insert.params[2]);
  const savedProducts = JSON.parse(insert.params[3]);
  assert.deepEqual(savedServices, [{ serviceId: 'svc-1', name: 'Мойка', price: 500, quantity: 1 }]);
  assert.equal(savedProducts[0].quantity, 5, 'quantity товара не тронут');
  assert.equal(savedProducts[1].quantity, 0.5, 'дробное количество товара не тронуто');
  assert.equal(created.services[0].quantity, 1, 'клиент получает услугу с quantity 1');
  assert.equal(created.products[0].quantity, 5);
  assert.equal(insert.params[4], 'user-1', 'личный шаблон остаётся за автором');
});

test('create shared template requires the explicit role permission; director remains implicit', async () => {
  const deniedPool = makeTemplatePool();
  await assert.rejects(
    new CheckTemplatesService(deniedPool).create('tenant-1', MASTER, { name: 'Общий', shared: true }),
    (err) => err && err.getStatus?.() === 403,
  );

  const sharedPool = makeTemplatePool({ user_id: null });
  const actor = { userID: 'user-1', role: 'admin', permissions: { templates_shared_manage: true } };
  const result = await new CheckTemplatesService(sharedPool).create('tenant-1', actor, { name: 'Общий', shared: true });
  const insert = sharedPool.calls.find((c) => /INSERT INTO check_templates/.test(c.sql));
  assert.equal(insert.params[4], null, 'permission holder publishes into shared scope');
  assert.equal(result.isShared, true);
  assert.ok(sharedPool.calls.some((call) => /pg_advisory_xact_lock/.test(call.sql)), 'mutation takes tenant tree lock');
});

test('create через контроллер: тело → ValidationPipe → сервис → INSERT с quantity 1', async () => {
  const pool = makeTemplatePool();
  const controller = new CheckTemplatesController(new CheckTemplatesService(pool));
  const dto = await makePipe().transform(
    { name: 'Мойка и полировка', services: [{ name: 'Мойка', price: 500, quantity: 3 }] },
    bodyOf(CreateCheckTemplateDto),
  );
  await controller.create({ tenantID: 'tenant-1', userID: 'user-1', role: 'director' }, dto);
  const insert = pool.calls.find((c) => /INSERT INTO check_templates/.test(c.sql));
  assert.equal(JSON.parse(insert.params[2])[0].quantity, 1);
  assert.deepEqual(JSON.parse(insert.params[3]), [], 'товаров нет — пустой список, как раньше');
});

test('create без услуг — пустой список, а не null', async () => {
  const pool = makeTemplatePool();
  await new CheckTemplatesService(pool).create('tenant-1', MASTER, { name: 'Только название' });
  const insert = pool.calls.find((c) => /INSERT INTO check_templates/.test(c.sql));
  assert.equal(insert.params[2], '[]');
  assert.equal(insert.params[3], '[]');
});

test('update: услуги нормализуются в 1, товары — как пришли; неприсланное поле не трогается', async () => {
  const service = (pool) => new CheckTemplatesService(pool);

  const poolServices = makeTemplatePool();
  await service(poolServices).update('tpl-1', 'tenant-1', MASTER, {
    services: [{ name: 'Мойка', price: 500, quantity: 3 }],
  });
  const updServices = poolServices.calls.find((c) => /^\s*UPDATE check_templates/.test(c.sql));
  assert.match(updServices.sql, /services=\$1/);
  assert.doesNotMatch(updServices.sql, /products=/, 'товары не присланы — не в SET');
  assert.deepEqual(JSON.parse(updServices.params[0]), [{ name: 'Мойка', price: 500, quantity: 1 }]);

  const poolProducts = makeTemplatePool();
  await service(poolProducts).update('tpl-1', 'tenant-1', MASTER, {
    products: [{ productId: 'p-1', name: 'Масло', price: 900, quantity: 5 }],
  });
  const updProducts = poolProducts.calls.find((c) => /^\s*UPDATE check_templates/.test(c.sql));
  assert.match(updProducts.sql, /products=\$1/);
  assert.doesNotMatch(updProducts.sql, /services=/, 'услуги не присланы — не в SET');
  assert.equal(JSON.parse(updProducts.params[0])[0].quantity, 5, 'quantity товара не тронут');

  const poolName = makeTemplatePool();
  await service(poolName).update('tpl-1', 'tenant-1', MASTER, { name: 'Новое имя' });
  const updName = poolName.calls.find((c) => /^\s*UPDATE check_templates/.test(c.sql));
  assert.doesNotMatch(updName.sql, /services=|products=/, 'переименование не задевает состав');
});

test('getAll: старый шаблон с quantity 3 отдаётся как есть — историю не переписываем', async () => {
  const legacy = { services: [{ serviceId: 'svc-1', name: 'Мойка', price: 500, quantity: 3 }] };
  const pool = makeTemplatePool(legacy);
  const list = await new CheckTemplatesService(pool).getAll('tenant-1', 'user-1');
  assert.equal(list[0].services[0].quantity, 3, 'клиенты разворачивают такую строку сами');
  assert.equal(pool.calls.filter((c) => /UPDATE|INSERT/.test(c.sql)).length, 0, 'чтение не пишет в БД');
});

// ── 5. Билдеры отчётов на заглушке пула: отображение строк и форма SQL ───────

test('«По услугам»: «Мойка ×3» из истории = 1 услуга, выручка та же, средняя цена = выручка / строки', async () => {
  // Ответ БД для одной строки чека «Мойка», quantity 3, total 1500 (SQL считает
  // строки — проверяется в LIVE-части; здесь — как билдер строит отчёт из ответа).
  const pool = makePool([
    {
      key: 'svc-wash',
      name: 'Мойка',
      service_id: 'svc-wash',
      qty: 1,
      revenue: '1500.00',
      checks: 1,
      masters: 1,
      total_qty: 1,
      total_revenue: '1500.00',
      total_checks: 1,
      total_groups: 1,
    },
  ]);
  const built = await new ServicesBuilder(pool).build(makeCtx());

  assert.equal(built.columns.find((c) => c.key === 'qty').title, 'Оказано');
  assert.equal(built.columns.find((c) => c.key === 'qty').type, 'number');
  assert.equal(built.rows.length, 1);
  assert.equal(built.rows[0].qty, 1, 'одна строка — одна услуга, а не 3');
  assert.equal(built.rows[0].revenue, 1500, 'выручка = total строки');
  assert.equal(built.rows[0].avgPrice, 1500);
  assert.equal(built.rows[0].share, 100);
  assert.equal(built.totals.qty, 1);
  assert.equal(built.totals.revenue, 1500);
  assert.equal(built.totals.avgPrice, 1500);
  assert.equal(built.kpis.find((k) => k.key === 'qty').value, 1);
  assert.equal(built.kpis.find((k) => k.key === 'revenue').value, 1500);
  assert.equal(built.kpis.find((k) => k.key === 'distinct').value, 1);
  assert.equal(built.truncated, false);
});

test('«По услугам»: итоги и средняя цена считаются по числу услуг, а не по количеству', async () => {
  const pool = makePool(
    [
      { key: 'a', name: 'Полировка', service_id: 'a', qty: 1, revenue: '4000', checks: 1, masters: 1 },
      { key: 'b', name: 'Мойка', service_id: 'b', qty: 2, revenue: '3000', checks: 2, masters: 1 },
    ].map((r) => ({ ...r, total_qty: 3, total_revenue: '7000', total_checks: 3, total_groups: 2 })),
  );
  const built = await new ServicesBuilder(pool).build(makeCtx());
  assert.equal(built.rows[1].avgPrice, 1500, 'Мойка: 3000 / 2 услуги');
  assert.equal(built.totals.qty, 3);
  assert.equal(built.totals.avgPrice, 2333.33, '7000 / 3 услуги');
  assert.equal(built.kpis.find((k) => k.key === 'avgPrice').value, 2333.33);
});

test('«По услугам»: пустой период — нули, без деления на ноль', async () => {
  const built = await new ServicesBuilder(makePool([])).build(makeCtx());
  assert.equal(built.rows.length, 0);
  assert.equal(built.totals.qty, 0);
  assert.equal(built.totals.avgPrice, 0);
});

test('«По услугам»: форма SQL — строки считаются, полностью возвращённые отсекаются, филиал — параметром', async () => {
  const pool = makePool([]);
  await new ServicesBuilder(pool).build(makeCtx());
  const plain = pool.calls[0];
  assert.deepEqual(plain.params, ['tenant-1', '2026-09-01', '2026-09-30', 'Europe/Moscow']);
  assert.match(plain.sql, /COUNT\(\*\)::int AS qty/);
  assert.match(plain.sql, /WHERE COALESCE\(r\.qty, 0\) < COALESCE\(NULLIF\(b\.quantity, 0\), 1\)/);
  assert.match(plain.sql, /SUM\(l\.total - l\.returned_amount\)/, 'выручка: total минус возвращённая сумма');
  assert.doesNotMatch(plain.sql, /SUM\(\s*(?:l|sl|b)\.quantity/);

  const scoped = makePool([]);
  await new ServicesBuilder(scoped).build(makeCtx({ pointId: 'point-1' }));
  assert.equal(scoped.calls[0].params[4], 'point-1');
  assert.match(scoped.calls[0].sql, /ch\.point_id = \$5/);
});

test('«Сводный»: «Топ-5 услуг» — «Оказано» = число строк, «Топ-5 товаров» остался «Кол-во»', async () => {
  const pool = makePool([{ name: 'Мойка', qty: 1, revenue: '1500.00' }]);
  const section = await new SummaryBuilder(pool).topServices(makeCtx({ def: { id: 'summary' } }));
  assert.equal(section.key, 'topServices');
  assert.equal(section.title, 'Топ-5 услуг');
  assert.deepEqual(
    section.columns.map((c) => c.title),
    ['Услуга', 'Оказано', 'Выручка'],
  );
  assert.deepEqual(section.rows, [{ name: 'Мойка', qty: 1, revenue: 1500 }]);
  const { sql } = pool.calls[0];
  assert.match(sql, /COUNT\(\*\)::int AS qty/);
  assert.match(sql, /WHERE COALESCE\(r\.qty, 0\) < COALESCE\(NULLIF\(b\.quantity, 0\), 1\)/);
  assert.match(sql, /LIMIT 5/);
  assert.doesNotMatch(sql, /SUM\(\s*(?:l|sl|b)\.quantity/);

  const productsPool = makePool([{ name: 'Масло', qty: '5', revenue: '4500', profit: '900' }]);
  const products = await new SummaryBuilder(productsPool).topProducts(makeCtx({ def: { id: 'summary' } }));
  assert.equal(products.columns.find((c) => c.key === 'qty').title, 'Кол-во', 'колонка товаров не переименована');
});

// ── 6. LIVE: настоящий SQL на Postgres (SERVICE_LINES_LIVE_DB) ───────────────

const LIVE_PERIOD = { dateFrom: '2001-01-01', dateTo: '2001-01-31' };
const LIVE_DATE = '2001-01-15T09:00:00Z';

test(
  'LIVE: «Мойка ×3» = 1 услуга с той же выручкой; полностью возвращённая строка исключена; частичный возврат вычтен',
  {
    skip: !process.env.SERVICE_LINES_LIVE_DB
      ? 'нет SERVICE_LINES_LIVE_DB (локальный Postgres) — SQL проверяют статика и заглушки выше'
      : false,
  },
  async () => {
    const { Client } = require('pg');
    const c = new Client({ connectionString: process.env.SERVICE_LINES_LIVE_DB });
    await c.connect();
    const wrap = { query: (sql, params) => c.query(sql, params) };
    const one = async (sql, params) => (await c.query(sql, params)).rows[0];

    const tenant = async (name) => (await one(`INSERT INTO tenants (name) VALUES ($1) RETURNING id`, [name])).id;
    const service = async (tenantId, name, price) =>
      (
        await one(`INSERT INTO services (name, default_price, tenant_id) VALUES ($1, $2, $3) RETURNING id`, [
          name,
          price,
          tenantId,
        ])
      ).id;
    const check = async (tenantId, opts = {}) =>
      (
        await one(
          `INSERT INTO checks (tenant_id, date, is_deferred, payment_method, is_returned, return_scope, deleted_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [
            tenantId,
            opts.date ?? LIVE_DATE,
            opts.deferred ?? false,
            opts.payment ?? 'cash',
            opts.returned ?? false,
            opts.returnScope ?? null,
            opts.deletedAt ?? null,
          ],
        )
      ).id;
    const line = async (checkId, serviceId, name, quantity, price, total) =>
      (
        await one(
          `INSERT INTO check_service_lines (check_id, service_id, name, quantity, price, total)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [checkId, serviceId, name, quantity, price, total],
        )
      ).id;
    const giveBack = async (tenantId, checkId, serviceLineId, quantity, amount) => {
      const ret = await one(
        `INSERT INTO check_returns (check_id, tenant_id, destination, scope) VALUES ($1, $2, 'warehouse', 'partial') RETURNING id`,
        [checkId, tenantId],
      );
      await c.query(
        `INSERT INTO check_return_lines (return_id, service_line_id, quantity, amount) VALUES ($1, $2, $3, $4)`,
        [ret.id, serviceLineId, quantity, amount],
      );
    };
    const byName = (built) => Object.fromEntries(built.rows.map((r) => [r.name, r]));

    try {
      await c.query('BEGIN');

      // ── Тенант «история»: только старая строка «Мойка ×3» (пример из спеки) ──
      const history = await tenant('service-lines-history');
      const historyWash = await service(history, 'Мойка', 500);
      await line(await check(history), historyWash, 'Мойка', 3, 500, 1500);

      const historyCtx = makeCtx({ tenantId: history, ...LIVE_PERIOD });
      const oracle = await one(
        `SELECT COALESCE(SUM(sl.total), 0) AS revenue, COALESCE(SUM(sl.quantity), 0) AS old_qty, COUNT(*)::int AS rows
           FROM checks ch JOIN check_service_lines sl ON sl.check_id = ch.id WHERE ch.tenant_id = $1`,
        [history],
      );
      assert.equal(Number(oracle.old_qty), 3, 'контроль: старая формула SUM(quantity) дала бы 3');
      const historyReport = await new ServicesBuilder(wrap).build(historyCtx);
      assert.equal(historyReport.rows.length, 1);
      assert.equal(historyReport.rows[0].qty, 1, '«Мойка ×3» в истории — 1 услуга');
      assert.equal(historyReport.rows[0].revenue, Number(oracle.revenue), 'выручка та же, что и раньше: SUM(total)');
      assert.equal(historyReport.rows[0].revenue, 1500);
      assert.equal(historyReport.rows[0].avgPrice, 1500, 'средняя цена = 1500 / 1 услуга');
      assert.equal(historyReport.totals.qty, 1);
      assert.equal(historyReport.totals.revenue, 1500);

      // ── Тенант «набор случаев» ───────────────────────────────────────────────
      const t = await tenant('service-lines-cases');
      const wash = await service(t, 'Мойка', 500);
      const polish = await service(t, 'Полировка', 4000);

      // A: историческая «Мойка ×3».
      await line(await check(t), wash, 'Мойка', 3, 500, 1500);
      // B: обычный чек: мойка, полировка и «свободная» строка без услуги справочника.
      const checkB = await check(t);
      await line(checkB, wash, 'Мойка', 1, 500, 500);
      await line(checkB, polish, 'Полировка', 1, 4000, 4000);
      await line(checkB, null, 'Диагностика', 1, 700, 700);
      // C: полировка возвращена полностью (строка возврата 1 из 1) — не оказана.
      const checkC = await check(t, { payment: 'card' });
      const polishReturned = await line(checkC, polish, 'Полировка', 1, 4000, 4000);
      await giveBack(t, checkC, polishReturned, 1, 4000);
      // D: «Мойка ×2», вернули 1 из 2 — остаётся ОДНА услуга, выручка 1000 − 500.
      const checkD = await check(t);
      const washPartial = await line(checkD, wash, 'Мойка', 2, 500, 1000);
      await giveBack(t, checkD, washPartial, 1, 500);
      // K: quantity NULL читается как 1 (сервер считает total как price × (quantity || 1)).
      await line(await check(t), wash, 'Мойка', null, 500, 500);
      // Не входят в отчёт: возвращённый целиком чек, гарантия, черновик, корзина, вне периода.
      await line(await check(t, { returned: true, returnScope: 'full' }), wash, 'Мойка', 1, 500, 500);
      await line(await check(t, { payment: 'warranty' }), wash, 'Мойка', 1, 500, 500);
      await line(await check(t, { deferred: true }), wash, 'Мойка', 1, 500, 500);
      await line(await check(t, { deletedAt: LIVE_DATE }), wash, 'Мойка', 1, 500, 500);
      await line(await check(t, { date: '2001-02-15T09:00:00Z' }), wash, 'Мойка', 1, 500, 500);

      const ctx = makeCtx({ tenantId: t, ...LIVE_PERIOD });
      const report = await new ServicesBuilder(wrap).build(ctx);
      const rows = byName(report);

      assert.deepEqual(
        report.rows.map((r) => r.name),
        ['Полировка', 'Мойка', 'Диагностика'],
        'порядок — по выручке',
      );
      assert.equal(rows['Мойка'].qty, 4, 'A + B + D (частично возвращённая = 1) + K (NULL = 1)');
      assert.equal(rows['Мойка'].revenue, 3000, '1500 + 500 + (1000 − 500) + 500');
      assert.equal(rows['Мойка'].avgPrice, 750, '3000 / 4 услуги');
      assert.equal(rows['Мойка'].checks, 4);
      assert.equal(rows['Полировка'].qty, 1, 'полностью возвращённая строка чека C исключена');
      assert.equal(rows['Полировка'].revenue, 4000);
      assert.equal(rows['Полировка'].checks, 1, 'и в «Чеков» она не учтена');
      assert.equal(rows['Диагностика'].qty, 1);
      assert.equal(rows['Диагностика'].revenue, 700);
      assert.equal(rows['Диагностика']._id, null, 'свободная строка — без id услуги');
      assert.equal(report.totals.qty, 6);
      assert.equal(report.totals.revenue, 7700);
      assert.equal(report.totals.checks, 6);
      assert.equal(report.totals.avgPrice, round2(7700 / 6));
      assert.equal(report.kpis.find((k) => k.key === 'qty').value, 6);
      assert.equal(report.kpis.find((k) => k.key === 'revenue').value, 7700);
      assert.equal(report.kpis.find((k) => k.key === 'distinct').value, 3);
      assert.equal(report.truncated, false);

      // «Сводный» → «Топ-5 услуг» обязан совпасть с «По услугам».
      const top = await new SummaryBuilder(wrap).topServices(ctx);
      assert.deepEqual(
        top.rows,
        report.rows.map((r) => ({ name: r.name, qty: r.qty, revenue: r.revenue })),
        'Топ-5 услуг = строки «По услугам» (то же правило и те же возвраты)',
      );
      assert.equal(top.columns[1].title, 'Оказано');
    } finally {
      await c.query('ROLLBACK').catch(() => {});
      await c.end();
    }
  },
);
